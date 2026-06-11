'use client'

// app/(app)/maintenance/page.tsx
// Maintenance Management System — workflow v2.
//
// Job cards split into two workflows:
//  • BREAKDOWN — urgent, auto-assigned to the on-duty technician from the duty
//    roster (manager informed, not the allocator). Timer runs from raise time.
//  • SCHEDULED / PLANNED — goes to the maintenance manager for allocation
//    (internal technician or external company), QC-required toggle, and an
//    estimated time slot in the technician planner calendar.
//
// Other workflow rules:
//  • Manager can send a card back to the raiser for clarification ('clarify').
//  • QC checks support YES / NO / N/A; any YES sends the card back to the
//    technician with the QC's comment (manager informed via log).
//  • Spares / critical equipment used are logged per card and decrement the
//    spare parts register (Stock & Spares tab).
//  • Every comment and transition is kept in maintenance.job_card_logs.
//
// Role views (Manager / Technician / QC / Raised by me) are presented via a
// view switcher for now; they will be locked to the real user permissions
// once the technician/QC users are created.

import { useState, useEffect, useRef, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'

// ─── Constants (from QM forms / design) ───────────────────────────────────────

const AREAS = ['Sieving Tower','Pasteurizer','Granules - RB','Refining 1','Refining 2','Diamond Blender','Rosehips Crusher','Rosehips Cutter','Rosehips Hammer Mill','Rosehips Blending','Rosehips Granules','Vacuum Packing','Pallet Wrapper','Stitching Machine','Facility','Boiler Room','Workshop','Lab','Reception','Admin Office','Chemical Room','Stores','Unit 1','Unit 2','Unit 3 Blender','Production Staff Male','Production Staff Female','Quality Office','Forklift Charging','Outside Back','Outside Front','Factory']
const TECHS = ['Shane','Mohapi','John','Yamkela','Melikhaya']
// Breakdown is its own workflow now — removed from the selectable planned types
const PLANNED_TYPES = ['Planned Maintenance','Safety Related','Engineering','Repair','Temporary Repair','Improvement','Audit/Inspection Finding']
const QC_CHECKS = ['Any loose screws visible?','Any spares, equipment or foreign objects left behind?','Any oil or grease spillages present or visible on the machine/equipment?','Any water leakages, spillages or poor housekeeping present?','Any loose or missing machine cover plates/end-guards?','Any reason why the machine is not safe for work?']

const STATUSES = ['raised','clarify','assigned','in_progress','qc_check','verify','complete'] as const
type Status = typeof STATUSES[number]
const STATUS_COLOR: Record<Status,string> = { raised:'#eab308', clarify:'#f97316', assigned:'#3b82f6', in_progress:'#fbbf24', qc_check:'#8b5cf6', verify:'#06b6d4', complete:'#22c55e' }
const STATUS_LABEL: Record<Status,string> = { raised:'NEW — AWAITING ALLOCATION', clarify:'BACK TO RAISER — CLARIFY', assigned:'ASSIGNED — AWAITING ACCEPT', in_progress:'IN PROGRESS', qc_check:'QC CHECK', verify:'VERIFY', complete:'COMPLETE' }

type View = 'manager'|'tech'|'qc'|'raiser'
type QcAnswer = 'yes'|'no'|'na'

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobCard {
  id: number; card_no: string; area: string; machine: string|null
  maint_types: string[]; description: string; long_desc: string
  workflow: 'breakdown'|'planned'
  raised_by: string; raised_at: string
  status: Status; assigned_to: string|null; assigned_at: string|null
  accepted_at: string|null; completed_at: string|null
  work_done: string; root_cause: string; tools_used: string
  qc_required: boolean; external: boolean; external_company: string
  qc_checks: any[]; qc_name: string; qc_done_at: string|null
  verified_at: string|null; verified_ok: boolean|null
  photo_url: string|null; ai_suggestion: string; comments: string
  reopen_count: number
}
interface CardLog { id:number; card_id:number; kind:'comment'|'event'; stage:string; author:string; body:string; created_at:string }
interface SpareUsed { id:number; card_id:number; part_id:number|null; description:string; qty:number; from_stock:string; is_critical:boolean; logged_by:string; created_at:string }
interface Roster { id:number; technician:string; start_at:string; end_at:string }
interface AreaQc { id:number; area:string; qc_name:string }
interface Slot { id:number; card_id:number|null; technician:string; start_at:string; end_at:string; note:string }
interface Template { id:number; frequency:'weekly'|'monthly'; area:string; doc_ref:string; tasks:string[]; sort_order:number }
interface Completion { id:number; template_id:number; period_key:string; task_states:Record<string,{done?:boolean; fault?:boolean; notes?:string}>; comments:string; completed_by:string }
interface AnnualItem { id:number; category:string; asset:string; serial_no:string; supplier:string; next_due:string|null; notes:string }
interface SparePart { id:number; part_no:string; class:string; description:string; qty_new:number; qty_used:number }
interface Offsite { id:number; item:string; sent_to:string; date_sent:string|null; status:string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function aiSuggest(t: string) {
  const l = (t || '').toLowerCase()
  if (l.includes('rust')) return 'Rust on surface. Clean and apply food-safe coating.'
  if (l.includes('leak') || l.includes('water')) return 'Leak detected. Seal joint and inspect gaskets.'
  if (l.includes('loose') || l.includes('screw')) return 'Loose fastener found. Tighten and verify torque.'
  if (l.includes('dirty') || l.includes('dust') || l.includes('clean')) return 'Hygiene issue. Deep clean before production resumes.'
  if (l.includes('crack') || l.includes('hole') || l.includes('gap')) return 'Structural damage. Seal to prevent pest ingress.'
  if (l.includes('belt') || l.includes('chain')) return 'Belt/chain wear detected. Replace and check tension.'
  if (l.includes('broken') || l.includes('damage')) return 'Broken component. Replace and log in spares register.'
  if (l.includes('guard') || l.includes('cover')) return 'Missing guard/cover. Reinstall before operation.'
  if (l.includes('wire') || l.includes('electric') || l.includes('plug')) return 'Electrical issue. Isolate power and inspect wiring.'
  if (l.includes('oil') || l.includes('grease')) return 'Oil/grease spillage. Clean and check seals.'
  if (l.includes('light') || l.includes('bulb')) return 'Lighting fault. Replace fitting/bulb promptly.'
  if (l.includes('door') || l.includes('handle')) return 'Door/handle fault. Repair to maintain integrity.'
  if (l.includes('flush') || l.includes('shower') || l.includes('tap')) return 'Plumbing issue. Repair to prevent water waste.'
  return 'Issue detected. Inspect and take corrective action.'
}

const fmtD  = (d: string|null) => (d ? new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' }) : '—')
const fmtT  = (d: string|null) => (d ? new Date(d).toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' }) : '—')
const fmtDT = (d: string|null) => (d ? fmtD(d)+' '+fmtT(d) : '—')
const diffM = (a: string|null, b: string|null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) : 0)
const diffDays = (a: string|null, b: string|null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) : 0)
const daysUntil = (d: string|null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : 0)

function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2,'0')}`
}
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`

// Legacy qc_checks were booleans; v2 uses 'yes' | 'no' | 'na'
const normQc = (v: any): QcAnswer => (v === true || v === 'yes' ? 'yes' : v === 'na' ? 'na' : 'no')

function downscalePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new window.Image()
      img.onload = () => {
        const max = 800
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = reject
      img.src = ev.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const calCol   = (d: number) => (d <= 0 ? '#ef4444' : d <= 7 ? '#f97316' : d <= 30 ? '#eab308' : d <= 60 ? '#3b82f6' : '#22c55e')
const calBadge = (d: number) => (d <= 0 ? 'OVERDUE' : d <= 7 ? 'URGENT' : d <= 30 ? 'SOON' : d <= 60 ? 'PLAN' : 'OK')

// ─── Theme (replica of design mockup) ─────────────────────────────────────────

const bg = '#0b1120', pnl = '#111827', crd = '#1e293b', brd = '#334155'
const acc = '#f59e0b', txt = '#e2e8f0', muted = '#94a3b8', dim = '#64748b'

const inp: React.CSSProperties = { width:'100%', padding:'7px 10px', background:pnl, border:'1px solid '+brd, borderRadius:5, color:txt, fontSize:11, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }
const txa: React.CSSProperties = { ...inp, minHeight:50, resize:'vertical' }
const lb: React.CSSProperties = { fontSize:9, fontWeight:600, color:muted, marginBottom:3, display:'block', letterSpacing:1, textTransform:'uppercase' }
const btn = (c = acc): React.CSSProperties => ({ padding:'6px 16px', background:c, color:c === acc ? '#000' : '#fff', border:'none', borderRadius:5, fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'inherit' })
const sbtn = (c = acc): React.CSSProperties => ({ padding:'3px 8px', background:c, color:c === acc ? '#000' : '#fff', border:'none', borderRadius:3, fontSize:9, fontWeight:600, cursor:'pointer', fontFamily:'inherit' })
const card: React.CSSProperties = { background:crd, borderRadius:8, border:'1px solid '+brd, padding:14, marginBottom:14 }
const ttl: React.CSSProperties = { fontSize:11, fontWeight:700, color:acc, marginBottom:10, letterSpacing:1, textTransform:'uppercase' }
const th: React.CSSProperties = { textAlign:'left', padding:'6px 8px', borderBottom:'2px solid '+brd, color:acc, fontSize:8, fontWeight:700, letterSpacing:1, textTransform:'uppercase' }
const td: React.CSSProperties = { padding:'5px 8px', borderBottom:'1px solid '+brd+'18' }
const tabBtn = (a: boolean): React.CSSProperties => ({ padding:'7px 14px', fontSize:10, fontWeight:700, cursor:'pointer', border:'none', borderRadius:5, background:a ? acc : 'transparent', color:a ? '#000' : muted, fontFamily:'inherit', whiteSpace:'nowrap', letterSpacing:0.5 })

function Badge({ color, children }: { color:string; children:React.ReactNode }) {
  return <span style={{ display:'inline-block', padding:'2px 7px', borderRadius:4, fontSize:9, fontWeight:700, background:color+'20', color, letterSpacing:0.5 }}>{children}</span>
}

function Timer({ start }: { start: string|null }) {
  const [e, setE] = useState(0)
  useEffect(() => {
    if (!start) return
    const tick = () => setE(Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [start])
  const h = Math.floor(e/3600), m = Math.floor((e%3600)/60), s = e%60
  return (
    <div style={{ fontSize:26, fontWeight:800, fontVariantNumeric:'tabular-nums', color:'#fbbf24' }}>
      {String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MaintenancePage() {
  const { displayName } = useAuth()
  const db = getDb()

  const [tab, setTab] = useState(0)
  const [sub, setSub] = useState(0)        // scheduled-maintenance subtab
  const [jcSub, setJcSub] = useState(0)    // job-cards subtab: 0 board, 1 planner, 2 roster & QC
  const [view, setView] = useState<View>('manager')
  const [actor, setActor] = useState('')   // acting-as name for tech/qc/raiser views
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [jcs, setJcs] = useState<JobCard[]>([])
  const [logs, setLogs] = useState<CardLog[]>([])
  const [sparesUsed, setSparesUsed] = useState<SpareUsed[]>([])
  const [roster, setRoster] = useState<Roster[]>([])
  const [areaQc, setAreaQc] = useState<AreaQc[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [completions, setCompletions] = useState<Completion[]>([])
  const [annual, setAnnual] = useState<AnnualItem[]>([])
  const [stock, setStock] = useState<SparePart[]>([])
  const [offsite, setOffsite] = useState<Offsite[]>([])

  const [nj, setNj] = useState({ workflow:'planned' as 'breakdown'|'planned', area:'', machine:'', type:[] as string[], desc:'', longDesc:'', raisedBy:'', photo:null as string|null, aiSug:'' })
  const [filt, setFilt] = useState('all')
  const [openCL, setOpenCL] = useState<number|null>(null)
  const [openLog, setOpenLog] = useState<Record<number,boolean>>({})
  const [popup, setPopup] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<Record<string,string>>({})
  // allocation form state per card (manager view)
  const [alloc, setAlloc] = useState<Record<number,{ tech?:string; external?:boolean; company?:string; qc?:boolean }>>({})
  // spare-entry form state per card (tech view)
  const [spForm, setSpForm] = useState<Record<number,{ partId?:string; desc?:string; qty?:string; from?:string; critical?:boolean }>>({})
  // planner form
  const [slotForm, setSlotForm] = useState({ cardId:'', tech:TECHS[0], date:'', time:'08:00', hours:'2', note:'' })
  const [plannerWeekStart, setPlannerWeekStart] = useState(() => {
    const d = new Date(); const day = d.getDay() || 7
    d.setDate(d.getDate() - day + 1); d.setHours(0,0,0,0); return d
  })
  // roster form
  const [rosterForm, setRosterForm] = useState({ tech:TECHS[0], start:'', end:'' })
  const fRef = useRef<HTMLInputElement>(null)

  const weekKey = isoWeekKey()
  const moKey = monthKey()

  useEffect(() => { if (!actor && displayName) setActor(displayName) }, [displayName, actor])

  // ── Load everything ──
  const loadAll = useCallback(async () => {
    try {
      const m = db.schema('maintenance')
      const [jc, lg, sp, ro, aq, sl, tpl, comp, ann, stk, off] = await Promise.all([
        m.from('job_cards').select('*').order('raised_at', { ascending:false }),
        m.from('job_card_logs').select('*').order('created_at'),
        m.from('job_card_spares').select('*').order('created_at', { ascending:false }),
        m.from('duty_roster').select('*').order('start_at'),
        m.from('area_qc').select('*'),
        m.from('tech_schedule').select('*').order('start_at'),
        m.from('checklist_templates').select('*').eq('active', true).order('sort_order'),
        m.from('checklist_completions').select('*').in('period_key', [weekKey, moKey]),
        m.from('annual_items').select('*').eq('active', true).order('next_due'),
        m.from('spare_parts').select('*').order('part_no'),
        m.from('offsite_equipment').select('*').is('returned_at', null).order('date_sent'),
      ])
      const firstErr = [jc, lg, sp, ro, aq, sl, tpl, comp, ann, stk, off].find(r => r.error)
      if (firstErr?.error) throw firstErr.error
      setJcs(jc.data ?? []); setLogs(lg.data ?? []); setSparesUsed(sp.data ?? [])
      setRoster(ro.data ?? []); setAreaQc(aq.data ?? []); setSlots(sl.data ?? [])
      setTemplates(tpl.data ?? []); setCompletions(comp.data ?? [])
      setAnnual(ann.data ?? []); setStock(stk.data ?? []); setOffsite(off.data ?? [])
      setError('')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load maintenance data')
    } finally {
      setLoading(false)
    }
  }, [weekKey, moKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])

  // ── Log helper: every comment + transition recorded for analysis ──
  const addLog = async (cardId: number, kind: 'comment'|'event', stage: string, author: string, body: string) => {
    const { data, error:err } = await db.schema('maintenance').from('job_card_logs')
      .insert({ card_id: cardId, kind, stage, author, body }).select().single()
    if (!err && data) setLogs(p => [...p, data])
  }

  // ── Job card mutations ──
  const upJC = async (id: number, u: Partial<JobCard>) => {
    setJcs(p => p.map(j => (j.id === id ? { ...j, ...u } : j)))
    const { error:err } = await db.schema('maintenance').from('job_cards')
      .update({ ...u, updated_at: new Date().toISOString() }).eq('id', id)
    if (err) setPopup('Save failed: ' + err.message)
  }

  const onDutyTech = () => {
    const now = Date.now()
    return roster.find(r => new Date(r.start_at).getTime() <= now && now <= new Date(r.end_at).getTime())?.technician ?? null
  }

  const createJC = async () => {
    if (!nj.area || !nj.desc || !nj.raisedBy) { setPopup('Please fill in your name, the area and a short description.'); return }
    setSaving(true)
    const isBd = nj.workflow === 'breakdown'
    const duty = isBd ? onDutyTech() : null
    const body: any = {
      workflow: nj.workflow, area: nj.area, machine: nj.machine || null,
      maint_types: isBd ? ['Breakdown'] : nj.type,
      description: nj.desc, long_desc: nj.longDesc,
      raised_by: nj.raisedBy, photo_url: nj.photo, ai_suggestion: nj.aiSug,
    }
    if (isBd && duty) { body.status = 'assigned'; body.assigned_to = duty; body.assigned_at = new Date().toISOString() }
    const { data, error:err } = await db.schema('maintenance').from('job_cards').insert(body).select().single()
    setSaving(false)
    if (err) { setPopup('Could not raise job card: ' + err.message); return }
    setJcs(p => [data, ...p])
    await addLog(data.id, 'event', 'raised', nj.raisedBy, isBd
      ? (duty ? `BREAKDOWN raised — auto-assigned to on-duty technician ${duty}. Maintenance manager informed. Timer running from raise.` : 'BREAKDOWN raised — NO TECHNICIAN ON DUTY in roster. Awaiting manager allocation. Maintenance manager informed.')
      : 'Planned/scheduled job card raised — awaiting maintenance manager allocation.')
    setPopup(isBd
      ? (duty ? `Breakdown ${data.card_no} sent directly to on-duty technician ${duty}.\nThe maintenance manager has been informed.\nThe job timer is already running.` : `Breakdown ${data.card_no} raised, but no technician is on duty in the roster.\nThe maintenance manager has been informed and will allocate it urgently.`)
      : `Job card ${data.card_no} raised.\nIt is now with the maintenance manager for allocation.`)
    setNj({ workflow:'planned', area:'', machine:'', type:[], desc:'', longDesc:'', raisedBy: nj.raisedBy, photo:null, aiSug:'' })
  }

  // Manager allocates a planned card
  const allocate = async (j: JobCard) => {
    const a = alloc[j.id] ?? {}
    if (a.external && !a.company) { setPopup('Enter the external company name.'); return }
    if (!a.external && !a.tech) { setPopup('Select a technician, or switch to external.'); return }
    const who = a.external ? a.company! : a.tech!
    await upJC(j.id, {
      status:'assigned', assigned_to: who, assigned_at: new Date().toISOString(),
      external: !!a.external, external_company: a.external ? a.company! : '',
      qc_required: a.qc !== false,
    })
    await addLog(j.id, 'event', 'assigned', actor || 'Maintenance Manager',
      (a.external ? `Allocated to EXTERNAL company ${who}` : `Allocated to technician ${who}`) +
      ` • QC check ${a.qc !== false ? 'REQUIRED' : 'NOT required'}`)
  }

  const sendForClarify = async (j: JobCard) => {
    const note = drafts['cl'+j.id]
    if (!note) { setPopup('Add a note explaining what needs clarifying.'); return }
    await upJC(j.id, { status:'clarify' })
    await addLog(j.id, 'comment', 'clarify', actor || 'Maintenance Manager', note)
    await addLog(j.id, 'event', 'clarify', actor || 'Maintenance Manager', `Sent back to ${j.raised_by} for clarification.`)
    setDrafts(p => ({ ...p, ['cl'+j.id]: '' }))
  }

  const resubmit = async (j: JobCard) => {
    await upJC(j.id, { status:'raised', description: drafts['sd'+j.id] ?? j.description, long_desc: drafts['ld'+j.id] ?? j.long_desc })
    await addLog(j.id, 'event', 'raised', j.raised_by, 'Raiser updated the description and resubmitted for allocation.')
  }

  // Technician logs a spare/critical part used — decrements the stock register
  const logSpare = async (j: JobCard) => {
    const f = spForm[j.id] ?? {}
    const qty = parseInt(f.qty || '1') || 1
    const part = stock.find(s => String(s.id) === f.partId)
    if (!part && !f.desc) { setPopup('Pick a part from stock or describe the item used.'); return }
    const { data, error:err } = await db.schema('maintenance').from('job_card_spares').insert({
      card_id: j.id, part_id: part?.id ?? null,
      description: part ? `${part.part_no} — ${part.description}` : f.desc!,
      qty, from_stock: f.from ?? 'new', is_critical: !!f.critical, logged_by: j.assigned_to ?? actor,
    }).select().single()
    if (err) { setPopup('Could not log spare: ' + err.message); return }
    setSparesUsed(p => [data, ...p])
    if (part) {
      const col = (f.from ?? 'new') === 'used' ? 'qty_used' : 'qty_new'
      const newVal = Math.max(0, (part as any)[col] - qty)
      await db.schema('maintenance').from('spare_parts').update({ [col]: newVal, updated_at: new Date().toISOString() }).eq('id', part.id)
      setStock(p => p.map(s => s.id === part.id ? { ...s, [col]: newVal } : s))
    }
    await addLog(j.id, 'event', j.status, j.assigned_to ?? actor, `Logged spare used: ${data.description} × ${qty} (${f.from ?? 'new'})${f.critical ? ' — CRITICAL EQUIPMENT' : ''}`)
    setSpForm(p => ({ ...p, [j.id]: {} }))
  }

  const completeWork = async (j: JobCard) => {
    const next: Status = j.qc_required ? 'qc_check' : 'verify'
    await upJC(j.id, {
      status: next, completed_at: new Date().toISOString(),
      work_done: drafts['wd'+j.id] ?? j.work_done, root_cause: drafts['rc'+j.id] ?? j.root_cause,
      tools_used: drafts['tl'+j.id] ?? j.tools_used,
    })
    await addLog(j.id, 'event', next, j.assigned_to ?? actor,
      j.qc_required ? `Work complete — sent to QC (${qcFor(j.area) || 'QC on duty'})` : 'Work complete — QC not required, sent to originator for verification.')
  }

  // QC submits — any YES sends the card back to the technician
  const qcSubmit = async (j: JobCard) => {
    const answers: QcAnswer[] = QC_CHECKS.map((_, i) => normQc((j.qc_checks ?? [])[i] ?? 'na'))
    const qcName = drafts['qn'+j.id] ?? j.qc_name ?? qcFor(j.area) ?? actor
    const anyYes = answers.includes('yes')
    if (anyYes) {
      const note = drafts['qf'+j.id]
      if (!note) { setPopup('One or more checks failed (YES) — a QC comment is required before sending the card back.'); return }
      await upJC(j.id, { status:'in_progress', qc_checks: answers, qc_name: qcName, reopen_count: (j.reopen_count ?? 0) + 1, completed_at: null })
      await addLog(j.id, 'comment', 'qc_check', qcName, note)
      await addLog(j.id, 'event', 'in_progress', qcName, `QC FAILED (${answers.filter(a => a === 'yes').length} × YES) — card returned to technician ${j.assigned_to}. Maintenance manager informed. Reopen #${(j.reopen_count ?? 0) + 1}.`)
      setDrafts(p => ({ ...p, ['qf'+j.id]: '' }))
    } else {
      await upJC(j.id, { status:'verify', qc_checks: answers, qc_name: qcName, qc_done_at: new Date().toISOString() })
      await addLog(j.id, 'event', 'verify', qcName, 'QC passed — sent to originator for verification.')
    }
  }

  const verifyCard = async (j: JobCard, ok: boolean) => {
    if (ok) {
      await upJC(j.id, { status:'complete', verified_at: new Date().toISOString(), verified_ok: true })
      await addLog(j.id, 'event', 'complete', j.raised_by, 'Originator verified the work as SATISFACTORY. Job card closed.')
    } else {
      await upJC(j.id, { status:'in_progress', verified_ok: false, reopen_count: (j.reopen_count ?? 0) + 1, completed_at: null })
      await addLog(j.id, 'event', 'in_progress', j.raised_by, `Originator marked the work NOT SATISFACTORY — card returned to ${j.assigned_to}. Reopen #${(j.reopen_count ?? 0) + 1}.`)
    }
  }

  const postComment = async (j: JobCard) => {
    const body = drafts['cm'+j.id]
    if (!body) return
    await addLog(j.id, 'comment', j.status, actor || displayName || 'Unknown', body)
    setDrafts(p => ({ ...p, ['cm'+j.id]: '' }))
  }

  // ── Checklist persistence (unchanged from v1) ──
  const getComp = (tplId: number, period: string) => completions.find(c => c.template_id === tplId && c.period_key === period)

  const saveComp = async (tpl: Template, patch: Partial<Completion>) => {
    const period = tpl.frequency === 'weekly' ? weekKey : moKey
    const existing = getComp(tpl.id, period)
    const merged = {
      template_id: tpl.id, period_key: period,
      task_states: patch.task_states ?? existing?.task_states ?? {},
      comments: patch.comments ?? existing?.comments ?? '',
      completed_by: displayName || existing?.completed_by || '',
      updated_at: new Date().toISOString(),
    }
    setCompletions(p => {
      const i = p.findIndex(c => c.template_id === tpl.id && c.period_key === period)
      if (i >= 0) { const n = [...p]; n[i] = { ...n[i], ...merged } as Completion; return n }
      return [...p, { id: 0, ...merged } as Completion]
    })
    const { data, error:err } = await db.schema('maintenance').from('checklist_completions')
      .upsert(merged, { onConflict: 'template_id,period_key' }).select().single()
    if (err) { setPopup('Save failed: ' + err.message); return }
    setCompletions(p => p.map(c => (c.template_id === tpl.id && c.period_key === period ? data : c)))
  }

  const toggleTask = (tpl: Template, ti: number) => {
    const period = tpl.frequency === 'weekly' ? weekKey : moKey
    const states = { ...(getComp(tpl.id, period)?.task_states ?? {}) }
    states[ti] = { ...(states[ti] ?? {}), done: !states[ti]?.done }
    saveComp(tpl, { task_states: states })
  }
  const setTaskField = (tpl: Template, ti: number, field: 'notes'|'fault', value: string|boolean) => {
    const period = tpl.frequency === 'weekly' ? weekKey : moKey
    const states = { ...(getComp(tpl.id, period)?.task_states ?? {}) }
    states[ti] = { ...(states[ti] ?? {}), [field]: value }
    saveComp(tpl, { task_states: states })
  }

  const saveAnnualNotes = async (id: number, notes: string) => {
    setAnnual(p => p.map(a => (a.id === id ? { ...a, notes } : a)))
    const { error:err } = await db.schema('maintenance').from('annual_items').update({ notes }).eq('id', id)
    if (err) setPopup('Save failed: ' + err.message)
  }

  // ── Roster / area-QC / planner mutations ──
  const addRoster = async () => {
    if (!rosterForm.start || !rosterForm.end) { setPopup('Pick a start and end time for the duty slot.'); return }
    const { data, error:err } = await db.schema('maintenance').from('duty_roster')
      .insert({ technician: rosterForm.tech, start_at: rosterForm.start, end_at: rosterForm.end }).select().single()
    if (err) { setPopup('Could not save roster slot: ' + err.message); return }
    setRoster(p => [...p, data].sort((a,b) => a.start_at.localeCompare(b.start_at)))
  }
  const delRoster = async (id: number) => {
    setRoster(p => p.filter(r => r.id !== id))
    await db.schema('maintenance').from('duty_roster').delete().eq('id', id)
  }

  const qcFor = (area: string) => areaQc.find(a => a.area === area)?.qc_name || ''
  const saveAreaQc = async (area: string, qc_name: string) => {
    setAreaQc(p => {
      const i = p.findIndex(a => a.area === area)
      if (i >= 0) { const n = [...p]; n[i] = { ...n[i], qc_name }; return n }
      return [...p, { id: 0, area, qc_name }]
    })
    const { data, error:err } = await db.schema('maintenance').from('area_qc')
      .upsert({ area, qc_name }, { onConflict:'area' }).select().single()
    if (err) { setPopup('Save failed: ' + err.message); return }
    setAreaQc(p => p.map(a => (a.area === area ? data : a)))
  }

  const addSlot = async () => {
    if (!slotForm.date) { setPopup('Pick a date for the planned slot.'); return }
    const start = new Date(slotForm.date + 'T' + slotForm.time)
    const end = new Date(start.getTime() + (parseFloat(slotForm.hours) || 1) * 3600000)
    const { data, error:err } = await db.schema('maintenance').from('tech_schedule').insert({
      card_id: slotForm.cardId ? Number(slotForm.cardId) : null,
      technician: slotForm.tech, start_at: start.toISOString(), end_at: end.toISOString(), note: slotForm.note,
    }).select().single()
    if (err) { setPopup('Could not save slot: ' + err.message); return }
    setSlots(p => [...p, data].sort((a,b) => a.start_at.localeCompare(b.start_at)))
    if (slotForm.cardId) {
      const c = jcs.find(x => x.id === Number(slotForm.cardId))
      if (c) await addLog(c.id, 'event', c.status, actor || 'Maintenance Manager', `Scheduled (estimate): ${slotForm.tech}, ${fmtDT(start.toISOString())} → ${fmtT(end.toISOString())}`)
    }
  }
  const delSlot = async (id: number) => {
    setSlots(p => p.filter(s => s.id !== id))
    await db.schema('maintenance').from('tech_schedule').delete().eq('id', id)
  }

  // ── Derived ──
  const cnt = (s: string) => jcs.filter(j => j.status === s).length
  const cardLogs = (id: number) => logs.filter(l => l.card_id === id)
  const cardSpares = (id: number) => sparesUsed.filter(s => s.card_id === id)
  const duty = onDutyTech()

  // role-filtered card sets
  const visibleCards = (() => {
    if (view === 'tech')   return jcs.filter(j => j.assigned_to === actor && !j.external && j.status !== 'complete')
    if (view === 'qc')     return jcs.filter(j => j.status === 'qc_check')
    if (view === 'raiser') return jcs.filter(j => j.raised_by === actor)
    return filt === 'all' ? jcs.filter(j => j.status !== 'complete') : jcs.filter(j => j.status === filt)
  })()

  const newCards = jcs.filter(j => j.status === 'raised')
  const hist = jcs.filter(j => j.status === 'complete').slice(0, 20)
  const annualRows = annual.map(a => ({ ...a, days: daysUntil(a.next_due) })).sort((a,b) => a.days - b.days)
  const openPlannedCards = jcs.filter(j => j.workflow === 'planned' && !['complete'].includes(j.status))

  const completed = jcs.filter(j => j.status === 'complete')
  const totalMins = completed.reduce((s,j) => s + diffM(j.accepted_at, j.completed_at), 0)
  const avgCloseDays = completed.length ? (completed.reduce((s,j) => s + diffDays(j.raised_at, j.completed_at ?? j.verified_at), 0) / completed.length).toFixed(1) : '0'
  const techCounts = TECHS.map(t => ({ t, n: jcs.filter(j => j.assigned_to === t).length })).sort((a,b) => b.n - a.n)
  const areaCounts = Object.entries(jcs.reduce((m:Record<string,number>, j) => { m[j.area] = (m[j.area] ?? 0) + 1; return m }, {})).sort((a,b) => b[1] - a[1]).slice(0, 8)
  const reopens = jcs.reduce((s,j) => s + (j.reopen_count ?? 0), 0)

  const TABS = ['🔧 Job Cards', '📅 Scheduled Maintenance', '📦 Stock & Spares', '📊 Analytics']

  if (loading) return <div style={{ background:bg, minHeight:'100%', color:muted, fontFamily:"'SF Mono','Menlo',monospace", padding:40, fontSize:11, letterSpacing:2 }}>LOADING MAINTENANCE SYSTEM…</div>

  // ─── Shared card renderer ───────────────────────────────────────────────────
  const renderCard = (j: JobCard) => {
    const isBd = j.workflow === 'breakdown'
    const timerStart = isBd ? j.raised_at : j.accepted_at
    const showTimer = (j.status === 'in_progress') || (isBd && j.status === 'assigned')
    const lgs = cardLogs(j.id)
    const sps = cardSpares(j.id)
    const canManage = view === 'manager'
    const isTech = view === 'tech' || canManage
    const isQc = view === 'qc' || canManage
    const isRaiser = view === 'raiser' || canManage

    return (
      <div key={j.id} style={{ ...card, borderLeft:'3px solid '+(isBd ? '#ef4444' : STATUS_COLOR[j.status]) }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, flexWrap:'wrap', gap:4 }}>
          <div>
            <strong style={{ color:acc, fontSize:13 }}>{j.card_no}</strong>{' '}
            <Badge color={isBd ? '#ef4444' : '#3b82f6'}>{isBd ? '🔴 BREAKDOWN' : '📋 PLANNED'}</Badge>{' '}
            <Badge color={STATUS_COLOR[j.status]}>{STATUS_LABEL[j.status]}</Badge>{' '}
            {j.external && <Badge color="#ec4899">EXTERNAL: {j.external_company}</Badge>}{' '}
            {(j.reopen_count ?? 0) > 0 && <Badge color="#ef4444">REOPENED ×{j.reopen_count}</Badge>}{' '}
            {!j.qc_required && j.status !== 'raised' && <Badge color="#64748b">NO QC</Badge>}
            {j.maint_types?.filter(t => t !== 'Breakdown').map(t => <span key={t} style={{ marginLeft:4 }}><Badge color="#64748b">{t}</Badge></span>)}
          </div>
          <span style={{ fontSize:9, color:dim }}>{fmtDT(j.raised_at)}</span>
        </div>
        <div style={{ fontSize:11, marginBottom:4 }}><strong>{j.area}</strong>{j.machine ? ' → '+j.machine : ''} • Raised by <strong>{j.raised_by}</strong>{j.assigned_to ? <> • {j.external ? 'External' : 'Tech'}: <strong>{j.assigned_to}</strong></> : null}</div>
        <div style={{ fontSize:10, color:txt, marginBottom:2 }}>{j.description}</div>
        {j.long_desc && <div style={{ fontSize:10, color:muted, marginBottom:6, whiteSpace:'pre-wrap' }}>{j.long_desc}</div>}
        {j.photo_url && <img src={j.photo_url} style={{ maxHeight:120, borderRadius:5, marginBottom:6 }} alt="" />}
        {j.ai_suggestion && <div style={{ background:acc+'11', border:'1px solid '+acc+'33', borderRadius:5, padding:5, marginBottom:6, fontSize:10 }}><span style={{ color:acc, fontWeight:700, fontSize:8 }}>AI: </span><span style={{ color:'#fbbf24' }}>{j.ai_suggestion}</span></div>}

        {showTimer && <div style={{ marginBottom:6 }}><div style={{ fontSize:8, color:muted }}>TIME ELAPSED {isBd ? '(SINCE RAISED — BREAKDOWN)' : '(SINCE ACCEPTED)'}</div><Timer start={timerStart} /></div>}

        {/* raised → manager allocates / sends back for clarification */}
        {j.status === 'raised' && canManage && (
          <div style={{ background:'#eab30810', border:'1px solid #eab30844', borderRadius:6, padding:8, marginTop:6 }}>
            <div style={{ fontSize:9, fontWeight:700, color:'#eab308', letterSpacing:1, marginBottom:6 }}>ALLOCATE JOB CARD</div>
            <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
              <button style={sbtn(!(alloc[j.id]?.external) ? acc : brd)} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], external:false } }))}>INTERNAL</button>
              <button style={sbtn(alloc[j.id]?.external ? '#ec4899' : brd)} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], external:true } }))}>EXTERNAL</button>
              {alloc[j.id]?.external
                ? <input style={{ ...inp, width:170 }} placeholder="External company..." value={alloc[j.id]?.company ?? ''} onChange={e => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], company: e.target.value } }))} />
                : <select style={{ ...inp, width:'auto' }} value={alloc[j.id]?.tech ?? ''} onChange={e => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], tech: e.target.value } }))}><option value="">Technician...</option>{TECHS.map(t => <option key={t}>{t}</option>)}</select>}
              <button style={sbtn((alloc[j.id]?.qc ?? true) ? '#8b5cf6' : brd)} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], qc: !(p[j.id]?.qc ?? true) } }))}>QC CHECK: {(alloc[j.id]?.qc ?? true) ? 'REQUIRED' : 'NOT REQUIRED'}</button>
              <button style={btn('#3b82f6')} onClick={() => allocate(j)}>FORWARD</button>
            </div>
            <div style={{ fontSize:8, color:dim, marginTop:4 }}>Production-related machines should be tested — keep QC required for those.</div>
            <div style={{ display:'flex', gap:6, marginTop:8, alignItems:'center' }}>
              <input style={{ ...inp, flex:1 }} placeholder="Not clear? Note what needs clarifying..." value={drafts['cl'+j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['cl'+j.id]: e.target.value }))} />
              <button style={sbtn('#f97316')} onClick={() => sendForClarify(j)}>SEND BACK TO RAISER</button>
            </div>
          </div>
        )}

        {/* clarify → raiser updates and resubmits */}
        {j.status === 'clarify' && isRaiser && (
          <div style={{ background:'#f9731610', border:'1px solid #f9731644', borderRadius:6, padding:8, marginTop:6 }}>
            <div style={{ fontSize:9, fontWeight:700, color:'#f97316', letterSpacing:1, marginBottom:4 }}>MANAGER NEEDS CLARIFICATION — UPDATE & RESUBMIT</div>
            <label style={lb}>Short Description</label>
            <input style={inp} value={drafts['sd'+j.id] ?? j.description} onChange={e => setDrafts(p => ({ ...p, ['sd'+j.id]: e.target.value }))} />
            <label style={{ ...lb, marginTop:4 }}>Detailed Description</label>
            <textarea style={txa} value={drafts['ld'+j.id] ?? j.long_desc} onChange={e => setDrafts(p => ({ ...p, ['ld'+j.id]: e.target.value }))} />
            <button style={{ ...btn(), marginTop:6 }} onClick={() => resubmit(j)}>RESUBMIT JOB CARD</button>
          </div>
        )}

        {/* assigned → technician accepts (or manager records external start) */}
        {j.status === 'assigned' && isTech && (
          <div style={{ background:'#3b82f615', border:'1px solid #3b82f644', borderRadius:5, padding:8, marginTop:6 }}>
            <div style={{ fontSize:9, color:muted }}>{j.external ? 'External job with ' : 'Forwarded to '}<strong style={{ color:txt }}>{j.assigned_to}</strong> at {fmtT(j.assigned_at)} — awaiting {j.external ? 'work start' : 'acceptance'}</div>
            <button style={{ ...btn('#22c55e'), marginTop:6 }} onClick={async () => {
              await upJC(j.id, { status:'in_progress', accepted_at: new Date().toISOString() })
              await addLog(j.id, 'event', 'in_progress', j.assigned_to ?? actor, j.external ? 'External work started.' : 'Technician accepted the job card.')
            }}>{j.external ? 'MARK WORK STARTED' : 'ACCEPT JOB CARD'}</button>
            {!isBd && <div style={{ fontSize:8, color:dim, marginTop:2 }}>Timer starts on accept</div>}
          </div>
        )}

        {/* in_progress → work details, tools, spares */}
        {j.status === 'in_progress' && isTech && (
          <div style={{ marginTop:6 }}>
            <label style={lb}>Work Done</label>
            <textarea style={{ ...txa, minHeight:36 }} value={drafts['wd'+j.id] ?? j.work_done} onChange={e => setDrafts(p => ({ ...p, ['wd'+j.id]: e.target.value }))} onBlur={e => upJC(j.id, { work_done: e.target.value })} placeholder="Work carried out..." />
            <label style={{ ...lb, marginTop:4 }}>Root Cause</label>
            <textarea style={{ ...txa, minHeight:28 }} value={drafts['rc'+j.id] ?? j.root_cause} onChange={e => setDrafts(p => ({ ...p, ['rc'+j.id]: e.target.value }))} onBlur={e => upJC(j.id, { root_cause: e.target.value })} placeholder="Why did this fail?" />
            <label style={{ ...lb, marginTop:4 }}>Tools Used{j.external ? ' (required for external jobs)' : ''}</label>
            <textarea style={{ ...txa, minHeight:28 }} value={drafts['tl'+j.id] ?? j.tools_used} onChange={e => setDrafts(p => ({ ...p, ['tl'+j.id]: e.target.value }))} onBlur={e => upJC(j.id, { tools_used: e.target.value })} placeholder="Tools / equipment used on this job..." />

            {/* Spares & critical equipment — linked to stock register */}
            <div style={{ background:pnl, border:'1px solid '+brd, borderRadius:6, padding:8, marginTop:8 }}>
              <div style={{ fontSize:9, fontWeight:700, color:acc, letterSpacing:1, marginBottom:6 }}>SPARES / CRITICAL EQUIPMENT USED (UPDATES STOCK REGISTER)</div>
              {sps.map(s => (
                <div key={s.id} style={{ fontSize:10, marginBottom:3, display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ color:'#22c55e' }}>✓</span>
                  <span>{s.description} × {s.qty} ({s.from_stock})</span>
                  {s.is_critical && <Badge color="#ef4444">CRITICAL</Badge>}
                </div>
              ))}
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center', marginTop:4 }}>
                <select style={{ ...inp, width:200 }} value={spForm[j.id]?.partId ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], partId: e.target.value } }))}>
                  <option value="">From stock register…</option>
                  {stock.map(s => <option key={s.id} value={s.id}>{s.part_no} — {s.description} (new:{s.qty_new}/used:{s.qty_used})</option>)}
                </select>
                <input style={{ ...inp, width:140 }} placeholder="…or describe item" value={spForm[j.id]?.desc ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], desc: e.target.value } }))} />
                <input style={{ ...inp, width:46 }} type="number" min={1} placeholder="Qty" value={spForm[j.id]?.qty ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], qty: e.target.value } }))} />
                <select style={{ ...inp, width:70 }} value={spForm[j.id]?.from ?? 'new'} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], from: e.target.value } }))}><option value="new">New</option><option value="used">Used</option></select>
                <button style={sbtn(spForm[j.id]?.critical ? '#ef4444' : brd)} onClick={() => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], critical: !p[j.id]?.critical } }))}>CRITICAL</button>
                <button style={sbtn('#22c55e')} onClick={() => logSpare(j)}>+ LOG</button>
              </div>
            </div>

            <button style={{ ...btn('#22c55e'), marginTop:8 }} onClick={() => completeWork(j)}>
              {j.qc_required ? `COMPLETE — SEND TO QC${qcFor(j.area) ? ' ('+qcFor(j.area)+')' : ''}` : 'COMPLETE — SEND FOR VERIFICATION'}
            </button>
          </div>
        )}

        {/* qc_check → YES/NO/N/A, any YES bounces back to tech */}
        {j.status === 'qc_check' && isQc && (
          <div style={{ marginTop:6 }}>
            <div style={{ fontSize:10, color:'#8b5cf6', fontWeight:700, marginBottom:2 }}>QUALITY POST-MAINTENANCE CHECK</div>
            <div style={{ fontSize:9, color:muted, marginBottom:6 }}>Station QC for {j.area}: <strong style={{ color:txt }}>{qcFor(j.area) || 'not mapped — any QC on duty'}</strong></div>
            <div style={{ marginBottom:6 }}><label style={lb}>QC Officer Name</label><input style={inp} value={drafts['qn'+j.id] ?? j.qc_name ?? qcFor(j.area)} onChange={e => setDrafts(p => ({ ...p, ['qn'+j.id]: e.target.value }))} placeholder="Enter your name..." /></div>
            {QC_CHECKS.map((q, i) => {
              const v = normQc((j.qc_checks ?? [])[i] ?? 'na')
              const setV = (nv: QcAnswer) => { const c = QC_CHECKS.map((_, k) => normQc((j.qc_checks ?? [])[k] ?? 'na')); c[i] = nv; upJC(j.id, { qc_checks: c }) }
              return (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
                  <button style={{ ...sbtn(v === 'yes' ? '#ef4444' : brd), width:34, fontSize:8 }} onClick={() => setV('yes')}>YES</button>
                  <button style={{ ...sbtn(v === 'no' ? '#22c55e' : brd), width:32, fontSize:8 }} onClick={() => setV('no')}>NO</button>
                  <button style={{ ...sbtn(v === 'na' ? '#64748b' : brd), width:32, fontSize:8 }} onClick={() => setV('na')}>N/A</button>
                  <span style={{ fontSize:10 }}>{q}</span>
                </div>
              )
            })}
            {QC_CHECKS.some((_, i) => normQc((j.qc_checks ?? [])[i]) === 'yes') && (
              <div style={{ marginTop:6 }}>
                <label style={{ ...lb, color:'#ef4444' }}>QC Comment (required — card will return to the technician)</label>
                <textarea style={{ ...txa, minHeight:28, borderColor:'#ef4444' }} value={drafts['qf'+j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['qf'+j.id]: e.target.value }))} placeholder="Describe what failed the check..." />
              </div>
            )}
            <button style={{ ...btn('#8b5cf6'), marginTop:6 }} onClick={() => qcSubmit(j)}>SUBMIT QC CHECK</button>
          </div>
        )}

        {/* verify → originator signs off */}
        {j.status === 'verify' && isRaiser && (
          <div style={{ marginTop:6 }}>
            <div style={{ fontSize:10, color:'#06b6d4', fontWeight:700, marginBottom:6 }}>VERIFICATION BY ORIGINATOR ({j.raised_by})</div>
            <div style={{ fontSize:10, marginBottom:2 }}><strong>Work:</strong> {j.work_done || '—'}</div>
            <div style={{ fontSize:10, marginBottom:2 }}><strong>Root Cause:</strong> {j.root_cause || '—'}</div>
            {j.tools_used && <div style={{ fontSize:10, marginBottom:2 }}><strong>Tools:</strong> {j.tools_used}</div>}
            <div style={{ fontSize:10, marginBottom:2 }}><strong>Duration:</strong> {diffM(isBd ? j.raised_at : j.accepted_at, j.completed_at)} min</div>
            {j.qc_required && <div style={{ fontSize:10, marginBottom:6 }}><strong>QC by:</strong> {j.qc_name} at {fmtT(j.qc_done_at)}</div>}
            <div style={{ display:'flex', gap:6 }}>
              <button style={btn('#22c55e')} onClick={() => verifyCard(j, true)}>SATISFACTORY — CLOSE</button>
              <button style={btn('#ef4444')} onClick={() => verifyCard(j, false)}>NOT SATISFACTORY — RETURN TO TECH</button>
            </div>
          </div>
        )}

        {j.status === 'complete' && (
          <div style={{ marginTop:6, fontSize:10, display:'flex', gap:10, flexWrap:'wrap' }}>
            <span><strong>{j.external ? 'External' : 'Tech'}:</strong> {j.assigned_to ?? '—'}</span>
            <span><strong>Duration:</strong> {diffM(isBd ? j.raised_at : j.accepted_at, j.completed_at)} min</span>
            {j.qc_required && <span><strong>QC:</strong> {j.qc_name || '—'} {fmtT(j.qc_done_at)}</span>}
            <span><strong>Verified:</strong> {j.verified_ok ? <span style={{ color:'#22c55e' }}>OK</span> : <span style={{ color:'#ef4444' }}>Redo</span>}</span>
            {j.root_cause && <span><strong>Root Cause:</strong> {j.root_cause}</span>}
          </div>
        )}

        {/* Comments at every step + full log */}
        <div style={{ marginTop:8, borderTop:'1px solid '+brd+'22', paddingTop:6 }}>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input style={{ ...inp, flex:1 }} placeholder={`Comment as ${actor || displayName || '...'} (stage: ${j.status.replace(/_/g,' ')})`} value={drafts['cm'+j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['cm'+j.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') postComment(j) }} />
            <button style={sbtn()} onClick={() => postComment(j)}>POST</button>
            <button style={sbtn(brd)} onClick={() => setOpenLog(p => ({ ...p, [j.id]: !p[j.id] }))}>LOG ({lgs.length})</button>
          </div>
          {openLog[j.id] && (
            <div style={{ marginTop:6, maxHeight:220, overflowY:'auto' }}>
              {lgs.length === 0 && <div style={{ fontSize:9, color:dim }}>No log entries yet.</div>}
              {lgs.map(l => (
                <div key={l.id} style={{ fontSize:9, padding:'4px 8px', borderLeft:'2px solid '+(l.kind === 'comment' ? acc : brd), marginBottom:3, background:pnl, borderRadius:'0 4px 4px 0' }}>
                  <span style={{ color:dim }}>{fmtDT(l.created_at)}</span>{' '}
                  <Badge color={l.kind === 'comment' ? acc : '#64748b'}>{l.kind === 'comment' ? 'COMMENT' : 'EVENT'}</Badge>{' '}
                  <span style={{ color:muted }}>[{l.stage.replace(/_/g,' ')}]</span>{' '}
                  <strong style={{ color:txt }}>{l.author}</strong>: <span style={{ color: l.kind === 'comment' ? '#fbbf24' : muted }}>{l.body}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Planner week helpers ────────────────────────────────────────────────────
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(plannerWeekStart); d.setDate(d.getDate() + i); return d })
  const slotsFor = (tech: string, day: Date) => slots.filter(s => {
    const st = new Date(s.start_at)
    return s.technician === tech && st.getFullYear() === day.getFullYear() && st.getMonth() === day.getMonth() && st.getDate() === day.getDate()
  })

  return (
    <div style={{ background:bg, minHeight:'100%', color:txt, fontFamily:"'SF Mono','Menlo',monospace", fontSize:12 }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,'+pnl+',#1a1a2e)', padding:'14px 20px', borderBottom:'1px solid '+brd, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:800, color:acc, letterSpacing:2 }}>CAPE NATURAL TEA PRODUCTS</div>
          <div style={{ fontSize:9, color:muted, letterSpacing:2 }}>MAINTENANCE MANAGEMENT SYSTEM</div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          {duty ? <Badge color="#22c55e">ON DUTY: {duty.toUpperCase()}</Badge> : <Badge color="#ef4444">NO TECH ON DUTY</Badge>}
          <Badge color="#22c55e">FSSC 22000</Badge>
          <span style={{ fontSize:9, color:dim }}>{new Date().toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}</span>
        </div>
      </div>

      {error && <div style={{ background:'#ef444422', borderBottom:'1px solid #ef4444', padding:'8px 20px', fontSize:10, color:'#fca5a5' }}>{error}</div>}

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, background:pnl, padding:'6px 14px', borderBottom:'1px solid '+brd, overflowX:'auto' }}>
        {TABS.map((t, i) => <button key={i} style={tabBtn(tab === i)} onClick={() => { setTab(i); setSub(0) }}>{t}</button>)}
      </div>

      <div style={{ padding:16, maxWidth:1400, margin:'0 auto' }}>

        {/* ══ TAB 0: JOB CARDS ══ */}
        {tab === 0 && (
          <div>
            {/* RAISE JOB CARD — top of the tab, open to everyone */}
            <div style={{ ...card, borderColor: nj.workflow === 'breakdown' ? '#ef444466' : brd }}>
              <div style={ttl}>+ Raise Job Card</div>
              <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                <button style={{ ...btn(nj.workflow === 'breakdown' ? '#ef4444' : brd), flex:1, padding:'10px 0', fontSize:11 }} onClick={() => setNj(p => ({ ...p, workflow:'breakdown', type:[] }))}>🔴 BREAKDOWN — URGENT</button>
                <button style={{ ...btn(nj.workflow === 'planned' ? '#3b82f6' : brd), flex:1, padding:'10px 0', fontSize:11 }} onClick={() => setNj(p => ({ ...p, workflow:'planned' }))}>📋 SCHEDULED / PLANNED</button>
              </div>
              {nj.workflow === 'breakdown' && (
                <div style={{ background:'#ef444412', border:'1px solid #ef444444', borderRadius:6, padding:8, marginBottom:10, fontSize:10, color:'#fca5a5' }}>
                  Breakdown goes <strong>directly to the technician on duty</strong> ({duty ?? 'none on roster — manager will allocate'}) — the maintenance manager is informed. The job timer starts as soon as the card is raised.
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:8 }}>
                <div><label style={lb}>Your Name</label><input style={inp} value={nj.raisedBy} onChange={e => setNj(p => ({ ...p, raisedBy: e.target.value }))} placeholder="Type your name..." /></div>
                <div><label style={lb}>Area / Location</label><select style={inp} value={nj.area} onChange={e => setNj(p => ({ ...p, area: e.target.value }))}><option value="">Select area...</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select></div>
                <div><label style={lb}>Machine (optional)</label><input style={inp} value={nj.machine} onChange={e => setNj(p => ({ ...p, machine: e.target.value }))} placeholder="Machine name..." /></div>
              </div>
              {nj.workflow === 'planned' && (
                <div style={{ marginTop:8 }}><label style={lb}>Maintenance Type (select all that apply)</label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                    {PLANNED_TYPES.map(t => <button key={t} style={{ ...sbtn(nj.type.includes(t) ? acc : brd), fontSize:8 }} onClick={() => setNj(p => ({ ...p, type: p.type.includes(t) ? p.type.filter(x => x !== t) : [...p.type, t] }))}>{t}</button>)}
                  </div>
                </div>
              )}
              <div style={{ marginTop:8 }}><label style={lb}>Short Description of the Problem</label><input style={inp} value={nj.desc} onChange={e => setNj(p => ({ ...p, desc: e.target.value, aiSug: aiSuggest(e.target.value + ' ' + p.longDesc) }))} placeholder="One line — what is wrong?" /></div>
              <div style={{ marginTop:8 }}><label style={lb}>Detailed Description (optional — more detail about the job)</label><textarea style={txa} value={nj.longDesc} onChange={e => setNj(p => ({ ...p, longDesc: e.target.value, aiSug: aiSuggest(p.desc + ' ' + e.target.value) }))} placeholder="Anything else the technician should know..." /></div>
              <div style={{ display:'flex', gap:10, marginTop:8, alignItems:'flex-end', flexWrap:'wrap' }}>
                <div style={{ flex:1, minWidth:200 }}><label style={lb}>Photo</label>
                  <input ref={fRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return
                    try { const url = await downscalePhoto(f); setNj(p => ({ ...p, photo:url, aiSug: aiSuggest(f.name + ' ' + p.desc) })) }
                    catch { setPopup('Could not read photo') }
                  }} />
                  <div style={{ width:'100%', minHeight:42, background:pnl, border:'2px dashed '+brd, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:muted, fontSize:10 }} onClick={() => fRef.current?.click()}>
                    {nj.photo ? <img src={nj.photo} style={{ maxWidth:'100%', maxHeight:90, borderRadius:4 }} alt="" /> : 'Tap to upload photo'}
                  </div>
                </div>
                {nj.aiSug && <div style={{ flex:2, minWidth:220, background:acc+'11', border:'1px solid '+acc+'44', borderRadius:6, padding:8 }}>
                  <div style={{ fontSize:8, fontWeight:700, color:acc, letterSpacing:1 }}>AI SUGGESTION (FSSC22000)</div>
                  <div style={{ fontSize:11, color:'#fbbf24', marginTop:2 }}>{nj.aiSug}</div>
                </div>}
              </div>
              <button style={{ ...btn(nj.workflow === 'breakdown' ? '#ef4444' : acc), marginTop:10, width:'100%', padding:'10px 0', fontSize:12, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={createJC}>
                {saving ? 'SAVING…' : nj.workflow === 'breakdown' ? '🔴 RAISE BREAKDOWN — SEND TO ON-DUTY TECHNICIAN' : 'RAISE JOB CARD — SEND TO MAINTENANCE MANAGER'}
              </button>
            </div>

            {/* View switcher — to be locked to real user permissions later */}
            <div style={{ ...card, padding:10, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontSize:9, color:muted, letterSpacing:1 }}>VIEW AS</span>
              {([['manager','👔 Maintenance Manager'],['tech','🔧 Technician'],['qc','🧪 QC'],['raiser','🙋 Raised By Me']] as [View,string][]).map(([v, l]) => (
                <button key={v} style={tabBtn(view === v)} onClick={() => { setView(v); if (v === 'tech' && !TECHS.includes(actor)) setActor(TECHS[0]) }}>{l}</button>
              ))}
              {view === 'tech'
                ? <select style={{ ...inp, width:'auto' }} value={actor} onChange={e => setActor(e.target.value)}>{TECHS.map(t => <option key={t}>{t}</option>)}</select>
                : <input style={{ ...inp, width:150 }} value={actor} onChange={e => setActor(e.target.value)} placeholder="Acting as..." />}
              <span style={{ fontSize:8, color:dim }}>Views will be locked per user once technician/QC logins are created.</span>
            </div>

            {/* Manager subtabs */}
            {view === 'manager' && (
              <div style={{ display:'flex', gap:3, marginBottom:10 }}>
                {['Board','Planner (Technician Calendar)','Duty Roster & QC Map'].map((t, i) => <button key={i} style={tabBtn(jcSub === i)} onClick={() => setJcSub(i)}>{t}</button>)}
              </div>
            )}

            {/* ── MANAGER: BOARD ── */}
            {view === 'manager' && jcSub === 0 && (
              <div>
                {/* New job cards needing allocation — pops to the top */}
                {newCards.length > 0 && (
                  <div style={{ ...card, borderColor:'#eab308', background:'#eab30808' }}>
                    <div style={{ ...ttl, color:'#eab308' }}>🆕 New Job Cards — Awaiting Your Allocation ({newCards.length})</div>
                    {newCards.map(renderCard)}
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:10, marginBottom:14 }}>
                  {STATUSES.map(s => (
                    <div key={s} style={{ ...card, textAlign:'center', padding:10, marginBottom:0 }}>
                      <div style={{ fontSize:22, fontWeight:800, color:STATUS_COLOR[s] }}>{cnt(s)}</div>
                      <div style={{ fontSize:7, color:muted, letterSpacing:1, textTransform:'uppercase' }}>{s.replace(/_/g,' ')}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:3, marginBottom:10, flexWrap:'wrap' }}>
                  {['all', ...STATUSES].map(f => <button key={f} style={tabBtn(filt === f)} onClick={() => setFilt(f)}>{f === 'all' ? 'Active' : f.replace(/_/g,' ').toUpperCase()+' ('+cnt(f)+')'}</button>)}
                </div>
                {visibleCards.filter(j => j.status !== 'raised' || filt !== 'all').map(renderCard)}
                {/* Historical */}
                <div style={card}>
                  <div style={ttl}>Historical Job Cards (Last 20)</div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                      <thead><tr>{['#','Type','Area','Description','Tech','By','Raised','Closed','Days'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                      <tbody>{hist.map(j => {
                        const days = diffDays(j.raised_at, j.completed_at ?? j.verified_at)
                        return (
                          <tr key={j.id} style={{ background: days > 7 ? '#eab30808' : 'transparent' }}>
                            <td style={td}><strong style={{ color:acc }}>{j.card_no}</strong></td>
                            <td style={td}><Badge color={j.workflow === 'breakdown' ? '#ef4444' : '#3b82f6'}>{j.workflow === 'breakdown' ? 'BD' : 'PL'}</Badge></td>
                            <td style={td}>{j.area}</td>
                            <td style={{ ...td, maxWidth:220 }}>{j.description}</td>
                            <td style={td}>{j.assigned_to ?? '—'}</td>
                            <td style={td}>{j.raised_by}</td>
                            <td style={td}>{fmtD(j.raised_at)}</td>
                            <td style={td}>{fmtD(j.completed_at ?? j.verified_at)}</td>
                            <td style={{ ...td, fontWeight:700, color: days > 7 ? '#eab308' : '#22c55e' }}>{days}</td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── MANAGER: PLANNER ── */}
            {view === 'manager' && jcSub === 1 && (
              <div style={card}>
                <div style={ttl}>Technician Planner — Estimated Time Slots</div>
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'flex-end', marginBottom:12 }}>
                  <div><label style={lb}>Job Card</label>
                    <select style={{ ...inp, width:230 }} value={slotForm.cardId} onChange={e => setSlotForm(p => ({ ...p, cardId: e.target.value }))}>
                      <option value="">(no card — general slot)</option>
                      {openPlannedCards.map(c => <option key={c.id} value={c.id}>{c.card_no} — {c.area}: {c.description.slice(0,40)}</option>)}
                    </select>
                  </div>
                  <div><label style={lb}>Technician</label><select style={{ ...inp, width:110 }} value={slotForm.tech} onChange={e => setSlotForm(p => ({ ...p, tech: e.target.value }))}>{TECHS.map(t => <option key={t}>{t}</option>)}</select></div>
                  <div><label style={lb}>Date</label><input style={{ ...inp, width:130 }} type="date" value={slotForm.date} onChange={e => setSlotForm(p => ({ ...p, date: e.target.value }))} /></div>
                  <div><label style={lb}>Start</label><input style={{ ...inp, width:90 }} type="time" value={slotForm.time} onChange={e => setSlotForm(p => ({ ...p, time: e.target.value }))} /></div>
                  <div><label style={lb}>Est. Hours</label><input style={{ ...inp, width:60 }} type="number" min={0.5} step={0.5} value={slotForm.hours} onChange={e => setSlotForm(p => ({ ...p, hours: e.target.value }))} /></div>
                  <div style={{ flex:1, minWidth:120 }}><label style={lb}>Note</label><input style={inp} value={slotForm.note} onChange={e => setSlotForm(p => ({ ...p, note: e.target.value }))} placeholder="Optional note..." /></div>
                  <button style={btn('#22c55e')} onClick={addSlot}>+ SLOT</button>
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:8 }}>
                  <button style={sbtn(brd)} onClick={() => setPlannerWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}>← PREV</button>
                  <span style={{ fontSize:10, color:muted }}>Week of {fmtD(plannerWeekStart.toISOString())}</span>
                  <button style={sbtn(brd)} onClick={() => setPlannerWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}>NEXT →</button>
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:9 }}>
                    <thead><tr><th style={th}>Technician</th>{weekDays.map(d => <th key={d.toISOString()} style={th}>{d.toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short' })}</th>)}</tr></thead>
                    <tbody>{TECHS.map(t => (
                      <tr key={t}>
                        <td style={{ ...td, fontWeight:700 }}>{t}</td>
                        {weekDays.map(d => (
                          <td key={d.toISOString()} style={{ ...td, verticalAlign:'top', minWidth:110 }}>
                            {slotsFor(t, d).map(s => {
                              const c = jcs.find(x => x.id === s.card_id)
                              return (
                                <div key={s.id} style={{ background:'#3b82f618', border:'1px solid #3b82f644', borderRadius:4, padding:'3px 6px', marginBottom:3 }}>
                                  <div style={{ fontWeight:700, color:'#93c5fd' }}>{fmtT(s.start_at)}–{fmtT(s.end_at)}</div>
                                  {c && <div style={{ color:acc }}>{c.card_no}</div>}
                                  {(s.note || c) && <div style={{ color:muted }}>{s.note || c?.description.slice(0,30)}</div>}
                                  <button style={{ ...sbtn('#ef4444'), fontSize:7, padding:'1px 5px', marginTop:2 }} onClick={() => delSlot(s.id)}>✕</button>
                                </div>
                              )
                            })}
                          </td>
                        ))}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div style={{ fontSize:8, color:dim, marginTop:6 }}>Slots are estimates for planning — actual durations come from the job card timer.</div>
              </div>
            )}

            {/* ── MANAGER: ROSTER & QC MAP ── */}
            {view === 'manager' && jcSub === 2 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))', gap:14 }}>
                <div style={card}>
                  <div style={ttl}>Duty Roster — Breakdown Auto-Assign</div>
                  <div style={{ fontSize:9, color:muted, marginBottom:8 }}>A breakdown raised during a duty slot goes straight to that technician. Currently on duty: <strong style={{ color: duty ? '#22c55e' : '#ef4444' }}>{duty ?? 'NOBODY'}</strong></div>
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'flex-end', marginBottom:10 }}>
                    <div><label style={lb}>Technician</label><select style={{ ...inp, width:110 }} value={rosterForm.tech} onChange={e => setRosterForm(p => ({ ...p, tech: e.target.value }))}>{TECHS.map(t => <option key={t}>{t}</option>)}</select></div>
                    <div><label style={lb}>From</label><input style={{ ...inp, width:170 }} type="datetime-local" value={rosterForm.start} onChange={e => setRosterForm(p => ({ ...p, start: e.target.value }))} /></div>
                    <div><label style={lb}>To</label><input style={{ ...inp, width:170 }} type="datetime-local" value={rosterForm.end} onChange={e => setRosterForm(p => ({ ...p, end: e.target.value }))} /></div>
                    <button style={btn('#22c55e')} onClick={addRoster}>+ ADD</button>
                  </div>
                  {roster.filter(r => new Date(r.end_at).getTime() > Date.now() - 7*86400000).map(r => (
                    <div key={r.id} style={{ display:'flex', gap:8, alignItems:'center', fontSize:10, padding:'4px 8px', background:pnl, borderRadius:4, marginBottom:3 }}>
                      <strong style={{ width:80 }}>{r.technician}</strong>
                      <span style={{ color:muted, flex:1 }}>{fmtDT(r.start_at)} → {fmtDT(r.end_at)}</span>
                      <button style={{ ...sbtn('#ef4444'), fontSize:7 }} onClick={() => delRoster(r.id)}>✕</button>
                    </div>
                  ))}
                  {roster.length === 0 && <div style={{ fontSize:9, color:dim }}>No duty slots yet — breakdowns will wait for manager allocation until a roster exists.</div>}
                </div>
                <div style={card}>
                  <div style={ttl}>Station / Area → QC Officer Map</div>
                  <div style={{ fontSize:9, color:muted, marginBottom:8 }}>Completed jobs route to the QC mapped to their area for the post-maintenance check.</div>
                  <div style={{ maxHeight:420, overflowY:'auto' }}>
                    {AREAS.map(a => (
                      <div key={a} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:3 }}>
                        <span style={{ fontSize:9, width:170, color:muted }}>{a}</span>
                        <input style={{ ...inp, flex:1, fontSize:9, padding:'3px 8px' }} placeholder="QC officer name..."
                          value={drafts['aq'+a] ?? qcFor(a)}
                          onChange={e => setDrafts(p => ({ ...p, ['aq'+a]: e.target.value }))}
                          onBlur={e => { if ((drafts['aq'+a] ?? qcFor(a)) !== qcFor(a) || e.target.value !== qcFor(a)) saveAreaQc(a, e.target.value) }} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── TECHNICIAN VIEW ── */}
            {view === 'tech' && (
              <div>
                <div style={{ ...card, padding:10, fontSize:10, color:muted }}>
                  Showing job cards assigned to <strong style={{ color:txt }}>{actor}</strong> — {visibleCards.length} open. Breakdown cards run their timer from the moment they were raised.
                </div>
                {visibleCards.map(renderCard)}
                {visibleCards.length === 0 && <div style={{ ...card, color:dim, fontSize:10, textAlign:'center' }}>No open job cards assigned to {actor}.</div>}
              </div>
            )}

            {/* ── QC VIEW ── */}
            {view === 'qc' && (
              <div>
                <div style={{ ...card, padding:10, fontSize:10, color:muted }}>
                  Job cards awaiting QC post-maintenance checks. Your stations are highlighted — answer YES / NO / N/A; any YES returns the card to the technician with your comment.
                </div>
                {[...visibleCards].sort((a,b) => (qcFor(b.area) === actor ? 1 : 0) - (qcFor(a.area) === actor ? 1 : 0)).map(renderCard)}
                {visibleCards.length === 0 && <div style={{ ...card, color:dim, fontSize:10, textAlign:'center' }}>Nothing waiting for QC.</div>}
              </div>
            )}

            {/* ── RAISER DASHBOARD ── */}
            {view === 'raiser' && (
              <div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10, marginBottom:14 }}>
                  {[
                    ['Outstanding', visibleCards.filter(j => j.status !== 'complete').length, '#eab308'],
                    ['Needs My Input', visibleCards.filter(j => j.status === 'clarify' || j.status === 'verify').length, '#f97316'],
                    ['In Progress', visibleCards.filter(j => ['assigned','in_progress','qc_check'].includes(j.status)).length, '#3b82f6'],
                    ['Completed', visibleCards.filter(j => j.status === 'complete').length, '#22c55e'],
                  ].map(([l, n, c], i) => (
                    <div key={i} style={{ ...card, textAlign:'center', padding:12, marginBottom:0 }}>
                      <div style={{ fontSize:24, fontWeight:800, color:c as string }}>{n}</div>
                      <div style={{ fontSize:8, color:muted, letterSpacing:1, textTransform:'uppercase' }}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ ...card, padding:10, fontSize:10, color:muted }}>
                  Your job cards, <strong style={{ color:txt }}>{actor}</strong>. You see where each card is in the flow and its full log — actions appear when a card needs your clarification or final verification.
                </div>
                {visibleCards.map(renderCard)}
                {visibleCards.length === 0 && <div style={{ ...card, color:dim, fontSize:10, textAlign:'center' }}>No job cards raised by {actor}.</div>}
              </div>
            )}
          </div>
        )}

        {/* ══ TAB 1: SCHEDULED MAINTENANCE ══ */}
        {tab === 1 && (
          <div>
            <div style={{ display:'flex', gap:3, marginBottom:14 }}>
              {['Weekly','Monthly','Annual / Calibration'].map((t, i) => <button key={i} style={tabBtn(sub === i)} onClick={() => setSub(i)}>{t}</button>)}
            </div>

            {(sub === 0 || sub === 1) && (() => {
              const freq = sub === 0 ? 'weekly' : 'monthly'
              const period = freq === 'weekly' ? weekKey : moKey
              const list = templates.filter(t => t.frequency === freq)
              return (
                <div style={card}>
                  <div style={ttl}>{freq === 'weekly' ? 'Weekly Checklists (WC) — ' + weekKey : 'Monthly Checklists (MC) — ' + moKey}</div>
                  <div style={{ fontSize:10, color:muted, marginBottom:12 }}>
                    {freq === 'weekly'
                      ? 'Complete every week. Tap an area to expand the checklist. Progress is saved per week.'
                      : 'Full inspections per area, per the QM-FM checklist. Tap to expand. Each task has a fault selector and action notes. Progress is saved per month.'}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:10 }}>
                    {list.map(cl => {
                      const st = getComp(cl.id, period)?.task_states ?? {}
                      const doneN = cl.tasks.filter((_, i) => st[i]?.done).length
                      const done = doneN === cl.tasks.length
                      const isOpen = openCL === cl.id
                      return (
                        <div key={cl.id} style={{ ...card, marginBottom:0, cursor:'pointer', borderColor: done ? '#22c55e66' : doneN > 0 ? '#eab30866' : '#ef444444' }} onClick={() => setOpenCL(isOpen ? null : cl.id)}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <div><div style={{ fontSize:12, fontWeight:700 }}>{cl.area}</div><div style={{ fontSize:8, color:dim }}>{cl.doc_ref} • {cl.tasks.length} tasks</div></div>
                            <Badge color={done ? '#22c55e' : doneN > 0 ? '#eab308' : '#ef4444'}>{done ? 'DONE' : doneN > 0 ? doneN+'/'+cl.tasks.length : 'NOT STARTED'}</Badge>
                          </div>
                          {isOpen && <div style={{ marginTop:10, borderTop:'1px solid '+brd, paddingTop:8, maxHeight:400, overflowY:'auto' }} onClick={e => e.stopPropagation()}>
                            {cl.tasks.map((task, ti) => {
                              const s = st[ti] ?? {}
                              return (
                                <div key={ti} style={{ marginBottom:6 }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                    <div style={{ width:16, height:16, borderRadius:3, border:'1px solid '+brd, background: s.done ? '#22c55e' : 'transparent', cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#fff' }}
                                      onClick={() => toggleTask(cl, ti)}>
                                      {s.done && '✓'}
                                    </div>
                                    <span style={{ fontSize:10, color: s.done ? '#22c55e' : txt }}>{task}</span>
                                  </div>
                                  <div style={{ display:'flex', gap:4, marginTop:2, marginLeft:22 }}>
                                    {freq === 'monthly' && (
                                      <select style={{ ...inp, width:75, fontSize:8, padding:'2px 4px' }} value={s.fault ? 'YES' : 'NO'} onChange={e => setTaskField(cl, ti, 'fault', e.target.value === 'YES')}>
                                        <option value="NO">No Fault</option><option value="YES">Fault</option>
                                      </select>
                                    )}
                                    <input style={{ ...inp, flex:1, fontSize:9, padding:'2px 6px' }} placeholder="Action needed / notes..."
                                      value={drafts['t'+cl.id+'-'+ti] ?? s.notes ?? ''}
                                      onChange={e => setDrafts(p => ({ ...p, ['t'+cl.id+'-'+ti]: e.target.value }))}
                                      onBlur={e => setTaskField(cl, ti, 'notes', e.target.value)} />
                                  </div>
                                </div>
                              )
                            })}
                            <div style={{ marginTop:8 }}><label style={lb}>Comments</label>
                              <textarea style={{ ...txa, minHeight:28 }}
                                value={drafts['c'+cl.id] ?? getComp(cl.id, period)?.comments ?? ''}
                                onChange={e => setDrafts(p => ({ ...p, ['c'+cl.id]: e.target.value }))}
                                onBlur={e => saveComp(cl, { comments: e.target.value })}
                                placeholder="General comments..." />
                            </div>
                            {!done && <button style={{ ...btn('#ef4444'), marginTop:6, fontSize:9 }} onClick={() => setPopup(cl.area + ': ' + (cl.tasks.length - doneN) + ' task(s) still outstanding! Please finish the remaining items.')}>CHECK MISSING ITEMS</button>}
                          </div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {sub === 2 && <div style={card}>
              <div style={ttl}>Annual / Calibration / Verification</div>
              <div style={{ fontSize:10, color:muted, marginBottom:12 }}>Boiler: 180 days warning. Others: 60, 30, 7, 1 day alerts. Email supplier directly.</div>
              {annualRows.filter(a => a.days <= 60).map(a => (
                <div key={a.id} style={{ background:calCol(a.days)+'12', border:'1px solid '+calCol(a.days)+'44', borderRadius:6, padding:'8px 12px', marginBottom:6, display:'flex', alignItems:'center', gap:8, fontSize:11 }}>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:calCol(a.days), flexShrink:0 }} />
                  <div style={{ flex:1 }}><strong>{a.asset}</strong> — {a.days <= 0 ? 'OVERDUE by '+Math.abs(a.days)+' days' : 'Due in '+a.days+' days'}</div>
                  <Badge color={calCol(a.days)}>{calBadge(a.days)}</Badge>
                </div>
              ))}
              <div style={{ overflowX:'auto', marginTop:12 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                  <thead><tr>{['Status','Category','Asset','Serial','Supplier','Due','Days','Email','Notes'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{annualRows.map(a => (
                    <tr key={a.id} style={{ background: a.days <= 0 ? '#ef444410' : a.days <= 30 ? '#eab30808' : 'transparent' }}>
                      <td style={td}><Badge color={calCol(a.days)}>{calBadge(a.days)}</Badge></td>
                      <td style={td}><Badge color={a.category === 'Calibration' ? '#3b82f6' : a.category === 'YPM' ? acc : a.category === 'Inspection' ? '#8b5cf6' : '#22c55e'}>{a.category}</Badge></td>
                      <td style={{ ...td, fontWeight:600 }}>{a.asset}</td>
                      <td style={{ ...td, fontFamily:'monospace', fontSize:9 }}>{a.serial_no || '—'}</td>
                      <td style={td}>{a.supplier}</td>
                      <td style={td}>{fmtD(a.next_due)}</td>
                      <td style={{ ...td, fontWeight:700, color:calCol(a.days) }}>{a.days}</td>
                      <td style={td}>{a.supplier !== 'Internal' && <button style={sbtn('#3b82f6')} onClick={() => setPopup('Draft Email to '+a.supplier+':\n\nSubject: '+a.category+' Due — '+a.asset+'\n\nDear '+a.supplier+',\n\nPlease schedule '+a.category.toLowerCase()+' for:\nAsset: '+a.asset+'\nSerial: '+a.serial_no+'\nDue: '+fmtD(a.next_due)+'\n\nPlease confirm.\n\nRegards,\nCNTP Maintenance')}>Email</button>}</td>
                      <td style={td}><input style={{ ...inp, fontSize:9, padding:'2px 6px', width:100 }} placeholder="Notes..."
                        value={drafts['a'+a.id] ?? a.notes}
                        onChange={e => setDrafts(p => ({ ...p, ['a'+a.id]: e.target.value }))}
                        onBlur={e => saveAnnualNotes(a.id, e.target.value)} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>}
          </div>
        )}

        {/* ══ TAB 2: STOCK ══ */}
        {tab === 2 && (
          <div>
            <div style={card}>
              <div style={ttl}>Spare Parts Register</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                  <thead><tr>{['Part #','Type','Description','New','Used','Total','Status'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{stock.map(r => {
                    const total = r.qty_new + r.qty_used
                    return (
                      <tr key={r.id}>
                        <td style={{ ...td, fontFamily:'monospace', fontSize:9 }}>{r.part_no}</td>
                        <td style={td}><Badge color="#3b82f6">{r.class}</Badge></td>
                        <td style={{ ...td, fontWeight:500 }}>{r.description}</td>
                        <td style={{ ...td, color:'#22c55e', fontWeight:700 }}>{r.qty_new}</td>
                        <td style={{ ...td, color:'#eab308', fontWeight:700 }}>{r.qty_used}</td>
                        <td style={{ ...td, fontWeight:700 }}>{total}</td>
                        <td style={td}><Badge color={total === 0 ? '#ef4444' : total <= 2 ? '#eab308' : '#22c55e'}>{total === 0 ? 'OUT' : total <= 2 ? 'LOW' : 'OK'}</Badge></td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </div>

            <div style={card}>
              <div style={ttl}>Spares Usage Log (from Job Cards)</div>
              <div style={{ fontSize:9, color:muted, marginBottom:8 }}>Every spare or critical part logged by technicians on job cards — stock above is decremented automatically.</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                  <thead><tr>{['Date','Job Card','Item','Qty','Stock','Critical','Logged By'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{sparesUsed.slice(0, 30).map(s => {
                    const c = jcs.find(j => j.id === s.card_id)
                    return (
                      <tr key={s.id}>
                        <td style={td}>{fmtD(s.created_at)}</td>
                        <td style={td}><strong style={{ color:acc }}>{c?.card_no ?? '—'}</strong></td>
                        <td style={td}>{s.description}</td>
                        <td style={{ ...td, fontWeight:700 }}>{s.qty}</td>
                        <td style={td}><Badge color={s.from_stock === 'new' ? '#22c55e' : '#eab308'}>{s.from_stock.toUpperCase()}</Badge></td>
                        <td style={td}>{s.is_critical ? <Badge color="#ef4444">CRITICAL</Badge> : '—'}</td>
                        <td style={td}>{s.logged_by || '—'}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
                {sparesUsed.length === 0 && <div style={{ fontSize:9, color:dim, padding:8 }}>No spares logged on job cards yet.</div>}
              </div>
            </div>

            <div style={card}>
              <div style={ttl}>Offsite Equipment Tracking</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                  <thead><tr>{['Item','Sent To','Date','Days Out','Status'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{offsite.map(o => {
                    const days = o.date_sent ? Math.floor((Date.now() - new Date(o.date_sent).getTime()) / 86400000) : 0
                    const col = days > 14 ? '#eab308' : days > 7 ? '#3b82f6' : '#22c55e'
                    return (
                      <tr key={o.id}>
                        <td style={td}>{o.item}</td>
                        <td style={td}>{o.sent_to}</td>
                        <td style={td}>{fmtD(o.date_sent)}</td>
                        <td style={{ ...td, color:col, fontWeight:700 }}>{days}</td>
                        <td style={td}><Badge color={col}>{o.status}</Badge></td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB 3: ANALYTICS (computed from live data) ══ */}
        {tab === 3 && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:14 }}>
              {[
                [String(jcs.length), 'JOB CARDS LOGGED', '#3b82f6'],
                [String(jcs.filter(j => j.workflow === 'breakdown').length), 'BREAKDOWNS', '#ef4444'],
                [(totalMins/60).toFixed(1)+' hrs', 'RECORDED REPAIR TIME', '#eab308'],
                [avgCloseDays+' days', 'AVG TIME TO CLOSE', '#06b6d4'],
                [String(reopens), 'QC / VERIFY REOPENS', '#f97316'],
                [jcs.length ? Math.round(completed.length / jcs.length * 100)+'%' : '—', 'COMPLETION RATE', '#22c55e'],
              ].map(([v, l, c], i) => (
                <div key={i} style={{ ...card, textAlign:'center', marginBottom:0 }}><div style={{ fontSize:24, fontWeight:800, color:c as string }}>{v}</div><div style={{ fontSize:8, color:muted }}>{l}</div></div>
              ))}
            </div>
            <div style={card}>
              <div style={ttl}>Job Cards by Area</div>
              {areaCounts.map(([area, n]) => (
                <div key={area} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, padding:'8px 10px', background:pnl, borderRadius:5 }}>
                  <div style={{ width:160, fontSize:10, fontWeight:600 }}>{area}</div>
                  <div style={{ flex:1, height:6, background:brd, borderRadius:3, overflow:'hidden' }}><div style={{ height:'100%', width:Math.min(100, n / (areaCounts[0]?.[1] || 1) * 100)+'%', borderRadius:3, background: n >= 4 ? '#ef4444' : n >= 2 ? '#eab308' : '#22c55e' }} /></div>
                  <div style={{ width:30, fontSize:13, fontWeight:800, color: n >= 4 ? '#ef4444' : n >= 2 ? '#eab308' : '#22c55e' }}>{n}</div>
                </div>
              ))}
            </div>
            <div style={card}>
              <div style={ttl}>Workload by Technician</div>
              {techCounts.map(({ t, n }) => (
                <div key={t} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, padding:'8px 10px', background:pnl, borderRadius:5 }}>
                  <div style={{ width:110, fontSize:10, fontWeight:600 }}>{t}</div>
                  <div style={{ flex:1, height:6, background:brd, borderRadius:3, overflow:'hidden' }}><div style={{ height:'100%', width:Math.min(100, n / (techCounts[0]?.n || 1) * 100)+'%', borderRadius:3, background:'#3b82f6' }} /></div>
                  <div style={{ width:30, fontSize:13, fontWeight:800, color:'#3b82f6' }}>{n}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* POPUP */}
      {popup && (
        <div style={{ position:'fixed', inset:0, background:'#000b', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setPopup(null)}>
          <div style={{ ...card, width:420, maxWidth:'90vw', whiteSpace:'pre-wrap' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:12, lineHeight:1.6 }}>{popup}</div>
            <button style={{ ...btn(), marginTop:10 }} onClick={() => setPopup(null)}>CLOSE</button>
          </div>
        </div>
      )}
    </div>
  )
}

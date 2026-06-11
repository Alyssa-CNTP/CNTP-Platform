'use client'

// app/(app)/maintenance/page.tsx
// Maintenance Management System — replica of the approved design mockup.
// Own section (not Quality). Data lives in the dedicated `maintenance` schema:
// job_cards, checklist_templates, checklist_completions, annual_items,
// spare_parts, offsite_equipment.
//
// Job card workflow: raised → assigned (forwarded by maintenance manager)
// → in_progress (tech accepts, timer starts) → qc_check (quality post-check)
// → verify (originator sign-off) → complete.

import { useState, useEffect, useRef, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'

// ─── Constants (from QM forms / design) ───────────────────────────────────────

const AREAS = ['Sieving Tower','Pasteurizer','Granules - RB','Refining 1','Refining 2','Diamond Blender','Rosehips Crusher','Rosehips Cutter','Rosehips Hammer Mill','Rosehips Blending','Rosehips Granules','Vacuum Packing','Pallet Wrapper','Stitching Machine','Facility','Boiler Room','Workshop','Lab','Reception','Admin Office','Chemical Room','Stores','Unit 1','Unit 2','Unit 3 Blender','Production Staff Male','Production Staff Female','Quality Office','Forklift Charging','Outside Back','Outside Front','Factory']
const TECHS = ['Shane','Mohapi','John','Yamkela','Melikhaya']
const MAINT_TYPES = ['Breakdown','Planned Maintenance','Safety Related','Engineering','Repair','Temporary Repair','Improvement','Audit/Inspection Finding']
const QC_CHECKS = ['Any loose screws visible?','Any spares, equipment or foreign objects left behind?','Any oil or grease spillages present or visible on the machine/equipment?','Any water leakages, spillages or poor housekeeping present?','Any loose or missing machine cover plates/end-guards?','Any reason why the machine is not safe for work?']

const STATUSES = ['raised','assigned','in_progress','qc_check','verify','complete'] as const
type Status = typeof STATUSES[number]
const STATUS_COLOR: Record<Status,string> = { raised:'#eab308', assigned:'#3b82f6', in_progress:'#fbbf24', qc_check:'#8b5cf6', verify:'#06b6d4', complete:'#22c55e' }

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobCard {
  id: number; card_no: string; area: string; machine: string|null
  maint_types: string[]; description: string; raised_by: string; raised_at: string
  status: Status; assigned_to: string|null; assigned_at: string|null
  accepted_at: string|null; completed_at: string|null
  work_done: string; root_cause: string
  qc_checks: boolean[]; qc_name: string; qc_done_at: string|null
  verified_at: string|null; verified_ok: boolean|null
  photo_url: string|null; ai_suggestion: string; comments: string
}
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

const fmtD = (d: string|null) => (d ? new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' }) : '—')
const fmtT = (d: string|null) => (d ? new Date(d).toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' }) : '—')
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

// Downscale photo to keep stored data URLs small
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
  const [sub, setSub] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [jcs, setJcs] = useState<JobCard[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [completions, setCompletions] = useState<Completion[]>([])
  const [annual, setAnnual] = useState<AnnualItem[]>([])
  const [stock, setStock] = useState<SparePart[]>([])
  const [offsite, setOffsite] = useState<Offsite[]>([])

  const [nj, setNj] = useState({ area:'', machine:'', type:[] as string[], desc:'', raisedBy:'', photo:null as string|null, aiSug:'' })
  const [filt, setFilt] = useState('all')
  const [openCL, setOpenCL] = useState<number|null>(null)
  const [popup, setPopup] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  // Local drafts for free-text fields, persisted on blur
  const [drafts, setDrafts] = useState<Record<string,string>>({})
  const fRef = useRef<HTMLInputElement>(null)

  const weekKey = isoWeekKey()
  const moKey = monthKey()

  // ── Load everything ──
  const loadAll = useCallback(async () => {
    try {
      const m = db.schema('maintenance')
      const [jc, tpl, comp, ann, stk, off] = await Promise.all([
        m.from('job_cards').select('*').order('raised_at', { ascending:false }),
        m.from('checklist_templates').select('*').eq('active', true).order('sort_order'),
        m.from('checklist_completions').select('*').in('period_key', [weekKey, moKey]),
        m.from('annual_items').select('*').eq('active', true).order('next_due'),
        m.from('spare_parts').select('*').order('part_no'),
        m.from('offsite_equipment').select('*').is('returned_at', null).order('date_sent'),
      ])
      const firstErr = [jc, tpl, comp, ann, stk, off].find(r => r.error)
      if (firstErr?.error) throw firstErr.error
      setJcs(jc.data ?? []); setTemplates(tpl.data ?? []); setCompletions(comp.data ?? [])
      setAnnual(ann.data ?? []); setStock(stk.data ?? []); setOffsite(off.data ?? [])
      setError('')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load maintenance data')
    } finally {
      setLoading(false)
    }
  }, [weekKey, moKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])

  // ── Job card mutations ──
  const upJC = async (id: number, u: Partial<JobCard>) => {
    setJcs(p => p.map(j => (j.id === id ? { ...j, ...u } : j)))
    const { error:err } = await db.schema('maintenance').from('job_cards')
      .update({ ...u, updated_at: new Date().toISOString() }).eq('id', id)
    if (err) setPopup('Save failed: ' + err.message)
  }

  const createJC = async () => {
    if (!nj.area || !nj.desc || !nj.raisedBy) { setPopup('Please fill in your name, the area and a description.'); return }
    setSaving(true)
    const { data, error:err } = await db.schema('maintenance').from('job_cards').insert({
      area: nj.area, machine: nj.machine || null, maint_types: nj.type, description: nj.desc,
      raised_by: nj.raisedBy, photo_url: nj.photo, ai_suggestion: nj.aiSug,
    }).select().single()
    setSaving(false)
    if (err) { setPopup('Could not raise job card: ' + err.message); return }
    setJcs(p => [data, ...p])
    setNj({ area:'', machine:'', type:[], desc:'', raisedBy: nj.raisedBy, photo:null, aiSug:'' })
  }

  // ── Checklist persistence (one record per template per period) ──
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
    // optimistic local update
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

  // ── Derived ──
  const active = jcs.filter(j => j.status !== 'complete' || (j.completed_at && diffDays(j.completed_at, new Date().toISOString()) <= 14))
  const hist = jcs.filter(j => j.status === 'complete').slice(0, 20)
  const cnt = (s: string) => jcs.filter(j => j.status === s).length
  const filtered = filt === 'all' ? active : jcs.filter(j => j.status === filt)
  const annualRows = annual.map(a => ({ ...a, days: daysUntil(a.next_due) })).sort((a,b) => a.days - b.days)

  // Analytics from real job card data
  const completed = jcs.filter(j => j.status === 'complete')
  const totalMins = completed.reduce((s,j) => s + diffM(j.accepted_at, j.completed_at), 0)
  const avgCloseDays = completed.length ? (completed.reduce((s,j) => s + diffDays(j.raised_at, j.completed_at ?? j.verified_at), 0) / completed.length).toFixed(1) : '0'
  const techCounts = TECHS.map(t => ({ t, n: jcs.filter(j => j.assigned_to === t).length })).sort((a,b) => b.n - a.n)
  const areaCounts = Object.entries(jcs.reduce((m:Record<string,number>, j) => { m[j.area] = (m[j.area] ?? 0) + 1; return m }, {})).sort((a,b) => b[1] - a[1]).slice(0, 8)

  const TABS = ['🔧 Job Cards', '📅 Scheduled Maintenance', '📦 Stock & Spares', '📊 Analytics']

  if (loading) return <div style={{ background:bg, minHeight:'100%', color:muted, fontFamily:"'SF Mono','Menlo',monospace", padding:40, fontSize:11, letterSpacing:2 }}>LOADING MAINTENANCE SYSTEM…</div>

  return (
    <div style={{ background:bg, minHeight:'100%', color:txt, fontFamily:"'SF Mono','Menlo',monospace", fontSize:12 }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,'+pnl+',#1a1a2e)', padding:'14px 20px', borderBottom:'1px solid '+brd, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:800, color:acc, letterSpacing:2 }}>CAPE NATURAL TEA PRODUCTS</div>
          <div style={{ fontSize:9, color:muted, letterSpacing:2 }}>MAINTENANCE MANAGEMENT SYSTEM</div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
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
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, marginBottom:16 }}>
              {STATUSES.map(s => (
                <div key={s} style={{ ...card, textAlign:'center', padding:12, marginBottom:0 }}>
                  <div style={{ fontSize:24, fontWeight:800, color:STATUS_COLOR[s] }}>{cnt(s)}</div>
                  <div style={{ fontSize:8, color:muted, letterSpacing:1, textTransform:'uppercase' }}>{s.replace(/_/g,' ')}</div>
                </div>
              ))}
            </div>

            {/* Historical */}
            <div style={{ ...card, marginTop:14 }}>
              <div style={ttl}>Historical Job Cards (Last 20 from Database)</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                  <thead><tr>{['#','Area','Description','Tech','By','Raised','Closed','Days'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{hist.map(j => {
                    const days = diffDays(j.raised_at, j.completed_at ?? j.verified_at)
                    return (
                      <tr key={j.id} style={{ background: days > 7 ? '#eab30808' : 'transparent' }}>
                        <td style={td}><strong style={{ color:acc }}>{j.card_no}</strong></td>
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

            <div style={{ display:'grid', gridTemplateColumns:'minmax(300px,380px) 1fr', gap:14, alignItems:'start' }}>
              {/* New Job Card */}
              <div style={card}>
                <div style={ttl}>+ New Job Card</div>
                <div style={{ marginBottom:8 }}><label style={lb}>Your Name</label><input style={inp} value={nj.raisedBy} onChange={e => setNj(p => ({ ...p, raisedBy: e.target.value }))} placeholder="Type your name..." /></div>
                <div style={{ marginBottom:8 }}><label style={lb}>Area / Location</label><select style={inp} value={nj.area} onChange={e => setNj(p => ({ ...p, area: e.target.value }))}><option value="">Select area...</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select></div>
                <div style={{ marginBottom:8 }}><label style={lb}>Machine (optional)</label><input style={inp} value={nj.machine} onChange={e => setNj(p => ({ ...p, machine: e.target.value }))} placeholder="Machine name..." /></div>
                <div style={{ marginBottom:8 }}><label style={lb}>Maintenance Type</label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                    {MAINT_TYPES.map(t => <button key={t} style={{ ...sbtn(nj.type.includes(t) ? acc : brd), fontSize:8 }} onClick={() => setNj(p => ({ ...p, type: p.type.includes(t) ? p.type.filter(x => x !== t) : [...p.type, t] }))}>{t}</button>)}
                  </div>
                </div>
                <div style={{ marginBottom:8 }}><label style={lb}>Description</label><textarea style={txa} value={nj.desc} onChange={e => setNj(p => ({ ...p, desc: e.target.value, aiSug: aiSuggest(e.target.value) }))} placeholder="Describe the issue..." /></div>
                <div style={{ marginBottom:8 }}><label style={lb}>Photo</label>
                  <input ref={fRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return
                    try { const url = await downscalePhoto(f); setNj(p => ({ ...p, photo:url, aiSug: aiSuggest(f.name + ' ' + p.desc) })) }
                    catch { setPopup('Could not read photo') }
                  }} />
                  <div style={{ width:'100%', minHeight:50, background:pnl, border:'2px dashed '+brd, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:muted, fontSize:10 }} onClick={() => fRef.current?.click()}>
                    {nj.photo ? <img src={nj.photo} style={{ maxWidth:'100%', maxHeight:100, borderRadius:4 }} alt="" /> : 'Tap to upload photo'}
                  </div>
                </div>
                {nj.aiSug && <div style={{ background:acc+'11', border:'1px solid '+acc+'44', borderRadius:6, padding:8, marginTop:4 }}>
                  <div style={{ fontSize:8, fontWeight:700, color:acc, letterSpacing:1 }}>AI SUGGESTION (FSSC22000)</div>
                  <div style={{ fontSize:11, color:'#fbbf24', marginTop:2 }}>{nj.aiSug}</div>
                </div>}
                <button style={{ ...btn(), marginTop:10, width:'100%', opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={createJC}>{saving ? 'SAVING…' : 'RAISE JOB CARD'}</button>
              </div>

              {/* Active Cards */}
              <div>
                <div style={{ display:'flex', gap:3, marginBottom:10, flexWrap:'wrap' }}>
                  {['all', ...STATUSES].map(f => <button key={f} style={tabBtn(filt === f)} onClick={() => setFilt(f)}>{f === 'all' ? 'Active ('+active.length+')' : f.replace(/_/g,' ').toUpperCase()+' ('+cnt(f)+')'}</button>)}
                </div>
                {filtered.map(j => (
                  <div key={j.id} style={{ ...card, borderLeft:'3px solid '+STATUS_COLOR[j.status] }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, flexWrap:'wrap', gap:4 }}>
                      <div><strong style={{ color:acc, fontSize:13 }}>{j.card_no}</strong> <Badge color={STATUS_COLOR[j.status]}>{j.status.replace(/_/g,' ').toUpperCase()}</Badge> {j.maint_types?.map(t => <span key={t} style={{ marginLeft:4 }}><Badge color="#64748b">{t}</Badge></span>)}</div>
                      <span style={{ fontSize:9, color:dim }}>{fmtD(j.raised_at)} {fmtT(j.raised_at)}</span>
                    </div>
                    <div style={{ fontSize:11, marginBottom:4 }}><strong>{j.area}</strong>{j.machine ? ' → '+j.machine : ''} • Raised by <strong>{j.raised_by}</strong></div>
                    <div style={{ fontSize:10, color:muted, marginBottom:6 }}>{j.description}</div>
                    {j.photo_url && <img src={j.photo_url} style={{ maxHeight:120, borderRadius:5, marginBottom:6 }} alt="" />}
                    {j.ai_suggestion && <div style={{ background:acc+'11', border:'1px solid '+acc+'33', borderRadius:5, padding:5, marginBottom:6, fontSize:10 }}><span style={{ color:acc, fontWeight:700, fontSize:8 }}>AI: </span><span style={{ color:'#fbbf24' }}>{j.ai_suggestion}</span></div>}

                    {/* raised → maintenance manager forwards to a technician */}
                    {j.status === 'raised' && <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:6, flexWrap:'wrap' }}>
                      <select style={{ ...inp, width:'auto' }} value={j.assigned_to ?? ''} onChange={e => setJcs(p => p.map(x => x.id === j.id ? { ...x, assigned_to: e.target.value || null } : x))}><option value="">Assign to...</option>{TECHS.map(t => <option key={t}>{t}</option>)}</select>
                      <button style={{ ...btn('#3b82f6'), opacity: j.assigned_to ? 1 : 0.5 }} disabled={!j.assigned_to} onClick={() => upJC(j.id, { status:'assigned', assigned_to: j.assigned_to, assigned_at: new Date().toISOString() })}>FORWARD</button>
                    </div>}

                    {/* assigned → tech is prompted to accept */}
                    {j.status === 'assigned' && <div style={{ marginTop:6 }}>
                      <div style={{ background:'#3b82f615', border:'1px solid #3b82f644', borderRadius:5, padding:8 }}>
                        <div style={{ fontSize:9, color:muted }}>Forwarded to <strong style={{ color:txt }}>{j.assigned_to}</strong> at {fmtT(j.assigned_at)} — awaiting acceptance</div>
                        <button style={{ ...btn('#22c55e'), marginTop:6 }} onClick={() => upJC(j.id, { status:'in_progress', accepted_at: new Date().toISOString() })}>ACCEPT JOB CARD</button>
                        <div style={{ fontSize:8, color:dim, marginTop:2 }}>Timer starts on accept</div>
                      </div>
                    </div>}

                    {j.status === 'in_progress' && <div style={{ marginTop:6 }}>
                      <div style={{ display:'flex', gap:12, alignItems:'flex-start', flexWrap:'wrap' }}>
                        <div><div style={{ fontSize:8, color:muted }}>TIME ELAPSED</div><Timer start={j.accepted_at} /></div>
                        <div style={{ flex:1, minWidth:200 }}>
                          <label style={lb}>Work Done</label>
                          <textarea style={{ ...txa, minHeight:36 }} value={drafts['wd'+j.id] ?? j.work_done} onChange={e => setDrafts(p => ({ ...p, ['wd'+j.id]: e.target.value }))} onBlur={e => upJC(j.id, { work_done: e.target.value })} placeholder="Work carried out..." />
                          <label style={{ ...lb, marginTop:4 }}>Root Cause</label>
                          <textarea style={{ ...txa, minHeight:28 }} value={drafts['rc'+j.id] ?? j.root_cause} onChange={e => setDrafts(p => ({ ...p, ['rc'+j.id]: e.target.value }))} onBlur={e => upJC(j.id, { root_cause: e.target.value })} placeholder="Why did this fail?" />
                        </div>
                      </div>
                      <button style={{ ...btn('#22c55e'), marginTop:6 }} onClick={() => upJC(j.id, { status:'qc_check', completed_at: new Date().toISOString(), work_done: drafts['wd'+j.id] ?? j.work_done, root_cause: drafts['rc'+j.id] ?? j.root_cause })}>COMPLETE — SEND TO QC</button>
                    </div>}

                    {j.status === 'qc_check' && <div style={{ marginTop:6 }}>
                      <div style={{ fontSize:10, color:'#8b5cf6', fontWeight:700, marginBottom:6 }}>QUALITY POST-MAINTENANCE CHECK</div>
                      <div style={{ marginBottom:6 }}><label style={lb}>QC Officer Name</label><input style={inp} value={drafts['qc'+j.id] ?? j.qc_name} onChange={e => setDrafts(p => ({ ...p, ['qc'+j.id]: e.target.value }))} onBlur={e => upJC(j.id, { qc_name: e.target.value })} placeholder="Enter your name..." /></div>
                      {QC_CHECKS.map((q, i) => <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                        <button style={{ ...sbtn(j.qc_checks?.[i] ? '#ef4444' : '#22c55e'), width:32, textAlign:'center', fontSize:8 }} onClick={() => { const c = [...(j.qc_checks ?? QC_CHECKS.map(() => false))]; c[i] = !c[i]; upJC(j.id, { qc_checks: c }) }}>{j.qc_checks?.[i] ? 'YES' : 'NO'}</button>
                        <span style={{ fontSize:10 }}>{q}</span>
                      </div>)}
                      <button style={{ ...btn('#8b5cf6'), marginTop:6, opacity:(drafts['qc'+j.id] ?? j.qc_name) ? 1 : 0.5 }} disabled={!(drafts['qc'+j.id] ?? j.qc_name)} onClick={() => upJC(j.id, { status:'verify', qc_name: drafts['qc'+j.id] ?? j.qc_name, qc_done_at: new Date().toISOString() })}>QC COMPLETE — SEND FOR VERIFICATION</button>
                    </div>}

                    {j.status === 'verify' && <div style={{ marginTop:6 }}>
                      <div style={{ fontSize:10, color:'#06b6d4', fontWeight:700, marginBottom:6 }}>VERIFICATION BY ORIGINATOR</div>
                      <div style={{ fontSize:10, marginBottom:2 }}><strong>Work:</strong> {j.work_done || '—'}</div>
                      <div style={{ fontSize:10, marginBottom:2 }}><strong>Root Cause:</strong> {j.root_cause || '—'}</div>
                      <div style={{ fontSize:10, marginBottom:2 }}><strong>Duration:</strong> {diffM(j.accepted_at, j.completed_at)} min</div>
                      <div style={{ fontSize:10, marginBottom:6 }}><strong>QC by:</strong> {j.qc_name} at {fmtT(j.qc_done_at)}</div>
                      <div style={{ display:'flex', gap:6 }}>
                        <button style={btn('#22c55e')} onClick={() => upJC(j.id, { status:'complete', verified_at: new Date().toISOString(), verified_ok: true })}>SATISFACTORY</button>
                        <button style={btn('#ef4444')} onClick={() => upJC(j.id, { status:'complete', verified_at: new Date().toISOString(), verified_ok: false })}>NOT SATISFACTORY</button>
                      </div>
                    </div>}

                    {j.status === 'complete' && <div style={{ marginTop:6, fontSize:10, display:'flex', gap:10, flexWrap:'wrap' }}>
                      <span><strong>Tech:</strong> {j.assigned_to ?? '—'}</span>
                      <span><strong>Duration:</strong> {diffM(j.accepted_at, j.completed_at)} min</span>
                      <span><strong>QC:</strong> {j.qc_name || '—'} {fmtT(j.qc_done_at)}</span>
                      <span><strong>Verified:</strong> {j.verified_ok ? <span style={{ color:'#22c55e' }}>OK</span> : <span style={{ color:'#ef4444' }}>Redo</span>}</span>
                      {j.root_cause && <span><strong>Root Cause:</strong> {j.root_cause}</span>}
                    </div>}

                    <div style={{ marginTop:8, borderTop:'1px solid '+brd+'22', paddingTop:6 }}>
                      <label style={lb}>Comments</label>
                      <textarea style={{ ...txa, minHeight:28 }} value={drafts['cm'+j.id] ?? j.comments} onChange={e => setDrafts(p => ({ ...p, ['cm'+j.id]: e.target.value }))} onBlur={e => upJC(j.id, { comments: e.target.value })} placeholder="Add comments..." />
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && <div style={{ ...card, color:dim, fontSize:10, textAlign:'center' }}>No job cards in this view.</div>}
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB 1: SCHEDULED MAINTENANCE ══ */}
        {tab === 1 && (
          <div>
            <div style={{ display:'flex', gap:3, marginBottom:14 }}>
              {['Weekly','Monthly','Annual / Calibration'].map((t, i) => <button key={i} style={tabBtn(sub === i)} onClick={() => setSub(i)}>{t}</button>)}
            </div>

            {/* WEEKLY + MONTHLY share rendering */}
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

            {/* ANNUAL */}
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

        {/* ══ TAB 3: ANALYTICS (computed from live job card data) ══ */}
        {tab === 3 && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:14 }}>
              {[
                [String(jcs.length), 'JOB CARDS LOGGED', '#3b82f6'],
                [(totalMins/60).toFixed(1)+' hrs', 'RECORDED REPAIR TIME', '#eab308'],
                [avgCloseDays+' days', 'AVG TIME TO CLOSE', '#06b6d4'],
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

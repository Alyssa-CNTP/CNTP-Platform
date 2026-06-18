'use client'

// lib/maintenance/useMaintenanceData.ts
// Owns every maintenance data array + form state, runs loadAll and ALL mutations
// verbatim from the original monolithic page, and exposes data / actions / derived
// selectors. Mounted once by the maintenance layout provider so all sub-routes
// share one data load (preserving cross-tab optimistic updates).

import { useState, useEffect, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { TECHS, QC_CHECKS, STATUSES } from './constants'
import { isoWeekKey, monthKey, normQc, diffM, diffDays, daysUntil, fmtDT, fmtT, workdayAdd, addDays, aiSuggest } from './helpers'
import type {
  JobCard, CardLog, SpareUsed, Roster, AreaQc, Slot,
  Template, Completion, AnnualItem, SparePart, Offsite, Status, QcAnswer, Staff,
  IpReading, DieselReading, LsLog, WaterReading, BoilerStart, EqConfig, EqHours, CalAsset, Machine,
} from './types'

// Fallback staff directory built from the hardcoded TECHS (id: null) until the
// live /api/maintenance/staff directory loads.
function fallbackStaff(): Staff[] {
  return TECHS.map(name => ({
    id: null,
    name,
    initials: name.split(/[\s_-]/).map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?',
  }))
}

export function useMaintenanceData() {
  const { displayName } = useAuth()
  const db = getDb()

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
  const [staff, setStaff] = useState<Staff[]>(fallbackStaff())
  // Readings & registers (Maintenance_Database.xlsx data, captured weekly)
  const [ipReadings, setIpReadings] = useState<IpReading[]>([])
  const [dieselReadings, setDieselReadings] = useState<DieselReading[]>([])
  const [lsLogs, setLsLogs] = useState<LsLog[]>([])
  const [waterReadings, setWaterReadings] = useState<WaterReading[]>([])
  const [boilerStarts, setBoilerStarts] = useState<BoilerStart[]>([])
  const [eqConfig, setEqConfig] = useState<EqConfig[]>([])
  const [eqHours, setEqHours] = useState<EqHours[]>([])
  const [calAssets, setCalAssets] = useState<CalAsset[]>([])
  const [machines, setMachines] = useState<Machine[]>([])

  // Acting-as name — defaults to the signed-in user; preserved from the original.
  const [actor, setActor] = useState('')

  // Shared UI/form state that mutations read or write.
  const [popup, setPopup] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [nj, setNj] = useState({ workflow: 'planned' as 'breakdown' | 'planned', area: '', machine: '', type: [] as string[], desc: '', longDesc: '', raisedBy: '', photo: null as string | null, aiSug: '' })
  const [alloc, setAlloc] = useState<Record<number, { tech?: string; techId?: string | null; external?: boolean; company?: string; qc?: boolean }>>({})
  const [spForm, setSpForm] = useState<Record<number, { partId?: string; desc?: string; qty?: string; from?: string; critical?: boolean }>>({})
  const [slotForm, setSlotForm] = useState({ cardId: '', tech: TECHS[0], techId: null as string | null, date: '', time: '08:00', hours: '2', note: '' })
  const [rosterForm, setRosterForm] = useState({ tech: TECHS[0], techId: null as string | null, start: '', end: '' })

  const weekKey = isoWeekKey()
  const moKey = monthKey()

  useEffect(() => { if (!actor && displayName) setActor(displayName) }, [displayName, actor])

  // ── Load everything ──
  const loadAll = useCallback(async () => {
    try {
      const m = db.schema('maintenance')
      const [jc, lg, sp, ro, aq, sl, tpl, comp, ann, stk, off, ipr, dsr, lsl, wtr, bst, ecf, eqh, cal, mac] = await Promise.all([
        m.from('job_cards').select('*').order('raised_at', { ascending: false }),
        m.from('job_card_logs').select('*').order('created_at'),
        m.from('job_card_spares').select('*').order('created_at', { ascending: false }),
        m.from('duty_roster').select('*').order('start_at'),
        m.from('area_qc').select('*'),
        m.from('tech_schedule').select('*').order('start_at'),
        m.from('checklist_templates').select('*').eq('active', true).order('sort_order'),
        m.from('checklist_completions').select('*').order('updated_at', { ascending: false }), // all periods — history of who checked what, when
        m.from('annual_items').select('*').eq('active', true).order('next_due'),
        m.from('spare_parts').select('*').order('part_no'),
        m.from('offsite_equipment').select('*').is('returned_at', null).order('date_sent'),
        m.from('ip_readings').select('*').order('reading_date'),
        m.from('diesel_readings').select('*').order('reading_date'),
        m.from('loadshedding_log').select('*').order('log_date', { ascending: false }).limit(60),
        m.from('water_readings').select('*').order('reading_date'),
        m.from('boiler_start_log').select('*').order('log_date', { ascending: false }).limit(14),
        m.from('equipment_config').select('*').eq('active', true),
        m.from('equipment_hours').select('*').order('reading_date'),
        m.from('calibration_assets').select('*').eq('active', true),
        m.from('machines').select('*').eq('active', true).order('name'),
      ])
      const firstErr = [jc, lg, sp, ro, aq, sl, tpl, comp, ann, stk, off, ipr, dsr, lsl, wtr, bst, ecf, eqh, cal].find((r: any) => r.error)
      if (firstErr?.error) throw firstErr.error
      setJcs(jc.data ?? []); setLogs(lg.data ?? []); setSparesUsed(sp.data ?? [])
      setRoster(ro.data ?? []); setAreaQc(aq.data ?? []); setSlots(sl.data ?? [])
      setTemplates(tpl.data ?? []); setCompletions(comp.data ?? [])
      setAnnual(ann.data ?? []); setStock(stk.data ?? []); setOffsite(off.data ?? [])
      setIpReadings(ipr.data ?? []); setDieselReadings(dsr.data ?? []); setLsLogs(lsl.data ?? [])
      setWaterReadings(wtr.data ?? []); setBoilerStarts(bst.data ?? [])
      setEqConfig(ecf.data ?? []); setEqHours(eqh.data ?? []); setCalAssets(cal.data ?? [])
      setMachines(mac.data ?? [])
      setError('')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load maintenance data')
    } finally {
      setLoading(false)
    }
  }, [weekKey, moKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])

  // ── Live staff directory (drives every technician/QC picker + @mentions) ──
  // Separate from loadAll: it's an API route (server-gated), not a supabase read.
  const loadStaff = useCallback(async () => {
    try {
      const r = await fetch('/api/maintenance/staff')
      if (!r.ok) return // keep fallback (e.g. raiser without directory permission)
      const rows = await r.json()
      if (Array.isArray(rows) && rows.length) {
        setStaff(rows.map((s: any) => ({
          id: s.id ?? null, name: s.name, initials: s.initials,
          email: s.email ?? null, phone: s.phone ?? null, role: s.role,
        })))
      }
    } catch { /* keep fallback */ }
  }, [])

  useEffect(() => { loadStaff() }, [loadStaff])

  // ── Log helper: every comment + transition recorded for analysis ──
  const addLog = async (cardId: number, kind: 'comment' | 'event', stage: string, author: string, body: string) => {
    const { data, error: err } = await db.schema('maintenance').from('job_card_logs')
      .insert({ card_id: cardId, kind, stage, author, body }).select().single()
    if (!err && data) setLogs(p => [...p, data])
  }

  // ── Job card mutations ──
  const upJC = async (id: number, u: Partial<JobCard>) => {
    setJcs(p => p.map(j => (j.id === id ? { ...j, ...u } : j)))
    const { error: err } = await db.schema('maintenance').from('job_cards')
      .update({ ...u, updated_at: new Date().toISOString() }).eq('id', id)
    if (err) setPopup('Save failed: ' + err.message)
  }

  const onDutyTech = () => {
    const now = Date.now()
    return roster.find(r => new Date(r.start_at).getTime() <= now && now <= new Date(r.end_at).getTime())?.technician ?? null
  }
  // All technicians on duty right now (a shift has two) — drives quick-pick
  // allocation buttons on the board.
  const onDutyTechs = () => {
    const now = Date.now()
    return Array.from(new Set(
      roster.filter(r => new Date(r.start_at).getTime() <= now && now <= new Date(r.end_at).getTime())
        .map(r => r.technician)
    ))
  }

  const createJC = async () => {
    if (!nj.area || !nj.desc || !nj.raisedBy) { setPopup('Please fill in your name, the area and a short description.'); return }
    setSaving(true)
    const isBd = nj.workflow === 'breakdown'
    const body = {
      workflow: nj.workflow, area: nj.area, machine: nj.machine || null,
      maint_types: isBd ? ['Breakdown'] : nj.type,
      description: nj.desc, long_desc: nj.longDesc,
      raised_by: nj.raisedBy, photo_url: nj.photo, ai_suggestion: nj.aiSug,
    }
    let res: Response
    try {
      res = await fetch('/api/maintenance/job-cards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } catch (e: any) { setSaving(false); setPopup('Could not raise job card: ' + (e?.message ?? 'network error')); return }
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setPopup(json?.error ?? 'Could not raise job card.'); return }
    const card = json.card as JobCard
    const wasAutoAssigned = !!card.assigned_to
    // Optimistic prepend; reload() resyncs the server-written log + notifications.
    setJcs(p => [card, ...p])
    setPopup(isBd
      ? (wasAutoAssigned
          ? `Breakdown ${card.card_no} sent directly to on-duty technician ${card.assigned_to}.\nThe maintenance manager has been informed.\nThe job timer is already running.`
          : `Breakdown ${card.card_no} raised, but no technician is on duty in the roster.\nThe maintenance manager has been informed and will allocate it urgently.`)
      : `Job card ${card.card_no} raised.\nIt is now with the maintenance manager for allocation.`)
    setNj({ workflow: 'planned', area: '', machine: '', type: [], desc: '', longDesc: '', raisedBy: nj.raisedBy, photo: null, aiSug: '' })
    loadAll()
  }

  // Manager allocates a planned card — goes through the server route (gating +
  // notifications + log). techId carries the real staff user-id when chosen.
  const allocate = async (j: JobCard) => {
    const a = alloc[j.id] ?? {}
    if (a.external && !a.company) { setPopup('Enter the external company name.'); return }
    if (!a.external && !a.tech) { setPopup('Select a technician, or switch to external.'); return }
    const res = await fetch(`/api/maintenance/job-cards/${j.id}/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigned_to: a.external ? '' : a.tech!,
        assigned_user_id: a.external ? null : (a.techId ?? null),
        external: !!a.external, external_company: a.external ? a.company! : '',
        qc_required: a.qc !== false, actor: actor || 'Maintenance Manager',
      }),
    }).catch(() => null)
    if (!res) { setPopup('Could not allocate — network error.'); return }
    if (!res.ok) { const j2 = await res.json().catch(() => ({})); setPopup(j2?.error ?? 'Could not allocate job card.'); return }
    setAlloc(p => { const n = { ...p }; delete n[j.id]; return n })
    loadAll()
  }

  const sendForClarify = async (j: JobCard) => {
    const note = drafts['cl' + j.id]
    if (!note) { setPopup('Add a note explaining what needs clarifying.'); return }
    await upJC(j.id, { status: 'clarify' })
    await addLog(j.id, 'comment', 'clarify', actor || 'Maintenance Manager', note)
    await addLog(j.id, 'event', 'clarify', actor || 'Maintenance Manager', `Sent back to ${j.raised_by} for clarification.`)
    setDrafts(p => ({ ...p, ['cl' + j.id]: '' }))
  }

  const resubmit = async (j: JobCard) => {
    await upJC(j.id, { status: 'raised', description: drafts['sd' + j.id] ?? j.description, long_desc: drafts['ld' + j.id] ?? j.long_desc })
    await addLog(j.id, 'event', 'raised', j.raised_by, 'Raiser updated the description and resubmitted for allocation.')
  }

  // Technician logs a spare/critical part used — decrements the stock register
  const logSpare = async (j: JobCard) => {
    const f = spForm[j.id] ?? {}
    const qty = parseInt(f.qty || '1') || 1
    const part = stock.find(s => String(s.id) === f.partId)
    if (!part && !f.desc) { setPopup('Pick a part from stock or describe the item used.'); return }
    const { data, error: err } = await db.schema('maintenance').from('job_card_spares').insert({
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
      work_done: drafts['wd' + j.id] ?? j.work_done, root_cause: drafts['rc' + j.id] ?? j.root_cause,
      tools_used: drafts['tl' + j.id] ?? j.tools_used,
    })
    await addLog(j.id, 'event', next, j.assigned_to ?? actor,
      j.qc_required ? `Work complete — sent to QC (${qcFor(j.area) || 'QC on duty'})` : 'Work complete — QC not required, sent to originator for verification.')
    // Notify the Quality dashboard to run the post-maintenance QC check. The
    // server resolves the station QC (area→QC map) or all Quality users.
    if (j.qc_required) {
      fetch(`/api/maintenance/job-cards/${j.id}/to-qc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: j.area, card_no: j.card_no, actor: actor || displayName || '' }),
      }).catch(() => {}) // best-effort — the card is already in the QC queue regardless
    }
  }

  // Add a machine to the catalogue (free-type entry on the raise form). Returns
  // the saved name so the form can select it immediately.
  const addMachine = async (name: string, area = ''): Promise<string | null> => {
    const clean = name.trim()
    if (!clean) return null
    const existing = machines.find(m => m.name.toLowerCase() === clean.toLowerCase())
    if (existing) return existing.name
    const { data, error: err } = await db.schema('maintenance').from('machines')
      .insert({ name: clean, area, created_by: actor || displayName || '' }).select().single()
    if (err) {
      if (err.code === '23505') return clean // unique-violation race — name already exists
      setPopup('Could not save machine: ' + err.message); return null
    }
    setMachines(p => [...p, data].sort((a, b) => a.name.localeCompare(b.name)))
    return data.name
  }

  // QC submits — any YES sends the card back to the technician
  const qcSubmit = async (j: JobCard) => {
    const answers: QcAnswer[] = QC_CHECKS.map((_, i) => normQc((j.qc_checks ?? [])[i] ?? 'na'))
    const qcName = drafts['qn' + j.id] ?? j.qc_name ?? qcFor(j.area) ?? actor
    const anyYes = answers.includes('yes')
    if (anyYes) {
      const note = drafts['qf' + j.id]
      if (!note) { setPopup('One or more checks failed (YES) — a QC comment is required before sending the card back.'); return }
      await upJC(j.id, { status: 'in_progress', qc_checks: answers, qc_name: qcName, reopen_count: (j.reopen_count ?? 0) + 1, completed_at: null })
      await addLog(j.id, 'comment', 'qc_check', qcName, note)
      await addLog(j.id, 'event', 'in_progress', qcName, `QC FAILED (${answers.filter(a => a === 'yes').length} × YES) — card returned to technician ${j.assigned_to}. Maintenance manager informed. Reopen #${(j.reopen_count ?? 0) + 1}.`)
      setDrafts(p => ({ ...p, ['qf' + j.id]: '' }))
    } else {
      await upJC(j.id, { status: 'verify', qc_checks: answers, qc_name: qcName, qc_done_at: new Date().toISOString() })
      await addLog(j.id, 'event', 'verify', qcName, 'QC passed — sent to originator for verification.')
    }
  }

  // Verification goes through the server route so the "not satisfied" bounce
  // fires its notification to the assigned technician + cleanup on close.
  const verifyCard = async (j: JobCard, ok: boolean) => {
    const res = await fetch(`/api/maintenance/job-cards/${j.id}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok, actor: actor || displayName || j.raised_by }),
    }).catch(() => null)
    if (!res) { setPopup('Could not record verification — network error.'); return }
    if (!res.ok) { const j2 = await res.json().catch(() => ({})); setPopup(j2?.error ?? 'Could not record verification.'); return }
    loadAll()
  }

  const postComment = async (j: JobCard) => {
    const body = drafts['cm' + j.id]
    if (!body) return
    await addLog(j.id, 'comment', j.status, actor || displayName || 'Unknown', body)
    setDrafts(p => ({ ...p, ['cm' + j.id]: '' }))
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
    const { data, error: err } = await db.schema('maintenance').from('checklist_completions')
      .upsert(merged, { onConflict: 'template_id,period_key' }).select().single()
    if (err) { setPopup('Save failed: ' + err.message); return }
    setCompletions(p => p.map(c => (c.template_id === tpl.id && c.period_key === period ? data : c)))
  }

  const toggleTask = (tpl: Template, ti: number) => {
    const period = tpl.frequency === 'weekly' ? weekKey : moKey
    const states = { ...(getComp(tpl.id, period)?.task_states ?? {}) }
    const nowDone = !states[ti]?.done
    // stamp who ticked it and when — the permanent record of the check
    states[ti] = { ...(states[ti] ?? {}), done: nowDone, by: nowDone ? (actor || displayName || '') : states[ti]?.by, at: nowDone ? new Date().toISOString() : states[ti]?.at }
    saveComp(tpl, { task_states: states })
  }
  const setTaskField = (tpl: Template, ti: number, field: 'notes' | 'fault', value: string | boolean) => {
    const period = tpl.frequency === 'weekly' ? weekKey : moKey
    const states = { ...(getComp(tpl.id, period)?.task_states ?? {}) }
    states[ti] = { ...(states[ti] ?? {}), [field]: value }
    saveComp(tpl, { task_states: states })
  }

  const saveAnnualNotes = async (id: number, notes: string) => {
    setAnnual(p => p.map(a => (a.id === id ? { ...a, notes } : a)))
    const { error: err } = await db.schema('maintenance').from('annual_items').update({ notes }).eq('id', id)
    if (err) setPopup('Save failed: ' + err.message)
  }

  // ── Checklist fault → job card (goes into the normal allocation workflow) ──
  const raiseFromChecklist = async (area: string, docRef: string, task: string, notes: string) => {
    const { data, error: err } = await db.schema('maintenance').from('job_cards').insert({
      workflow: 'planned', area, maint_types: ['Repair'],
      description: `Checklist fault: ${task}`,
      long_desc: notes ? `Checklist note: ${notes}` : '',
      raised_by: actor || displayName || 'Checklist', ai_suggestion: aiSuggest(task + ' ' + notes),
    }).select().single()
    if (err) { setPopup('Could not raise job card: ' + err.message); return }
    setJcs(p => [data, ...p])
    await addLog(data.id, 'event', 'raised', actor || displayName || 'Checklist', `Raised automatically from ${area} checklist (${docRef}).`)
    setPopup(`Job card ${data.card_no} raised for "${task}" (${area}).\nIt is now with the maintenance manager for allocation.`)
  }

  // ── Readings capture (usage/deltas computed from previous reading, like the Excel) ──
  const setterFor: Record<string, (fn: (p: any[]) => any[]) => void> = {
    ip_readings: setIpReadings as any, diesel_readings: setDieselReadings as any,
    loadshedding_log: setLsLogs as any, water_readings: setWaterReadings as any,
    boiler_start_log: setBoilerStarts as any, equipment_hours: setEqHours as any,
  }
  const saveReading = async (table: string, body: Record<string, any>, sortKey = 'reading_date') => {
    const { data, error: err } = await db.schema('maintenance').from(table)
      .insert({ ...body, recorded_by: actor || displayName || '' }).select().single()
    if (err) { setPopup('Could not save reading: ' + err.message); return false }
    setterFor[table]?.(p => [...p, data].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey]))))
    return true
  }

  // ── Calibration: mark done today (next due recomputed from interval) ──
  const calDone = async (a: CalAsset) => {
    const today = new Date().toISOString().slice(0, 10)
    const comment = (a.comment ? a.comment + ' • ' : '') + `Done ${today} by ${actor || displayName || ''}`
    setCalAssets(p => p.map(x => x.id === a.id ? { ...x, last_done: today, comment } : x))
    const { error: err } = await db.schema('maintenance').from('calibration_assets')
      .update({ last_done: today, comment }).eq('id', a.id)
    if (err) setPopup('Save failed: ' + err.message)
  }
  // Equipment serviced today — resets the hours-since-service counter
  const eqServiced = async (equipment: string, total: number | null) => {
    await saveReading('equipment_hours', {
      equipment, reading_date: new Date().toISOString().slice(0, 10),
      total_hours: total, hours_since_service: 0, serviced: true, notes: 'Serviced',
    })
  }

  // ── Spare-parts register CRUD (interactive Stock & Spares grid) ──
  const addPart = async (p: { part_no: string; class: string; description: string; qty_new: number; qty_used: number; barcode?: string | null }) => {
    const { data, error: err } = await db.schema('maintenance').from('spare_parts').insert(p).select().single()
    if (err) { setPopup('Could not add part: ' + err.message); return null }
    setStock(s => [...s, data].sort((a, b) => (a.part_no || '').localeCompare(b.part_no || '')))
    return data as SparePart
  }
  // Resolve a scanned/typed code to a part — barcode first (trimmed, case-insensitive),
  // then part_no as a fallback. Used by the scanner and the stock "Scan to find".
  const findPartByBarcode = (code: string): SparePart | null => {
    const c = (code ?? '').trim().toLowerCase()
    if (!c) return null
    return (
      stock.find(s => (s.barcode ?? '').trim().toLowerCase() === c) ??
      stock.find(s => (s.part_no ?? '').trim().toLowerCase() === c) ??
      null
    )
  }
  const updatePart = async (id: number, patch: Partial<SparePart>) => {
    setStock(s => s.map(r => (r.id === id ? { ...r, ...patch } : r)))
    const { error: err } = await db.schema('maintenance').from('spare_parts')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (err) setPopup('Save failed: ' + err.message)
  }
  const adjustPartQty = async (id: number, col: 'qty_new' | 'qty_used', delta: number) => {
    const part = stock.find(s => s.id === id); if (!part) return
    const next = Math.max(0, ((part as any)[col] ?? 0) + delta)
    await updatePart(id, { [col]: next } as Partial<SparePart>)
  }
  const deletePart = async (id: number) => {
    setStock(s => s.filter(r => r.id !== id))
    const { error: err } = await db.schema('maintenance').from('spare_parts').delete().eq('id', id)
    if (err) { setPopup('Delete failed: ' + err.message); loadAll() }
  }

  // ── Offsite equipment CRUD ──
  const addOffsite = async (o: { item: string; sent_to: string; date_sent: string; status: string }) => {
    const { data, error: err } = await db.schema('maintenance').from('offsite_equipment').insert(o).select().single()
    if (err) { setPopup('Could not add offsite item: ' + err.message); return }
    setOffsite(p => [data, ...p])
  }
  const updateOffsite = async (id: number, patch: Partial<Offsite>) => {
    setOffsite(p => p.map(o => (o.id === id ? { ...o, ...patch } : o)))
    const { error: err } = await db.schema('maintenance').from('offsite_equipment').update(patch).eq('id', id)
    if (err) setPopup('Save failed: ' + err.message)
  }
  const returnOffsite = async (id: number) => {
    setOffsite(p => p.filter(o => o.id !== id))
    const { error: err } = await db.schema('maintenance').from('offsite_equipment')
      .update({ returned_at: new Date().toISOString(), status: 'Returned' }).eq('id', id)
    if (err) { setPopup('Save failed: ' + err.message); loadAll() }
  }

  // ── Roster / area-QC / planner mutations ──
  const addRoster = async () => {
    if (!rosterForm.start || !rosterForm.end) { setPopup('Pick a start and end time for the duty slot.'); return }
    const { data, error: err } = await db.schema('maintenance').from('duty_roster')
      .insert({ technician: rosterForm.tech, technician_user_id: rosterForm.techId ?? null, start_at: rosterForm.start, end_at: rosterForm.end }).select().single()
    if (err) { setPopup('Could not save roster slot: ' + err.message); return }
    setRoster(p => [...p, data].sort((a, b) => a.start_at.localeCompare(b.start_at)))
  }
  const delRoster = async (id: number) => {
    setRoster(p => p.filter(r => r.id !== id))
    await db.schema('maintenance').from('duty_roster').delete().eq('id', id)
  }

  const qcFor = (area: string) => areaQc.find(a => a.area === area)?.qc_name || ''
  const saveAreaQc = async (area: string, qc_name: string, qc_user_id: string | null = null) => {
    setAreaQc(p => {
      const i = p.findIndex(a => a.area === area)
      if (i >= 0) { const n = [...p]; n[i] = { ...n[i], qc_name, qc_user_id }; return n }
      return [...p, { id: 0, area, qc_name, qc_user_id }]
    })
    const { data, error: err } = await db.schema('maintenance').from('area_qc')
      .upsert({ area, qc_name, qc_user_id }, { onConflict: 'area' }).select().single()
    if (err) { setPopup('Save failed: ' + err.message); return }
    setAreaQc(p => p.map(a => (a.area === area ? data : a)))
  }

  const addSlot = async () => {
    if (!slotForm.date) { setPopup('Pick a date for the planned slot.'); return }
    const start = new Date(slotForm.date + 'T' + slotForm.time)
    const end = new Date(start.getTime() + (parseFloat(slotForm.hours) || 1) * 3600000)
    const { data, error: err } = await db.schema('maintenance').from('tech_schedule').insert({
      card_id: slotForm.cardId ? Number(slotForm.cardId) : null,
      technician: slotForm.tech, technician_user_id: slotForm.techId ?? null,
      start_at: start.toISOString(), end_at: end.toISOString(), note: slotForm.note,
    }).select().single()
    if (err) { setPopup('Could not save slot: ' + err.message); return }
    setSlots(p => [...p, data].sort((a, b) => a.start_at.localeCompare(b.start_at)))
    if (slotForm.cardId) {
      const c = jcs.find(x => x.id === Number(slotForm.cardId))
      if (c) await addLog(c.id, 'event', c.status, actor || 'Maintenance Manager', `Scheduled (estimate): ${slotForm.tech}, ${fmtDT(start.toISOString())} → ${fmtT(end.toISOString())}`)
    }
  }
  const delSlot = async (id: number) => {
    setSlots(p => p.filter(s => s.id !== id))
    await db.schema('maintenance').from('tech_schedule').delete().eq('id', id)
  }

  // Click-to-add a planner slot directly on an empty week-grid cell.
  const addSlotFor = async (tech: string, techId: string | null, day: Date, hours = 2, time = '08:00') => {
    const [hh, mm] = time.split(':').map(Number)
    const start = new Date(day); start.setHours(hh || 8, mm || 0, 0, 0)
    const end = new Date(start.getTime() + hours * 3600000)
    const { data, error: err } = await db.schema('maintenance').from('tech_schedule').insert({
      card_id: null, technician: tech, technician_user_id: techId ?? null,
      start_at: start.toISOString(), end_at: end.toISOString(), note: '',
    }).select().single()
    if (err) { setPopup('Could not add slot: ' + err.message); return }
    setSlots(p => [...p, data].sort((a, b) => a.start_at.localeCompare(b.start_at)))
  }

  // ── Derived ──
  const cnt = (s: string) => jcs.filter(j => j.status === s).length
  const cardLogs = (id: number) => logs.filter(l => l.card_id === id)
  const cardSpares = (id: number) => sparesUsed.filter(s => s.card_id === id)
  const duty = onDutyTech()
  const dutyNow = onDutyTechs()

  const newCards = jcs.filter(j => j.status === 'raised')
  const hist = jcs.filter(j => j.status === 'complete').slice(0, 20)
  const annualRows = annual.map(a => ({ ...a, days: daysUntil(a.next_due) })).sort((a, b) => a.days - b.days)
  const openPlannedCards = jcs.filter(j => j.workflow === 'planned' && !['complete'].includes(j.status))

  const completed = jcs.filter(j => j.status === 'complete')
  const totalMins = completed.reduce((s, j) => s + diffM(j.accepted_at, j.completed_at), 0)
  const avgCloseDays = completed.length ? (completed.reduce((s, j) => s + diffDays(j.raised_at, j.completed_at ?? j.verified_at), 0) / completed.length).toFixed(1) : '0'
  const techCounts = TECHS.map(t => ({ t, n: jcs.filter(j => j.assigned_to === t).length })).sort((a, b) => b.n - a.n)
  const areaCounts = Object.entries(jcs.reduce((m: Record<string, number>, j) => { m[j.area] = (m[j.area] ?? 0) + 1; return m }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const reopens = jcs.reduce((s, j) => s + (j.reopen_count ?? 0), 0)
  const breakdowns = jcs.filter(j => j.workflow === 'breakdown').length
  const completionRate = jcs.length ? Math.round(completed.length / jcs.length * 100) : 0

  // ── Scheduled-maintenance derived selectors ──
  // Last completion of a checklist in any period (who did it, when)
  const lastComp = (tplId: number) => completions
    .filter(c => c.template_id === tplId && Object.values(c.task_states ?? {}).some((s: any) => s?.done))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0]

  // Latest run-hours reading per machine + projected service due (Excel WORKDAY formula)
  const eqLatest = eqConfig.map(cfg => {
    const readings = eqHours.filter(h => h.equipment === cfg.equipment)
    const latest = readings[readings.length - 1]
    if (!latest || latest.hours_since_service == null) return { cfg, latest, due: null as Date | null, days: 9999 }
    const due = workdayAdd(new Date(latest.reading_date), (cfg.service_interval_hours - latest.hours_since_service) / cfg.hours_per_workday)
    return { cfg, latest, due, days: Math.ceil((due.getTime() - Date.now()) / 86400000) }
  }).sort((a, b) => a.days - b.days)

  // Calibration register with computed next-due (last done + interval days)
  const calRows = calAssets.filter(a => !a.weekly_check).map(a => {
    const next = a.last_done ? addDays(a.last_done, a.interval_days) : null
    return { ...a, next, days: next ? Math.ceil((next.getTime() - Date.now()) / 86400000) : 9999 }
  }).sort((a, b) => a.days - b.days)

  // Meter usage deltas (per meter, like the Excel) for trend charts
  const usageSeries = (vals: (number | null)[]) => {
    const out: number[] = []
    for (let i = 1; i < vals.length; i++) {
      const a = vals[i - 1], b = vals[i]
      if (a != null && b != null && b >= a) out.push(b - a)
    }
    return out
  }
  const waterUsage = {
    main: usageSeries(waterReadings.map(w => w.main_meter)),
    unit1: usageSeries(waterReadings.map(w => w.unit1)),
    w1: usageSeries(waterReadings.map(w => w.unit2_w1)),
    w2: usageSeries(waterReadings.map(w => w.unit2_w2)),
    boiler: usageSeries(waterReadings.map(w => w.boiler)),
  }
  const ipUsage = usageSeries(ipReadings.map(r => r.flow_meter_l))

  // Checklists outstanding this period (for the Overview actions panel)
  const outstandingChecklists = templates.map(t => {
    const period = t.frequency === 'weekly' ? weekKey : moKey
    const st = getComp(t.id, period)?.task_states ?? {}
    const doneN = t.tasks.filter((_, i) => (st as any)[i]?.done).length
    return { t, doneN, total: t.tasks.length, last: lastComp(t.id) }
  }).filter(x => x.doneN < x.total)

  return {
    loading,
    error,
    weekKey,
    moKey,
    actor,
    setActor,

    data: {
      jcs, logs, sparesUsed, roster, areaQc, slots, templates, completions, annual, stock, offsite, staff,
      ipReadings, dieselReadings, lsLogs, waterReadings, boilerStarts, eqConfig, eqHours, calAssets, machines,
    },

    // Shared form/UI state + setters that the route components drive.
    ui: {
      popup, setPopup, saving, drafts, setDrafts,
      nj, setNj, alloc, setAlloc, spForm, setSpForm,
      slotForm, setSlotForm, rosterForm, setRosterForm,
    },

    actions: {
      addLog, upJC, onDutyTech, createJC, allocate, sendForClarify, resubmit,
      logSpare, completeWork, qcSubmit, verifyCard, postComment,
      getComp, saveComp, toggleTask, setTaskField, saveAnnualNotes,
      addPart, updatePart, adjustPartQty, deletePart, findPartByBarcode, addOffsite, updateOffsite, returnOffsite,
      addRoster, delRoster, qcFor, saveAreaQc, addSlot, delSlot, addSlotFor,
      raiseFromChecklist, saveReading, calDone, eqServiced, addMachine,
    },

    derived: {
      cnt, cardLogs, cardSpares, duty, dutyNow, newCards, hist, annualRows, openPlannedCards,
      completed, totalMins, avgCloseDays, techCounts, areaCounts, reopens,
      breakdowns, completionRate, statuses: STATUSES,
      lastComp, eqLatest, calRows, waterUsage, ipUsage, outstandingChecklists,
    },

    reload: loadAll,
  }
}

export type MaintenanceData = ReturnType<typeof useMaintenanceData>

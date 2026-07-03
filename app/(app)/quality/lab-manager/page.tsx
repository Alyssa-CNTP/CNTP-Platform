'use client'

// app/(app)/quality/lab-manager/page.tsx
//
// Lab Manager dashboard.
//   1. Pending approvals — pasteuriser runs allocated by QC (awaiting_approval).
//      The Lab Manager / Quality Manager / IT approves Pass/Fail/Concession
//      (Fail/Concession require a reason).
//   2. Daily overview & sign-off — per production station, per day. Highlights
//      out-of-spec bags/boxes. Signed off into qms.daily_signoffs.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { isoDate, isoDateTime } from '@/lib/utils/formatDate'
// computePastOosFlags removed — was never exported from pasteuriser
function computePastOosFlags(_d: any): any[] { return [] }
import LmDecisionModal from '@/components/shared/LmDecisionModal'

const STATIONS = [
  { key: 'pasteuriser', label: '🫗 Pasteuriser' },
  { key: 'granule',     label: '🔬 Granule Line' },
  { key: 'sieving',     label: '🧪 Sieving Tower' },
] as const

function parseData(r: any) {
  try { return typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}) } catch { return {} }
}
const fmtDateTime = isoDateTime
const todayISO = () => isoDate(new Date())

function mondayOf(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return isoDate(d)
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoDate(d)
}
function fmtDay(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Standing Lab Manager note — always editable, saves on blur. Separate from
// the decision comment (final_reason) tied to a Fail/Concession verdict.
function LmNotesBox({ initialValue, onSave, disabled }: { initialValue: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState(initialValue || '')
  const [dirty, setDirty] = useState(false)
  return (
    <div>
      <textarea
        value={value}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
        onBlur={() => { if (dirty) { onSave(value); setDirty(false) } }}
        disabled={disabled}
        placeholder="Add any comments on this batch before deciding…"
        rows={2}
        className="w-full text-[12px] px-3 py-2 border border-surface-rule rounded-lg bg-surface resize-y disabled:opacity-60 outline-none focus:border-brand/50"
      />
      {dirty && <span className="text-[10px] text-warn">Unsaved — click outside the box to save</span>}
    </div>
  )
}

export default function LabManagerPage() {
  const { p, session } = useAuth()
  const db = getDb()
  const canApprove = p('can_approve_runs')
  const canSignoff = p('can_signoff_day')
  const whoAmI = session?.user?.email?.split('@')[0] || 'unknown'

  const [tab, setTab] = useState<'approvals' | 'daily' | 'history'>('approvals')

  // ── Pending approvals ──────────────────────────────────────────────────────
  const [pending, setPending] = useState<any[]>([])
  const [loadingP, setLoadingP] = useState(true)

  const loadPending = useCallback(async () => {
    setLoadingP(true)
    const [pRes, gRes, gsRes] = await Promise.all([
      db.schema('qms').from('quality_records').select('*').eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run').order('created_at', { ascending: false }).limit(500),
      db.schema('qms').from('granule_runs').select('*').order('created_at', { ascending: false }).limit(500),
      db.schema('qms').from('granule_samples').select('*').limit(3000),
    ])
    const past = (pRes.data ?? []).map((r: any) => ({ ...r, d: parseData(r) }))
      .filter((r: any) => r.d.batch_status === 'awaiting_approval' && !r.d.final_result)
      .map((r: any) => ({
        kind: 'pasteuriser', id: r.id, batch: r.batch_number || r.d.batch_number || '—',
        meta: `${r.d.production_date || '—'} · ${r.d.customer || '—'} · ${r.d.type_grade || [r.d.product_family, r.d.grade, r.d.variant].filter(Boolean).join(' ')}`,
        samples: (r.d.samples ?? []).length, allocated_by: r.d.allocated_by, allocated_at: r.d.allocated_at,
        oos: r.d.oos_flags ?? computePastOosFlags(r.d), lm_notes: r.d.lm_notes || '', raw: r,
      }))
    const gsByRun: Record<number, any[]> = {}
    for (const s of (gsRes.data ?? [])) (gsByRun[s.run_id] = gsByRun[s.run_id] || []).push(s)
    const gran = (gRes.data ?? []).filter((r: any) => r.lm_status === 'awaiting_approval' && !r.final_status)
      .map((r: any) => {
        const samples = gsByRun[r.id] || []
        const oos = samples.filter((s: any) => (s.violations || []).length > 0)
          .map((s: any) => ({ bag: s.bulk_bag_serial || `Sample ${s.id}`, time: s.sample_time, fails: (s.violations || []).map((v: string) => ({ field: v, value: '', spec: null })) }))
        return {
          kind: 'granule', id: r.id, batch: r.batch_number || '—',
          meta: `${r.production_date || '—'} · ${r.type_grade || r.grade || '—'} · QC ${r.qc_name || '—'}`,
          samples: samples.length, allocated_by: r.allocated_by, allocated_at: r.allocated_at, oos, lm_notes: r.lm_notes || '', raw: r,
        }
      })
    setPending([...past, ...gran])
    setLoadingP(false)
  }, [db])

  useEffect(() => { loadPending() }, [loadPending])

  const [decisionModal, setDecisionModal] = useState<{ item: any; result: 'Pass' | 'Fail' | 'Concession' } | null>(null)

  async function decide(item: any, result: 'Pass' | 'Fail' | 'Concession', comment: string) {
    if (item.kind === 'pasteuriser') {
      const d = item.raw.d
      const newData = { ...d, final_result: result, finalised_at: new Date().toISOString(), batch_status: 'complete', final_reason: comment || undefined, approved_by: whoAmI, oos_flags: d.oos_flags ?? computePastOosFlags(d) }
      const { error } = await db.schema('qms').from('quality_records').update({ data_json: newData }).eq('id', item.id)
      if (error) { alert('Save failed: ' + error.message); return }
    } else {
      const { error } = await db.schema('qms').from('granule_runs').update({ final_status: result, overall_status: result, approved_by: whoAmI, final_reason: comment || null, lm_status: 'complete' }).eq('id', item.id)
      if (error) { alert('Save failed: ' + error.message); return }
    }
    setPending(prev => prev.filter(x => !(x.kind === item.kind && x.id === item.id)))
    setDecisionModal(null)
  }

  // Standing Lab Manager note — savable any time, independent of the pass/fail/concession decision.
  async function saveLmNotes(item: any, text: string) {
    if (item.kind === 'pasteuriser') {
      const d = { ...item.raw.d, lm_notes: text }
      const { error } = await db.schema('qms').from('quality_records').update({ data_json: d }).eq('id', item.id)
      if (error) { alert('Failed to save note: ' + error.message); return }
      setPending(prev => prev.map(x => (x.kind === item.kind && x.id === item.id) ? { ...x, lm_notes: text, raw: { ...x.raw, d } } : x))
    } else {
      const { error } = await db.schema('qms').from('granule_runs').update({ lm_notes: text }).eq('id', item.id)
      if (error) { alert('Failed to save note: ' + error.message); return }
      setPending(prev => prev.map(x => (x.kind === item.kind && x.id === item.id) ? { ...x, lm_notes: text, raw: { ...x.raw, lm_notes: text } } : x))
    }
  }

  // ── Daily overview (date range) ──────────────────────────────────────────────
  const [dayFrom, setDayFrom] = useState(todayISO())
  const [dayTo, setDayTo] = useState(todayISO())
  const [past, setPast] = useState<any[]>([])
  const [gran, setGran] = useState<any[]>([])
  const [siev, setSiev] = useState<any[]>([])
  // signoffs[workcenter][production_date] = signoff row
  const [signoffs, setSignoffs] = useState<Record<string, Record<string, any>>>({})
  const [loadingD, setLoadingD] = useState(true)

  const inRange = (d: string) => !!d && d >= dayFrom && d <= dayTo

  const loadDaily = useCallback(async () => {
    setLoadingD(true)
    const [pRes, gRes, gsRes, sRes, soRes] = await Promise.all([
      db.schema('qms').from('quality_records').select('*').eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run').order('created_at', { ascending: false }).limit(500),
      db.schema('qms').from('granule_runs').select('*').order('created_at', { ascending: false }).limit(500),
      db.schema('qms').from('granule_samples').select('*').limit(3000),
      db.schema('qms').from('sd_runs').select('*').order('created_at', { ascending: false }).limit(1000),
      db.schema('qms').from('daily_signoffs').select('*').gte('production_date', dayFrom).lte('production_date', dayTo),
    ])
    const pRows = (pRes.data ?? []).map((r: any) => ({ ...r, d: parseData(r) }))
      .filter((r: any) => inRange((r.d.production_date || '').slice(0, 10)))
    const gsByRun: Record<number, any[]> = {}
    for (const s of (gsRes.data ?? [])) (gsByRun[s.run_id] = gsByRun[s.run_id] || []).push(s)
    const gRows = (gRes.data ?? []).filter((r: any) => inRange(String(r.production_date || r.date || '').slice(0, 10)))
      .map((r: any) => ({ ...r, _samples: gsByRun[r.id] || [] }))
    const sRows = (sRes.data ?? []).filter((r: any) => inRange(String(r.date || '').slice(0, 10)))
    const so: Record<string, Record<string, any>> = {}
    for (const row of (soRes.data ?? [])) {
      so[row.workcenter] = so[row.workcenter] || {}
      so[row.workcenter][row.production_date] = row
    }
    setPast(pRows); setGran(gRows); setSiev(sRows); setSignoffs(so)
    setLoadingD(false)
  }, [db, dayFrom, dayTo])

  useEffect(() => { if (tab === 'daily') loadDaily() }, [tab, loadDaily])

  // ── Approvals history (weekly, searchable) ──────────────────────────────────
  const [weekStart, setWeekStart] = useState(mondayOf(todayISO()))
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [loadingH, setLoadingH] = useState(true)
  const [historySearch, setHistorySearch] = useState('')
  const [historyFilter, setHistoryFilter] = useState<'all' | 'outstanding' | 'approved' | 'concession' | 'fail'>('all')

  const loadHistory = useCallback(async () => {
    setLoadingH(true)
    const [pRes, gRes] = await Promise.all([
      db.schema('qms').from('quality_records').select('*').eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run').order('created_at', { ascending: false }).limit(1000),
      db.schema('qms').from('granule_runs').select('*').order('created_at', { ascending: false }).limit(1000),
    ])
    const pRows = (pRes.data ?? []).map((r: any) => ({ ...r, d: parseData(r) }))
      .filter((r: any) => r.d.batch_status === 'awaiting_approval' || !!r.d.final_result)
      .map((r: any) => ({
        kind: 'pasteuriser', id: r.id, batch: r.batch_number || r.d.batch_number || '—',
        date: (r.d.production_date || '').slice(0, 10),
        status: r.d.final_result || 'Outstanding',
        meta: `${r.d.customer || '—'} · ${r.d.type_grade || [r.d.product_family, r.d.grade, r.d.variant].filter(Boolean).join(' ')}`,
        qc: r.d.allocated_by || '—', approved_by: r.d.approved_by || '', final_reason: r.d.final_reason || '', lm_notes: r.d.lm_notes || '',
      }))
    const gRows = (gRes.data ?? []).filter((r: any) => r.lm_status === 'awaiting_approval' || !!r.final_status)
      .map((r: any) => ({
        kind: 'granule', id: r.id, batch: r.batch_number || '—',
        date: String(r.production_date || '').slice(0, 10),
        status: r.final_status || 'Outstanding',
        meta: `${r.type_grade || r.grade || '—'}`,
        qc: r.qc_name || '—', approved_by: r.approved_by || '', final_reason: r.final_reason || '', lm_notes: r.lm_notes || '',
      }))
    setHistoryItems([...pRows, ...gRows])
    setLoadingH(false)
  }, [db])

  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  const historySearchLower = historySearch.trim().toLowerCase()
  const historyDateFiltered = historyItems.filter((item: any) => historySearchLower
    ? [item.batch, item.qc, item.meta, item.approved_by, item.final_reason, item.lm_notes].some((v: string) => (v || '').toLowerCase().includes(historySearchLower))
    : (item.date >= weekStart && item.date <= addDays(weekStart, 6)))
  const historyCounts = {
    all: historyDateFiltered.length,
    outstanding: historyDateFiltered.filter((i: any) => i.status === 'Outstanding').length,
    approved: historyDateFiltered.filter((i: any) => i.status === 'Pass').length,
    concession: historyDateFiltered.filter((i: any) => i.status === 'Concession').length,
    fail: historyDateFiltered.filter((i: any) => i.status === 'Fail').length,
  }
  const historyFiltered = historyDateFiltered.filter((item: any) => {
    if (historyFilter === 'all') return true
    if (historyFilter === 'outstanding') return item.status === 'Outstanding'
    if (historyFilter === 'approved') return item.status === 'Pass'
    if (historyFilter === 'concession') return item.status === 'Concession'
    if (historyFilter === 'fail') return item.status === 'Fail'
    return true
  }).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))

  // Build a per-station summary of batches + OOS highlights for the selected date range
  function pastSummary() {
    return past.map((r: any) => {
      const flags = r.d.oos_flags ?? computePastOosFlags(r.d)
      return {
        batch: r.batch_number || r.d.batch_number || '—',
        date: (r.d.production_date || '').slice(0, 10),
        status: r.d.final_result || (r.d.batch_status === 'awaiting_approval' ? 'Awaiting LM' : 'In progress'),
        samples: (r.d.samples ?? []).length,
        oos: flags,
      }
    })
  }
  function granSummary() {
    return gran.map((r: any) => {
      const oos = (r._samples || []).filter((s: any) => (s.violations || []).length > 0)
        .map((s: any) => ({ bag: s.bulk_bag_serial || `Sample ${s.id}`, time: s.sample_time, fails: (s.violations || []).map((v: string) => ({ field: v })) }))
      return {
        batch: r.batch_number || '—',
        date: String(r.production_date || r.date || '').slice(0, 10),
        status: r.final_status || (r.lm_status === 'awaiting_approval' ? 'Awaiting LM' : 'In progress'),
        grade: r.type_grade || r.grade || '—',
        qc: r.qc_name || '—',
        oos,
      }
    })
  }
  function sievSummary() {
    return siev.map((r: any) => ({
      batch: r.serial_number || r.lot_number || '—',
      date: String(r.date || '').slice(0, 10),
      product: r.product || '—',
      grade: [r.grade, r.variant].filter(Boolean).join(' / '),
      fail: String(r.pass_status || '').toLowerCase() === 'fail',
      violations: Array.isArray(r.violations) ? r.violations : [],
    }))
  }

  // Distinct production dates present in a station's rows within the selected range
  function datesFor(rows: any[]) {
    return Array.from(new Set(rows.map(r => r.date).filter(Boolean))).sort()
  }

  async function signOff(station: string, rows: any[]) {
    if (!canSignoff) return
    const dates = datesFor(rows)
    const already = signoffs[station] || {}
    const unsigned = dates.filter(d => !already[d])
    if (unsigned.length === 0) return
    const notes = prompt(`Sign-off note for ${station} — ${unsigned.length} day${unsigned.length > 1 ? 's' : ''} (${unsigned.join(', ')}), optional:`, '') ?? ''
    const rowsByDate: Record<string, any[]> = {}
    for (const r of rows) (rowsByDate[r.date] = rowsByDate[r.date] || []).push(r)
    const payload = unsigned.map(d => ({
      workcenter: station, production_date: d, signed_by: whoAmI, signed_at: new Date().toISOString(),
      notes: notes || null, summary: rowsByDate[d] || [],
    }))
    const { error } = await db.schema('qms').from('daily_signoffs').upsert(payload, { onConflict: 'workcenter,production_date' })
    if (error) { alert('Sign-off failed: ' + error.message); return }
    loadDaily()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      {decisionModal && (
        <LmDecisionModal
          result={decisionModal.result}
          batchLabel={decisionModal.item.batch}
          onClose={() => setDecisionModal(null)}
          onConfirm={comment => decide(decisionModal.item, decisionModal.result, comment)}
        />
      )}
      <div className="mb-4">
        <h1 className="font-display font-bold text-[22px] text-text">Lab Manager</h1>
        <p className="text-[12px] text-text-muted">Approve allocated runs and sign off the daily station overview.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {([['approvals', `✅ Pending Approvals${pending.length ? ` (${pending.length})` : ''}`], ['daily', '📅 Daily Overview & Sign-off'], ['history', '🗓 Approvals History']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`px-4 py-2 rounded-xl text-[12px] font-semibold border transition-colors ${tab === k ? 'bg-brand text-white border-brand' : 'bg-surface-card text-text-muted border-surface-rule hover:text-text'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Pending approvals — grouped by station, spans every production day (no date filter) ── */}
      {tab === 'approvals' && (
        <div className="space-y-6">
          {!canApprove && <div className="text-[12px] text-warn bg-warn/8 rounded-lg px-3 py-2">You don't have approval rights — view only.</div>}
          {loadingP && <div className="text-center py-10 text-text-muted text-[12px] animate-pulse">Loading…</div>}
          {!loadingP && STATIONS.map(st => {
            const items = st.key === 'sieving' ? [] : pending.filter((p: any) => p.kind === st.key)
            return (
              <div key={st.key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-[13px] text-text">{st.label}</span>
                  <span className="text-[11px] text-text-muted">{items.length} awaiting approval — all production days</span>
                </div>
                {st.key === 'sieving' ? (
                  <div className="bg-surface-card border border-surface-rule rounded-xl p-4 text-[12px] text-text-muted">
                    Sieving runs are graded Pass/Fail automatically at capture and don't route through Lab Manager approval.
                  </div>
                ) : items.length === 0 ? (
                  <div className="bg-surface-card border border-surface-rule rounded-xl p-6 text-center text-text-muted text-[12px]">No {st.key} runs awaiting approval. 🎉</div>
                ) : (
                  <div className="space-y-3">
                    {items.map((item: any) => {
                      const flags = item.oos || []
                      return (
                        <div key={`${item.kind}-${item.id}`} className="bg-surface-card border border-surface-rule rounded-xl p-4">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-[14px] text-text">{item.batch}</span>
                              </div>
                              <div className="text-[11px] text-text-muted">{item.meta}</div>
                              <div className="text-[11px] text-text-muted mt-0.5">
                                {item.samples} samples · allocated by {item.allocated_by || '—'} {item.allocated_at ? `· ${fmtDateTime(item.allocated_at)}` : ''}
                              </div>
                            </div>
                            {canApprove && (
                              <div className="flex gap-2">
                                <button onClick={() => decide(item, 'Pass', '')} className="px-3 py-1.5 rounded-lg border-2 border-ok/40 bg-ok/10 text-ok text-[11px] font-bold">Pass</button>
                                <button onClick={() => setDecisionModal({ item, result: 'Concession' })} className="px-3 py-1.5 rounded-lg border-2 border-warn/40 bg-warn/10 text-warn text-[11px] font-bold">Concession</button>
                                <button onClick={() => setDecisionModal({ item, result: 'Fail' })} className="px-3 py-1.5 rounded-lg border-2 border-err/40 bg-err/10 text-err text-[11px] font-bold">Fail</button>
                              </div>
                            )}
                          </div>
                          {/* Standing Lab Manager note — always available, independent of the decision */}
                          <div className="mt-3 pt-3 border-t border-surface-rule">
                            <label className="block text-[10px] font-mono uppercase tracking-wide text-text-muted mb-1">📝 Lab Manager Notes</label>
                            <LmNotesBox key={`${item.kind}-${item.id}`} initialValue={item.lm_notes} onSave={text => saveLmNotes(item, text)} disabled={!canApprove} />
                          </div>
                          {/* Out-of-spec highlights */}
                          <div className="mt-3 pt-3 border-t border-surface-rule">
                            {flags.length === 0 ? (
                              <div className="text-[11px] text-ok">✓ No out-of-spec bags/boxes detected.</div>
                            ) : (
                              <div className="space-y-1">
                                <div className="text-[11px] font-semibold text-err">⚠ {flags.length} out-of-spec bag/box{flags.length > 1 ? 'es' : ''}:</div>
                                {flags.map((f: any, i: number) => (
                                  <div key={i} className="text-[11px] text-text-muted">
                                    <span className="font-mono font-semibold text-text">{f.bag}</span>{f.time ? ` (${f.time})` : ''} — {f.fails.map((x: any) => `${x.field}${x.value !== '' && x.value != null ? `: ${x.value}` : ''}${x.spec ? ` [${x.spec.min ?? ''}–${x.spec.max ?? ''}]` : ''}`).join(', ')}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Daily overview & sign-off ── */}
      {tab === 'daily' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[11px] font-mono uppercase tracking-wide text-text-muted">From</label>
            <input type="date" value={dayFrom} onChange={e => setDayFrom(e.target.value)}
              className="px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-[12px] bg-surface-card" />
            <label className="text-[11px] font-mono uppercase tracking-wide text-text-muted">To</label>
            <input type="date" value={dayTo} onChange={e => setDayTo(e.target.value)}
              className="px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-[12px] bg-surface-card" />
            <button onClick={() => { const t = todayISO(); setDayFrom(t); setDayTo(t) }}
              className="px-3 py-1.5 rounded-lg border border-brand/30 bg-brand/10 text-brand text-[11px] font-semibold">Today</button>
            <button onClick={() => { setDayFrom(mondayOf(todayISO())); setDayTo(addDays(mondayOf(todayISO()), 6)) }}
              className="px-3 py-1.5 rounded-lg border border-brand/30 bg-brand/10 text-brand text-[11px] font-semibold">This week</button>
          </div>

          {loadingD && <div className="text-center py-10 text-text-muted text-[12px] animate-pulse">Loading…</div>}

          {!loadingD && STATIONS.map(st => {
            let rows: any[] = []
            let oosCount = 0
            if (st.key === 'pasteuriser') { const s = pastSummary(); rows = s; oosCount = s.reduce((a, b) => a + (b.oos?.length || 0), 0) }
            else if (st.key === 'granule') { const s = granSummary(); rows = s; oosCount = s.reduce((a, b) => a + (b.oos?.length || 0), 0) }
            else { const s = sievSummary(); rows = s; oosCount = s.filter(x => x.fail).length }

            const dates = datesFor(rows)
            const soForStation = signoffs[st.key] || {}
            const signedDates = dates.filter(d => soForStation[d])
            const allSigned = dates.length > 0 && signedDates.length === dates.length
            const lastSigned = signedDates.length ? soForStation[signedDates[signedDates.length - 1]] : null

            return (
              <div key={st.key} className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
                  <span className="font-semibold text-[14px] text-text">{st.label}</span>
                  <div className="flex items-center gap-3">
                    {oosCount > 0 && <span className="text-[11px] font-bold text-err">⚠ {oosCount} OOS</span>}
                    <span className="text-[11px] text-text-muted">{rows.length} {st.key === 'sieving' ? 'runs' : 'batches'} · {dates.length} day{dates.length === 1 ? '' : 's'}</span>
                    {allSigned ? (
                      <span className="text-[11px] text-ok font-semibold">✓ All signed off{lastSigned ? ` · last by ${lastSigned.signed_by} ${fmtDateTime(lastSigned.signed_at)}` : ''}</span>
                    ) : canSignoff ? (
                      <button
                        onClick={() => signOff(st.key, rows)}
                        disabled={dates.length === 0}
                        className="px-3 py-1 rounded-lg border border-brand/40 bg-brand/10 text-brand text-[11px] font-semibold disabled:opacity-40">
                        ✍ Sign off {dates.length - signedDates.length} day{dates.length - signedDates.length === 1 ? '' : 's'}
                      </button>
                    ) : dates.length > 0 ? (
                      <span className="text-[11px] text-warn font-semibold">{signedDates.length}/{dates.length} days signed off</span>
                    ) : null}
                  </div>
                </div>
                <div className="p-4">
                  {rows.length === 0 ? (
                    <div className="text-[12px] text-text-muted text-center py-3">No {st.key} activity between {fmtDay(dayFrom)} and {fmtDay(dayTo)}.</div>
                  ) : st.key === 'pasteuriser' ? (
                    <div className="space-y-2">
                      {rows.map((b: any, i: number) => (
                        <div key={i} className="flex flex-col gap-1 border-b border-surface-rule/60 pb-2 last:border-0">
                          <div className="flex items-center gap-2 text-[12px]">
                            <span className="font-mono font-semibold text-text">{b.batch}</span>
                            <span className="text-text-muted">· {b.date || '—'} · {b.samples} samples ·</span>
                            <span className={`font-semibold ${b.status === 'Pass' ? 'text-ok' : b.status === 'Fail' ? 'text-err' : b.status === 'Concession' ? 'text-warn' : 'text-text-muted'}`}>{b.status}</span>
                            {soForStation[b.date] && <span className="text-[10px] text-ok">✓ signed</span>}
                          </div>
                          {b.oos.length > 0 && (
                            <div className="text-[11px] text-err pl-2">
                              ⚠ {b.oos.map((f: any) => `${f.bag}${f.time ? ` (${f.time})` : ''}: ${f.fails.map((x: any) => x.field).join(', ')}`).join('  •  ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : st.key === 'granule' ? (
                    <div className="space-y-2">
                      {rows.map((b: any, i: number) => (
                        <div key={i} className="flex flex-col gap-1 border-b border-surface-rule/60 pb-2 last:border-0">
                          <div className="flex items-center gap-2 text-[12px]">
                            <span className="font-mono font-semibold text-text">{b.batch}</span>
                            <span className="text-text-muted">· {b.date || '—'} · {b.grade} · QC {b.qc} ·</span>
                            <span className={`font-semibold ${b.status === 'Pass' ? 'text-ok' : b.status === 'Fail' ? 'text-err' : b.status === 'Concession' ? 'text-warn' : 'text-text-muted'}`}>{b.status}</span>
                            {soForStation[b.date] && <span className="text-[10px] text-ok">✓ signed</span>}
                          </div>
                          {b.oos.length > 0 && (
                            <div className="text-[11px] text-err pl-2">
                              ⚠ {b.oos.map((f: any) => `${f.bag}${f.time ? ` (${f.time})` : ''}: ${f.fails.map((x: any) => x.field).join(', ')}`).join('  •  ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {rows.map((b: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-[12px]">
                          <span className="font-mono font-semibold text-text">{b.batch}</span>
                          <span className="text-text-muted">· {b.date || '—'} · {b.product} {b.grade ? `· ${b.grade}` : ''} ·</span>
                          <span className={b.fail ? 'text-err font-semibold' : 'text-ok'}>{b.fail ? '⚠ Fail' : 'Pass'}</span>
                          {b.fail && b.violations.length > 0 && <span className="text-[11px] text-err">({b.violations.join(', ')})</span>}
                          {soForStation[b.date] && <span className="text-[10px] text-ok">✓ signed</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {signedDates.filter(d => soForStation[d]?.notes).map(d => (
                    <div key={d} className="mt-2 text-[11px] text-text-muted italic">📝 {d}: {soForStation[d].notes}</div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Approvals history: weekly, searchable across pasteuriser + granule ── */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekStart(w => addDays(w, -7))} className="px-2 py-1.5 rounded-lg border border-surface-rule bg-surface-card text-[12px] font-semibold">◀</button>
              <span className="text-[12px] font-semibold text-text whitespace-nowrap">Week of {fmtDay(weekStart)} – {fmtDay(addDays(weekStart, 6))}</span>
              <button onClick={() => setWeekStart(w => addDays(w, 7))} className="px-2 py-1.5 rounded-lg border border-surface-rule bg-surface-card text-[12px] font-semibold">▶</button>
              <button onClick={() => setWeekStart(mondayOf(todayISO()))} className="px-3 py-1.5 rounded-lg border border-brand/30 bg-brand/10 text-brand text-[11px] font-semibold">This week</button>
            </div>
            <input value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="🔍 Search batch, QC, customer, notes…"
              className="flex-1 min-w-[220px] px-3 py-1.5 border border-surface-rule rounded-lg text-[12px] bg-surface-card" />
          </div>
          {historySearchLower && <div className="text-[11px] text-text-muted">Searching all history — not limited to the selected week.</div>}

          <div className="flex gap-2 flex-wrap">
            {([['all', 'All'], ['outstanding', '⏳ Outstanding'], ['approved', '✓ Approved'], ['concession', '⚠ Concession'], ['fail', '✗ Fail']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setHistoryFilter(k)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${historyFilter === k ? 'bg-brand text-white border-brand' : 'bg-surface-card text-text-muted border-surface-rule hover:text-text'}`}>
                {l} ({(historyCounts as any)[k]})
              </button>
            ))}
          </div>

          {loadingH && <div className="text-center py-10 text-text-muted text-[12px] animate-pulse">Loading…</div>}
          {!loadingH && historyFiltered.length === 0 && (
            <div className="bg-surface-card border border-surface-rule rounded-xl p-10 text-center text-text-muted text-[13px]">No matching records.</div>
          )}
          <div className="space-y-2">
            {historyFiltered.map((item: any) => (
              <div key={`${item.kind}-${item.id}`} className="bg-surface-card border border-surface-rule rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[13px] text-text">{item.batch}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${item.kind === 'pasteuriser' ? 'bg-info/10 text-info' : 'bg-brand/10 text-brand'}`}>{item.kind === 'pasteuriser' ? '🫗 Pasteuriser' : '🔬 Granule'}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${item.status === 'Pass' ? 'bg-ok/15 text-ok' : item.status === 'Fail' ? 'bg-err/15 text-err' : item.status === 'Concession' ? 'bg-warn/15 text-warn' : 'bg-text-faint/15 text-text-muted'}`}>{item.status}</span>
                    </div>
                    <div className="text-[11px] text-text-muted">{item.date || '—'} · {item.meta} · QC {item.qc}</div>
                    {item.approved_by && <div className="text-[10px] text-text-muted">approved by {item.approved_by}</div>}
                  </div>
                </div>
                {item.final_reason && (
                  <div className="mt-2 text-[11px] text-warn bg-warn/8 border border-warn/20 rounded-lg px-2 py-1">💬 Decision comment: {item.final_reason}</div>
                )}
                {item.lm_notes && (
                  <div className="mt-2 text-[11px] text-info bg-info/8 border border-info/20 rounded-lg px-2 py-1">📝 LM notes: {item.lm_notes}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

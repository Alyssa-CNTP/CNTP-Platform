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
import { computePastOosFlags } from '../pasteuriser/page'

const STATIONS = [
  { key: 'pasteuriser', label: '🫗 Pasteuriser' },
  { key: 'granule',     label: '🔬 Granule Line' },
  { key: 'sieving',     label: '🧪 Sieving Tower' },
] as const

function parseData(r: any) {
  try { return typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}) } catch { return {} }
}
function fmtDateTime(s?: string) {
  return s ? new Date(s).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
}
const todayISO = () => new Date().toISOString().slice(0, 10)

export default function LabManagerPage() {
  const { p, session } = useAuth()
  const db = getDb()
  const canApprove = p('can_approve_runs')
  const canSignoff = p('can_signoff_day')
  const whoAmI = session?.user?.email?.split('@')[0] || 'unknown'

  const [tab, setTab] = useState<'approvals' | 'daily'>('approvals')

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
        oos: r.d.oos_flags ?? computePastOosFlags(r.d), raw: r,
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
          samples: samples.length, allocated_by: r.allocated_by, allocated_at: r.allocated_at, oos, raw: r,
        }
      })
    setPending([...past, ...gran])
    setLoadingP(false)
  }, [db])

  useEffect(() => { loadPending() }, [loadPending])

  async function decide(item: any, result: 'Pass' | 'Fail' | 'Concession') {
    let reason = ''
    if (result !== 'Pass') {
      const r = prompt(`Reason for "${result}" (required):`, '')
      if (r === null) return
      if (!r.trim()) { alert('A reason is required'); return }
      reason = r.trim()
    }
    if (item.kind === 'pasteuriser') {
      const d = item.raw.d
      const newData = { ...d, final_result: result, finalised_at: new Date().toISOString(), batch_status: 'complete', final_reason: reason || undefined, approved_by: whoAmI, oos_flags: d.oos_flags ?? computePastOosFlags(d) }
      const { error } = await db.schema('qms').from('quality_records').update({ data_json: newData }).eq('id', item.id)
      if (error) { alert('Save failed: ' + error.message); return }
    } else {
      const { error } = await db.schema('qms').from('granule_runs').update({ final_status: result, overall_status: result, approved_by: whoAmI, final_reason: reason || null, lm_status: 'complete' }).eq('id', item.id)
      if (error) { alert('Save failed: ' + error.message); return }
    }
    setPending(prev => prev.filter(x => !(x.kind === item.kind && x.id === item.id)))
  }

  // ── Daily overview ─────────────────────────────────────────────────────────
  const [day, setDay] = useState(todayISO())
  const [past, setPast] = useState<any[]>([])
  const [gran, setGran] = useState<any[]>([])
  const [siev, setSiev] = useState<any[]>([])
  const [signoffs, setSignoffs] = useState<Record<string, any>>({})
  const [loadingD, setLoadingD] = useState(true)

  const loadDaily = useCallback(async () => {
    setLoadingD(true)
    const [pRes, gRes, gsRes, sRes, soRes] = await Promise.all([
      db.schema('qms').from('quality_records').select('*').eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run').order('created_at', { ascending: false }).limit(500),
      db.schema('qms').from('granule_runs').select('*').order('created_at', { ascending: false }).limit(500),
      db.schema('qms').from('granule_samples').select('*').limit(3000),
      db.schema('qms').from('sd_runs').select('*').order('created_at', { ascending: false }).limit(1000),
      db.schema('qms').from('daily_signoffs').select('*').eq('production_date', day),
    ])
    const pRows = (pRes.data ?? []).map((r: any) => ({ ...r, d: parseData(r) }))
      .filter((r: any) => (r.d.production_date || '').slice(0, 10) === day)
    const gsByRun: Record<number, any[]> = {}
    for (const s of (gsRes.data ?? [])) (gsByRun[s.run_id] = gsByRun[s.run_id] || []).push(s)
    const gRows = (gRes.data ?? []).filter((r: any) => String(r.production_date || r.date || '').slice(0, 10) === day)
      .map((r: any) => ({ ...r, _samples: gsByRun[r.id] || [] }))
    const sRows = (sRes.data ?? []).filter((r: any) => String(r.date || '').slice(0, 10) === day)
    const so: Record<string, any> = {}
    for (const row of (soRes.data ?? [])) so[row.workcenter] = row
    setPast(pRows); setGran(gRows); setSiev(sRows); setSignoffs(so)
    setLoadingD(false)
  }, [db, day])

  useEffect(() => { if (tab === 'daily') loadDaily() }, [tab, loadDaily])

  // Build a per-station summary of batches + OOS highlights for the selected day
  function pastSummary() {
    return past.map((r: any) => {
      const flags = r.d.oos_flags ?? computePastOosFlags(r.d)
      return {
        batch: r.batch_number || r.d.batch_number || '—',
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
      product: r.product || '—',
      grade: [r.grade, r.variant].filter(Boolean).join(' / '),
      fail: String(r.pass_status || '').toLowerCase() === 'fail',
      violations: Array.isArray(r.violations) ? r.violations : [],
    }))
  }

  async function signOff(station: string, summary: any) {
    if (!canSignoff) return
    const notes = prompt(`Sign-off note for ${station} on ${day} (optional):`, '') ?? ''
    const { error } = await db.schema('qms').from('daily_signoffs').upsert(
      { workcenter: station, production_date: day, signed_by: whoAmI, signed_at: new Date().toISOString(), notes: notes || null, summary },
      { onConflict: 'workcenter,production_date' },
    )
    if (error) { alert('Sign-off failed: ' + error.message); return }
    loadDaily()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <div className="mb-4">
        <h1 className="font-display font-bold text-[22px] text-text">Lab Manager</h1>
        <p className="text-[12px] text-text-muted">Approve allocated runs and sign off the daily station overview.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {([['approvals', `✅ Pending Approvals${pending.length ? ` (${pending.length})` : ''}`], ['daily', '📅 Daily Overview & Sign-off']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`px-4 py-2 rounded-xl text-[12px] font-semibold border transition-colors ${tab === k ? 'bg-brand text-white border-brand' : 'bg-surface-card text-text-muted border-surface-rule hover:text-text'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Pending approvals ── */}
      {tab === 'approvals' && (
        <div className="space-y-3">
          {!canApprove && <div className="text-[12px] text-warn bg-warn/8 rounded-lg px-3 py-2">You don't have approval rights — view only.</div>}
          {loadingP && <div className="text-center py-10 text-text-muted text-[12px] animate-pulse">Loading…</div>}
          {!loadingP && pending.length === 0 && (
            <div className="bg-surface-card border border-surface-rule rounded-xl p-10 text-center text-text-muted text-[13px]">No runs awaiting approval. 🎉</div>
          )}
          {pending.map((item: any) => {
            const flags = item.oos || []
            return (
              <div key={`${item.kind}-${item.id}`} className="bg-surface-card border border-surface-rule rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[14px] text-text">{item.batch}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${item.kind === 'pasteuriser' ? 'bg-info/10 text-info' : 'bg-brand/10 text-brand'}`}>{item.kind === 'pasteuriser' ? '🫗 Pasteuriser' : '🔬 Granule'}</span>
                    </div>
                    <div className="text-[11px] text-text-muted">{item.meta}</div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {item.samples} samples · allocated by {item.allocated_by || '—'} {item.allocated_at ? `· ${fmtDateTime(item.allocated_at)}` : ''}
                    </div>
                  </div>
                  {canApprove && (
                    <div className="flex gap-2">
                      <button onClick={() => decide(item, 'Pass')} className="px-3 py-1.5 rounded-lg border-2 border-ok/40 bg-ok/10 text-ok text-[11px] font-bold">Pass</button>
                      <button onClick={() => decide(item, 'Concession')} className="px-3 py-1.5 rounded-lg border-2 border-warn/40 bg-warn/10 text-warn text-[11px] font-bold">Concession</button>
                      <button onClick={() => decide(item, 'Fail')} className="px-3 py-1.5 rounded-lg border-2 border-err/40 bg-err/10 text-err text-[11px] font-bold">Fail</button>
                    </div>
                  )}
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

      {/* ── Daily overview & sign-off ── */}
      {tab === 'daily' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-mono uppercase tracking-wide text-text-muted">Production day</label>
            <input type="date" value={day} onChange={e => setDay(e.target.value)}
              className="px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-[12px] bg-surface-card" />
          </div>

          {loadingD && <div className="text-center py-10 text-text-muted text-[12px] animate-pulse">Loading…</div>}

          {!loadingD && STATIONS.map(st => {
            const so = signoffs[st.key]
            let rows: any[] = []
            let oosCount = 0
            if (st.key === 'pasteuriser') { const s = pastSummary(); rows = s; oosCount = s.reduce((a, b) => a + (b.oos?.length || 0), 0) }
            else if (st.key === 'granule') { const s = granSummary(); rows = s; oosCount = s.reduce((a, b) => a + (b.oos?.length || 0), 0) }
            else { const s = sievSummary(); rows = s; oosCount = s.filter(x => x.fail).length }

            return (
              <div key={st.key} className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
                  <span className="font-semibold text-[14px] text-text">{st.label}</span>
                  <div className="flex items-center gap-3">
                    {oosCount > 0 && <span className="text-[11px] font-bold text-err">⚠ {oosCount} OOS</span>}
                    <span className="text-[11px] text-text-muted">{rows.length} {st.key === 'sieving' ? 'runs' : 'batches'}</span>
                    {so ? (
                      <span className="text-[11px] text-ok font-semibold">✓ Signed off by {so.signed_by} · {fmtDateTime(so.signed_at)}</span>
                    ) : canSignoff ? (
                      <button
                        onClick={() => signOff(st.key, st.key === 'pasteuriser' ? pastSummary() : st.key === 'granule' ? granSummary() : sievSummary())}
                        disabled={rows.length === 0}
                        className="px-3 py-1 rounded-lg border border-brand/40 bg-brand/10 text-brand text-[11px] font-semibold disabled:opacity-40">✍ Sign off</button>
                    ) : null}
                  </div>
                </div>
                <div className="p-4">
                  {rows.length === 0 ? (
                    <div className="text-[12px] text-text-muted text-center py-3">No {st.key} activity on {day}.</div>
                  ) : st.key === 'pasteuriser' ? (
                    <div className="space-y-2">
                      {rows.map((b: any, i: number) => (
                        <div key={i} className="flex flex-col gap-1 border-b border-surface-rule/60 pb-2 last:border-0">
                          <div className="flex items-center gap-2 text-[12px]">
                            <span className="font-mono font-semibold text-text">{b.batch}</span>
                            <span className="text-text-muted">· {b.samples} samples ·</span>
                            <span className={`font-semibold ${b.status === 'Pass' ? 'text-ok' : b.status === 'Fail' ? 'text-err' : b.status === 'Concession' ? 'text-warn' : 'text-text-muted'}`}>{b.status}</span>
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
                            <span className="text-text-muted">· {b.grade} · QC {b.qc} ·</span>
                            <span className={`font-semibold ${b.status === 'Pass' ? 'text-ok' : b.status === 'Fail' ? 'text-err' : b.status === 'Concession' ? 'text-warn' : 'text-text-muted'}`}>{b.status}</span>
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
                          <span className="text-text-muted">· {b.product} {b.grade ? `· ${b.grade}` : ''} ·</span>
                          <span className={b.fail ? 'text-err font-semibold' : 'text-ok'}>{b.fail ? '⚠ Fail' : 'Pass'}</span>
                          {b.fail && b.violations.length > 0 && <span className="text-[11px] text-err">({b.violations.join(', ')})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {so?.notes && <div className="mt-2 text-[11px] text-text-muted italic">📝 {so.notes}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

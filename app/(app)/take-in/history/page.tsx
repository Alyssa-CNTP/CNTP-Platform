'use client'

// app/(app)/take-in/history/page.tsx
//
// ~500 deliveries a season. The working screens cannot also be the archive, so
// a batch that is finished (COA issued, rejected, or returned) drops out of
// them and lives here.
//
// ONE SEARCH BOX over every number on every document — batch, GRN, Ontvangsnota,
// weighbridge, producer lot, producer, land — because on the floor people hold a
// piece of paper with a number on it and do not know which kind it is.
//
// VOIDED DOCUMENTS ARE IN THE INDEX. "What happened to GRN-GS-4531?" is asked
// about a voided one as often as a live one, and a void is a record, not a
// deletion.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { takeinDb, loadDepots, visibleDepots, errMsg } from '@/lib/takein/db'
import { stageOf, isFinalised, nettKg, type Stage } from '@/lib/core/takein/grading'
import type { Depot, BatchEvent, LabRow, FrozenFigures, PanelOutcome } from '@/lib/takein/types'
import { Loader2, AlertTriangle, Search } from 'lucide-react'

interface Doc {
  id: string; kind: string; doc_no: string; issued_at: string; issued_by_name: string | null
  signed_by: string | null; signed_at: string | null; frozen: FrozenFigures | null
  voided_at: string | null; voided_by_name: string | null
  void_category: string | null; void_reason: string | null
}
interface Row {
  id: string; batch_no: string; warehouse_id: string; delivered_on: string
  begin_kg: number | null; end_kg: number | null; bags: number
  weighbridge_no: string | null; producer_lot: string | null; tea_court: string | null
  driver: string | null; vehicle: string | null
  returned_at: string | null; returned_reason: string | null
  panel_outcome: PanelOutcome | null; panel_grade: string | null
  panel_reason: string | null; panel_covered: string[] | null
  contract: { contract_no: string; variant: string
              producer: { name: string; acumatica_code: string } | null } | null
  batch_lands: { ordinal: number; name: string }[]
  documents: Doc[]
  lab_results: LabRow[]
}

const STAGE_LABEL: Record<Stage, string> = {
  awaiting_mini: 'Awaiting mini lab', awaiting_internal: 'Awaiting Blackheath',
  awaiting_external: 'Awaiting external lab', panel: 'Panel decision',
  approved: 'Approved', rejected: 'Rejected', returned: 'Returned',
}
const KIND_LABEL: Record<string, string> = {
  grn: 'GRN', afleweringsbewys: 'Afleweringsbewys', coa: 'COA',
}

/** What History is showing. 500 deliveries a year means the default is
 *  'open' — everything finalised is still one click away. */
type ShowFilter = 'open' | 'done' | 'void' | 'all'

export default function HistoryPage() {
  const router = useRouter()
  const { depotCodes } = useAuth()
  const [depots, setDepots] = useState<Depot[]>([])
  const [rows, setRows]     = useState<Row[]>([])
  const [events, setEvents] = useState<BatchEvent[]>([])
  const [q, setQ]           = useState('')
  const [show, setShow]     = useState<ShowFilter>('open')
  const [selId, setSelId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]       = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const all = await loadDepots()
      const mine = visibleDepots(all, depotCodes)
      setDepots(mine)
      if (!mine.length) { setRows([]); return }
      const { data, error } = await takeinDb().from('batches')
        .select(`
          id, batch_no, warehouse_id, delivered_on, begin_kg, end_kg, bags,
          weighbridge_no, producer_lot, tea_court, driver, vehicle,
          returned_at, returned_reason, panel_outcome, panel_grade, panel_reason, panel_covered,
          contract:contract_id ( contract_no, variant,
                                 producer:producer_id ( name, acumatica_code ) ),
          batch_lands ( ordinal, name ),
          documents ( id, kind, doc_no, issued_at, issued_by_name, signed_by, signed_at, frozen,
                      voided_at, voided_by_name, void_category, void_reason ),
          lab_results ( source, sieve_json, moisture, density, shade, aroma, colour, taste,
                        agrees, residue_group, pa_group )
        `)
        .in('warehouse_id', mine.map(d => d.id))
        .order('delivered_on', { ascending: false })
        .limit(1000)
      if (error) throw error
      setRows((data as unknown as Row[]) ?? [])
    } catch (e: unknown) { setErr(errMsg(e, 'Could not load history.')) }
    finally { setLoading(false) }
  }, [depotCodes.join(',')])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selId) { setEvents([]); return }
    void (async () => {
      const { data } = await takeinDb().from('batch_events')
        .select('*').eq('batch_id', selId).order('at', { ascending: false }).limit(300)
      setEvents((data as unknown as BatchEvent[]) ?? [])
    })()
  }, [selId])

  const graded = useMemo(() => rows.map(r => {
    const lab = (s: string) => r.lab_results?.find((l: LabRow) => l.source === s) ?? null
    const st = stageOf({ mini: lab('mini'), internal: lab('internal'), external: lab('external'),
      organic: /organic/i.test(r.contract?.variant ?? ''), binding: {},
      returned: !!r.returned_at,
      panel: r.panel_outcome ? { outcome: r.panel_outcome, grade: r.panel_grade,
             reason: r.panel_reason ?? '', covered: r.panel_covered ?? [] } : null })
    const hasCoa = r.documents?.some(d => d.kind === 'coa' && !d.voided_at) ?? false
    // Every number anyone might be holding, voided documents included.
    const haystack = [
      r.batch_no, r.weighbridge_no, r.producer_lot, r.tea_court, r.driver, r.vehicle,
      r.contract?.contract_no, r.contract?.producer?.name, r.contract?.producer?.acumatica_code,
      ...(r.batch_lands ?? []).map(l => l.name),
      ...(r.documents ?? []).map(d => d.doc_no),
      STAGE_LABEL[st.stage], r.returned_reason,
    ].filter(Boolean).join(' ').toLowerCase()
    return { row: r, stage: st.stage, final: isFinalised(st.stage, hasCoa), haystack }
  }), [rows])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return graded
      .filter(g => show === 'all' ? true
        : show === 'open' ? !g.final
        : show === 'done' ? g.final
        : (g.row.documents ?? []).some(d => !!d.voided_at))
      .filter(g => !needle || g.haystack.includes(needle))
  }, [graded, q, show])

  const counts = useMemo(() => ({
    open:   graded.filter(g => !g.final).length,
    done:   graded.filter(g => g.final).length,
    voided: graded.reduce((a, g) => a + (g.row.documents ?? []).filter(d => !!d.voided_at).length, 0),
    total:  graded.length,
  }), [graded])

  const sel = useMemo(() => rows.find(r => r.id === selId) ?? null, [rows, selId])
  const kg = (n: number) => n.toLocaleString('en-ZA', { maximumFractionDigits: 0 })

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
    </div>
  )

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{err}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Open"     value={String(counts.open)}   unit="still need someone" tone={counts.open ? 'warn' : 'ok'} />
        <Kpi label="Finalised" value={String(counts.done)}  unit="paid-ready, rejected or returned" tone="ok" />
        <Kpi label="Voided documents" value={String(counts.voided)} unit="kept, never deleted" tone={counts.voided ? 'warn' : undefined} />
        <Kpi label="Season"   value={String(counts.total)}  unit={`deliveries at ${depots.map(d => d.code).join(' + ') || '—'}`} />
      </div>

      <section className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_260px]">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <input value={q} onChange={e => setQ(e.target.value)} type="search"
                placeholder="GRN-GS-4531 · GS-0293 · GD-FD0000111 · 102915 · producer · land"
                className="w-full rounded-lg border border-surface-rule bg-surface-card py-1.5 pl-8 pr-2.5 text-[13px] text-text" />
            </div>
            <span className="mt-0.5 block text-[10px] text-text-faint">
              {q ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} — every number on every document, voided ones too`
                 : 'Any number on any document finds the delivery it belongs to'}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">Show</span>
            <select value={show} onChange={e => { setShow(e.target.value as ShowFilter); setSelId(null) }}
              className="w-full rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[13px] text-text">
              <option value="open">Open — still needs someone</option>
              <option value="done">Finalised</option>
              <option value="void">With voided documents</option>
              <option value="all">Everything</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-surface-rule bg-surface-card">
        <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
          <span className="font-display text-[14px] font-semibold text-text">Deliveries</span>
          <span className="font-mono text-[11px] text-text-muted">{filtered.length} of {counts.total}</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-surface-rule bg-surface-raised">
              {['Batch', 'Producer', 'Date', 'Documents', 'State', 'Nett kg', ''].map(h => (
                <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(g => {
                const r = g.row
                const afl = r.documents?.find(d => d.kind === 'afleweringsbewys' && !d.voided_at)
                const voided = (r.documents ?? []).filter(d => !!d.voided_at).length
                return (
                  <tr key={r.id} className={`border-b border-surface-rule last:border-0 ${r.id === selId ? 'bg-accent-bg' : ''}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[12px] font-semibold text-text">{r.batch_no}</span>
                      <span className="block font-mono text-[10px] text-text-faint">
                        {depots.find(d => d.id === r.warehouse_id)?.code}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[12px] text-text">{r.contract?.producer?.name ?? '—'}</span>
                      <span className="block font-mono text-[10px] text-text-faint">{r.contract?.contract_no}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text-muted">{r.delivered_on}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-text">
                      {(r.documents ?? []).filter(d => !d.voided_at).map(d => (
                        <span key={d.id} className="block">{d.doc_no} <span className="text-text-faint">{KIND_LABEL[d.kind]?.toLowerCase()}</span></span>
                      ))}
                      {!!voided && <span className="mt-0.5 inline-block rounded-full bg-err-bg px-1.5 py-0.5 text-[9px] font-semibold text-err">{voided} voided</span>}
                      {!(r.documents ?? []).length && <span className="text-text-faint">no documents</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                        g.stage === 'approved' ? 'bg-ok-bg text-ok'
                        : ['rejected','returned'].includes(g.stage) ? 'bg-err-bg text-err'
                        : g.stage === 'panel' ? 'bg-warn-bg text-warn' : 'bg-surface-dim text-text-muted'}`}>
                        {STAGE_LABEL[g.stage]}
                      </span>
                      {g.final && <span className="block text-[10px] text-text-faint">finalised</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text">
                      {kg(afl?.frozen?.nett_kg ?? nettKg(r.begin_kg, r.end_kg, r.bags))}
                      {afl?.frozen && ' 🔒'}
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setSelId(selId === r.id ? null : r.id)}
                        className="rounded-lg border border-surface-rule px-2.5 py-1 text-[11px] font-semibold text-text">
                        {selId === r.id ? 'close' : 'open'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[12px] text-text-muted">
                  {q ? `Nothing matches "${q}".`
                     : show === 'open' ? 'Nothing open — every delivery in scope is finalised.'
                     : show === 'void' ? 'No voided documents in scope.' : 'Nothing here.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {sel && (
        <>
          <section className="rounded-2xl border border-surface-rule bg-surface-card">
            <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
              <span className="font-display text-[14px] font-semibold text-text">{sel.batch_no} · every document</span>
              <span className="text-[11px] text-text-muted">
                {sel.contract?.producer?.name} · {sel.contract?.contract_no}
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr className="border-b border-surface-rule bg-surface-raised">
                  {['Document', 'Number', 'When', 'By', ''].map(h => (
                    <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {(sel.documents ?? []).map(d => (
                    <tr key={d.id} className="border-b border-surface-rule last:border-0">
                      <td className={`px-4 py-2.5 text-[12px] ${d.voided_at ? 'text-err' : 'text-text'}`}>
                        {KIND_LABEL[d.kind] ?? d.kind}{d.voided_at && ' — voided'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-text">{d.doc_no}</td>
                      <td className="px-4 py-2.5 text-[11px] text-text-muted">
                        {new Date(d.voided_at ?? d.issued_at).toLocaleString('en-ZA')}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-text-muted">{d.voided_by_name ?? d.issued_by_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-[11px]">
                        {d.voided_at ? (
                          <>
                            <span className="rounded-full bg-err-bg px-2 py-0.5 text-[10px] font-semibold text-err">
                              {d.void_category?.replace(/_/g, ' ')}
                            </span>
                            <span className="block text-text-muted">{d.void_reason}</span>
                          </>
                        ) : d.signed_at ? (
                          <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[10px] font-semibold text-ok">
                            signed by {d.signed_by}
                          </span>
                        ) : d.frozen ? (
                          <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[10px] font-semibold text-ok">
                            🔒 payment frozen at {kg(d.frozen.nett_kg)} kg
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!(sel.documents ?? []).length && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-[12px] text-text-muted">No documents raised yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="border-t border-surface-rule px-4 py-2.5 text-[11px] text-text-muted">
              A voided document keeps its number and its reason. Nothing here is deleted — this row is how
              you answer &ldquo;what happened to {(sel.documents ?? [])[0]?.doc_no ?? 'that number'}?&rdquo;
              three seasons later.
            </p>
          </section>

          <section className="rounded-2xl border border-surface-rule bg-surface-card">
            <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
              <span className="font-display text-[14px] font-semibold text-text">Audit trail</span>
              <span className="text-[11px] text-text-muted">{events.length} entries · append-only</span>
            </header>
            <ul className="divide-y divide-surface-rule">
              {events.map(e => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
                  <span className="text-[12px] text-text">{e.detail}</span>
                  <span className="font-mono text-[10px] text-text-faint">
                    {e.actor_name} · {new Date(e.at).toLocaleString('en-ZA')}
                  </span>
                </li>
              ))}
              {!events.length && (
                <li className="px-4 py-6 text-center text-[12px] text-text-muted">Nothing recorded yet.</li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: 'ok' | 'warn' }) {
  const colour = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-text'
  return (
    <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`font-display text-[24px] font-bold leading-tight ${colour}`}>{value}</div>
      <div className="text-[11px] text-text-faint">{unit}</div>
    </div>
  )
}

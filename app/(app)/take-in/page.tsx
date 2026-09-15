'use client'

// app/(app)/take-in/page.tsx
//
// Take-In overview — the consolidation dashboard.
//
// Blackheath is the reason this page exists in this shape. Farmers do not
// deliver there, so for that team every number on this page is somebody else's
// depot. Scoped users see only their own; an unscoped user (Blackheath,
// Management) sees each depot as its own column and the whole season as the
// total.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { takeinDb, loadDepots, visibleDepots, errMsg } from '@/lib/takein/db'
import { stageOf, isFinalised, type Stage } from '@/lib/core/takein/grading'
import type { Depot, LabRow, PanelOutcome } from '@/lib/takein/types'
import { Loader2, AlertTriangle, ArrowRight } from 'lucide-react'

interface Row {
  id: string; batch_no: string; warehouse_id: string; delivered_on: string
  begin_kg: number | null; end_kg: number | null; bags: number
  returned_at: string | null
  panel_outcome: PanelOutcome | null; panel_grade: string | null
  panel_reason: string | null; panel_covered: string[] | null
  contract: { contract_no: string; variant: string
              producer: { name: string } | null } | null
  lab_results: LabRow[]
  documents: { kind: string; voided_at: string | null }[]
}

const STAGE_LABEL: Record<Stage, string> = {
  awaiting_mini: 'Awaiting mini lab', awaiting_internal: 'Awaiting Blackheath',
  awaiting_external: 'Awaiting external lab', panel: 'Panel decision',
  approved: 'Approved', rejected: 'Rejected', returned: 'Returned',
}

export default function TakeInOverviewPage() {
  const { depotCodes } = useAuth()
  const [depots, setDepots]   = useState<Depot[]>([])
  const [rows, setRows]       = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')

  useEffect(() => { void load() }, [depotCodes.join(',')])

  async function load() {
    setLoading(true); setErr('')
    try {
      const all = await loadDepots()
      const mine = visibleDepots(all, depotCodes)
      setDepots(mine)
      if (!mine.length) { setRows([]); return }

      const { data, error } = await takeinDb()
        .from('batches')
        .select(`
          id, batch_no, warehouse_id, delivered_on, begin_kg, end_kg, bags,
          returned_at, panel_outcome, panel_grade, panel_reason, panel_covered,
          contract:contract_id ( contract_no, variant, producer:producer_id ( name ) ),
          lab_results ( source, sieve_json, moisture, density, shade, aroma, colour, taste,
                        agrees, residue_group, pa_group ),
          documents ( kind, voided_at )
        `)
        .in('warehouse_id', mine.map(d => d.id))
        .order('delivered_on', { ascending: false })
        .limit(500)
      if (error) throw error
      setRows((data as unknown as Row[]) ?? [])
    } catch (e: unknown) {
      setErr(errMsg(e, 'Could not load take-in data.'))
    } finally { setLoading(false) }
  }

  const graded = useMemo(() => rows.map(r => {
    const lab = (s: string) => r.lab_results?.find(l => l.source === s) ?? null
    const live = (k: string) => r.documents?.some(d => d.kind === k && !d.voided_at) ?? false
    const st = stageOf({
      mini: lab('mini'), internal: lab('internal'),
      external: lab('external'),
      organic: /organic/i.test(r.contract?.variant ?? ''),
      binding: {},                        // overview does not re-litigate terms
      returned: !!r.returned_at,
      panel: r.panel_outcome
        ? { outcome: r.panel_outcome, grade: r.panel_grade,
            reason: r.panel_reason ?? '', covered: r.panel_covered ?? [] }
        : null,
    })
    return { row: r, stage: st.stage, final: isFinalised(st.stage, live('coa')) }
  }), [rows])

  const byDepot = useMemo(() => depots.map(d => {
    const mine = graded.filter(g => g.row.warehouse_id === d.id)
    return {
      depot: d,
      total:  mine.length,
      open:   mine.filter(g => !g.final).length,
      panel:  mine.filter(g => g.stage === 'panel').length,
      kg:     mine.filter(g => !['returned', 'rejected'].includes(g.stage))
                  .reduce((a, g) => a + Math.max(0, (g.row.begin_kg ?? 0) - (g.row.end_kg ?? 0)), 0),
    }
  }), [depots, graded])

  const totals = byDepot.reduce((a, d) => ({
    total: a.total + d.total, open: a.open + d.open,
    panel: a.panel + d.panel, kg: a.kg + d.kg,
  }), { total: 0, open: 0, panel: 0, kg: 0 })

  const kg = (n: number) => n.toLocaleString('en-ZA', { maximumFractionDigits: 0 })

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading take-in…
    </div>
  )

  return (
    <div className="space-y-5">
      {err && (
        <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{err}
        </div>
      )}

      {/* ── season totals ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Deliveries"    value={String(totals.total)} unit="this season" />
        <Kpi label="Still open"    value={String(totals.open)}  unit="need someone" tone={totals.open ? 'warn' : 'ok'} />
        <Kpi label="Awaiting panel" value={String(totals.panel)} unit="batches"     tone={totals.panel ? 'warn' : undefined} />
        <Kpi label="Gross taken in" value={kg(totals.kg)}       unit="kg" tone="ok" />
      </div>

      {/* ── per depot ── */}
      <section className="rounded-2xl border border-surface-rule bg-surface-card">
        <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
          <span className="font-display text-[14px] font-semibold text-text">By depot</span>
          <span className="text-[11px] text-text-muted">
            {depotCodes.length
              ? 'Scoped to your depot'
              : 'Every depot — farmers do not deliver to Blackheath, this is the consolidated view'}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-rule bg-surface-raised">
                {['Depot', 'Batch series', 'Deliveries', 'Open', 'Panel', 'Gross kg'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDepot.map(d => (
                <tr key={d.depot.id} className="border-b border-surface-rule last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-[13px] text-text">{d.depot.name}</span>
                    {!d.depot.takes_farmer_delivery && (
                      <span className="ml-2 rounded-full bg-surface-dim px-2 py-0.5 font-mono text-[10px] text-text-muted">
                        no farmer delivery
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text-muted">
                    {d.depot.batch_prefix
                      ? <>{d.depot.batch_prefix}<span className="text-text">{String(d.depot.batch_seq + 1).padStart(4, '0')}</span> next</>
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{d.total}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{d.open}</td>
                  <td className={`px-4 py-2.5 font-mono text-[12px] ${d.panel ? 'text-warn font-semibold' : 'text-text'}`}>{d.panel}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{kg(d.kg)}</td>
                </tr>
              ))}
              {!byDepot.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-text-muted">
                  No depot is in scope for your account. Ask an administrator to set your depots on Users &amp; Access.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── what needs someone ── */}
      <section className="rounded-2xl border border-surface-rule bg-surface-card">
        <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
          <span className="font-display text-[14px] font-semibold text-text">Needs someone</span>
          <Link href="/take-in/history" className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline">
            Everything finished lives in History <ArrowRight className="h-3 w-3" />
          </Link>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-rule bg-surface-raised">
                {['Batch', 'Producer', 'Delivered', 'Waiting on'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {graded.filter(g => !g.final).slice(0, 25).map(g => (
                <tr key={g.row.id} className="border-b border-surface-rule last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-text">{g.row.batch_no}</td>
                  <td className="px-4 py-2.5 text-[12px] text-text">{g.row.contract?.producer?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text-muted">{g.row.delivered_on}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      g.stage === 'panel' ? 'bg-warn-bg text-warn' : 'bg-surface-dim text-text-muted'}`}>
                      {STAGE_LABEL[g.stage]}
                    </span>
                  </td>
                </tr>
              ))}
              {!graded.filter(g => !g.final).length && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-[12px] text-text-muted">
                  Nothing open. Every delivery in scope is finalised.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, unit, tone }: {
  label: string; value: string; unit: string; tone?: 'ok' | 'warn'
}) {
  const colour = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-text'
  return (
    <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`font-display text-[26px] font-bold leading-tight ${colour}`}>{value}</div>
      <div className="text-[11px] text-text-faint">{unit}</div>
    </div>
  )
}

'use client'

// app/(app)/take-in/settlement/page.tsx
//
// What each approved delivery earns. THE MOST SENSITIVE SCREEN IN THE MODULE —
// it is every producer's money in one table — so it carries its own permission
// (can_view_takein_settlement), the route guard in app/(app)/layout.tsx enforces
// it independently of the sidebar, and the rand values themselves come from
// takein.contract_pricing behind row-level security.
//
// A user can therefore run an entire depot and still not open this page.
//
// EVERY PAID KILOGRAM IS THE KILOGRAM ON THE PRODUCER'S AFLEWERINGSBEWYS. The
// figure is read from the frozen snapshot on that document, never from the live
// batch, so a correction made afterwards cannot silently move what was paid. A
// row without one is a batch that reached a grade before its delivery note was
// raised — payable, but nobody has agreed the weight in writing.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { takeinDb, loadDepots, visibleDepots, errMsg } from '@/lib/takein/db'
import { stageOf, roundHalfUp } from '@/lib/core/takein/grading'
import type { Depot, ContractPricing, FrozenFigures, LabRow, PanelOutcome } from '@/lib/takein/types'
import { Loader2, AlertTriangle, Lock, Banknote } from 'lucide-react'

interface Row {
  id: string; batch_no: string; warehouse_id: string; contract_id: string
  delivered_on: string; begin_kg: number | null; end_kg: number | null; bags: number
  returned_at: string | null
  panel_outcome: PanelOutcome | null; panel_grade: string | null
  panel_reason: string | null; panel_covered: string[] | null
  contract: { contract_no: string; variant: string
              producer: { name: string } | null } | null
  documents: { kind: string; doc_no: string; frozen: FrozenFigures | null; voided_at: string | null }[]
  lab_results: LabRow[]
}

export default function SettlementPage() {
  const { p, depotCodes } = useAuth()
  const canSeePrice = p('can_view_contract_pricing')

  const [depots, setDepots] = useState<Depot[]>([])
  const [rows, setRows]     = useState<Row[]>([])
  const [pricing, setPricing] = useState<Record<string, ContractPricing>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr]       = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const all = await loadDepots()
      const mine = visibleDepots(all, depotCodes)
      setDepots(mine)
      if (!mine.length) { setRows([]); return }
      const db = takeinDb()
      const { data, error } = await db.from('batches')
        .select(`
          id, batch_no, warehouse_id, contract_id, delivered_on, begin_kg, end_kg, bags,
          returned_at, panel_outcome, panel_grade, panel_reason, panel_covered,
          contract:contract_id ( contract_no, variant, producer:producer_id ( name ) ),
          documents ( kind, doc_no, frozen, voided_at ),
          lab_results ( source, sieve_json, moisture, density, shade, aroma, colour, taste,
                        agrees, residue_group, pa_group )
        `)
        .in('warehouse_id', mine.map(d => d.id))
        .order('delivered_on', { ascending: false })
        .limit(1000)
      if (error) throw error
      setRows((data as unknown as Row[]) ?? [])

      // Settlement without pricing is a kilogram report, which is still useful.
      // The policy refuses the rows rather than the page refusing to render.
      if (canSeePrice) {
        const { data: pr } = await db.from('contract_pricing').select('*')
        setPricing(Object.fromEntries(((pr as ContractPricing[]) ?? []).map(x => [x.contract_id, x])))
      } else setPricing({})
    } catch (e: unknown) { setErr(errMsg(e, 'Could not load settlement.')) }
    finally { setLoading(false) }
  }, [depotCodes.join(','), canSeePrice])

  useEffect(() => { void load() }, [load])

  const settled = useMemo(() => rows.flatMap(r => {
    const lab = (s: string) => r.lab_results?.find((l: LabRow) => l.source === s) ?? null
    const st = stageOf({ mini: lab('mini'), internal: lab('internal'), external: lab('external'),
      organic: /organic/i.test(r.contract?.variant ?? ''), binding: {},
      returned: !!r.returned_at,
      panel: r.panel_outcome ? { outcome: r.panel_outcome, grade: r.panel_grade,
             reason: r.panel_reason ?? '', covered: r.panel_covered ?? [] } : null })
    if (st.stage !== 'approved') return []

    const afl = r.documents?.find(d => d.kind === 'afleweringsbewys' && !d.voided_at) ?? null
    // The paid kilograms are the ones on the producer's copy.
    const kgPaid = afl?.frozen?.nett_kg
      ?? Math.max(0, (r.begin_kg ?? 0) - (r.end_kg ?? 0) - r.bags * 2)
    const price = pricing[r.contract_id] ?? null
    const rate  = price ? price.guaranteed_cents / 100 : null
    return [{
      row: r, grade: st.grade ?? 'C', downgraded: !!st.downgraded,
      aflNo: afl?.doc_no ?? null, locked: !!afl?.frozen,
      kg: kgPaid, rate,
      value: rate == null ? null : roundHalfUp(rate * kgPaid, 2),
    }]
  }), [rows, pricing])

  const byProducer = useMemo(() => {
    const m: Record<string, { name: string; kg: number; value: number | null }> = {}
    for (const s of settled) {
      const name = s.row.contract?.producer?.name ?? '—'
      const e = (m[name] ??= { name, kg: 0, value: canSeePrice ? 0 : null })
      e.kg += s.kg
      if (e.value != null && s.value != null) e.value += s.value
    }
    return Object.values(m).sort((a, b) => b.kg - a.kg)
  }, [settled, canSeePrice])

  const totals = settled.reduce((a, s) => ({
    kg: a.kg + s.kg, value: a.value + (s.value ?? 0), unlocked: a.unlocked + (s.locked ? 0 : 1),
  }), { kg: 0, value: 0, unlocked: 0 })

  const kg = (n: number) => n.toLocaleString('en-ZA', { maximumFractionDigits: 0 })
  const R  = (n: number) => n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading settlement…
    </div>
  )

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{err}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-bg px-4 py-3 text-[12px] text-warn">
        <Banknote className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Sensitive.</strong> This page is every producer&rsquo;s money in one table. It carries
          its own permission and the rand values come from a table behind row-level security — someone
          can run an entire depot and still not open this.
        </span>
      </div>

      {!canSeePrice && (
        <div className="flex items-start gap-2 rounded-xl border border-surface-rule bg-surface-dim px-4 py-3 text-[12px] text-text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="text-text">Rand values are not shown for your account.</strong> The
            kilograms and grades stay visible; the money needs{' '}
            <span className="font-mono">can_view_contract_pricing</span>.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Approved kg" value={kg(totals.kg)} unit="nett, as paid" tone="ok" />
        <Kpi label="Deliveries"  value={String(settled.length)} unit="approved" />
        <Kpi label="Season value" value={canSeePrice ? `R ${R(totals.value)}` : '—'} unit={canSeePrice ? 'at the guaranteed price' : 'hidden'} />
        <Kpi label="Without a delivery note" value={String(totals.unlocked)}
             unit="weight not agreed in writing" tone={totals.unlocked ? 'warn' : 'ok'} />
      </div>

      <section className="rounded-2xl border border-surface-rule bg-surface-card">
        <header className="border-b border-surface-rule px-4 py-3">
          <span className="font-display text-[14px] font-semibold text-text">By delivery</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-surface-rule bg-surface-raised">
              {['Batch', 'Producer', 'Grade', 'Paid against', 'Nett kg', 'R/kg', 'Value'].map(h => (
                <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {settled.map(s => (
                <tr key={s.row.id} className="border-b border-surface-rule last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-text">{s.row.batch_no}</td>
                  <td className="px-4 py-2.5 text-[12px] text-text">{s.row.contract?.producer?.name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      s.grade === 'A' ? 'bg-ok-bg text-ok' : s.grade === 'B' ? 'bg-info-bg text-info'
                                                           : 'bg-surface-dim text-text-muted'}`}>
                      {s.grade}{s.downgraded ? ' ↓' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px]">
                    {s.aflNo
                      ? <span className="text-text-muted">🔒 {s.aflNo}</span>
                      : <span className="text-warn">no Afleweringsbewys</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{kg(s.kg)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{s.rate == null ? '—' : R(s.rate)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-text">
                    {s.value == null ? '—' : `R ${R(s.value)}`}
                  </td>
                </tr>
              ))}
              {!settled.length && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[12px] text-text-muted">
                  No approved deliveries yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-surface-rule px-4 py-2.5 text-[11px] text-text-muted">
          Every paid kilogram is the kilogram on the producer&rsquo;s Afleweringsbewys, frozen the moment
          that document was made out. A row without one reached a grade before its delivery note was
          raised — payable, but nobody has agreed the weight in writing.
        </p>
      </section>

      <section className="rounded-2xl border border-surface-rule bg-surface-card">
        <header className="border-b border-surface-rule px-4 py-3">
          <span className="font-display text-[14px] font-semibold text-text">By producer</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-surface-rule bg-surface-raised">
              {['Producer', 'Nett kg', 'Value'].map(h => (
                <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {byProducer.map(r => (
                <tr key={r.name} className="border-b border-surface-rule last:border-0">
                  <td className="px-4 py-2.5 text-[12px] text-text">{r.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{kg(r.kg)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-text">
                    {r.value == null ? '—' : `R ${R(r.value)}`}
                  </td>
                </tr>
              ))}
              {!byProducer.length && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-[12px] text-text-muted">Nothing settled yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: 'ok' | 'warn' }) {
  const colour = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-text'
  return (
    <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`font-display text-[22px] font-bold leading-tight ${colour}`}>{value}</div>
      <div className="text-[11px] text-text-faint">{unit}</div>
    </div>
  )
}

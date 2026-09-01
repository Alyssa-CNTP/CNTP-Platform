'use client'

// MassBalanceTable — one unified balance for a production run, read as a table:
// a row per shift (Morning / Afternoon) and a bold "Whole run" total. Variance is
// kg in − kg out; the whole-run row carries the ±tolerance badge. Sieving's bucket
// elevator lands on the input side in the morning (consumed) and the output side
// in the afternoon (left for the next day), so the shift rows already reflect that
// and the run total closes honestly.

import { Scale, CheckCircle2, AlertTriangle, Info } from 'lucide-react'

export interface BalanceRow {
  shift: 'Morning' | 'Afternoon'
  totalIn: number
  totalOut: number
  /**
   * Material held in the line for the next day: Sieving's bucket elevator, or
   * the Granule Line's leftover SG/SF dust. Work in progress, NOT product — so
   * it is deliberately absent from totalOut and shown in its own column, and
   * the variance subtracts it. Without that it reads as an unexplained
   * shortfall on every shift that legitimately leaves material behind.
   */
  carryOverOut?: number
}

// Single source of truth for how a mass-balance variance reads in plain
// language. Every place on the capture page that shows "how far off are
// we" — this table, sign-off, the changeover prompt, the per-batch
// breakdown — must render this same text/colour rather than inventing its
// own phrasing. Four different-looking indicators for the same underlying
// figure is what read as confusing, not the +/- sign itself.
export function balanceStatus(variance: number, tolerance: number) {
  const within = Math.abs(variance) <= tolerance
  const text = within
    ? `Within ±${tolerance}`
    : variance > 0
      ? `${Math.abs(variance).toFixed(1)} kg still to bag out`
      : `${Math.abs(variance).toFixed(1)} kg more bagged than recorded in`
  return { within, text }
}

export function BalanceBadge({ variance, tolerance, className }: { variance: number; tolerance: number; className?: string }) {
  const { within, text } = balanceStatus(variance, tolerance)
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${within ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'} ${className ?? ''}`}>
      {within ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {text}
    </span>
  )
}

export function MassBalanceTable({
  rows, tolerance, note, carryOverLabel = 'carried over',
}: {
  rows: BalanceRow[]
  tolerance: number
  note?: string
  /**
   * What the carry-over column is called on this section — "left in elevator"
   * for Sieving, "dust for tomorrow" on the Granule Line. Naming it generically
   * would leave an operator guessing which pile the column is about.
   */
  carryOverLabel?: string
}) {
  const totalIn  = rows.reduce((s, r) => s + r.totalIn, 0)
  const totalOut = rows.reduce((s, r) => s + r.totalOut, 0)
  const carryOut = rows.reduce((s, r) => s + (r.carryOverOut ?? 0), 0)
  const variance = totalIn - totalOut - carryOut
  const showCarry = carryOut > 0
  const multiShift = rows.length > 1
  const vClass = (v: number) => (Math.abs(v) <= tolerance ? 'text-ok' : 'text-warn')
  const sign = (v: number) => (v > 0 ? '+' : '')

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
          <Scale size={13} /> Mass balance{multiShift ? ' · whole run (all shifts)' : ''}
        </span>
        <BalanceBadge variance={variance} tolerance={tolerance} />
      </div>

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-stone-50 text-stone-400 uppercase text-[10px] tracking-wide">
              <th className="text-left  px-3 py-2 font-semibold">Shift</th>
              <th className="text-right px-3 py-2 font-semibold">kg in</th>
              <th className="text-right px-3 py-2 font-semibold">kg out</th>
              {showCarry && <th className="text-right px-3 py-2 font-semibold">{carryOverLabel}</th>}
              <th className="text-right px-3 py-2 font-semibold">variance</th>
            </tr>
          </thead>
          {multiShift && (
            <tbody>
              {rows.map(r => {
                const v = r.totalIn - r.totalOut - (r.carryOverOut ?? 0)
                return (
                  <tr key={r.shift} className="border-t border-stone-100">
                    <td className="px-3 py-2 text-stone-600">{r.shift}</td>
                    <td className="px-3 py-2 text-right font-mono text-text">{r.totalIn.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono text-text">{r.totalOut.toFixed(1)}</td>
                    {showCarry && <td className="px-3 py-2 text-right font-mono text-stone-500">{(r.carryOverOut ?? 0).toFixed(1)}</td>}
                    <td className={`px-3 py-2 text-right font-mono ${vClass(v)}`}>{sign(v)}{v.toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          )}
          <tfoot>
            <tr className={`${multiShift ? 'border-t-2 border-stone-300 bg-stone-50/70' : 'border-t border-stone-100'}`}>
              <td className="px-3 py-2.5 font-bold text-stone-800">{multiShift ? 'Whole run' : (rows[0]?.shift ?? 'This shift')}</td>
              <td className="px-3 py-2.5 text-right font-mono font-bold text-text">{totalIn.toFixed(1)}</td>
              <td className="px-3 py-2.5 text-right font-mono font-bold text-text">{totalOut.toFixed(1)}</td>
              {showCarry && <td className="px-3 py-2.5 text-right font-mono font-bold text-stone-500">{carryOut.toFixed(1)}</td>}
              <td className={`px-3 py-2.5 text-right font-mono font-bold ${vClass(variance)}`}>{sign(variance)}{variance.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-text-muted flex items-start gap-1.5">
        <Info size={11} className="shrink-0 mt-0.5" />
        {note ?? 'One balance for the whole production run (07h00–01h00). Bucket elevator counts as input on the morning shift and output on the afternoon shift.'}
      </p>
    </div>
  )
}

export default MassBalanceTable

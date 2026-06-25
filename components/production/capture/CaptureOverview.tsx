'use client'

// CaptureOverview.tsx
// What the operator captured this shift, in their own terms: bag numbers,
// lot/batch, weight, variant and grade — per bag, grouped into Debagging (blue,
// "in") and Bagging (orange, "out"). System serials are hidden for operators and
// only shown to IT (showSerials). Read-only; reflects the autosaved data.

import { useState } from 'react'
import { Printer, Copy, CheckCircle2, AlertTriangle, Package, PackageCheck } from 'lucide-react'
import { sievingTotals, type SievingData } from '@/components/production/capture/SievingCapture'
import { MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'

interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData }

const num = (v: any): number => parseFloat(String(v).replace(',', '.')) || 0
const DEBAG_BLUE = '#1d4ed8'
const BAG_ORANGE = '#d97706'

// Flatten every captured bag across productions into operator-readable rows.
function debagRows(prods: Production[]) {
  const rows: { bagNo: string; lot: string; kg: number; variant: string }[] = []
  prods.forEach(p => (p.data.debag ?? []).forEach((r, i) => {
    if (num(r.nett) === 0) return
    rows.push({ bagNo: r.bag_no || `Bulk bag ${i + 1}`, lot: r.lot || p.lot || '—', kg: num(r.nett), variant: p.variant })
  }))
  return rows
}
function bagRows(prods: Production[]) {
  const rows: { product: string; lot: string; kg: number; variant: string; grade: string; serial: string }[] = []
  prods.forEach(p => (p.data.outputs ?? []).forEach(b => {
    if (num(b.weight) === 0) return
    rows.push({ product: b.productType, lot: b.batch || p.lot || '—', kg: num(b.weight), variant: p.variant, grade: b.destination || p.grade || '—', serial: b.serial })
  }))
  return rows
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-[12px] ${className}`}>{children}</td>
}

export function CaptureOverview({ productions, sectionName, sectionColor, date, shift, showSerials = false }: {
  productions: Production[]; sectionName: string; sectionColor: string; date: string; shift: string; showSerials?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const ins  = debagRows(productions)
  const outs = bagRows(productions)
  const totals = productions.reduce((acc, p) => {
    const t = sievingTotals(p.data)
    return { totalIn: acc.totalIn + t.totalIn, totalOut: acc.totalOut + t.totalOut, spillage: acc.spillage + t.spillage }
  }, { totalIn: 0, totalOut: 0, spillage: 0 })
  const variance = totals.totalIn - totals.totalOut
  const withinTol = Math.abs(variance) <= MASS_BALANCE_TOLERANCE_KG
  const hasData = ins.length > 0 || outs.length > 0

  function handleCopy() {
    const lines = [`CNTP — ${sectionName}`, `${date} · ${shift} shift`, '',
      'OUT  Product\tLot\tVariant\tGrade\tWeight']
    outs.forEach(g => lines.push(`${g.product}\t${g.lot}\t${g.variant}\t${g.grade}\t${g.kg.toFixed(1)}`))
    lines.push('', `Total in\t${totals.totalIn.toFixed(1)} kg`, `Total out\t${totals.totalOut.toFixed(1)} kg`, `Variance\t${variance.toFixed(1)} kg`)
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="rounded-2xl border border-stone-200 overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 bg-stone-50 border-b border-stone-200">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sectionColor }} />
          <div className="min-w-0">
            <p className="font-semibold text-[13px] text-stone-800 truncate">{sectionName} — what you captured</p>
            <p className="font-mono text-[10px] text-stone-400">{date} · <span className="capitalize">{shift}</span> shift</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            {copied ? <CheckCircle2 size={12} className="text-ok" /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!hasData ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Package size={22} className="text-stone-300" />
            <p className="text-[12px] text-stone-400">Nothing captured yet — add debagging and bagging in the Capture step first.</p>
          </div>
        ) : (
          <>
            {/* Debagging — blue (in) */}
            {ins.length > 0 && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: DEBAG_BLUE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: DEBAG_BLUE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: DEBAG_BLUE }}><Package size={14} /> Debagging — in</span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: DEBAG_BLUE }}>{totals.totalIn.toFixed(1)} kg</span>
                </div>
                <table className="w-full border-collapse">
                  <thead><tr className="border-b border-stone-100 text-left text-[9px] font-bold uppercase tracking-wide text-stone-400">
                    <Cell>Bag no.</Cell><Cell>Lot / serial</Cell><Cell>Variant</Cell><Cell className="text-right">Weight</Cell>
                  </tr></thead>
                  <tbody>
                    {ins.map((r, i) => (
                      <tr key={i} className="border-b border-stone-50 last:border-0">
                        <Cell className="font-medium text-stone-800">{r.bagNo}</Cell>
                        <Cell className="font-mono text-stone-600">{r.lot}</Cell>
                        <Cell className="text-stone-600">{r.variant}</Cell>
                        <Cell className="text-right font-mono font-bold text-stone-800">{r.kg.toFixed(1)} kg</Cell>
                      </tr>
                    ))}
                    {totals.spillage > 0 && (
                      <tr className="border-t border-stone-100"><Cell className="text-stone-400" >Bucket elevator</Cell><Cell> </Cell><Cell className="text-stone-400">excl. balance</Cell><Cell className="text-right font-mono text-stone-400">{totals.spillage.toFixed(1)} kg</Cell></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bagging — orange (out) */}
            {outs.length > 0 && (
              <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: BAG_ORANGE + '40' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ background: BAG_ORANGE + '12' }}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: BAG_ORANGE }}><PackageCheck size={14} /> Bagging — out</span>
                  <span className="font-mono font-bold text-[13px]" style={{ color: BAG_ORANGE }}>{totals.totalOut.toFixed(1)} kg · {outs.length} bag{outs.length !== 1 ? 's' : ''}</span>
                </div>
                <table className="w-full border-collapse">
                  <thead><tr className="border-b border-stone-100 text-left text-[9px] font-bold uppercase tracking-wide text-stone-400">
                    <Cell>Product</Cell><Cell>Lot / batch</Cell><Cell>Variant</Cell><Cell>Grade</Cell>{showSerials && <Cell>Serial</Cell>}<Cell className="text-right">Weight</Cell>
                  </tr></thead>
                  <tbody>
                    {outs.map((r, i) => (
                      <tr key={i} className="border-b border-stone-50 last:border-0">
                        <Cell className="font-medium text-stone-800">{r.product}</Cell>
                        <Cell className="font-mono text-stone-600">{r.lot}</Cell>
                        <Cell className="text-stone-600">{r.variant}</Cell>
                        <Cell className="text-stone-600">{r.grade}</Cell>
                        {showSerials && <Cell className="font-mono text-[10px] text-stone-400">{r.serial}</Cell>}
                        <Cell className="text-right font-mono font-bold text-stone-800">{r.kg.toFixed(1)} kg</Cell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mass balance — compact */}
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[12px] font-mono ${withinTol ? 'bg-ok/5 border-ok/30' : 'bg-warn/5 border-warn/30'}`}>
              <span className="text-stone-500">In {totals.totalIn.toFixed(1)} − Out {totals.totalOut.toFixed(1)} =</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-[13px]" style={{ color: withinTol ? undefined : undefined }}>
                <span className={withinTol ? 'text-ok' : 'text-warn'}>{variance > 0 ? '+' : ''}{variance.toFixed(1)} kg</span>
                {withinTol ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-warn" />}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CaptureOverview

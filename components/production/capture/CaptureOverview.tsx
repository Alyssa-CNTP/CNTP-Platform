'use client'

// CaptureOverview.tsx
// Post-capture overview (formerly the "Acumatica summary") — rebuilt from the
// live capture model (Production[] / SievingData) rather than the legacy draft
// shape. Read-only: it reflects exactly what the autosave has written to the DB
// (prod_debagging / prod_bagging / prod_mass_balance). An operator reads this
// sheet and types the grouped totals into Acumatica, so it must be instantly
// legible — outputs are GROUPED by item + lot and TOTALLED.

import { useState } from 'react'
import { Printer, Copy, CheckCircle2, AlertTriangle, Package } from 'lucide-react'
import { sievingTotals, type SievingData } from '@/components/production/capture/SievingCapture'
import { MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'

interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData }

const num = (v: any): number => parseFloat(v) || 0

function SectionHdr({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-stone-400 px-3 pt-3.5 pb-1.5 border-b border-stone-100">
      {children}
    </div>
  )
}

function Row({ label, value, sub, green, warn }: {
  label: string; value: string; sub?: string; green?: boolean; warn?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between py-2 px-3 border-b border-stone-100 last:border-b-0">
      <span className="text-[12px] text-stone-600">{label}</span>
      <div className="text-right">
        <span className={`font-mono font-bold text-[13px] ${green ? 'text-emerald-700' : warn ? 'text-amber-600' : 'text-stone-800'}`}>{value}</span>
        {sub && <span className="text-[10px] text-stone-400 ml-2">{sub}</span>}
      </div>
    </div>
  )
}

function LotBlock({ item, lot, variant, bags, kg, serials, code }: {
  item: string; lot: string; variant: string; bags: number; kg: number; serials: string[]; code?: string | null
}) {
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden mb-2 last:mb-0">
      <div className="flex items-center justify-between px-3 py-2 bg-stone-50 border-b border-stone-200">
        <div className="min-w-0">
          <span className="font-semibold text-[13px] text-stone-800">{item}</span>
          {lot && <span className="font-mono text-[11px] text-emerald-700 ml-2 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">{lot}</span>}
          {code && <span className="font-mono text-[10px] text-stone-400 ml-2">{code}</span>}
        </div>
        <span className="font-mono font-bold text-[15px] text-emerald-700 shrink-0">{kg.toFixed(1)} kg</span>
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 gap-3">
        <span className="text-[11px] text-stone-400 shrink-0">{variant} · {bags} bag{bags !== 1 ? 's' : ''}</span>
        <span className="font-mono text-[10px] text-stone-400 text-right truncate">{serials.join(' · ')}</span>
      </div>
    </div>
  )
}

// Group every output bag across all productions by item + lot + variant.
function groupOutputs(prods: Production[]) {
  const map: Record<string, { item: string; lot: string; variant: string; code: string | null; bags: number; kg: number; serials: string[] }> = {}
  prods.forEach(p => {
    (p.data.outputs ?? []).forEach(b => {
      if (num(b.weight) === 0) return
      const lot = b.batch || p.lot || '—'
      const key = `${b.productType}__${lot}__${p.variant}`
      if (!map[key]) map[key] = { item: b.productType, lot, variant: p.variant, code: b.code ?? null, bags: 0, kg: 0, serials: [] }
      map[key].bags++
      map[key].kg += num(b.weight)
      if (b.serial) map[key].serials.push(b.serial)
    })
  })
  return Object.values(map).sort((a, b) => a.item.localeCompare(b.item) || a.lot.localeCompare(b.lot))
}

// Bulk-bag inputs across all productions, grouped by lot.
function groupInputs(prods: Production[]) {
  const map: Record<string, { lot: string; variant: string; bags: number; kg: number }> = {}
  prods.forEach(p => {
    (p.data.debag ?? []).forEach(r => {
      if (num(r.nett) === 0) return
      const lot = r.lot || p.lot || '—'
      const key = `${lot}__${p.variant}`
      if (!map[key]) map[key] = { lot, variant: p.variant, bags: 0, kg: 0 }
      map[key].bags++
      map[key].kg += num(r.nett)
    })
  })
  return Object.values(map).sort((a, b) => a.lot.localeCompare(b.lot))
}

export function CaptureOverview({ productions, sectionName, sectionColor, date, shift }: {
  productions: Production[]; sectionName: string; sectionColor: string; date: string; shift: string
}) {
  const [copied, setCopied] = useState(false)

  const inputs  = groupInputs(productions)
  const outputs = groupOutputs(productions)
  const totals  = productions.reduce((acc, p) => {
    const t = sievingTotals(p.data)
    return { totalIn: acc.totalIn + t.totalIn, totalOut: acc.totalOut + t.totalOut, spillage: acc.spillage + t.spillage }
  }, { totalIn: 0, totalOut: 0, spillage: 0 })
  const variance = totals.totalIn - totals.totalOut
  const withinTol = Math.abs(variance) <= MASS_BALANCE_TOLERANCE_KG
  const hasData = inputs.length > 0 || outputs.length > 0

  function handleCopy() {
    const lines = [`CNTP — ${sectionName}`, `${date} · ${shift} shift`, '', 'Item\tVariant\tLot\tBags\tTotal kg']
    outputs.forEach(g => lines.push(`${g.item}\t${g.variant}\t${g.lot}\t${g.bags}\t${g.kg.toFixed(1)}`))
    lines.push('', `Total in\t${totals.totalIn.toFixed(1)} kg`, `Total out\t${totals.totalOut.toFixed(1)} kg`, `Variance\t${variance.toFixed(1)} kg`)
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="rounded-2xl border border-stone-200 overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 bg-stone-50 border-b border-stone-200">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sectionColor }} />
          <div className="min-w-0">
            <p className="font-semibold text-[13px] text-stone-800 truncate">{sectionName} — capture overview</p>
            <p className="font-mono text-[10px] text-stone-400">{date} · <span className="capitalize">{shift}</span> shift · enter into Acumatica</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            {copied ? <CheckCircle2 size={12} className="text-ok" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      <div className="p-4">
        {!hasData ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Package size={22} className="text-stone-300" />
            <p className="text-[12px] text-stone-400">Nothing captured yet — add debagging and bagging in the Capture step first.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Debagging inputs — grouped by lot */}
            {inputs.length > 0 && (
              <div className="border border-stone-200 rounded-lg overflow-hidden">
                <SectionHdr>Debagging inputs — raw material in</SectionHdr>
                {inputs.map((g, i) => (
                  <Row key={i} label={`${g.lot} · ${g.variant}`} value={`${g.kg.toFixed(1)} kg`} sub={`${g.bags} bag${g.bags !== 1 ? 's' : ''}`} />
                ))}
                {totals.spillage > 0 && <Row label="Bucket elevator (excluded from balance)" value={`${totals.spillage.toFixed(1)} kg`} warn />}
                <Row label="Total in (A)" value={`${totals.totalIn.toFixed(1)} kg`} green />
              </div>
            )}

            {/* Bagging outputs — grouped by item + lot, the Acumatica entry sheet */}
            {outputs.length > 0 && (
              <div className="border-2 border-emerald-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Bagging outputs → enter into Acumatica production order</span>
                </div>
                <div className="p-2">
                  {outputs.map((g, i) => (
                    <LotBlock key={i} item={g.item} lot={g.lot} variant={g.variant} bags={g.bags} kg={g.kg} serials={g.serials} code={g.code} />
                  ))}
                </div>
                <div className="flex justify-between px-3 py-2.5 bg-emerald-50 border-t border-emerald-200">
                  <span className="text-[12px] font-bold text-emerald-700">Total out (B)</span>
                  <span className="font-mono font-bold text-[15px] text-emerald-700">{totals.totalOut.toFixed(1)} kg · {outputs.reduce((s, g) => s + g.bags, 0)} bags</span>
                </div>
              </div>
            )}

            {/* Mass balance */}
            <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-[12px] font-mono ${withinTol ? 'bg-ok/5 border-ok/30' : 'bg-warn/5 border-warn/30'}`}>
              <span className="text-stone-500">Mass balance = {totals.totalIn.toFixed(1)} − {totals.totalOut.toFixed(1)} =</span>
              <div className="flex items-center gap-2">
                <span className={`font-bold text-[14px] ${withinTol ? 'text-ok' : 'text-warn'}`}>{variance > 0 ? '+' : ''}{variance.toFixed(1)} kg</span>
                {withinTol ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-warn" />}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default CaptureOverview

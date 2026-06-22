'use client'

// AcumaticaSummary.tsx
// Renders the production summary for Acumatica data entry.
// Key principle: batch/lot numbers are GROUPED and TOTALLED.
// An operator reads this table and types it into Acumatica — it must be instantly readable.

import { useState } from 'react'
import { Printer, Copy, CheckCircle2, AlertTriangle } from 'lucide-react'

function num(v: any): number { return parseFloat(v) || 0 }

// ── Primitives ────────────────────────────────────────────────────────────────
function Row({ label, value, sub, green, warn, indent }: {
  label: string; value: string; sub?: string
  green?: boolean; warn?: boolean; indent?: boolean
}) {
  return (
    <div className={`flex items-baseline justify-between py-2 px-3 border-b border-stone-100 last:border-b-0 ${indent ? 'pl-6' : ''}`}>
      <span className={`text-[12px] ${indent ? 'text-stone-400' : 'text-stone-600'}`}>{label}</span>
      <div className="text-right">
        <span className={`font-mono font-bold text-[13px] ${green ? 'text-emerald-700' : warn ? 'text-amber-600' : 'text-stone-800'}`}>
          {value}
        </span>
        {sub && <span className="text-[10px] text-stone-400 ml-2">{sub}</span>}
      </div>
    </div>
  )
}

function SectionHdr({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-stone-400 px-3 pt-4 pb-1 border-b border-stone-100">
      {children}
    </div>
  )
}

function LotBlock({ item, lot, bags, kg, serials }: {
  item: string; lot: string; bags: number; kg: number; serials: string[]
}) {
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden mb-2">
      <div className="flex items-center justify-between px-3 py-2 bg-stone-50 border-b border-stone-200">
        <div>
          <span className="font-semibold text-[13px] text-stone-800">{item}</span>
          <span className="font-mono text-[11px] text-emerald-700 ml-2 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">{lot}</span>
        </div>
        <span className="font-mono font-bold text-[15px] text-emerald-700">{kg.toFixed(1)} kg</span>
      </div>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] text-stone-400">{bags} bag{bags !== 1 ? 's' : ''}</span>
        <span className="font-mono text-[10px] text-stone-400">{serials.join(' · ')}</span>
      </div>
    </div>
  )
}

function MBLine({ a, b, c, d, label }: { a: number; b: number; c?: number; d?: number; label: string }) {
  const out = b + (c ?? 0) + (d ?? 0)
  const variance = a - out
  const ok = Math.abs(variance) <= 15
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-[12px] font-mono mt-3 ${ok ? 'bg-ok/5 border-ok/30' : 'bg-warn/5 border-warn/30'}`}>
      <span className="text-stone-500">Mass balance ({label}) = {a.toFixed(1)} − {b.toFixed(1)}{c !== undefined ? ` − ${c.toFixed(1)}` : ''}{d !== undefined ? ` − ${d.toFixed(1)}` : ''} =</span>
      <div className="flex items-center gap-2">
        <span className={`font-bold text-[14px] ${ok ? 'text-ok' : 'text-warn'}`}>{variance.toFixed(1)} kg</span>
        {ok ? <CheckCircle2 size={14} className="text-ok"/> : <AlertTriangle size={14} className="text-warn"/>}
      </div>
    </div>
  )
}

// ── SIEVING ───────────────────────────────────────────────────────────────────
function SievingSummary({ d, date, shift }: { d: any; date: string; shift: string }) {
  const flBags: any[] = d.flBags        ?? []
  const clBags: any[] = d.clBags        ?? []
  const rbe: any[]    = d.rbEntries     ?? []
  const dust: any[]   = d.dustEntries   ?? []
  const rs: any[]     = d.rolsievEntries?? []
  const is_: any[]    = d.indentEntries ?? []
  const bucketIn  = num(d.bucketIn?.mass_nett)
  const bucketOut = num(d.bucketOutKg)
  const totalA    = num(d.totalA)

  // Group by lot
  function groupByLot(bags: any[]) {
    const map: Record<string, { bags: number; kg: number; serials: string[] }> = {}
    bags.forEach((b: any) => {
      const lot = b.batch || '—'
      if (!map[lot]) map[lot] = { bags: 0, kg: 0, serials: [] }
      map[lot].bags++
      map[lot].kg += num(b.kg)
      map[lot].serials.push(b.serial)
    })
    return map
  }
  const flByLot = groupByLot(flBags)
  const clByLot = groupByLot(clBags)
  const totalFL = flBags.reduce((s: number, b: any) => s + num(b.kg), 0)
  const totalCL = clBags.reduce((s: number, b: any) => s + num(b.kg), 0)
  const totalRB   = rbe.reduce((s: number, e: any) => s + num(e.kg), 0)
  const totalDust = dust.reduce((s: number, e: any) => s + num(e.kg), 0)
  const totalRS   = rs.reduce((s: number, e: any) => s + num(e.kg), 0)
  const totalIS   = is_.reduce((s: number, e: any) => s + num(e.kg), 0)
  const totalOut  = totalFL + totalCL + totalRB + totalDust + totalRS + totalIS + bucketOut

  return (
    <div className="space-y-2">
      {/* Header strip */}
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        {[
          ['Form', 'PR-FM-027/6'],
          ['Date / Shift', `${date} · ${shift}`],
          ['Operators', d.shiftOps || '—'],
          ['Sieve config', [d.sieve12 && '12H', d.sieve18 && '18H', d.sieve40 && '40H'].filter(Boolean).join(' · ') || '—'],
          ['Scale std / actual', `${d.stdWt || '—'} / ${d.actualWt || '—'} kg`],
          ['Checked by', d.checkedBy || '—'],
        ].map(([l, v]) => (
          <div key={l} className="border border-stone-200 rounded-lg px-3 py-2">
            <div className="text-[9px] text-stone-400 uppercase tracking-wide mb-0.5">{l}</div>
            <div className="font-medium text-[12px]">{v}</div>
          </div>
        ))}
      </div>

      {/* Inputs summary */}
      <div className="border border-stone-200 rounded-lg overflow-hidden">
        <SectionHdr>Debagging inputs</SectionHdr>
        {bucketIn > 0 && <Row label="Bucket Elevator carry-over (subtracted)" value={`− ${bucketIn.toFixed(1)} kg`} warn/>}
        {num(d.spillageKg) > 0 && <Row label="Machine spillage (subtracted)" value={`− ${num(d.spillageKg).toFixed(1)} kg`} warn/>}
        <Row label="Total A — net input" value={`${totalA.toFixed(1)} kg`} green/>
      </div>

      {/* Fine Leaf — grouped by lot */}
      {flBags.length > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>Fine Leaf outputs — grouped by lot (enter into Acumatica)</SectionHdr>
          <div className="p-2">
            {Object.entries(flByLot).map(([lot, g]) => (
              <LotBlock key={lot} item="Fine Leaf" lot={lot} bags={g.bags} kg={g.kg} serials={g.serials}/>
            ))}
          </div>
          <div className="flex justify-between px-3 py-2 bg-emerald-50 border-t border-emerald-200">
            <span className="text-[11px] font-semibold text-emerald-700">Total Fine Leaf</span>
            <span className="font-mono font-bold text-[13px] text-emerald-700">{totalFL.toFixed(1)} kg · {flBags.length} bags</span>
          </div>
        </div>
      )}

      {/* Coarse Leaf — grouped by lot */}
      {clBags.length > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>Coarse Leaf outputs — grouped by lot (enter into Acumatica)</SectionHdr>
          <div className="p-2">
            {Object.entries(clByLot).map(([lot, g]) => (
              <LotBlock key={lot} item="Coarse Leaf" lot={lot} bags={g.bags} kg={g.kg} serials={g.serials}/>
            ))}
          </div>
          <div className="flex justify-between px-3 py-2 bg-emerald-50 border-t border-emerald-200">
            <span className="text-[11px] font-semibold text-emerald-700">Total Coarse Leaf</span>
            <span className="font-mono font-bold text-[13px] text-emerald-700">{totalCL.toFixed(1)} kg · {clBags.length} bags</span>
          </div>
        </div>
      )}

      {/* Untracked outputs */}
      {(totalRB + totalDust + totalRS + totalIS + bucketOut) > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>Other outputs — total kg only (Acumatica)</SectionHdr>
          {totalRB   > 0 && <Row label="RB Blocks"           value={`${totalRB.toFixed(1)} kg`}   green/>}
          {totalDust > 0 && <Row label="Dust"                value={`${totalDust.toFixed(1)} kg`}  green/>}
          {totalRS   > 0 && <Row label="Rolsiev E Sticks"    value={`${totalRS.toFixed(1)} kg`}    green/>}
          {totalIS   > 0 && <Row label="Indent Sticks"       value={`${totalIS.toFixed(1)} kg`}    green/>}
          {bucketOut > 0 && <Row label="Bucket Elevator out" value={`${bucketOut.toFixed(1)} kg`}  warn sub="carry-over to tomorrow"/>}
        </div>
      )}

      <MBLine a={totalA} b={totalOut} label="E"/>
    </div>
  )
}

// ── REFINING 1 ────────────────────────────────────────────────────────────────
function Refining1Summary({ d, date, shift }: { d: any; date: string; shift: string }) {
  const debag: any[] = d.debag ?? []
  const out1: any[]  = d.out1  ?? []
  const out2: any[]  = d.out2  ?? []
  const out3: any[]  = d.out3  ?? []
  const totalA = debag.reduce((s: number, r: any) => s + num(r.qty), 0)
  const totalB = out1.reduce((s: number, r: any) => s + num(r.qty), 0)
  const totalC = out2.reduce((s: number, r: any) => s + num(r.qty), 0)
  const totalD = out3.reduce((s: number, r: any) => s + num(r.qty), 0)

  // Group output bags by type then total kg per type
  function groupOutputs(rows: any[]) {
    const map: Record<string, { bags: number; kg: number; serials: string[] }> = {}
    rows.forEach((r: any) => {
      const type = r.name || 'Unknown'
      if (!map[type]) map[type] = { bags: 0, kg: 0, serials: [] }
      if (num(r.qty) > 0) { map[type].bags++; map[type].kg += num(r.qty) }
      if (r.serial) map[type].serials.push(r.serial)
    })
    return map
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        {[['Form', 'PR-FM-072/0'], ['Date / Shift', `${date} · ${d.shift || shift}`],
          ['Operator 1', d.op1 || '—'], ['Operator 2', d.op2 || '—']
        ].map(([l, v]) => (
          <div key={l} className="border border-stone-200 rounded-lg px-3 py-2">
            <div className="text-[9px] text-stone-400 uppercase tracking-wide mb-0.5">{l}</div>
            <div className="font-medium text-[12px]">{v}</div>
          </div>
        ))}
      </div>

      {/* Inputs */}
      <div className="border border-stone-200 rounded-lg overflow-hidden">
        <SectionHdr>Debagging inputs — Total (A)</SectionHdr>
        {debag.map((r: any, i: number) => (
          <Row key={i} label={`${r.date || '—'}  ·  ${r.con_org}${r.grade ? ` / ${r.grade}` : ''}`}
            value={`${num(r.qty).toFixed(1)} kg`} sub={r.serial || ''}/>
        ))}
        <Row label="Total (A)" value={`${totalA.toFixed(1)} kg`} green/>
      </div>

      {/* Outputs — grouped by type */}
      {[
        { label: 'Output 1 — Total (B)', rows: out1, total: totalB },
        { label: 'Output 2 — Total (C)', rows: out2, total: totalC },
        { label: 'Output 3 — Total (D)', rows: out3, total: totalD },
      ].filter(g => g.total > 0).map(g => {
        const grouped = groupOutputs(g.rows)
        return (
          <div key={g.label} className="border border-stone-200 rounded-lg overflow-hidden">
            <SectionHdr>{g.label} — enter into Acumatica</SectionHdr>
            <div className="p-2">
              {Object.entries(grouped).map(([type, info]) => (
                <div key={type} className="border border-stone-100 rounded-lg px-3 py-2 mb-1.5 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-[13px] text-stone-800">{type}</span>
                    <span className="text-[10px] text-stone-400 ml-2 font-mono">{info.serials.join(' · ')}</span>
                  </div>
                  <span className="font-mono font-bold text-[14px] text-emerald-700">{info.kg.toFixed(1)} kg</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between px-3 py-2 bg-emerald-50 border-t border-emerald-200">
              <span className="text-[11px] font-semibold text-emerald-700">{g.label.split('—')[0].trim()}</span>
              <span className="font-mono font-bold text-[13px] text-emerald-700">{g.total.toFixed(1)} kg</span>
            </div>
          </div>
        )
      })}

      {d.comments && (
        <div className="border border-stone-200 rounded-lg px-3 py-2 text-[12px] text-stone-600">
          <span className="text-[9px] text-stone-400 uppercase tracking-wide block mb-1">Comments</span>
          {d.comments}
        </div>
      )}

      <MBLine a={totalA} b={totalB} c={totalC} d={totalD} label="E"/>
    </div>
  )
}

// ── REFINING 2 ────────────────────────────────────────────────────────────────
function Refining2Summary({ d, date, shift }: { d: any; date: string; shift: string }) {
  const debag: any[] = d.debag  ?? []
  const rowsA: any[] = d.rowsA ?? []
  const rowsB: any[] = d.rowsB ?? []
  const rowsC: any[] = d.rowsC ?? []
  const rowsD: any[] = d.rowsD ?? []
  const totalIn  = debag.reduce((s: number, r: any) => s + num(r.qty), 0)
  const totalA   = rowsA.reduce((s: number, r: any) => s + num(r.qty), 0)
  const totalB   = rowsB.reduce((s: number, r: any) => s + num(r.qty), 0)
  const totalC   = rowsC.reduce((s: number, r: any) => s + num(r.qty), 0)
  const totalD   = rowsD.reduce((s: number, r: any) => s + num(r.qty), 0)

  const LABELS = ['Cut Heavy Stick Fine', 'Cut Heavy Stick Coarse', 'White Dust', 'Powder Dust']

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        {[['Form', 'PR-FM-072/0'], ['Date / Shift', `${date} · ${d.shift || shift}`],
          ['Operator 1', d.op1 || '—'], ['Operator 2', d.op2 || '—']
        ].map(([l, v]) => (
          <div key={l} className="border border-stone-200 rounded-lg px-3 py-2">
            <div className="text-[9px] text-stone-400 uppercase tracking-wide mb-0.5">{l}</div>
            <div className="font-medium text-[12px]">{v}</div>
          </div>
        ))}
      </div>

      {/* Inputs */}
      <div className="border border-stone-200 rounded-lg overflow-hidden">
        <SectionHdr>Debagging inputs — Total (A)</SectionHdr>
        {debag.map((r: any, i: number) => (
          <Row key={i} label={`${r.grade || r.con_org || '—'}`}
            value={`${num(r.qty).toFixed(1)} kg`} sub={r.serial || ''}/>
        ))}
        <Row label="Total (A)" value={`${totalIn.toFixed(1)} kg`} green/>
      </div>

      {/* Named outputs */}
      <div className="border border-stone-200 rounded-lg overflow-hidden">
        <SectionHdr>Bagging outputs — enter into Acumatica</SectionHdr>
        {[
          { label: LABELS[0], rows: rowsA, total: totalA },
          { label: LABELS[1], rows: rowsB, total: totalB },
          { label: LABELS[2], rows: rowsC, total: totalC },
          { label: LABELS[3], rows: rowsD, total: totalD },
        ].filter(g => g.total > 0).map(g => (
          <div key={g.label} className="border-b border-stone-100 last:border-b-0">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div>
                <span className="font-semibold text-[13px] text-stone-800">{g.label}</span>
                <span className="font-mono text-[10px] text-stone-400 ml-2">
                  {g.rows.filter((r: any) => r.serial).map((r: any) => r.serial).join(' · ')}
                </span>
              </div>
              <span className="font-mono font-bold text-[14px] text-emerald-700">{g.total.toFixed(1)} kg</span>
            </div>
          </div>
        ))}
      </div>

      {d.comments && (
        <div className="border border-stone-200 rounded-lg px-3 py-2 text-[12px] text-stone-600">
          <span className="text-[9px] text-stone-400 uppercase tracking-wide block mb-1">Comments</span>
          {d.comments}
        </div>
      )}

      <MBLine a={totalIn} b={totalA} c={totalB} d={totalC + totalD} label="E"/>
    </div>
  )
}

// ── GRANULE LINE ──────────────────────────────────────────────────────────────
function GranuleSummary({ d, date, shift }: { d: any; date: string; shift: string }) {
  const summary: any[]  = d.summary   ?? []
  const dustRows: any[] = d.dustRows  ?? []
  const blendRows: any[]= d.blendRows ?? []
  const totalOutput = summary.reduce((s: number, r: any) => s + num(r.total_output_kg), 0)

  // Group summary by lot
  const byLot: Record<string, { product: string; bags: string; kg: number }> = {}
  summary.forEach((r: any) => {
    const lot = r.lot_number || '—'
    if (!byLot[lot]) byLot[lot] = { product: r.product_type, bags: r.total_bags, kg: 0 }
    byLot[lot].kg += num(r.total_output_kg)
    byLot[lot].bags = r.total_bags || byLot[lot].bags
  })

  const GRAN_COLS = [
    'Brown Dust / CP Dust', 'White Dust', 'Indent Dust',
    'Leaf Dust', 'ALT Dust', 'SG Dust', 'Dust Extraction (= Powder Dust)',
  ]
  const COL_KEYS = [
    'brown_dust', 'white_dust', 'indent_dust',
    'leaf_dust', 'alt_dust', 'sg_dust', 'dust_extraction',
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {[['Form', 'PR-FM-026/7'], ['Date / Shift', `${date} · ${d.shift || shift}`],
          ['Operators', d.operators || '—'], ['Supervisor', d.supervisor || '—'],
          ['Lot number', d.lotNumber || '—'], ['', ''],
        ].map(([l, v], i) => l ? (
          <div key={i} className="border border-stone-200 rounded-lg px-3 py-2">
            <div className="text-[9px] text-stone-400 uppercase tracking-wide mb-0.5">{l}</div>
            <div className="font-mono font-medium text-[12px]">{v}</div>
          </div>
        ) : <div key={i}/>)}
      </div>

      {/* Bagging summary — lot grouped, feeds Acumatica */}
      <div className="border-2 border-emerald-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Bagging summary → enter into Acumatica production order</span>
        </div>
        {Object.entries(byLot).map(([lot, g]) => (
          <div key={lot} className="border-b border-stone-100 last:border-b-0 flex items-center justify-between px-3 py-3">
            <div>
              <span className="font-semibold text-[13px] text-stone-800">{g.product}</span>
              <span className="font-mono text-[11px] text-emerald-700 ml-2 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">{lot}</span>
            </div>
            <div className="text-right">
              <span className="font-mono font-bold text-[15px] text-emerald-700">{g.kg.toFixed(1)} kg</span>
              {g.bags && <span className="text-[10px] text-stone-400 ml-2">{g.bags} bags</span>}
            </div>
          </div>
        ))}
        <div className="flex justify-between px-3 py-2.5 bg-emerald-50 border-t border-emerald-200">
          <span className="text-[12px] font-bold text-emerald-700">Total output (C*)</span>
          <span className="font-mono font-bold text-[15px] text-emerald-700">{totalOutput.toFixed(1)} kg</span>
        </div>
      </div>

      {/* Dust from granule line */}
      {dustRows.filter((r: any) => num(r.qty_kg) > 0).length > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>Dust from granule line</SectionHdr>
          {dustRows.filter((r: any) => num(r.qty_kg) > 0).map((r: any, i: number) => (
            <Row key={i} label={r.dust_type || '—'} value={`${num(r.qty_kg).toFixed(1)} kg`} sub={`${r.bags || '?'} bags`}/>
          ))}
        </div>
      )}

      {/* Mass Balance Report summary */}
      {blendRows && blendRows.length > 0 && blendRows.some((r: any) => num(r.brown_dust_kg) + num(r.indent_dust_kg) > 0) && (
        <div className="border border-amber-200 rounded-lg overflow-hidden">
          <SectionHdr>Plant Shift Mass Balance — blend inputs (PR-FM-026/7)</SectionHdr>
          {blendRows.map((r: any, i: number) => {
            const blendTotal = COL_KEYS.reduce((s, k) => s + num((r as any)[k + '_kg']), 0) + num(r.water_kg)
            if (blendTotal === 0) return null
            return (
              <div key={i} className="border-b border-stone-100 last:border-b-0 px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-[12px] text-stone-700">Blend {i + 1}</span>
                  <span className="font-mono font-bold text-[12px] text-amber-700">{blendTotal.toFixed(1)} kg</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {COL_KEYS.map((k, ci) => {
                    const kg = num((r as any)[k + '_kg'])
                    if (kg === 0) return null
                    return (
                      <span key={k} className="text-[10px] font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-600">
                        {GRAN_COLS[ci].split(' ')[0]}: {kg.toFixed(0)} kg
                        {(r as any)[k + '_serial'] ? ` · ${(r as any)[k + '_serial']}` : ''}
                      </span>
                    )
                  })}
                  {num(r.water_kg) > 0 && (
                    <span className="text-[10px] font-mono bg-blue-100 px-1.5 py-0.5 rounded text-blue-600">
                      Water: {num(r.water_kg).toFixed(0)} kg
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {num(d.totalMixed) > 0 && (
            <div className="flex justify-between px-3 py-2.5 bg-amber-50 border-t border-amber-200">
              <span className="text-[11px] font-bold text-amber-700">Total Mixed (A) = Total Raw Material (H)</span>
              <span className="font-mono font-bold text-[13px] text-amber-700">{num(d.totalMixed).toFixed(1)} kg</span>
            </div>
          )}
        </div>
      )}

      {/* Mass balance numbers */}
      {num(d.totalMixed) > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>Mass balance</SectionHdr>
          <Row label="Total produced G = C* + D + E + F" value={`${num(d.totalProducedG).toFixed(1)} kg`} green/>
          <Row label="Total raw material H = A"          value={`${num(d.totalRawH).toFixed(1)} kg`}/>
          <Row label="Balance H − G"                     value={`${num(d.balanceFG).toFixed(1)} kg`} green={Math.abs(num(d.balanceFG)) <= 30} warn={Math.abs(num(d.balanceFG)) > 30}/>
          <Row label="Yield % (G / H)"                   value={`${d.yieldPct ?? '—'}`} green/>
        </div>
      )}
    </div>
  )
}

// ── BLENDER ───────────────────────────────────────────────────────────────────
function BlenderSummary({ d, date, shift }: { d: any; date: string; shift: string }) {
  const rowsA: any[] = d.rowsA ?? []
  const rowsB: any[] = d.rowsB ?? []
  const rowsC: any[] = d.rowsC ?? []
  const rowsD: any[] = d.rowsD ?? []
  const rowsE: any[] = d.rowsE ?? []
  const rowsF: any[] = d.rowsF ?? []
  const bagRows: any[]= d.bagRows ?? []

  const totalA  = rowsA.reduce((s: number, r: any) => s + num(r.kg), 0)
  const totalB  = rowsB.reduce((s: number, r: any) => s + num(r.kg), 0)
  const totalC  = rowsC.reduce((s: number, r: any) => s + num(r.kg), 0)
  const totalD  = rowsD.reduce((s: number, r: any) => s + num(r.kg), 0)
  const totalE  = rowsE.reduce((s: number, r: any) => s + num(r.kg), 0)
  const totalF  = rowsF.reduce((s: number, r: any) => s + num(r.kg), 0)
  const totalIn = totalA + totalB + totalC + totalD + totalE + totalF
  const totalOut= bagRows.reduce((s: number, r: any) => s + num(r.kg), 0)
  const pct = (v: number) => totalIn > 0 ? `${((v / totalIn) * 100).toFixed(1)}%` : '—'

  // Group Fine Leaf (A) and Coarse Leaf (B) by lot
  function groupByLot(rows: any[]) {
    const map: Record<string, { bags: number; kg: number; serials: string[] }> = {}
    rows.forEach((r: any) => {
      const lot = r.lot || '—'
      if (!map[lot]) map[lot] = { bags: 0, kg: 0, serials: [] }
      if (num(r.kg) > 0) { map[lot].bags++; map[lot].kg += num(r.kg) }
      if (r.serial) map[lot].serials.push(r.serial)
    })
    return map
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {[
          ['Form', 'Debagging + Bagging'],
          ['Date / Shift', `${date} · ${d.shift || shift}`],
          ['Supervisor', d.supervisor || '—'],
          ['Lot number', d.lotNo || '—'],
          ['Blend code', d.blendCode || '—'],
          ['Variant', d.variantCode || '—'],
        ].map(([l, v]) => (
          <div key={l} className="border border-stone-200 rounded-lg px-3 py-2">
            <div className="text-[9px] text-stone-400 uppercase tracking-wide mb-0.5">{l}</div>
            <div className="font-mono font-medium text-[12px]">{v}</div>
          </div>
        ))}
      </div>

      {/* Fine Leaf — lot grouped (Acumatica component release) */}
      {totalA > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>A — Sieved Fine Leaf · {pct(totalA)} · {totalA.toFixed(1)} kg (material release)</SectionHdr>
          <div className="p-2">
            {Object.entries(groupByLot(rowsA)).map(([lot, g]) => (
              <LotBlock key={lot} item="Fine Leaf" lot={lot} bags={g.bags} kg={g.kg} serials={g.serials}/>
            ))}
          </div>
        </div>
      )}

      {/* Coarse Leaf — lot grouped */}
      {totalB > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>B — Sieved Coarse Leaf · {pct(totalB)} · {totalB.toFixed(1)} kg (material release)</SectionHdr>
          <div className="p-2">
            {Object.entries(groupByLot(rowsB)).map(([lot, g]) => (
              <LotBlock key={lot} item="Coarse Leaf" lot={lot} bags={g.bags} kg={g.kg} serials={g.serials}/>
            ))}
          </div>
        </div>
      )}

      {/* Other inputs C–F */}
      {(totalC + totalD + totalE + totalF) > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>Other inputs C–F</SectionHdr>
          {totalC > 0 && <Row label={`C — Blocks Clean`} value={`${totalC.toFixed(1)} kg`} sub={pct(totalC)} green/>}
          {totalD > 0 && <Row label={`D — Blocks Cut`}   value={`${totalD.toFixed(1)} kg`} sub={pct(totalD)} green/>}
          {totalE > 0 && <Row label={`E — ${d.other1Label || 'Other 1'}`} value={`${totalE.toFixed(1)} kg`} sub={pct(totalE)} green/>}
          {totalF > 0 && <Row label={`F — ${d.other2Label || 'Other 2'}`} value={`${totalF.toFixed(1)} kg`} sub={pct(totalF)} green/>}
        </div>
      )}

      {/* Total input */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-sky-50 border border-sky-200 rounded-lg">
        <span className="text-[12px] font-bold text-sky-700">Total input (I)</span>
        <span className="font-mono font-bold text-[15px] text-sky-700">{totalIn.toFixed(1)} kg</span>
      </div>

      {/* Output bags */}
      {bagRows.length > 0 && (
        <div className="border-2 border-emerald-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200">
            <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Blended Material output bags → Acumatica production order</span>
          </div>
          {bagRows.filter((r: any) => num(r.kg) > 0).map((r: any, i: number) => (
            <div key={i} className="border-b border-stone-100 last:border-b-0 flex items-center justify-between px-3 py-2.5">
              <div>
                <span className="font-mono text-[12px] font-bold text-stone-800">{r.serial_no || '—'}</span>
                <span className="text-[10px] text-stone-400 ml-2">{r.blend_type || d.blendCode || '—'} · {r.time || '—'}</span>
              </div>
              <span className="font-mono font-bold text-[13px] text-emerald-700">{num(r.kg).toFixed(1)} kg</span>
            </div>
          ))}
          <div className="flex justify-between px-3 py-2.5 bg-emerald-50 border-t border-emerald-200">
            <span className="text-[12px] font-bold text-emerald-700">Total output (G)</span>
            <span className="font-mono font-bold text-[15px] text-emerald-700">{totalOut.toFixed(1)} kg</span>
          </div>
        </div>
      )}

      {/* Blend component ratio */}
      {totalIn > 0 && (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <SectionHdr>Blend component ratio</SectionHdr>
          {[
            ['Fine Leaf (A)', totalA], ['Coarse Leaf (B)', totalB],
            ['Blocks Clean (C)', totalC], ['Blocks Cut (D)', totalD],
            [d.other1Label || 'Other 1 (E)', totalE], [d.other2Label || 'Other 2 (F)', totalF],
          ].filter(([, v]) => (v as number) > 0).map(([l, v]) => (
            <Row key={l as string} label={l as string} value={`${(v as number).toFixed(1)} kg`} sub={pct(v as number)} indent/>
          ))}
          <Row label="Total (I)" value={`${totalIn.toFixed(1)} kg`} green/>
        </div>
      )}

      <MBLine a={totalOut} b={totalIn} label="J = G − I"/>
    </div>
  )
}

// ── PASTEURISER ───────────────────────────────────────────────────────────────
function PasteuriseurSummary({ d, date, shift }: { d: any; date: string; shift: string }) {
  return (
    <div className="border border-amber-200 rounded-lg px-4 py-3 bg-amber-50 text-[12px] text-amber-700">
      Pasteuriser data is captured across 7 sub-tabs (daily report, rate of production, debagging, bagging etc).
      The Acumatica entry fields are in the Debagging and Bagging sub-tabs. Date: {date} · {shift} shift.
    </div>
  )
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
const SECTION_NAMES: Record<string, string> = {
  sieving:'Sieving Tower', refining1:'Refining 1', refining2:'Refining 2',
  granule:'Granule Line', blender:'Big Blender', pasteuriser:'Pasteuriser',
}
const SECTION_COLORS: Record<string, string> = {
  sieving:'bg-teal-500', refining1:'bg-blue-600', refining2:'bg-blue-500',
  granule:'bg-amber-500', blender:'bg-purple-500', pasteuriser:'bg-red-500',
}

function AcumaticaSummary({
  sectionId, sessionData, date, shift,
}: {
  sectionId: string; sessionData: any; date: string; shift: string
}) {
  const [copied, setCopied] = useState(false)
  const d = sessionData ?? {}

  function handleCopy() {
    const lines = [`CNTP — ${SECTION_NAMES[sectionId] ?? sectionId}`, `${date} · ${shift} shift`, '']
    if (sectionId === 'sieving') {
      const flBags: any[] = d.flBags ?? []
      const byLot: Record<string, { bags: number; kg: number }> = {}
      flBags.forEach((b: any) => {
        const lot = b.batch || '—'
        if (!byLot[lot]) byLot[lot] = { bags: 0, kg: 0 }
        byLot[lot].bags++; byLot[lot].kg += num(b.kg)
      })
      lines.push('Item\tLot\tBags\tTotal kg')
      Object.entries(byLot).forEach(([lot, g]) => lines.push(`Fine Leaf\t${lot}\t${g.bags}\t${g.kg.toFixed(1)}`))
    } else if (sectionId === 'granule') {
      const summary: any[] = d.summary ?? []
      lines.push('Product type\tLot\tTotal bags\tkg')
      summary.forEach((r: any) => lines.push(`${r.product_type}\t${r.lot_number}\t${r.total_bags}\t${num(r.total_output_kg).toFixed(1)}`))
    } else if (sectionId === 'blender') {
      const bagRows: any[] = d.bagRows ?? []
      lines.push('Serial\tBlend code\tkg')
      bagRows.forEach((r: any) => num(r.kg) > 0 && lines.push(`${r.serial_no}\t${r.blend_type || d.blendCode}\t${num(r.kg).toFixed(1)}`))
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="rounded-2xl border border-stone-200 overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 bg-stone-50 border-b border-stone-200">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${SECTION_COLORS[sectionId] ?? 'bg-stone-400'}`}/>
          <div>
            <p className="font-semibold text-[13px] text-stone-800">{SECTION_NAMES[sectionId] ?? sectionId} — Acumatica entry sheet</p>
            <p className="font-mono text-[10px] text-stone-400">{date} · <span className="capitalize">{shift}</span> shift</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            {copied ? <CheckCircle2 size={12} className="text-ok"/> : <Copy size={12}/>}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
            <Printer size={12}/> Print
          </button>
        </div>
      </div>

      <div className="p-4 overflow-x-auto">
        {!sessionData || Object.keys(d).length === 0 ? (
          <p className="text-[12px] text-stone-400 text-center py-8">No data captured yet — complete the Production tab first</p>
        ) : (
          <>
            {sectionId === 'sieving'     && <SievingSummary     d={d} date={date} shift={shift}/>}
            {sectionId === 'refining1'   && <Refining1Summary   d={d} date={date} shift={shift}/>}
            {sectionId === 'refining2'   && <Refining2Summary   d={d} date={date} shift={shift}/>}
            {sectionId === 'granule'     && <GranuleSummary     d={d} date={date} shift={shift}/>}
            {sectionId === 'blender'     && <BlenderSummary     d={d} date={date} shift={shift}/>}
            {sectionId === 'pasteuriser' && <PasteuriseurSummary d={d} date={date} shift={shift}/>}
          </>
        )}
      </div>
    </div>
  )
}

export default AcumaticaSummary
export { AcumaticaSummary }
'use client'

import { useState } from 'react'
import { Plus, Trash2, Printer, Package, PackageCheck, Scale, AlertTriangle, Sparkles } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort } from '@/lib/production/capture-config'
import { nextStepNudge } from '@/lib/production/inventory'
import { OutputPicker, type PickedOutput } from '@/components/production/capture/OutputPicker'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

export interface SpillageRow { id: string; kg: string }
export interface DebagRow {
  id: string; bag_no: string; lot: string; gross: string; nett: string
  delivery_date: string; local_export: string
}
export interface OutBag {
  id: string; serial: string; productType: string; code: string | null
  weight: string; batch: string; destination: string; printed: boolean
}
export interface SievingData {
  spillage: SpillageRow[]
  debag:    DebagRow[]
  outputs:  OutBag[]
}

export function emptySievingData(): SievingData {
  return {
    spillage: [{ id: crypto.randomUUID(), kg: '' }, { id: crypto.randomUUID(), kg: '' }],
    debag:    [],
    outputs:  [],
  }
}

const n = (v: string) => parseFloat(v) || 0

export function sievingTotals(d: SievingData) {
  const totalIn  = (d.debag ?? []).reduce((s, r) => s + n(r.nett), 0)
  const totalOut = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0)
  const spillage = (d.spillage ?? []).reduce((s, r) => s + n(r.kg), 0)
  return { totalIn, totalOut, spillage }
}

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'

export function SievingCapture({
  assignment, variantWord, locked, value, onChange, genSerial,
}: {
  assignment: ShiftAssignment
  variantWord: string
  locked: boolean
  value: SievingData
  onChange: (d: SievingData) => void
  genSerial: () => string
}) {
  const [tab, setTab]       = useState<'debag' | 'bag'>('debag')
  const [picking, setPicking] = useState(false)
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  const patch = (p: Partial<SievingData>) => onChange({ ...value, ...p })

  // ── Debagging ────────────────────────────────────────────────────────────
  const addDebag = () => patch({ debag: [...value.debag, {
    id: crypto.randomUUID(), bag_no: '', lot: assignment.lot_number ?? '',
    gross: '', nett: '', delivery_date: '', local_export: 'Export',
  }] })
  const updateDebag = (id: string, k: keyof DebagRow, v: string) =>
    patch({ debag: value.debag.map(r => r.id === id ? { ...r, [k]: v } : r) })
  const removeDebag = (id: string) => patch({ debag: value.debag.filter(r => r.id !== id) })
  const updateSpillage = (id: string, v: string) =>
    patch({ spillage: value.spillage.map(r => r.id === id ? { ...r, kg: v } : r) })

  // ── Bagging — picker → serial → tag → label ──────────────────────────────
  async function addOutput(p: PickedOutput) {
    const serial = genSerial()
    const grade  = p.isLeaf ? (p.destination || 'A') : 'A'
    const now    = new Date().toISOString()
    const bag: OutputBag = {
      id: crypto.randomUUID(), serial_number: serial, product_type: p.productType,
      variant: variantShort, grade: grade as any, weight_kg: n(p.weight),
      lot_number: p.batch || assignment.lot_number || '', section_id: 'sieving',
      section_name: 'Sieving Tower', created_at: now, printed: false,
      acumaticaId: p.code ?? undefined, acumaticaDesc: p.description,
    }
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: 'sieving', session_id: null,
        product_type: p.productType, variant: variantWord || null, weight_kg: n(p.weight),
        lot_number: bag.lot_number || null, acumatica_id: p.code || null,
        status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
    } catch { /* session save retries */ }

    patch({ outputs: [...value.outputs, {
      id: bag.id, serial, productType: p.productType, code: p.code,
      weight: p.weight, batch: bag.lot_number, destination: p.destination, printed: true,
    }] })
    setPicking(false)
    printLabel(bag)
  }

  function reprint(b: OutBag) {
    printLabel({
      id: b.id, serial_number: b.serial, product_type: b.productType, variant: variantShort,
      grade: (b.destination || 'A') as any, weight_kg: n(b.weight), lot_number: b.batch,
      section_id: 'sieving', section_name: 'Sieving Tower', created_at: new Date().toISOString(),
      printed: true, acumaticaId: b.code ?? undefined,
    })
  }

  const { totalIn, totalOut } = sievingTotals(value)
  const byType: Record<string, number> = {}
  value.outputs.forEach(b => { byType[b.productType] = (byType[b.productType] ?? 0) + 1 })
  const nudge = nextStepNudge('sieving', byType)

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-stone-100 rounded-xl">
        {([['debag', 'Debagging (in)', Package], ['bag', 'Bagging (out)', PackageCheck]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-medium text-[13px] transition-colors ${tab === id ? 'bg-white text-brand shadow-sm' : 'text-stone-500'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'debag' && (
        <>
          <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Scale size={14} className="text-amber-700" />
              <span className="font-semibold text-[13px] text-amber-800">Bucket elevator</span>
              <span className="text-[11px] text-amber-700/80">excluded from balance</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {value.spillage.map((r, i) => (
                <div key={r.id} className="space-y-1">
                  <label className={LBL}>Spillage {i + 1} (kg)</label>
                  <input type="number" inputMode="decimal" value={r.kg} disabled={locked}
                    onChange={e => updateSpillage(r.id, e.target.value)} placeholder="0" className={INP} />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {value.debag.map((r, i) => {
              const overfill = n(r.nett) > 0 && n(r.gross) > 0 && n(r.nett) > n(r.gross)
              return (
                <div key={r.id} className={`bg-white border rounded-2xl p-4 space-y-3 ${overfill ? 'border-err/40' : 'border-stone-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[13px] text-text">Farm bag {i + 1}</span>
                    {!locked && <button onClick={() => removeDebag(r.id)} className="text-stone-300 hover:text-err p-1"><Trash2 size={15} /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><label className={LBL}>Bag no.</label>
                      <input value={r.bag_no} disabled={locked} onChange={e => updateDebag(r.id, 'bag_no', e.target.value)} className={INP} /></div>
                    <div className="space-y-1"><label className={LBL}>Lot / serial</label>
                      <input value={r.lot} disabled={locked} onChange={e => updateDebag(r.id, 'lot', e.target.value)} className={INP} /></div>
                    <div className="space-y-1"><label className={LBL}>Gross (kg)</label>
                      <input type="number" inputMode="decimal" value={r.gross} disabled={locked} onChange={e => updateDebag(r.id, 'gross', e.target.value)} className={INP} /></div>
                    <div className="space-y-1"><label className={LBL}>Nett (kg)</label>
                      <input type="number" inputMode="decimal" value={r.nett} disabled={locked} onChange={e => updateDebag(r.id, 'nett', e.target.value)} className={INP + (overfill ? ' border-err' : '')} /></div>
                    <div className="space-y-1"><label className={LBL}>Delivery date</label>
                      <input type="date" value={r.delivery_date} disabled={locked} onChange={e => updateDebag(r.id, 'delivery_date', e.target.value)} className={INP} /></div>
                    <div className="space-y-1"><label className={LBL}>Local / export</label>
                      <select value={r.local_export} disabled={locked} onChange={e => updateDebag(r.id, 'local_export', e.target.value)} className={INP + ' cursor-pointer'}>
                        <option>Export</option><option>Export Blend</option><option>Domestic/Local</option>
                      </select></div>
                  </div>
                  {overfill && (
                    <div className="flex items-center gap-2 text-[12px] text-err">
                      <AlertTriangle size={14} /> Nett can't exceed gross — check the scale reading
                    </div>
                  )}
                </div>
              )
            })}
            {!locked && (
              <button onClick={addDebag} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors">
                <Plus size={16} /> Add farm bag
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total raw material in</span>
            <span className="font-mono font-bold text-[16px]">{totalIn.toFixed(1)} kg</span>
          </div>
        </>
      )}

      {tab === 'bag' && (
        <>
          {value.outputs.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
              {value.outputs.map(b => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text">{b.productType} · {b.weight} kg</div>
                    <div className="font-mono text-[11px] text-text-muted">{b.serial}{b.code ? ` · ${b.code}` : ''}</div>
                  </div>
                  <span className="text-[11px] text-ok flex items-center gap-1"><Printer size={13} /> printed</span>
                  <button onClick={() => reprint(b)} className="text-stone-400 hover:text-brand p-1.5"><Printer size={15} /></button>
                  {!locked && <button onClick={() => patch({ outputs: value.outputs.filter(x => x.id !== b.id) })} className="text-stone-300 hover:text-err p-1.5"><Trash2 size={15} /></button>}
                </div>
              ))}
            </div>
          )}

          {nudge && !picking && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-ok/5 border border-ok/20 rounded-xl text-[12px] text-ok">
              <Sparkles size={14} /> {nudge}
            </div>
          )}

          {!locked && (picking
            ? <OutputPicker sectionId="sieving" variantWord={variantWord} defaultBatch={assignment.lot_number ?? ''}
                batchHints={[assignment.lot_number ?? '', ...value.outputs.map(b => b.batch), ...value.debag.map(r => r.lot)].filter(Boolean) as string[]}
                onAdd={addOutput} onClose={() => setPicking(false)} />
            : <button onClick={() => setPicking(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors">
                <Plus size={16} /> Add output bag
              </button>
          )}

          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total bagged out</span>
            <span className="font-mono font-bold text-[16px]">{totalOut.toFixed(1)} kg</span>
          </div>
        </>
      )}
    </div>
  )
}

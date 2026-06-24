'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Printer, Package, PackageCheck, Scale, Sparkles, Lock, Pencil, Check } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort } from '@/lib/production/capture-config'
import { nextStepNudge, recentBatches } from '@/lib/production/inventory'
import { OutputPicker, type PickedOutput } from '@/components/production/capture/OutputPicker'
import { BatchInput } from '@/components/production/capture/BatchInput'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

export interface SpillageRow { id: string; kg: string }
export interface DebagRow {
  id: string; bag_no: string; lot: string; gross: string; nett: string
  delivery_date: string; local_export: string; secured?: boolean
}
export interface OutBag {
  id: string; serial: string; productType: string; code: string | null
  weight: string; batch: string; destination: string; printed: boolean; secured?: boolean
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

// Destination letter → raw-material local/export label, kept consistent with the
// production's destination chosen at the top.
const DEST_LABEL: Record<string, string> = { A: 'Export', B: 'Export Blend', C: 'Domestic/Local' }

export function sievingTotals(d: SievingData) {
  const totalIn  = (d.debag ?? []).reduce((s, r) => s + n(r.nett), 0)
  const totalOut = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0)
  const spillage = (d.spillage ?? []).reduce((s, r) => s + n(r.kg), 0)
  return { totalIn, totalOut, spillage }
}

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'

export function SievingCapture({
  assignment, variantWord, gradeLetter = 'A', locked, value, onChange, genSerial,
}: {
  assignment: ShiftAssignment
  variantWord: string
  gradeLetter?: string
  locked: boolean
  value: SievingData
  onChange: (d: SievingData) => void
  genSerial: () => string
}) {
  const [tab, setTab]       = useState<'debag' | 'bag'>('debag')
  const [picking, setPicking] = useState(false)
  const [dbBatches, setDbBatches] = useState<string[]>([])
  useEffect(() => { recentBatches('sieving').then(setDbBatches) }, [])
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  const batchOptions = Array.from(new Set([
    assignment.lot_number ?? '',
    ...value.outputs.map(b => b.batch),
    ...value.debag.map(r => r.lot),
    ...dbBatches,
  ].filter(Boolean) as string[]))

  const patch = (p: Partial<SievingData>) => onChange({ ...value, ...p })

  // ── Debagging ────────────────────────────────────────────────────────────
  const addDebag = () => patch({ debag: [...value.debag, {
    id: crypto.randomUUID(), bag_no: '', lot: assignment.lot_number ?? '',
    gross: '', nett: '', delivery_date: '', local_export: DEST_LABEL[gradeLetter] ?? 'Export',
  }] })
  const updateDebag = (id: string, k: keyof DebagRow, v: string) =>
    patch({ debag: value.debag.map(r => r.id === id ? { ...r, [k]: v } : r) })
  const removeDebag = (id: string) => patch({ debag: value.debag.filter(r => r.id !== id) })
  const setDebagSecured = (id: string, val: boolean) =>
    patch({ debag: value.debag.map(r => r.id === id ? { ...r, secured: val } : r) })
  const setOutputSecured = (id: string, val: boolean) =>
    patch({ outputs: value.outputs.map(b => b.id === id ? { ...b, secured: val } : b) })
  const updateSpillage = (id: string, v: string) =>
    patch({ spillage: value.spillage.map(r => r.id === id ? { ...r, kg: v } : r) })

  // ── Bagging — picker → serial → tag → label ──────────────────────────────
  async function addOutput(p: PickedOutput) {
    const serial = genSerial()
    const grade  = gradeLetter || 'A'
    const now    = new Date().toISOString()
    const bag: OutputBag = {
      id: crypto.randomUUID(), serial_number: serial, product_type: p.productType,
      variant: variantShort, grade: grade as any, weight_kg: n(p.weight),
      lot_number: p.batch || '', section_id: 'sieving',
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
      // Event tracking — log the bagging-out once, when the bag is created.
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: 'sieving',
        weight_kg: n(p.weight),
      } as any)
    } catch { /* session save retries */ }

    patch({ outputs: [...value.outputs, {
      id: bag.id, serial, productType: p.productType, code: p.code,
      weight: p.weight, batch: bag.lot_number, destination: grade, printed: true,
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

  // Live counts so the in/out split reads as two clear jobs with visible progress.
  const debagCount = value.debag.filter(r => n(r.nett) > 0).length
  const bagCount   = value.outputs.length

  return (
    <div className="space-y-4">
      {/* The two jobs of capture, side by side — each shows how much is logged so far. */}
      <div className="grid grid-cols-2 gap-2.5">
        {([
          { id: 'debag', label: 'Debagging', dir: 'in',  Icon: Package,      count: debagCount, kg: totalIn },
          { id: 'bag',   label: 'Bagging',   dir: 'out', Icon: PackageCheck,  count: bagCount,   kg: totalOut },
        ] as const).map(t => {
          const on = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex flex-col gap-1.5 p-3.5 rounded-2xl border-2 text-left transition-all ${on ? 'border-brand bg-brand/5 shadow-sm' : 'border-stone-200 bg-white hover:border-stone-300'}`}>
              <div className="flex items-center gap-1.5">
                <t.Icon size={16} className={on ? 'text-brand' : 'text-stone-400'} />
                <span className={`font-semibold text-[14px] ${on ? 'text-brand' : 'text-stone-700'}`}>{t.label}</span>
                <span className="text-[11px] text-stone-400">({t.dir})</span>
              </div>
              <div className="text-[12px] text-stone-500">
                <span className="font-mono font-bold text-[14px] text-text">{t.count}</span> bag{t.count !== 1 ? 's' : ''}
                <span className="text-stone-300 mx-1.5">·</span>
                <span className="font-mono">{t.kg.toFixed(1)} kg</span>
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-[12px] text-stone-500 px-1 -mt-1">
        {tab === 'debag'
          ? 'What goes into the machine — weigh in each bulk bag.'
          : 'What comes out — every bag prints a barcode label.'}
      </p>

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
              // Secured bulk bags collapse to a read-only summary so the operator
              // can't accidentally change a finished bag — Edit re-opens it.
              if (r.secured) {
                return (
                  <div key={r.id} className="flex items-center gap-3 bg-ok/5 border border-ok/30 rounded-2xl px-4 py-3">
                    <Lock size={15} className="text-ok shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text">Bulk bag {i + 1} · {n(r.nett).toFixed(1)} kg</div>
                      <div className="font-mono text-[11px] text-text-muted truncate">{[r.bag_no, r.lot, r.local_export].filter(Boolean).join(' · ')}</div>
                    </div>
                    {!locked && (
                      <button onClick={() => setDebagSecured(r.id, false)}
                        className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg">
                        <Pencil size={13} /> Edit
                      </button>
                    )}
                  </div>
                )
              }
              return (
                <div key={r.id} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[13px] text-text">Bulk bag {i + 1}</span>
                    {!locked && <button onClick={() => removeDebag(r.id)} className="text-stone-300 hover:text-err p-1"><Trash2 size={15} /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><label className={LBL}>Bag no.</label>
                      <input value={r.bag_no} disabled={locked} onChange={e => updateDebag(r.id, 'bag_no', e.target.value)} className={INP} /></div>
                    <div className="space-y-1"><label className={LBL}>Lot / serial</label>
                      <BatchInput value={r.lot} disabled={locked} onChange={v => updateDebag(r.id, 'lot', v)} options={batchOptions} className={INP} placeholder="Type or pick" /></div>
                    <div className="space-y-1"><label className={LBL}>Nett (kg)</label>
                      <input type="number" inputMode="decimal" value={r.nett} disabled={locked} onChange={e => updateDebag(r.id, 'nett', e.target.value)} className={INP} /></div>
                    <div className="space-y-1"><label className={LBL}>Local / export</label>
                      <select value={r.local_export} disabled={locked} onChange={e => updateDebag(r.id, 'local_export', e.target.value)} className={INP + ' cursor-pointer'}>
                        <option>Export</option><option>Export Blend</option><option>Domestic/Local</option>
                      </select></div>
                  </div>
                  {!locked && (
                    <button onClick={() => setDebagSecured(r.id, true)} disabled={n(r.nett) <= 0}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] disabled:opacity-40 hover:bg-ok/20 transition-colors">
                      <Check size={15} /> Secure bag
                    </button>
                  )}
                </div>
              )
            })}
            {!locked && (
              <button onClick={addDebag} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors">
                <Plus size={16} /> Add bulk bag
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
                <div key={b.id} className={`flex items-center gap-3 px-4 py-3 ${b.secured ? 'bg-ok/5' : ''}`}>
                  {b.secured && <Lock size={14} className="text-ok shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text">{b.productType} · {b.weight} kg</div>
                    <div className="font-mono text-[11px] text-text-muted">{b.serial}{b.code ? ` · ${b.code}` : ''}</div>
                  </div>
                  <button onClick={() => reprint(b)} className="text-stone-400 hover:text-brand p-1.5" title="Reprint label"><Printer size={15} /></button>
                  {!locked && (b.secured
                    ? <button onClick={() => setOutputSecured(b.id, false)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg"><Pencil size={13} /> Unlock</button>
                    : <>
                        <button onClick={() => setOutputSecured(b.id, true)} className="flex items-center gap-1.5 text-[12px] text-ok hover:bg-ok/10 px-2 py-1 rounded-lg"><Check size={13} /> Secure</button>
                        <button onClick={() => patch({ outputs: value.outputs.filter(x => x.id !== b.id) })} className="text-stone-300 hover:text-err p-1.5"><Trash2 size={15} /></button>
                      </>
                  )}
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
            ? <OutputPicker sectionId="sieving" variantWord={variantWord} gradeLetter={gradeLetter}
                defaultBatch={[...value.debag].reverse().find(r => r.lot)?.lot ?? assignment.lot_number ?? ''}
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

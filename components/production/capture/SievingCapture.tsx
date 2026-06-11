'use client'

import { useState } from 'react'
import { Plus, Trash2, Printer, Package, PackageCheck, Scale } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { getAcumaticaCode, getInputAcumaticaCode } from '@/lib/production/acumatica-codes'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort, DESTINATION_OPTIONS } from '@/lib/production/capture-config'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

// ── Data model (lives in the session draft_data) ──────────────────────────────
export interface SpillageRow { id: string; kg: string }
export interface DebagRow {
  id: string; bag_no: string; lot: string; gross: string; nett: string
  delivery_date: string; local_export: string
}
export interface OutBag {
  id: string; serial: string; weight: string; batch: string
  destination: string; qc_name: string; printed: boolean
  acumaticaId?: string
}
export interface SievingData {
  spillage: SpillageRow[]
  debag:    DebagRow[]
  outputs:  Record<string, OutBag[]>
}

export function emptySievingData(): SievingData {
  return {
    spillage: [{ id: crypto.randomUUID(), kg: '' }, { id: crypto.randomUUID(), kg: '' }],
    debag:    [],
    outputs:  {},
  }
}

// Leaf outputs need a destination (Export / Export Blend / Domestic) → grade.
const LEAF_TYPES = new Set(['Fine Leaf', 'Coarse Leaf'])
const OUTPUT_TYPES = ['Fine Leaf', 'Coarse Leaf', 'RB Blocks', 'Rolsiev Sticks', 'Indent Sticks', 'Brown Dust', 'Powder Dust']

const n = (v: string) => parseFloat(v) || 0

// Pure totals — used by the orchestrator for mass balance.
export function sievingTotals(d: SievingData) {
  const totalIn  = (d.debag ?? []).reduce((s, r) => s + n(r.nett), 0)
  const totalOut = Object.values(d.outputs ?? {}).flat().reduce((s, b) => s + n(b.weight), 0)
  const spillage = (d.spillage ?? []).reduce((s, r) => s + n(r.kg), 0)
  return { totalIn, totalOut, spillage }
}

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/10'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'

export function SievingCapture({
  assignment, variantWord, locked, value, onChange, genSerial, dateStr, sectionCode,
}: {
  assignment: ShiftAssignment
  variantWord: string                       // full Acumatica variant word
  locked: boolean
  value: SievingData
  onChange: (d: SievingData) => void
  genSerial: () => string
  dateStr: string
  sectionCode: string
}) {
  const [tab, setTab] = useState<'debag' | 'bag'>('debag')
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  function patch(p: Partial<SievingData>) { onChange({ ...value, ...p }) }

  // ── Debagging ────────────────────────────────────────────────────────────
  function addDebag() {
    patch({ debag: [...value.debag, {
      id: crypto.randomUUID(), bag_no: '', lot: assignment.lot_number ?? '',
      gross: '', nett: '', delivery_date: '', local_export: 'Export',
    }] })
  }
  function updateDebag(id: string, k: keyof DebagRow, v: string) {
    patch({ debag: value.debag.map(r => r.id === id ? { ...r, [k]: v } : r) })
  }
  function removeDebag(id: string) { patch({ debag: value.debag.filter(r => r.id !== id) }) }

  function updateSpillage(id: string, v: string) {
    patch({ spillage: value.spillage.map(r => r.id === id ? { ...r, kg: v } : r) })
  }

  // ── Bagging — generate serial, derive code, write tag, print label ─────────
  async function addOutput(type: string, draft: { weight: string; batch: string; destination: string; qc_name: string }) {
    const serial = genSerial()
    const grade  = LEAF_TYPES.has(type) ? (draft.destination || 'A') : 'A'
    const acu    = getAcumaticaCode(type, variantShort, grade)
    const now    = new Date().toISOString()

    const bag: OutputBag = {
      id: crypto.randomUUID(),
      serial_number: serial,
      product_type:  type,
      variant:       variantShort,
      grade:         grade as any,
      weight_kg:     n(draft.weight),
      lot_number:    draft.batch || assignment.lot_number || '',
      section_id:    'sieving',
      section_name:  'Sieving Tower',
      created_at:    now,
      printed:       false,
      acumaticaId:   acu?.inventoryId,
      acumaticaDesc: acu?.description,
      phantomId:     acu?.phantomId,
    }

    // Write the tag immediately so a downstream section can scan it right away.
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial,
        section_id:    'sieving',
        session_id:    null,
        product_type:  type,
        variant:       variantWord || null,
        weight_kg:     n(draft.weight),
        lot_number:    bag.lot_number || null,
        acumatica_id:  acu?.inventoryId || null,
        destination:   acu?.phantomId || null,
        qc_initials:   draft.qc_name || null,
        status:        'in_stock',
        consumed:      false,
        printed_at:    now,
      } as any, { onConflict: 'serial_number' })
    } catch { /* non-fatal — session save retries */ }

    const out: OutBag = {
      id: bag.id, serial, weight: draft.weight, batch: bag.lot_number,
      destination: draft.destination, qc_name: draft.qc_name, printed: true,
      acumaticaId: acu?.inventoryId,
    }
    patch({ outputs: { ...value.outputs, [type]: [...(value.outputs[type] ?? []), out] } })
    printLabel(bag)
  }

  function removeOutput(type: string, id: string) {
    patch({ outputs: { ...value.outputs, [type]: (value.outputs[type] ?? []).filter(b => b.id !== id) } })
  }

  function reprint(type: string, b: OutBag) {
    const grade = LEAF_TYPES.has(type) ? (b.destination || 'A') : 'A'
    const acu   = getAcumaticaCode(type, variantShort, grade)
    printLabel({
      id: b.id, serial_number: b.serial, product_type: type, variant: variantShort,
      grade: grade as any, weight_kg: n(b.weight), lot_number: b.batch,
      section_id: 'sieving', section_name: 'Sieving Tower', created_at: new Date().toISOString(),
      printed: true, acumaticaId: acu?.inventoryId, acumaticaDesc: acu?.description, phantomId: acu?.phantomId,
    })
  }

  const { totalIn, totalOut } = sievingTotals(value)

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 bg-stone-100 rounded-xl">
        {([['debag', 'Debagging (in)', Package], ['bag', 'Bagging (out)', PackageCheck]] as const).map(([id, label, Icon]) => (
          <button
            key={id} onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-medium text-[13px] transition-colors ${tab === id ? 'bg-white text-brand shadow-sm' : 'text-stone-500'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'debag' && (
        <>
          {/* Bucket elevator spillage */}
          <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Scale size={14} className="text-amber-700" />
              <span className="font-semibold text-[13px] text-amber-800">Bucket elevator</span>
              <span className="text-[11px] text-amber-700/80">returned to next batch — excluded from balance</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {value.spillage.map((r, i) => (
                <div key={r.id} className="space-y-1">
                  <label className={LBL}>Spillage {i + 1} (kg)</label>
                  <input
                    type="number" inputMode="decimal" value={r.kg} disabled={locked}
                    onChange={e => updateSpillage(r.id, e.target.value)}
                    placeholder="0" className={INP}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Farm bag inputs */}
          <div className="space-y-3">
            {value.debag.map((r, i) => (
              <div key={r.id} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[13px] text-text">Farm bag {i + 1}</span>
                  {!locked && (
                    <button onClick={() => removeDebag(r.id)} className="text-stone-300 hover:text-err p-1">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={LBL}>Bag no.</label>
                    <input value={r.bag_no} disabled={locked} onChange={e => updateDebag(r.id, 'bag_no', e.target.value)} className={INP} />
                  </div>
                  <div className="space-y-1">
                    <label className={LBL}>Lot / serial</label>
                    <input value={r.lot} disabled={locked} onChange={e => updateDebag(r.id, 'lot', e.target.value)} className={INP} />
                  </div>
                  <div className="space-y-1">
                    <label className={LBL}>Gross (kg)</label>
                    <input type="number" inputMode="decimal" value={r.gross} disabled={locked} onChange={e => updateDebag(r.id, 'gross', e.target.value)} className={INP} />
                  </div>
                  <div className="space-y-1">
                    <label className={LBL}>Nett (kg)</label>
                    <input type="number" inputMode="decimal" value={r.nett} disabled={locked} onChange={e => updateDebag(r.id, 'nett', e.target.value)} className={INP} />
                  </div>
                  <div className="space-y-1">
                    <label className={LBL}>Delivery date</label>
                    <input type="date" value={r.delivery_date} disabled={locked} onChange={e => updateDebag(r.id, 'delivery_date', e.target.value)} className={INP} />
                  </div>
                  <div className="space-y-1">
                    <label className={LBL}>Local / export</label>
                    <select value={r.local_export} disabled={locked} onChange={e => updateDebag(r.id, 'local_export', e.target.value)} className={INP + ' cursor-pointer'}>
                      <option>Export</option><option>Export Blend</option><option>Domestic/Local</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
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
          {OUTPUT_TYPES.map(type => (
            <OutputGroup
              key={type}
              type={type}
              bags={value.outputs[type] ?? []}
              isLeaf={LEAF_TYPES.has(type)}
              locked={locked}
              defaultBatch={assignment.lot_number ?? ''}
              onAdd={draft => addOutput(type, draft)}
              onRemove={id => removeOutput(type, id)}
              onReprint={b => reprint(type, b)}
            />
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total bagged out</span>
            <span className="font-mono font-bold text-[16px]">{totalOut.toFixed(1)} kg</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── One output product type group ─────────────────────────────────────────────
function OutputGroup({ type, bags, isLeaf, locked, defaultBatch, onAdd, onRemove, onReprint }: {
  type: string
  bags: OutBag[]
  isLeaf: boolean
  locked: boolean
  defaultBatch: string
  onAdd: (d: { weight: string; batch: string; destination: string; qc_name: string }) => void
  onRemove: (id: string) => void
  onReprint: (b: OutBag) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ weight: '', batch: defaultBatch, destination: 'A', qc_name: '' })

  const total = bags.reduce((s, b) => s + (parseFloat(b.weight) || 0), 0)

  function confirm() {
    if (!draft.weight || !draft.batch) return
    onAdd(draft)
    setDraft({ weight: '', batch: defaultBatch, destination: 'A', qc_name: '' })
    setOpen(false)
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <span className="font-semibold text-[14px] text-text flex-1">{type}</span>
        {bags.length > 0 && (
          <span className="text-[11px] font-mono text-text-muted">{bags.length} bag{bags.length > 1 ? 's' : ''} · {total.toFixed(1)} kg</span>
        )}
      </div>

      {bags.length > 0 && (
        <div className="divide-y divide-stone-100">
          {bags.map(b => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] font-bold text-text">{b.serial}</div>
                <div className="text-[11px] text-text-muted">
                  {b.weight} kg · {b.batch}{b.acumaticaId ? ` · ${b.acumaticaId}` : ''}
                </div>
              </div>
              <button onClick={() => onReprint(b)} className="text-stone-400 hover:text-brand p-1.5" title="Reprint label">
                <Printer size={15} />
              </button>
              {!locked && (
                <button onClick={() => onRemove(b.id)} className="text-stone-300 hover:text-err p-1.5">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!locked && (
        open ? (
          <div className="p-4 space-y-3 bg-stone-50/60 border-t border-stone-100">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LBL}>Weight (kg) *</label>
                <input autoFocus type="number" inputMode="decimal" value={draft.weight} onChange={e => setDraft(d => ({ ...d, weight: e.target.value }))} className={INP} />
              </div>
              <div className="space-y-1">
                <label className={LBL}>Batch *</label>
                <input value={draft.batch} onChange={e => setDraft(d => ({ ...d, batch: e.target.value }))} className={INP} />
              </div>
              {isLeaf && (
                <div className="space-y-1">
                  <label className={LBL}>Destination</label>
                  <select value={draft.destination} onChange={e => setDraft(d => ({ ...d, destination: e.target.value }))} className={INP + ' cursor-pointer'}>
                    {DESTINATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className={LBL}>QC name (optional)</label>
                <input value={draft.qc_name} onChange={e => setDraft(d => ({ ...d, qc_name: e.target.value }))} className={INP} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500">Cancel</button>
              <button onClick={confirm} disabled={!draft.weight || !draft.batch} className="flex-1 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
                Add &amp; print label
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setDraft(d => ({ ...d, batch: defaultBatch })); setOpen(true) }} className="w-full flex items-center justify-center gap-2 py-2.5 text-stone-500 font-medium text-[13px] hover:text-brand transition-colors border-t border-stone-100">
            <Plus size={15} /> Add {type} bag
          </button>
        )
      )}
    </div>
  )
}

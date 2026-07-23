'use client'

/**
 * PasteuriserCapture — the Pasteuriser line's production-capture screen.
 * ─────────────────────────────────────────────────────────────────────────────
 * The Pasteuriser sterilises the blended batch and packs the FINAL PRODUCT, so
 * every field here has to trace back through the Blender to the Sieving Tower.
 * It mirrors the proven Blender/Refining pattern (scan / pick-from-system /
 * manual debagging, weight-only bagging, per-bag print-or-write tag) but has a
 * richer report because the paper (PR-FM-001 debagging + PR-FM-005 bagging)
 * carries more:
 *
 *   Debagging (consume)  → two streams: main (D) + post-sieve blending (E).
 *                          Consumes BLENDER OUTPUT bags — so, unlike every other
 *                          section, it must NOT block "finished/blend" products
 *                          (validateBagScan blockFinishedProducts:false).
 *   Bagging (produce)    → final-product pallet lines (A): item + lot + bag
 *                          range + weight/bag, prefilled from the Job Card,
 *                          operator confirms weights.
 *   By-products (B)      → Brown Dust / First Cut / Alt / Extraction Dust / Purge.
 *   Packaging + labels   → box/foil reconciliation + label received/discarded.
 *   Scale verification   → std vs actual (the +-50 kg the paper always shows).
 *   Mass balance         → (A + B + C) produced − (D + E) raw used.
 *
 * Traceability is SMART, not aggressive (per product decision): the system
 * suggests the expected blend inputs and FLAGS mismatches (wrong blend/variant,
 * or bagging a lot that was never debagged) with an amber warning, but never
 * hard-blocks capture — the physical floor is the source of truth. The checks
 * are centralised in `traceWarnings()` so they can be tightened to hard-blocks
 * later without hunting through the UI.
 */

import { useState, useEffect, useRef } from 'react'
import {
  Plus, Trash2, Package, PackageCheck, Lock, Pencil, Check, Search, X,
  AlertTriangle, Printer, PenLine, FileText, Boxes, Tag, Gauge,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { markBagConsumed } from '@/lib/production/scan-utils'
import { validateBagScan } from '@/lib/production/validate-scan'
import { loadAllInventory } from '@/lib/production/inventory'
import { ItemPicker } from '@/components/production/capture/ItemPicker'
import { BatchKeypadField } from '@/components/production/capture/BatchKeypadField'
import { isValidLot } from '@/components/production/capture/SievingCapture'
import { upperCode } from '@/lib/production/normalize-code'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment, InventoryItem } from '@/lib/supabase/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

type InputMode = 'scan' | 'system' | 'manual'

/** One debagged input bag (a Blender output being consumed at the pasteuriser). */
export interface PastDebagRow {
  id: string
  stream: 'main' | 'postsieve'   // main Debagging (D) vs post-sieve blending (E)
  serial: string                 // the Blender output serial, e.g. SFC-KUN25-C/1-11
  productType: string            // the blend / input product type
  variant: string
  lot: string
  weight: string                 // KG nett excl. bag
  time: string                   // debagging time (HH:mm)
  inputMode: InputMode
  secured: boolean
  logged_at?: string
  notInSystem?: boolean
}

/** One final-product pallet line on the bagging report (a bag-number range). */
export interface PastOutputLine {
  id: string
  serial: string                 // system pallet-level traceability serial
  time: string                   // pallet start time (HH:mm)
  kind: string                   // Final Product / High Moisture / Refill
  item: string                   // product name (e.g. Rooibos Super Fine Cut)
  itemCode: string | null        // Acumatica finished-product code (30FP…)
  lot: string
  bagCount: string               // No. of bags
  startBag: string               // starting bag number
  endBag: string                 // ending bag number
  bagWeight: string              // kg per bag (default 18)
  tagMethod: 'printed' | 'handwritten' | null
  secured: boolean
  logged_at?: string
}

export interface PastByProduct { id: string; type: string; serial: string; weight: string }
export interface PastPackaging { id: string; type: string; lot: string; qty: string; damaged: string }

export interface PasteuriserData {
  jobCardId: string | null
  blendCode: string              // the blend consumed (SFC-KUN25-C)
  batchNo: string                // final-product batch being produced (26244-CON-SFC)
  item: string                   // final product name
  itemCode: string | null        // 30FP… Acumatica code
  packaging: string              // Vacuum packed / Boxes 18kg / …
  weightPerBag: string           // default 18
  debag: PastDebagRow[]
  outputs: PastOutputLine[]
  byProducts: PastByProduct[]
  packagingRecon: PastPackaging[]
  labelsReceived: string
  labelsDiscarded: string
  labelsHandedOver: string
  scaleStd: string
  scaleActual: string
  floorWaste: string             // C — floor waste kg
}

export function emptyPasteuriserData(): PasteuriserData {
  return {
    jobCardId: null, blendCode: '', batchNo: '', item: '', itemCode: null,
    packaging: 'Vacuum packed', weightPerBag: '18',
    debag: [], outputs: [], byProducts: [], packagingRecon: [],
    labelsReceived: '', labelsDiscarded: '', labelsHandedOver: '',
    scaleStd: '', scaleActual: '', floorWaste: '',
  }
}

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

/**
 * Mass-balance decomposition, matching the paper's letters:
 *   D = main debagging, E = post-sieve blending  → raw material used (D+E)
 *   A = final product bagged, B = by-products, C = floor waste → produced (A+B+C)
 *   balance = produced − used
 */
export function pasteuriserTotals(d: PasteuriserData) {
  const perBag = n(d.weightPerBag) || 0
  const D = (d.debag ?? []).filter(r => r.stream === 'main').reduce((s, r) => s + n(r.weight), 0)
  const E = (d.debag ?? []).filter(r => r.stream === 'postsieve').reduce((s, r) => s + n(r.weight), 0)
  const A = (d.outputs ?? []).reduce((s, r) => s + n(r.bagCount) * (n(r.bagWeight) || perBag), 0)
  const B = (d.byProducts ?? []).reduce((s, r) => s + n(r.weight), 0)
  const C = n(d.floorWaste)
  const rawUsed = D + E
  const produced = A + B + C
  return { D, E, A, B, C, rawUsed, produced, balance: produced - rawUsed }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const DEBAG_COLOR = '#be185d'   // rose — matches SECTION_CONFIG.pasteuriser
const BAG_COLOR   = '#0d9488'   // teal

const OUTPUT_KINDS = ['Final Product', 'High Moisture', 'Refill'] as const
// By-products off the pasteuriser, from the PR-FM-005 by-product summary.
const BYPRODUCT_TYPES = ['Brown Dust', 'First Cut', 'Alt', 'Extraction Dust', 'Purge Material'] as const
// Packaging reconciliation types (boxes + the foils/quad-seal the paper lists).
const PACKAGING_TYPES = ['Boxes', 'Foils', 'Quad Seal', 'Bulk Bag', 'Paper Bag'] as const

const nowISO = () => new Date().toISOString()
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

// ── System bag pick list — Blender output bags in stock ───────────────────────

interface SystemBag {
  serial_number: string
  product_type: string
  variant: string | null
  weight_kg: number | null
  lot_number: string | null
  created_at: string | null
  acumatica_id: string | null
}

// Blender output bags carry product_type "Blend {code}" and acumatica_id = the
// blend code. Filter to in-stock blend bags, newest first. When a blend code is
// known we narrow by it; otherwise we surface all blend bags so the operator is
// never blocked by a mis-typed job card.
function useSystemBlendBags(blendCode: string): SystemBag[] {
  const [bags, setBags] = useState<SystemBag[]>([])
  useEffect(() => {
    let q = getDb().schema('production').from('bag_tags')
      .select('serial_number, product_type, variant, weight_kg, lot_number, created_at, acumatica_id')
      .eq('status', 'in_stock')
      .ilike('product_type', '%blend%')
      .order('created_at', { ascending: false })
      .limit(80)
    q.then(({ data }: { data: SystemBag[] | null }) => {
      let rows = data ?? []
      if (blendCode.trim()) {
        const bc = blendCode.trim().toLowerCase()
        const narrowed = rows.filter(b =>
          (b.acumatica_id ?? '').toLowerCase() === bc ||
          (b.product_type ?? '').toLowerCase().includes(bc))
        if (narrowed.length) rows = narrowed
      }
      setBags(rows)
    })
  }, [blendCode])
  return bags
}

function SystemPickList({ blendCode, onPick, onClose }: {
  blendCode: string
  onPick: (b: SystemBag) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const bags = useSystemBlendBags(blendCode)
  const filtered = query.trim()
    ? bags.filter(b => b.serial_number.toLowerCase().includes(query.toLowerCase()) || (b.product_type ?? '').toLowerCase().includes(query.toLowerCase()))
    : bags
  return (
    <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: DEBAG_COLOR + '40' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <span className="font-semibold text-[15px] text-text flex-1">Pick a blend bag from the system</span>
        <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
          <Search size={15} className="text-stone-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search serial or blend…"
            className="flex-1 py-2 text-[13px] outline-none bg-transparent" />
        </div>
        {filtered.length === 0 ? (
          <p className="text-[12px] text-stone-400 text-center py-4">
            {bags.length === 0 ? 'No in-stock blend bags found. Scan or enter manually.' : 'No matches.'}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-stone-100">
            {filtered.map(b => (
              <button key={b.serial_number} onClick={() => onPick(b)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 text-left">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13px] text-text font-medium">{b.serial_number}</div>
                  <div className="text-[11px] text-stone-500">
                    {[b.product_type, b.variant, b.weight_kg ? `${b.weight_kg} kg` : null, b.lot_number].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Check size={14} className="text-stone-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add/edit debagging-bag modal ──────────────────────────────────────────────

function AddBagModal({ stream, blendCode, variantWord, editingRow, existing, onClose, onSave, onDelete }: {
  stream: 'main' | 'postsieve'
  blendCode: string
  variantWord: string
  editingRow?: PastDebagRow | null
  existing: PastDebagRow[]
  onClose: () => void
  onSave: (row: PastDebagRow) => void
  onDelete?: () => void
}) {
  const [serial, setSerial] = useState(editingRow?.serial ?? '')
  const [productType, setProductType] = useState(editingRow?.productType ?? (blendCode ? `Blend ${blendCode}` : ''))
  const [weight, setWeight] = useState(editingRow?.weight ?? '')
  const [lot, setLot] = useState(editingRow?.lot ?? '')
  const [variant, setVariant] = useState(editingRow?.variant ?? variantWord)
  const [inputMode, setInputMode] = useState<InputMode>(editingRow?.inputMode ?? 'scan')
  const [notInSystem, setNotInSystem] = useState<boolean>(editingRow?.notInSystem ?? false)
  const [browsing, setBrowsing] = useState(false)
  const [looking, setLooking] = useState(false)
  const [scanMsg, setScanMsg] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)

  const availableLots = Array.from(new Set(existing.map(r => r.lot.trim()).filter(Boolean)))

  async function triggerLookup() {
    if (!serial.trim()) return
    setLooking(true)
    // Pasteuriser consumes BLENDER OUTPUT — so blockFinishedProducts must be off,
    // otherwise validateBagScan rejects every legitimate blend bag as "finished".
    const result = await validateBagScan(serial, { sessionVariant: variantWord, blockFinishedProducts: false })
    setLooking(false)
    if (result.status === 'ok' && result.tag) {
      setProductType(result.tag.product_type || productType)
      setWeight(result.tag.weight_kg != null ? String(result.tag.weight_kg) : weight)
      setVariant(result.tag.variant || variantWord || '')
      if (result.tag.lot_number && result.tag.lot_number !== 'NOT TRACKED') setLot(result.tag.lot_number)
      setNotInSystem(false); setInputMode('scan')
      // Smart flag (non-blocking): warn if this bag's blend doesn't look like the chosen one.
      const looksLikeBlend = blendCode && (result.tag.acumatica_id ?? result.tag.product_type ?? '').toLowerCase().includes(blendCode.toLowerCase())
      setScanMsg(blendCode && !looksLikeBlend
        ? { kind: 'warn', text: `⚠ This bag is "${result.tag.product_type}" — the job card blend is ${blendCode}. Add it if correct, but double-check the batch.` }
        : { kind: 'ok', text: result.message })
    } else if (result.status === 'not_found') {
      setNotInSystem(true); setInputMode('manual')
      setScanMsg({ kind: 'error', text: result.message })
    } else {
      // already_consumed / wrong_variant — surfaced, but capture is not blocked.
      setScanMsg({ kind: 'error', text: result.message })
    }
  }

  function pickSystemBag(b: SystemBag) {
    setSerial(b.serial_number)
    setProductType(b.product_type || productType)
    setWeight(b.weight_kg ? String(b.weight_kg) : '')
    setVariant(b.variant || variantWord || '')
    setLot(b.lot_number || ''); setInputMode('system'); setNotInSystem(false); setBrowsing(false)
    setScanMsg(null)
  }

  const complete = !!serial.trim() && n(weight) > 0

  function submit() {
    if (!complete) return
    onSave({
      id: editingRow?.id ?? crypto.randomUUID(), stream,
      serial: upperCode(serial.trim()), productType: productType.trim(),
      variant: variant || variantWord || '', lot: upperCode(lot),
      weight, time: editingRow?.time ?? fmtTime(nowISO()), inputMode,
      secured: true, logged_at: editingRow?.logged_at, notInSystem,
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9997, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 shrink-0" style={{ background: DEBAG_COLOR + '10' }}>
          <span className="font-bold text-[15px]" style={{ color: DEBAG_COLOR }}>
            {editingRow ? 'Edit bag' : 'Add debagging bag'} · {stream === 'main' ? 'Debagging' : 'Post-sieve blending'}
          </span>
          <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {browsing ? (
            <SystemPickList blendCode={blendCode} onPick={pickSystemBag} onClose={() => setBrowsing(false)} />
          ) : (
            <>
              <div className="space-y-1">
                <label className={LBL}>Bag serial no.</label>
                <div className="flex gap-2">
                  <input autoFocus type="text" value={serial} data-serial="true"
                    placeholder="Scan or type — press Enter to look up"
                    onChange={e => { setSerial(e.target.value.toUpperCase()); setScanMsg(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerLookup() } }}
                    className={INP + ' flex-1'} autoCapitalize="characters" spellCheck={false} />
                  <button onClick={triggerLookup} disabled={!serial.trim() || looking}
                    className="px-3 rounded-xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand text-[12px] font-medium disabled:opacity-40 shrink-0">
                    {looking ? '…' : 'Look up'}
                  </button>
                </div>
                {scanMsg && (
                  <p className={`text-[11px] flex items-start gap-1.5 ${scanMsg.kind === 'ok' ? 'text-ok' : scanMsg.kind === 'warn' ? 'text-amber-600' : 'text-err'}`}>
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {scanMsg.text}
                  </p>
                )}
                <button onClick={() => setBrowsing(true)} className="text-[11px] text-brand hover:underline">or pick from in-stock blend bags</button>
              </div>

              <div className="space-y-1">
                <label className={LBL}>Input product type</label>
                <input type="text" value={productType} onChange={e => setProductType(e.target.value)}
                  placeholder={blendCode ? `Blend ${blendCode}` : 'e.g. Blend SFC-KUN25-C'} className={INP} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className={LBL}>Weight (kg)</label>
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={weight}
                    onChange={e => setWeight(e.target.value)} className={INP} />
                </div>
                <div className="space-y-1">
                  <label className={LBL}>Lot number</label>
                  <BatchKeypadField value={lot} placeholder="e.g. 12SF4/RA-4876" options={availableLots} onChange={setLot} className={INP} />
                </div>
              </div>

              {notInSystem && (
                <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  Not in the system — this bag is being registered from the paper tag. Fill in the details above.
                </p>
              )}
            </>
          )}
        </div>

        {!browsing && (
          <div className="p-5 pt-0 space-y-2 shrink-0">
            {!complete && (
              <p className="text-[11px] text-stone-400 text-center">
                {[!serial.trim() && 'serial', n(weight) <= 0 && 'weight'].filter(Boolean).join(' and ')} still needed.
              </p>
            )}
            <div className="flex gap-2">
              {editingRow && onDelete && (
                <button onClick={onDelete} className="px-4 py-2.5 rounded-xl border border-stone-200 text-err text-[13px] font-medium hover:bg-err/5">Remove</button>
              )}
              <button onClick={submit} disabled={!complete}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] disabled:opacity-40 hover:bg-ok/20 transition-colors">
                <Check size={15} /> Done — lock this bag
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Debagging stream (one of the two tables) ──────────────────────────────────

function DebagStream({ stream, title, hint, rows, total, letter, locked, onAdd, onEdit }: {
  stream: 'main' | 'postsieve'
  title: string
  hint: string
  rows: PastDebagRow[]
  total: number
  letter: string
  locked: boolean
  onAdd: () => void
  onEdit: (r: PastDebagRow) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div>
          <span className="text-[13px] font-bold text-text">{title}</span>
          <p className="text-[11px] text-stone-400">{hint}</p>
        </div>
        <span className="text-[11px] font-mono text-stone-500">{total.toFixed(1)} kg · {rows.length} bag{rows.length !== 1 ? 's' : ''}</span>
      </div>
      {rows.length === 0
        ? <p className="text-[11px] text-stone-400 px-1 italic">No bags logged yet.</p>
        : rows.map((r, i) => {
          const incomplete = !r.serial.trim() || n(r.weight) <= 0
          return (
            <button key={r.id} onClick={() => !locked && onEdit(r)}
              className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 border text-left transition-opacity hover:opacity-90"
              style={{ background: DEBAG_COLOR + '0d', borderColor: DEBAG_COLOR + '40' }}>
              {incomplete ? <AlertTriangle size={15} className="shrink-0 text-amber-500" /> : <Lock size={15} className="shrink-0" style={{ color: DEBAG_COLOR }} />}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text">Bag {i + 1} · {r.productType || 'Input bag'} · {n(r.weight).toFixed(1)} kg</div>
                <div className="font-mono text-[11px] text-text-muted truncate">
                  {[r.serial, r.variant, r.lot].filter(Boolean).join(' · ')}
                  {r.inputMode === 'system' ? ' · from system' : r.inputMode === 'manual' && r.notInSystem ? ' · registered' : ''}
                  {r.time ? ` · ${r.time}` : ''}
                </div>
              </div>
              {!locked && <Pencil size={13} className="shrink-0 text-stone-400" />}
            </button>
          )
        })}
      {!locked && (
        <button onClick={onAdd}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 border-dashed text-[13px] font-semibold transition-colors"
          style={{ borderColor: DEBAG_COLOR + '50', color: DEBAG_COLOR }}>
          <Plus size={16} /> Add {stream === 'main' ? 'debagging' : 'post-sieve'} bag
        </button>
      )}
      <div className="flex items-center justify-between px-4 py-2.5 bg-stone-900 text-white rounded-2xl">
        <span className="text-[12px] font-medium opacity-80">Total ({letter})</span>
        <span className="font-mono font-bold text-[15px]">{total.toFixed(1)} kg</span>
      </div>
    </div>
  )
}

// ── Final-product output line ─────────────────────────────────────────────────

function OutputLineRow({ line, perBag, locked, onEdit, onRemove, onTag }: {
  line: PastOutputLine
  perBag: number
  locked: boolean
  onEdit: () => void
  onRemove: () => void
  onTag: (m: 'printed' | 'handwritten') => void
}) {
  const total = n(line.bagCount) * (n(line.bagWeight) || perBag)
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ background: BAG_COLOR + '0a', borderColor: BAG_COLOR + '33' }}>
      <div className="flex items-start gap-3">
        <button onClick={() => !locked && onEdit()} className="flex-1 min-w-0 text-left">
          <div className="text-[13px] font-semibold text-text">
            {line.kind}{line.item ? ` · ${line.item}` : ''}
            <span className="font-mono font-normal text-text-muted"> · {total.toFixed(0)} kg</span>
          </div>
          <div className="font-mono text-[11px] text-text-muted truncate mt-0.5">
            {[line.lot, `${line.bagCount || 0} bags`, (line.startBag || line.endBag) ? `#${line.startBag}–${line.endBag}` : null, `${line.bagWeight || perBag} kg/bag`, line.time].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 font-mono text-[12px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2 py-0.5">{line.serial}</span>
            {line.tagMethod && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                {line.tagMethod === 'printed' ? <Printer size={11} /> : <PenLine size={11} />} {line.tagMethod}
              </span>
            )}
          </div>
        </button>
        {!locked && <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1 shrink-0"><Trash2 size={14} /></button>}
      </div>
      {!line.tagMethod && !locked && (
        <div className="flex gap-1.5 mt-2">
          <button onClick={() => onTag('printed')} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand"><Printer size={12} /> Print label</button>
          <button onClick={() => onTag('handwritten')} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand"><PenLine size={12} /> Write on tag</button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PasteuriserCapture({
  sectionId, assignment, variantWord, locked, value, onChange, genSerial, operatorId,
}: {
  sectionId: string
  assignment: ShiftAssignment | null
  variantWord: string
  locked: boolean
  value: PasteuriserData
  onChange: (d: PasteuriserData) => void
  genSerial: () => string
  operatorId?: string | null
}) {
  const [tab, setTab] = useState<'debag' | 'bag'>('debag')
  const [bagModal, setBagModal] = useState<{ stream: 'main' | 'postsieve'; editing: PastDebagRow | null } | null>(null)
  const [editLine, setEditLine] = useState<PastOutputLine | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [jobCards, setJobCards] = useState<any[]>([])
  const [pickingItem, setPickingItem] = useState(false)
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  const patch = (p: Partial<PasteuriserData>) => onChange({ ...value, ...p })

  useEffect(() => { loadAllInventory().then(setItems) }, [])

  // Recent pasteuriser job cards — the prefill source for item / batch / blend /
  // packaging / weight per bag. Public schema (matches the Job Card page).
  useEffect(() => {
    getDb().from('job_cards_pasteuriser')
      .select('id, product_name, item_no, batch_number, blend_description, weight_per_bulk_bag, packaging, customer_po')
      .order('date_of_card', { ascending: false }).limit(40)
      .then(({ data }: any) => setJobCards(data ?? []))
      .catch(() => setJobCards([]))
  }, [])

  const t = pasteuriserTotals(value)
  const perBag = n(value.weightPerBag) || 18

  // ── Job card prefill / item override ────────────────────────────────────────
  function applyJobCard(jc: any) {
    if (!jc) { patch({ jobCardId: null }); return }
    patch({
      jobCardId: jc.id,
      blendCode: upperCode(jc.blend_description ?? value.blendCode) ?? value.blendCode,
      batchNo: upperCode(jc.batch_number ?? value.batchNo) ?? value.batchNo,
      item: jc.product_name ?? value.item,
      itemCode: jc.item_no ? upperCode(jc.item_no) : value.itemCode,
      packaging: jc.packaging ?? value.packaging,
      weightPerBag: jc.weight_per_bulk_bag ? String(jc.weight_per_bulk_bag).replace(/[^0-9.]/g, '') || value.weightPerBag : value.weightPerBag,
    })
  }

  function applyItem(it: InventoryItem) {
    patch({ item: it.description || it.inventory_id, itemCode: it.inventory_id })
    setPickingItem(false)
  }

  // ── Debagging helpers ───────────────────────────────────────────────────────
  function commitBag(row: PastDebagRow) {
    const isNew = !value.debag.some(r => r.id === row.id)
    const t2 = nowISO()
    const finalRow: PastDebagRow = { ...row, secured: true, logged_at: row.logged_at ?? t2 }
    patch({ debag: isNew ? [...value.debag, finalRow] : value.debag.map(r => r.id === row.id ? finalRow : r) })
    if (finalRow.serial) {
      if (finalRow.inputMode === 'manual') {
        getDb().schema('production').from('bag_tags').upsert({
          serial_number: finalRow.serial, section_id: sectionId, session_id: null,
          product_type: finalRow.productType || 'Blended Batch', variant: variantWord || null,
          weight_kg: n(finalRow.weight) || null, lot_number: finalRow.lot || null,
          status: 'consumed', consumed_at_section: sectionId, location_updated_at: t2,
        } as any, { onConflict: 'serial_number' }).catch(() => {})
      }
      markBagConsumed(finalRow.serial, sectionId, null, n(finalRow.weight) || undefined, operatorId ?? null)
    }
    setBagModal(null)
  }
  function removeBag(id: string) { patch({ debag: value.debag.filter(r => r.id !== id) }) }

  // ── Output helpers ──────────────────────────────────────────────────────────
  function addOutputLine() {
    const line: PastOutputLine = {
      id: crypto.randomUUID(), serial: genSerial(), time: fmtTime(nowISO()),
      kind: 'Final Product', item: value.item, itemCode: value.itemCode,
      lot: value.batchNo, bagCount: '', startBag: '', endBag: '', bagWeight: value.weightPerBag,
      tagMethod: null, secured: false,
    }
    setEditLine(line)
  }
  function saveLine(line: PastOutputLine) {
    const isNew = !value.outputs.some(l => l.id === line.id)
    const clean: PastOutputLine = { ...line, lot: upperCode(line.lot), secured: true, logged_at: line.logged_at ?? nowISO() }
    patch({ outputs: isNew ? [...value.outputs, clean] : value.outputs.map(l => l.id === line.id ? clean : l) })
    setEditLine(null)
  }
  function removeLine(id: string) { patch({ outputs: value.outputs.filter(l => l.id !== id) }) }

  function tagLine(id: string, method: 'printed' | 'handwritten') {
    patch({ outputs: value.outputs.map(l => l.id === id ? { ...l, tagMethod: method } : l) })
    const line = value.outputs.find(l => l.id === id)
    if (method === 'printed' && line) {
      printLabel({
        id: line.id, serial_number: line.serial,
        product_type: line.item || value.item || 'Rooibos Final Product',
        variant: variantShort, grade: 'A',
        weight_kg: n(line.bagCount) * (n(line.bagWeight) || perBag),
        lot_number: line.lot || value.batchNo || '',
        section_id: sectionId, section_name: SECTION_CONFIG[sectionId]?.name ?? sectionId,
        created_at: line.logged_at ?? nowISO(), printed: true,
      } as any)
    }
  }

  // ── By-product / packaging list helpers ─────────────────────────────────────
  const setByProducts = (rows: PastByProduct[]) => patch({ byProducts: rows })
  const setPackaging = (rows: PastPackaging[]) => patch({ packagingRecon: rows })

  // ── Smart (non-blocking) traceability flags ─────────────────────────────────
  const debaggedLots = new Set(value.debag.map(r => r.lot.trim().toUpperCase()).filter(Boolean))
  const traceWarnings: string[] = []
  if (value.outputs.length > 0 && value.debag.length === 0)
    traceWarnings.push('Final product is being bagged but nothing has been debagged yet — capture the blend bags consumed, or check the debagging tab.')
  for (const l of value.outputs) {
    const lot = l.lot.trim().toUpperCase()
    if (lot && debaggedLots.size > 0 && !debaggedLots.has(lot))
      traceWarnings.push(`Output batch "${l.lot}" wasn't debagged this session — check for a typing mistake in the lot/batch number.`)
  }
  const withinTol = Math.abs(t.balance) <= MASS_BALANCE_TOLERANCE_KG

  const mainRows = value.debag.filter(r => r.stream === 'main')
  const postRows = value.debag.filter(r => r.stream === 'postsieve')

  return (
    <div className="space-y-4">
      {/* Job card / product header — the prefill source, with a Master Inventory override */}
      <div className="bg-white border border-stone-200 rounded-2xl p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <FileText size={13} className="text-stone-400" />
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Final product for this batch</span>
        </div>
        {!locked && (
          <select value={value.jobCardId ?? ''} onChange={e => applyJobCard(jobCards.find(j => j.id === e.target.value))} className={INP}>
            <option value="">Prefill from a job card…</option>
            {jobCards.map(j => (
              <option key={j.id} value={j.id}>
                {[j.batch_number, j.product_name, j.blend_description].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label className={LBL}>Batch number</label>
            <BatchKeypadField value={value.batchNo} placeholder="26244-CON-SFC" onChange={v => patch({ batchNo: v })} className={INP} />
          </div>
          <div className="space-y-1">
            <label className={LBL}>Blend code</label>
            <BatchKeypadField value={value.blendCode} placeholder="SFC-KUN25-C" onChange={v => patch({ blendCode: v })} className={INP} />
          </div>
        </div>
        <div className="space-y-1">
          <label className={LBL}>Product item</label>
          {pickingItem ? (
            <ItemPicker items={items} placeholder="Search Master Inventory (30FP…)" onPick={applyItem} className={INP} />
          ) : (
            <button onClick={() => !locked && setPickingItem(true)} disabled={locked}
              className={INP + ' flex items-center justify-between text-left disabled:opacity-70'}>
              <span className="truncate">{value.item || 'Pick the final product item…'}{value.itemCode ? <span className="font-mono text-[11px] text-stone-400"> · {value.itemCode}</span> : null}</span>
              {!locked && <Search size={14} className="text-stone-400 shrink-0" />}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label className={LBL}>Weight per bag (kg)</label>
            <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.weightPerBag} disabled={locked}
              onChange={e => patch({ weightPerBag: e.target.value })} className={INP} />
          </div>
          <div className="space-y-1">
            <label className={LBL}>Packaging</label>
            <input type="text" value={value.packaging} disabled={locked} onChange={e => patch({ packaging: e.target.value })} className={INP} />
          </div>
        </div>
      </div>

      {/* Tab selector */}
      <div className="grid grid-cols-2 gap-2.5">
        {([
          { id: 'debag', label: 'Debagging', dir: 'in',  Icon: Package,      kg: t.rawUsed,  count: value.debag.length,   color: DEBAG_COLOR },
          { id: 'bag',   label: 'Bagging',   dir: 'out', Icon: PackageCheck, kg: t.produced, count: value.outputs.length, color: BAG_COLOR },
        ] as const).map(x => {
          const on = tab === x.id
          return (
            <button key={x.id} onClick={() => setTab(x.id)}
              style={on ? { background: x.color, borderColor: x.color } : { borderColor: x.color + '55' }}
              className={`flex flex-col gap-1.5 p-3.5 rounded-2xl border-2 text-left transition-all ${on ? 'shadow-sm text-white' : 'bg-white'}`}>
              <div className="flex items-center gap-1.5">
                <x.Icon size={18} className={on ? 'text-white' : ''} style={on ? undefined : { color: x.color }} />
                <span className="font-bold text-[15px]" style={on ? undefined : { color: x.color }}>{x.label}</span>
                <span className={`text-[11px] ${on ? 'text-white/70' : 'text-stone-400'}`}>({x.dir})</span>
              </div>
              <div className={`text-[12px] ${on ? 'text-white/90' : 'text-stone-500'}`}>
                <span className={`font-mono font-bold text-[15px] ${on ? 'text-white' : 'text-text'}`}>{x.count}</span>
                <span className={`mx-1.5 ${on ? 'text-white/40' : 'text-stone-300'}`}>·</span>
                <span className="font-mono">{x.kg.toFixed(1)} kg</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Smart traceability flags — visible on both tabs, never blocking */}
      {traceWarnings.length > 0 && !locked && (
        <div className="space-y-1.5">
          {Array.from(new Set(traceWarnings)).map((w, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-800">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── DEBAGGING TAB ──────────────────────────────────────────────────── */}
      {tab === 'debag' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">
            Consume every blend bag fed into the pasteuriser. Scan the barcode, pick it from the system, or register a bag written on a paper tag.
          </p>
          <DebagStream stream="main" title="Debagging" hint="Blend bags fed to the steriliser" letter="D"
            rows={mainRows} total={t.D} locked={locked}
            onAdd={() => setBagModal({ stream: 'main', editing: null })}
            onEdit={r => setBagModal({ stream: 'main', editing: r })} />
          <DebagStream stream="postsieve" title="Debagging — Post-sieve blending" hint="Material blended in after the post-sieve" letter="E"
            rows={postRows} total={t.E} locked={locked}
            onAdd={() => setBagModal({ stream: 'postsieve', editing: null })}
            onEdit={r => setBagModal({ stream: 'postsieve', editing: r })} />
          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Raw material used (D + E)</span>
            <span className="font-mono font-bold text-[16px]">{t.rawUsed.toFixed(1)} kg</span>
          </div>
        </>
      )}

      {/* ── BAGGING TAB ────────────────────────────────────────────────────── */}
      {tab === 'bag' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">Each line is a pallet / bag range — enter the bag count and confirm the weights; the serial is generated automatically.</p>

          <div className="space-y-2">
            {value.outputs.map(l => (
              <OutputLineRow key={l.id} line={l} perBag={perBag} locked={locked}
                onEdit={() => setEditLine(l)} onRemove={() => removeLine(l.id)} onTag={m => tagLine(l.id, m)} />
            ))}
            {!locked && (
              <button onClick={addOutputLine}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 border-dashed text-[13px] font-semibold transition-colors"
                style={{ borderColor: BAG_COLOR + '50', color: BAG_COLOR }}>
                <Plus size={16} /> Add bagging line
              </button>
            )}
            <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl text-white" style={{ background: BAG_COLOR }}>
              <span className="text-[12px] font-medium opacity-90">Final product bagged (A)</span>
              <span className="font-mono font-bold text-[15px]">{t.A.toFixed(1)} kg</span>
            </div>
          </div>

          {/* By-products (B) */}
          <ListEditor
            title="By-products (B)" icon={Boxes} locked={locked}
            rows={value.byProducts.map(r => ({ id: r.id, cells: [r.type, r.serial, r.weight] }))}
            columns={[
              { label: 'Type', kind: 'select', options: BYPRODUCT_TYPES as unknown as string[] },
              { label: 'Serial / date', kind: 'text' },
              { label: 'Weight kg', kind: 'num' },
            ]}
            onChange={rows => setByProducts(rows.map(r => ({ id: r.id, type: r.cells[0], serial: r.cells[1], weight: r.cells[2] })))}
            newRow={() => ({ id: crypto.randomUUID(), cells: [BYPRODUCT_TYPES[0], '', ''] })}
            footer={`${t.B.toFixed(1)} kg`}
          />

          {/* Packaging reconciliation */}
          <ListEditor
            title="Packaging" icon={Package} locked={locked}
            rows={value.packagingRecon.map(r => ({ id: r.id, cells: [r.type, r.lot, r.qty, r.damaged] }))}
            columns={[
              { label: 'Type', kind: 'select', options: PACKAGING_TYPES as unknown as string[] },
              { label: 'Lot no.', kind: 'code' },
              { label: 'Qty', kind: 'num' },
              { label: 'Damaged', kind: 'num' },
            ]}
            onChange={rows => setPackaging(rows.map(r => ({ id: r.id, type: r.cells[0], lot: r.cells[1], qty: r.cells[2], damaged: r.cells[3] })))}
            newRow={() => ({ id: crypto.randomUUID(), cells: [PACKAGING_TYPES[0], '', '', '0'] })}
          />

          {/* Product label summary */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center gap-2"><Tag size={13} className="text-stone-400" /><span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Product label summary</span></div>
            <div className="grid grid-cols-3 gap-2.5">
              {([['Received', 'labelsReceived'], ['Discarded', 'labelsDiscarded'], ['Handed over', 'labelsHandedOver']] as const).map(([lab, key]) => (
                <div key={key} className="space-y-1">
                  <label className={LBL}>{lab}</label>
                  <input type="text" inputMode="numeric" value={(value as any)[key]} disabled={locked}
                    onChange={e => patch({ [key]: e.target.value } as any)} className={INP} />
                </div>
              ))}
            </div>
          </div>

          {/* Scale verification + floor waste */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center gap-2"><Gauge size={13} className="text-stone-400" /><span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Scale verification &amp; waste</span></div>
            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <label className={LBL}>Std weight kg</label>
                <input type="text" inputMode="decimal" value={value.scaleStd} disabled={locked} onChange={e => patch({ scaleStd: e.target.value })} className={INP} />
              </div>
              <div className="space-y-1">
                <label className={LBL}>Actual weight kg</label>
                <input type="text" inputMode="decimal" value={value.scaleActual} disabled={locked} onChange={e => patch({ scaleActual: e.target.value })} className={INP} />
              </div>
              <div className="space-y-1">
                <label className={LBL}>Floor waste kg (C)</label>
                <input type="text" inputMode="decimal" value={value.floorWaste} disabled={locked} onChange={e => patch({ floorWaste: e.target.value })} className={INP} />
              </div>
            </div>
          </div>

          {/* Mass balance footer — (A + B + C) − (D + E) */}
          {t.rawUsed > 0 && (
            <div className={`px-4 py-3 rounded-2xl border ${withinTol ? 'bg-ok/5 border-ok/20' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Mass balance (produced − used)</span>
                {!withinTol && <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><AlertTriangle size={12} /> Outside ±{MASS_BALANCE_TOLERANCE_KG} kg</span>}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-stone-500 flex-wrap">
                <span className="font-mono font-bold text-text">{t.produced.toFixed(1)}</span><span>produced (A+B+C)</span>
                <span className="text-stone-400">−</span>
                <span className="font-mono font-bold text-text">{t.rawUsed.toFixed(1)}</span><span>used (D+E)</span>
                <span className="text-stone-400">=</span>
                <span className={`font-mono font-bold text-[15px] ${withinTol ? 'text-ok' : 'text-amber-700'}`}>{t.balance > 0 ? '+' : ''}{t.balance.toFixed(1)} kg</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Debagging modal */}
      {bagModal && (
        <AddBagModal
          stream={bagModal.stream} blendCode={value.blendCode} variantWord={variantWord}
          editingRow={bagModal.editing} existing={value.debag}
          onClose={() => setBagModal(null)} onSave={commitBag}
          onDelete={bagModal.editing ? () => { removeBag(bagModal.editing!.id); setBagModal(null) } : undefined}
        />
      )}

      {/* Output-line editor modal */}
      {editLine && (
        <OutputLineModal line={editLine} items={items} defaultItem={value.item} defaultCode={value.itemCode} perBag={value.weightPerBag}
          onClose={() => setEditLine(null)} onSave={saveLine} />
      )}
    </div>
  )
}

// ── Output-line editor ────────────────────────────────────────────────────────

function OutputLineModal({ line, items, defaultItem, defaultCode, perBag, onClose, onSave }: {
  line: PastOutputLine
  items: InventoryItem[]
  defaultItem: string
  defaultCode: string | null
  perBag: string
  onClose: () => void
  onSave: (l: PastOutputLine) => void
}) {
  const [draft, setDraft] = useState<PastOutputLine>({ ...line, item: line.item || defaultItem, itemCode: line.itemCode ?? defaultCode, bagWeight: line.bagWeight || perBag })
  const [picking, setPicking] = useState(false)
  const set = (p: Partial<PastOutputLine>) => setDraft(d => ({ ...d, ...p }))
  const total = n(draft.bagCount) * (n(draft.bagWeight) || n(perBag))
  const complete = n(draft.bagCount) > 0 && n(draft.bagWeight || perBag) > 0

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9997, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 shrink-0" style={{ background: BAG_COLOR + '10' }}>
          <span className="font-bold text-[15px]" style={{ color: BAG_COLOR }}>Bagging line</span>
          <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="space-y-1">
            <label className={LBL}>Product kind</label>
            <select value={draft.kind} onChange={e => set({ kind: e.target.value })} className={INP}>
              {OUTPUT_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className={LBL}>Item</label>
            {picking ? (
              <ItemPicker items={items} placeholder="Search Master Inventory…" onPick={it => { set({ item: it.description || it.inventory_id, itemCode: it.inventory_id }); setPicking(false) }} className={INP} />
            ) : (
              <button onClick={() => setPicking(true)} className={INP + ' flex items-center justify-between text-left'}>
                <span className="truncate">{draft.item || 'Pick item…'}{draft.itemCode ? <span className="font-mono text-[11px] text-stone-400"> · {draft.itemCode}</span> : null}</span>
                <Search size={14} className="text-stone-400 shrink-0" />
              </button>
            )}
          </div>
          <div className="space-y-1">
            <label className={LBL}>Lot / batch number</label>
            <BatchKeypadField value={draft.lot} placeholder="26244-CON-SFC" onChange={v => set({ lot: v })} className={INP} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className={LBL}>Pallet start time</label><input type="text" value={draft.time} onChange={e => set({ time: e.target.value })} placeholder="16:00" className={INP} /></div>
            <div className="space-y-1"><label className={LBL}>No. of bags</label><input type="text" inputMode="numeric" value={draft.bagCount} onChange={e => set({ bagCount: e.target.value })} className={INP} /></div>
            <div className="space-y-1"><label className={LBL}>Start bag no.</label><input type="text" inputMode="numeric" value={draft.startBag} onChange={e => set({ startBag: e.target.value })} className={INP} /></div>
            <div className="space-y-1"><label className={LBL}>End bag no.</label><input type="text" inputMode="numeric" value={draft.endBag} onChange={e => set({ endBag: e.target.value })} className={INP} /></div>
            <div className="space-y-1"><label className={LBL}>Weight per bag kg</label><input type="text" inputMode="decimal" value={draft.bagWeight} onChange={e => set({ bagWeight: e.target.value })} className={INP} /></div>
            <div className="space-y-1"><label className={LBL}>Line total kg</label><div className={INP + ' bg-stone-50 font-mono flex items-center'}>{total.toFixed(0)}</div></div>
          </div>
        </div>
        <div className="p-5 pt-0 shrink-0">
          <button onClick={() => onSave(draft)} disabled={!complete}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] disabled:opacity-40 hover:bg-ok/20 transition-colors">
            <Check size={15} /> Save line
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Small inline list editor (by-products / packaging) ────────────────────────

interface EditorRow { id: string; cells: string[] }
type ColKind = 'text' | 'num' | 'code' | 'select'

function ListEditor({ title, icon: Icon, rows, columns, locked, onChange, newRow, footer }: {
  title: string
  icon: typeof Boxes
  rows: EditorRow[]
  columns: { label: string; kind: ColKind; options?: string[] }[]
  locked: boolean
  onChange: (rows: EditorRow[]) => void
  newRow: () => EditorRow
  footer?: string
}) {
  const setCell = (id: string, ci: number, val: string) =>
    onChange(rows.map(r => r.id === id ? { ...r, cells: r.cells.map((c, i) => i === ci ? val : c) } : r))
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Icon size={13} className="text-stone-400" /><span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">{title}</span></div>
        {footer && <span className="font-mono text-[12px] text-text-muted">{footer}</span>}
      </div>
      {rows.map(r => (
        <div key={r.id} className="flex items-end gap-2">
          {columns.map((col, ci) => (
            <div key={ci} className="flex-1 min-w-0 space-y-1">
              <label className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide">{col.label}</label>
              {col.kind === 'select' ? (
                <select value={r.cells[ci]} disabled={locked} onChange={e => setCell(r.id, ci, e.target.value)} className={INP + ' !py-2'}>
                  {(col.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : col.kind === 'code' ? (
                <input type="text" value={r.cells[ci]} disabled={locked} onChange={e => setCell(r.id, ci, e.target.value.toUpperCase())} className={INP + ' !py-2 uppercase'} autoCapitalize="characters" spellCheck={false} />
              ) : (
                <input type="text" inputMode={col.kind === 'num' ? 'decimal' : 'text'} value={r.cells[ci]} disabled={locked} onChange={e => setCell(r.id, ci, e.target.value)} className={INP + ' !py-2'} />
              )}
            </div>
          ))}
          {!locked && <button onClick={() => onChange(rows.filter(x => x.id !== r.id))} className="text-stone-300 hover:text-red-500 p-2 shrink-0"><Trash2 size={14} /></button>}
        </div>
      ))}
      {!locked && (
        <button onClick={() => onChange([...rows, newRow()])} className="flex items-center gap-1.5 text-[12px] text-brand hover:underline"><Plus size={13} /> Add row</button>
      )}
    </div>
  )
}

'use client'

/**
 * GranuleCapture — Rooibos Granules line (PR-FM-026/7 + Bagging PR-FM-005.1).
 *
 * The granule line is a blend: dusts are fed into the pellet mill and come out as
 * granules (SG / SF / Export) plus a little dust. The product item is chosen ONCE
 * per session and drives the dust by-product type (SG Granules → SG Dust, SF → SF
 * Dust). Like Refining, there is no grade — traceability comes from the system
 * serials back to the Sieving Tower.
 *
 * Two capture tabs:
 *   1. Pellet Mill Feed — dust inputs grouped into colour-coded blends (1–5). Each
 *      dust input uses scan / pick-from-system / manual, exactly like Refining.
 *      A blend must be confirmed complete before the next is added, so the operator
 *      never loses their place. Blend total (dust only; water excluded per the
 *      paper) auto-calculates, and the column totals form Total Mixed (A).
 *   2. Bagging — one row per granule bag (auto time, fixed item + lot, per-lot
 *      serial, bag weight vs total weight), the end-of-shift dust by-product
 *      (SG/SF Dust — warned about, like Sieving's bucket elevator), waste, and the
 *      end-of-shift mass-balance readings (D / E / meter).
 *
 * The mass balance RESULT is not shown here — it is computed by the system and
 * shown once, in the Overview (A in vs G out).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Plus, Trash2, Package, PackageCheck, Lock, Pencil, Check, Search, X,
  AlertTriangle, Droplets, Layers, CheckCircle2,
} from 'lucide-react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort, LABEL_PRINTING_ENABLED } from '@/lib/production/capture-config'
import { markBagConsumed, sanitizeSerial } from '@/lib/production/scan-utils'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import { getAcumaticaCode } from '@/lib/production/acumatica-codes'
import { fetchGranuleQuality, type QualityPoint } from '@/lib/production/granule-quality'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

// ── Dust columns — PR-FM-026/7 pellet-mill-feed columns, each with its own colour ─

interface DustMeta { label: string; productType: string; color: string }
const DUST_META: Record<string, DustMeta> = {
  brown:      { label: 'Brown / CP Dust',        productType: 'Brown Dust',      color: '#92400e' },
  white:      { label: 'White Dust',             productType: 'White Dust',      color: '#0891b2' },
  indent:     { label: 'Indent Dust',            productType: 'Indent Dust',     color: '#b45309' },
  leaf:       { label: 'Leaf Dust',              productType: 'Leaf Dust',       color: '#15803d' },
  alt:        { label: 'ALT Dust',               productType: 'ALT Dust',        color: '#7c3aed' },
  sg:         { label: 'SG Dust',                productType: 'SG Dust',         color: '#0d9488' },
  extraction: { label: 'Dust Extraction (Powder)', productType: 'Dust Extraction', color: '#475569' },
  other:      { label: 'Other',                  productType: 'Other',           color: '#a16207' },
}
export const DUST_COLUMNS = Object.entries(DUST_META).map(([key, m]) => ({ key, ...m }))
const DUST_LABEL   = (key: string) => DUST_META[key]?.label ?? key
const DUST_COLOR   = (key: string) => DUST_META[key]?.color ?? '#78716c'
/** Public: dust column key → Acumatica-style product type (used by the capture page). */
export function dustProductType(key: string): string { return DUST_META[key]?.productType ?? key }

// Blend colours — one per blend so the operator never loses their place.
const BLEND_COLORS = ['#d97706', '#0d9488', '#7c3aed', '#2563eb', '#db2777']
const blendColor = (i: number) => BLEND_COLORS[i % BLEND_COLORS.length]

// Granule output items — chosen once per session.
const GRANULE_OUTPUT_ITEMS = ['SG Granules', 'SF Granules', 'Export Granules']
// The by-product dust that leaves the line follows the item.
function dustForItem(item: string): string { return item.startsWith('SF') ? 'SF Dust' : 'SG Dust' }
const DEFAULT_TARGET_KG = '500'

// ── Types ───────────────────────────────────────────────────────────────────

export interface GranuleInputRow {
  id: string
  dustKey: string
  serial: string
  variant: string
  weight: string
  lot: string
  inputMode: 'scan' | 'system' | 'manual'
  secured: boolean
  logged_at?: string
  notInSystem?: boolean | string
}

export interface GranuleBlend {
  id: string
  blendNo: string
  rows: GranuleInputRow[]
  water: string
  done: boolean
}

export interface GranuleOutBag {
  id: string
  serial: string
  item: string
  lot: string
  time: string
  targetWeight: string   // nominal bag weight (e.g. 500)
  weight: string         // actual total weight
  code: string | null
  printed: boolean
  secured: boolean
  logged_at?: string
}

export interface GranuleDustOut {
  id: string
  dustType: string
  bags: string
  weight: string
  serial: string
  code: string | null
  printed: boolean
  secured: boolean
  logged_at?: string
}

export interface GranuleWasteRow { id: string; wasteType: string; weight: string }

export interface GranuleData {
  item: string                 // SG / SF / Export Granules — chosen once per session
  blends: GranuleBlend[]
  outputs: GranuleOutBag[]
  dustOutputs: GranuleDustOut[]
  waste: GranuleWasteRow[]
  dustNotRefed: string   // D — dust from sieve/drier not yet re-fed
  coarseNotFed: string   // E — coarse granules not yet fed to maize master
  meterStart: string     // Y
  meterStop: string      // Z
}

export function emptyGranuleData(): GranuleData {
  return {
    // No default — silently defaulting to "SG Granules" let a whole SF/Export
    // shift get captured under the wrong item if the operator never touched
    // the dropdown. Must be a deliberate choice, same as variant.
    item: '',
    blends: [{ id: crypto.randomUUID(), blendNo: '1', rows: [], water: '', done: false }],
    outputs: [], dustOutputs: [], waste: [],
    dustNotRefed: '', coarseNotFed: '', meterStart: '', meterStop: '',
  }
}

// ── Totals ────────────────────────────────────────────────────────────────────

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

export function granuleColumnTotals(d: GranuleData) {
  const cols: Record<string, number> = {}
  DUST_COLUMNS.forEach(c => { cols[c.key] = 0 })
  ;(d.blends ?? []).forEach(b => {
    (b.rows ?? []).forEach(r => { cols[r.dustKey] = (cols[r.dustKey] ?? 0) + n(r.weight) })
  })
  const totalA = Object.values(cols).reduce((s, v) => s + v, 0)   // dust only (water excluded)
  const water  = (d.blends ?? []).reduce((s, b) => s + n(b.water), 0)
  return { cols, totalA, water }
}

/** Blend total = sum of that blend's dust weights (water excluded, per the paper). */
export function blendTotal(b: GranuleBlend): number {
  return (b.rows ?? []).reduce((s, r) => s + n(r.weight), 0)
}

export function granuleTotals(d: GranuleData) {
  const { cols, totalA, water } = granuleColumnTotals(d)
  const cStar   = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0)       // bagging summary (C*)
  const dustOut = (d.dustOutputs ?? []).reduce((s, r) => s + n(r.weight), 0)   // SG/SF dust by-product
  const wasteF  = (d.waste ?? []).reduce((s, r) => s + n(r.weight), 0)         // F
  const D = n(d.dustNotRefed)
  const E = n(d.coarseNotFed)
  const G = cStar + D + E + wasteF          // total produced
  const H = totalA                          // total raw material used
  const balance = H - G
  const yieldPct = H > 0 ? (G / H) * 100 : 0
  const runningHours = n(d.meterStop) - n(d.meterStart)
  return { cols, totalA, water, cStar, dustOut, wasteF, D, E, G, H, balance, yieldPct, runningHours }
}

// ── Per-lot serial: DD-MM-YY-NNN, sequence continues across days for one lot ─────

async function nextGranuleSerial(lot: string, localSerials: string[]): Promise<string> {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yy = String(now.getFullYear()).slice(-2)
  const seqOf = (s: string) => { const m = String(s).match(/-(\d{1,4})$/); return m ? parseInt(m[1]) : 0 }
  let maxSeq = localSerials.reduce((mx, s) => Math.max(mx, seqOf(s)), 0)
  if (lot) {
    try {
      const { data } = await getDb().schema('production').from('bag_tags')
        .select('serial_number').eq('lot_number', lot).limit(4000)
      ;(data ?? []).forEach((r: any) => { maxSeq = Math.max(maxSeq, seqOf(r.serial_number)) })
    } catch { /* offline — fall back to local max */ }
  }
  return `${dd}-${mm}-${yy}-${String(maxSeq + 1).padStart(3, '0')}`
}

// ── Style constants ─────────────────────────────────────────────────────────────

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const BAG_COLOR = '#7c3aed'

const nowISO = () => new Date().toISOString()
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''
const clockNow = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date())

const INPUT_MODES: { id: GranuleInputRow['inputMode']; label: string; hint: string }[] = [
  { id: 'scan',   label: 'Scan / type serial', hint: 'Scan the barcode or type the serial written on the bag tag.' },
  { id: 'system', label: 'Pick from system',   hint: 'Choose a dust bag already in stock in the system.' },
  { id: 'manual', label: 'Manual entry',        hint: 'Bag not in system — fill all fields by hand.' },
]

// ── System pick list ────────────────────────────────────────────────────────────

interface SystemBag {
  serial_number: string; product_type: string; variant: string | null
  weight_kg: number | null; lot_number: string | null; created_at: string | null
}

async function lookupSerial(serial: string) {
  if (!serial.trim()) return null
  try {
    const { data } = await getDb().schema('production').from('bag_tags')
      .select('lot_number, weight_kg, product_type, variant').eq('serial_number', serial.trim()).maybeSingle()
    if (!data) return null
    return {
      lot_number: data.lot_number || '', weight_kg: data.weight_kg ? String(data.weight_kg) : '',
      product_type: data.product_type || '', variant: data.variant || '',
    }
  } catch { return null }
}

function dustKeyForProduct(productType: string): string {
  const hit = DUST_COLUMNS.find(c => c.productType.toLowerCase() === productType.toLowerCase())
  return hit?.key ?? 'other'
}

function SystemPickList({ onPick, onClose }: { onPick: (b: SystemBag) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [bags, setBags] = useState<SystemBag[]>([])
  useEffect(() => {
    getDb().schema('production').from('bag_tags')
      .select('serial_number, product_type, variant, weight_kg, lot_number, created_at')
      .in('product_type', DUST_COLUMNS.map(c => c.productType)).eq('status', 'in_stock')
      .order('created_at', { ascending: false }).limit(80)
      .then(({ data }: { data: SystemBag[] | null }) => setBags(data ?? []))
  }, [])
  const filtered = query.trim()
    ? bags.filter(b => b.serial_number.toLowerCase().includes(query.toLowerCase()) || (b.product_type ?? '').toLowerCase().includes(query.toLowerCase()))
    : bags
  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <span className="font-semibold text-[15px] text-text flex-1">Pick dust bag from system</span>
        <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
          <Search size={15} className="text-stone-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search serial or dust type…" className="flex-1 py-2 text-[13px] outline-none bg-transparent" />
        </div>
        {filtered.length === 0 ? (
          <p className="text-[12px] text-stone-400 text-center py-4">{bags.length === 0 ? 'No in-stock dust bags found.' : 'No matches.'}</p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-stone-100">
            {filtered.map(b => (
              <button key={b.serial_number} onClick={() => onPick(b)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 text-left">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13px] text-text font-medium">{b.serial_number}</div>
                  <div className="text-[11px] text-stone-500">{[b.product_type, b.variant, b.weight_kg ? `${b.weight_kg} kg` : null].filter(Boolean).join(' · ')}</div>
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

// ── Dust input row ──────────────────────────────────────────────────────────────

function DustInputRow({
  row, blendCol, locked, onUpdate, onSecure, onRemove,
}: {
  row: GranuleInputRow
  blendCol: string
  locked: boolean
  onUpdate: (k: keyof GranuleInputRow, v: string) => void
  onSecure: () => void
  onRemove: () => void
}) {
  const [looking, setLooking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const triggerLookup = useCallback(async () => {
    if (!row.serial.trim()) return
    setLooking(true)
    const result = await lookupSerial(row.serial)
    setLooking(false)
    if (result) {
      if (result.product_type) onUpdate('dustKey', dustKeyForProduct(result.product_type))
      if (result.weight_kg)    onUpdate('weight', result.weight_kg)
      if (result.lot_number)   onUpdate('lot', result.lot_number)
      if (result.variant)      onUpdate('variant', result.variant)
    } else {
      onUpdate('notInSystem', 'true')
    }
  }, [row.serial, onUpdate])

  const complete = !!row.serial.trim() && !!row.dustKey && n(row.weight) > 0

  return (
    <div className="bg-white border rounded-2xl p-4 space-y-3" style={{ borderColor: blendCol + '40' }}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-[13px]" style={{ color: blendCol }}>
          Dust input {row.inputMode === 'scan' ? '· scan or type serial' : row.inputMode === 'manual' ? '· manual entry' : '· system pick'}
        </span>
        {!locked && <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>}
      </div>

      <div className="space-y-1">
        <label className={LBL}>Bag serial no.</label>
        <div className="flex gap-2">
          <input ref={inputRef} data-serial="true" type="text" value={row.serial} disabled={locked}
            placeholder={row.inputMode === 'scan' ? 'Scan or type — press Enter to look up' : 'Type serial no.'}
            onChange={e => onUpdate('serial', sanitizeSerial(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerLookup() } }}
            className={INP + ' flex-1'} autoCapitalize="characters" spellCheck={false} />
          {!locked && (
            <button onClick={triggerLookup} disabled={!row.serial.trim() || looking}
              className="px-3 rounded-xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand text-[12px] font-medium disabled:opacity-40 shrink-0">
              {looking ? '…' : 'Look up'}
            </button>
          )}
        </div>
        {(row.notInSystem === true || row.notInSystem === 'true') && row.inputMode !== 'manual' && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1.5"><AlertTriangle size={12} /> Not found in system — fill in the details below.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LBL}>Dust type</label>
          <select value={row.dustKey} disabled={locked} onChange={e => onUpdate('dustKey', e.target.value)}
            className={INP + ' cursor-pointer'}
            style={row.dustKey ? { borderColor: DUST_COLOR(row.dustKey), color: DUST_COLOR(row.dustKey), fontWeight: 600 } : undefined}>
            <option value="">Select…</option>
            {DUST_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={LBL}>Weight (kg)</label>
          <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={row.weight} disabled={locked}
            onChange={e => onUpdate('weight', e.target.value)} className={INP} />
        </div>
        <div className="space-y-1 col-span-2">
          <label className={LBL}>Variant</label>
          <input type="text" value={row.variant} disabled={locked} placeholder="CON / ORG / RA CON / RA ORG"
            onChange={e => onUpdate('variant', e.target.value)} className={INP} />
        </div>
      </div>

      {!locked && (
        <>
          <button onClick={onSecure} disabled={!complete}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] disabled:opacity-40 hover:bg-ok/20 transition-colors">
            <Check size={15} /> Done — lock this bag
          </button>
          {!complete && (
            <p className="text-[11px] text-stone-400 text-center">
              {[!row.serial.trim() && 'serial', !row.dustKey && 'dust type', n(row.weight) <= 0 && 'weight'].filter(Boolean).join(', ')} still needed.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Blend card ──────────────────────────────────────────────────────────────────

function BlendCard({
  blend, index, locked, variantWord, operatorId, assignment, onChange, onRemove, onToggleDone, canRemove,
}: {
  blend: GranuleBlend
  index: number
  locked: boolean
  variantWord: string
  operatorId?: string | null
  assignment: ShiftAssignment | null
  onChange: (b: GranuleBlend) => void
  onRemove: () => void
  onToggleDone: (done: boolean) => void
  canRemove: boolean
}) {
  const [addMode, setAddMode] = useState<GranuleInputRow['inputMode']>('scan')
  const [showSystemPick, setShowSystemPick] = useState(false)
  const col = blendColor(index)

  const rowComplete = (r: GranuleInputRow) => !!r.serial.trim() && !!r.dustKey && n(r.weight) > 0
  const lockCompleted = (rows: GranuleInputRow[]): GranuleInputRow[] => {
    const t = nowISO()
    return rows.map(r => (!r.secured && rowComplete(r)) ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
  }
  function addRow(mode: GranuleInputRow['inputMode']) {
    onChange({ ...blend, rows: [...lockCompleted(blend.rows), {
      id: crypto.randomUUID(), dustKey: '', serial: '', variant: variantWord || '',
      weight: '', lot: assignment?.lot_number ?? '', inputMode: mode, secured: false,
    }] })
  }
  function updateRow(id: string, k: keyof GranuleInputRow, v: string) {
    onChange({ ...blend, rows: blend.rows.map(r => r.id === id ? { ...r, [k]: v, ...(k === 'serial' ? { notInSystem: '' } : {}) } : r) })
  }
  function secureRow(id: string) {
    const t = nowISO()
    const updated = blend.rows.map(r => r.id === id ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
    onChange({ ...blend, rows: updated })
    const row = updated.find(r => r.id === id)
    if (row?.serial) {
      if (row.inputMode === 'manual') {
        getDb().schema('production').from('bag_tags').upsert({
          serial_number: row.serial, section_id: 'granule', session_id: null,
          product_type: dustProductType(row.dustKey), variant: variantWord || null,
          weight_kg: n(row.weight) || null, lot_number: row.lot || null,
          status: 'consumed', consumed_at_section: 'granule', location_updated_at: t,
        } as any, { onConflict: 'serial_number' }).catch(() => {})
      }
      markBagConsumed(row.serial, 'granule', null, n(row.weight) || undefined, operatorId ?? null)
    }
  }
  function removeRow(id: string) { onChange({ ...blend, rows: blend.rows.filter(r => r.id !== id) }) }
  function unlockRow(id: string) { onChange({ ...blend, rows: blend.rows.map(r => r.id === id ? { ...r, secured: false } : r) }) }
  function handleSystemPick(bag: SystemBag) {
    const t = nowISO()
    onChange({ ...blend, rows: [...lockCompleted(blend.rows), {
      id: crypto.randomUUID(), dustKey: dustKeyForProduct(bag.product_type), serial: bag.serial_number,
      variant: bag.variant || variantWord || '', weight: bag.weight_kg ? String(bag.weight_kg) : '',
      lot: bag.lot_number || '', inputMode: 'system', secured: true, logged_at: t,
    }] })
    markBagConsumed(bag.serial_number, 'granule', null, bag.weight_kg ?? undefined, operatorId ?? null)
    setShowSystemPick(false)
  }

  const total = blendTotal(blend)
  const hasRows = blend.rows.length > 0

  // Completed blend → compact coloured summary with dust chips.
  if (blend.done) {
    return (
      <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: col + '55' }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: col + '0f' }}>
          <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: col }}>{blend.blendNo}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {blend.rows.map(r => (
                <span key={r.id} className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white" style={{ background: DUST_COLOR(r.dustKey) }}>
                  {DUST_LABEL(r.dustKey)} {n(r.weight).toFixed(0)}
                </span>
              ))}
              {n(blend.water) > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">Water {n(blend.water).toFixed(0)}L</span>}
            </div>
          </div>
          <span className="font-mono font-bold text-[14px] text-text shrink-0">{total.toFixed(0)} kg</span>
          {!locked && <button onClick={() => onToggleDone(false)} className="flex items-center gap-1 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg shrink-0"><Pencil size={13} /> Edit</button>}
        </div>
      </div>
    )
  }

  // Open (editing) blend.
  return (
    <div className="bg-white border-2 rounded-2xl overflow-hidden" style={{ borderColor: col }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: col + '30', background: col + '10' }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: col }}>{blend.blendNo}</span>
          <Layers size={15} style={{ color: col }} />
          <span className="font-bold text-[14px] text-text">Blend {blend.blendNo}</span>
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && <span className="font-mono font-bold text-[14px] text-text">{total.toFixed(1)} kg</span>}
          {!locked && canRemove && <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {blend.rows.map(r => r.secured ? (
          <div key={r.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border" style={{ background: DUST_COLOR(r.dustKey) + '0d', borderColor: DUST_COLOR(r.dustKey) + '40' }}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DUST_COLOR(r.dustKey) }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text">{DUST_LABEL(r.dustKey)} · {n(r.weight).toFixed(1)} kg</div>
              <div className="font-mono text-[11px] text-text-muted truncate">
                {[r.serial, r.variant].filter(Boolean).join(' · ')}{r.logged_at ? ` · ${fmtTime(r.logged_at)}` : ''}
                {r.inputMode === 'system' ? ' · from system' : r.inputMode === 'manual' && r.notInSystem ? ' · registered' : ''}
              </div>
            </div>
            {!locked && <button onClick={() => unlockRow(r.id)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg"><Pencil size={13} /> Edit</button>}
          </div>
        ) : (
          <DustInputRow key={r.id} row={r} blendCol={col} locked={locked}
            onUpdate={(k, v) => updateRow(r.id, k, v)} onSecure={() => secureRow(r.id)} onRemove={() => removeRow(r.id)} />
        ))}

        {showSystemPick && <SystemPickList onPick={handleSystemPick} onClose={() => setShowSystemPick(false)} />}

        {!locked && !showSystemPick && (
          <div className="space-y-2">
            <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white">
              {INPUT_MODES.map(m => (
                <button key={m.id} onClick={() => setAddMode(m.id)}
                  className={`flex-1 py-2 text-[12px] font-medium transition-colors ${addMode === m.id ? 'bg-brand text-white' : 'text-stone-500 hover:bg-stone-50'}`}>{m.label}</button>
              ))}
            </div>
            <p className="text-[11px] text-stone-400 px-1">{INPUT_MODES.find(m => m.id === addMode)?.hint}</p>
            {addMode === 'system'
              ? <button onClick={() => setShowSystemPick(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-medium" style={{ borderColor: col + '50', color: col }}><Search size={15} /> Browse in-stock dust bags</button>
              : <button onClick={() => addRow(addMode)} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-medium" style={{ borderColor: col + '50', color: col }}><Plus size={15} /> {addMode === 'scan' ? 'Add dust to scan' : 'Add dust manually'}</button>}
          </div>
        )}

        {/* Water */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-sky-200 bg-sky-50/50">
          <Droplets size={15} className="text-sky-500 shrink-0" />
          <label className="text-[12px] font-medium text-sky-800 flex-1">Water added (L)</label>
          <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={blend.water} disabled={locked}
            onChange={e => onChange({ ...blend, water: e.target.value })}
            className="w-24 px-3 py-2 rounded-lg border border-sky-200 bg-white text-[14px] text-right outline-none focus:border-sky-400" />
        </div>

        {/* Blend total + confirm complete */}
        <div className="flex items-center justify-between px-3 py-2.5 rounded-xl" style={{ background: col + '10' }}>
          <span className="text-[12px] font-semibold" style={{ color: col }}>Blend {blend.blendNo} total (dust)</span>
          <span className="font-mono font-bold text-[15px] text-text">{total.toFixed(1)} kg</span>
        </div>
        {!locked && (
          <button onClick={() => onToggleDone(true)} disabled={!hasRows}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white font-medium text-[13px] disabled:opacity-40 transition-colors" style={{ background: col }}>
            <CheckCircle2 size={15} /> Blend {blend.blendNo} complete
          </button>
        )}
        {!hasRows && !locked && <p className="text-[11px] text-stone-400 text-center">Add at least one dust input before completing the blend.</p>}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────────

export function GranuleCapture({
  sectionId, assignment, variantWord, locked, value, onChange, genSerial, operatorId,
}: {
  sectionId: string
  assignment: ShiftAssignment | null
  variantWord: string
  locked: boolean
  value: GranuleData
  onChange: (d: GranuleData) => void
  genSerial: () => string
  operatorId?: string | null
}) {
  const [tab, setTab] = useState<'feed' | 'bag'>('feed')
  const variantShort = variantToShort(variantWord as any) as ShortVariant
  const patch = (p: Partial<GranuleData>) => onChange({ ...value, ...p })

  const item = value.item || GRANULE_OUTPUT_ITEMS[0]
  const lot = assignment?.lot_number ?? ''
  const dustType = dustForItem(item)
  const itemLocked = locked || value.outputs.length > 0 || value.blends.some(b => b.rows.length > 0)

  // ── Blends ──────────────────────────────────────────────────────────────────
  function updateBlend(id: string, b: GranuleBlend) { patch({ blends: value.blends.map(x => x.id === id ? b : x) }) }
  function toggleBlendDone(id: string, done: boolean) { patch({ blends: value.blends.map(x => x.id === id ? { ...x, done } : x) }) }
  function addBlend() {
    const nextNo = String(value.blends.reduce((m, b) => Math.max(m, parseInt(b.blendNo) || 0), 0) + 1)
    patch({ blends: [...value.blends, { id: crypto.randomUUID(), blendNo: nextNo, rows: [], water: '', done: false }] })
  }
  function removeBlend(id: string) { patch({ blends: value.blends.filter(b => b.id !== id) }) }
  const lastBlend = value.blends[value.blends.length - 1]
  const canAddBlend = !locked && value.blends.length < 5 && !!lastBlend?.done

  // ── Granule output bags ───────────────────────────────────────────────────────
  const [outTarget, setOutTarget] = useState(DEFAULT_TARGET_KG)
  const [outWeight, setOutWeight] = useState('')
  const [adding, setAdding] = useState(false)
  // Supervisor sets the lot at assignment, but the operator is the one who can
  // actually see the physical batch on the floor — a typo or a wrong batch
  // tagged upstream only gets caught here. Ask once per session, before the
  // first bag; if bags already exist (reopening an in-progress session), it's
  // already been confirmed.
  const [lotConfirmed, setLotConfirmed] = useState(value.outputs.length > 0)

  async function addOutputBag() {
    if (n(outWeight) <= 0 || adding) return
    setAdding(true)
    const serial = await nextGranuleSerial(lot, value.outputs.map(o => o.serial))
    const now = nowISO()
    const acCode = getAcumaticaCode(item, variantShort, 'A')
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: 'granule', session_id: null, product_type: item,
        variant: variantWord || null, weight_kg: n(outWeight), lot_number: lot || null,
        acumatica_id: acCode?.inventoryId || null, status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: 'granule', weight_kg: n(outWeight), operator_id: operatorId ?? null,
      } as any)
    } catch { /* session save retries */ }
    const bag: GranuleOutBag = {
      id: crypto.randomUUID(), serial, item, lot, time: clockNow(), targetWeight: outTarget,
      weight: outWeight, code: acCode?.inventoryId ?? null, printed: LABEL_PRINTING_ENABLED, secured: true, logged_at: now,
    }
    onChange({ ...value, outputs: [...value.outputs, bag] })
    setOutWeight(''); setAdding(false)
    if (LABEL_PRINTING_ENABLED) {
      printLabel({
        id: bag.id, serial_number: serial, product_type: item, variant: variantShort, grade: 'A',
        weight_kg: n(outWeight), lot_number: lot, section_id: 'granule',
        section_name: SECTION_CONFIG['granule']?.name ?? 'Granule Line', created_at: now, printed: true,
        acumaticaId: acCode?.inventoryId ?? undefined, acumaticaDesc: acCode?.description,
      } as OutputBag)
    }
  }
  function removeOutput(id: string) { patch({ outputs: value.outputs.filter(b => b.id !== id) }) }

  // ── Dust by-product (end of shift) ─────────────────────────────────────────────
  // Weight is no longer typed in by the operator — it's the plant's own mass
  // balance residual (raw material in, minus everything already accounted for:
  // bagged granules, D, E, waste, and any dust already logged this shift). This
  // dust happens every single shift without exception, so it's exactly the
  // kind of factor that should be system-derived, not hand-weighed and typed —
  // the bag itself is still real and still gets tagged/serialled.
  function computedDustWeight(): number {
    const t2 = granuleTotals(value)
    return Math.max(0, t2.balance - t2.dustOut)
  }
  async function addDustOutput() {
    const weight = computedDustWeight()
    if (weight <= 0) return
    const serial = await nextGranuleSerial(lot, [...value.outputs.map(o => o.serial), ...value.dustOutputs.map(o => o.serial)])
    const now = nowISO()
    const acCode = getAcumaticaCode(dustType, variantShort, 'A')
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: 'granule', session_id: null, product_type: dustType,
        variant: variantWord || null, weight_kg: weight, lot_number: lot || null,
        acumatica_id: acCode?.inventoryId || null, status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: 'granule', weight_kg: weight, operator_id: operatorId ?? null,
      } as any)
    } catch { /* retries on save */ }
    patch({ dustOutputs: [...value.dustOutputs, {
      id: crypto.randomUUID(), dustType, bags: '1', weight: String(weight),
      serial, code: acCode?.inventoryId ?? null, printed: LABEL_PRINTING_ENABLED, secured: true, logged_at: now,
    }] })
  }
  function removeDustOutput(id: string) { patch({ dustOutputs: value.dustOutputs.filter(r => r.id !== id) }) }

  // ── Waste ───────────────────────────────────────────────────────────────────
  function addWaste() { patch({ waste: [...value.waste, { id: crypto.randomUUID(), wasteType: '', weight: '' }] }) }
  function updateWaste(id: string, k: keyof GranuleWasteRow, v: string) { patch({ waste: value.waste.map(w => w.id === id ? { ...w, [k]: v } : w) }) }
  function removeWaste(id: string) { patch({ waste: value.waste.filter(w => w.id !== id) }) }

  // ── Quality graph — pulled from the QC lab by lot number (one source of truth) ──
  // The QC team captures moisture / bulk density on the Granule QC page; we read
  // those readings back here for this lot and draw the same graph, so nothing is
  // captured twice and the graph is always the measured QC data.
  const [qcQuality, setQcQuality] = useState<QualityPoint[]>([])
  useEffect(() => {
    if (!lot) { setQcQuality([]); return }
    let cancelled = false
    fetchGranuleQuality({ lot }).then(pts => { if (!cancelled) setQcQuality(pts) })
    return () => { cancelled = true }
  }, [lot])
  const qualityChart = qcQuality.map(p => ({
    label: `${p.date?.slice(5)} ${p.time}`.trim(), moisture: p.moisture, bulkDensity: p.bulkDensity,
  }))

  // ── Totals + derived ──────────────────────────────────────────────────────────
  const t = granuleTotals(value)
  const inputCount = value.blends.reduce((s, b) => s + b.rows.length, 0)
  // Bagging summary — grouped by lot (one item per session, so effectively one row).
  const summaryByLot = value.outputs.reduce((acc, b) => {
    const key = `${b.item}||${b.lot || lot}`
    const g = acc.get(key) ?? { item: b.item, lot: b.lot || lot, bags: 0, kg: 0 }
    g.bags += 1; g.kg += n(b.weight); acc.set(key, g); return acc
  }, new Map<string, { item: string; lot: string; bags: number; kg: number }>())
  const summaryRows = Array.from(summaryByLot.values())

  return (
    <div className="space-y-4">
      {/* Mandatory, same footing as variant — no default, so a whole shift can
          never get silently recorded under the wrong item because no one
          touched the dropdown. */}
      {!value.item ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center px-4 rounded-2xl border-2 border-dashed border-stone-300">
          <AlertTriangle size={22} className="text-amber-500" />
          <p className="text-[14px] font-medium text-text">Choose what this session is producing</p>
          <div className="flex flex-wrap justify-center gap-2">
            {GRANULE_OUTPUT_ITEMS.map(it => (
              <button key={it} onClick={() => patch({ item: it })}
                className="px-4 py-2.5 rounded-xl border-2 border-stone-200 text-[13px] font-semibold text-text hover:border-brand hover:text-brand transition-colors">
                {it}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-muted max-w-sm">Capture opens once you choose SG, SF, or Export Granules — the by-product dust and Acumatica codes follow this choice.</p>
        </div>
      ) : (
      <>
      {/* Session item + lot banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-stone-200 bg-stone-50">
        <PackageCheck size={16} className="shrink-0" style={{ color: BAG_COLOR }} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Producing this session</div>
          {itemLocked ? (
            <div className="text-[14px] font-bold text-text">{item} <span className="font-normal text-stone-400 text-[12px]">· by-product {dustType}</span></div>
          ) : (
            <select value={item} onChange={e => patch({ item: e.target.value })} className="mt-1 px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-[14px] font-semibold text-text cursor-pointer">
              {GRANULE_OUTPUT_ITEMS.map(it => <option key={it} value={it}>{it}</option>)}
            </select>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Lot</div>
          <div className="text-[14px] font-mono font-bold text-text">{lot || '—'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2.5">
        {([
          { id: 'feed', label: 'Pellet Mill Feed', Icon: Package,      count: inputCount,           sub: `${t.totalA.toFixed(0)} kg`, color: '#d97706' },
          { id: 'bag',  label: 'Bagging',          Icon: PackageCheck, count: value.outputs.length, sub: `${t.cStar.toFixed(0)} kg`,  color: BAG_COLOR },
        ] as const).map(x => {
          const on = tab === x.id
          return (
            <button key={x.id} onClick={() => setTab(x.id)}
              style={on ? { background: x.color, borderColor: x.color } : { borderColor: x.color + '55' }}
              className={`flex flex-col gap-1 p-3.5 rounded-2xl border-2 text-left transition-all ${on ? 'shadow-sm text-white' : 'bg-white'}`}>
              <div className="flex items-center gap-1.5">
                <x.Icon size={17} className={on ? 'text-white' : ''} style={on ? undefined : { color: x.color }} />
                <span className="font-bold text-[14px]" style={on ? undefined : { color: x.color }}>{x.label}</span>
              </div>
              <div className={`text-[12px] ${on ? 'text-white/90' : 'text-stone-500'}`}>
                <span className={`font-mono font-bold ${on ? 'text-white' : 'text-text'}`}>{x.count}</span>
                <span className={`mx-1.5 ${on ? 'text-white/40' : 'text-stone-300'}`}>·</span>
                <span className="font-mono">{x.sub}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── PELLET MILL FEED ─────────────────────────────────────────────────── */}
      {tab === 'feed' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">Record every dust bag fed into the pellet mill, grouped by blend. Complete a blend before starting the next.</p>

          {value.blends.map((b, i) => (
            <BlendCard key={b.id} blend={b} index={i} locked={locked} variantWord={variantWord} operatorId={operatorId} assignment={assignment}
              onChange={nb => updateBlend(b.id, nb)} onRemove={() => removeBlend(b.id)} onToggleDone={done => toggleBlendDone(b.id, done)} canRemove={value.blends.length > 1} />
          ))}

          {!locked && (
            canAddBlend
              ? <button onClick={addBlend} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-medium transition-colors" style={{ borderColor: '#d9770650', color: '#d97706' }}><Plus size={15} /> Add next blend</button>
              : value.blends.length < 5 && (
                <p className="text-[11px] text-stone-400 text-center flex items-center justify-center gap-1.5"><AlertTriangle size={12} /> Mark the current blend complete before adding the next.</p>
              )
          )}

          {/* Dust column totals — the number the plant reads first */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Dust totals (all blends)</span>
            </div>
            <div className="divide-y divide-stone-100">
              {DUST_COLUMNS.filter(c => t.cols[c.key] > 0).map(c => (
                <div key={c.key} className="flex items-center justify-between px-4 py-2 text-[13px]">
                  <span className="flex items-center gap-2 text-stone-600"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />{c.label}</span>
                  <span className="font-mono font-semibold text-text">{t.cols[c.key].toFixed(1)} kg</span>
                </div>
              ))}
              {t.water > 0 && (
                <div className="flex items-center justify-between px-4 py-2 text-[13px] text-sky-700">
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-sky-400" />Water <span className="text-stone-400 text-[11px]">(not in A)</span></span>
                  <span className="font-mono font-semibold">{t.water.toFixed(1)} L</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white">
              <span className="text-[12px] font-medium opacity-80">Total Mixed (A)</span>
              <span className="font-mono font-bold text-[16px]">{t.totalA.toFixed(1)} kg</span>
            </div>
          </div>
        </>
      )}

      {/* ── BAGGING ──────────────────────────────────────────────────────────── */}
      {tab === 'bag' && (
        <>
          {/* Granule bag list */}
          <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: BAG_COLOR + '30' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: BAG_COLOR + '20', background: BAG_COLOR + '08' }}>
              <span className="font-semibold text-[14px] text-text">{item} bags</span>
              {t.cStar > 0 && <span className="font-mono font-bold text-[14px] text-text">{t.cStar.toFixed(1)} kg</span>}
            </div>
            <div className="p-3 space-y-2">
              {value.outputs.map((b, i) => (
                <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border" style={{ borderColor: BAG_COLOR + '25' }}>
                  <span className="text-[11px] font-mono text-stone-400 w-5 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text">
                      {n(b.weight).toFixed(1)} kg
                      {n(b.targetWeight) > 0 && <span className="text-stone-400 font-normal"> / {n(b.targetWeight).toFixed(0)} target</span>}
                      {b.time ? <span className="font-normal text-text-muted"> · {b.time}</span> : null}
                    </div>
                    {LABEL_PRINTING_ENABLED
                      ? <div className="font-mono text-[11px] text-text-muted">{b.serial}{b.code ? ` · ${b.code}` : ''}</div>
                      : <div className="mt-1 inline-flex items-center gap-2 font-mono text-[13px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2.5 py-1">{b.serial}<span className="text-[10px] font-sans font-normal text-stone-400 uppercase tracking-wide">write on bag</span></div>}
                  </div>
                  {!locked && <button onClick={() => removeOutput(b.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>}
                </div>
              ))}
              {!locked && !lotConfirmed && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 space-y-2.5 text-center">
                  <AlertTriangle size={18} className="mx-auto text-amber-500" />
                  <div>
                    <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-widest">Confirm lot before bagging</div>
                    <div className="text-[20px] font-mono font-bold text-text mt-0.5">{lot || '— not assigned —'}</div>
                  </div>
                  {lot ? (
                    <button onClick={() => setLotConfirmed(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-[13px] font-medium transition-colors" style={{ background: BAG_COLOR }}>
                      <CheckCircle2 size={15} /> Confirm — matches the physical batch
                    </button>
                  ) : (
                    <p className="text-[12px] text-amber-700">No lot assigned for this shift — ask a supervisor to set one on the Assign screen before bagging.</p>
                  )}
                </div>
              )}
              {!locked && lotConfirmed && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className={LBL}>Bag weight — target (kg)</label>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={outTarget} onChange={e => setOutTarget(e.target.value)} className={INP} />
                    </div>
                    <div className="space-y-1">
                      <label className={LBL}>Total weight — actual (kg)</label>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={outWeight}
                        onChange={e => setOutWeight(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOutputBag() } }} className={INP} />
                    </div>
                  </div>
                  <button onClick={addOutputBag} disabled={n(outWeight) <= 0 || adding}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-[13px] font-medium disabled:opacity-40 transition-colors" style={{ background: BAG_COLOR }}>
                    <Plus size={15} /> {adding ? 'Adding…' : 'Add bag'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bagging summary — auto-generated by lot */}
          {summaryRows.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50"><span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Bagging summary (auto)</span></div>
              <table className="w-full text-[12px]">
                <thead><tr className="text-stone-400 uppercase text-[10px] tracking-wide">
                  <th className="text-left px-4 py-2 font-semibold">Product</th><th className="text-left px-4 py-2 font-semibold">Lot</th>
                  <th className="text-right px-4 py-2 font-semibold">Bags</th><th className="text-right px-4 py-2 font-semibold">Total output</th>
                </tr></thead>
                <tbody>
                  {summaryRows.map((r, i) => (
                    <tr key={i} className="border-t border-stone-100">
                      <td className="px-4 py-2 font-medium text-text">{r.item}</td>
                      <td className="px-4 py-2 font-mono text-stone-600">{r.lot || '—'}</td>
                      <td className="px-4 py-2 text-right font-mono text-text">{r.bags}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-text">{r.kg.toFixed(1)} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Dust from granule line — weight is the mass-balance residual,
              computed by the system, not hand-weighed and typed in (this dust
              happens every shift without exception). The bag itself is still
              real, so logging it still creates a tagged bag_tags row. */}
          {(() => {
            const pending = computedDustWeight()
            const pendingWarn = pending > 0
            return (
              <div className={`border rounded-2xl overflow-hidden ${pendingWarn ? 'border-amber-300' : 'border-stone-200'}`}>
                <div className={`px-4 py-3 border-b flex items-center gap-2 ${pendingWarn ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-100'}`}>
                  <span className="font-semibold text-[14px] text-text flex-1">Dust from granule line · {dustType}</span>
                  {t.dustOut > 0 && <span className="font-mono font-semibold text-[13px] text-text">{t.dustOut.toFixed(1)} kg</span>}
                </div>
                {pendingWarn && (
                  <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-start gap-2 text-[12px] text-amber-800">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span><strong>{pending.toFixed(1)} kg</strong> of {dustType} is unaccounted for by the mass balance so far — log the bag once it's been swept up and weighed off the line.</span>
                  </div>
                )}
                <div className="p-3 space-y-2">
                  {value.dustOutputs.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-stone-200">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text">{r.dustType} · {n(r.weight).toFixed(1)} kg</div>
                        {!LABEL_PRINTING_ENABLED && <div className="mt-1 inline-flex items-center gap-2 font-mono text-[12px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2 py-0.5">{r.serial}<span className="text-[9px] font-sans font-normal text-stone-400 uppercase">write on bag</span></div>}
                      </div>
                      {!locked && <button onClick={() => removeDustOutput(r.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>}
                    </div>
                  ))}
                  {!locked && (
                    <button onClick={addDustOutput} disabled={pending <= 0}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-stone-200 text-stone-600 hover:border-brand hover:text-brand disabled:opacity-40 transition-colors">
                      <Plus size={16} /> {pending > 0 ? `Log ${dustType} bag — ${pending.toFixed(1)} kg` : `No ${dustType} outstanding`}
                    </button>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Waste */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
              <span className="font-semibold text-[14px] text-text">Waste</span>
              {t.wasteF > 0 && <span className="font-mono font-semibold text-[13px] text-text">{t.wasteF.toFixed(1)} kg</span>}
            </div>
            <div className="p-3 space-y-2">
              {value.waste.map(w => (
                <div key={w.id} className="flex gap-2 items-center">
                  <input type="text" value={w.wasteType} disabled={locked} placeholder="Waste type" onChange={e => updateWaste(w.id, 'wasteType', e.target.value)} className={INP + ' flex-1'} />
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={w.weight} disabled={locked} placeholder="kg" onChange={e => updateWaste(w.id, 'weight', e.target.value)} className={INP + ' w-24'} />
                  {!locked && <button onClick={() => removeWaste(w.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>}
                </div>
              ))}
              {!locked && <button onClick={addWaste} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-stone-200 text-[13px] font-medium text-stone-500 hover:border-stone-300"><Plus size={15} /> Add waste row</button>}
            </div>
          </div>

          {/* Quality graph — moisture + bulk density from the QC lab, linked by lot */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Granule quality (from QC)</span>
                <p className="text-[10px] text-stone-400 mt-0.5">Moisture &amp; bulk density (cc/100g) measured by QC for lot {lot || '—'} — captured on the Granule QC page.</p>
              </div>
            </div>
            <div className="p-3">
              {qualityChart.length >= 2 ? (
                <ResponsiveContainer width="100%" height={190}>
                  <ComposedChart data={qualityChart} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="m" tick={{ fontSize: 10 }} unit="%" width={38} />
                    <YAxis yAxisId="b" orientation="right" tick={{ fontSize: 10 }} width={40} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line yAxisId="m" type="monotone" dataKey="moisture" name="Moisture %" stroke="#2A7CB8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line yAxisId="b" type="monotone" dataKey="bulkDensity" name="Bulk density (cc/100g)" stroke="#5A8A2A" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[12px] text-stone-400 text-center py-6">
                  {qualityChart.length === 1
                    ? 'One QC reading so far — the graph plots once there are two or more.'
                    : lot
                      ? `No QC readings yet for lot ${lot}. They appear here automatically as QC captures moisture / bulk density for this lot.`
                      : 'Set the lot number to link QC quality readings.'}
                </p>
              )}
            </div>
          </div>

          {/* End-of-shift readings for the mass balance (result shows in Overview) */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">End of shift — for mass balance</span>
              <p className="text-[10px] text-stone-400 mt-0.5">The balance is calculated by the system and shown in the Overview.</p>
            </div>
            <div className="p-3 grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className={LBL}>Dust from sieve &amp; drier not yet re-fed (D)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.dustNotRefed} disabled={locked} onChange={e => patch({ dustNotRefed: e.target.value })} className={INP} placeholder="kg" />
              </div>
              <div className="space-y-1 col-span-2">
                <label className={LBL}>Coarse granules not yet fed to maize master (E)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.coarseNotFed} disabled={locked} onChange={e => patch({ coarseNotFed: e.target.value })} className={INP} placeholder="kg" />
              </div>
              <div className="space-y-1">
                <label className={LBL}>Meter start (Y)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.meterStart} disabled={locked} onChange={e => patch({ meterStart: e.target.value })} className={INP} />
              </div>
              <div className="space-y-1">
                <label className={LBL}>Meter stop (Z)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.meterStop} disabled={locked} onChange={e => patch({ meterStop: e.target.value })} className={INP} />
              </div>
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}

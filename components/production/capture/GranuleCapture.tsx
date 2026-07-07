'use client'

/**
 * GranuleCapture — Rooibos Granules line (PR-FM-026/7 + Bagging PR-FM-005.1).
 *
 * The granule line is a blend: dusts are fed into the pellet mill and come out
 * as granules (SG / SF / Export) plus a little dust. Unlike Sieving/Refining it
 * has a custom layout, but the same three input modes as Refining:
 *   scan (barcode / type serial) · pick from system (in-stock bag) · manual.
 *
 * Three sub-tabs:
 *   1. Pellet Mill Feed — inputs grouped into blends (1..5). Each dust input is a
 *      row (type + serial + weight + variant). Column totals per dust type feed
 *      the overview — this is the number the plant reads first.
 *   2. Bagging — granule output bags (one row per bag, serial auto/written),
 *      dust-from-granule-line by-products, and a waste table.
 *   3. Mass Balance — the PR-FM-026/7 report: Total Mixed (A) vs Total Produced
 *      (G = C* + D + E + F), balance, % yield, running hours.
 *
 * Water is fed into the mill but is NOT counted in Total Mixed (A) — confirmed
 * from the paper (blend totals = sum of dust weights only; water is separate).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Plus, Trash2, Package, PackageCheck, Scale, Lock, Pencil, Check, Search, X,
  AlertTriangle, Droplets, Layers,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort, LABEL_PRINTING_ENABLED, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { markBagConsumed } from '@/lib/production/scan-utils'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import { getAcumaticaCode } from '@/lib/production/acumatica-codes'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

// ── Dust columns — the PR-FM-026/7 pellet-mill-feed columns, in report order ────

export const DUST_COLUMNS: { key: string; label: string; productType: string }[] = [
  { key: 'brown',      label: 'Brown / CP Dust', productType: 'Brown Dust' },
  { key: 'white',      label: 'White Dust',      productType: 'White Dust' },
  { key: 'indent',     label: 'Indent Dust',     productType: 'Indent Dust' },
  { key: 'leaf',       label: 'Leaf Dust',       productType: 'Leaf Dust' },
  { key: 'alt',        label: 'ALT Dust',        productType: 'ALT Dust' },
  { key: 'sg',         label: 'SG Dust',         productType: 'SG Dust' },
  { key: 'extraction', label: 'Dust Extraction', productType: 'Dust Extraction' },
  { key: 'other',      label: 'Other',           productType: 'Other' },
]
const DUST_BY_KEY = Object.fromEntries(DUST_COLUMNS.map(c => [c.key, c]))
const DUST_LABEL = (key: string) => DUST_BY_KEY[key]?.label ?? key
const DUST_PRODUCT = (key: string) => DUST_BY_KEY[key]?.productType ?? key
/** Public: dust column key → Acumatica-style product type (used by the capture page). */
export function dustProductType(key: string): string { return DUST_PRODUCT(key) }

// Granule output items (fed to the bagging summary → production order = C*).
const GRANULE_OUTPUT_ITEMS = [
  'SG Granules', 'SF Granules', 'Export Granules',
  'SG Granules 002', 'SF Granules 002', 'Export Granules 002',
]
// Dust-from-granule-line by-products.
const DUST_OUTPUT_ITEMS = ['SG Dust', 'SF Dust', 'Powder Dust']
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
}

export interface GranuleOutBag {
  id: string
  serial: string
  item: string
  time: string
  targetWeight: string
  weight: string
  lot: string
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

export interface GranuleWasteRow {
  id: string
  wasteType: string
  weight: string
}

export interface GranuleData {
  blends: GranuleBlend[]
  outputs: GranuleOutBag[]
  dustOutputs: GranuleDustOut[]
  waste: GranuleWasteRow[]
  dustNotRefed: string   // D — dust from sieve/drier not yet re-fed into pellet mill
  coarseNotFed: string   // E — coarse granules from sieve not yet fed into maize master
  meterStart: string     // Y — running hours meter start
  meterStop: string      // Z — running hours meter stop
}

export function emptyGranuleData(): GranuleData {
  return {
    blends: [{ id: crypto.randomUUID(), blendNo: '1', rows: [], water: '' }],
    outputs: [], dustOutputs: [], waste: [],
    dustNotRefed: '', coarseNotFed: '', meterStart: '', meterStop: '',
  }
}

// ── Totals ────────────────────────────────────────────────────────────────────

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

/** Per-dust-type column totals (summed across all blends) + Total Mixed (A). */
export function granuleColumnTotals(d: GranuleData) {
  const cols: Record<string, number> = {}
  DUST_COLUMNS.forEach(c => { cols[c.key] = 0 })
  ;(d.blends ?? []).forEach(b => {
    (b.rows ?? []).forEach(r => { cols[r.dustKey] = (cols[r.dustKey] ?? 0) + n(r.weight) })
  })
  const totalA = Object.values(cols).reduce((s, v) => s + v, 0)   // excludes water
  const water = (d.blends ?? []).reduce((s, b) => s + n(b.water), 0)
  return { cols, totalA, water }
}

/** Blend total = sum of that blend's dust weights (water excluded, as per paper). */
export function blendTotal(b: GranuleBlend): number {
  return (b.rows ?? []).reduce((s, r) => s + n(r.weight), 0)
}

export function granuleTotals(d: GranuleData) {
  const { cols, totalA, water } = granuleColumnTotals(d)
  const cStar = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0)       // granule bagging summary
  const dustOut = (d.dustOutputs ?? []).reduce((s, r) => s + n(r.weight), 0) // by-product dust
  const wasteF = (d.waste ?? []).reduce((s, r) => s + n(r.weight), 0)        // F
  const D = n(d.dustNotRefed)
  const E = n(d.coarseNotFed)
  const G = cStar + D + E + wasteF          // total produced
  const H = totalA                          // total raw material used
  const balance = H - G
  const yieldPct = H > 0 ? (G / H) * 100 : 0
  const runningHours = n(d.meterStop) - n(d.meterStart)
  return { cols, totalA, water, cStar, dustOut, wasteF, D, E, G, H, balance, yieldPct, runningHours }
}

// ── Style constants (match RefiningCapture) ─────────────────────────────────────

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const FEED_COLOR = '#d97706'   // amber — granule line
const BAG_COLOR  = '#7c3aed'

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

// ── System bag pick list ────────────────────────────────────────────────────────

interface SystemBag {
  serial_number: string
  product_type: string
  variant: string | null
  weight_kg: number | null
  lot_number: string | null
  created_at: string | null
}

function useSystemBags(): SystemBag[] {
  const [bags, setBags] = useState<SystemBag[]>([])
  useEffect(() => {
    const types = DUST_COLUMNS.map(c => c.productType)
    getDb().schema('production').from('bag_tags')
      .select('serial_number, product_type, variant, weight_kg, lot_number, created_at')
      .in('product_type', types)
      .eq('status', 'in_stock')
      .order('created_at', { ascending: false })
      .limit(80)
      .then(({ data }: { data: SystemBag[] | null }) => setBags(data ?? []))
  }, [])
  return bags
}

async function lookupSerial(serial: string): Promise<{
  lot_number: string; weight_kg: string; product_type: string; variant: string
} | null> {
  if (!serial.trim()) return null
  try {
    const { data } = await getDb()
      .schema('production').from('bag_tags')
      .select('lot_number, weight_kg, product_type, variant')
      .eq('serial_number', serial.trim())
      .maybeSingle()
    if (!data) return null
    return {
      lot_number:   data.lot_number   || '',
      weight_kg:    data.weight_kg    ? String(data.weight_kg) : '',
      product_type: data.product_type || '',
      variant:      data.variant      || '',
    }
  } catch {
    return null
  }
}

// map a scanned product_type back to a dust column key
function dustKeyForProduct(productType: string): string {
  const hit = DUST_COLUMNS.find(c => c.productType.toLowerCase() === productType.toLowerCase())
  return hit?.key ?? 'other'
}

// ── Dust input row (scan / manual) ──────────────────────────────────────────────

function DustInputRow({
  row, locked, onUpdate, onSecure, onRemove,
}: {
  row: GranuleInputRow
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
    <div className="bg-white border rounded-2xl p-4 space-y-3" style={{ borderColor: FEED_COLOR + '40' }}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-[13px]" style={{ color: FEED_COLOR }}>
          Dust input {row.inputMode === 'scan' ? '· scan or type serial' : row.inputMode === 'manual' ? '· manual entry' : '· system pick'}
        </span>
        {!locked && <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>}
      </div>

      <div className="space-y-1">
        <label className={LBL}>Bag serial no.</label>
        <div className="flex gap-2">
          <input
            ref={inputRef} data-serial="true" type="text" value={row.serial} disabled={locked}
            placeholder={row.inputMode === 'scan' ? 'Scan or type — press Enter to look up' : 'Type serial no.'}
            onChange={e => onUpdate('serial', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerLookup() } }}
            className={INP + ' flex-1'}
          />
          {!locked && (
            <button onClick={triggerLookup} disabled={!row.serial.trim() || looking}
              className="px-3 rounded-xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand text-[12px] font-medium disabled:opacity-40 shrink-0">
              {looking ? '…' : 'Look up'}
            </button>
          )}
        </div>
        {(row.notInSystem === true || row.notInSystem === 'true') && row.inputMode !== 'manual' && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Not found in system — fill in the details below.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LBL}>Dust type</label>
          <select value={row.dustKey} disabled={locked}
            onChange={e => onUpdate('dustKey', e.target.value)} className={INP + ' cursor-pointer'}>
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

// ── System pick list ──────────────────────────────────────────────────────────

function SystemPickList({ onPick, onClose }: { onPick: (b: SystemBag) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const systemBags = useSystemBags()
  const filtered = query.trim()
    ? systemBags.filter(b =>
        b.serial_number.toLowerCase().includes(query.toLowerCase()) ||
        (b.product_type ?? '').toLowerCase().includes(query.toLowerCase()))
    : systemBags

  return (
    <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: FEED_COLOR + '40' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <span className="font-semibold text-[15px] text-text flex-1">Pick dust bag from system</span>
        <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
          <Search size={15} className="text-stone-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search serial or dust type…"
            className="flex-1 py-2 text-[13px] outline-none bg-transparent" />
        </div>
        {filtered.length === 0 ? (
          <p className="text-[12px] text-stone-400 text-center py-4">
            {systemBags.length === 0 ? 'No in-stock dust bags found.' : 'No matches.'}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-stone-100">
            {filtered.map(b => (
              <button key={b.serial_number} onClick={() => onPick(b)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 text-left">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13px] text-text font-medium">{b.serial_number}</div>
                  <div className="text-[11px] text-stone-500">
                    {[b.product_type, b.variant, b.weight_kg ? `${b.weight_kg} kg` : null].filter(Boolean).join(' · ')}
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

// ── Blend card ──────────────────────────────────────────────────────────────────

function BlendCard({
  blend, index, locked, variantWord, operatorId, assignment,
  onChange, onRemove, canRemove,
}: {
  blend: GranuleBlend
  index: number
  locked: boolean
  variantWord: string
  operatorId?: string | null
  assignment: ShiftAssignment | null
  onChange: (b: GranuleBlend) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [addMode, setAddMode] = useState<GranuleInputRow['inputMode']>('scan')
  const [showSystemPick, setShowSystemPick] = useState(false)

  const rowComplete = (r: GranuleInputRow) => !!r.serial.trim() && !!r.dustKey && n(r.weight) > 0
  const lockCompleted = (rows: GranuleInputRow[]): GranuleInputRow[] => {
    const t = nowISO()
    return rows.map(r => (!r.secured && rowComplete(r)) ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
  }

  function addRow(mode: GranuleInputRow['inputMode'], prefill?: Partial<GranuleInputRow>) {
    onChange({ ...blend, rows: [...lockCompleted(blend.rows), {
      id: crypto.randomUUID(), dustKey: '', serial: '', variant: variantWord || '',
      weight: '', lot: assignment?.lot_number ?? '', inputMode: mode, secured: false, ...prefill,
    }] })
  }
  function updateRow(id: string, k: keyof GranuleInputRow, v: string) {
    onChange({ ...blend, rows: blend.rows.map(r =>
      r.id === id ? { ...r, [k]: v, ...(k === 'serial' ? { notInSystem: '' } : {}) } : r) })
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
          product_type: DUST_PRODUCT(row.dustKey), variant: variantWord || null,
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
    const row: GranuleInputRow = {
      id: crypto.randomUUID(), dustKey: dustKeyForProduct(bag.product_type),
      serial: bag.serial_number, variant: bag.variant || variantWord || '',
      weight: bag.weight_kg ? String(bag.weight_kg) : '', lot: bag.lot_number || '',
      inputMode: 'system', secured: true, logged_at: t,
    }
    onChange({ ...blend, rows: [...lockCompleted(blend.rows), row] })
    markBagConsumed(bag.serial_number, 'granule', null, bag.weight_kg ?? undefined, operatorId ?? null)
    setShowSystemPick(false)
  }

  const total = blendTotal(blend)

  return (
    <div className="bg-white border-2 rounded-2xl overflow-hidden" style={{ borderColor: FEED_COLOR + '35' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: FEED_COLOR + '20', background: FEED_COLOR + '08' }}>
        <div className="flex items-center gap-2">
          <Layers size={16} style={{ color: FEED_COLOR }} />
          <span className="font-bold text-[14px] text-text">Blend</span>
          <input type="text" inputMode="numeric" value={blend.blendNo} disabled={locked}
            onChange={e => onChange({ ...blend, blendNo: e.target.value })}
            className="w-12 px-2 py-1 rounded-lg border border-stone-200 text-[14px] font-bold text-center" />
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && <span className="font-mono font-bold text-[14px] text-text">{total.toFixed(1)} kg</span>}
          {!locked && canRemove && <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Secured + open rows */}
        {blend.rows.map(r => r.secured ? (
          <div key={r.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border"
            style={{ background: FEED_COLOR + '0d', borderColor: FEED_COLOR + '40' }}>
            <Lock size={15} className="shrink-0" style={{ color: FEED_COLOR }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text">{DUST_LABEL(r.dustKey)} · {n(r.weight).toFixed(1)} kg</div>
              <div className="font-mono text-[11px] text-text-muted truncate">
                {[r.serial, r.variant].filter(Boolean).join(' · ')}
                {r.logged_at ? ` · logged ${fmtTime(r.logged_at)}` : ''}
                {r.inputMode === 'system' ? ' · from system' : r.inputMode === 'manual' && r.notInSystem ? ' · registered' : ''}
              </div>
            </div>
            {!locked && (
              <button onClick={() => unlockRow(r.id)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        ) : (
          <DustInputRow key={r.id} row={r} locked={locked}
            onUpdate={(k, v) => updateRow(r.id, k, v)} onSecure={() => secureRow(r.id)} onRemove={() => removeRow(r.id)} />
        ))}

        {showSystemPick && <SystemPickList onPick={handleSystemPick} onClose={() => setShowSystemPick(false)} />}

        {/* Add dust input */}
        {!locked && !showSystemPick && (
          <div className="space-y-2">
            <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white">
              {INPUT_MODES.map(m => (
                <button key={m.id} onClick={() => setAddMode(m.id)}
                  className={`flex-1 py-2 text-[12px] font-medium transition-colors ${addMode === m.id ? 'bg-brand text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-400 px-1">{INPUT_MODES.find(m => m.id === addMode)?.hint}</p>
            {addMode === 'system'
              ? <button onClick={() => setShowSystemPick(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-medium transition-colors"
                  style={{ borderColor: FEED_COLOR + '50', color: FEED_COLOR }}>
                  <Search size={15} /> Browse in-stock dust bags
                </button>
              : <button onClick={() => addRow(addMode)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-medium transition-colors"
                  style={{ borderColor: FEED_COLOR + '50', color: FEED_COLOR }}>
                  <Plus size={15} /> {addMode === 'scan' ? 'Add dust to scan' : 'Add dust manually'}
                </button>}
          </div>
        )}

        {/* Water */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-sky-200 bg-sky-50/50">
          <Droplets size={15} className="text-sky-500 shrink-0" />
          <label className="text-[12px] font-medium text-sky-800 flex-1">Water added (kg)</label>
          <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={blend.water} disabled={locked}
            onChange={e => onChange({ ...blend, water: e.target.value })}
            className="w-24 px-3 py-2 rounded-lg border border-sky-200 bg-white text-[14px] text-right outline-none focus:border-sky-400" />
        </div>
        <p className="text-[10px] text-stone-400 px-1">Water is fed into the mill but is not counted in Total Mixed (A).</p>
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
  const [tab, setTab] = useState<'feed' | 'bag' | 'balance'>('feed')
  const variantShort = variantToShort(variantWord as any) as ShortVariant
  const patch = (p: Partial<GranuleData>) => onChange({ ...value, ...p })

  // ── Blends ─────────────────────────────────────────────────────────────────
  function updateBlend(id: string, b: GranuleBlend) { patch({ blends: value.blends.map(x => x.id === id ? b : x) }) }
  function addBlend() {
    const nextNo = String((value.blends.reduce((m, b) => Math.max(m, parseInt(b.blendNo) || 0), 0)) + 1)
    patch({ blends: [...value.blends, { id: crypto.randomUUID(), blendNo: nextNo, rows: [], water: '' }] })
  }
  function removeBlend(id: string) { patch({ blends: value.blends.filter(b => b.id !== id) }) }

  // ── Granule output bags ──────────────────────────────────────────────────────
  const [outItem, setOutItem] = useState(GRANULE_OUTPUT_ITEMS[0])
  const [outTarget, setOutTarget] = useState(DEFAULT_TARGET_KG)
  const [outWeight, setOutWeight] = useState('')

  async function addOutputBag() {
    if (n(outWeight) <= 0) return
    const serial = genSerial()
    const now = nowISO()
    const acCode = getAcumaticaCode(outItem, variantShort, 'A')
    const lot = assignment?.lot_number ?? ''
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: 'granule', session_id: null,
        product_type: outItem, variant: variantWord || null,
        weight_kg: n(outWeight), lot_number: lot || null,
        acumatica_id: acCode?.inventoryId || null, status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: 'granule',
        weight_kg: n(outWeight), operator_id: operatorId ?? null,
      } as any)
    } catch { /* session save retries */ }

    const bag: GranuleOutBag = {
      id: crypto.randomUUID(), serial, item: outItem, time: clockNow(),
      targetWeight: outTarget, weight: outWeight, lot,
      code: acCode?.inventoryId ?? null, printed: LABEL_PRINTING_ENABLED, secured: true, logged_at: now,
    }
    patch({ outputs: [...value.outputs, bag] })
    setOutWeight('')
    if (LABEL_PRINTING_ENABLED) {
      const label: OutputBag = {
        id: bag.id, serial_number: serial, product_type: outItem, variant: variantShort, grade: 'A',
        weight_kg: n(outWeight), lot_number: lot, section_id: 'granule',
        section_name: SECTION_CONFIG['granule']?.name ?? 'Granule Line', created_at: now, printed: true,
        acumaticaId: acCode?.inventoryId ?? undefined, acumaticaDesc: acCode?.description,
      }
      printLabel(label)
    }
  }
  function removeOutput(id: string) { patch({ outputs: value.outputs.filter(b => b.id !== id) }) }

  // ── Dust-from-granule-line by-products ───────────────────────────────────────
  const [dustType, setDustType] = useState(DUST_OUTPUT_ITEMS[0])
  const [dustBags, setDustBags] = useState('')
  const [dustWeight, setDustWeight] = useState('')

  async function addDustOutput() {
    if (n(dustWeight) <= 0) return
    const serial = genSerial()
    const now = nowISO()
    const acCode = getAcumaticaCode(dustType, variantShort, 'A')
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: 'granule', session_id: null,
        product_type: dustType, variant: variantWord || null,
        weight_kg: n(dustWeight), lot_number: null,
        acumatica_id: acCode?.inventoryId || null, status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: 'granule',
        weight_kg: n(dustWeight), operator_id: operatorId ?? null,
      } as any)
    } catch { /* session save retries */ }
    patch({ dustOutputs: [...value.dustOutputs, {
      id: crypto.randomUUID(), dustType, bags: dustBags || '1', weight: dustWeight,
      serial, code: acCode?.inventoryId ?? null, printed: LABEL_PRINTING_ENABLED, secured: true, logged_at: now,
    }] })
    setDustBags(''); setDustWeight('')
  }
  function removeDustOutput(id: string) { patch({ dustOutputs: value.dustOutputs.filter(r => r.id !== id) }) }

  // ── Waste ─────────────────────────────────────────────────────────────────────
  function addWaste() { patch({ waste: [...value.waste, { id: crypto.randomUUID(), wasteType: '', weight: '' }] }) }
  function updateWaste(id: string, k: keyof GranuleWasteRow, v: string) {
    patch({ waste: value.waste.map(w => w.id === id ? { ...w, [k]: v } : w) })
  }
  function removeWaste(id: string) { patch({ waste: value.waste.filter(w => w.id !== id) }) }

  // ── Totals ──────────────────────────────────────────────────────────────────
  const t = granuleTotals(value)
  const withinTol = Math.abs(t.balance) <= MASS_BALANCE_TOLERANCE_KG
  const inputCount = value.blends.reduce((s, b) => s + b.rows.length, 0)

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="grid grid-cols-3 gap-2.5">
        {([
          { id: 'feed',    label: 'Pellet Mill Feed', Icon: Package,      count: `${inputCount}`, sub: `${t.totalA.toFixed(0)} kg`, color: FEED_COLOR },
          { id: 'bag',     label: 'Bagging',          Icon: PackageCheck, count: `${value.outputs.length}`, sub: `${t.cStar.toFixed(0)} kg`, color: BAG_COLOR },
          { id: 'balance', label: 'Mass Balance',     Icon: Scale,        count: withinTol ? '✓' : '!', sub: `${t.balance > 0 ? '+' : ''}${t.balance.toFixed(0)} kg`, color: withinTol ? '#059669' : '#d97706' },
        ] as const).map(x => {
          const on = tab === x.id
          return (
            <button key={x.id} onClick={() => setTab(x.id)}
              style={on ? { background: x.color, borderColor: x.color } : { borderColor: x.color + '55' }}
              className={`flex flex-col gap-1 p-3 rounded-2xl border-2 text-left transition-all ${on ? 'shadow-sm text-white' : 'bg-white'}`}>
              <div className="flex items-center gap-1.5">
                <x.Icon size={16} className={on ? 'text-white' : ''} style={on ? undefined : { color: x.color }} />
                <span className="font-bold text-[12px]" style={on ? undefined : { color: x.color }}>{x.label}</span>
              </div>
              <div className={`text-[11px] ${on ? 'text-white/90' : 'text-stone-500'}`}>
                <span className={`font-mono font-bold ${on ? 'text-white' : 'text-text'}`}>{x.count}</span>
                <span className={`mx-1 ${on ? 'text-white/40' : 'text-stone-300'}`}>·</span>
                <span className="font-mono">{x.sub}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── PELLET MILL FEED ─────────────────────────────────────────────────── */}
      {tab === 'feed' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">
            Record every dust bag fed into the pellet mill, grouped by blend. Scan the tag, pick from the system, or enter manually.
          </p>

          {value.blends.map((b, i) => (
            <BlendCard key={b.id} blend={b} index={i} locked={locked} variantWord={variantWord}
              operatorId={operatorId} assignment={assignment}
              onChange={nb => updateBlend(b.id, nb)} onRemove={() => removeBlend(b.id)} canRemove={value.blends.length > 1} />
          ))}

          {!locked && value.blends.length < 5 && (
            <button onClick={addBlend}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-medium transition-colors"
              style={{ borderColor: FEED_COLOR + '50', color: FEED_COLOR }}>
              <Plus size={15} /> Add blend
            </button>
          )}

          {/* Column totals — the number the plant reads first */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-stone-100 bg-stone-50">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Dust totals (all blends)</span>
            </div>
            <div className="divide-y divide-stone-100">
              {DUST_COLUMNS.filter(c => t.cols[c.key] > 0).map(c => (
                <div key={c.key} className="flex items-center justify-between px-4 py-2 text-[13px]">
                  <span className="text-stone-600">{c.label}</span>
                  <span className="font-mono font-semibold text-text">{t.cols[c.key].toFixed(1)} kg</span>
                </div>
              ))}
              {t.water > 0 && (
                <div className="flex items-center justify-between px-4 py-2 text-[13px] text-sky-700">
                  <span>Water</span><span className="font-mono font-semibold">{t.water.toFixed(1)} kg</span>
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
          <p className="text-[12px] text-stone-500 px-1">
            Enter each granule output bag — the system generates the serial automatically.
          </p>

          {/* Output bag list */}
          <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: BAG_COLOR + '30' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: BAG_COLOR + '20', background: BAG_COLOR + '08' }}>
              <span className="font-semibold text-[14px] text-text">Granule bags</span>
              {t.cStar > 0 && <span className="font-mono font-bold text-[14px] text-text">{t.cStar.toFixed(1)} kg</span>}
            </div>
            <div className="p-3 space-y-2">
              {value.outputs.map((b, i) => (
                <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border" style={{ borderColor: BAG_COLOR + '25' }}>
                  <span className="text-[11px] font-mono text-stone-400 w-5 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text">
                      {b.item} · {n(b.weight).toFixed(1)} kg
                      {b.time ? <span className="font-normal text-text-muted"> · {b.time}</span> : null}
                    </div>
                    {LABEL_PRINTING_ENABLED
                      ? <div className="font-mono text-[11px] text-text-muted">{b.serial}{b.code ? ` · ${b.code}` : ''}</div>
                      : <div className="mt-1 inline-flex items-center gap-2 font-mono text-[13px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2.5 py-1">
                          {b.serial}<span className="text-[10px] font-sans font-normal text-stone-400 uppercase tracking-wide">write on bag</span>
                        </div>}
                  </div>
                  {!locked && <button onClick={() => removeOutput(b.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>}
                </div>
              ))}

              {!locked && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className={LBL}>Item</label>
                      <select value={outItem} onChange={e => setOutItem(e.target.value)} className={INP + ' cursor-pointer'}>
                        {GRANULE_OUTPUT_ITEMS.map(it => <option key={it} value={it}>{it}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className={LBL}>Target (kg)</label>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={outTarget}
                        onChange={e => setOutTarget(e.target.value)} className={INP} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={outWeight}
                      onChange={e => setOutWeight(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOutputBag() } }}
                      placeholder="Actual weight (kg)" className={INP + ' flex-1'} />
                    <button onClick={addOutputBag} disabled={n(outWeight) <= 0}
                      className="flex items-center gap-1.5 px-4 rounded-xl text-white text-[13px] font-medium disabled:opacity-40 transition-colors shrink-0"
                      style={{ background: BAG_COLOR }}>
                      <Plus size={15} /> Add bag
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Dust from granule line */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 bg-stone-50">
              <span className="font-semibold text-[14px] text-text">Dust from granule line</span>
            </div>
            <div className="p-3 space-y-2">
              {value.dustOutputs.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-stone-200">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text">{r.dustType} · {n(r.weight).toFixed(1)} kg · {r.bags} bag{r.bags !== '1' ? 's' : ''}</div>
                    {!LABEL_PRINTING_ENABLED && (
                      <div className="mt-1 inline-flex items-center gap-2 font-mono text-[12px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2 py-0.5">
                        {r.serial}<span className="text-[9px] font-sans font-normal text-stone-400 uppercase">write on bag</span>
                      </div>
                    )}
                  </div>
                  {!locked && <button onClick={() => removeDustOutput(r.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>}
                </div>
              ))}
              {!locked && (
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end pt-1">
                  <div className="space-y-1">
                    <label className={LBL}>Dust type</label>
                    <select value={dustType} onChange={e => setDustType(e.target.value)} className={INP + ' cursor-pointer'}>
                      {DUST_OUTPUT_ITEMS.map(it => <option key={it} value={it}>{it}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1 w-16">
                    <label className={LBL}>Bags</label>
                    <input type="text" inputMode="numeric" value={dustBags} onChange={e => setDustBags(e.target.value)} className={INP} placeholder="1" />
                  </div>
                  <div className="space-y-1 w-24">
                    <label className={LBL}>Qty (kg)</label>
                    <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={dustWeight} onChange={e => setDustWeight(e.target.value)} className={INP} />
                  </div>
                  <button onClick={addDustOutput} disabled={n(dustWeight) <= 0}
                    className="flex items-center justify-center px-3 min-h-[42px] rounded-xl border border-stone-200 text-stone-600 hover:border-brand hover:text-brand disabled:opacity-40 shrink-0">
                    <Plus size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Waste */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
              <span className="font-semibold text-[14px] text-text">Waste</span>
              {t.wasteF > 0 && <span className="font-mono font-semibold text-[13px] text-text">{t.wasteF.toFixed(1)} kg</span>}
            </div>
            <div className="p-3 space-y-2">
              {value.waste.map(w => (
                <div key={w.id} className="flex gap-2 items-center">
                  <input type="text" value={w.wasteType} disabled={locked} placeholder="Waste type"
                    onChange={e => updateWaste(w.id, 'wasteType', e.target.value)} className={INP + ' flex-1'} />
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={w.weight} disabled={locked} placeholder="kg"
                    onChange={e => updateWaste(w.id, 'weight', e.target.value)} className={INP + ' w-24'} />
                  {!locked && <button onClick={() => removeWaste(w.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>}
                </div>
              ))}
              {!locked && (
                <button onClick={addWaste} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-stone-200 text-[13px] font-medium text-stone-500 hover:border-stone-300">
                  <Plus size={15} /> Add waste row
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── MASS BALANCE ─────────────────────────────────────────────────────── */}
      {tab === 'balance' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">
            Plant Shift Mass Balance (PR-FM-026/7). A and C* fill in automatically; enter the carry-overs and meter hours.
          </p>

          {/* Carry-overs */}
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
            <div className="space-y-1">
              <label className={LBL}>Dust from sieve &amp; drier not yet re-fed (D)</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.dustNotRefed} disabled={locked}
                onChange={e => patch({ dustNotRefed: e.target.value })} className={INP} placeholder="kg" />
            </div>
            <div className="space-y-1">
              <label className={LBL}>Coarse granules not yet fed to maize master (E)</label>
              <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.coarseNotFed} disabled={locked}
                onChange={e => patch({ coarseNotFed: e.target.value })} className={INP} placeholder="kg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={LBL}>Meter start (Y)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.meterStart} disabled={locked}
                  onChange={e => patch({ meterStart: e.target.value })} className={INP} />
              </div>
              <div className="space-y-1">
                <label className={LBL}>Meter stop (Z)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={value.meterStop} disabled={locked}
                  onChange={e => patch({ meterStop: e.target.value })} className={INP} />
              </div>
            </div>
          </div>

          {/* Balance summary */}
          <div className={`rounded-2xl border overflow-hidden ${withinTol ? 'border-ok/20' : 'border-amber-200'}`}>
            <div className={`px-4 py-2.5 flex items-center justify-between ${withinTol ? 'bg-ok/5' : 'bg-amber-50'}`}>
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Mass balance</span>
              {!withinTol && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={12} /> Outside ±{MASS_BALANCE_TOLERANCE_KG} kg
                </span>
              )}
            </div>
            <div className="divide-y divide-stone-100 bg-white text-[13px]">
              {([
                ['Total produced (C* + D + E + F) = G', t.G],
                ['Total raw material used (A) = H', t.H],
              ] as [string, number][]).map(([l, v]) => (
                <div key={l} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-stone-600">{l}</span>
                  <span className="font-mono font-semibold text-text">{v.toFixed(1)} kg</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-stone-600">Balance (H − G)</span>
                <span className={`font-mono font-bold text-[15px] ${withinTol ? 'text-ok' : 'text-amber-700'}`}>
                  {t.balance > 0 ? '+' : ''}{t.balance.toFixed(1)} kg
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-stone-600">Percentage yield (G / H)</span>
                <span className="font-mono font-semibold text-text">{t.yieldPct.toFixed(1)}%</span>
              </div>
              {(n(value.meterStart) > 0 || n(value.meterStop) > 0) && (
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-stone-600">Running hours (Z − Y)</span>
                  <span className="font-mono font-semibold text-text">{t.runningHours.toFixed(1)}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

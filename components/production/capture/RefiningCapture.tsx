'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Printer, PenLine, Package, PackageCheck, Lock, Pencil, Check, Search, X, AlertTriangle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabelAuto } from '@/lib/production/label-print'
import { variantToShort, massBalanceToleranceFor, isImplausibleWeight } from '@/lib/production/capture-config'
import { markBagConsumed, sanitizeSerial } from '@/lib/production/scan-utils'
import { validateBagScan, type ScanValidationResult } from '@/lib/production/validate-scan'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import { getAcumaticaCode } from '@/lib/production/acumatica-codes'
import { loadAllInventory } from '@/lib/production/inventory'
import { ItemPicker } from '@/components/production/capture/ItemPicker'
import { ScanBox, BagScanModal } from '@/components/production/capture/BagScanIn'
import type { ShiftAssignment, InventoryItem } from '@/lib/supabase/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RefiningInputBag {
  id: string
  serial: string
  productType: string
  variant: string            // CON / ORG / RA CON / RA ORG as written on the bag
  weight: string
  lot: string
  deliveryDate: string       // the date written on the physical bag tag (may differ from session date)
  inputMode: 'scan' | 'manual' | 'system'
  secured: boolean
  logged_at?: string
  notInSystem?: boolean | string   // 'true'/'' string flag set via onUpdate; true when scanned but not found in bag_tags
}

export interface RefiningOutputBag {
  id: string
  serial: string
  productType: string
  code: string | null
  description?: string
  weight: string
  printed: boolean
  tagMethod: 'printed' | 'handwritten' | null
  secured: boolean
  logged_at?: string
}

export interface RefiningOutputGroup {
  label: string              // 'A' | 'B' | 'C' | 'D'
  productType: string
  code: string | null
  description?: string
  bags: RefiningOutputBag[]
}

export interface RefiningData {
  inputs: RefiningInputBag[]
  outputA: RefiningOutputGroup | null
  outputB: RefiningOutputGroup | null
  outputC: RefiningOutputGroup | null
  outputD: RefiningOutputGroup | null
}

export function emptyRefiningData(): RefiningData {
  return { inputs: [], outputA: null, outputB: null, outputC: null, outputD: null }
}

// ── Totals ────────────────────────────────────────────────────────────────────

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

function todayDelivery(): string {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${dd}-${mm}-${yy}`
}

export function refiningTotals(d: RefiningData) {
  const totalIn = (d.inputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  const groupKg = (g: RefiningOutputGroup | null) =>
    (g?.bags ?? []).reduce((s, b) => s + n(b.weight), 0)
  const totalA = groupKg(d.outputA)
  const totalB = groupKg(d.outputB)
  const totalC = groupKg(d.outputC)
  const totalD = groupKg(d.outputD)
  const balance = totalIn - totalA - totalB - totalC - totalD
  return { totalIn, totalA, totalB, totalC, totalD, balance }
}

// ── Predefined outputs per section ───────────────────────────────────────────

const SECTION_OUTPUTS: Record<string, { key: 'outputA' | 'outputB' | 'outputC' | 'outputD'; label: string; productType: string }[]> = {
  refining1: [
    { key: 'outputA', label: 'A', productType: 'Indent Dust' },
    { key: 'outputB', label: 'B', productType: 'White Dust' },
    { key: 'outputC', label: 'C', productType: 'Powder Dust' },
  ],
  refining2: [
    { key: 'outputA', label: 'A', productType: 'Cut Heavy Stick Fine' },
    { key: 'outputB', label: 'B', productType: 'Cut Heavy Stick Coarse' },
    { key: 'outputC', label: 'C', productType: 'Powder Dust' },
    { key: 'outputD', label: 'D', productType: 'White Dust' },
  ],
}

// ── Shared style constants ────────────────────────────────────────────────────

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const DEBAG_COLOR = '#1d4ed8'
const BAG_COLOR   = '#7c3aed'

// Each destination letter (A/B/C/D) and each input product type gets its own
// colour, cycled by index, so a shift with several groups reads as clearly
// separate lists rather than one long undifferentiated one.
const GROUP_COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#db2777', '#4f46e5']
const groupColor = (i: number) => GROUP_COLORS[i % GROUP_COLORS.length]

const nowISO = () => new Date().toISOString()
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

// ── Input mode labels ────────────────────────────────────────────────────────

const INPUT_MODES: { id: RefiningInputBag['inputMode']; label: string; hint: string }[] = [
  { id: 'scan',   label: 'Scan / type serial', hint: 'Scan barcode or type the serial from the bag tag.' },
  { id: 'system', label: 'Pick from system',   hint: 'Choose a bag that is already in stock in the system.' },
  { id: 'manual', label: 'Manual entry',        hint: 'Bag not in system — fill all fields by hand.' },
]

// ── System bag pick list ──────────────────────────────────────────────────────

interface SystemBag {
  serial_number: string
  product_type: string
  variant: string | null
  weight_kg: number | null
  lot_number: string | null
  created_at: string | null
}

function useSystemBags(sectionId: string, variantWord: string): SystemBag[] {
  const [bags, setBags] = useState<SystemBag[]>([])
  useEffect(() => {
    const cfg = SECTION_CONFIG[sectionId]
    if (!cfg) return
    const types = cfg.inputTypes
    // Also accept the sieving-era names for the same items
    const aliases: Record<string, string[]> = {
      'Sticks': ['Rolsiev Sticks', 'Sticks (RS)', 'Sticks'],
      'Indent Sticks': ['Indent Sticks'],
      'Blocks: Clean': ['RB Blocks', 'Blocks: Clean'],
      '1st Cut': ['1st Cut'],
      // Origin: sieving tower / refining outputs — matched by their bag_tags
      // product_type so system pick surfaces the in-stock origin bag (serial + batch).
      'Coarse Leaf': ['Coarse Leaf'],
      'Cut Heavy Stick Fine': ['Cut Heavy Stick Fine'],
      'Cut Heavy Stick Coarse': ['Cut Heavy Stick Coarse'],
    }
    const expanded = types.flatMap(t => aliases[t] ?? [t])
    getDb().schema('production').from('bag_tags')
      .select('serial_number, product_type, variant, weight_kg, lot_number, created_at')
      .in('product_type', expanded)
      .eq('status', 'in_stock')
      .eq('is_open', false) // still-filling bags aren't finished — not available to consume yet
      .order('created_at', { ascending: false })
      .limit(60)
      .then(({ data }: { data: SystemBag[] | null }) => setBags(data ?? []))
  }, [sectionId, variantWord])
  return bags
}

// ── Scan/lookup helper ────────────────────────────────────────────────────────
// Accepts both legacy DD-MM-SEQ format AND system ST-DDMMYY-NNN format.

async function lookupSerial(serial: string): Promise<{
  lot_number: string; weight_kg: string; product_type: string; variant: string
} | null> {
  if (!serial.trim()) return null
  try {
    const { data } = await getDb()
      .schema('production')
      .from('bag_tags')
      .select('lot_number, weight_kg, product_type, variant')
      .eq('serial_number', serial.trim())
      .maybeSingle()
    if (!data) return null
    return {
      lot_number:   data.lot_number  || '',
      weight_kg:    data.weight_kg   ? String(data.weight_kg) : '',
      product_type: data.product_type || '',
      variant:      data.variant || '',
    }
  } catch (e) {
    // A thrown error here is a real DB/network failure, not a genuinely-absent
    // bag — log it so "serial only, fields blank" can be told apart from a
    // truly-unregistered bag when diagnosing scan issues.
    console.error('[RefiningCapture] serial lookup failed', e)
    return null
  }
}

// ── Scan row ─────────────────────────────────────────────────────────────────

function ScanRow({
  row, sectionId, locked, items, onUpdate, onSecure, onRemove,
}: {
  row: RefiningInputBag
  sectionId: string
  locked: boolean
  items: InventoryItem[]
  onUpdate: (k: keyof RefiningInputBag, v: string) => void
  onSecure: () => void
  onRemove: () => void
}) {
  const [looking, setLooking] = useState(false)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cfg = SECTION_CONFIG[sectionId]
  const inputTypes = cfg?.inputTypes ?? []

  const triggerLookup = useCallback(async () => {
    if (!row.serial.trim()) return
    setLooking(true)
    const result = await lookupSerial(row.serial)
    setLooking(false)
    if (result) {
      if (result.product_type) onUpdate('productType', result.product_type)
      if (result.weight_kg)    onUpdate('weight', result.weight_kg)
      if (result.lot_number)   onUpdate('lot', result.lot_number)
      if (result.variant)      onUpdate('variant', result.variant)
    } else {
      onUpdate('notInSystem', 'true')
    }
  }, [row.serial, onUpdate])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); triggerLookup() }
  }

  // Auto-look up on scan. A hardware scanner fills the serial in one fast burst
  // but usually doesn't send Enter, so the operator was left with the serial in
  // the box and every other field blank. Fire the same lookup the button does
  // once the serial settles — scan a bag and its details populate on their own,
  // no extra tap. Debounced so manual typing also resolves after a short pause;
  // skipped once locked or switched to manual entry.
  useEffect(() => {
    if (locked || row.secured || row.inputMode === 'manual' || !row.serial.trim()) return
    const t = setTimeout(() => { triggerLookup() }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.serial])

  const needsLot = row.productType === 'Coarse Leaf'
  const complete = !!row.serial.trim() && !!row.productType && n(row.weight) > 0 && !isImplausibleWeight(n(row.weight)) && (!needsLot || !!row.lot.trim())

  return (
    <div className="bg-white border rounded-2xl p-4 space-y-3" style={{ borderColor: DEBAG_COLOR + '40' }}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-[13px]" style={{ color: DEBAG_COLOR }}>
          Input bag {row.inputMode === 'scan' ? '· scan or type serial' : row.inputMode === 'manual' ? '· manual entry' : '· system pick'}
        </span>
        {!locked && <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>}
      </div>

      {/* Serial number with lookup */}
      <div className="space-y-1">
        <label className={LBL}>Bag serial no.</label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            data-serial="true"
            type="text"
            value={row.serial}
            disabled={locked}
            placeholder={row.inputMode === 'scan' ? 'Scan or type — fills in automatically' : 'Type serial no.'}
            onChange={e => onUpdate('serial', sanitizeSerial(e.target.value))}
            onKeyDown={handleKeyDown}
            className={INP + ' flex-1'}
            autoCapitalize="characters" spellCheck={false}
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
          <label className={LBL}>Product type</label>
          {searching ? (
            <div className="space-y-1">
              <ItemPicker items={items} placeholder="Search Master Inventory…"
                onPick={it => { onUpdate('productType', it.description || it.inventory_id); setSearching(false) }}
                className={INP} />
              <button type="button" onClick={() => setSearching(false)} className="text-[11px] text-stone-400 hover:text-text">
                ← Back to list
              </button>
            </div>
          ) : (
            <select value={row.productType} disabled={locked}
              onChange={e => e.target.value === '__other__' ? setSearching(true) : onUpdate('productType', e.target.value)}
              className={INP + ' cursor-pointer'}>
              <option value="">Select…</option>
              {inputTypes.map(t => <option key={t} value={t}>{t}</option>)}
              {row.productType && !inputTypes.includes(row.productType) && (
                <option value={row.productType}>{row.productType} (other)</option>
              )}
              {!locked && <option value="__other__">Other — search Master Inventory…</option>}
            </select>
          )}
        </div>
        <div className="space-y-1">
          <label className={LBL}>Weight (kg)</label>
          <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={row.weight} disabled={locked}
            onChange={e => onUpdate('weight', e.target.value)} className={INP} />
          {isImplausibleWeight(n(row.weight)) && (
            <p className="text-[11px] text-err">That's over 999kg for one bag — check for a typo.</p>
          )}
        </div>
        {needsLot && (
          <div className="space-y-1 col-span-2">
            <label className={LBL + ' text-amber-600'}>Batch number <span className="text-red-500">*</span></label>
            <input type="text" value={row.lot} disabled={locked} placeholder="Required for Coarse Leaf"
              onChange={e => onUpdate('lot', e.target.value)}
              className={INP + (!row.lot.trim() ? ' border-amber-400 focus:ring-amber-300' : '')} />
          </div>
        )}
      </div>

      {!locked && (
        <>
          <button onClick={onSecure} disabled={!complete}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] disabled:opacity-40 hover:bg-ok/20 transition-colors">
            <Check size={15} /> Done — lock this bag
          </button>
          {!complete && (() => {
            const missing = [!row.serial.trim() && 'serial', !row.productType && 'product type', n(row.weight) <= 0 && 'weight', needsLot && !row.lot.trim() && 'batch number'].filter(Boolean).join(', ')
            return missing ? <p className="text-[11px] text-stone-400 text-center">{missing} still needed.</p> : null
          })()}
        </>
      )}
    </div>
  )
}

// ── System pick list ──────────────────────────────────────────────────────────

function SystemPickList({
  sectionId, variantWord, onPick, onClose,
}: {
  sectionId: string
  variantWord: string
  onPick: (b: SystemBag) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const systemBags = useSystemBags(sectionId, variantWord)
  const filtered = query.trim()
    ? systemBags.filter(b =>
        b.serial_number.toLowerCase().includes(query.toLowerCase()) ||
        (b.product_type ?? '').toLowerCase().includes(query.toLowerCase()))
    : systemBags

  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden" style={{ borderColor: DEBAG_COLOR + '40' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <span className="font-semibold text-[15px] text-text flex-1">Pick bag from system</span>
        <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
          <Search size={15} className="text-stone-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search serial or type…"
            className="flex-1 py-2 text-[13px] outline-none bg-transparent" />
        </div>
        {filtered.length === 0 ? (
          <p className="text-[12px] text-stone-400 text-center py-4">
            {systemBags.length === 0 ? 'No in-stock bags found for this section.' : 'No matches.'}
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

// ── Output weight group (predefined product type, weight-only entry) ───────────

function OutputWeightGroup({
  groupLabel, groupIndex, productType, group, locked, variantWord, onAdd, onRemoveBag, onSetSecured, onTag,
}: {
  groupLabel: string
  groupIndex: number
  productType: string
  group: RefiningOutputGroup | null
  locked: boolean
  variantWord: string
  onAdd: (weight: string, leaveOpen: boolean) => void
  onRemoveBag: (bagId: string) => void
  onSetSecured: (bagId: string, val: boolean) => void
  onTag: (bagId: string, method: 'printed' | 'handwritten') => void
}) {
  const [weight, setWeight] = useState('')
  const [leaveOpen, setLeaveOpen] = useState(false)
  const groupKg = (group?.bags ?? []).reduce((s, b) => s + n(b.weight), 0)
  const col = groupColor(groupIndex)

  function handleAdd() {
    if (n(weight) <= 0 || isImplausibleWeight(n(weight))) return
    onAdd(weight, leaveOpen)
    setWeight('')
    setLeaveOpen(false)
  }

  return (
    <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: col + '30' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: col + '20', background: col + '08' }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: col }}>{groupLabel}</span>
          <span className="font-semibold text-[14px] text-text">{productType}</span>
          {variantWord && <span className="text-[11px] text-stone-400">{variantWord}</span>}
        </div>
        {groupKg > 0 && <span className="font-mono font-bold text-[14px] text-text">{groupKg.toFixed(1)} kg</span>}
      </div>

      <div className="p-3 space-y-2">
        {/* Locked bags */}
        {group?.bags.map((b, i) => (
          <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={b.secured ? { background: col + '0d', border: `1px solid ${col}30` } : { border: '1px solid #e5e7eb' }}>
            {b.secured && <Lock size={13} className="shrink-0" style={{ color: col }} />}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text">
                Bag {i + 1} · {b.weight} kg
                {b.logged_at ? <span className="font-normal text-text-muted"> · {fmtTime(b.logged_at)}</span> : null}
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-2 font-mono text-[13px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2.5 py-1">
                  {b.serial}{b.code ? ` · ${b.code}` : ''}
                </span>
                {b.tagMethod && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    {b.tagMethod === 'printed' ? <Printer size={11} /> : <PenLine size={11} />} {b.tagMethod}
                  </span>
                )}
              </div>
              {!b.tagMethod && !locked && (
                <div className="flex gap-1.5 mt-1.5">
                  <button onClick={() => onTag(b.id, 'printed')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand">
                    <Printer size={12} /> Print label
                  </button>
                  <button onClick={() => onTag(b.id, 'handwritten')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand">
                    <PenLine size={12} /> Write on tag
                  </button>
                </div>
              )}
            </div>
            {!locked && (b.secured
              ? <button onClick={() => onSetSecured(b.id, false)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg"><Pencil size={13} /> Unlock</button>
              : <button onClick={() => onRemoveBag(b.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
            )}
          </div>
        ))}

        {/* Inline weight entry */}
        {!locked && (
          <div className="space-y-1.5 pt-1">
            <div className="flex gap-2">
              <input
                type="text" inputMode="decimal" pattern="[0-9.,]*"
                value={weight} onChange={e => setWeight(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
                placeholder="Weight (kg)"
                className={INP + ' flex-1'}
              />
              <button onClick={handleAdd} disabled={n(weight) <= 0 || isImplausibleWeight(n(weight))}
                className="flex items-center gap-1.5 px-4 rounded-xl text-white text-[13px] font-medium disabled:opacity-40 transition-colors shrink-0"
                style={{ background: col }}>
                <Plus size={15} /> Add bag
              </button>
            </div>
            {isImplausibleWeight(n(weight)) && (
              <p className="text-[11px] text-err">That's over 999kg for one bag — check for a typo.</p>
            )}
            <label className="flex items-center gap-1.5 text-[11px] text-stone-500 pl-0.5">
              <input type="checkbox" checked={leaveOpen} onChange={e => setLeaveOpen(e.target.checked)} className="rounded" />
              Leave bag open — not full yet, will top up later (from Tags)
            </label>
          </div>
        )}

        {!group && locked && (
          <p className="text-[11px] text-stone-400 text-center py-1">No bags recorded for this output.</p>
        )}
      </div>
    </div>
  )
}


// ── Main component ────────────────────────────────────────────────────────────

export function RefiningCapture({
  sectionId, assignment, variantWord, locked, value, onChange, genSerial, operatorId,
}: {
  sectionId: string
  assignment: ShiftAssignment | null
  variantWord: string
  locked: boolean
  value: RefiningData
  onChange: (d: RefiningData) => void
  genSerial: () => string
  operatorId?: string | null
}) {
  const [tab, setTab] = useState<'debag' | 'bag'>('debag')
  const [addMode, setAddMode] = useState<RefiningInputBag['inputMode']>('scan')
  const [showSystemPick, setShowSystemPick] = useState(false)
  // Scan-first debagging state (see ScanBox / BagScanModal)
  const [scanSerial, setScanSerial] = useState('')
  const [scanBusy, setScanBusy] = useState(false)
  const [scanModal, setScanModal] = useState<{ serial: string; result: ScanValidationResult } | null>(null)
  const sectionLabel = SECTION_CONFIG[sectionId]?.name ?? 'this section'
  const [items, setItems] = useState<InventoryItem[]>([])
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  useEffect(() => { loadAllInventory().then(setItems) }, [])

  const patch = (p: Partial<RefiningData>) => onChange({ ...value, ...p })

  // ── Input bag helpers ──────────────────────────────────────────────────────

  const inputComplete = (r: RefiningInputBag) =>
    !!r.serial.trim() && !!r.productType && n(r.weight) > 0 && !isImplausibleWeight(n(r.weight))

  const lockCompleted = (rows: RefiningInputBag[]): RefiningInputBag[] => {
    const t = nowISO()
    return rows.map(r => (!r.secured && inputComplete(r)) ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
  }

  function addManualRow(mode: RefiningInputBag['inputMode'], prefill?: Partial<RefiningInputBag>) {
    const t = nowISO()
    const locked_ = lockCompleted(value.inputs)
    patch({ inputs: [...locked_, {
      id: crypto.randomUUID(), serial: '', productType: '', variant: variantWord || '',
      weight: '', lot: assignment?.lot_number ?? '', deliveryDate: todayDelivery(),
      inputMode: mode, secured: false, ...prefill,
    }] })
  }

  function updateInput(id: string, k: keyof RefiningInputBag, v: string) {
    patch({ inputs: value.inputs.map(r =>
      r.id === id ? { ...r, [k]: v, ...(k === 'serial' ? { notInSystem: '' } : {}) } : r
    ) })
  }

  function secureInput(id: string) {
    const t = nowISO()
    const updated = value.inputs.map(r => r.id === id ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
    patch({ inputs: updated })
    // Register/consume the bag in bag_tags
    const row = updated.find(r => r.id === id)
    if (row?.serial) {
      if (row.inputMode === 'manual') {
        // Register all manually-entered bags in bag_tags for traceability
        getDb().schema('production').from('bag_tags').upsert({
          serial_number: row.serial, section_id: sectionId, session_id: null,
          product_type: row.productType, variant: variantWord || null,
          weight_kg: n(row.weight) || null, lot_number: row.lot || null,
          status: 'consumed', consumed_at_section: sectionId,
          location_updated_at: t,
        } as any, { onConflict: 'serial_number' }).catch(() => {})
      }
      markBagConsumed(row.serial, sectionId, null, n(row.weight) || undefined, operatorId ?? null)
    }
  }

  function removeInput(id: string) {
    patch({ inputs: value.inputs.filter(r => r.id !== id) })
  }

  function unlockInput(id: string) {
    patch({ inputs: value.inputs.map(r => r.id === id ? { ...r, secured: false } : r) })
  }

  function handleSystemPick(bag: SystemBag) {
    const t = nowISO()
    const locked_ = lockCompleted(value.inputs)
    // Convert ISO created_at → DD-MM-YY for delivery date field
    const bagDate = bag.created_at
      ? (() => {
          const d = new Date(bag.created_at)
          const dd = String(d.getDate()).padStart(2, '0')
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const yy = String(d.getFullYear()).slice(-2)
          return `${dd}-${mm}-${yy}`
        })()
      : ''
    const row: RefiningInputBag = {
      id: crypto.randomUUID(), serial: bag.serial_number,
      productType: bag.product_type, variant: bag.variant || variantWord || '',
      weight: bag.weight_kg ? String(bag.weight_kg) : '', lot: bag.lot_number || '',
      deliveryDate: bagDate, inputMode: 'system', secured: true, logged_at: t,
    }
    patch({ inputs: [...locked_, row] })
    markBagConsumed(bag.serial_number, sectionId, null, bag.weight_kg ?? undefined, operatorId ?? null)
    setShowSystemPick(false)
  }

  // ── Scan-first debagging handlers ────────────────────────────────────────────
  const runScan = useCallback(async (raw: string) => {
    const serial = sanitizeSerial(raw).trim()
    if (!serial) return
    setScanBusy(true)
    const result = await validateBagScan(serial, { sessionVariant: variantWord })
    setScanBusy(false)
    setScanModal({ serial, result })
  }, [variantWord])

  // Confirm from the popup → add the scanned bag as a consumed input here.
  function consumeScanned(tag: NonNullable<ScanValidationResult['tag']>) {
    const t = nowISO()
    const locked_ = lockCompleted(value.inputs)
    const bagDate = tag.tag_date
      ? (() => { const d = new Date(tag.tag_date as string); return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(-2)}` })()
      : ''
    const row: RefiningInputBag = {
      id: crypto.randomUUID(), serial: tag.serial_number,
      productType: tag.product_type, variant: tag.variant || variantWord || '',
      weight: tag.weight_kg != null ? String(tag.weight_kg) : '',
      lot: (tag.lot_number && tag.lot_number !== 'NOT TRACKED') ? tag.lot_number : '',
      deliveryDate: bagDate, inputMode: 'scan', secured: true, logged_at: t,
    }
    patch({ inputs: [...locked_, row] })
    markBagConsumed(tag.serial_number, sectionId, null, n(row.weight) || undefined, operatorId ?? null)
    setScanModal(null); setScanSerial('')
  }

  // Not found → fall back to a manual entry row prefilled with the scanned serial.
  function manualFromScan(serial: string) {
    addManualRow('manual', { serial })
    setScanModal(null); setScanSerial('')
  }

  // ── Output group helpers ───────────────────────────────────────────────────

  async function addOutputBag(groupKey: 'outputA' | 'outputB' | 'outputC' | 'outputD', productType: string, weight: string, leaveOpen = false) {
    if (n(weight) <= 0 || isImplausibleWeight(n(weight))) return
    const serial = genSerial()
    const now = nowISO()
    const acCode = getAcumaticaCode(productType, variantShort, 'A')
    const bag: OutputBag = {
      id: crypto.randomUUID(), serial_number: serial, product_type: productType,
      variant: variantShort, grade: 'A', weight_kg: n(weight),
      lot_number: '', section_id: sectionId,
      section_name: SECTION_CONFIG[sectionId]?.name ?? sectionId,
      created_at: now, printed: false,
      acumaticaId: acCode?.inventoryId ?? undefined, acumaticaDesc: acCode?.description,
    }
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: sectionId, session_id: null,
        product_type: productType, variant: variantWord || null,
        weight_kg: n(weight), lot_number: null, is_open: leaveOpen,
        acumatica_id: acCode?.inventoryId || null, status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: sectionId,
        weight_kg: n(weight), operator_id: operatorId ?? null,
      } as any)
    } catch { /* session save retries */ }

    const newBag: RefiningOutputBag = {
      id: bag.id, serial, productType, code: acCode?.inventoryId ?? null,
      description: acCode?.description, weight,
      printed: true, tagMethod: null, secured: true, logged_at: now,
    }
    const labelMap: Record<string, string> = { outputA: 'A', outputB: 'B', outputC: 'C', outputD: 'D' }
    const existing = value[groupKey]
    patch({
      [groupKey]: {
        label: labelMap[groupKey] ?? groupKey,
        productType, code: acCode?.inventoryId ?? null, description: acCode?.description,
        bags: [...(existing?.bags ?? []), newBag],
      } as RefiningOutputGroup,
    })
  }

  // Operator's Print label / Write on tag choice for a bag already added to a
  // group — mirrors Blender/Pasteuriser's tagging pattern so every section
  // gives the same visible, chosen outcome instead of printing silently.
  function tagOutputBag(groupKey: 'outputA' | 'outputB' | 'outputC' | 'outputD', bagId: string, method: 'printed' | 'handwritten') {
    const g = value[groupKey]
    const bag = g?.bags.find(b => b.id === bagId)
    if (!g || !bag) return
    patch({ [groupKey]: { ...g, bags: g.bags.map(b => b.id === bagId ? { ...b, tagMethod: method } : b) } as RefiningOutputGroup })
    getDb().schema('production').from('bag_tags').update({ tag_method: method } as any)
      .eq('serial_number', bag.serial).then(() => {})
    if (method === 'printed') {
      printLabelAuto({
        id: bag.id, serial_number: bag.serial, product_type: bag.productType,
        variant: variantShort, grade: 'A', weight_kg: n(bag.weight), lot_number: '',
        section_id: sectionId, section_name: SECTION_CONFIG[sectionId]?.name ?? sectionId,
        created_at: bag.logged_at ?? nowISO(), printed: true,
        acumaticaId: bag.code ?? undefined, acumaticaDesc: bag.description,
      } as OutputBag)
    }
  }

  function removeBagFromGroup(groupKey: 'outputA' | 'outputB' | 'outputC' | 'outputD', bagId: string) {
    const g = value[groupKey]
    if (!g) return
    const remaining = g.bags.filter(b => b.id !== bagId)
    patch({ [groupKey]: remaining.length ? { ...g, bags: remaining } : null })
  }

  function setGroupBagSecured(groupKey: 'outputA' | 'outputB' | 'outputC' | 'outputD', bagId: string, val: boolean) {
    const g = value[groupKey]
    if (!g) return
    patch({ [groupKey]: { ...g, bags: g.bags.map(b => b.id === bagId ? { ...b, secured: val } : b) } })
  }

  // ── Derived totals ────────────────────────────────────────────────────────

  const { totalIn, totalA, totalB, totalC, totalD, balance } = refiningTotals(value)
  const totalOut = totalA + totalB + totalC + totalD
  const balanceTolKg = massBalanceToleranceFor(sectionId)
  const withinTol = Math.abs(balance) <= balanceTolKg
  const inputCount = value.inputs.length
  const outputCount = (value.outputA?.bags.length ?? 0) + (value.outputB?.bags.length ?? 0) + (value.outputC?.bags.length ?? 0) + (value.outputD?.bags.length ?? 0)
  const sectionOutputs = SECTION_OUTPUTS[sectionId] ?? []

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="grid grid-cols-2 gap-2.5">
        {([
          { id: 'debag', label: 'Debagging', dir: 'in',  Icon: Package,      count: inputCount,  kg: totalIn,  color: DEBAG_COLOR },
          { id: 'bag',   label: 'Bagging',   dir: 'out', Icon: PackageCheck, count: outputCount, kg: totalOut, color: BAG_COLOR   },
        ] as const).map(t => {
          const on = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={on ? { background: t.color, borderColor: t.color } : { borderColor: t.color + '55' }}
              className={`flex flex-col gap-1.5 p-3.5 rounded-2xl border-2 text-left transition-all ${on ? 'shadow-sm text-white' : 'bg-white'}`}>
              <div className="flex items-center gap-1.5">
                <t.Icon size={18} className={on ? 'text-white' : ''} style={on ? undefined : { color: t.color }} />
                <span className="font-bold text-[15px]" style={on ? undefined : { color: t.color }}>{t.label}</span>
                <span className={`text-[11px] ${on ? 'text-white/70' : 'text-stone-400'}`}>({t.dir})</span>
              </div>
              <div className={`text-[12px] ${on ? 'text-white/90' : 'text-stone-500'}`}>
                <span className={`font-mono font-bold text-[15px] ${on ? 'text-white' : 'text-text'}`}>{t.count}</span> bag{t.count !== 1 ? 's' : ''}
                <span className={`mx-1.5 ${on ? 'text-white/40' : 'text-stone-300'}`}>·</span>
                <span className="font-mono">{t.kg.toFixed(1)} kg</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── DEBAGGING TAB ────────────────────────────────────────────────── */}
      {tab === 'debag' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">
            Scan each bag fed into the machine — its record opens to confirm. Pick from the system or enter manually if it has no barcode.
          </p>

          {/* Primary flow: scan a bag → confirmation popup → consume */}
          {!locked && (
            <ScanBox serial={scanSerial} busy={scanBusy} color={DEBAG_COLOR}
              onChange={setScanSerial} onScan={runScan} />
          )}
          {scanModal && (
            <BagScanModal serial={scanModal.serial} result={scanModal.result} sectionLabel={sectionLabel}
              onConsume={() => scanModal.result.tag && consumeScanned(scanModal.result.tag)}
              onManual={() => manualFromScan(scanModal.serial)}
              onClose={() => setScanModal(null)} />
          )}

          {/* Locked input rows — grouped by product type so a shift with several
              materials never turns into one long, easy-to-lose-count list. Rows
              still being edited (not yet secured) aren't grouped — their product
              type may still change — and stay listed below, same as before. */}
          {(() => {
            const securedRows = value.inputs.filter(r => r.secured)
            const editingRows = value.inputs.filter(r => !r.secured)
            const groups = Array.from(new Set(securedRows.map(r => r.productType || 'Other')))
            return (
              <>
                {groups.map((productType, gi) => {
                  const rows = securedRows.filter(r => (r.productType || 'Other') === productType)
                  const col = groupColor(gi)
                  const groupKg = rows.reduce((s, r) => s + n(r.weight), 0)
                  return (
                    <div key={productType} className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: col }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                          {productType}
                        </span>
                        <span className="text-[11px] font-mono text-stone-500">{groupKg.toFixed(1)} kg · {rows.length} bag{rows.length === 1 ? '' : 's'}</span>
                      </div>
                      {rows.map((r, i) => (
                        <div key={r.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border"
                          style={{ background: col + '0d', borderColor: col + '40' }}>
                          <Lock size={15} className="shrink-0" style={{ color: col }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-text">
                              Bag {i + 1} · {n(r.weight).toFixed(1)} kg
                            </div>
                            <div className="font-mono text-[11px] text-text-muted truncate">
                              {[r.serial, r.variant, r.deliveryDate || r.lot].filter(Boolean).join(' · ')}
                              {r.logged_at ? ` · logged ${fmtTime(r.logged_at)}` : ''}
                              {r.inputMode === 'system' ? ' · from system' : r.inputMode === 'manual' && r.notInSystem ? ' · registered' : ''}
                            </div>
                          </div>
                          {!locked && (
                            <button onClick={() => unlockInput(r.id)}
                              className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg">
                              <Pencil size={13} /> Edit
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
                {editingRows.map(r => (
                  <ScanRow key={r.id} row={r} sectionId={sectionId} locked={locked} items={items}
                    onUpdate={(k, v) => updateInput(r.id, k as keyof RefiningInputBag, v)}
                    onSecure={() => secureInput(r.id)}
                    onRemove={() => removeInput(r.id)} />
                ))}
              </>
            )
          })()}

          {/* System pick list */}
          {showSystemPick && (
            <SystemPickList sectionId={sectionId} variantWord={variantWord}
              onPick={handleSystemPick} onClose={() => setShowSystemPick(false)} />
          )}

          {/* Side options — scanning above is the main path; these cover a bag
              with no barcode or when no scanner is on hand. */}
          {!locked && !showSystemPick && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-stone-400 px-1">No barcode, or no scanner?</p>
              <div className="flex gap-2">
                <button onClick={() => setShowSystemPick(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[12px] font-medium text-stone-500 hover:text-brand hover:border-brand/40 transition-colors border-stone-200">
                  <Search size={14} /> Pick from system
                </button>
                <button onClick={() => addManualRow('manual')}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[12px] font-medium text-stone-500 hover:text-brand hover:border-brand/40 transition-colors border-stone-200">
                  <Plus size={14} /> Enter manually
                </button>
              </div>
            </div>
          )}

          {/* Total in */}
          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total — raw material in</span>
            <span className="font-mono font-bold text-[16px]">{totalIn.toFixed(1)} kg</span>
          </div>
        </>
      )}

      {/* ── BAGGING TAB ──────────────────────────────────────────────────── */}
      {tab === 'bag' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">
            Enter each output bag weight — the system generates the serial automatically.
          </p>

          {sectionOutputs.map(({ key, label, productType }, gi) => {
            const group = value[key]
            const groupKgVal = (group?.bags ?? []).reduce((s, b) => s + n(b.weight), 0)
            return (
              <OutputWeightGroup
                key={key}
                groupLabel={label}
                groupIndex={gi}
                productType={productType}
                group={group}
                locked={locked}
                variantWord={variantWord}
                onAdd={(weight, leaveOpen) => addOutputBag(key, productType, weight, leaveOpen)}
                onRemoveBag={bagId => removeBagFromGroup(key, bagId)}
                onSetSecured={(bagId, v) => setGroupBagSecured(key, bagId, v)}
                onTag={(bagId, method) => tagOutputBag(key, bagId, method)}
              />
            )
          })}

          {/* Mass balance footer */}
          <div className={`px-4 py-3 rounded-2xl border ${withinTol ? 'bg-ok/5 border-ok/20' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Mass balance</span>
              {!withinTol && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={12} /> Outside ±{balanceTolKg} kg
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-stone-500 flex-wrap">
              <span className="font-mono font-bold text-text">{totalIn.toFixed(1)}</span><span>in</span>
              {([['A', totalA], ['B', totalB], ['C', totalC], ['D', totalD]] as [string, number][]).map(([l, kg]) =>
                kg > 0 ? (
                  <span key={l} className="flex items-center gap-1">
                    <span className="text-stone-400">−</span>
                    <span className="font-mono font-bold text-text">{kg.toFixed(1)}</span>
                    <span>{l}</span>
                  </span>
                ) : null
              )}
              <span className="text-stone-400">=</span>
              <span className={`font-mono font-bold text-[15px] ${withinTol ? 'text-ok' : 'text-amber-700'}`}>
                {balance > 0 ? '+' : ''}{balance.toFixed(1)} kg
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

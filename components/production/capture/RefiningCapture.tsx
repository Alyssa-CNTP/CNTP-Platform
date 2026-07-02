'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Printer, Package, PackageCheck, Lock, Pencil, Check, Search, X, AlertTriangle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort, LABEL_PRINTING_ENABLED, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { markBagConsumed } from '@/lib/production/scan-utils'
import { OutputPicker, type PickedOutput } from '@/components/production/capture/OutputPicker'
import { BatchKeypadField } from '@/components/production/capture/BatchKeypadField'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

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
  notInSystem?: boolean      // true when serial was scanned but not found in bag_tags
}

export interface RefiningOutputBag {
  id: string
  serial: string
  productType: string
  code: string | null
  description?: string
  weight: string
  batch: string
  printed: boolean
  secured: boolean
  logged_at?: string
}

export interface RefiningOutputGroup {
  label: string              // 'B' | 'C' | 'D'
  productType: string
  code: string | null
  description?: string
  bags: RefiningOutputBag[]
}

export interface RefiningData {
  inputs: RefiningInputBag[]
  outputB: RefiningOutputGroup | null
  outputC: RefiningOutputGroup | null
  outputD: RefiningOutputGroup | null
}

export function emptyRefiningData(): RefiningData {
  return { inputs: [], outputB: null, outputC: null, outputD: null }
}

// ── Totals ────────────────────────────────────────────────────────────────────

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

export function refiningTotals(d: RefiningData) {
  const totalA = (d.inputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  const groupKg = (g: RefiningOutputGroup | null) =>
    (g?.bags ?? []).reduce((s, b) => s + n(b.weight), 0)
  const totalB = groupKg(d.outputB)
  const totalC = groupKg(d.outputC)
  const totalD = groupKg(d.outputD)
  const balance = totalA - totalB - totalC - totalD
  return { totalA, totalB, totalC, totalD, balance }
}

// ── Shared style constants ────────────────────────────────────────────────────

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const DEBAG_COLOR = '#1d4ed8'
const BAG_COLOR   = '#7c3aed'

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
      'Cut Heavy Stick Coarse': ['Cut Heavy Stick Coarse'],
    }
    const expanded = types.flatMap(t => aliases[t] ?? [t])
    getDb().schema('production').from('bag_tags')
      .select('serial_number, product_type, variant, weight_kg, lot_number')
      .in('product_type', expanded)
      .eq('status', 'in_stock')
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
  } catch {
    return null
  }
}

// ── Scan row ─────────────────────────────────────────────────────────────────

function ScanRow({
  row, sectionId, locked, onUpdate, onSecure, onRemove,
}: {
  row: RefiningInputBag
  sectionId: string
  locked: boolean
  onUpdate: (k: keyof RefiningInputBag, v: string) => void
  onSecure: () => void
  onRemove: () => void
}) {
  const [looking, setLooking] = useState(false)
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

  const complete = !!row.serial.trim() && !!row.productType && n(row.weight) > 0

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
            placeholder={row.inputMode === 'scan' ? 'Scan or type — press Enter to look up' : 'Type serial no.'}
            onChange={e => { onUpdate('serial', e.target.value); onUpdate('notInSystem', 'false') }}
            onKeyDown={handleKeyDown}
            className={INP + ' flex-1'}
          />
          {!locked && (
            <button onClick={triggerLookup} disabled={!row.serial.trim() || looking}
              className="px-3 rounded-xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand text-[12px] font-medium disabled:opacity-40 shrink-0">
              {looking ? '…' : 'Look up'}
            </button>
          )}
        </div>
        {row.notInSystem && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Not found in system — fill in the details below.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LBL}>Product type</label>
          <select value={row.productType} disabled={locked}
            onChange={e => onUpdate('productType', e.target.value)}
            className={INP + ' cursor-pointer'}>
            <option value="">Select…</option>
            {inputTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={LBL}>Variant</label>
          <select value={row.variant} disabled={locked}
            onChange={e => onUpdate('variant', e.target.value)}
            className={INP + ' cursor-pointer'}>
            <option value="">Select…</option>
            <option value="CON">CON — Conventional</option>
            <option value="ORG">ORG — Organic</option>
            <option value="RA CON">RA CON — RA Conventional</option>
            <option value="RA ORG">RA ORG — RA Organic</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className={LBL}>Weight (kg)</label>
          <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={row.weight} disabled={locked}
            onChange={e => onUpdate('weight', e.target.value)} className={INP} />
        </div>
        <div className="space-y-1">
          <label className={LBL}>Bag date</label>
          <input type="text" value={row.deliveryDate} disabled={locked} placeholder="e.g. 29-06-26"
            onChange={e => onUpdate('deliveryDate', e.target.value)} className={INP} />
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
              {[!row.serial.trim() && 'serial', !row.productType && 'product type', n(row.weight) <= 0 && 'weight'].filter(Boolean).join(', ')} still needed.
            </p>
          )}
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

// ── Output group ──────────────────────────────────────────────────────────────

function OutputGroupSection({
  groupLabel, group, sectionId, variantWord, gradeLetter, locked,
  batchHints, onPickerAdd, onRemoveBag, onSetSecured, onClear, genSerial,
}: {
  groupLabel: string
  group: RefiningOutputGroup | null
  sectionId: string
  variantWord: string
  gradeLetter: string
  locked: boolean
  batchHints: string[]
  onPickerAdd: (p: PickedOutput) => void
  onRemoveBag: (bagId: string) => void
  onSetSecured: (bagId: string, val: boolean) => void
  onClear: () => void
  genSerial: () => string
}) {
  const [picking, setPicking] = useState(false)
  const groupKg = (group?.bags ?? []).reduce((s, b) => s + n(b.weight), 0)
  const groupLetter = { B: 'Output 1', C: 'Output 2', D: 'Output 3' }[groupLabel] ?? groupLabel

  function handleAdd(p: PickedOutput) {
    onPickerAdd(p)
    setPicking(false)
  }

  return (
    <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: BAG_COLOR + '30' }}>
      {/* Group header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: BAG_COLOR + '20', background: BAG_COLOR + '08' }}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: BAG_COLOR }}>{groupLabel}</span>
          <span className="font-semibold text-[14px] text-text">{groupLetter}</span>
          {group && <span className="text-[12px] text-stone-500 truncate max-w-[120px]">{group.productType}</span>}
        </div>
        <div className="flex items-center gap-2">
          {group && <span className="font-mono font-bold text-[14px] text-text">{groupKg.toFixed(1)} kg</span>}
          {!locked && group && (
            <button onClick={onClear} className="text-[11px] text-stone-400 hover:text-red-500 px-1.5 py-1 rounded-lg">Clear</button>
          )}
        </div>
      </div>

      <div className="p-3 space-y-2">
        {/* Existing bags */}
        {group?.bags.map(b => (
          <div key={b.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={b.secured ? { background: BAG_COLOR + '0d', border: `1px solid ${BAG_COLOR}30` } : { border: '1px solid #e5e7eb' }}>
            {b.secured && <Lock size={13} className="shrink-0" style={{ color: BAG_COLOR }} />}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text">
                {b.productType} · {b.weight} kg
                {b.logged_at ? <span className="font-normal text-text-muted"> · {fmtTime(b.logged_at)}</span> : null}
              </div>
              {LABEL_PRINTING_ENABLED
                ? <div className="font-mono text-[11px] text-text-muted">{b.serial}{b.code ? ` · ${b.code}` : ''}</div>
                : <div className="mt-1 inline-flex items-center gap-2 font-mono text-[13px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2.5 py-1">
                    {b.serial}<span className="text-[10px] font-sans font-normal text-stone-400 uppercase tracking-wide">write on bag</span>
                  </div>}
            </div>
            {!locked && (b.secured
              ? <button onClick={() => onSetSecured(b.id, false)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg"><Pencil size={13} /> Unlock</button>
              : <button onClick={() => onRemoveBag(b.id)} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
            )}
          </div>
        ))}

        {/* Picker or add button */}
        {!locked && (picking
          ? <OutputPicker
              sectionId={sectionId} variantWord={variantWord} gradeLetter={gradeLetter}
              defaultBatch={batchHints[0] ?? ''}
              batchHints={batchHints}
              onAdd={handleAdd} onClose={() => setPicking(false)}
            />
          : <button onClick={() => setPicking(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed text-[13px] font-medium transition-colors"
              style={{ borderColor: BAG_COLOR + '50', color: BAG_COLOR }}>
              <Plus size={15} /> Add bag to {groupLetter}
            </button>
        )}

        {/* Empty state */}
        {!group && !picking && (
          <p className="text-[11px] text-stone-400 text-center py-1">Not used this shift — add a bag above to record output.</p>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function RefiningCapture({
  sectionId, assignment, variantWord, gradeLetter = 'A', locked, value, onChange, genSerial, operatorId,
}: {
  sectionId: string
  assignment: ShiftAssignment | null
  variantWord: string
  gradeLetter?: string
  locked: boolean
  value: RefiningData
  onChange: (d: RefiningData) => void
  genSerial: () => string
  operatorId?: string | null
}) {
  const [tab, setTab] = useState<'debag' | 'bag'>('debag')
  const [addMode, setAddMode] = useState<RefiningInputBag['inputMode']>('scan')
  const [showSystemPick, setShowSystemPick] = useState(false)
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  const patch = (p: Partial<RefiningData>) => onChange({ ...value, ...p })

  // ── Input bag helpers ──────────────────────────────────────────────────────

  const inputComplete = (r: RefiningInputBag) =>
    !!r.serial.trim() && !!r.productType && n(r.weight) > 0

  const lockCompleted = (rows: RefiningInputBag[]): RefiningInputBag[] => {
    const t = nowISO()
    return rows.map(r => (!r.secured && inputComplete(r)) ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
  }

  function addManualRow(mode: RefiningInputBag['inputMode'], prefill?: Partial<RefiningInputBag>) {
    const t = nowISO()
    const locked_ = lockCompleted(value.inputs)
    patch({ inputs: [...locked_, {
      id: crypto.randomUUID(), serial: '', productType: '', variant: variantWord || '',
      weight: '', lot: assignment?.lot_number ?? '', deliveryDate: '',
      inputMode: mode, secured: false, ...prefill,
    }] })
  }

  function updateInput(id: string, k: keyof RefiningInputBag, v: string) {
    patch({ inputs: value.inputs.map(r => r.id === id ? { ...r, [k]: v } : r) })
  }

  function secureInput(id: string) {
    const t = nowISO()
    const updated = value.inputs.map(r => r.id === id ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
    patch({ inputs: updated })
    // Register/consume the bag in bag_tags
    const row = updated.find(r => r.id === id)
    if (row?.serial) {
      if (row.inputMode === 'manual' && row.notInSystem) {
        // Register legacy bag
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
    const row: RefiningInputBag = {
      id: crypto.randomUUID(), serial: bag.serial_number,
      productType: bag.product_type, variant: bag.variant || variantWord || '',
      weight: bag.weight_kg ? String(bag.weight_kg) : '', lot: bag.lot_number || '',
      deliveryDate: '', inputMode: 'system', secured: true, logged_at: t,
    }
    patch({ inputs: [...locked_, row] })
    markBagConsumed(bag.serial_number, sectionId, null, bag.weight_kg ?? undefined, operatorId ?? null)
    setShowSystemPick(false)
  }

  // ── Output group helpers ───────────────────────────────────────────────────

  async function addOutputBag(groupKey: 'outputB' | 'outputC' | 'outputD', p: PickedOutput) {
    const serial = genSerial()
    const now = nowISO()
    const bag: OutputBag = {
      id: crypto.randomUUID(), serial_number: serial, product_type: p.productType,
      variant: variantShort, grade: (gradeLetter || 'A') as any, weight_kg: n(p.weight),
      lot_number: p.batch || '', section_id: sectionId,
      section_name: SECTION_CONFIG[sectionId]?.name ?? sectionId,
      created_at: now, printed: false,
      acumaticaId: p.code ?? undefined, acumaticaDesc: p.description,
    }
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: sectionId, session_id: null,
        product_type: p.productType, variant: variantWord || null,
        weight_kg: n(p.weight), lot_number: p.batch || null,
        acumatica_id: p.code || null, status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: sectionId,
        weight_kg: n(p.weight), operator_id: operatorId ?? null,
      } as any)
    } catch { /* session save retries */ }

    const newBag: RefiningOutputBag = {
      id: bag.id, serial, productType: p.productType, code: p.code,
      description: p.description, weight: p.weight, batch: bag.lot_number,
      printed: true, secured: true, logged_at: now,
    }
    const existing = value[groupKey]
    patch({
      [groupKey]: {
        label: { outputB: 'B', outputC: 'C', outputD: 'D' }[groupKey] ?? groupKey,
        productType: p.productType, code: p.code, description: p.description,
        bags: [...(existing?.bags ?? []), newBag],
      } as RefiningOutputGroup,
    })
    if (LABEL_PRINTING_ENABLED) printLabel(bag)
  }

  function removeBagFromGroup(groupKey: 'outputB' | 'outputC' | 'outputD', bagId: string) {
    const g = value[groupKey]
    if (!g) return
    const remaining = g.bags.filter(b => b.id !== bagId)
    patch({ [groupKey]: remaining.length ? { ...g, bags: remaining } : null })
  }

  function setGroupBagSecured(groupKey: 'outputB' | 'outputC' | 'outputD', bagId: string, val: boolean) {
    const g = value[groupKey]
    if (!g) return
    patch({ [groupKey]: { ...g, bags: g.bags.map(b => b.id === bagId ? { ...b, secured: val } : b) } })
  }

  // ── Derived totals ────────────────────────────────────────────────────────

  const { totalA, totalB, totalC, totalD, balance } = refiningTotals(value)
  const totalOut = totalB + totalC + totalD
  const withinTol = Math.abs(balance) <= MASS_BALANCE_TOLERANCE_KG
  const inputCount = value.inputs.length
  const outputCount = (value.outputB?.bags.length ?? 0) + (value.outputC?.bags.length ?? 0) + (value.outputD?.bags.length ?? 0)

  const batchHints = [
    assignment?.lot_number ?? '',
    ...value.inputs.map(r => r.lot),
    ...(value.outputB?.bags ?? []).map(b => b.batch),
  ].filter(Boolean) as string[]

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="grid grid-cols-2 gap-2.5">
        {([
          { id: 'debag', label: 'Debagging', dir: 'in',  Icon: Package,      count: inputCount,  kg: totalA,   color: DEBAG_COLOR },
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
            Record every input bag fed into the machine. Scan the barcode, pick from the system, or enter manually.
          </p>

          {/* Locked input rows */}
          {value.inputs.map((r, i) => r.secured ? (
            <div key={r.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border"
              style={{ background: DEBAG_COLOR + '0d', borderColor: DEBAG_COLOR + '40' }}>
              <Lock size={15} className="shrink-0" style={{ color: DEBAG_COLOR }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text">
                  {r.productType || 'Input bag'} {i + 1} · {n(r.weight).toFixed(1)} kg
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
          ) : (
            <ScanRow key={r.id} row={r} sectionId={sectionId} locked={locked}
              onUpdate={(k, v) => updateInput(r.id, k as keyof RefiningInputBag, v)}
              onSecure={() => secureInput(r.id)}
              onRemove={() => removeInput(r.id)} />
          ))}

          {/* System pick list */}
          {showSystemPick && (
            <SystemPickList sectionId={sectionId} variantWord={variantWord}
              onPick={handleSystemPick} onClose={() => setShowSystemPick(false)} />
          )}

          {/* Add input bag — mode selector */}
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
                    style={{ borderColor: DEBAG_COLOR + '50', color: DEBAG_COLOR }}>
                    <Search size={15} /> Browse in-stock bags
                  </button>
                : <button onClick={() => addManualRow(addMode)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-medium transition-colors"
                    style={{ borderColor: DEBAG_COLOR + '50', color: DEBAG_COLOR }}>
                    <Plus size={15} /> {addMode === 'scan' ? 'Add bag to scan' : 'Add bag manually'}
                  </button>
              }
            </div>
          )}

          {/* Total in */}
          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total (A) — raw material in</span>
            <span className="font-mono font-bold text-[16px]">{totalA.toFixed(1)} kg</span>
          </div>
        </>
      )}

      {/* ── BAGGING TAB ──────────────────────────────────────────────────── */}
      {tab === 'bag' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">
            Record each output bag. Three independent output types — use only what applies.
          </p>

          {(['outputB', 'outputC', 'outputD'] as const).map((key, i) => (
            <OutputGroupSection key={key}
              groupLabel={['B', 'C', 'D'][i]}
              group={value[key]}
              sectionId={sectionId}
              variantWord={variantWord}
              gradeLetter={gradeLetter}
              locked={locked}
              batchHints={batchHints}
              genSerial={genSerial}
              onPickerAdd={p => addOutputBag(key, p)}
              onRemoveBag={bagId => removeBagFromGroup(key, bagId)}
              onSetSecured={(bagId, v) => setGroupBagSecured(key, bagId, v)}
              onClear={() => patch({ [key]: null })}
            />
          ))}

          {/* Mass balance footer */}
          <div className={`px-4 py-3 rounded-2xl border ${withinTol ? 'bg-ok/5 border-ok/20' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Mass balance (E)</span>
              {!withinTol && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={12} /> Outside ±{MASS_BALANCE_TOLERANCE_KG} kg
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-stone-500 flex-wrap">
              <span className="font-mono font-bold text-text">{totalA.toFixed(1)}</span><span>A in</span>
              {[['B', totalB], ['C', totalC], ['D', totalD]].map(([l, kg]) =>
                Number(kg) > 0 ? (
                  <span key={String(l)} className="flex items-center gap-1">
                    <span className="text-stone-400">−</span>
                    <span className="font-mono font-bold text-text">{Number(kg).toFixed(1)}</span>
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

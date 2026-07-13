'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Package, PackageCheck, Lock, Pencil, Check, Search, X, AlertTriangle, Printer, PenLine } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { markBagConsumed } from '@/lib/production/scan-utils'
import { validateBagScan } from '@/lib/production/validate-scan'
import { getBlendComponents, groupComponentsByColumn, type BlendColumnGroup } from '@/lib/production/bom'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment } from '@/lib/supabase/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export const BLENDER_DESTINATIONS = ['Export', 'Export Blend', 'Domestic/Local']

export interface BlenderInputBag {
  id: string
  column: string              // 'A'..'F' — which BOM ingredient column this bag was scanned into
  serial: string
  productType: string
  variant: string
  weight: string
  lot: string                 // only tracked for columns flagged hasLot (Fine/Coarse Leaf)
  destination: string         // Export / Export Blend / Domestic-Local — per the paper form's per-row field
  inputMode: 'scan' | 'system' | 'manual'
  secured: boolean
  logged_at?: string
  notInSystem?: boolean
}

export interface BlenderOutputBag {
  id: string
  serial: string
  time: string
  weight: string
  tagMethod: 'printed' | 'handwritten' | null
  secured: boolean
  logged_at?: string
}

export interface BlenderData {
  inputs: BlenderInputBag[]
  outputs: BlenderOutputBag[]
}

export function emptyBlenderData(): BlenderData {
  return { inputs: [], outputs: [] }
}

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

export function blenderTotals(d: BlenderData) {
  const totalIn  = (d.inputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  const totalOut = (d.outputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  // Paper form's sign convention: J = G (bagged out) − I (mixed in).
  const balance = totalOut - totalIn
  const byColumn: Record<string, number> = {}
  for (const r of d.inputs ?? []) byColumn[r.column] = (byColumn[r.column] ?? 0) + n(r.weight)
  return { totalIn, totalOut, balance, byColumn }
}

// ── Shared style constants ────────────────────────────────────────────────────

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const DEBAG_COLOR = '#7c3aed'
const BAG_COLOR   = '#a855f7'

const nowISO = () => new Date().toISOString()
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

const INPUT_MODES: { id: BlenderInputBag['inputMode']; label: string; hint: string }[] = [
  { id: 'scan',   label: 'Scan / type serial', hint: 'Scan the barcode or type the serial from the bag tag.' },
  { id: 'system', label: 'Pick from system',   hint: 'Choose a bag that is already in stock in the system.' },
  { id: 'manual', label: 'Manual entry',        hint: 'Bag not in system — fill all fields by hand.' },
]

// ── System bag pick list, scoped to one ingredient column's allowed types ────

interface SystemBag {
  serial_number: string
  product_type: string
  variant: string | null
  weight_kg: number | null
  lot_number: string | null
  created_at: string | null
}

function useSystemBagsForColumn(allowedTypes: string[]): SystemBag[] {
  const [bags, setBags] = useState<SystemBag[]>([])
  useEffect(() => {
    if (!allowedTypes.length) { setBags([]); return }
    getDb().schema('production').from('bag_tags')
      .select('serial_number, product_type, variant, weight_kg, lot_number, created_at')
      .in('product_type', allowedTypes)
      .eq('status', 'in_stock')
      .order('created_at', { ascending: false })
      .limit(60)
      .then(({ data }: { data: SystemBag[] | null }) => setBags(data ?? []))
  }, [allowedTypes.join('|')])
  return bags
}

function SystemPickList({ allowedTypes, onPick, onClose }: {
  allowedTypes: string[]
  onPick: (b: SystemBag) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const systemBags = useSystemBagsForColumn(allowedTypes)
  const filtered = query.trim()
    ? systemBags.filter(b => b.serial_number.toLowerCase().includes(query.toLowerCase()) || (b.product_type ?? '').toLowerCase().includes(query.toLowerCase()))
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
            {systemBags.length === 0 ? 'No matching in-stock bags found.' : 'No matches.'}
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

// ── Scan row — validated against the BOM column's allowed types ─────────────

function ScanRow({ row, group, variantWord, locked, onUpdate, onSecure, onRemove }: {
  row: BlenderInputBag
  group: BlendColumnGroup
  variantWord: string
  locked: boolean
  onUpdate: (k: keyof BlenderInputBag, v: string) => void
  onSecure: () => void
  onRemove: () => void
}) {
  const [looking, setLooking] = useState(false)
  const [scanMsg, setScanMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const triggerLookup = useCallback(async () => {
    if (!row.serial.trim()) return
    setLooking(true)
    const result = await validateBagScan(row.serial, {
      sessionVariant: variantWord, allowedTypes: group.allowedTypes,
    })
    setLooking(false)
    if (result.status === 'ok' && result.tag) {
      onUpdate('productType', result.tag.product_type)
      onUpdate('weight', result.tag.weight_kg != null ? String(result.tag.weight_kg) : '')
      onUpdate('variant', result.tag.variant || variantWord || '')
      if (group.hasLot && result.tag.lot_number && result.tag.lot_number !== 'NOT TRACKED') onUpdate('lot', result.tag.lot_number)
      onUpdate('notInSystem', '')
      setScanMsg({ kind: 'ok', text: result.message })
    } else if (result.status === 'not_found') {
      onUpdate('notInSystem', 'true')
      setScanMsg({ kind: 'error', text: result.message })
    } else {
      setScanMsg({ kind: 'error', text: result.message })
    }
  }, [row.serial, variantWord, group, onUpdate])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); triggerLookup() }
  }

  const complete = !!row.serial.trim() && !!row.productType && n(row.weight) > 0 && (!group.hasLot || !!row.lot.trim())
  const blocked = scanMsg?.kind === 'error' && !row.notInSystem

  return (
    <div className="bg-white border rounded-2xl p-4 space-y-3" style={{ borderColor: DEBAG_COLOR + '40' }}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-[13px]" style={{ color: DEBAG_COLOR }}>
          {group.label} · {row.inputMode === 'scan' ? 'scan or type serial' : row.inputMode === 'manual' ? 'manual entry' : 'system pick'}
        </span>
        {!locked && <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>}
      </div>

      <div className="space-y-1">
        <label className={LBL}>Bag serial no.</label>
        <div className="flex gap-2">
          <input ref={inputRef} data-serial="true" type="text" value={row.serial} disabled={locked}
            placeholder={row.inputMode === 'scan' ? 'Scan or type — press Enter to look up' : 'Type serial no.'}
            onChange={e => { onUpdate('serial', e.target.value.toUpperCase()); setScanMsg(null) }}
            onKeyDown={handleKeyDown}
            className={INP + ' flex-1'} autoCapitalize="characters" spellCheck={false} />
          {!locked && (
            <button onClick={triggerLookup} disabled={!row.serial.trim() || looking}
              className="px-3 rounded-xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand text-[12px] font-medium disabled:opacity-40 shrink-0">
              {looking ? '…' : 'Look up'}
            </button>
          )}
        </div>
        {scanMsg && (
          <p className={`text-[11px] flex items-center gap-1.5 ${scanMsg.kind === 'ok' ? 'text-ok' : 'text-amber-600'}`}>
            <AlertTriangle size={12} /> {scanMsg.text}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={LBL}>Product type</label>
          <select value={row.productType} disabled={locked} onChange={e => onUpdate('productType', e.target.value)}
            className={INP + ' cursor-pointer'}>
            <option value="">Select…</option>
            {group.allowedTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={LBL}>Weight (kg)</label>
          <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={row.weight} disabled={locked}
            onChange={e => onUpdate('weight', e.target.value)} className={INP} />
        </div>
        <div className="space-y-1">
          <label className={LBL}>Local / Export</label>
          <select value={row.destination} disabled={locked} onChange={e => onUpdate('destination', e.target.value)} className={INP}>
            {BLENDER_DESTINATIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {group.hasLot && (
          <div className="space-y-1">
            <label className={LBL + ' text-amber-600'}>Batch number <span className="text-red-500">*</span></label>
            <input type="text" value={row.lot} disabled={locked} placeholder="e.g. GS-0271"
              onChange={e => onUpdate('lot', e.target.value.toUpperCase())}
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
          {!complete && (
            <p className="text-[11px] text-stone-400 text-center">
              {[!row.serial.trim() && 'serial', !row.productType && 'product type', n(row.weight) <= 0 && 'weight', group.hasLot && !row.lot.trim() && 'batch number'].filter(Boolean).join(', ')} still needed.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Output row — per-bag Print label / Write on tag choice ──────────────────

function OutputRow({ b, locked, onSetSecured, onRemove, onTag }: {
  b: BlenderOutputBag
  locked: boolean
  onSetSecured: (val: boolean) => void
  onRemove: () => void
  onTag: (method: 'printed' | 'handwritten') => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
      style={b.secured ? { background: BAG_COLOR + '0d', border: `1px solid ${BAG_COLOR}30` } : { border: '1px solid #e5e7eb' }}>
      {b.secured && <Lock size={13} className="shrink-0" style={{ color: BAG_COLOR }} />}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text">
          {b.weight} kg{b.logged_at ? <span className="font-normal text-text-muted"> · {fmtTime(b.logged_at)}</span> : null}
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-2 font-mono text-[13px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2.5 py-1">
            {b.serial}
          </span>
          {b.tagMethod && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              {b.tagMethod === 'printed' ? <Printer size={11} /> : <PenLine size={11} />} {b.tagMethod}
            </span>
          )}
        </div>
        {!b.tagMethod && !locked && (
          <div className="flex gap-1.5 mt-1.5">
            <button onClick={() => onTag('printed')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand">
              <Printer size={12} /> Print label
            </button>
            <button onClick={() => onTag('handwritten')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand">
              <PenLine size={12} /> Write on tag
            </button>
          </div>
        )}
      </div>
      {!locked && (b.secured
        ? <button onClick={() => onSetSecured(false)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg"><Pencil size={13} /> Unlock</button>
        : <button onClick={onRemove} className="text-stone-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function BlenderCapture({
  sectionId, assignment, variantWord, locked, value, onChange, genSerial, operatorId,
}: {
  sectionId: string
  assignment: ShiftAssignment | null
  variantWord: string
  locked: boolean
  value: BlenderData
  onChange: (d: BlenderData) => void
  genSerial: () => string
  operatorId?: string | null
}) {
  const [tab, setTab] = useState<'debag' | 'bag'>('debag')
  const [addMode, setAddMode] = useState<BlenderInputBag['inputMode']>('scan')
  const [showSystemPick, setShowSystemPick] = useState<string | null>(null)   // column id, or null
  const [outputWeight, setOutputWeight] = useState('')
  const [columns, setColumns] = useState<BlendColumnGroup[]>([])
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  const bomId = (assignment?.production_orders ?? [])[0] ?? null

  useEffect(() => {
    if (!bomId) { setColumns([]); return }
    getBlendComponents(bomId).then(comps => setColumns(groupComponentsByColumn(comps)))
  }, [bomId])

  const patch = (p: Partial<BlenderData>) => onChange({ ...value, ...p })

  // ── Input bag helpers ──────────────────────────────────────────────────────

  const inputComplete = (r: BlenderInputBag) =>
    !!r.serial.trim() && !!r.productType && n(r.weight) > 0 && (!columns.find(c => c.column === r.column)?.hasLot || !!r.lot.trim())

  const lockCompleted = (rows: BlenderInputBag[]): BlenderInputBag[] => {
    const t = nowISO()
    return rows.map(r => (!r.secured && inputComplete(r)) ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
  }

  function addManualRow(column: string, mode: BlenderInputBag['inputMode']) {
    const t = nowISO()
    const locked_ = lockCompleted(value.inputs)
    patch({ inputs: [...locked_, {
      id: crypto.randomUUID(), column, serial: '', productType: '', variant: variantWord || '',
      weight: '', lot: assignment?.lot_number ?? '', destination: 'Export',
      inputMode: mode, secured: false,
    }] })
  }

  function updateInput(id: string, k: keyof BlenderInputBag, v: string) {
    patch({ inputs: value.inputs.map(r => r.id === id ? { ...r, [k]: v, ...(k === 'serial' ? { notInSystem: '' } : {}) } : r) })
  }

  function secureInput(id: string) {
    const t = nowISO()
    const updated = value.inputs.map(r => r.id === id ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
    patch({ inputs: updated })
    const row = updated.find(r => r.id === id)
    if (row?.serial) {
      if (row.inputMode === 'manual') {
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

  function removeInput(id: string) { patch({ inputs: value.inputs.filter(r => r.id !== id) }) }
  function unlockInput(id: string) { patch({ inputs: value.inputs.map(r => r.id === id ? { ...r, secured: false } : r) }) }

  function handleSystemPick(column: string, bag: SystemBag) {
    const t = nowISO()
    const locked_ = lockCompleted(value.inputs)
    const row: BlenderInputBag = {
      id: crypto.randomUUID(), column, serial: bag.serial_number,
      productType: bag.product_type, variant: bag.variant || variantWord || '',
      weight: bag.weight_kg ? String(bag.weight_kg) : '', lot: bag.lot_number || '',
      destination: 'Export', inputMode: 'system', secured: true, logged_at: t,
    }
    patch({ inputs: [...locked_, row] })
    markBagConsumed(bag.serial_number, sectionId, null, bag.weight_kg ?? undefined, operatorId ?? null)
    setShowSystemPick(null)
  }

  // ── Output bag helpers ─────────────────────────────────────────────────────

  async function addOutputBag(weight: string) {
    if (n(weight) <= 0) return
    const serial = genSerial()
    const now = nowISO()
    const outputDesc = columns.length ? undefined : undefined
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: sectionId, session_id: null,
        product_type: bomId ? `Blend ${bomId}` : 'Blended Batch', variant: variantWord || null,
        weight_kg: n(weight), lot_number: assignment?.lot_number || null,
        acumatica_id: bomId || null, status: 'in_stock', consumed: false, printed_at: now,
      } as any, { onConflict: 'serial_number' })
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: sectionId,
        weight_kg: n(weight), operator_id: operatorId ?? null,
      } as any)
    } catch { /* session save retries */ }

    patch({ outputs: [...value.outputs, {
      id: crypto.randomUUID(), serial, time: fmtTime(now), weight, tagMethod: null, secured: true, logged_at: now,
    }] })
  }

  function removeOutputBag(id: string) { patch({ outputs: value.outputs.filter(b => b.id !== id) }) }
  function setOutputSecured(id: string, val: boolean) { patch({ outputs: value.outputs.map(b => b.id === id ? { ...b, secured: val } : b) }) }

  function setOutputTag(id: string, method: 'printed' | 'handwritten') {
    patch({ outputs: value.outputs.map(b => b.id === id ? { ...b, tagMethod: method } : b) })
    getDb().schema('production').from('bag_tags').update({ tag_method: method } as any)
      .eq('serial_number', value.outputs.find(b => b.id === id)?.serial ?? '').then(() => {})
    if (method === 'printed') {
      const b = value.outputs.find(o => o.id === id)
      if (b) {
        printLabel({
          id: b.id, serial_number: b.serial, product_type: bomId ? `Blend ${bomId}` : 'Blended Batch',
          variant: variantShort, grade: 'A', weight_kg: n(b.weight), lot_number: assignment?.lot_number ?? '',
          section_id: sectionId, section_name: SECTION_CONFIG[sectionId]?.name ?? sectionId,
          created_at: b.logged_at ?? nowISO(), printed: true,
        })
      }
    }
  }

  // ── Derived totals ────────────────────────────────────────────────────────

  const { totalIn, totalOut, balance, byColumn } = blenderTotals(value)
  const withinTol = Math.abs(balance) <= MASS_BALANCE_TOLERANCE_KG
  const inputCount = value.inputs.length
  const outputCount = value.outputs.length

  if (!bomId) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <AlertTriangle size={22} className="text-amber-500" />
        <p className="text-[14px] font-medium text-text">No blend code set for this shift</p>
        <p className="text-[12px] text-text-muted max-w-sm">Ask a supervisor to pick a blend code for Blender on the Assign screen — capture opens once one is set.</p>
      </div>
    )
  }

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
            Blend <strong className="font-mono">{bomId}</strong> — only its ingredients are shown below. Scan the barcode, pick from the system, or enter manually.
          </p>

          {columns.map(col => {
            const rows = value.inputs.filter(r => r.column === col.column)
            const colKg = byColumn[col.column] ?? 0
            const pct = totalIn > 0 ? (colKg / totalIn) * 100 : 0
            return (
              <div key={col.column} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[12px] font-bold" style={{ color: DEBAG_COLOR }}>
                    {col.column} · {col.label}
                  </span>
                  <span className="text-[11px] font-mono text-stone-500">
                    {colKg.toFixed(1)} kg · {pct.toFixed(0)}%
                    <span className="text-stone-300"> / target {(col.targetPct * 100).toFixed(0)}%</span>
                  </span>
                </div>

                {rows.map(r => r.secured ? (
                  <div key={r.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border"
                    style={{ background: DEBAG_COLOR + '0d', borderColor: DEBAG_COLOR + '40' }}>
                    <Lock size={15} className="shrink-0" style={{ color: DEBAG_COLOR }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text">{r.productType || 'Input bag'} · {n(r.weight).toFixed(1)} kg</div>
                      <div className="font-mono text-[11px] text-text-muted truncate">
                        {[r.serial, r.variant, r.destination, r.lot].filter(Boolean).join(' · ')}
                        {r.logged_at ? ` · logged ${fmtTime(r.logged_at)}` : ''}
                        {r.inputMode === 'system' ? ' · from system' : r.inputMode === 'manual' && r.notInSystem ? ' · registered' : ''}
                      </div>
                    </div>
                    {!locked && <button onClick={() => unlockInput(r.id)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg"><Pencil size={13} /> Edit</button>}
                  </div>
                ) : (
                  <ScanRow key={r.id} row={r} group={col} variantWord={variantWord} locked={locked}
                    onUpdate={(k, v) => updateInput(r.id, k, v)} onSecure={() => secureInput(r.id)} onRemove={() => removeInput(r.id)} />
                ))}

                {showSystemPick === col.column && (
                  <SystemPickList allowedTypes={col.allowedTypes} onPick={b => handleSystemPick(col.column, b)} onClose={() => setShowSystemPick(null)} />
                )}

                {!locked && showSystemPick !== col.column && (
                  <div className="space-y-2">
                    <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white">
                      {INPUT_MODES.map(m => (
                        <button key={m.id} onClick={() => setAddMode(m.id)}
                          className={`flex-1 py-2 text-[12px] font-medium transition-colors ${addMode === m.id ? 'bg-brand text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {addMode === 'system'
                      ? <button onClick={() => setShowSystemPick(col.column)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 border-dashed text-[13px] font-medium transition-colors"
                          style={{ borderColor: DEBAG_COLOR + '50', color: DEBAG_COLOR }}>
                          <Search size={15} /> Browse in-stock bags
                        </button>
                      : <button onClick={() => addManualRow(col.column, addMode)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 border-dashed text-[13px] font-medium transition-colors"
                          style={{ borderColor: DEBAG_COLOR + '50', color: DEBAG_COLOR }}>
                          <Plus size={15} /> {addMode === 'scan' ? `Add ${col.label} bag to scan` : `Add ${col.label} bag manually`}
                        </button>
                    }
                  </div>
                )}
              </div>
            )
          })}

          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total — raw material mixed in (I)</span>
            <span className="font-mono font-bold text-[16px]">{totalIn.toFixed(1)} kg</span>
          </div>
        </>
      )}

      {/* ── BAGGING TAB ──────────────────────────────────────────────────── */}
      {tab === 'bag' && (
        <>
          <p className="text-[12px] text-stone-500 px-1">Enter each output bag's weight — the system generates the serial automatically.</p>

          <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: BAG_COLOR + '30' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: BAG_COLOR + '20', background: BAG_COLOR + '08' }}>
              <span className="font-semibold text-[14px] text-text">Blend {bomId} — output bags</span>
              {totalOut > 0 && <span className="font-mono font-bold text-[14px] text-text">{totalOut.toFixed(1)} kg</span>}
            </div>
            <div className="p-3 space-y-2">
              {value.outputs.map(b => (
                <OutputRow key={b.id} b={b} locked={locked}
                  onSetSecured={v => setOutputSecured(b.id, v)} onRemove={() => removeOutputBag(b.id)}
                  onTag={m => setOutputTag(b.id, m)} />
              ))}
              {!locked && (
                <div className="flex gap-2 pt-1">
                  <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={outputWeight} onChange={e => setOutputWeight(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOutputBag(outputWeight); setOutputWeight('') } }}
                    placeholder="Weight (kg)" className={INP + ' flex-1'} />
                  <button onClick={() => { addOutputBag(outputWeight); setOutputWeight('') }} disabled={n(outputWeight) <= 0}
                    className="flex items-center gap-1.5 px-4 rounded-xl text-white text-[13px] font-medium disabled:opacity-40 transition-colors shrink-0" style={{ background: BAG_COLOR }}>
                    <Plus size={15} /> Add bag
                  </button>
                </div>
              )}
              {value.outputs.length === 0 && locked && <p className="text-[11px] text-stone-400 text-center py-1">No bags recorded for this output.</p>}
            </div>
          </div>

          {/* Blend component ratio table — target vs actual */}
          {columns.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
              <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Blend component ratio — target vs actual</p>
              <div className="grid grid-cols-2 gap-1.5">
                {columns.map(col => {
                  const kg = byColumn[col.column] ?? 0
                  const actualPct = totalIn > 0 ? (kg / totalIn) * 100 : 0
                  const targetPct = col.targetPct * 100
                  const off = Math.abs(actualPct - targetPct) > 5
                  return (
                    <div key={col.column} className={`flex justify-between px-3 py-2 rounded-lg border text-[11px] ${off ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-100'}`}>
                      <span className="text-stone-600 truncate pr-2">{col.column} · {col.label}</span>
                      <span className={`font-mono font-bold flex-shrink-0 ${off ? 'text-amber-700' : 'text-stone-700'}`}>
                        {actualPct.toFixed(0)}% <span className="text-stone-400">/ {targetPct.toFixed(0)}%</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Mass balance footer — J = totalOut - totalIn */}
          {totalIn > 0 && (
            <div className={`px-4 py-3 rounded-2xl border ${withinTol ? 'bg-ok/5 border-ok/20' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Mass balance (J = bagged − mixed)</span>
                {!withinTol && <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><AlertTriangle size={12} /> Outside ±{MASS_BALANCE_TOLERANCE_KG} kg</span>}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-stone-500 flex-wrap">
                <span className="font-mono font-bold text-text">{totalOut.toFixed(1)}</span><span>bagged</span>
                <span className="text-stone-400">−</span>
                <span className="font-mono font-bold text-text">{totalIn.toFixed(1)}</span><span>mixed</span>
                <span className="text-stone-400">=</span>
                <span className={`font-mono font-bold text-[15px] ${withinTol ? 'text-ok' : 'text-amber-700'}`}>{balance > 0 ? '+' : ''}{balance.toFixed(1)} kg</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

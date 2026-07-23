'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Package, PackageCheck, Lock, Pencil, Check, Search, X, AlertTriangle, Printer, PenLine, Shuffle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabel } from '@/lib/production/label-print'
import { variantToShort, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import { markBagConsumed, sanitizeSerial } from '@/lib/production/scan-utils'
import { validateBagScan } from '@/lib/production/validate-scan'
import { getBlendComponents, groupComponentsByItem, type BlendIngredientGroup } from '@/lib/production/bom'
import { loadAllInventory } from '@/lib/production/inventory'
import { ItemPicker } from '@/components/production/capture/ItemPicker'
import { BlendCodePicker } from '@/components/production/capture/BlendCodePicker'
import { BatchKeypadField } from '@/components/production/capture/BatchKeypadField'
import { isValidLot } from '@/components/production/capture/SievingCapture'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment, InventoryItem } from '@/lib/supabase/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

// Grade (Export / Export Blend / Domestic) is baked into which specific Master
// Inventory item a bag is — the BOM already lists "Sieved Fine Leaf: Export
// Blend - Conventional" as a distinct component from "...Export..." or
// "...Domestic...". Deriving it from the description (rather than a manual
// per-row dropdown) is both less redundant data entry and the enforcement
// mechanism below: a bag graded "Export Blend" at Sieving Tower must not be
// consumable under a "Domestic" slot at Blender.
function parseGrade(description: string | null | undefined): string | null {
  const d = (description ?? '').toLowerCase()
  if (d.includes('export blend')) return 'Export Blend'
  if (d.includes('export')) return 'Export'
  if (d.includes('domestic') || d.includes('local')) return 'Domestic/Local'
  return null   // no grade concept for this material (e.g. Blocks, Sticks, Granules)
}

// Work centre each capture section's blends live under — keeps each section's
// blend picker scoped to only its own blends (Big Blender never offers a Small
// Blender recipe, and vice versa).
export const WORK_CENTRE_FOR_SECTION: Record<string, string> = {
  blender: '05-BLENDER BIG',
  smallblender: '05-BLENDER SMALL',
}

export interface BlenderInputBag {
  id: string
  itemKey: string              // the BOM ingredient slot this bag was scanned into (component_item_id)
  serial: string
  productType: string          // the ACTUAL material logged — may differ from the slot's declared item (search Master Inventory to confirm/override; materials substitute in practice)
  productCode: string          // the resolved Acumatica inventory_id for productType, when known (from a scan's bag_tags row or an ItemPicker pick) — surfaced at supervisor sign-off so a searched/typed code gets a second pair of eyes before it's treated as ground truth
  variant: string
  weight: string
  lot: string                  // only tracked for slots flagged hasLot (Fine/Coarse Leaf)
  destination: string          // Export / Export Blend / Domestic-Local — auto-derived from productType (parseGrade), not manually chosen
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
  bomId: string | null    // the blend code this production is running — owned by the production, not the shift assignment, so a shift can run several blends without a supervisor re-editing Assign each time
  // Which numbered run of this blend code these output bags belong to — the "1" in
  // SFC-KUN25-C/1-01. Resolved once (from existing bag_tags for this blend) the
  // first time an output bag is created, then reused for every bag in this
  // production so a page reload/rejoin can't renumber mid-batch.
  outputRunNo: number | null
  inputs: BlenderInputBag[]
  outputs: BlenderOutputBag[]
}

export function emptyBlenderData(): BlenderData {
  return { bomId: null, outputRunNo: null, inputs: [], outputs: [] }
}

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

export function blenderTotals(d: BlenderData) {
  const totalIn  = (d.inputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  const totalOut = (d.outputs ?? []).reduce((s, r) => s + n(r.weight), 0)
  // Paper form's sign convention: J = G (bagged out) − I (mixed in).
  const balance = totalOut - totalIn
  const byItem: Record<string, number> = {}
  for (const r of d.inputs ?? []) byItem[r.itemKey] = (byItem[r.itemKey] ?? 0) + n(r.weight)
  return { totalIn, totalOut, balance, byItem }
}

export interface CapturedCode { label: string; code: string; resolved: boolean }

/**
 * Every distinct item code this production actually captured — surfaced at
 * supervisor sign-off so a searched/typed code (rather than a fixed dropdown
 * pick) gets a second pair of eyes before the session is approved and the
 * code is treated as ground truth in the database.
 */
/**
 * The highest existing output-run number already used for a blend code, or
 * null if none exist yet. Standalone (not reusing genBlendSerial's internal
 * scan below) so page.tsx's "Continue the production run from the previous
 * shift?" flow can seed a continuing production's `outputRunNo` with the
 * SAME run being continued — without this, accepting "continue" still left
 * `outputRunNo` null, so genBlendSerial() would derive its own next run
 * (max existing + 1) and silently fork bag numbering to a new run the moment
 * the shift changed, even though the operator explicitly said to continue.
 */
// The run number resets to 1 for the first blend of each production day —
// it is NOT a lifetime-cumulative count of every time this blend code has
// ever run. So any "existing runs" scan for a blend code must be scoped to
// that one production day, not all of bag_tags history. The window covers
// the full calendar date plus an overnight (afternoon/night) shift's
// post-midnight tail, up to 07:00 the next morning when the next day's
// morning shift starts — matching this app's "production day" convention
// (production_runs.production_day) elsewhere.
function productionDayRange(date: string): { start: string; end: string } {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return { start: `${date}T00:00:00+02:00`, end: `${next}T07:00:00+02:00` }
}

export async function resolveExistingBlendRunNo(bomId: string, date: string): Promise<number | null> {
  const escaped = bomId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const { start, end } = productionDayRange(date)
  const { data } = await getDb().schema('production').from('bag_tags')
    .select('serial_number').ilike('serial_number', `${bomId}/%`)
    .gte('created_at', start).lt('created_at', end)
  const serials = ((data as any[]) ?? []).map(r => r.serial_number as string)
  const runPattern = new RegExp(`^${escaped}\\/(\\d+)-`)
  const runs = serials.map(s => { const m = s.match(runPattern); return m ? parseInt(m[1], 10) : 0 })
  return runs.length ? Math.max(...runs) : null
}

export function blenderCapturedCodes(d: BlenderData): CapturedCode[] {
  const seen = new Map<string, CapturedCode>()
  for (const r of d.inputs ?? []) {
    if (!r.productType.trim()) continue
    const key = r.productCode || r.productType
    if (!seen.has(key)) seen.set(key, { label: r.productType, code: r.productCode, resolved: !!r.productCode })
  }
  if (d.bomId) seen.set(`out:${d.bomId}`, { label: `Blend output — ${d.bomId}`, code: d.bomId, resolved: true })
  return Array.from(seen.values())
}

// ── Shared style constants ────────────────────────────────────────────────────

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const DEBAG_COLOR = '#7c3aed'
const BAG_COLOR   = '#d97706'

// Each ingredient group in the Debagging tab gets its own colour, not one
// shared purple — two groups can carry the same material label (e.g. two
// separate Fine Leaf slots at different ratios) and a shared colour made
// them look like the same slot, which is exactly the kind of mix-up that
// puts a bag in the wrong group. Cycled by group index, not by label, so
// same-named groups still land on different colours.
const GROUP_COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#db2777', '#4f46e5', '#16a34a', '#c026d3', '#0891b2']
const colorForGroupIndex = (i: number) => GROUP_COLORS[i % GROUP_COLORS.length]

const nowISO = () => new Date().toISOString()
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

// ── System bag pick list, scoped to one ingredient slot's declared material ──

interface SystemBag {
  serial_number: string
  product_type: string
  variant: string | null
  weight_kg: number | null
  lot_number: string | null
  created_at: string | null
  acumatica_id: string | null
}

function useSystemBagsForType(productType: string): SystemBag[] {
  const [bags, setBags] = useState<SystemBag[]>([])
  useEffect(() => {
    if (!productType) { setBags([]); return }
    getDb().schema('production').from('bag_tags')
      .select('serial_number, product_type, variant, weight_kg, lot_number, created_at, acumatica_id')
      .eq('product_type', productType)
      .eq('status', 'in_stock')
      .order('created_at', { ascending: false })
      .limit(60)
      .then(({ data }: { data: SystemBag[] | null }) => setBags(data ?? []))
  }, [productType])
  return bags
}

function SystemPickList({ productType, color, onPick, onClose }: {
  productType: string
  color: string
  onPick: (b: SystemBag) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const systemBags = useSystemBagsForType(productType)
  const filtered = query.trim()
    ? systemBags.filter(b => b.serial_number.toLowerCase().includes(query.toLowerCase()) || (b.product_type ?? '').toLowerCase().includes(query.toLowerCase()))
    : systemBags

  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden" style={{ borderColor: color + '40' }}>
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
            {systemBags.length === 0 ? `No in-stock "${productType}" bags found.` : 'No matches.'}
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

// ── Add/edit-bag modal — a single "+ Add debagging bag" action replaces the
// old always-visible per-group scan/system/manual card + toggle. With five or
// more ingredient groups each carrying their own full input form, the tab
// became a wall of near-identical cards where it was easy to lose track of
// which card belonged to which material — especially confusing when two
// groups share the same material label (e.g. two Fine Leaf slots at
// different ratios). Product type is now the first field IN the modal (a
// dropdown over the blend's own groups) rather than which of several inline
// buttons happened to be tapped; the material-identity check on scan/lookup
// still applies, so a bag that doesn't match the selected material is still
// rejected, not silently relabelled.
function AddBagModal({ groups, colorFor, variantWord, existingInputs, editingRow, onClose, onSave, onDelete }: {
  groups: BlendIngredientGroup[]
  colorFor: (key: string) => string
  variantWord: string
  existingInputs: BlenderInputBag[]
  editingRow?: BlenderInputBag | null
  onClose: () => void
  onSave: (row: BlenderInputBag) => void
  onDelete?: () => void
}) {
  const [groupKey, setGroupKey] = useState(editingRow?.itemKey ?? groups[0]?.key ?? '')
  const group = groups.find(g => g.key === groupKey) ?? groups[0]
  const [serial, setSerial] = useState(editingRow?.serial ?? '')
  const [weight, setWeight] = useState(editingRow?.weight ?? (group?.hasLot ? '300' : ''))
  const [lot, setLot] = useState(editingRow?.lot ?? '')
  const [productCode, setProductCode] = useState(editingRow?.productCode ?? '')
  const [variant, setVariant] = useState(editingRow?.variant ?? variantWord)
  const [notInSystem, setNotInSystem] = useState(editingRow?.notInSystem ?? false)
  const [inputMode, setInputMode] = useState<BlenderInputBag['inputMode']>(editingRow?.inputMode ?? 'scan')
  const [browsing, setBrowsing] = useState(false)
  const [looking, setLooking] = useState(false)
  const [scanMsg, setScanMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const color = group ? colorFor(group.key) : DEBAG_COLOR
  // Batches actually in stock for this exact material — same data the system-pick
  // list uses — plus whatever's already been typed into a sibling bag this
  // session (a debagged lot that hasn't made it into bag_tags as its own record
  // yet is still a real, reusable batch number for the next bag of the same lot).
  const systemBags = useSystemBagsForType(group?.label ?? '')
  const availableLots = Array.from(new Set([
    ...systemBags.map(b => (b.lot_number ?? '').trim()),
    ...existingInputs.filter(r => r.itemKey === groupKey && r.id !== editingRow?.id).map(r => r.lot.trim()),
  ].filter(Boolean)))

  function pickGroup(key: string) {
    setGroupKey(key)
    if (editingRow?.itemKey === key) return   // switching back to the row's own material — keep its values
    const g = groups.find(x => x.key === key)
    setWeight(g?.hasLot ? '300' : '')
    setLot('')
  }

  const normalise = (s: string) => s.trim().toLowerCase()

  async function triggerLookup() {
    if (!serial.trim() || !group) return
    setLooking(true)
    // Existence / already-consumed / variant-family / finished-product checks
    // happen in validateBagScan; the material-identity check happens here —
    // the selected group is exactly one declared item, so the scanned bag
    // must match it exactly, not just its grade family.
    const result = await validateBagScan(serial, { sessionVariant: variantWord })
    setLooking(false)
    if (result.status === 'ok' && result.tag) {
      if (normalise(result.tag.product_type) !== normalise(group.label)) {
        setScanMsg({ kind: 'error', text: `⛔ This bag is "${result.tag.product_type}", but "${group.label}" is selected above. Pick the matching material, or use "+ Add Other" instead.` })
        return
      }
      setProductCode(result.tag.acumatica_id || '')
      setWeight(result.tag.weight_kg != null ? String(result.tag.weight_kg) : '')
      setVariant(result.tag.variant || variantWord || '')
      if (group.hasLot && result.tag.lot_number && result.tag.lot_number !== 'NOT TRACKED') setLot(result.tag.lot_number)
      setNotInSystem(false); setInputMode('scan')
      setScanMsg({ kind: 'ok', text: result.message })
    } else if (result.status === 'not_found') {
      setNotInSystem(true); setInputMode('manual')
      setScanMsg({ kind: 'error', text: result.message })
    } else {
      setScanMsg({ kind: 'error', text: result.message })
    }
  }

  function pickSystemBag(b: SystemBag) {
    setSerial(b.serial_number); setProductCode(b.acumatica_id || '')
    setWeight(b.weight_kg ? String(b.weight_kg) : ''); setVariant(b.variant || variantWord || '')
    setLot(b.lot_number || ''); setInputMode('system'); setNotInSystem(false); setBrowsing(false)
  }

  // Fine/Coarse Leaf batch numbers are always a Sieving Tower lot — letter/
  // number prefix + dash + more letters/numbers. Catches a dropped digit or
  // missing dash before it locks in.
  const complete = !!group && !!serial.trim() && n(weight) > 0 && (!group.hasLot || isValidLot(lot))

  function submit() {
    if (!complete || !group) return
    onSave({
      id: editingRow?.id ?? crypto.randomUUID(), itemKey: group.key, serial: serial.trim(),
      productType: group.label, productCode, variant: variant || variantWord || '',
      weight, lot, destination: parseGrade(group.label) ?? '', inputMode, secured: true,
      logged_at: editingRow?.logged_at, notInSystem,
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9997, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 shrink-0" style={{ background: color + '10' }}>
          <span className="font-bold text-[15px]" style={{ color }}>{editingRow ? 'Edit bag' : 'Add debagging bag'}</span>
          <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="space-y-1">
            <label className={LBL}>Product type</label>
            <select value={groupKey} onChange={e => pickGroup(e.target.value)} className={INP}>
              {groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </div>

          {browsing ? (
            <SystemPickList productType={group?.label ?? ''} color={color} onPick={pickSystemBag} onClose={() => setBrowsing(false)} />
          ) : (
            <>
              <div className="space-y-1">
                <label className={LBL}>Bag serial no.</label>
                <div className="flex gap-2">
                  <input autoFocus type="text" value={serial}
                    placeholder="Scan or type — press Enter to look up"
                    onChange={e => { setSerial(sanitizeSerial(e.target.value)); setScanMsg(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerLookup() } }}
                    className={INP + ' flex-1'} autoCapitalize="characters" spellCheck={false} />
                  <button onClick={triggerLookup} disabled={!serial.trim() || looking}
                    className="px-3 rounded-xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand text-[12px] font-medium disabled:opacity-40 shrink-0">
                    {looking ? '…' : 'Look up'}
                  </button>
                </div>
                {scanMsg && (
                  <p className={`text-[11px] flex items-center gap-1.5 ${scanMsg.kind === 'ok' ? 'text-ok' : 'text-amber-600'}`}>
                    <AlertTriangle size={12} /> {scanMsg.text}
                  </p>
                )}
                <button onClick={() => setBrowsing(true)} className="text-[11px] text-brand hover:underline">or pick from in-stock bags</button>
              </div>

              <div className="space-y-1">
                <label className={LBL}>Weight (kg)</label>
                <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={weight}
                  onChange={e => setWeight(e.target.value)} className={INP} />
              </div>

              {group?.hasLot && (
                <div className="space-y-1">
                  <label className={LBL + ' text-amber-600'}>Batch number <span className="text-red-500">*</span></label>
                  <BatchKeypadField value={lot} placeholder="e.g. GS-0271" options={availableLots} onChange={setLot}
                    className={INP + (!isValidLot(lot) ? ' border-amber-400 focus:ring-amber-300' : '')} />
                  {lot.trim() && !isValidLot(lot) && (
                    <p className="text-[11px] text-err">Expected at least one dash separating letters/numbers (e.g. GS-0299 or GS26-MIX-A).</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {!browsing && (
          <div className="p-5 pt-0 space-y-2 shrink-0">
            {!complete && (
              <p className="text-[11px] text-stone-400 text-center">
                {[!serial.trim() && 'serial', n(weight) <= 0 && 'weight', group?.hasLot && !isValidLot(lot) && (lot.trim() ? 'a valid batch format' : 'batch number')].filter(Boolean).join(', ')} still needed.
              </p>
            )}
            <div className="flex gap-2">
              {editingRow && onDelete && (
                <button onClick={onDelete} className="px-4 py-2.5 rounded-xl border border-stone-200 text-err text-[13px] font-medium hover:bg-err/5">
                  Remove
                </button>
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
  sectionId, assignment, variantWord, locked, value, onChange, genSerial, operatorId, date,
}: {
  sectionId: string
  assignment: ShiftAssignment | null
  variantWord: string
  locked: boolean
  value: BlenderData
  onChange: (d: BlenderData) => void
  genSerial: () => string
  operatorId?: string | null
  date: string
}) {
  const [tab, setTab] = useState<'debag' | 'bag'>('debag')
  // One "+ Add debagging bag" action opens this instead of each group having
  // its own always-visible scan/system/manual form — see AddBagModal for why.
  // null = closed; { editing: null } = adding a new bag; { editing: row } =
  // editing/removing an existing one.
  const [bagModal, setBagModal] = useState<{ editing: BlenderInputBag | null } | null>(null)
  const [outputWeight, setOutputWeight] = useState('')
  const [groups, setGroups] = useState<BlendIngredientGroup[]>([])
  // Materials the operator added that aren't part of the blend's declared recipe —
  // client-side only, never written back to bom_components (that stays curated on
  // the Blends page). Merged with the BOM-declared groups for rendering/totals.
  const [extraGroups, setExtraGroups] = useState<BlendIngredientGroup[]>([])
  const [addingOther, setAddingOther] = useState(false)
  const [items, setItems] = useState<InventoryItem[]>([])
  // Bag sequence + run number for this blend's output serials — seeded once
  // from bag_tags (see genBlendSerial), then read from the ref rather than
  // `value` for the rest of this function call: `patch()` only takes effect
  // on the next render, so re-reading `value.outputRunNo` immediately after
  // calling it would still see the stale (null) value.
  const bagSeqRef = useRef<number | null>(null)
  const runNoRef = useRef<number | null>(null)
  const variantShort = variantToShort(variantWord as any) as ShortVariant
  const workCentre = WORK_CENTRE_FOR_SECTION[sectionId] ?? '05-BLENDER BIG'

  const patch = (p: Partial<BlenderData>) => onChange({ ...value, ...p })
  const bomId = value.bomId

  // The real serial convention for a blend's output bags — confirmed from actual
  // operator reports: {blendCode}/{runNo}-{bagNo}, e.g. SFC-KUN25-C/1-01. runNo
  // distinguishes separate runs of the same blend (resolved once per production,
  // from whatever's already in bag_tags for this code); bagNo is sequential
  // within that run. Falls back to the generic section serial if somehow called
  // before a blend is chosen (shouldn't happen — the bagging tab is gated on it).
  async function genBlendSerial(): Promise<string> {
    if (!bomId) return genSerial()
    if (bagSeqRef.current === null || runNoRef.current === null) {
      const escaped = bomId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Scoped to this production day — see resolveExistingBlendRunNo's
      // comment. Without this, a blend code that ran on an earlier day (even
      // weeks ago) would push today's first run past 1.
      const { start, end } = productionDayRange(date)
      const { data: bagRows } = await getDb().schema('production').from('bag_tags')
        .select('serial_number').ilike('serial_number', `${bomId}/%`)
        .gte('created_at', start).lt('created_at', end)
      const serials = ((bagRows as any[]) ?? []).map(r => r.serial_number as string)
      let runNo = value.outputRunNo
      if (!runNo) {
        const runPattern = new RegExp(`^${escaped}\\/(\\d+)-`)
        const runs = serials.map(s => { const m = s.match(runPattern); return m ? parseInt(m[1], 10) : 0 })
        runNo = (runs.length ? Math.max(...runs) : 0) + 1
        patch({ outputRunNo: runNo })
      }
      runNoRef.current = runNo
      const bagPattern = new RegExp(`^${escaped}\\/${runNo}-(\\d+)$`)
      bagSeqRef.current = serials.reduce((max, s) => { const m = s.match(bagPattern); return m ? Math.max(max, parseInt(m[1], 10)) : max }, 0)
    }
    bagSeqRef.current += 1
    return `${bomId}/${runNoRef.current}-${String(bagSeqRef.current).padStart(2, '0')}`
  }

  // Prefill from the shift assignment once, purely as a convenience default —
  // the blend picker below is what actually owns this production's blend, so a
  // shift running several blends in a day never needs a supervisor to go back
  // into Assign each time.
  useEffect(() => {
    if (!value.bomId && assignment?.production_orders?.[0]) patch({ bomId: assignment.production_orders[0] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadAllInventory().then(setItems) }, [])

  useEffect(() => {
    if (!bomId) { setGroups([]); return }
    setExtraGroups([])
    getBlendComponents(bomId).then(comps => setGroups(groupComponentsByItem(comps)))
  }, [bomId])

  const allGroups = [...groups, ...extraGroups]
  const blendLocked = value.inputs.length > 0 || value.outputs.length > 0

  function addOtherMaterial(it: InventoryItem) {
    const key = it.inventory_id
    if (!allGroups.some(g => g.key === key)) {
      const label = it.description || it.inventory_id
      setExtraGroups(gs => [...gs, {
        key, componentItemId: key, label, column: 'F', targetPct: 0,
        hasLot: /fine leaf|coarse leaf/i.test(label),
      }])
    }
    setAddingOther(false)
  }

  // ── Input bag helpers ──────────────────────────────────────────────────────

  // AddBagModal always submits a fully-filled, already-secured row — one
  // path for both "add new" and "edit existing" (matched by id), instead of
  // the old separate add/update/secure/system-pick functions. Consumption
  // side effects (bag_tags upsert for manual entries, markBagConsumed) run
  // every commit, same as they did on every secure/re-secure before.
  function commitBagFromModal(row: BlenderInputBag) {
    const isNew = !value.inputs.some(r => r.id === row.id)
    const t = nowISO()
    const finalRow: BlenderInputBag = { ...row, secured: true, logged_at: row.logged_at ?? t }
    patch({ inputs: isNew ? [...value.inputs, finalRow] : value.inputs.map(r => r.id === row.id ? finalRow : r) })
    if (finalRow.serial) {
      if (finalRow.inputMode === 'manual') {
        getDb().schema('production').from('bag_tags').upsert({
          serial_number: finalRow.serial, section_id: sectionId, session_id: null,
          product_type: finalRow.productType, variant: variantWord || null,
          weight_kg: n(finalRow.weight) || null, lot_number: finalRow.lot || null,
          status: 'consumed', consumed_at_section: sectionId,
          location_updated_at: t,
        } as any, { onConflict: 'serial_number' }).catch(() => {})
      }
      markBagConsumed(finalRow.serial, sectionId, null, n(finalRow.weight) || undefined, operatorId ?? null)
    }
    setBagModal(null)
  }

  function removeInput(id: string) { patch({ inputs: value.inputs.filter(r => r.id !== id) }) }

  // ── Output bag helpers ─────────────────────────────────────────────────────

  async function addOutputBag(weight: string) {
    if (n(weight) <= 0) return
    const serial = await genBlendSerial()
    const now = nowISO()
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

  const { totalIn, totalOut, balance, byItem } = blenderTotals(value)
  const withinTol = Math.abs(balance) <= MASS_BALANCE_TOLERANCE_KG
  const inputCount = value.inputs.length
  const outputCount = value.outputs.length

  return (
    <div className="space-y-4">
      {/* Blend picker — owned by this production, not the shift assignment, so
          switching blends mid-shift never needs a supervisor round-trip. Locked
          once any weight has been captured for this production; start a new
          batch record (existing "+" affordance above) to run a different blend. */}
      <div className="bg-white border border-stone-200 rounded-2xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Shuffle size={13} className="text-stone-400" />
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Blend for this batch</span>
        </div>
        {blendLocked ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-50 border border-stone-200">
            <Lock size={13} className="text-stone-400 shrink-0" />
            <span className="font-mono text-[13px] font-semibold text-text">{bomId ?? '—'}</span>
            <span className="text-[11px] text-stone-400 ml-auto">Locked — start a new batch record to run a different blend</span>
          </div>
        ) : !variantWord ? (
          <p className="text-[12px] text-stone-400 px-1">Pick a variant above first.</p>
        ) : (
          <BlendCodePicker variant={variantWord} workCentre={workCentre} selected={bomId ? [bomId] : []}
            onSelect={id => patch({ bomId: id })} />
        )}
      </div>

      {!bomId ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <AlertTriangle size={22} className="text-amber-500" />
          <p className="text-[14px] font-medium text-text">Pick a blend code above to start</p>
          <p className="text-[12px] text-text-muted max-w-sm">Capture opens once a blend is chosen — only that blend's ingredients will be shown.</p>
        </div>
      ) : (
        <>
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
                Blend <strong className="font-mono">{bomId}</strong> — only its ingredients are shown below.
                Each is colour-coded; tap "+ Add debagging bag" to scan, look up, or enter one.
              </p>

              {allGroups.map((g, gi) => {
                const rows = value.inputs.filter(r => r.itemKey === g.key)
                const kg = byItem[g.key] ?? 0
                const pct = totalIn > 0 ? (kg / totalIn) * 100 : 0
                const isExtra = extraGroups.some(e => e.key === g.key)
                const groupColor = colorForGroupIndex(gi)
                return (
                  <div key={g.key} className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: groupColor }}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: groupColor }} />
                        {g.label}
                        {isExtra && <span className="text-[9px] font-semibold uppercase tracking-wide text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full">not in recipe</span>}
                      </span>
                      <span className="text-[11px] font-mono text-stone-500">
                        {kg.toFixed(1)} kg · {pct.toFixed(0)}%
                        {!isExtra && <span className="text-stone-300"> / target {(g.targetPct * 100).toFixed(0)}%</span>}
                      </span>
                    </div>

                    {rows.length === 0 ? (
                      <p className="text-[11px] text-stone-400 px-1 italic">No bags logged yet.</p>
                    ) : rows.map((r, i) => {
                      const incomplete = !r.serial.trim() || n(r.weight) <= 0 || (g.hasLot && !isValidLot(r.lot))
                      return (
                        <button key={r.id} onClick={() => !locked && setBagModal({ editing: r })}
                          className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 border text-left transition-opacity hover:opacity-90"
                          style={{ background: groupColor + '0d', borderColor: groupColor + '40' }}>
                          {incomplete ? <AlertTriangle size={15} className="shrink-0 text-amber-500" /> : <Lock size={15} className="shrink-0" style={{ color: groupColor }} />}
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-text">
                              Bag {i + 1} · {r.productType || 'Input bag'} · {n(r.weight).toFixed(1)} kg
                              {incomplete && <span className="ml-1.5 text-[11px] font-normal text-amber-600">— needs details</span>}
                            </div>
                            <div className="font-mono text-[11px] text-text-muted truncate">
                              {[r.serial, r.variant, r.destination, r.lot].filter(Boolean).join(' · ')}
                              {r.logged_at ? ` · logged ${fmtTime(r.logged_at)}` : ''}
                              {r.inputMode === 'system' ? ' · from system' : r.inputMode === 'manual' && r.notInSystem ? ' · registered' : ''}
                              {r.productType && r.productType !== g.label ? ` · substituted for ${g.label}` : ''}
                            </div>
                          </div>
                          {!locked && <Pencil size={13} className="shrink-0 text-stone-400" />}
                        </button>
                      )
                    })}
                  </div>
                )
              })}

              {!locked && (
                <button onClick={() => setBagModal({ editing: null })}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-[13px] font-semibold transition-colors"
                  style={{ borderColor: DEBAG_COLOR + '50', color: DEBAG_COLOR }}>
                  <Plus size={16} /> Add debagging bag
                </button>
              )}

              {/* A material not part of the blend's declared recipe — deliberately a
                  separate action from the button above, not folded into its dropdown. */}
              {!locked && (addingOther ? (
                <div className="space-y-2 p-3 rounded-2xl border-2 border-dashed border-stone-300">
                  <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide px-1">Add a material not in this blend's recipe</p>
                  <ItemPicker items={items} placeholder="Search Master Inventory…" onPick={addOtherMaterial} className={INP} />
                  <button onClick={() => setAddingOther(false)} className="text-[12px] text-stone-400 hover:text-text px-1">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setAddingOther(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors">
                  <Plus size={15} /> Add Other — search Master Inventory
                </button>
              ))}

              <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
                <span className="text-[12px] font-medium opacity-80">Total — raw material mixed in (I)</span>
                <span className="font-mono font-bold text-[16px]">{totalIn.toFixed(1)} kg</span>
              </div>

              {bagModal && (
                <AddBagModal
                  groups={allGroups} colorFor={key => colorForGroupIndex(allGroups.findIndex(g => g.key === key))}
                  variantWord={variantWord} existingInputs={value.inputs} editingRow={bagModal.editing}
                  onClose={() => setBagModal(null)} onSave={commitBagFromModal}
                  onDelete={bagModal.editing ? () => { removeInput(bagModal.editing!.id); setBagModal(null) } : undefined}
                />
              )}
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
              {allGroups.length > 0 && (
                <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
                  <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Blend component ratio — target vs actual</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {allGroups.map(g => {
                      const kg = byItem[g.key] ?? 0
                      const actualPct = totalIn > 0 ? (kg / totalIn) * 100 : 0
                      const targetPct = g.targetPct * 100
                      const off = Math.abs(actualPct - targetPct) > 5
                      return (
                        <div key={g.key} className={`flex justify-between px-3 py-2 rounded-lg border text-[11px] ${off ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-100'}`}>
                          <span className="text-stone-600 truncate pr-2">{g.label}</span>
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
        </>
      )}
    </div>
  )
}

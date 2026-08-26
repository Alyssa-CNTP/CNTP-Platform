'use client'

// components/production/capture/HalfBagTopUpModal.tsx
//
// Half-bag top-up: an operator adds material to a bag they already have —
// typically a half-filled bag left open from a previous shift/day. The
// extra material has two possible origins, picked as a step-2 choice:
//
//   - "From today's production" (the common case, and the default): fresh
//     debagged/produced material that hasn't been bagged anywhere yet goes
//     straight into the existing bag instead of starting a new one. There
//     is no source BAG here — logged as a plain 'bagging_out' scan_events
//     row (addFreshWeightToBag) so it counts toward today's output the
//     same way a brand-new bag would.
//   - "From another bag" (rare — e.g. consolidating two half-bags): names
//     the existing bag the material is actually coming from. Logged as a
//     linked topped_up/drawn_down pair (transferBagWeight) that must NEVER
//     count as new output — that kg was already counted whenever the
//     source bag was first bagged.
//
// Neither path creates a brand-new bag or registers untracked/legacy stock
// — those are warehouse-management functions, out of scope for the
// operator-facing flow here, for later.
//
// The target bag (and the source, in "from another bag" mode) shows its
// current weight, its ORIGINAL bagging date/weight (recovered from its
// earliest scan_events row — bag_tags.weight_kg is overwritten in place on
// every top-up, so it can't tell you what a bag started at), and its full
// scan_events history, before the operator confirms and prints.
//
// The target's label is always force-reprinted on submit — its printed
// label is now stale the instant its weight changes. In "from another bag"
// mode the source is force-reprinted too (skipped only if it was fully
// drained and voided).
//
// This modal NEVER touches a capture session's draft_data/value.outputs —
// mass balance is computed from that local array on a completely separate
// write path from bag_tags, so wiring a top-up into it would double-count
// its weight there. Every write here is a pure, side-channel DB call,
// exactly like the Tags page's original top-up flow this generalizes. A
// "from today's production" top-up's kg is picked up in Production Orders'
// totals via its scan_events row directly (see order-detail.ts), since the
// target bag's own bag_tags.session_id is whatever day it was first bagged,
// not today.

import { useEffect, useState } from 'react'
import { X, Search, Loader2, AlertTriangle, ArrowRight, Printer, History, Target } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sanitizeSerial, transferBagWeight, addFreshWeightToBag, originalBagEvent, setBagTargetWeight, fetchTopUpEventsForSerials, type TopUpEvent } from '@/lib/production/scan-utils'
import { printLabelAuto, buildLabelHtml } from '@/lib/production/label-print'
import { expectedBagWeightFor, isUnusuallyHeavyBag, MAX_BAG_WEIGHT_KG, GRADE_TO_LOCAL_EXPORT, sectionMeta, VARIANT_OPTIONS } from '@/lib/production/capture-config'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import { LEAF, debaggedBags, type DebaggedBagOption } from '@/lib/production/inventory'

const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

interface RebagBag {
  serial_number: string
  product_type: string
  acumatica_id: string | null
  variant: string | null
  weight_kg: number
  lot_number: string | null
  destination: string | null
  status: string
  consumed_at_section: string | null
  created_at: string
  is_open: boolean
  target_weight_kg: number | null
}

type BagLookup = RebagBag | null | 'loading' | 'not_found'

interface HistoryRow { action: string; weight_kg: number | null; related_serial_number: string | null; scanned_at: string }

async function loadHistory(serial: string): Promise<HistoryRow[]> {
  const { data } = await getDb().schema('production').from('scan_events')
    .select('action, weight_kg, related_serial_number, scanned_at')
    .eq('serial_number', serial).order('scanned_at', { ascending: true })
  return (data as any) ?? []
}

// Debounced fresh lookup by serial — always a live query, never served from a
// local cache, since bag availability is safety-critical.
function useBagLookup(rawInput: string, excludeSerial?: string) {
  const [bag, setBag] = useState<BagLookup>(null)
  useEffect(() => {
    const s = sanitizeSerial(rawInput)
    if (!s) { setBag(null); return }
    if (excludeSerial && s === sanitizeSerial(excludeSerial)) { setBag('not_found'); return }
    setBag('loading')
    const t = setTimeout(async () => {
      const { data } = await getDb().schema('production').from('bag_tags')
        .select('*').eq('serial_number', s).limit(1).maybeSingle()
      setBag((data as any) ?? 'not_found')
    }, 150)
    return () => clearTimeout(t)
  }, [rawInput, excludeSerial])
  return bag
}

function found(b: BagLookup): RebagBag | null {
  return b && b !== 'loading' && b !== 'not_found' ? b : null
}

// Narrowing by variant (+ optional product type) to see an actual preview of
// matching in-stock bags instead of requiring a known serial. onlyOpen
// defaults the bag-being-topped-up search to bags actually left open for
// exactly this — a "half bag from yesterday" IS an is_open bag by
// definition — while still letting the operator switch it off to see
// everything in stock.
function useBagBrowse(variant: string, productType: string, onlyOpen: boolean) {
  const [browsing, setBrowsing] = useState(false)
  const [results, setResults] = useState<{ serial_number: string; product_type: string; weight_kg: number; created_at: string; is_open: boolean }[]>([])
  useEffect(() => {
    if (!variant) { setResults([]); return }
    setBrowsing(true)
    const t = setTimeout(async () => {
      let q = getDb().schema('production').from('bag_tags')
        .select('serial_number, product_type, weight_kg, created_at, is_open')
        .eq('status', 'in_stock').eq('variant', variant)
      if (onlyOpen) q = q.eq('is_open', true)
      if (productType.trim()) q = q.ilike('product_type', `%${productType.trim()}%`)
      const { data } = await q.order('created_at', { ascending: false }).limit(20)
      setResults((data as any) ?? [])
      setBrowsing(false)
    }, 200)
    return () => clearTimeout(t)
  }, [variant, productType, onlyOpen])
  return { browsing, results }
}

interface HalfBagTopUpModalProps {
  sectionId: string
  sessionId: string | null
  operatorId: string | null
  date: string    // this session's production day — shown so the operator
                   // can confirm which day's Production Order the "from
                   // today's production" path will actually be counted in
  shift: string
  onDone: () => void
  onClose: () => void
}

export function HalfBagTopUpModal({ sectionId, sessionId, operatorId, date, shift, onDone, onClose }: HalfBagTopUpModalProps) {
  const sectionName = sectionMeta(sectionId).name
  const [step, setStep] = useState<'target' | 'source' | 'confirm'>('target')

  // The bag being topped up is always picked FIRST — that's the one the
  // operator is actually focused on ("this half bag needs more").
  const [targetInput, setTargetInput] = useState('')
  const targetBag = useBagLookup(targetInput)
  const target = found(targetBag)
  const targetVoided = target?.status === 'voided'
  const targetConsumed = Boolean(target?.consumed_at_section)
  const [targetOriginal, setTargetOriginal] = useState<{ weight_kg: number } | null>(null)
  const [targetHistory, setTargetHistory] = useState<HistoryRow[]>([])
  const [targetTopUps, setTargetTopUps] = useState<TopUpEvent[]>([])

  // The bag's declared target weight — separate from targetInput's own
  // useBagLookup result so the "pre-print" panel below can update it
  // instantly on save without waiting for a fresh debounced lookup.
  const [targetWeightKg, setTargetWeightKgState] = useState<number | null>(null)
  useEffect(() => { setTargetWeightKgState(target?.target_weight_kg ?? null) }, [target?.serial_number, target?.target_weight_kg])

  // "Pre-print" — a standalone action, separate from actually adding
  // weight: declares the final weight this bag should reach and prints a
  // tag showing it, so whoever fills the bag later knows how much more to
  // add. Does not advance the step or touch the top-up amount below.
  const [targetWeightDraft, setTargetWeightDraft] = useState('')
  useEffect(() => { setTargetWeightDraft(target?.target_weight_kg != null ? String(target.target_weight_kg) : '') }, [target?.serial_number])
  const [preprintSaving, setPreprintSaving] = useState(false)
  const [preprintError, setPreprintError] = useState<string | null>(null)
  const [preprintDone, setPreprintDone] = useState(false)

  const [targetBrowseVariant, setTargetBrowseVariant] = useState('')
  const [targetBrowseProductType, setTargetBrowseProductType] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const targetBrowse = useBagBrowse(targetBrowseVariant, targetBrowseProductType, onlyOpen)

  // Where the extra material comes from — picked second. "production" is
  // the common case (today's own debagged/produced material, no source bag
  // at all — mainly Sieving Tower); "existing" names another tracked bag to
  // draw from (mainly Blender, e.g. consolidating two half-bags).
  const [sourceMode, setSourceMode] = useState<'production' | 'existing'>('production')

  // Batch of what's actually going in from today's production — required
  // for Fine/Coarse Leaf only (same batch-must-be-debagged rule ordinary
  // bagging enforces) — not just a batch NUMBER but the actual debagged BAG
  // (production.prod_debagging row): more than one physical intake bag can
  // share a batch, or different batches can be running close together, so
  // the operator confirms exactly which debagging bag this addition is
  // credited to. Restricted to the TARGET bag's own variant+grade
  // (family-matched — RA-CON counts as CON, RA-ORG as ORG — see
  // debaggedBags). Irrelevant in "existing" mode: there the batch's
  // identity already comes from the source bag itself.
  const [selectedDebag, setSelectedDebag] = useState<DebaggedBagOption | null>(null)
  const [debagOptions, setDebagOptions] = useState<DebaggedBagOption[]>([])
  const targetNeedsBatch = sourceMode === 'production' && !!target && LEAF.has(target.product_type)
  useEffect(() => {
    setSelectedDebag(null)
    if (!targetNeedsBatch || !target) { setDebagOptions([]); return }
    debaggedBags(sectionId, target.variant ?? '', GRADE_TO_LOCAL_EXPORT[target.destination ?? 'A'] ?? 'Export')
      .then(setDebagOptions)
  }, [targetNeedsBatch, target?.variant, target?.destination, sectionId])

  // Excluded from matching the target so a bag can't top itself up.
  const [sourceInput, setSourceInput] = useState('')
  const sourceBag = useBagLookup(sourceInput, target?.serial_number)
  const source = found(sourceBag)
  const sourceVoided = source?.status === 'voided'
  const sourceConsumed = Boolean(source?.consumed_at_section)
  const [sourceOriginal, setSourceOriginal] = useState<{ weight_kg: number } | null>(null)
  const [sourceHistory, setSourceHistory] = useState<HistoryRow[]>([])

  const [sourceBrowseVariant, setSourceBrowseVariant] = useState('')
  const [sourceBrowseProductType, setSourceBrowseProductType] = useState('')
  const sourceBrowse = useBagBrowse(sourceBrowseVariant, sourceBrowseProductType, false)

  const [amount, setAmount] = useState('')
  const [closeTargetBag, setCloseTargetBag] = useState(false)
  // Only used when the source and target hold different products — what the
  // combined bag should actually be recorded as afterward. Defaults to the
  // source's product (what's physically being poured in) once both bags are
  // known, but stays editable.
  const [targetProductType, setTargetProductType] = useState('')
  const [confirmHeavy, setConfirmHeavy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Original bagging date/weight + full history for each bag — fetched once
  // found, shown on the confirm screen.
  useEffect(() => {
    if (!target) { setTargetOriginal(null); setTargetHistory([]); setTargetTopUps([]); return }
    originalBagEvent(target.serial_number).then(ev => setTargetOriginal(ev ? { weight_kg: ev.weight_kg } : null))
    loadHistory(target.serial_number).then(setTargetHistory)
    fetchTopUpEventsForSerials([target.serial_number]).then(m => setTargetTopUps(m.get(target.serial_number) ?? []))
  }, [target?.serial_number])
  useEffect(() => {
    if (!source) { setSourceOriginal(null); setSourceHistory([]); return }
    originalBagEvent(source.serial_number).then(ev => setSourceOriginal(ev ? { weight_kg: ev.weight_kg } : null))
    loadHistory(source.serial_number).then(setSourceHistory)
  }, [source?.serial_number])
  useEffect(() => { setTargetProductType(source?.product_type ?? '') }, [target?.serial_number, source?.serial_number])

  // "Source" (an existing bag drawn from) only exists in 'existing' mode —
  // in 'production' mode there's no source cap, no cross-product concept
  // (you're filling the target with more of what it already holds).
  const sourceKg = sourceMode === 'existing' ? (source?.weight_kg ?? 0) : 0
  const amountKg = n(amount) || 0
  const exceedsSource = sourceMode === 'existing' && amountKg > sourceKg
  const sourceRemaining = sourceMode === 'existing' && source ? sourceKg - amountKg : 0
  const newTotal = target ? (target.weight_kg ?? 0) + amountKg : 0
  const overCap = newTotal > MAX_BAG_WEIGHT_KG
  const unusual = amountKg > 0 && !overCap && !!target && isUnusuallyHeavyBag(target.product_type, newTotal)
  const standard = target ? expectedBagWeightFor(target.product_type) : null

  const productMismatch = sourceMode === 'existing' && !!source && !!target
    && source.product_type.toLowerCase() !== target.product_type.toLowerCase()

  // ── Pre-print target-weight panel — a standalone action available as
  // soon as a target bag is picked, independent of amountKg/sourceMode
  // below. Only ever raises the target above what's currently in the bag.
  const targetWeightDraftKg = n(targetWeightDraft) || 0
  const targetWeightValid = !!target && targetWeightDraftKg > (target.weight_kg ?? 0) && targetWeightDraftKg <= MAX_BAG_WEIGHT_KG
  const targetStillNeeded = target ? Math.max(0, targetWeightDraftKg - (target.weight_kg ?? 0)) : 0

  async function savePreprintTarget() {
    if (!target || !targetWeightValid) return
    setPreprintSaving(true); setPreprintError(null); setPreprintDone(false)
    try {
      await setBagTargetWeight(target.serial_number, targetWeightDraftKg)
      setTargetWeightKgState(targetWeightDraftKg)
      const preprintBag: any = {
        id: target.serial_number, serial_number: target.serial_number, product_type: target.product_type,
        variant: target.variant || 'Conventional', grade: (target.destination as any) || 'A',
        weight_kg: target.weight_kg ?? 0, lot_number: target.lot_number || '', section_id: sectionId,
        section_name: sectionName, created_at: target.created_at, printed: true,
        acumaticaId: target.acumatica_id ?? undefined,
        targetWeightKg: targetWeightDraftKg,
        originalWeightKg: targetOriginal?.weight_kg,
        topUps: targetTopUps.map(t => ({ kg: t.kg, at: t.at })),
      }
      await printLabelAuto(preprintBag)
      setPreprintDone(true)
    } catch {
      setPreprintError('Could not save the target weight — check the connection and try again.')
    } finally {
      setPreprintSaving(false)
    }
  }

  async function clearPreprintTarget() {
    if (!target) return
    setPreprintSaving(true); setPreprintError(null)
    try {
      await setBagTargetWeight(target.serial_number, null)
      setTargetWeightKgState(null)
      setTargetWeightDraft('')
      setPreprintDone(false)
    } catch {
      setPreprintError('Could not clear the target weight — check the connection and try again.')
    } finally {
      setPreprintSaving(false)
    }
  }

  const canSubmit = sourceMode === 'production'
    ? (!!target && !targetVoided && !targetConsumed && amountKg > 0 && !overCap && !(unusual && !confirmHeavy)
        && !(targetNeedsBatch && !selectedDebag))
    : (!!source && !!target && !sourceVoided && !sourceConsumed && !targetVoided && !targetConsumed
        && amountKg > 0 && !exceedsSource && !overCap && !(unusual && !confirmHeavy)
        && !(productMismatch && !targetProductType.trim()))

  // The exact bag records that will be (re)printed — built once here and
  // reused for both the actual print call and the preview below, so the
  // preview can never drift from what submit() actually sends.
  const resolvedProductType = sourceMode === 'existing' && productMismatch
    ? targetProductType.trim() : (target?.product_type ?? '')
  // The addition in progress isn't in scan_events yet at preview/print
  // time — appended here so the label (and its preview) reflects it
  // immediately, same total either way once submit() actually writes it.
  const targetTopUpsForLabel = amountKg > 0
    ? [...targetTopUps.map(t => ({ kg: t.kg, at: t.at })), { kg: amountKg, at: new Date().toISOString() }]
    : targetTopUps.map(t => ({ kg: t.kg, at: t.at }))
  const targetLabelBag = target ? {
    id: target.serial_number, serial_number: target.serial_number, product_type: resolvedProductType,
    variant: target.variant || 'Conventional', grade: (target.destination as any) || 'A',
    weight_kg: newTotal, lot_number: target.lot_number || '', section_id: sectionId,
    section_name: sectionName, created_at: target.created_at, printed: true,
    acumaticaId: target.acumatica_id ?? undefined,
    targetWeightKg: targetWeightKg ?? undefined,
    originalWeightKg: targetOriginal?.weight_kg,
    topUps: targetTopUpsForLabel,
  } as any : null
  const sourceLabelBag = (sourceMode === 'existing' && source && sourceRemaining > 0) ? {
    id: source.serial_number, serial_number: source.serial_number, product_type: source.product_type,
    variant: source.variant || 'Conventional', grade: (source.destination as any) || 'A',
    weight_kg: sourceRemaining, lot_number: source.lot_number || '', section_id: sectionId,
    section_name: sectionName, created_at: source.created_at, printed: true,
    acumaticaId: source.acumatica_id ?? undefined,
  } as any : null

  async function submit() {
    if (!canSubmit || !target || !targetLabelBag) return
    setSaving(true); setError(null)
    try {
      if (sourceMode === 'production') {
        const batchNote = selectedDebag
          ? `${selectedDebag.lotNumber ?? '—'} (debag #${selectedDebag.bagNo})`
          : undefined
        await addFreshWeightToBag(
          target.serial_number, target.weight_kg ?? 0,
          amountKg, sectionId, sessionId, operatorId, closeTargetBag,
          targetNeedsBatch ? batchNote : undefined,
        )
        // The label is now stale — forced reprint.
        await printLabelAuto(targetLabelBag)
      } else {
        if (!source) return
        await transferBagWeight(
          source.serial_number, sourceKg,
          target.serial_number, target.weight_kg ?? 0,
          amountKg, sectionId, sessionId, operatorId, closeTargetBag,
          productMismatch ? resolvedProductType : undefined,
        )
        // Both labels are now stale — forced reprint, no choice, for both.
        await printLabelAuto(targetLabelBag)
        if (sourceLabelBag) await printLabelAuto(sourceLabelBag)
      }
      onDone(); onClose()
    } catch {
      setError('Could not save the top-up — check the connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  function renderBrowseAndLookup(opts: {
    browseVariant: string; setBrowseVariant: (v: string) => void
    browseProductType: string; setBrowseProductType: (v: string) => void
    browsing: boolean; results: { serial_number: string; product_type: string; weight_kg: number; created_at: string; is_open: boolean }[]
    input: string; setInput: (v: string) => void
    placeholder: string
    onlyOpenToggle?: boolean
  }) {
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <select value={opts.browseVariant} onChange={e => opts.setBrowseVariant(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600">
            <option value="">Browse by variant…</option>
            {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
          <input type="text" value={opts.browseProductType} onChange={e => opts.setBrowseProductType(e.target.value)}
            placeholder="Product type (optional)" className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
        </div>
        {opts.onlyOpenToggle && (
          <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
            <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} className="rounded" />
            Only show open (half) bags
          </label>
        )}
        {opts.browseVariant && opts.browsing && <p className="text-[12px] text-text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Looking…</p>}
        {opts.browseVariant && !opts.browsing && opts.results.length === 0 && <p className="text-[12px] text-text-muted">No matching in-stock bags.</p>}
        {opts.results.length > 0 && (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 max-h-[160px] overflow-y-auto">
            {opts.results.map(r => (
              <li key={r.serial_number}>
                <button onClick={() => opts.setInput(r.serial_number)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-50">
                  <span className="font-mono text-[12px] text-text flex-1 min-w-0 truncate">{r.serial_number}</span>
                  {r.is_open && <span className="text-[9px] font-semibold uppercase tracking-wide text-violet-600 shrink-0">Open</span>}
                  <span className="text-[11px] text-text-muted truncate">{r.product_type}</span>
                  <span className="font-mono text-[11px] text-text-muted shrink-0">{r.weight_kg}kg</span>
                  <span className="text-[10px] text-text-faint shrink-0">{new Date(r.created_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
          <Search size={16} className="text-stone-400" />
          <input value={opts.input} autoCapitalize="characters"
            onChange={e => opts.setInput(e.target.value.toUpperCase())}
            placeholder={opts.placeholder} className="flex-1 py-2.5 text-[14px] outline-none bg-transparent font-mono" />
        </div>
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100 sticky top-0 bg-white">
          <span className="font-semibold text-[15px] text-text flex-1">Half-bag top-up</span>
          <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {step === 'target' && (
            <>
              <p className="text-[12px] text-text-muted">Which bag are you topping up? Usually a half bag left open from a previous shift.</p>
              {renderBrowseAndLookup({
                browseVariant: targetBrowseVariant, setBrowseVariant: setTargetBrowseVariant,
                browseProductType: targetBrowseProductType, setBrowseProductType: setTargetBrowseProductType,
                browsing: targetBrowse.browsing, results: targetBrowse.results,
                input: targetInput, setInput: setTargetInput,
                placeholder: 'Bag serial…', onlyOpenToggle: true,
              })}
              {targetBag === 'loading' && <p className="text-[12px] text-text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Looking up…</p>}
              {targetBag === 'not_found' && <p className="text-[12px] text-err">Serial not found.</p>}
              {target && targetVoided && <p className="text-[12px] text-err">That bag has already been voided.</p>}
              {target && targetConsumed && <p className="text-[12px] text-err">That bag was already consumed downstream.</p>}
              {target && !targetVoided && !targetConsumed && (
                <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-text">{target.serial_number}</span>
                    <span className="text-text-muted">{target.product_type}{target.variant ? ` · ${target.variant}` : ''}</span>
                  </div>
                  <div className="text-text-muted">{(target.weight_kg ?? 0).toFixed(1)}kg currently in stock{target.is_open ? ' · open' : ''}</div>
                  {targetWeightKg != null && (
                    <div className="flex items-center gap-1.5 text-violet-700"><Target size={11} /> Target set: {targetWeightKg.toFixed(1)}kg</div>
                  )}
                </div>
              )}

              {target && !targetVoided && !targetConsumed && (
                <div className="rounded-xl border border-dashed border-stone-300 px-3 py-2.5 space-y-2">
                  <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest flex items-center gap-1.5"><Target size={12} /> Pre-print a target-weight tag (optional)</p>
                  <p className="text-[11px] text-text-muted">Not a top-up — this only prints a tag showing the final weight this bag should reach, so whoever fills it later knows how much more to add. Do this now, or skip straight to adding weight below.</p>
                  <div className="flex items-center gap-2">
                    <input type="text" inputMode="decimal" value={targetWeightDraft}
                      onChange={e => { setTargetWeightDraft(e.target.value); setPreprintDone(false) }}
                      placeholder="Target weight (kg)"
                      className="flex-1 px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                    {targetWeightKg != null && (
                      <button onClick={clearPreprintTarget} disabled={preprintSaving} className="text-[11px] text-text-muted underline shrink-0 disabled:opacity-40">Clear</button>
                    )}
                  </div>
                  {targetWeightDraft && !targetWeightValid && (
                    <p className="text-[11px] text-err">Must be more than the current {(target.weight_kg ?? 0).toFixed(1)}kg{targetWeightDraftKg > MAX_BAG_WEIGHT_KG ? ` and under ${MAX_BAG_WEIGHT_KG}kg` : ''}.</p>
                  )}
                  {targetWeightValid && (
                    <p className="text-[11px] text-stone-500">Needs <span className="font-mono text-text">+{targetStillNeeded.toFixed(1)}kg</span> more to reach {targetWeightDraftKg.toFixed(1)}kg.</p>
                  )}
                  {preprintError && <p className="text-[11px] text-err">{preprintError}</p>}
                  {preprintDone && <p className="text-[11px] text-emerald-700">Target saved — tag printed.</p>}
                  <button onClick={savePreprintTarget} disabled={!targetWeightValid || preprintSaving}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-violet-600 text-violet-700 text-[13px] font-medium disabled:opacity-40">
                    {preprintSaving ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                    {preprintSaving ? 'Saving…' : 'Save target & print tag'}
                  </button>
                </div>
              )}

              <button onClick={() => setStep('source')} disabled={!target || targetVoided || targetConsumed}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                Next <ArrowRight size={15} />
              </button>
            </>
          )}

          {step === 'source' && target && (
            <>
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-[12.5px] flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold text-violet-500 uppercase tracking-widest">Topping up</div>
                  <div className="text-text"><span className="font-mono">{target.serial_number}</span> <span className="text-text-muted">· {target.product_type}{target.variant ? ` · ${target.variant}` : ''} · {(target.weight_kg ?? 0).toFixed(1)}kg</span></div>
                </div>
                <button onClick={() => setStep('target')} className="text-[11px] font-medium text-violet-700 underline shrink-0">Change</button>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setSourceMode('production')}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium border ${sourceMode === 'production' ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-stone-200 text-text-muted'}`}>
                  From today's production
                </button>
                <button onClick={() => setSourceMode('existing')}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium border ${sourceMode === 'existing' ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-stone-200 text-text-muted'}`}>
                  From another bag
                </button>
              </div>

              {sourceMode === 'production' ? (
                <>
                  <p className="text-[11px] text-text-muted">Fresh material from today's debagging/production, going straight into this bag — same variant as the bag ({target.variant || 'unset'}), no separate source bag needed.</p>
                  {targetNeedsBatch && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Which debagged bag is this from? <span className="text-err">*</span></label>
                      <p className="text-[11px] text-text-muted">Confirm the specific intake bag — more than one can share a batch, or different batches can be running close together.</p>
                      {debagOptions.length === 0 ? (
                        <p className="text-[12px] text-text-muted italic py-2">No bags debagged yet under {target.variant || 'this variant'} — debag one first.</p>
                      ) : (
                        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 max-h-[180px] overflow-y-auto">
                          {debagOptions.map(d => (
                            <li key={d.id}>
                              <button onClick={() => setSelectedDebag(d)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left ${selectedDebag?.id === d.id ? 'bg-violet-50' : 'hover:bg-stone-50'}`}>
                                <span className={`font-mono text-[11px] shrink-0 ${selectedDebag?.id === d.id ? 'text-violet-700 font-semibold' : 'text-text-faint'}`}>#{d.bagNo}</span>
                                <span className="font-mono text-[12px] text-text flex-1 min-w-0 truncate">{d.lotNumber || '—'}</span>
                                <span className="font-mono text-[11px] text-text-muted shrink-0">{d.kgNett.toFixed(1)}kg</span>
                                <span className="text-[10px] text-text-faint shrink-0">{d.deliveryDate ? new Date(d.deliveryDate).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '—'}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {selectedDebag && (
                        <p className="text-[11px] text-violet-700">Confirmed — filling up from debag #{selectedDebag.bagNo} · {selectedDebag.lotNumber || '—'}.</p>
                      )}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Amount to add (kg)</label>
                    <input autoFocus type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] outline-none focus:border-violet-600" />
                  </div>
                  <p className="text-[11px] text-stone-400">Will show as today's output on the {date} · {shift} Production Order.</p>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-text-muted">Which existing bag is it coming out of?</p>
                  {renderBrowseAndLookup({
                    browseVariant: sourceBrowseVariant, setBrowseVariant: setSourceBrowseVariant,
                    browseProductType: sourceBrowseProductType, setBrowseProductType: setSourceBrowseProductType,
                    browsing: sourceBrowse.browsing, results: sourceBrowse.results,
                    input: sourceInput, setInput: setSourceInput,
                    placeholder: 'Source bag serial…',
                  })}
                  {sourceBag === 'loading' && <p className="text-[12px] text-text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Looking up…</p>}
                  {sourceBag === 'not_found' && <p className="text-[12px] text-err">{sourceInput && sanitizeSerial(sourceInput) === sanitizeSerial(target.serial_number) ? "A bag can't top itself up." : 'Serial not found.'}</p>}
                  {source && sourceVoided && <p className="text-[12px] text-err">That bag has already been voided.</p>}
                  {source && sourceConsumed && <p className="text-[12px] text-err">That bag was already consumed downstream.</p>}
                  {source && !sourceVoided && !sourceConsumed && (
                    <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-text">{source.serial_number}</span>
                        <span className="text-text-muted">{source.product_type}</span>
                      </div>
                      <div className="text-text-muted">{sourceKg.toFixed(1)}kg currently in stock</div>
                      {productMismatch && (
                        <p className="text-amber-700 flex items-center gap-1.5"><AlertTriangle size={12} /> Different product to the bag being topped up — pick what the combined bag actually is below.</p>
                      )}
                    </div>
                  )}
                  {source && !sourceVoided && !sourceConsumed && (
                    <>
                      {productMismatch && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Resulting product type <span className="text-err">*</span></label>
                          <input list="topup-product-types" value={targetProductType}
                            onChange={e => setTargetProductType(e.target.value)}
                            placeholder="Type or pick a product…"
                            className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-violet-600 ${targetProductType.trim() ? 'border-stone-200' : 'border-amber-300'}`} />
                          <datalist id="topup-product-types">
                            {Array.from(new Set([
                              source.product_type, target.product_type,
                              ...(SECTION_CONFIG[sectionId]?.outputTypes ?? []),
                            ].filter(Boolean) as string[])).map(t => <option key={t} value={t} />)}
                          </datalist>
                          {!targetProductType.trim() && <p className="text-[11px] text-err">Required — what's actually in the bag once this is done.</p>}
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Amount to add (kg)</label>
                        <input autoFocus type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] outline-none focus:border-violet-600" />
                        {exceedsSource && <p className="text-[11px] text-err">Can't move more than the {sourceKg.toFixed(1)}kg the source has.</p>}
                      </div>
                    </>
                  )}
                </>
              )}

              <button onClick={() => setStep('confirm')}
                disabled={sourceMode === 'production'
                  ? (!target || amountKg <= 0 || (targetNeedsBatch && !selectedDebag))
                  : (!source || sourceVoided || sourceConsumed || amountKg <= 0 || exceedsSource || (productMismatch && !targetProductType.trim()))}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                Next <ArrowRight size={15} />
              </button>
            </>
          )}

          {step === 'confirm' && target && (sourceMode === 'production' || source) && (
            <>
              <div className="space-y-2">
                <BagHistoryCard title="Topping up" bag={target} original={targetOriginal} history={targetHistory} />
                {sourceMode === 'existing' && source && (
                  <BagHistoryCard title="Coming from" bag={source} original={sourceOriginal} history={sourceHistory} />
                )}
              </div>

              <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1.5">
                <Row label="Amount added" value={`${amountKg.toFixed(1)} kg`} />
                {sourceMode === 'production'
                  ? <Row label="Source" value="Today's production" />
                  : <Row label="Source remaining" value={`${sourceRemaining.toFixed(1)} kg${sourceRemaining <= 0 ? ' (voided)' : ''}`} />}
                <Row label="Target new total" value={`${newTotal.toFixed(1)} kg`} />
                {sourceMode === 'production' && targetNeedsBatch && <Row label="Debagged bag" value={selectedDebag ? `#${selectedDebag.bagNo} · ${selectedDebag.lotNumber || '—'}` : '—'} />}
                {sourceMode === 'existing' && productMismatch && <Row label="Target reclassified to" value={targetProductType.trim() || '—'} />}
                {target.lot_number && <Row label="Target batch (fixed at creation)" value={target.lot_number} />}
                {sourceMode === 'production' && <Row label="Production day" value={`${date} · ${shift}`} />}
                {targetWeightKg != null && (
                  <Row label="Target weight" value={newTotal >= targetWeightKg
                    ? `${targetWeightKg.toFixed(1)} kg (reached)`
                    : `${targetWeightKg.toFixed(1)} kg · need +${(targetWeightKg - newTotal).toFixed(1)}kg more`} />
                )}
              </div>

              {overCap && <p className="text-[12px] text-err">That's over the {MAX_BAG_WEIGHT_KG}kg safety ceiling for one bag.</p>}
              {unusual && !overCap && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1.5">
                  <p className="text-[12px] text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle size={13} /> {newTotal.toFixed(1)}kg is unusually heavy{standard ? ` for this product (standard ~${standard}kg)` : ''}.
                  </p>
                  <button onClick={() => setConfirmHeavy(true)}
                    className="text-[12px] font-medium text-amber-800 underline">Yes, continue</button>
                </div>
              )}
              {target.is_open && (
                <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
                  <input type="checkbox" checked={closeTargetBag} onChange={e => setCloseTargetBag(e.target.checked)} className="rounded" />
                  This completes the bag — mark it no longer open
                </label>
              )}

              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Label preview</p>
                {targetLabelBag && <LabelPreview bag={targetLabelBag} caption={sourceMode === 'existing' ? 'Target — reprinted' : undefined} />}
                {sourceLabelBag && <LabelPreview bag={sourceLabelBag} caption="Source — reprinted" />}
              </div>

              {error && <p className="text-[12px] text-err">{error}</p>}

              <button onClick={submit} disabled={!canSubmit || saving}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                {saving ? 'Saving…' : sourceMode === 'production' ? 'Save & print label' : 'Save & print label(s)'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Renders the exact HTML printLabelAuto would send (embed:true just drops
// the print button — there's nothing to click inside a preview), scaled
// down into a fixed-aspect box matching the label's real 100mm × 49.2mm.
function LabelPreview({ bag, caption }: { bag: any; caption?: string }) {
  const html = buildLabelHtml(bag, { embed: true })
  return (
    <div className="space-y-1">
      {caption && <p className="text-[11px] text-text-muted">{caption}</p>}
      <div className="rounded-xl border border-stone-200 overflow-hidden bg-stone-50" style={{ aspectRatio: '100 / 49.2' }}>
        <iframe srcDoc={html} title={`Label preview — ${bag.serial_number}`}
          className="w-full h-full border-0" sandbox="" />
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text tabular-nums">{value}</span>
    </div>
  )
}

function BagHistoryCard({ title, bag, original, history }: {
  title: string; bag: RebagBag; original: { weight_kg: number } | null; history: HistoryRow[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">{title}</span>
        <span className="font-mono text-text">{bag.serial_number}</span>
      </div>
      <Row label="Currently in stock" value={`${(bag.weight_kg ?? 0).toFixed(1)} kg`} />
      <Row label="Originally bagged" value={`${new Date(bag.created_at).toLocaleDateString('en-ZA')}${original ? `, ${original.weight_kg.toFixed(1)} kg` : ''}`} />
      {bag.lot_number && <Row label="Batch" value={bag.lot_number} />}
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-[11px] text-text-muted underline">
        <History size={11} /> {open ? 'Hide' : 'Show'} full history ({history.length})
      </button>
      {open && (
        <ul className="space-y-1 pt-1 border-t border-stone-100">
          {history.map((h, i) => (
            <li key={i} className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted capitalize">{h.action.replace(/_/g, ' ')}{h.related_serial_number ? ` · ${h.related_serial_number}` : ''}</span>
              <span className="font-mono text-text-faint">{h.weight_kg != null ? `${h.weight_kg}kg · ` : ''}{new Date(h.scanned_at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

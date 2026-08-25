'use client'

// components/production/capture/RebagModal.tsx
//
// Re-bagging: move weight out of an existing bag into another bag, from the
// capture page an operator is already on (not the separate Tags page). The
// target can be an EXISTING bag (identical mechanics to the Tags page's
// "Add weight" top-up, just triggered from here) or a BRAND NEW bag — the
// generalisation that makes this "re-bagging" rather than just "top-up":
// splitting a source bag's contents into a freshly bagged, possibly
// different, product type is a first-class case, not a warned edge case.
//
// Every existing bag involved (the source always; an existing target too)
// shows its current weight, its ORIGINAL bagging date/weight (recovered from
// its earliest scan_events row — bag_tags.weight_kg is overwritten in place
// on every top-up/re-bag, so it can't tell you what a bag started at), and
// its full scan_events history, before the operator confirms and prints.
//
// Printing is a safety measure, not a blanket rule: the source bag's label
// is always now-stale the moment its weight drops, so it's ALWAYS force-
// reprinted (skipped only if it was fully drained and voided). Same for an
// existing target. A brand-new target bag has no prior label — it gets the
// same "Print label" / "Write on tag" choice every other freshly bagged
// output already gets, so re-bagging a new bag doesn't add print-queue
// contention on sections that share one physical printer.
//
// This modal NEVER touches a capture session's draft_data/value.outputs —
// mass balance is computed from that local array on a completely separate
// write path from bag_tags, so wiring a re-bagged bag into it would
// double-count its weight there even after the Production Orders fix in
// lib/production/order-detail.ts (which excludes bornViaRebag rows from
// bagsOutputKg). Every write here is a pure, side-channel DB call, exactly
// like the Tags page's existing top-up flow.

import { useEffect, useState } from 'react'
import { X, Search, Loader2, AlertTriangle, ArrowRight, Printer, PenLine, History } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sanitizeSerial, transferBagWeight, createBagFromTransfer, originalBagEvent } from '@/lib/production/scan-utils'
import { printLabelAuto } from '@/lib/production/label-print'
import { expectedBagWeightFor, isUnusuallyHeavyBag, MAX_BAG_WEIGHT_KG, sectionMeta, VARIANT_OPTIONS, DESTINATION_OPTIONS, GRADE_TO_LOCAL_EXPORT } from '@/lib/production/capture-config'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import { OutputPicker, type PickedOutput } from '@/components/production/capture/OutputPicker'
import { LEAF, debaggedBatches } from '@/lib/production/inventory'

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
// local cache, since bag availability is safety-critical (same discipline as
// the Tags page's source-bag lookup this mirrors).
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

interface RebagModalProps {
  sectionId: string
  sessionId: string | null
  operatorId: string | null
  variantWord: string
  gradeLetter?: string
  genSerial: () => string
  onDone: () => void
  onClose: () => void
}

export function RebagModal({ sectionId, sessionId, operatorId, variantWord, gradeLetter, genSerial, onDone, onClose }: RebagModalProps) {
  const sectionName = sectionMeta(sectionId).name
  const [step, setStep] = useState<'intent' | 'source' | 'created' | 'target' | 'confirm' | 'newBagPrint'>('intent')

  // What the operator is actually trying to do decides which bag gets
  // picked FIRST. "source"/"target" always keep their fixed physical
  // meaning below (source = drawn from, target = received into) — intent
  // only controls step ORDER, not those roles. Without this, the modal
  // always asked "where's the material coming from" first, which reads
  // naturally for "empty this bag into another" but is actively misleading
  // for "top this bag up": an operator asked to name a source FIRST tends
  // to name the bag they actually want to top up, then gets blocked trying
  // to move more than that (now mis-cast-as-source) bag physically holds —
  // a correct safety block, for the wrong bag.
  const [intent, setIntent] = useState<'add' | 'remove' | null>(null)

  // Batch numbers actually debagged under this variant+grade — same
  // restriction normal bagging enforces (a Leaf output's batch must trace
  // back to a real lot fed in, or a typo/fabricated batch corrupts
  // traceability). debaggedBatches() covers this session's own debag rows
  // PLUS any other session's lots under the exact same variant+grade
  // (e.g. fed in on an earlier shift) — never an unrestricted list. Applies
  // only to a brand-new TARGET bag (genuine output from today's session);
  // deliberately NOT applied to registering an untracked source bag below —
  // that material predates this session by definition.
  const [sessionDebagLots, setSessionDebagLots] = useState<string[]>([])
  useEffect(() => {
    if (!variantWord) { setSessionDebagLots([]); return }
    debaggedBatches(sectionId, variantWord, GRADE_TO_LOCAL_EXPORT[gradeLetter ?? 'A'] ?? 'Export')
      .then(setSessionDebagLots)
  }, [sectionId, variantWord, gradeLetter])

  // Source can come from an EXISTING tracked bag (scan/type lookup), or —
  // since not all floor material is on the system yet during the
  // transition — get registered into the system for the first time right
  // here: a proper serial is generated, a label is printed for it (it had
  // none before), and it's logged as 'stock_count' (never 'bagging_out' —
  // this is old material entering tracking today, not fresh production, so
  // it must never count toward today's output).
  const [sourceMode, setSourceMode] = useState<'existing' | 'new'>('existing')
  const [sourceInput, setSourceInput] = useState('')
  const sourceBag = useBagLookup(sourceInput)

  // "From existing stock" starts from a blank serial box with nothing to
  // browse — an operator who doesn't already know the exact serial has no
  // way in. Let them narrow by variant (+ optionally product type) and see
  // an actual preview of matching in-stock bags, dated, to tap instead.
  const [browseVariant, setBrowseVariant] = useState('')
  const [browseProductType, setBrowseProductType] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [browseResults, setBrowseResults] = useState<{ serial_number: string; product_type: string; weight_kg: number; created_at: string }[]>([])
  useEffect(() => {
    if (!browseVariant) { setBrowseResults([]); return }
    setBrowsing(true)
    const t = setTimeout(async () => {
      const base = getDb().schema('production').from('bag_tags')
        .select('serial_number, product_type, weight_kg, created_at')
        .eq('status', 'in_stock').eq('variant', browseVariant)
      const withType = browseProductType.trim() ? base.ilike('product_type', `%${browseProductType.trim()}%`) : base
      const { data } = await withType.order('created_at', { ascending: false }).limit(20)
      setBrowseResults((data as any) ?? [])
      setBrowsing(false)
    }, 200)
    return () => clearTimeout(t)
  }, [browseVariant, browseProductType])
  const [onboardedSource, setOnboardedSource] = useState<RebagBag | null>(null)
  const [pendingOnboard, setPendingOnboard] = useState<PickedOutput | null>(null)
  const [onboardNotes, setOnboardNotes] = useState('')
  const [onboarding, setOnboarding] = useState(false)
  const [onboardError, setOnboardError] = useState<string | null>(null)
  const source = onboardedSource ?? found(sourceBag)
  const sourceVoided = source?.status === 'voided'
  const sourceConsumed = Boolean(source?.consumed_at_section)
  const [sourceOriginal, setSourceOriginal] = useState<{ weight_kg: number } | null>(null)
  const [sourceHistory, setSourceHistory] = useState<HistoryRow[]>([])

  // Registering a legacy bag: the system generates the serial and stamps
  // now() as the record's date/time (this is when it entered tracking —
  // not a claim about when it was physically made, which nobody can verify
  // after the fact). What the operator must supply is what actually
  // describes THIS bag right now: its own grade and variant (never
  // inherited from whatever the capture session currently has open — this
  // material is very likely something else entirely), its current weight,
  // and whatever identifier it's currently carrying (a supplier tag, a
  // handwritten batch, or nothing). That's enough to create it in stock;
  // adjusting it — drawing from it, adding to it — happens afterward as an
  // ordinary, separate top-up/re-bag, exactly like any other bag.
  const [onboardVariant, setOnboardVariant] = useState('')
  const [onboardGrade, setOnboardGrade] = useState('')
  const [onboardWeight, setOnboardWeight] = useState('')
  const [onboardBatchRef, setOnboardBatchRef] = useState('')
  // Grade (Export/Export Blend/Domestic) is a real, mandatory classification
  // for Fine/Coarse Leaf — but Indent Sticks, Blocks, Dust etc. don't
  // necessarily have one, same distinction OutputPicker already draws for
  // batch tracking. Only require it when it actually applies.
  const needsOnboardGrade = LEAF.has(pendingOnboard?.productType ?? '')
  const onboardValid = !!onboardVariant && (!needsOnboardGrade || !!onboardGrade) && n(onboardWeight) > 0

  async function onboardSource() {
    if (!pendingOnboard || !onboardValid) return
    setOnboarding(true); setOnboardError(null)
    try {
      const serial = genSerial()
      const now = new Date().toISOString()
      const weight = n(onboardWeight) || 0
      const batchRef = onboardBatchRef.trim() || pendingOnboard.batch || null

      await getDb().schema('production').from('bag_tags').insert({
        serial_number: serial, section_id: sectionId, session_id: sessionId || null,
        product_type: pendingOnboard.productType, acumatica_id: pendingOnboard.code,
        variant: onboardVariant, weight_kg: weight,
        lot_number: batchRef, destination: onboardGrade || null,
        status: 'in_stock', is_open: !!pendingOnboard.leaveOpen, printed_at: now,
      } as any)
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'stock_count', section_id: sectionId,
        session_id: sessionId || null, weight_kg: weight,
        operator_id: operatorId ?? null, notes: onboardNotes.trim() || null, scanned_at: now,
      } as any)
      // Re-labelling — this bag had no valid system barcode before now,
      // unlike a top-up on an already-tracked bag, so there's no "write on
      // tag" choice here: it always gets a real printed label.
      await printLabelAuto({
        id: serial, serial_number: serial, product_type: pendingOnboard.productType,
        variant: onboardVariant || 'Conventional', grade: (onboardGrade as any) || 'A',
        weight_kg: weight, lot_number: batchRef || '',
        section_id: sectionId, section_name: sectionName, created_at: now, printed: true,
        acumaticaId: pendingOnboard.code ?? undefined,
      } as any)
      setOnboardedSource({
        serial_number: serial, product_type: pendingOnboard.productType, acumatica_id: pendingOnboard.code,
        variant: onboardVariant, weight_kg: weight,
        lot_number: batchRef, destination: onboardGrade || null,
        status: 'in_stock', consumed_at_section: null, created_at: now, is_open: !!pendingOnboard.leaveOpen,
      })
      setStep('created')
    } catch {
      setOnboardError('Could not register this bag — check the connection and try again.')
    } finally {
      setOnboarding(false)
    }
  }

  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('existing')
  const [targetInput, setTargetInput] = useState('')
  const targetBag = useBagLookup(targetInput, source?.serial_number)
  const target = found(targetBag)
  const targetVoided = target?.status === 'voided'
  const targetConsumed = Boolean(target?.consumed_at_section)
  const [targetOriginal, setTargetOriginal] = useState<{ weight_kg: number } | null>(null)
  const [targetHistory, setTargetHistory] = useState<HistoryRow[]>([])

  const [amount, setAmount] = useState('')          // existing-target amount
  const [pickedOutput, setPickedOutput] = useState<PickedOutput | null>(null)  // new-target pick
  const [closeTargetBag, setCloseTargetBag] = useState(false)
  // Only used when the source and (existing) target hold different products —
  // what the combined bag should actually be recorded as afterward. Defaults
  // to the source's product (what's physically being poured in) the moment a
  // mismatch is found for a NEW target serial, but stays editable so the
  // operator can name the real result instead.
  const [targetProductType, setTargetProductType] = useState('')
  const [confirmHeavy, setConfirmHeavy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newBagSerial, setNewBagSerial] = useState<string | null>(null)

  // Original bagging date/weight + full history for each existing bag
  // involved — fetched once found, shown on the confirm screen.
  useEffect(() => {
    if (!source) { setSourceOriginal(null); setSourceHistory([]); return }
    originalBagEvent(source.serial_number).then(ev => setSourceOriginal(ev ? { weight_kg: ev.weight_kg } : null))
    loadHistory(source.serial_number).then(setSourceHistory)
  }, [source?.serial_number])
  useEffect(() => {
    if (!target || targetMode !== 'existing') { setTargetOriginal(null); setTargetHistory([]); return }
    originalBagEvent(target.serial_number).then(ev => setTargetOriginal(ev ? { weight_kg: ev.weight_kg } : null))
    loadHistory(target.serial_number).then(setTargetHistory)
  }, [target?.serial_number, targetMode])
  // Prefill the reclassify field to the source's product every time a
  // DIFFERENT target bag resolves — never overwrite what the operator has
  // already typed for the current target.
  useEffect(() => { setTargetProductType(source?.product_type ?? '') }, [target?.serial_number, source?.serial_number])

  const sourceKg = source?.weight_kg ?? 0
  const amountKg = targetMode === 'existing' ? (n(amount) || 0) : n(pickedOutput?.weight ?? '')
  const exceedsSource = amountKg > sourceKg
  const sourceRemaining = source ? sourceKg - amountKg : 0

  const existingNewTotal = target ? (target.weight_kg ?? 0) + amountKg : 0
  const newBagTotal = amountKg
  const newTotal = targetMode === 'existing' ? existingNewTotal : newBagTotal
  const overCap = newTotal > MAX_BAG_WEIGHT_KG
  const unusualLabel = targetMode === 'existing' ? target?.product_type : pickedOutput?.productType
  const unusual = amountKg > 0 && !overCap && !!unusualLabel && isUnusuallyHeavyBag(unusualLabel, newTotal)
  const standard = unusualLabel ? expectedBagWeightFor(unusualLabel) : null

  const productMismatch = targetMode === 'existing' && !!source && !!target
    && source.product_type.toLowerCase() !== target.product_type.toLowerCase()

  const targetReady = targetMode === 'existing'
    ? !!target && !targetVoided && !targetConsumed && !(productMismatch && !targetProductType.trim())
    : !!pickedOutput

  // The amount/reclassify fields only make sense once BOTH bags are known —
  // for the default (remove) order that's already true by the time this
  // step renders (source was picked first), but for the "add" order (target
  // picked first, source still being chosen) it's the source resolving that
  // completes the pair. Gating on this — rather than always showing the
  // amount field the moment either bag resolves — is what stops "exceeds
  // source" from firing against a source that hasn't been picked yet
  // (sourceKg defaults to 0 until it has).
  const amountStageActive = !!source && !!target
  const amountStageBlocked = amountStageActive && (!targetReady || exceedsSource || amountKg <= 0)

  const canSubmit = !!source && !sourceVoided && !sourceConsumed && amountKg > 0
    && !exceedsSource && !overCap && !(unusual && !confirmHeavy) && targetReady

  async function submit() {
    if (!canSubmit || !source) return
    setSaving(true); setError(null)
    try {
      if (targetMode === 'existing' && target) {
        const resolvedProductType = productMismatch ? targetProductType.trim() : target.product_type
        await transferBagWeight(
          source.serial_number, sourceKg,
          target.serial_number, target.weight_kg ?? 0,
          amountKg, sectionId, sessionId, operatorId, closeTargetBag,
          productMismatch ? resolvedProductType : undefined,
        )
        // Both labels are now stale — forced reprint, no choice, for both.
        await printLabelAuto({
          id: target.serial_number, serial_number: target.serial_number, product_type: resolvedProductType,
          variant: target.variant || 'Conventional', grade: (target.destination as any) || 'A',
          weight_kg: existingNewTotal, lot_number: target.lot_number || '', section_id: sectionId,
          section_name: sectionName, created_at: target.created_at, printed: true,
          acumaticaId: target.acumatica_id ?? undefined,
        } as any)
        if (sourceRemaining > 0) {
          await printLabelAuto({
            id: source.serial_number, serial_number: source.serial_number, product_type: source.product_type,
            variant: source.variant || 'Conventional', grade: (source.destination as any) || 'A',
            weight_kg: sourceRemaining, lot_number: source.lot_number || '', section_id: sectionId,
            section_name: sectionName, created_at: source.created_at, printed: true,
            acumaticaId: source.acumatica_id ?? undefined,
          } as any)
        }
        onDone(); onClose()
      } else if (pickedOutput) {
        const serial = genSerial()
        await createBagFromTransfer(
          source.serial_number, sourceKg,
          {
            serialNumber: serial, productType: pickedOutput.productType, acumaticaId: pickedOutput.code,
            variant: variantWord || null, lotNumber: pickedOutput.batch || null,
            destination: gradeLetter ?? null, isOpen: !!pickedOutput.leaveOpen,
          },
          amountKg, sectionId, sessionId, operatorId,
        )
        // Source label is stale — forced reprint. The new bag has no prior
        // label, so it gets the ordinary print-or-handwrite choice next,
        // not a forced print.
        if (sourceRemaining > 0) {
          await printLabelAuto({
            id: source.serial_number, serial_number: source.serial_number, product_type: source.product_type,
            variant: source.variant || 'Conventional', grade: (source.destination as any) || 'A',
            weight_kg: sourceRemaining, lot_number: source.lot_number || '', section_id: sectionId,
            section_name: sectionName, created_at: source.created_at, printed: true,
            acumaticaId: source.acumatica_id ?? undefined,
          } as any)
        }
        setNewBagSerial(serial)
        setStep('newBagPrint')
      }
    } catch {
      setError('Could not save the re-bag — check the connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function tagNewBag(method: 'printed' | 'handwritten') {
    if (!newBagSerial || !pickedOutput) return
    await getDb().schema('production').from('bag_tags').update({ tag_method: method } as any)
      .eq('serial_number', newBagSerial)
    if (method === 'printed') {
      await printLabelAuto({
        id: newBagSerial, serial_number: newBagSerial, product_type: pickedOutput.productType,
        variant: variantWord || 'Conventional', grade: (gradeLetter as any) || 'A',
        weight_kg: amountKg, lot_number: pickedOutput.batch || '', section_id: sectionId,
        section_name: sectionName, created_at: new Date().toISOString(), printed: true,
        acumaticaId: pickedOutput.code ?? undefined,
      } as any)
    }
    onDone(); onClose()
  }

  // The reclassify + amount fields — shown once both bags are known,
  // regardless of which one was picked first (see amountStageActive).
  function renderAmountFields() {
    return (
      <>
        {productMismatch && (
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Resulting product type <span className="text-err">*</span></label>
            <input list="rebag-product-types" value={targetProductType}
              onChange={e => setTargetProductType(e.target.value)}
              placeholder="Type or pick a product…"
              className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-violet-600 ${targetProductType.trim() ? 'border-stone-200' : 'border-amber-300'}`} />
            <datalist id="rebag-product-types">
              {Array.from(new Set([
                source?.product_type, target?.product_type,
                ...(SECTION_CONFIG[sectionId]?.outputTypes ?? []),
              ].filter(Boolean) as string[])).map(t => <option key={t} value={t} />)}
            </datalist>
            {!targetProductType.trim() && <p className="text-[11px] text-err">Required — what's actually in the bag once this is done.</p>}
          </div>
        )}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Amount to move (kg)</label>
          <input autoFocus type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] outline-none focus:border-violet-600" />
          {exceedsSource && <p className="text-[11px] text-err">Can't move more than the {sourceKg.toFixed(1)}kg the source has.</p>}
        </div>
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100 sticky top-0 bg-white">
          <span className="font-semibold text-[15px] text-text flex-1">Re-bag material</span>
          <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {step === 'intent' && (
            <>
              <p className="text-[12px] text-text-muted">What do you want to do?</p>
              <button onClick={() => { setIntent('add'); setStep('target') }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium">
                Add material to a bag <ArrowRight size={15} />
              </button>
              <p className="text-[11px] text-text-faint px-1">Top up a bag you already have — pick that bag first, then say where the extra material is coming from.</p>
              <button onClick={() => { setIntent('remove'); setStep('source') }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 text-text font-medium text-[14px] hover:bg-stone-50">
                Remove material from a bag <ArrowRight size={15} />
              </button>
              <p className="text-[11px] text-text-faint px-1">Empty some or all of a bag into another bag — pick the bag it's coming out of first.</p>
            </>
          )}

          {step === 'source' && (
            <>
              <p className="text-[12px] text-text-muted">
                {intent === 'add' ? "Where's the extra material coming from?" : 'Where is the material coming from?'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setSourceMode('existing')}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium border ${sourceMode === 'existing' ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-stone-200 text-text-muted'}`}>
                  From existing stock
                </button>
                <button onClick={() => setSourceMode('new')}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium border ${sourceMode === 'new' ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-stone-200 text-text-muted'}`}>
                  Not on the system yet
                </button>
              </div>

              {sourceMode === 'existing' ? (
                <>
                  <p className="text-[11px] text-text-muted">Know the serial? Type or scan it below. Otherwise, narrow by variant to see what's actually in stock.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={browseVariant} onChange={e => setBrowseVariant(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600">
                      <option value="">Browse by variant…</option>
                      {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                    <input type="text" value={browseProductType} onChange={e => setBrowseProductType(e.target.value)}
                      placeholder="Product type (optional)" className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                  </div>
                  {browseVariant && browsing && <p className="text-[12px] text-text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Looking…</p>}
                  {browseVariant && !browsing && browseResults.length === 0 && <p className="text-[12px] text-text-muted">No in-stock bags match.</p>}
                  {browseResults.length > 0 && (
                    <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 max-h-[160px] overflow-y-auto">
                      {browseResults.map(r => (
                        <li key={r.serial_number}>
                          <button onClick={() => setSourceInput(r.serial_number)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-50">
                            <span className="font-mono text-[12px] text-text flex-1 min-w-0 truncate">{r.serial_number}</span>
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
                    <input value={sourceInput} autoCapitalize="characters"
                      onChange={e => setSourceInput(e.target.value.toUpperCase())}
                      placeholder="Source bag serial…" className="flex-1 py-2.5 text-[14px] outline-none bg-transparent font-mono" />
                  </div>
                  {sourceBag === 'loading' && <p className="text-[12px] text-text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Looking up…</p>}
                  {sourceBag === 'not_found' && <p className="text-[12px] text-err">Serial not found.</p>}
                  {source && sourceVoided && <p className="text-[12px] text-err">That bag has already been voided.</p>}
                  {source && sourceConsumed && <p className="text-[12px] text-err">That bag was already consumed downstream.</p>}
                  {source && !sourceVoided && !sourceConsumed && (
                    <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-text">{source.serial_number}</span>
                        <span className="text-text-muted">{source.product_type}</span>
                      </div>
                      <div className="text-text-muted">{sourceKg.toFixed(1)}kg currently in stock</div>
                    </div>
                  )}
                  {amountStageActive && renderAmountFields()}
                  <button onClick={() => setStep(intent === 'add' ? 'confirm' : 'target')}
                    disabled={!source || sourceVoided || sourceConsumed || amountStageBlocked}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                    Next <ArrowRight size={15} />
                  </button>
                </>
              ) : !pendingOnboard ? (
                <>
                  <p className="text-[11px] text-text-muted">This material isn't tracked yet — pick what it is. You'll confirm its grade, variant, and current weight next, before anything is drawn from it.</p>
                  <OutputPicker sectionId={sectionId} variantWord={variantWord} gradeLetter={gradeLetter}
                    defaultBatch="" confirmLabel={<>Next <ArrowRight size={16} /></>} onAdd={p => {
                      setPendingOnboard(p)
                      setOnboardWeight(p.weight)
                      setOnboardBatchRef(p.batch || '')
                      setOnboardVariant(variantWord || '')
                      setOnboardGrade(gradeLetter || '')
                    }} onClose={() => setSourceMode('existing')} />
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px]">
                    <span className="text-text">{pendingOnboard.productType}</span>
                  </div>

                  <p className="text-[11px] text-text-muted">This creates the bag in stock, as of right now, at the weight it currently has. Any drawing from it or adding to it happens afterward as its own separate step.</p>

                  <div className={`grid gap-2 ${needsOnboardGrade ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {needsOnboardGrade && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Grade <span className="text-err">*</span></label>
                        <select value={onboardGrade} onChange={e => setOnboardGrade(e.target.value)}
                          className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-violet-600 ${onboardGrade ? 'border-stone-200' : 'border-amber-300'}`}>
                          <option value="" disabled>Select grade…</option>
                          {DESTINATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Variant <span className="text-err">*</span></label>
                      <select value={onboardVariant} onChange={e => setOnboardVariant(e.target.value)}
                        className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-violet-600 ${onboardVariant ? 'border-stone-200' : 'border-amber-300'}`}>
                        <option value="" disabled>Select variant…</option>
                        {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {!needsOnboardGrade && (
                    <p className="text-[11px] text-text-muted">No grade needed for {pendingOnboard.productType} — only Fine/Coarse Leaf are graded.</p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Current weight (kg) <span className="text-err">*</span></label>
                      <input type="text" inputMode="decimal" value={onboardWeight} onChange={e => setOnboardWeight(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Current serial/batch, if any</label>
                      <input type="text" value={onboardBatchRef} onChange={e => setOnboardBatchRef(e.target.value)} placeholder="—"
                        className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Notes (optional) — origin, condition, why it's only being tracked now</label>
                    <textarea value={onboardNotes} onChange={e => setOnboardNotes(e.target.value)} rows={2}
                      className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                  </div>
                  {onboardError && <p className="text-[12px] text-err">{onboardError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => { setPendingOnboard(null); setOnboardVariant(''); setOnboardGrade(''); setOnboardWeight(''); setOnboardBatchRef('') }} disabled={onboarding}
                      className="py-3 px-4 rounded-xl border border-stone-200 text-text-muted text-[13px] font-medium">Back</button>
                    <button onClick={onboardSource} disabled={onboarding || !onboardValid}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                      {onboarding ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                      {onboarding ? 'Registering…' : 'Add to stock & label'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {step === 'created' && source && intent === 'add' && targetReady && (
            <>
              <p className="text-[12px] text-text-muted">
                Registered and labelled. {targetMode === 'existing'
                  ? <>Now say how much of it goes into <span className="font-mono text-text">{target?.serial_number}</span>.</>
                  : 'Continue to review and print.'}
              </p>
              {targetMode === 'existing' && renderAmountFields()}
              <button onClick={() => setStep('confirm')} disabled={amountStageBlocked}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                Next <ArrowRight size={15} />
              </button>
            </>
          )}

          {step === 'created' && source && intent !== 'add' && (
            <>
              <p className="text-[12px] text-text-muted">Registered and labelled. What now?</p>
              <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-text">{source.serial_number}</span>
                  <span className="text-text-muted">{source.product_type}</span>
                </div>
                <Row label="Variant" value={source.variant || '—'} />
                {source.destination && <Row label="Grade" value={DESTINATION_OPTIONS.find(o => o.value === source.destination)?.label ?? source.destination} />}
                <Row label="Current weight" value={`${(source.weight_kg ?? 0).toFixed(1)} kg`} />
                {source.lot_number && <Row label="Batch" value={source.lot_number} />}
              </div>
              <button onClick={() => setStep('target')}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium">
                Remove material — feed another bag <ArrowRight size={15} />
              </button>
              <button onClick={() => {
                setTargetInput(source.serial_number)
                setTargetMode('existing')
                setOnboardedSource(null)
                setSourceInput('')
                setSourceMode('existing')
                setPendingOnboard(null)
                setIntent('add')
                setStep('source')
              }} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 text-text font-medium text-[14px] hover:bg-stone-50">
                Add material to this bag <ArrowRight size={15} />
              </button>
              <button onClick={onClose} className="w-full py-2.5 text-[12.5px] text-text-muted">Done for now</button>
            </>
          )}

          {step === 'target' && (
            <>
              {intent === 'add' && (
                <p className="text-[12px] text-text-muted">Which bag do you want to add material to?</p>
              )}
              <div className="flex gap-2">
                <button onClick={() => setTargetMode('existing')}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium border ${targetMode === 'existing' ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-stone-200 text-text-muted'}`}>
                  Existing bag
                </button>
                <button onClick={() => setTargetMode('new')}
                  className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium border ${targetMode === 'new' ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-stone-200 text-text-muted'}`}>
                  New bag
                </button>
              </div>

              {targetMode === 'existing' ? (
                <>
                  <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
                    <Search size={16} className="text-stone-400" />
                    <input autoFocus value={targetInput} autoCapitalize="characters"
                      onChange={e => setTargetInput(e.target.value.toUpperCase())}
                      placeholder="Target bag serial…" className="flex-1 py-2.5 text-[14px] outline-none bg-transparent font-mono" />
                  </div>
                  {targetBag === 'loading' && <p className="text-[12px] text-text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Looking up…</p>}
                  {targetBag === 'not_found' && <p className="text-[12px] text-err">{targetInput && source && sanitizeSerial(targetInput) === sanitizeSerial(source.serial_number) ? "A bag can't be re-bagged into itself." : 'Serial not found.'}</p>}
                  {target && targetVoided && <p className="text-[12px] text-err">That bag has already been voided.</p>}
                  {target && targetConsumed && <p className="text-[12px] text-err">That bag was already consumed downstream.</p>}
                  {target && !targetVoided && !targetConsumed && (
                    <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-text">{target.serial_number}</span>
                        <span className="text-text-muted">{target.product_type}</span>
                      </div>
                      <div className="text-text-muted">{(target.weight_kg ?? 0).toFixed(1)}kg currently in stock</div>
                      {productMismatch && (
                        <p className="text-amber-700 flex items-center gap-1.5"><AlertTriangle size={12} /> Different product to the source — pick what the combined bag actually is below.</p>
                      )}
                    </div>
                  )}
                  {amountStageActive && renderAmountFields()}
                  <button onClick={() => setStep(intent === 'add' && !source ? 'source' : 'confirm')} disabled={!targetReady || amountStageBlocked}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                    Next <ArrowRight size={15} />
                  </button>
                </>
              ) : (
                <OutputPicker sectionId={sectionId} variantWord={variantWord} gradeLetter={gradeLetter}
                  defaultBatch="" batchHints={sessionDebagLots} confirmLabel={<>Next <ArrowRight size={16} /></>}
                  onAdd={p => { setPickedOutput(p); setStep(intent === 'add' && !source ? 'source' : 'confirm') }} onClose={() => setTargetMode('existing')} />
              )}
            </>
          )}

          {step === 'confirm' && source && (
            <>
              <div className="space-y-2">
                <BagHistoryCard title="Source" bag={source} original={sourceOriginal} history={sourceHistory} />
                {targetMode === 'existing' && target && (
                  <BagHistoryCard title="Target" bag={target} original={targetOriginal} history={targetHistory} />
                )}
              </div>

              <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1.5">
                <Row label="Amount moving" value={`${amountKg.toFixed(1)} kg`} />
                <Row label="Source remaining" value={`${sourceRemaining.toFixed(1)} kg${sourceRemaining <= 0 ? ' (voided)' : ''}`} />
                <Row label="Target new total" value={`${newTotal.toFixed(1)} kg`} />
                {productMismatch && <Row label="Target reclassified to" value={targetProductType.trim() || '—'} />}
                {targetMode === 'new' && pickedOutput?.batch && <Row label="Batch" value={pickedOutput.batch} />}
                {targetMode === 'existing' && target?.lot_number && <Row label="Target batch (fixed at creation)" value={target.lot_number} />}
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
              {targetMode === 'existing' && target?.is_open && (
                <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
                  <input type="checkbox" checked={closeTargetBag} onChange={e => setCloseTargetBag(e.target.checked)} className="rounded" />
                  This completes the bag — mark it no longer open
                </label>
              )}
              {error && <p className="text-[12px] text-err">{error}</p>}

              <button onClick={submit} disabled={!canSubmit || saving}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                {saving ? 'Saving…' : targetMode === 'existing' ? 'Save & print label(s)' : 'Save re-bag'}
              </button>
            </>
          )}

          {step === 'newBagPrint' && newBagSerial && (
            <div className="space-y-3">
              <p className="text-[12.5px] text-text">New bag <span className="font-mono">{newBagSerial}</span> created at {amountKg.toFixed(1)}kg.</p>
              <div className="flex gap-2">
                <button onClick={() => tagNewBag('printed')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-stone-200 text-[12.5px] font-medium text-stone-600 hover:border-violet-600 hover:text-violet-700">
                  <Printer size={14} /> Print label
                </button>
                <button onClick={() => tagNewBag('handwritten')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-stone-200 text-[12.5px] font-medium text-stone-600 hover:border-violet-600 hover:text-violet-700">
                  <PenLine size={14} /> Write on tag
                </button>
              </div>
            </div>
          )}
        </div>
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

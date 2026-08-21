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
import { expectedBagWeightFor, isUnusuallyHeavyBag, MAX_BAG_WEIGHT_KG, sectionMeta } from '@/lib/production/capture-config'
import { OutputPicker, type PickedOutput } from '@/components/production/capture/OutputPicker'

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
  const [step, setStep] = useState<'source' | 'target' | 'confirm' | 'newBagPrint'>('source')

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

  // Registering a legacy bag needs its real history, not just today's
  // snapshot — the original date/weight it actually started at, plus any
  // later re-weighs the operator knows about, each backdated to its real
  // date. Only once that's recorded does the bag exist "as of today" at
  // its true current weight — the actual re-bag/top-up transaction (target
  // step onward) is a separate, later step on top of that baseline.
  const todayStr = new Date().toISOString().slice(0, 10)
  const [onboardOriginalDate, setOnboardOriginalDate] = useState(todayStr)
  const [onboardOriginalWeight, setOnboardOriginalWeight] = useState('')
  const [onboardChanges, setOnboardChanges] = useState<{ id: string; date: string; weight: string }[]>([])

  const sortedOnboardChanges = [...onboardChanges].sort((a, b) => a.date.localeCompare(b.date))
  const onboardCurrentWeight = sortedOnboardChanges.length
    ? n(sortedOnboardChanges[sortedOnboardChanges.length - 1].weight)
    : (n(onboardOriginalWeight) || 0)
  const onboardValid = !!onboardOriginalDate && onboardOriginalDate <= todayStr && n(onboardOriginalWeight) > 0
    // Every change must fall on or after the original date — the delta math
    // and "earliest event" lookup both assume chronological order.
    && onboardChanges.every(c => !!c.date && c.date <= todayStr && c.date >= onboardOriginalDate && n(c.weight) > 0)

  function addOnboardChange() {
    setOnboardChanges(c => [...c, { id: crypto.randomUUID(), date: todayStr, weight: '' }])
  }
  function updateOnboardChange(id: string, field: 'date' | 'weight', value: string) {
    setOnboardChanges(c => c.map(r => r.id === id ? { ...r, [field]: value } : r))
  }
  function removeOnboardChange(id: string) {
    setOnboardChanges(c => c.filter(r => r.id !== id))
  }

  async function onboardSource() {
    if (!pendingOnboard || !onboardValid) return
    setOnboarding(true); setOnboardError(null)
    try {
      const serial = genSerial()
      const now = new Date().toISOString()
      const originalWeight = n(onboardOriginalWeight) || 0
      const originalDateISO = `${onboardOriginalDate}T12:00:00.000Z`
      const currentWeight = onboardCurrentWeight

      await getDb().schema('production').from('bag_tags').insert({
        serial_number: serial, section_id: sectionId, session_id: sessionId || null,
        product_type: pendingOnboard.productType, acumatica_id: pendingOnboard.code,
        variant: variantWord || null, weight_kg: currentWeight,
        lot_number: pendingOnboard.batch || null, destination: gradeLetter ?? null,
        status: 'in_stock', is_open: !!pendingOnboard.leaveOpen, printed_at: now,
        created_at: originalDateISO,
      } as any)

      // Backdated ledger: the original weight is this bag's first-ever
      // event (its starting value, same convention as a normal
      // 'bagging_out' row), then each later known re-weigh is logged as a
      // delta from the previous known point, at its own real date — so
      // "original bagging date/weight" and "full history" on the confirm
      // screen reflect what actually happened, not today.
      const events: any[] = [{
        serial_number: serial, action: 'stock_count', section_id: sectionId,
        session_id: sessionId || null, weight_kg: originalWeight,
        operator_id: operatorId ?? null, notes: onboardNotes.trim() || null,
        scanned_at: originalDateISO,
      }]
      let prevWeight = originalWeight
      for (const c of sortedOnboardChanges) {
        const w = n(c.weight) || 0
        events.push({
          serial_number: serial, action: 'stock_count', section_id: sectionId,
          session_id: sessionId || null, weight_kg: w - prevWeight,
          operator_id: operatorId ?? null, scanned_at: `${c.date}T12:00:00.000Z`,
        })
        prevWeight = w
      }
      await getDb().schema('production').from('scan_events').insert(events as any)

      // Re-labelling — this bag had no valid system barcode before now,
      // unlike a top-up on an already-tracked bag, so there's no "write on
      // tag" choice here: it always gets a real printed label, showing its
      // TRUE current weight (after any known history), not just the first
      // number picked.
      await printLabelAuto({
        id: serial, serial_number: serial, product_type: pendingOnboard.productType,
        variant: variantWord || 'Conventional', grade: (gradeLetter as any) || 'A',
        weight_kg: currentWeight, lot_number: pendingOnboard.batch || '',
        section_id: sectionId, section_name: sectionName, created_at: originalDateISO, printed: true,
        acumaticaId: pendingOnboard.code ?? undefined,
      } as any)
      setOnboardedSource({
        serial_number: serial, product_type: pendingOnboard.productType, acumatica_id: pendingOnboard.code,
        variant: variantWord || null, weight_kg: currentWeight,
        lot_number: pendingOnboard.batch || null, destination: gradeLetter ?? null,
        status: 'in_stock', consumed_at_section: null, created_at: originalDateISO, is_open: !!pendingOnboard.leaveOpen,
      })
      setStep('target')
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
    ? !!target && !targetVoided && !targetConsumed
    : !!pickedOutput

  const canSubmit = !!source && !sourceVoided && !sourceConsumed && amountKg > 0
    && !exceedsSource && !overCap && !(unusual && !confirmHeavy) && targetReady

  async function submit() {
    if (!canSubmit || !source) return
    setSaving(true); setError(null)
    try {
      if (targetMode === 'existing' && target) {
        await transferBagWeight(
          source.serial_number, sourceKg,
          target.serial_number, target.weight_kg ?? 0,
          amountKg, sectionId, sessionId, operatorId, closeTargetBag,
        )
        // Both labels are now stale — forced reprint, no choice, for both.
        await printLabelAuto({
          id: target.serial_number, serial_number: target.serial_number, product_type: target.product_type,
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

  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100 sticky top-0 bg-white">
          <span className="font-semibold text-[15px] text-text flex-1">Re-bag material</span>
          <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {step === 'source' && (
            <>
              <p className="text-[12px] text-text-muted">Where is the material coming from?</p>
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
                  <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
                    <Search size={16} className="text-stone-400" />
                    <input autoFocus value={sourceInput} autoCapitalize="characters"
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
                  <button onClick={() => setStep('target')} disabled={!source || sourceVoided || sourceConsumed}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                    Next <ArrowRight size={15} />
                  </button>
                </>
              ) : !pendingOnboard ? (
                <>
                  <p className="text-[11px] text-text-muted">This material isn't tracked yet — pick what it is. You'll record its real weight history next, before anything is drawn from it.</p>
                  <OutputPicker sectionId={sectionId} variantWord={variantWord} gradeLetter={gradeLetter}
                    defaultBatch="" onAdd={p => { setPendingOnboard(p); setOnboardOriginalWeight(p.weight) }} onClose={() => setSourceMode('existing')} />
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px]">
                    <div className="flex items-center justify-between">
                      <span className="text-text">{pendingOnboard.productType}</span>
                      {pendingOnboard.batch && <span className="text-text-muted">Batch {pendingOnboard.batch}</span>}
                    </div>
                  </div>

                  <p className="text-[11px] text-text-muted">When did this bag actually start, and at what weight? This is its real history, not today's — it establishes the bag's true current weight before today's re-bag/top-up happens as a separate step.</p>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Original date</label>
                      <input type="date" value={onboardOriginalDate} max={todayStr} onChange={e => setOnboardOriginalDate(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Original weight (kg)</label>
                      <input type="text" inputMode="decimal" value={onboardOriginalWeight} onChange={e => setOnboardOriginalWeight(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Weight changes since then (if known)</label>
                    {onboardChanges.map(c => (
                      <div key={c.id}>
                        <div className="flex gap-2 items-center">
                          <input type="date" value={c.date} max={todayStr} onChange={e => updateOnboardChange(c.id, 'date', e.target.value)}
                            className="flex-1 px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                          <input type="text" inputMode="decimal" placeholder="kg" value={c.weight} onChange={e => updateOnboardChange(c.id, 'weight', e.target.value)}
                            className="w-24 px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                          <button onClick={() => removeOnboardChange(c.id)} className="text-stone-400 hover:text-err p-1"><X size={16} /></button>
                        </div>
                        {c.date && c.date < onboardOriginalDate && (
                          <p className="text-[11px] text-err mt-0.5">Can't be before the original date.</p>
                        )}
                      </div>
                    ))}
                    <button onClick={addOnboardChange} className="text-[12px] font-medium text-violet-700">+ Add a weight change</button>
                  </div>

                  <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] flex items-center justify-between">
                    <span className="text-text-muted">Current weight (as of today)</span>
                    <span className="font-mono text-text tabular-nums">{onboardCurrentWeight.toFixed(1)} kg</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Notes (optional) — origin, condition, why it's only being tracked now</label>
                    <textarea value={onboardNotes} onChange={e => setOnboardNotes(e.target.value)} rows={2}
                      className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-violet-600" />
                  </div>
                  {onboardError && <p className="text-[12px] text-err">{onboardError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => { setPendingOnboard(null); setOnboardChanges([]); setOnboardOriginalDate(todayStr); setOnboardOriginalWeight('') }} disabled={onboarding}
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

          {step === 'target' && source && (
            <>
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
                  {targetBag === 'not_found' && <p className="text-[12px] text-err">{targetInput && sanitizeSerial(targetInput) === sanitizeSerial(source.serial_number) ? "A bag can't be re-bagged into itself." : 'Serial not found.'}</p>}
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
                        <p className="text-amber-700 flex items-center gap-1.5"><AlertTriangle size={12} /> Different product to the source — this will reclassify the material.</p>
                      )}
                    </div>
                  )}
                  {target && !targetVoided && !targetConsumed && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Amount to move (kg)</label>
                      <input autoFocus type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] outline-none focus:border-violet-600" />
                      {exceedsSource && <p className="text-[11px] text-err">Can't move more than the {sourceKg.toFixed(1)}kg the source has.</p>}
                    </div>
                  )}
                  <button onClick={() => setStep('confirm')} disabled={!targetReady || exceedsSource || amountKg <= 0}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                    Next <ArrowRight size={15} />
                  </button>
                </>
              ) : (
                <OutputPicker sectionId={sectionId} variantWord={variantWord} gradeLetter={gradeLetter}
                  defaultBatch="" onAdd={p => { setPickedOutput(p); setStep('confirm') }} onClose={() => setTargetMode('existing')} />
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

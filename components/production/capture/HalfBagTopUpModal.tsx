'use client'

// components/production/capture/HalfBagTopUpModal.tsx
//
// Half-bag top-up: an operator adds material to a bag they already have —
// typically a half-filled bag left open from a previous shift/day — by
// naming the existing bag the extra material is actually coming from. Both
// bags must already be tracked; this deliberately does NOT create a brand
// new bag, and does NOT register untracked/legacy stock into the system.
// Those are warehouse-management functions, out of scope for the operator-
// facing flow here — a separate feature, for later.
//
// Both bags involved show their current weight, their ORIGINAL bagging
// date/weight (recovered from their earliest scan_events row —
// bag_tags.weight_kg is overwritten in place on every top-up, so it can't
// tell you what a bag started at), and their full scan_events history,
// before the operator confirms and prints.
//
// Both labels are always force-reprinted on submit — a bag's printed label
// is now stale the instant its weight changes, so there's no "write on tag"
// choice here (skipped only if the source was fully drained and voided).
//
// This modal NEVER touches a capture session's draft_data/value.outputs —
// mass balance is computed from that local array on a completely separate
// write path from bag_tags, so wiring a top-up into it would double-count
// its weight there. Every write here is a pure, side-channel DB call,
// exactly like the Tags page's original top-up flow this generalizes.

import { useEffect, useState } from 'react'
import { X, Search, Loader2, AlertTriangle, ArrowRight, Printer, History } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sanitizeSerial, transferBagWeight, originalBagEvent } from '@/lib/production/scan-utils'
import { printLabelAuto } from '@/lib/production/label-print'
import { expectedBagWeightFor, isUnusuallyHeavyBag, MAX_BAG_WEIGHT_KG, sectionMeta, VARIANT_OPTIONS } from '@/lib/production/capture-config'
import { SECTION_CONFIG } from '@/lib/production/live-types'

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
  onDone: () => void
  onClose: () => void
}

export function HalfBagTopUpModal({ sectionId, sessionId, operatorId, onDone, onClose }: HalfBagTopUpModalProps) {
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

  const [targetBrowseVariant, setTargetBrowseVariant] = useState('')
  const [targetBrowseProductType, setTargetBrowseProductType] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const targetBrowse = useBagBrowse(targetBrowseVariant, targetBrowseProductType, onlyOpen)

  // Where the extra material comes from — picked second, excluded from
  // matching the target so a bag can't top itself up.
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
    if (!target) { setTargetOriginal(null); setTargetHistory([]); return }
    originalBagEvent(target.serial_number).then(ev => setTargetOriginal(ev ? { weight_kg: ev.weight_kg } : null))
    loadHistory(target.serial_number).then(setTargetHistory)
  }, [target?.serial_number])
  useEffect(() => {
    if (!source) { setSourceOriginal(null); setSourceHistory([]); return }
    originalBagEvent(source.serial_number).then(ev => setSourceOriginal(ev ? { weight_kg: ev.weight_kg } : null))
    loadHistory(source.serial_number).then(setSourceHistory)
  }, [source?.serial_number])
  useEffect(() => { setTargetProductType(source?.product_type ?? '') }, [target?.serial_number, source?.serial_number])

  const sourceKg = source?.weight_kg ?? 0
  const amountKg = n(amount) || 0
  const exceedsSource = amountKg > sourceKg
  const sourceRemaining = source ? sourceKg - amountKg : 0
  const newTotal = target ? (target.weight_kg ?? 0) + amountKg : 0
  const overCap = newTotal > MAX_BAG_WEIGHT_KG
  const unusual = amountKg > 0 && !overCap && !!target && isUnusuallyHeavyBag(target.product_type, newTotal)
  const standard = target ? expectedBagWeightFor(target.product_type) : null

  const productMismatch = !!source && !!target && source.product_type.toLowerCase() !== target.product_type.toLowerCase()

  const canSubmit = !!source && !!target && !sourceVoided && !sourceConsumed && !targetVoided && !targetConsumed
    && amountKg > 0 && !exceedsSource && !overCap && !(unusual && !confirmHeavy)
    && !(productMismatch && !targetProductType.trim())

  async function submit() {
    if (!canSubmit || !source || !target) return
    setSaving(true); setError(null)
    try {
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
        weight_kg: newTotal, lot_number: target.lot_number || '', section_id: sectionId,
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
                    <span className="text-text-muted">{target.product_type}</span>
                  </div>
                  <div className="text-text-muted">{(target.weight_kg ?? 0).toFixed(1)}kg currently in stock{target.is_open ? ' · open' : ''}</div>
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
              <p className="text-[12px] text-text-muted">Where's the extra material coming from?</p>
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
              <button onClick={() => setStep('confirm')}
                disabled={!source || sourceVoided || sourceConsumed || amountKg <= 0 || exceedsSource || (productMismatch && !targetProductType.trim())}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                Next <ArrowRight size={15} />
              </button>
            </>
          )}

          {step === 'confirm' && source && target && (
            <>
              <div className="space-y-2">
                <BagHistoryCard title="Topping up" bag={target} original={targetOriginal} history={targetHistory} />
                <BagHistoryCard title="Coming from" bag={source} original={sourceOriginal} history={sourceHistory} />
              </div>

              <div className="rounded-xl border border-stone-200 px-3 py-2.5 text-[12.5px] space-y-1.5">
                <Row label="Amount added" value={`${amountKg.toFixed(1)} kg`} />
                <Row label="Source remaining" value={`${sourceRemaining.toFixed(1)} kg${sourceRemaining <= 0 ? ' (voided)' : ''}`} />
                <Row label="Target new total" value={`${newTotal.toFixed(1)} kg`} />
                {productMismatch && <Row label="Target reclassified to" value={targetProductType.trim() || '—'} />}
                {target.lot_number && <Row label="Target batch (fixed at creation)" value={target.lot_number} />}
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
              {error && <p className="text-[12px] text-err">{error}</p>}

              <button onClick={submit} disabled={!canSubmit || saving}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-medium disabled:opacity-40">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                {saving ? 'Saving…' : 'Save & print label(s)'}
              </button>
            </>
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

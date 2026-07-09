'use client'
import { useState, useEffect, useRef } from 'react'
import { Loader2, X, Lock, UserPlus, UserMinus } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import type { LiveOperator, ShiftType, Variant } from '@/lib/production/live-types'
import { SECTION_CONFIG, VARIANT_LABELS, operatorsForSection } from '@/lib/production/live-types'
import { format } from 'date-fns'

const INP = 'w-full px-3 py-3 min-h-[44px] rounded-xl border bg-white text-[14px] text-text outline-none transition-all border-stone-200 focus:border-brand focus:ring-2 focus:ring-brand/10 disabled:opacity-40'

type VerifyState = 'idle' | 'verifying' | 'verified' | 'failed'

// ── PIN input block ───────────────────────────────────────────────────────────
// UNCONTROLLED input — no `value` prop, value read via ref only on Verify.
// This means typing never triggers a parent re-render, so focus is never lost.
// `key={operatorId}` on the parent <PinBlock> call resets the DOM node
// whenever the operator selection changes (the only time we want a reset).
function PinBlock({
  label,
  operatorId,
  verifyState,
  onVerify,
  onClearVerify,
}: {
  label: string
  operatorId: string
  verifyState: VerifyState
  onVerify: (pin: string) => void
  onClearVerify: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function submit() {
    const pin = (inputRef.current?.value ?? '').replace(/\D/g, '')
    onVerify(pin)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">
        {label} PIN
      </label>
      {verifyState === 'verified' ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-green-50 border border-green-200 text-green-700 text-[12px]">
          <span className="text-green-500">✓</span>
          <span className="flex-1">PIN verified</span>
          <button
            type="button"
            onClick={onClearVerify}
            className="text-[11px] text-stone-400 hover:text-stone-600 underline"
          >
            change
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={4}
            defaultValue=""
            placeholder="••••"
            disabled={!operatorId || verifyState === 'verifying'}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            className={INP + ' tracking-[0.5em] text-center text-[22px] font-mono flex-1'}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!operatorId || verifyState === 'verifying'}
            className="flex-shrink-0 px-4 min-h-[44px] rounded-xl bg-brand text-white font-semibold text-[13px] disabled:opacity-40 hover:bg-brand-mid transition-colors flex items-center gap-1.5"
          >
            {verifyState === 'verifying' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Lock size={14} />
            )}
            Verify
          </button>
        </div>
      )}
      {verifyState === 'failed' && (
        <p className="text-[11px] text-err px-1">Incorrect PIN — please try again</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  sectionId: string
  onConfirm: (data: {
    primaryOperator: LiveOperator
    secondaryOperator?: LiveOperator
    shift: ShiftType
    lotNumber: string
    variant: Variant | ''
  }) => void
  onClose: () => void
}

const NEEDS_LOT     = new Set(['blender', 'smallblender', 'pasteuriser', 'granule'])
const NEEDS_VARIANT = new Set(['blender', 'smallblender', 'pasteuriser', 'sieving', 'refining1', 'refining2'])

export default function SessionModal({ sectionId, onConfirm, onClose }: Props) {
  const cfg = SECTION_CONFIG[sectionId]

  const [allOperators, setAllOperators] = useState<LiveOperator[]>([])
  const [loading, setLoading] = useState(true)

  // Primary operator
  const [primaryId, setPrimaryId]         = useState('')
  const [primaryVerify, setPrimaryVerify] = useState<VerifyState>('idle')
  const [primaryOperator, setPrimaryOperator] = useState<LiveOperator | null>(null)

  // Secondary operator
  const [showSecondary, setShowSecondary]     = useState(false)
  const [secondaryId, setSecondaryId]         = useState('')
  const [secondaryVerify, setSecondaryVerify] = useState<VerifyState>('idle')
  const [secondaryOperator, setSecondaryOperator] = useState<LiveOperator | null>(null)

  // Session fields
  const [shift, setShift] = useState<ShiftType>(() => {
    const h = new Date().getHours()
    return h >= 7 && h < 16 ? 'morning' : 'afternoon'
  })
  const [lotNumber, setLotNumber] = useState('')
  const [variant, setVariant]     = useState<Variant | ''>('')

  const [error, setError]         = useState('')
  const [submitting, setSubmitting] = useState(false)

  const needsLot     = NEEDS_LOT.has(sectionId)
  const needsVariant = NEEDS_VARIANT.has(sectionId)
  const today        = format(new Date(), 'EEEE, d MMMM yyyy')
  const shifts: ShiftType[] = ['morning', 'afternoon']

  useEffect(() => {
    getDb().schema('production').from('operators')
      .select('id, name, display_name, operator_code, role, section_ids, pin, active')
      .eq('active', true)
      .order('name')
      .then(({ data }: any) => {
        const ops: LiveOperator[] = data ?? []
        setAllOperators(operatorsForSection(ops, sectionId))
        setLoading(false)
      })
  }, [sectionId])

  // Reset secondary PIN block when secondary operator selection changes
  useEffect(() => {
    setSecondaryVerify('idle')
    setSecondaryOperator(null)
  }, [secondaryId])

  // Reset primary PIN block when primary operator selection changes
  useEffect(() => {
    setPrimaryVerify('idle')
    setPrimaryOperator(null)
  }, [primaryId])

  const primaryOptions   = allOperators
  const secondaryOptions = allOperators.filter(op => op.id !== primaryId)

  async function verifyPin(
    operatorId: string,
    pin: string,
    setVerify: (s: VerifyState) => void,
    setOperatorObj: (op: LiveOperator | null) => void,
  ) {
    if (!operatorId)      { setError('Select an operator'); return }
    if (pin.length !== 4) { setError('Enter your 4-digit PIN'); return }
    setError('')
    setVerify('verifying')
    const { data, error: dbErr } = await getDb().schema('production')
      .from('operators')
      .select('id, name, display_name, operator_code, role, section_ids, pin, active')
      .eq('id', operatorId)
      .eq('pin', pin)
      .maybeSingle()
    if (dbErr || !data) {
      setVerify('failed')
      setOperatorObj(null)
      setError('Incorrect PIN — please try again')
    } else {
      setVerify('verified')
      setOperatorObj(data as LiveOperator)
    }
  }

  async function handleStart() {
    setError('')
    if (!primaryId)                    { setError('Select Operator 1'); return }
    if (primaryVerify !== 'verified')  { setError('Operator 1 must verify their PIN first'); return }
    if (!primaryOperator)              { setError('Operator 1 verification incomplete'); return }
    if (showSecondary) {
      if (!secondaryId)                   { setError('Select Operator 2 or remove the second slot'); return }
      if (secondaryVerify !== 'verified') { setError('Operator 2 must verify their PIN first'); return }
      if (!secondaryOperator)             { setError('Operator 2 verification incomplete'); return }
    }
    if (needsLot && !lotNumber.trim()) { setError('Lot / Batch number is required for this section'); return }
    if (needsVariant && !variant)      { setError('Select a variant before starting'); return }

    setSubmitting(true)
    onConfirm({
      primaryOperator: primaryOperator!,
      secondaryOperator: showSecondary && secondaryOperator ? secondaryOperator : undefined,
      shift,
      lotNumber: needsLot ? lotNumber.trim() : '',
      variant:   needsVariant ? variant : '',
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b border-black/10"
          style={{ background: cfg?.colorHex ?? '#1A3A0E' }}
        >
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <span className="font-mono font-bold text-[13px] text-white">{cfg?.code}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white text-[16px] leading-tight">{cfg?.name}</div>
            <div className="text-white/70 text-[11px]">{today}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">

          {!loading && allOperators.length === 0 && (
            <div className="px-4 py-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[13px] leading-relaxed">
              No floor operators are assigned to <strong>{cfg?.name ?? sectionId}</strong> yet.
              Ask your Production Supervisor or IT to add operators.
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 py-4 text-stone-400 text-[13px] justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading operators…
            </div>
          )}

          {!loading && allOperators.length > 0 && (
            <>
              {/* ── Operator 1 ── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Operator 1</span>
                  <span className="text-[10px] text-err font-medium">required</span>
                </div>

                <select
                  value={primaryId}
                  onChange={e => setPrimaryId(e.target.value)}
                  className={INP + ' cursor-pointer'}
                >
                  <option value="">Select operator…</option>
                  {primaryOptions.map(op => (
                    <option key={op.id} value={op.id}>
                      {op.name}{op.role === 'production_supervisor' ? ' (Supervisor)' : ''}
                    </option>
                  ))}
                </select>

                {/* key={primaryId} resets the uncontrolled input whenever the operator changes */}
                <PinBlock
                  key={primaryId}
                  label="Operator 1"
                  operatorId={primaryId}
                  verifyState={primaryVerify}
                  onVerify={pin => verifyPin(primaryId, pin, setPrimaryVerify, setPrimaryOperator)}
                  onClearVerify={() => { setPrimaryVerify('idle'); setPrimaryOperator(null) }}
                />
              </div>

              {/* ── Second operator toggle ── */}
              {!showSecondary ? (
                <button
                  type="button"
                  onClick={() => setShowSecondary(true)}
                  disabled={secondaryOptions.length === 0}
                  className="flex items-center gap-2 text-[13px] text-stone-500 hover:text-brand disabled:opacity-30 transition-colors py-1"
                >
                  <UserPlus size={15} />
                  Add second operator
                </button>
              ) : (
                <div className="space-y-3 border border-stone-100 rounded-2xl p-4 bg-stone-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Operator 2</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSecondary(false)
                        setSecondaryId('')
                        setSecondaryVerify('idle')
                        setSecondaryOperator(null)
                      }}
                      className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-err transition-colors"
                    >
                      <UserMinus size={13} /> Remove
                    </button>
                  </div>

                  <select
                    value={secondaryId}
                    onChange={e => setSecondaryId(e.target.value)}
                    className={INP + ' cursor-pointer'}
                  >
                    <option value="">Select operator…</option>
                    {secondaryOptions.map(op => (
                      <option key={op.id} value={op.id}>
                        {op.name}{op.role === 'production_supervisor' ? ' (Supervisor)' : ''}
                      </option>
                    ))}
                  </select>

                  {/* key={secondaryId} resets the uncontrolled input whenever the operator changes */}
                  <PinBlock
                    key={secondaryId}
                    label="Operator 2"
                    operatorId={secondaryId}
                    verifyState={secondaryVerify}
                    onVerify={pin => verifyPin(secondaryId, pin, setSecondaryVerify, setSecondaryOperator)}
                    onClearVerify={() => { setSecondaryVerify('idle'); setSecondaryOperator(null) }}
                  />
                </div>
              )}

              {/* ── Shift ── */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Shift</label>
                <div className="flex gap-2">
                  {shifts.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setShift(s)}
                      className={`flex-1 py-2.5 min-h-[44px] rounded-xl border font-medium text-[13px] capitalize transition-colors ${
                        shift === s
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white text-stone-600 border-stone-200 hover:border-brand/40'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Lot / Batch Number ── */}
              {needsLot && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Lot / Batch Number</label>
                  <input
                    type="text"
                    value={lotNumber}
                    onChange={e => setLotNumber(e.target.value)}
                    placeholder="e.g. GS-2026-001"
                    className={INP}
                  />
                </div>
              )}

              {/* ── Variant ── */}
              {needsVariant && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Variant</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(VARIANT_LABELS) as [Variant, string][]).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setVariant(v)}
                        className={`py-2.5 min-h-[44px] rounded-xl border font-medium text-[12px] transition-colors ${
                          variant === v
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white text-stone-600 border-stone-200 hover:border-brand/40'
                        }`}
                      >
                        <span className="font-mono font-bold block">{v}</span>
                        <span className="text-[10px] opacity-70">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Error ── */}
              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-err/8 border border-err/20 text-err text-[12px]">
                  <Lock size={13} className="flex-shrink-0" /> {error}
                </div>
              )}

              {/* ── Start ── */}
              <button
                onClick={handleStart}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3.5 min-h-[44px] rounded-xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40 hover:bg-brand-mid transition-colors"
              >
                {submitting && <Loader2 size={17} className="animate-spin" />}
                {submitting ? 'Starting…' : 'Start Session'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

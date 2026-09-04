'use client'

import { RefreshCw, Loader2 } from 'lucide-react'
import type { ChangeoverPlan } from '@/lib/core/changeover'

/**
 * The mid-shift grade/variant changeover confirmation.
 *
 * Shows the leftover mass balance before switching, because that is the
 * operator's cue to bag it out as Blocks / Heavy Sticks / Indent Sticks under
 * the new grade — or, if the batch is organic, that it must be closed off on
 * its own.
 *
 * Every branch below reads the SAME `ChangeoverPlan` the handler acts on. That
 * is the point of the split: the dialog cannot promise an option the handler
 * will then refuse (ARCHITECTURE.md §4, the recurring "gate validation on the
 * same condition as the render" class).
 *
 * `variantLabel` is passed in rather than looked up here. The feature has no
 * business knowing how the app spells its variants — that map lives in
 * lib/production/capture-config, and reaching into it from a feature is how a
 * feature stops being self-contained.
 */
export function ChangeoverDialog({ plan, variantLabel, busy, onConfirm, onCancel }: {
  plan: ChangeoverPlan
  variantLabel: string
  busy: boolean
  /** `carryMaterial` is the supervisor's explicit exception — see the handler. */
  onConfirm: (carryMaterial: boolean) => void
  onCancel: () => void
}) {
  const organicRefusal = !plan.mayCarry && plan.carryRefusal === 'organic'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9997, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-stone-100">
          <RefreshCw size={18} className="text-brand shrink-0" />
          <div className="font-semibold text-[15px] text-text">Changeover — switch grade/variant</div>
        </div>

        <div className="p-5 space-y-3">
          {organicRefusal ? (
            <p className="text-[13px] text-text-muted">
              This batch is <strong className="text-text">{variantLabel}</strong> — organic material must stay segregated, so this closes it off as its own record. The new grade/variant starts a fresh record with its own mass balance.
            </p>
          ) : (
            <>
              <p className="text-[13px] text-text-muted">
                This closes the current record off with its own mass balance, and starts a fresh one for the new grade/variant.
              </p>
              <p className="text-[13px] text-text-muted">
                Leftover raw material can still be bagged out as Blocks / Heavy Sticks / Indent Sticks under the new grade — it is just recorded against the new record rather than carried across.
              </p>
              {/* Only promise the second option where it is actually offered —
                  the SAME plan the button below reads. */}
              {plan.mayCarry && (
                <p className="text-[12px] text-text-muted">
                  If the leftover has <strong className="text-text">not</strong> all been bagged out and physically continues into the next run, use the second option — it carries the balance forward as material in.
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-5 pb-5 space-y-2">
          <button
            onClick={() => onConfirm(false)}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-brand-mid transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {busy ? 'Opening new record…' : 'Start a clean record'}
          </button>

          {/* The supervisor's explicit exception. Offered ONLY when the leftover
              has not all been bagged out, and NEVER for organic — organic and
              conventional are separate physical pools and must not combine (§5).
              Kept visually secondary to the clean start, which is what happens
              on almost every changeover. */}
          {plan.mayCarry ? (
            <button
              onClick={() => onConfirm(true)}
              disabled={busy}
              className="w-full px-4 py-2.5 rounded-xl border border-stone-200 text-stone-600 text-[13px] font-medium hover:border-brand hover:text-brand transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Continue leftover material into the new record
              {plan.leftoverKg > 0 ? ` (${plan.leftoverKg.toFixed(1)} kg)` : ''}
            </button>
          ) : plan.carryRefusal && plan.carryRefusal !== 'nothing-left' ? (
            // Say why rather than just omitting the option — a supervisor who
            // came to use it needs to know it was refused, not wonder whether
            // they mis-tapped.
            <p className="text-[11px] text-stone-400 px-1 text-center">{plan.carryRefusalReason}</p>
          ) : null}

          <button
            onClick={onCancel}
            disabled={busy}
            className="w-full px-4 py-2.5 rounded-xl text-stone-500 text-[13px] font-medium hover:bg-stone-50 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

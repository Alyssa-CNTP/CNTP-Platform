'use client'

import { RefreshCw } from 'lucide-react'
import type { ChangeoverPlan } from '@/lib/core/changeover'

/**
 * The entry point to a mid-shift grade/variant changeover.
 *
 * SUPERVISOR ONLY. A changeover closes the current record and opens a new one,
 * which is a decision about the production record rather than a capture action,
 * so it is gated on the same signal as sign-off.
 *
 * An operator sees WHY it is unavailable rather than a dead button. A control
 * that silently does nothing gets tapped repeatedly, and then reported as "the
 * changeover is broken" — which is a different bug from the one that exists.
 *
 * Everything it renders comes from the one `ChangeoverPlan`, so the button
 * cannot offer something the handler will refuse (ARCHITECTURE.md §4).
 */
export function ChangeoverTrigger({ plan, busy, onOpen }: {
  plan: ChangeoverPlan
  busy: boolean
  onOpen: () => void
}) {
  if (!plan.allowed) {
    return (
      <p className="text-[11px] text-stone-400 text-center">
        {plan.blockedReason} A changeover closes this record and opens a new one.
      </p>
    )
  }

  return (
    <button
      onClick={onOpen}
      disabled={busy}
      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-stone-200 text-stone-600 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <RefreshCw size={14} /> Changeover — switch grade/variant
    </button>
  )
}

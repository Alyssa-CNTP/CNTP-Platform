'use client'

import { useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'

/**
 * A small form dialog for the label approval steps.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The approval flow asked its questions through `window.prompt()` — three of
 * them, one after another, for the proof recipient, the Control Union reference
 * and the customer reference. That is wrong for this workflow in ways that are
 * not cosmetic:
 *
 *   - A browser prompt is chrome, not the app. It says
 *     "cntpplatform-staging.rooibostea.co.za says", which reads like a phishing
 *     dialog on the one screen where a person is recording a certification
 *     decision.
 *   - It takes ONE value at a time, so recording an approval meant answering
 *     two dialogs in sequence with no way to see or correct the first.
 *   - It cannot show what it is asking about, validate, or mark a field
 *     required. Cancel and Escape are indistinguishable from an empty answer.
 *   - Some browsers suppress repeat prompts entirely, which would silently
 *     skip a question.
 *
 * ── Reuse ──────────────────────────────────────────────────────────────────
 *
 * Built on `components/ui/BottomSheet`, the same primitive `ConfirmSheet` uses.
 * ConfirmSheet itself could not be reused — it takes no input fields — but the
 * sheet, the backdrop and the mobile behaviour are shared rather than a second
 * implementation (ARCHITECTURE.md §7).
 */

export interface DialogField {
  key: string
  label: string
  /** Shown under the input. Say what the value is FOR, not what it is. */
  hint?: string
  required?: boolean
  placeholder?: string
  multiline?: boolean
  /** Pre-filled when the dialog opens. */
  initial?: string
}

export function ActionDialog({
  open, title, message, fields, confirmLabel, busy, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  message?: string
  fields: readonly DialogField[]
  confirmLabel: string
  busy?: boolean
  onConfirm: (values: Record<string, string>) => void
  onCancel: () => void
}) {
  /**
   * Initialised once, from the fields. There is deliberately NO effect syncing
   * this to props: setState inside an effect triggers a cascading render (and
   * the react-hooks lint says so), and the reset it was there to do is what a
   * remount already gives for free. The caller renders this only while a step
   * is open and keys it by that step, so opening a different step mounts a
   * fresh dialog with fresh values — no stale half-typed certification
   * reference carried between them.
   */
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of fields) init[f.key] = f.initial ?? ''
    return init
  })

  const missing = fields.filter(f => f.required && !values[f.key]?.trim())
  const input =
    'w-full px-2.5 py-2 rounded-lg border border-surface-rule bg-surface text-sm text-text ' +
    'focus:outline-none focus:border-brand'

  return (
    <BottomSheet open={open} onClose={onCancel}>
      <div className="bg-surface-card rounded-2xl rounded-b-none lg:rounded-2xl p-6 w-full max-w-[460px] space-y-4">
        <div>
          <p className="font-display font-extrabold text-[18px] text-text leading-snug">{title}</p>
          {message && <p className="text-sm text-text-muted mt-1">{message}</p>}
        </div>

        <div className="space-y-3">
          {fields.map(f => (
            <label key={f.key} className="block">
              <span className="text-xs font-medium text-text-muted">
                {f.label}
                {/* Say which are optional rather than which are required: on
                    this form most are optional, and marking the majority is
                    noise that stops being read. */}
                {!f.required && <span className="text-text-faint"> · optional</span>}
              </span>
              {f.multiline ? (
                <textarea
                  rows={3}
                  className={input + ' mt-1 resize-y'}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  className={input + ' mt-1'}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
              {f.hint && <span className="text-[11px] text-text-faint mt-0.5 block">{f.hint}</span>}
            </label>
          ))}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-text-muted hover:bg-surface-dim disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(values)}
            disabled={busy || missing.length > 0}
            title={missing.length ? `Still needed: ${missing.map(f => f.label).join(', ')}` : undefined}
            className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-mid transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}

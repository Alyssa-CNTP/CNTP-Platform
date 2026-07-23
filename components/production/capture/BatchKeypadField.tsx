'use client'

import { Tag } from 'lucide-react'

/**
 * Text field for bag numbers / lot-serials. Uses the device's NATIVE keyboard
 * (no custom on-screen keypad) so it behaves like any normal input. Codes are
 * upper-cased as typed to match how they're written (e.g. S-135, G-0353).
 * Optional previously-used values show as tappable chips so a batch can be
 * reused without retyping.
 *
 * When `restrictToOptions` is set, free typing is disabled entirely — the
 * operator must tap one of `options`. This is used for output batch numbers,
 * which must match a lot that was actually debagged this session; typed entry
 * is how a `.` instead of `-`, a lowercase letter, or a dropped digit slipped
 * a batch that was never fed in into the record.
 */
export function BatchKeypadField({ value, onChange, label, options = [], placeholder, disabled, className, restrictToOptions }: {
  value: string
  onChange: (v: string) => void
  label?: string
  options?: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
  restrictToOptions?: boolean
}) {
  const uniqueOptions = Array.from(new Set(options.filter(Boolean)))

  if (restrictToOptions) {
    if (uniqueOptions.length === 0) {
      return (
        <p className="text-[12px] text-text-muted italic px-1 py-2">
          No batches debagged yet this session — capture a debagging row first.
        </p>
      )
    }
    return (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {uniqueOptions.map(o => {
          const active = o === value
          return (
            <button key={o} type="button" role="radio" aria-checked={active} disabled={disabled}
              onClick={() => onChange(o)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[13px] font-mono transition-colors disabled:opacity-40 ${
                active ? 'bg-brand text-white border-brand' : 'bg-brand/8 border-brand/20 text-brand hover:bg-brand/15'
              }`}>
              <Tag size={11} /> {o}
            </button>
          )
        })}
      </div>
    )
  }

  const matches = uniqueOptions.filter(o => o !== value).slice(0, 6)

  // Soft data-quality nudge: real batch codes are prefixed and dashed (GS-0270,
  // MAT-0231, SFC-KUN25-C). A value with no dash is almost always a dropped
  // prefix (e.g. "0270", "O324"). Never blocks — just flags the likely typo.
  const trimmed = value.trim()
  const looksUnprefixed = trimmed.length > 0 && !trimmed.includes('-')

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Tap to enter'}
        onChange={e => onChange(e.target.value.toUpperCase())}
        // Strip stray leading/trailing spaces when the operator leaves the field
        // (a trailing space made "MAT-0310 " read as a different lot).
        onBlur={e => { const v = e.target.value.trim().toUpperCase(); if (v !== value) onChange(v) }}
        className={`${className ?? ''} uppercase placeholder:normal-case placeholder:text-stone-300`}
      />

      {looksUnprefixed && !disabled && (
        <p className="text-[11px] text-amber-600 flex items-start gap-1">
          <span aria-hidden>⚠</span>
          <span>This looks like it's missing a prefix — batch numbers usually read like <span className="font-mono">GS-{trimmed}</span>. Double-check before saving.</span>
        </p>
      )}

      {/* Reuse a previous value — only while empty, to keep it tidy */}
      {!value && !disabled && matches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {matches.map(o => (
            <button key={o} type="button" onClick={() => onChange(o)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand/8 border border-brand/20 text-[12px] text-brand hover:bg-brand/15 transition-colors">
              <Tag size={11} /> {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

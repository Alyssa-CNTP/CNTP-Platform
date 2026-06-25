'use client'

import { Tag } from 'lucide-react'

/**
 * Text field for bag numbers / lot-serials. Uses the device's NATIVE keyboard
 * (no custom on-screen keypad) so it behaves like any normal input. Codes are
 * upper-cased as typed to match how they're written (e.g. S-135, G-0353).
 * Optional previously-used values show as tappable chips so a batch can be
 * reused without retyping.
 */
export function BatchKeypadField({ value, onChange, label, options = [], placeholder, disabled, className }: {
  value: string
  onChange: (v: string) => void
  label?: string
  options?: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const matches = options.filter(o => o && o !== value).slice(0, 6)

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
        className={`${className ?? ''} uppercase placeholder:normal-case placeholder:text-stone-300`}
      />

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

'use client'

import { useState } from 'react'
import { Delete, Check, Minus } from 'lucide-react'

/**
 * On-screen numeric keypad for machine-check readings on capture tablets.
 *
 * The device's native decimal pad has NO minus key, so a negative reading
 * (e.g. indent screen angle) can't be typed. This calculator-style pad gives
 * operators a reliable, large-target keypad including a dash — tap the field
 * to open it, tap keys to build the value.
 *
 * The value is kept with a period decimal ('.') so parseFloat-based range
 * checks and submission (ChecksPanel) keep working unchanged.
 */
export function NumericKeypad({
  value, onChange, allowNegative = false, allowDecimal = true, disabled = false,
  placeholder, invalid = false, className, label,
}: {
  value: string
  onChange: (v: string) => void
  allowNegative?: boolean
  allowDecimal?: boolean
  disabled?: boolean
  placeholder?: string
  invalid?: boolean
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)

  const negative = value.startsWith('-')

  function press(key: string) {
    if (key === '.') {
      if (!allowDecimal || value.includes('.')) return
      onChange(value === '' || value === '-' ? `${value}0.` : `${value}.`)
      return
    }
    onChange(value + key)
  }
  const backspace = () => onChange(value.slice(0, -1))
  const clear     = () => onChange('')
  const toggleSign = () => onChange(negative ? value.slice(1) : value === '' ? '-' : `-${value}`)

  return (
    <>
      {/* Tappable display — opens the pad */}
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`${className ?? ''} text-left ${invalid ? 'border-warn' : ''} ${value ? 'text-text' : 'text-stone-300'} disabled:opacity-60`}
      >
        {value || placeholder || 'Tap to enter'}
      </button>

      {open && !disabled && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-xs rounded-t-3xl sm:rounded-3xl shadow-2xl p-4 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            {label && <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest px-1">{label}</p>}

            {/* Current value readout */}
            <div className="w-full px-4 py-3 rounded-2xl border border-stone-200 bg-stone-50 text-right font-mono font-bold text-[24px] text-text min-h-[54px] flex items-center justify-end">
              {value || <span className="text-stone-300">0</span>}
            </div>

            {/* Keys */}
            <div className="grid grid-cols-3 gap-2">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(k => (
                <KeypadKey key={k} onClick={() => press(k)}>{k}</KeypadKey>
              ))}
              {allowNegative
                ? <KeypadKey onClick={toggleSign} tone="accent" aria-label="Toggle sign"><Minus size={20} /></KeypadKey>
                : allowDecimal
                  ? <KeypadKey onClick={() => press('.')}>.</KeypadKey>
                  : <span />}
              <KeypadKey onClick={() => press('0')}>0</KeypadKey>
              {allowNegative && allowDecimal
                ? <KeypadKey onClick={() => press('.')}>.</KeypadKey>
                : <KeypadKey onClick={backspace} tone="muted" aria-label="Backspace"><Delete size={20} /></KeypadKey>}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={clear}
                className="py-3 rounded-2xl border border-stone-200 text-[14px] font-medium text-stone-500 hover:border-brand hover:text-brand transition-colors">
                Clear
              </button>
              {/* Show a dedicated backspace here when the grid slot above was taken by the decimal key */}
              {allowNegative && allowDecimal
                ? <button type="button" onClick={backspace} aria-label="Backspace"
                    className="py-3 rounded-2xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand flex items-center justify-center transition-colors">
                    <Delete size={20} />
                  </button>
                : <span />}
              <button type="button" onClick={() => setOpen(false)}
                className="py-3 rounded-2xl bg-brand text-white text-[14px] font-semibold hover:bg-brand-mid flex items-center justify-center gap-1.5 transition-colors">
                <Check size={16} /> Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function KeypadKey({ children, onClick, tone = 'default', 'aria-label': ariaLabel }: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'muted' | 'accent'
  'aria-label'?: string
}) {
  const toneCls =
    tone === 'accent' ? 'bg-brand/10 text-brand hover:bg-brand/20 border-brand/20'
    : tone === 'muted' ? 'bg-stone-100 text-stone-500 hover:bg-stone-200 border-stone-200'
    : 'bg-white text-text hover:bg-stone-50 border-stone-200'
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`h-14 rounded-2xl border font-mono font-bold text-[20px] flex items-center justify-center transition-colors ${toneCls}`}
    >
      {children}
    </button>
  )
}

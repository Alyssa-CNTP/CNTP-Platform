'use client'

import { useState } from 'react'
import { Tag } from 'lucide-react'
import BatchKeypad from '@/components/count/BatchKeypad'

/**
 * Text field for bag numbers / lot-serials that opens the existing BatchKeypad
 * (the custom A–Z / 0–9 / - / / keypad) as a centred modal. Optional previously-
 * used values show as tappable chips so a batch can be reused without retyping.
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
  const [open, setOpen] = useState(false)
  const matches = options.filter(o => o && o !== value).slice(0, 6)

  return (
    <div className="space-y-1.5">
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}
        className={`${className ?? ''} flex items-center text-left disabled:opacity-60`}>
        {value || <span className="text-stone-300">{placeholder ?? 'Tap to enter'}</span>}
      </button>

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

      {open && !disabled && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}>
            <BatchKeypad
              label={label ?? 'Enter value'}
              initial={value}
              onConfirm={v => { onChange(v); setOpen(false) }}
              onCancel={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

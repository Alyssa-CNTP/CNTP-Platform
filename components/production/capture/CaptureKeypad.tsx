'use client'

import { useEffect, useState } from 'react'
import { Delete, Check } from 'lucide-react'

/**
 * Full-screen on-screen keypad for the live-capture fields. Built for tablets
 * and phones (big keys filling the screen) and fully usable on a laptop — the
 * physical keyboard is wired in (type digits/letters, comma or dot for the
 * decimal, Backspace, Enter/Esc to finish). Two modes:
 *   • number — digits + a comma decimal (stored as a real decimal downstream).
 *   • text   — A–Z, 0–9 and the serial characters - and /.
 */

const NUM_ROWS = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], [',', '0', '⌫']]
const TEXT_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-', '/', '⌫'],
]

export function CaptureKeypad({ mode, value, label, onChange, onClose }: {
  mode: 'number' | 'text'
  value: string
  label?: string
  onChange: (v: string) => void
  onClose: () => void
}) {
  const rows = mode === 'number' ? NUM_ROWS : TEXT_ROWS

  function press(k: string) {
    if (k === '⌫') { onChange(value.slice(0, -1)); return }
    if ((k === ',' || k === '.') && /[.,]/.test(value)) return   // only one decimal
    onChange(value + k)
  }

  // Laptop / physical keyboard support — type straight into the keypad.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); onClose(); return }
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Backspace') { e.preventDefault(); press('⌫'); return }
      if (mode === 'number') {
        if (/^[0-9]$/.test(e.key)) press(e.key)
        else if (e.key === ',' || e.key === '.') press(',')
      } else {
        if (/^[a-zA-Z0-9]$/.test(e.key)) press(e.key.toUpperCase())
        else if (e.key === '-' || e.key === '/') press(e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [value, mode])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[70] bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 shrink-0">
        <span className="text-[13px] font-bold uppercase tracking-wide text-stone-500">{label ?? 'Enter value'}</span>
        <button onClick={onClose} className="flex items-center gap-1.5 text-white font-bold text-[14px] px-5 py-2.5 rounded-xl bg-brand active:scale-95 transition-transform">
          <Check size={16} /> Done
        </button>
      </div>

      {/* Display */}
      <div className="px-4 pt-5 pb-3 shrink-0">
        <div className="bg-stone-50 border-2 border-stone-200 rounded-2xl px-5 min-h-[84px] flex items-center justify-center">
          <span className="font-mono font-bold text-[44px] leading-none text-text tracking-wide break-all py-4">
            {value || <span className="text-stone-300">—</span>}
          </span>
        </div>
        <p className="text-center text-[12px] text-stone-400 mt-2">Tap below, or type on your keyboard · Enter to finish</p>
      </div>

      {/* Keys — fill the rest of the screen */}
      <div className="flex-1 flex flex-col gap-2 px-3 pb-4 min-h-0">
        {rows.map((row, ri) => (
          <div key={ri} className="grid gap-2 flex-1 min-h-0" style={{ gridTemplateColumns: `repeat(${row.length}, 1fr)` }}>
            {row.map(k => (
              <button key={k} type="button" onPointerDown={e => { e.preventDefault(); press(k) }}
                className={`select-none active:scale-95 transition-transform rounded-2xl font-mono font-bold flex items-center justify-center
                  ${mode === 'number' ? 'text-[30px]' : 'text-[20px]'}
                  ${k === '⌫' ? 'bg-err/10 text-err' : 'bg-stone-50 border border-stone-200 text-stone-800 active:bg-brand/10'}`}>
                {k === '⌫' ? <Delete size={mode === 'number' ? 28 : 22} /> : k}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Field that looks like an input but opens the full-screen keypad when tapped. */
export function KeypadInput({ value, onChange, mode = 'number', placeholder, disabled, className, label }: {
  value: string
  onChange: (v: string) => void
  mode?: 'number' | 'text'
  placeholder?: string
  disabled?: boolean
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}
        className={`${className ?? ''} flex items-center text-left disabled:opacity-60`}>
        {value || <span className="text-stone-300">{placeholder ?? ''}</span>}
      </button>
      {open && !disabled && (
        <CaptureKeypad mode={mode} value={value} label={label} onChange={onChange} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

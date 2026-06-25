'use client'

import { useState } from 'react'
import { Delete, Check } from 'lucide-react'

/**
 * On-screen keypad for the live-capture fields, so operators never depend on the
 * device keyboard (which on SA phones offers a comma decimal that a number input
 * drops). Two modes:
 *   • number — digits + a comma decimal (stored as a real decimal downstream).
 *   • text   — A–Z, 0–9 and the serial characters - and /.
 * Tap a field (KeypadInput) to open it as a bottom sheet.
 */

const NUM_ROWS = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], [',', '0', '⌫']]
const TEXT_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-', '/'],
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
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/25" onClick={onClose}>
      <div className="bg-white border-t border-stone-200 rounded-t-2xl shadow-2xl w-full max-w-[460px] p-3 pb-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2.5 px-1">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">{label ?? 'Enter value'}</span>
          <button onClick={onClose} className="flex items-center gap-1.5 text-[12px] text-white font-bold px-3.5 py-1.5 rounded-lg bg-brand"><Check size={14} /> Done</button>
        </div>
        {/* Live display */}
        <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 mb-3 min-h-[52px] flex items-center">
          <span className="font-mono font-bold text-[22px] text-text tracking-wide break-all">
            {value || <span className="text-stone-300">—</span>}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((row, ri) => (
            <div key={ri} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${row.length}, 1fr)` }}>
              {row.map(k => (
                <button key={k} type="button" onPointerDown={e => { e.preventDefault(); press(k) }}
                  className={`select-none active:scale-95 transition-transform rounded-xl font-mono font-bold ${mode === 'number' ? 'py-4 text-[20px]' : 'py-3 text-[16px]'} ${k === '⌫' ? 'bg-err/10 text-err' : 'bg-stone-50 border border-stone-200 text-stone-800 active:bg-brand/10'}`}>
                  {k === '⌫' ? <Delete size={mode === 'number' ? 20 : 16} className="mx-auto" /> : k}
                </button>
              ))}
            </div>
          ))}
        </div>
        {mode === 'text' && (
          <button type="button" onPointerDown={e => { e.preventDefault(); press('⌫') }}
            className="mt-2 w-full py-2.5 rounded-xl bg-err/10 text-err font-medium text-[13px] flex items-center justify-center gap-1.5">
            <Delete size={15} /> Backspace
          </button>
        )}
      </div>
    </div>
  )
}

/** Field that looks like an input but opens the on-screen keypad when tapped. */
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

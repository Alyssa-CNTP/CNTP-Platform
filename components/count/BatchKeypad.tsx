'use client'

import { useState, useCallback } from 'react'
import { Delete } from 'lucide-react'

interface BatchKeypadProps {
  label:     string
  context?:  string
  initial?:  string
  onConfirm: (value: string) => void
  onCancel:  () => void
}

// Common batch number characters
const ROWS = [
  ['G','S','F','C','0','1'],
  ['2','3','4','5','6','7'],
  ['8','9','A','B','D','E'],
  ['H','I','J','K','L','M'],
  ['-','/','.','_',' ','⌫'],
]

export default function BatchKeypad({ label, context, initial = '', onConfirm, onCancel }: BatchKeypadProps) {
  const [val, setVal] = useState(initial.toUpperCase())

  const press = useCallback((ch: string) => {
    if (ch === '⌫') { setVal(p => p.slice(0, -1)); return }
    setVal(p => (p.length >= 20 ? p : p + ch))
  }, [])

  return (
    <div className="bg-surface-card rounded-2xl rounded-b-none lg:rounded-2xl p-5 w-full max-w-[400px]">
      <p className="font-mono text-[10px] tracking-[1px] uppercase text-text-muted mb-1">{label}</p>
      {context && (
        <p className="font-display font-bold text-base text-text mb-3 truncate">{context}</p>
      )}

      {/* Display */}
      <div className="bg-surface rounded-xl px-4 py-3 mb-4 min-h-[52px] flex items-center overflow-hidden">
        <span className="font-mono font-bold text-xl text-text tracking-widest break-all">
          {val || <span className="text-text-faint">—</span>}
        </span>
      </div>

      {/* Key rows */}
      <div className="flex flex-col gap-1.5 mb-3">
        {ROWS.map((row, ri) => (
          <div key={ri} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${row.length}, 1fr)` }}>
            {row.map(k => (
              <button
                key={k}
                onPointerDown={() => press(k)}
                className={`py-3 rounded-xl font-mono font-bold text-base text-text select-none
                  active:scale-[.91] transition-all
                  ${k === '⌫' ? 'bg-red-50 text-status-error active:bg-red-100' : 'bg-surface active:bg-surface-rule'}`}
              >
                {k}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Quick clear */}
      <button
        onClick={() => setVal('')}
        className="w-full py-2 text-xs font-mono text-text-muted hover:text-status-error transition-colors mb-3"
      >
        Clear
      </button>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onCancel}
          className="py-3.5 border border-surface-rule rounded-xl font-display font-bold text-base text-text-muted hover:bg-surface transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(val)}
          disabled={!val.trim()}
          className="py-3.5 bg-brand rounded-xl font-display font-bold text-base text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Confirm
        </button>
      </div>
    </div>
  )
}

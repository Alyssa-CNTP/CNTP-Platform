'use client'

import { useState, useCallback } from 'react'
import { Delete } from 'lucide-react'

interface NumKeypadProps {
  label:     string
  context?:  string
  initial?:  string
  allowDecimal?: boolean
  onConfirm: (value: string) => void
  onCancel:  () => void
}

export default function NumKeypad({
  label, context, initial = '', allowDecimal = true, onConfirm, onCancel,
}: NumKeypadProps) {
  const [val, setVal] = useState(initial)

  const press = useCallback((ch: string) => {
    setVal(prev => {
      if (ch === '.' && (!allowDecimal || prev.includes('.'))) return prev
      if (ch === '.' && prev === '') return '0.'
      if (prev === '0' && ch !== '.') return ch
      if (prev.length >= 8) return prev
      return prev + ch
    })
  }, [allowDecimal])

  const del = useCallback(() => setVal(p => p.slice(0, -1)), [])
  const clear = useCallback(() => setVal(''), [])

  const KEYS = ['7','8','9','4','5','6','1','2','3']

  return (
    <div className="bg-surface-card rounded-2xl rounded-b-none lg:rounded-2xl p-5 w-full max-w-[360px]">
      {/* Label */}
      <p className="font-mono text-[10px] tracking-[1px] uppercase text-text-muted mb-1">{label}</p>
      {context && (
        <p className="font-display font-bold text-base text-text mb-3 truncate">{context}</p>
      )}

      {/* Display */}
      <div className="bg-surface rounded-xl px-4 py-3 mb-4 text-right min-h-[64px] flex items-center justify-end overflow-hidden">
        <span className="font-mono font-bold text-3xl text-text break-all">
          {val || <span className="text-text-faint">0</span>}
        </span>
        <span className="font-mono text-base text-text-muted ml-1">kg</span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {KEYS.map(k => (
          <button
            key={k}
            onPointerDown={() => press(k)}
            className="py-4 bg-surface rounded-xl font-display font-extrabold text-2xl text-text active:bg-surface-rule active:scale-[.93] transition-all select-none"
          >
            {k}
          </button>
        ))}

        {/* Bottom row: . / 0 / del */}
        {allowDecimal ? (
          <button
            onPointerDown={() => press('.')}
            className="py-4 bg-surface rounded-xl font-display font-extrabold text-2xl text-text active:bg-surface-rule active:scale-[.93] transition-all select-none"
          >
            .
          </button>
        ) : (
          <button
            onPointerDown={clear}
            className="py-4 bg-surface rounded-xl font-mono text-sm text-text-muted active:bg-surface-rule active:scale-[.93] transition-all select-none"
          >
            CLR
          </button>
        )}
        <button
          onPointerDown={() => press('0')}
          className="py-4 bg-surface rounded-xl font-display font-extrabold text-2xl text-text active:bg-surface-rule active:scale-[.93] transition-all select-none"
        >
          0
        </button>
        <button
          onPointerDown={del}
          className="py-4 bg-red-50 rounded-xl flex items-center justify-center text-status-error active:bg-red-100 active:scale-[.93] transition-all select-none"
        >
          <Delete size={20} />
        </button>
      </div>

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
          disabled={!val}
          className="py-3.5 bg-brand rounded-xl font-display font-bold text-base text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Confirm
        </button>
      </div>
    </div>
  )
}

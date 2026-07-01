'use client'

// components/shared/QCNameField.tsx
//
// Type-ahead QC-name input — suggests matching names from the qms/production
// staff directory as you type, to prevent spelling mistakes and name
// mismatches across sieving, pasteuriser, and granule. Assistive, not a hard
// lock: picking a suggestion fills the field exactly; you can still type a
// name that isn't in the list (e.g. a fill-in QC not yet added to staff).

import { useState } from 'react'

interface QCNameFieldProps {
  value: string
  onChange: (name: string) => void
  names: string[]
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  autoFocus?: boolean
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

export default function QCNameField({ value, onChange, names, placeholder = 'QC name…', className, style, autoFocus, onBlur, onKeyDown }: QCNameFieldProps) {
  const [open, setOpen] = useState(false)

  const q = value.trim().toLowerCase()
  const matches = q === ''
    ? names.slice(0, 8)
    : names.filter(n => n.toLowerCase().includes(q)).slice(0, 8)

  return (
    <div style={{ position: 'relative' }}>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 100); onBlur?.() }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        style={style}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 30, left: 0, right: 0, marginTop: 2,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 180, overflowY: 'auto',
        }}>
          {matches.map(n => (
            <button key={n} type="button"
              onMouseDown={e => { e.preventDefault(); onChange(n); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
                fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#1f2937',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

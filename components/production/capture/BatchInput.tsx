'use client'

import { useState } from 'react'
import { Tag } from 'lucide-react'

/**
 * Batch / lot input with styled type-ahead suggestions (replaces the plain
 * native datalist). Shows matching previously-used batches as tappable chips
 * below the field while focused — reuse an existing batch instead of retyping.
 */
export function BatchInput({ value, onChange, options, placeholder, disabled, className }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const [focused, setFocused] = useState(false)
  const q = value.trim().toLowerCase()
  const matches = options
    .filter(o => o && o.toLowerCase() !== q && (q === '' || o.toLowerCase().includes(q)))
    .slice(0, 6)

  return (
    <div className="space-y-1.5">
      <input
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        className={className}
      />
      {focused && matches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {matches.map(o => (
            <button
              key={o}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(o) }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand/8 border border-brand/20 text-[12px] text-brand hover:bg-brand/15 transition-colors"
            >
              <Tag size={11} /> {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

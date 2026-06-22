'use client'

// components/logistics/ScanInput.tsx
// A focused, always-auto-focusing scan input that fires onScan after either:
//   1. The user presses Enter (USB scanner emits Enter as suffix), or
//   2. The user pauses typing for SCAN_DEBOUNCE_MS
//
// This component does NOT make any DB calls — it just produces the scanned text.
// Validation/lookup is the parent's responsibility.

import { useEffect, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'

const SCAN_DEBOUNCE_MS = 250

export interface ScanInputProps {
  label?:       string
  placeholder?: string
  onScan:       (value: string) => void | Promise<void>
  disabled?:    boolean
  autoFocus?:   boolean
  hint?:        string
}

export default function ScanInput({
  label, placeholder, onScan, disabled, autoFocus = true, hint,
}: ScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [value, setValue] = useState('')
  const [busy,  setBusy]  = useState(false)

  // Keep input focused — this is essential for USB scanner UX.
  useEffect(() => {
    if (!autoFocus) return
    const id = setInterval(() => {
      if (!disabled && document.activeElement !== inputRef.current) {
        inputRef.current?.focus()
      }
    }, 400)
    return () => clearInterval(id)
  }, [autoFocus, disabled])

  async function fire(v: string) {
    const trimmed = v.trim()
    if (!trimmed) return
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    setValue('')
    setBusy(true)
    try {
      await onScan(trimmed)
    } finally {
      setBusy(false)
      // restore focus on next tick
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setValue(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (v.trim()) fire(v)
    }, SCAN_DEBOUNCE_MS)
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      fire(value)
    }
  }

  return (
    <div className="w-full">
      {label && (
        <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1.5">
          {label}
        </div>
      )}
      <div className={`relative flex items-center rounded-lg border transition
                       ${busy ? 'border-info bg-info/5' : 'border-surface-rule bg-white'}
                       ${disabled ? 'opacity-50' : ''}`}>
        <ScanLine className={`absolute left-3 w-4 h-4 ${busy ? 'text-info animate-pulse' : 'text-text-muted'}`} />
        <input
          ref={inputRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKey}
          disabled={disabled || busy}
          placeholder={placeholder ?? 'Scan or type barcode…'}
          className="w-full bg-transparent pl-10 pr-3 py-2.5 text-sm font-mono tracking-wider focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {hint && (
        <div className="text-[11px] text-text-muted mt-1">{hint}</div>
      )}
    </div>
  )
}

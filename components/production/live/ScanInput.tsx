'use client'
import { useRef, useState, useCallback } from 'react'
import { ScanLine } from 'lucide-react'

interface Props {
  onScan: (serial: string) => void
  disabled?: boolean
  placeholder?: string
  label?: string
  /** When true, disables auto-refocus so form fields keep focus while typing */
  formOpen?: boolean
}

export default function ScanInput({
  onScan,
  disabled,
  placeholder = 'Scan barcode or type serial number…',
  label = 'Scan bag',
  formOpen = false,
}: Props) {
  const inputRef  = useRef<HTMLInputElement>(null)
  const [flash, setFlash] = useState(false)

  const refocus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const val = inputRef.current?.value.trim() ?? ''
    if (!val) return
    e.preventDefault()
    if (inputRef.current) inputRef.current.value = ''
    setFlash(true)
    setTimeout(() => setFlash(false), 300)
    onScan(val)
    refocus()
  }

  // Re-focus if the user accidentally clicks elsewhere on the page.
  // Disabled when formOpen=true so form inputs keep focus while typing.
  function handleBlur() {
    if (formOpen) return   // ← form is open: never steal focus
    setTimeout(() => {
      const active = document.activeElement
      const tag = active?.tagName ?? ''
      if (!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(tag)) {
        inputRef.current?.focus()
      }
    }, 150)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">{label}</label>
      <div
        className={`relative flex items-center rounded-2xl border-2 transition-all duration-200 ${
          flash
            ? 'border-ok bg-ok/5'
            : disabled
            ? 'border-stone-200 bg-stone-50 opacity-50'
            : 'border-stone-300 bg-white focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/8'
        }`}
      >
        <ScanLine
          size={22}
          className={`absolute left-4 flex-shrink-0 transition-colors pointer-events-none ${flash ? 'text-ok' : 'text-stone-400'}`}
        />
        <input
          ref={inputRef}
          type="text"
          autoFocus={!formOpen}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="w-full pl-12 pr-4 py-4 bg-transparent text-[15px] font-mono text-text outline-none placeholder:text-stone-400 placeholder:font-sans placeholder:text-[13px] disabled:cursor-not-allowed"
        />
      </div>
      <p className="text-[10px] text-stone-400 px-1">Press Enter after typing, or scan with USB barcode reader</p>
    </div>
  )
}

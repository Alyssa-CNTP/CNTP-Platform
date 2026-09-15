'use client'

// components/shared/Explain.tsx
//
// An info button that says how a number was arrived at.
//
// Every figure on a batch or bag record is derived — from a mass balance, from
// a view, from a sum across sessions — and a supervisor challenging one has no
// way to see which. "Yield 68%" against a paper sheet saying 71% is an argument
// nobody can settle from the screen, so the number gets distrusted wholesale.
//
// This shows the actual derivation, in the same words the code uses, next to
// the value it produced. Where a rule has an incident behind it (the ±1%
// tolerance, output excluding carry-over) the explanation says so — that is
// the part people most often think is a bug.
//
// Deliberately NOT a `title` attribute: those do not appear on the tablets the
// floor uses, which is most of where this is read.

import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'

export default function Explain({
  label,
  children,
  align = 'left',
}: {
  /** What is being explained — announced to screen readers. */
  label: string
  /** The derivation. Short paragraphs; this is read standing at a machine. */
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const id = useId()

  // Close on an outside click or Escape. Without this the popover stays open
  // behind the next one the operator taps, and two explanations overlap.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="relative inline-flex items-center align-middle">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        aria-label={`How ${label} is calculated`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-text-faint hover:text-brand hover:bg-brand/10 transition-colors"
      >
        <Info size={11} />
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          // max-w in ch so the line length stays readable rather than tracking
          // the container; z above the modal's own sticky header.
          className={`absolute top-6 z-50 w-[min(92vw,42ch)] rounded-xl border border-surface-rule bg-surface-card p-3 text-left shadow-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-text-faint mb-1.5">
            How {label} is calculated
          </span>
          <span className="block text-[12px] leading-relaxed text-text-muted space-y-1.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-text [&_strong]:text-text [&_strong]:font-semibold">
            {children}
          </span>
        </span>
      )}
    </span>
  )
}

'use client'
// FormSheet — fixed-position bottom sheet overlay for capture forms.
// Lives OUTSIDE the scrollable page container so iOS keyboard appearance
// never causes layout shift or focus loss mid-typing.
// Mobile: slides up from bottom. Tablet/desktop: centred modal.

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface FormSheetProps {
  open:         boolean
  onClose:      () => void
  title:        string
  accentColor?: string         // hex colour for the header strip
  children:     React.ReactNode
  footer?:      React.ReactNode // action buttons — rendered sticky at the bottom
}

export default function FormSheet({
  open, onClose, title, accentColor = '#1A3A0E', children, footer,
}: FormSheetProps) {

  // Lock background scroll while the sheet is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    // Fixed full-screen overlay — completely outside the page scroll flow
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '92dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle (mobile only) */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/30" style={{ background: accentColor + '60' }} />
        </div>

        {/* Coloured header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0 rounded-t-3xl sm:rounded-t-2xl"
          style={{ background: accentColor }}
        >
          <h2 className="font-semibold text-[15px] text-white leading-tight">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.18)' }}
          >
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 overscroll-contain">
          {children}
        </div>

        {/* Sticky footer — action buttons */}
        {footer && (
          <div className="flex-shrink-0 px-5 pb-6 pt-3 border-t border-stone-100 bg-white space-y-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

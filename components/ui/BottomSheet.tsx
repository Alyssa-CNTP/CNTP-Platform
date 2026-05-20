'use client'

import { useEffect } from 'react'
import clsx from 'clsx'

interface BottomSheetProps {
  open:     boolean
  onClose:  () => void
  children: React.ReactNode
  center?:  boolean   // center on desktop
}

export default function BottomSheet({ open, onClose, children, center = true }: BottomSheetProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={clsx(
          'w-full animate-slide-up',
          center ? 'lg:w-auto lg:min-w-[360px] lg:max-w-[420px]' : ''
        )}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .animate-slide-up { animation: slide-up .18s ease both; }
      `}</style>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Info, X } from 'lucide-react'

// A small "where am I / where do I go" info button for the top of a page —
// distinct from any page-specific "how this feature works" help modal.
// Content should answer: who is this page for, what does it actually do,
// and where do the related pieces of this system live.
export function PageInfoButton({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} title="Where does this fit?"
        className="p-1 rounded-full text-stone-300 hover:text-brand hover:bg-brand/8 transition-colors shrink-0">
        <Info size={15} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[480px] max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-[15px] text-text flex items-center gap-1.5">
                <Info size={14} className="text-brand" /> {title}
              </h3>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={15} /></button>
            </div>
            <div className="text-[12.5px] text-text-muted leading-relaxed space-y-2.5">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

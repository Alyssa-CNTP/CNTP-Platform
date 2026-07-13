'use client'

import Link from 'next/link'
import { ChevronRight, Lock } from 'lucide-react'

export interface HubCardDef {
  href:        string
  label:       string
  description: string
  icon:        React.ElementType
  visible?:    boolean   // defaults true — pass a permission check to hide entirely
  accent?:     string    // hex color for the icon chip; defaults to brand
}

// Shared card tile used by the HR hub (/hr) and the Training hub (/training)
// to navigate into a module/section. Each section still enforces its own
// route guard — this is just the entry point, so hiding a card here is a
// convenience, not the security boundary.
export function HubCard({ href, label, description, icon: Icon, accent }: HubCardDef) {
  return (
    <Link href={href}
      className="flex items-start gap-3 bg-surface-card border border-surface-rule rounded-2xl p-4 hover:border-brand/40 hover:shadow-sm transition-all group">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accent ?? '#1A3A0E'}14`, color: accent ?? '#1A3A0E' }}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-semibold text-[14px] text-text">{label}</h3>
        <p className="text-[12px] text-text-muted mt-0.5 leading-snug">{description}</p>
      </div>
      <ChevronRight size={15} className="text-stone-300 group-hover:text-brand transition-colors shrink-0 mt-1" />
    </Link>
  )
}

export function LockedCard({ label, description, icon: Icon }: { label: string; description: string; icon: React.ElementType }) {
  return (
    <div className="flex items-start gap-3 bg-surface-card border border-surface-rule rounded-2xl p-4 opacity-50 cursor-not-allowed">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-stone-100 text-stone-400">
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-semibold text-[14px] text-text">{label}</h3>
        <p className="text-[12px] text-text-muted mt-0.5 leading-snug">{description}</p>
      </div>
      <Lock size={13} className="text-stone-300 shrink-0 mt-1" />
    </div>
  )
}

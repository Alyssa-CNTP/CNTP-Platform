'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import {
  Megaphone, BookOpen, LifeBuoy, ExternalLink, Leaf, ArrowRight,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'

// General-information landing — company-facing home. This is an intentional
// placeholder skeleton: the real content (announcements, links, docs) will be
// designed later. Production/operational dashboards live under their own
// sidebar groups, role-gated.
export default function HomePage() {
  const { displayName } = useAuth()
  const firstName = (displayName ?? '').split(' ')[0] || 'there'
  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  const quickLinks = [
    { href: '/dashboard',          label: 'Command Centre', desc: 'Live operations overview', icon: ArrowRight },
    { href: '/production/capture', label: 'Capture',        desc: 'Record production for your shift', icon: ArrowRight },
    { href: '/supervisor',         label: 'Supervisor Hub', desc: 'Sign-offs, timesheets & analytics', icon: ArrowRight },
  ]

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-6">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-[24px] text-text">{greeting}, {firstName}</h1>
          <p className="text-[12px] text-stone-400 mt-0.5">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-brand">
          <Leaf size={18} />
          <span className="font-display font-semibold text-[14px]">Cape Natural</span>
        </div>
      </div>

      {/* Announcements — placeholder */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Megaphone size={15} className="text-brand" />
          <span className="font-display font-bold text-[14px] text-text">Announcements</span>
        </div>
        <p className="text-[13px] text-text-muted">
          Company news and updates will appear here. This page is a placeholder — content and layout are still being designed.
        </p>
      </div>

      {/* Quick links */}
      <div>
        <h3 className="font-display font-bold text-[13px] text-text-muted uppercase tracking-wide mb-3">Quick links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quickLinks.map(l => (
            <Link key={l.href} href={l.href}
              className="flex items-start gap-3 bg-surface-card border border-surface-rule rounded-2xl p-4 hover:border-brand/40 hover:bg-surface transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="font-body font-semibold text-[14px] text-text">{l.label}</div>
                <div className="text-[12px] text-text-muted">{l.desc}</div>
              </div>
              <l.icon size={16} className="text-stone-300 group-hover:text-brand transition-colors mt-0.5" />
            </Link>
          ))}
        </div>
      </div>

      {/* Resources — placeholder */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={15} className="text-text-muted" />
            <span className="font-display font-bold text-[14px] text-text">Handbook & policies</span>
          </div>
          <p className="text-[13px] text-text-muted flex items-center gap-1.5">
            Coming soon <ExternalLink size={12} />
          </p>
        </div>
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <LifeBuoy size={15} className="text-text-muted" />
            <span className="font-display font-bold text-[14px] text-text">Help & support</span>
          </div>
          <p className="text-[13px] text-text-muted">
            Need something? Raise a request via <Link href="/axis/request" className="text-brand hover:underline">Submit Request</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}

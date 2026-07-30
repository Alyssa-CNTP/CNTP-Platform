'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, CalendarRange, PenLine, FileText, Users, MessageSquare } from 'lucide-react'

// Sub-nav for the Supervisor Hub. Six tabs, each with exactly ONE job — the
// previous layout mixed "things needing your signature" into the roster grid,
// so the tab label told you where you were but the page showed you three
// unrelated jobs at once. The rule now: if it needs a signature it lives on
// Sign-off; if it's about who works where it lives on Roster; nothing appears
// on two tabs.
//
//   Dashboard   — today at a glance; the only place with a summary
//   Roster      — who is on which line, day-to-day changes, send to the manager
//   Sign-off    — ONLY things still outstanding: sessions, job cards, reopens
//   Shift Report— the generated end-of-shift record
//   Team        — capture ratings (performance & accuracy) + timesheets
//   Messages    — per-line threads with the floor
//
// /supervisor/productions was retired — it was a second copy of
// /production/orders, which is where production-order history and its KPIs now
// live. The route redirects there so old links and bookmarks still work.
const TABS = [
  { href: '/supervisor',         label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/supervisor/roster',  label: 'Roster',       icon: CalendarRange },
  { href: '/supervisor/signoff', label: 'Sign-off',     icon: PenLine },
  { href: '/supervisor/report',  label: 'Shift Report', icon: FileText },
  { href: '/supervisor/team',    label: 'Team',         icon: Users },
  { href: '/supervisor/messages',label: 'Messages',     icon: MessageSquare },
] as const

export function HubTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-stone-200 overflow-x-auto">
      {TABS.map(t => {
        // /supervisor is an exact match only — otherwise it would light up on
        // every child route.
        const active = t.href === '/supervisor' ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link key={t.href} href={t.href}
            className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors -mb-px whitespace-nowrap ${active ? 'border-brand text-brand' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>
            <t.icon size={14} /> {t.label}
          </Link>
        )
      })}
    </div>
  )
}

// Shared page header for every Hub tab: the hub title, a per-tab title and
// subtitle, the tab bar, and an optional right-aligned action. Each tab names
// itself (`title`) so the page you're on is obvious from the heading, not only
// from which tab is underlined.
export function HubHeader({ title, subtitle, action }: {
  title?: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">Supervisor Hub</p>
          <h1 className="font-display font-bold text-[22px] text-text leading-tight">{title ?? 'Supervisor Hub'}</h1>
          {subtitle && <p className="text-[12px] text-stone-400 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="mt-1 shrink-0">{action}</div>}
      </div>
      <HubTabs />
    </>
  )
}

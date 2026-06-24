'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarRange, Users, ClipboardList } from 'lucide-react'

// Shared sub-nav for the workforce/people pages so they're one click apart:
// the monthly Shift Roster, the Staff Directory, and the daily section
// assignment. Mirrors the Supervisor Hub tab styling.
const TABS = [
  { href: '/production/roster',         label: 'Shift Roster',    icon: CalendarRange },
  { href: '/production/staff',          label: 'Staff Directory', icon: Users },
  { href: '/production/capture/assign', label: 'Assign Sections', icon: ClipboardList },
] as const

export function WorkforceTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-stone-200 overflow-x-auto">
      {TABS.map(t => {
        const active = pathname === t.href
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

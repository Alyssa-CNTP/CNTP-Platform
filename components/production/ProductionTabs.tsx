'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, BarChart2, CalendarRange } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'

// Top-level nav for the Production Dashboard hub. Analytics (production control)
// and Planning (roster + staff) live here as tabs of the dashboard rather than
// as separate sidebar sections. Analytics is management-only.
export function ProductionTabs() {
  const pathname = usePathname()
  const { canAccessManagement } = useAuth()

  const tabs = [
    { href: '/production/dashboard',  label: 'Dashboard',  icon: LayoutDashboard, match: ['/production/dashboard'] },
    { href: '/production/operations', label: 'Analytics',  icon: BarChart2,       match: ['/production/operations'], show: canAccessManagement },
    { href: '/production/roster',     label: 'Planning',   icon: CalendarRange,   match: ['/production/roster', '/production/staff'] },
  ].filter(t => t.show !== false)

  return (
    <div className="flex items-center gap-1 border-b border-stone-200 overflow-x-auto">
      {tabs.map(t => {
        const active = t.match.some(m => pathname === m || pathname.startsWith(m + '/'))
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

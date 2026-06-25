'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Map } from 'lucide-react'

// Top-level nav for the Production hub. Analytics now lives inside the Dashboard,
// and Shift Rosters moved out to its own Operations page — so the hub is just the
// live Dashboard and the (accurate, dimensioned) factory Floor Plan.
export function ProductionTabs() {
  const pathname = usePathname()

  const tabs = [
    { href: '/production/dashboard',  label: 'Dashboard',  icon: LayoutDashboard, match: ['/production/dashboard'] },
    { href: '/production/floor-plan', label: 'Floor Plan', icon: Map,             match: ['/production/floor-plan'] },
  ]

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

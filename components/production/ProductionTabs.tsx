'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Map, Zap, FileText } from 'lucide-react'

// Top-level nav for the Production hub: the live Dashboard cockpit, the deeper
// Yield & Batch Analytics report (batch-spine driven), the (accurate,
// dimensioned) factory Floor Plan, the Energy tab, and Shift Reports.
// Shift Rosters live on their own Operations page.
export function ProductionTabs() {
  const pathname = usePathname()

  const tabs = [
    { href: '/production/dashboard',      label: 'Dashboard',      icon: LayoutDashboard, match: ['/production/dashboard'] },
    { href: '/production/floor-plan',     label: 'Floor Plan',     icon: Map,             match: ['/production/floor-plan'] },
    { href: '/production/energy',         label: 'Energy',         icon: Zap,             match: ['/production/energy'] },
    { href: '/production/shift-reports',  label: 'Shift Reports',  icon: FileText,        match: ['/production/shift-reports'] },
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

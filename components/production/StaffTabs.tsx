'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, BarChart2, BookOpen, CalendarRange, GraduationCap } from 'lucide-react'

const TABS = [
  { href: '/production/staff',        label: 'Directory',      icon: Users       },
  { href: '/production/staff/matrix', label: 'Skills Matrix',  icon: BarChart2   },
  { href: '/production/staff/sops',   label: 'SOP Catalogue',  icon: BookOpen    },
] as const

export function StaffTabs() {
  const pathname = usePathname()

  // Exact match for Directory (otherwise /staff/matrix also matches /staff)
  const isActive = (href: string) =>
    href === '/production/staff'
      ? pathname === '/production/staff' || pathname.startsWith('/production/staff/') && !TABS.slice(1).some(t => pathname.startsWith(t.href))
      : pathname === href || pathname.startsWith(href + '/')

  return (
    <div>
      <div className="flex items-center justify-between border-b border-stone-200">
        <div className="flex items-center gap-0 overflow-x-auto">
          {TABS.map(t => (
            <Link key={t.href} href={t.href}
              className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors -mb-px whitespace-nowrap ${
                isActive(t.href)
                  ? 'border-brand text-brand'
                  : 'border-transparent text-stone-400 hover:text-stone-700'
              }`}>
              <t.icon size={14} /> {t.label}
            </Link>
          ))}
        </div>

        {/* Cross-references to related HR modules — always one click away */}
        <div className="flex items-center">
          <Link href="/training"
            className="flex items-center gap-1.5 px-4 py-3 text-[12px] font-medium text-stone-400 hover:text-brand transition-colors whitespace-nowrap border-b-2 border-transparent -mb-px">
            <GraduationCap size={13} />
            Training
          </Link>
          <Link href="/production/roster"
            className="flex items-center gap-1.5 px-4 py-3 text-[12px] font-medium text-stone-400 hover:text-brand transition-colors whitespace-nowrap border-b-2 border-transparent -mb-px">
            <CalendarRange size={13} />
            Shift Roster
          </Link>
        </div>
      </div>
    </div>
  )
}

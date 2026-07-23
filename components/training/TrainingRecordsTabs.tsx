'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, BarChart2, BookOpen } from 'lucide-react'

const TABS = [
  { href: '/training/skills', label: 'Skills Matrix', icon: BarChart2 },
  { href: '/training/sops',   label: 'SOP Catalogue',  icon: BookOpen  },
] as const

// Tab bar for the "Records & standards" pages under Training — mirrors
// components/production/StaffTabs.tsx's pattern, scoped to just these two
// (Skills Matrix + SOP Catalogue moved out of Staff & Skills into Training).
export function TrainingRecordsTabs() {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <div>
      <Link href="/training" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand mb-3">
        <ArrowLeft size={13} /> Training
      </Link>
      <div className="flex items-center gap-0 overflow-x-auto border-b border-stone-200">
        {TABS.map(t => (
          <Link key={t.href} href={t.href}
            className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors -mb-px whitespace-nowrap ${
              isActive(t.href) ? 'border-brand text-brand' : 'border-transparent text-stone-400 hover:text-stone-700'
            }`}>
            <t.icon size={14} /> {t.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

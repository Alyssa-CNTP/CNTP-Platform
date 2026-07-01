'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarRange, Users } from 'lucide-react'

// Planning sub-nav: only the Shift Roster tab (Staff Directory now lives under
// the Staff & Skills section). Mirrors the StaffTabs cross-reference pattern —
// a right-side link keeps the two sections one click apart.
export function WorkforceTabs() {
  const pathname = usePathname()
  const active = pathname === '/production/roster' || pathname.startsWith('/production/roster/')
  return (
    <div className="flex items-center justify-between border-b border-stone-200">
      <div className="flex items-center gap-0 overflow-x-auto">
        <Link href="/production/roster"
          className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors -mb-px whitespace-nowrap ${active ? 'border-brand text-brand' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>
          <CalendarRange size={14} /> Shift Roster
        </Link>
      </div>

      {/* Cross-reference to Staff & Skills — always one click away */}
      <Link href="/production/staff"
        className="flex items-center gap-1.5 px-4 py-3 text-[12px] font-medium text-stone-400 hover:text-brand transition-colors whitespace-nowrap border-b-2 border-transparent -mb-px">
        <Users size={13} />
        Staff &amp; Skills
      </Link>
    </div>
  )
}

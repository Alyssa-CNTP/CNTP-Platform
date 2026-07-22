'use client'

import Link from 'next/link'
import { CalendarRange, GraduationCap } from 'lucide-react'

// Staff Directory is now just people + how they sign in (Skills Matrix and
// the SOP Catalogue moved to Training — the qualification home). With only
// one page left in this area there's nothing left to tab between, so this is
// just a slim cross-link row to the two modules a directory entry feeds into.
export function StaffTabs() {
  return (
    <div className="flex items-center justify-end gap-1 border-b border-stone-200 pb-0">
      <Link href="/training"
        className="flex items-center gap-1.5 px-4 py-3 text-[12px] font-medium text-stone-400 hover:text-brand transition-colors whitespace-nowrap">
        <GraduationCap size={13} />
        Training
      </Link>
      <Link href="/production/roster"
        className="flex items-center gap-1.5 px-4 py-3 text-[12px] font-medium text-stone-400 hover:text-brand transition-colors whitespace-nowrap">
        <CalendarRange size={13} />
        Shift Roster
      </Link>
    </div>
  )
}

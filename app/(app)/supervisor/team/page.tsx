'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Trophy, Clock } from 'lucide-react'
import { HubHeader } from '@/components/supervisor/HubTabs'
import { CaptureRatings } from '@/components/supervisor/CaptureRatings'
import { TimesheetsPanel } from '@/components/supervisor/TimesheetsPanel'

// Supervisor Hub → Team. Everything about the PEOPLE on the shift, in one tab:
// how they scored (capture ratings) and how long they were here (timesheets).
// Timesheets used to be its own top-level tab, which made the hub seven tabs
// wide for two views of the same subject.

export default function SupervisorTeam() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>}>
      <TeamInner />
    </Suspense>
  )
}

function TeamInner() {
  const params = useSearchParams()
  // ?view=timesheets keeps the old /supervisor/timesheets links working — that
  // route now redirects here with this parameter set.
  const [view, setView] = useState<'ratings' | 'timesheets'>(
    params.get('view') === 'timesheets' ? 'timesheets' : 'ratings',
  )

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5">
      <HubHeader
        title="Team"
        subtitle={view === 'ratings'
          ? 'Performance and data accuracy per rostered person — this week’s board'
          : 'Operator hours, derived from capture activity'}
      />

      <div className="flex gap-1 p-1 bg-stone-100 rounded-lg w-max">
        {([['ratings', 'Ratings', Trophy], ['timesheets', 'Timesheets', Clock]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${view === v ? 'bg-white text-brand shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {view === 'ratings' ? <CaptureRatings /> : <TimesheetsPanel />}
    </div>
  )
}

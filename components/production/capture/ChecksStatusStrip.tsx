'use client'

import { useState, useEffect } from 'react'
import { Gauge, ChevronRight } from 'lucide-react'
import { SHIFT_END_HOUR, HOURLY_NUDGE_MINUTES } from '@/lib/production/checks-config'
import { loadCheckRecord } from '@/lib/production/checks-db'

/**
 * Just-in-time prompt shown on the Production tab so the operator is pulled to
 * the right machine check at the right time. Self-contained — reads the checks
 * record/events directly and re-evaluates every minute. Tapping opens the tab.
 */
export function ChecksStatusStrip({ sectionId, date, shift, running, onOpen }: {
  sectionId: string; date: string; shift: string; running: boolean; onOpen: () => void
}) {
  const [signed, setSigned]     = useState(false)
  const [lastVsd, setLastVsd]   = useState<number | null>(null) // epoch ms of last VSD reading
  const [hasEvents, setHasEvents] = useState(false)
  const [now, setNow]           = useState<number>(() => Date.now())

  async function refresh() {
    const { record, events } = await loadCheckRecord(sectionId, date, shift)
    setSigned(!!record && record.status !== 'in_progress')
    setHasEvents(events.length > 0)
    const vsd = events.filter((e: any) => e.check_key === 'infeed_vsd')
    setLastVsd(vsd.length ? new Date(vsd[vsd.length - 1].recorded_at).getTime() : null)
  }

  useEffect(() => { refresh() }, [sectionId, date, shift, running])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (signed) return null

  const minsSinceVsd = lastVsd ? (now - lastVsd) / 60000 : Infinity
  const vsdDue = running && (lastVsd === null || minsSinceVsd >= HOURLY_NUDGE_MINUTES)
  const hour = new Date(now).getHours()
  const endHour = SHIFT_END_HOUR[shift] ?? 16
  const shutdownDue = hour === (endHour + 23) % 24

  let msg: string | null = null
  if (vsdDue)            msg = lastVsd === null ? 'Log the first infeed VSD reading' : 'VSD reading due — log this hour\'s reading'
  else if (shutdownDue)  msg = 'Shut-down checks due — rotex clean + mass balance'
  else if (!hasEvents && !running) msg = 'Start-up checks pending'
  if (!msg) return null

  return (
    <button onClick={onOpen}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-warn/8 border border-warn/30 rounded-xl text-[12px] text-warn font-medium hover:bg-warn/12 transition-colors">
      <Gauge size={15} className="shrink-0" />
      <span className="flex-1 text-left">{msg}</span>
      <ChevronRight size={15} className="shrink-0" />
    </button>
  )
}

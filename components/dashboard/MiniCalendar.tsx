'use client'

import { useState, useMemo } from 'react'
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, isSameMonth, isToday, addMonths, subMonths,
} from 'date-fns'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

interface ScSession {
  id:                string
  count_date:        string
  comparison_status: string | null
  sup_confirmed_at:  string | null
  adm_confirmed_at:  string | null
  match_rate_pct:    number | null
}

interface Props {
  sessions: ScSession[]
}

// Build a map of date → session for quick lookup
function buildSessionMap(sessions: ScSession[]) {
  const map = new Map<string, ScSession>()
  for (const s of sessions) map.set(s.count_date, s)
  return map
}

export default function MiniCalendar({ sessions }: Props) {
  const [viewDate, setViewDate] = useState(new Date())

  const sessionMap = useMemo(() => buildSessionMap(sessions), [sessions])

  const days = useMemo(() => {
    const start = startOfMonth(viewDate)
    const end   = endOfMonth(viewDate)
    return eachDayOfInterval({ start, end })
  }, [viewDate])

  // Day-of-week offset so grid starts on Monday (0=Mon)
  const startOffset = (getDay(days[0]) + 6) % 7

  const getDayStatus = (day: Date) => {
    const key = format(day, 'yyyy-MM-dd')
    const s   = sessionMap.get(key)
    if (!s) return 'none'
    if (!s.sup_confirmed_at) return 'pending'
    if (s.comparison_status === 'differences') return 'variance'
    if (s.adm_confirmed_at) return 'complete'
    return 'partial'
  }

  const getSelectedSession = useMemo(() => {
    // Show the most recent completed session info in the footer
    const completed = sessions.filter(s => s.adm_confirmed_at && s.sup_confirmed_at)
    return completed[0] ?? null
  }, [sessions])

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-surface-rule flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-brand" />
          <span className="font-display font-bold text-[14px] text-text">Calendar</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewDate(d => subMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-surface text-text-muted hover:text-text transition-colors"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="font-mono text-[12px] text-text w-28 text-center">
            {format(viewDate, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setViewDate(d => addMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-surface text-text-muted hover:text-text transition-colors"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="p-4 flex-1">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-2">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} className="text-center font-mono text-[10px] text-text-faint py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-y-1">
          {/* Offset empty cells */}
          {Array.from({ length: startOffset }).map((_, i) => (
            <div key={`offset-${i}`} />
          ))}

          {days.map(day => {
            const status = getDayStatus(day)
            const today  = isToday(day)
            const inMonth = isSameMonth(day, viewDate)

            const dotColor =
              status === 'complete'  ? 'bg-ok' :
              status === 'variance'  ? 'bg-warn' :
              status === 'partial'   ? 'bg-info' :
              status === 'pending'   ? 'bg-text-faint' :
              null

            return (
              <div
                key={day.toISOString()}
                className={`
                  relative flex flex-col items-center justify-center
                  rounded-lg py-1.5 aspect-square
                  ${today
                    ? 'bg-brand text-white font-bold'
                    : status !== 'none'
                      ? 'bg-surface hover:bg-surface-raised cursor-default'
                      : 'hover:bg-surface cursor-default'
                  }
                  ${!inMonth ? 'opacity-30' : ''}
                `}
              >
                <span className={`font-mono text-[12px] ${today ? 'text-white' : 'text-text'}`}>
                  {format(day, 'd')}
                </span>
                {/* Status dot */}
                {dotColor && !today && (
                  <span className={`absolute bottom-1 w-1 h-1 rounded-full ${dotColor}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend + recent session summary */}
      <div className="px-4 pb-4 shrink-0 space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          {[
            { color: 'bg-ok',         label: 'Match' },
            { color: 'bg-warn',       label: 'Variance' },
            { color: 'bg-info',       label: 'Partial' },
            { color: 'bg-text-faint', label: 'Pending' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${item.color}`} />
              <span className="font-mono text-[10px] text-text-muted">{item.label}</span>
            </div>
          ))}
        </div>

        {getSelectedSession && (
          <div className="bg-surface rounded-xl px-3 py-2.5 border border-surface-rule">
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">
              Most recent count
            </div>
            <div className="flex items-center justify-between">
              <span className="font-display font-bold text-[13px] text-text">
                {format(parseISO(getSelectedSession.count_date), 'd MMM yyyy')}
              </span>
              <span className={`font-display font-bold text-[15px] ${
                (getSelectedSession.match_rate_pct ?? 0) >= 99 ? 'text-ok' :
                (getSelectedSession.match_rate_pct ?? 0) >= 95 ? 'text-info' : 'text-warn'
              }`}>
                {getSelectedSession.match_rate_pct ?? '?'}%
              </span>
            </div>
            <div className="font-mono text-[10px] text-text-muted mt-0.5">
              {getSelectedSession.comparison_status === 'match'
                ? '✓ All matched'
                : getSelectedSession.comparison_status === 'differences'
                  ? '⚠ Differences found'
                  : 'Pending comparison'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

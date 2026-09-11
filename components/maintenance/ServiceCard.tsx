'use client'

// components/maintenance/ServiceCard.tsx
// Run-hour service status for one machine, as three facts rather than a trend
// line: the current meter reading (and when it was taken), how many hours it has
// run since the last service, and the DATE the next service falls due.
//
// The due date comes from derived.serviceRows: remaining hours projected forward
// at the machine's run rate, capped by a calendar interval where one applies
// (the generator is 500 hours OR 12 months, whichever lands first). `dueReason`
// says which limit won, so the card can explain itself.

import { fmtD } from '@/lib/maintenance/helpers'

export interface ServiceStatus {
  cfg: { equipment: string; service_interval_hours: number; service_interval_days?: number | null }
  totalHours: number | null
  sinceService: number | null
  lastServiceDate: string | null
  /** Set when the service date is only inferred from a counter reset (see
   *  serviceRows) — the service happened somewhere in this window. */
  serviceWindow: { after: string; before: string } | null
  latest: { reading_date: string } | null
  due: Date | null
  dueReason: 'hours' | 'calendar'
  days: number
}

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]'

/** Urgency styling from days-to-due, matching the calendar badges elsewhere. */
const tone = (days: number) =>
  days <= 0 ? { badge: 'badge-err', text: 'text-err', label: 'OVERDUE' }
  : days <= 14 ? { badge: 'badge-warn', text: 'text-warn', label: 'DUE SOON' }
  : days <= 60 ? { badge: 'badge-info', text: 'text-text', label: 'PLAN' }
  : { badge: 'badge-ok', text: 'text-text', label: 'OK' }

export function ServiceCard({ s, compact = false }: { s: ServiceStatus; compact?: boolean }) {
  const t = tone(s.days)
  const interval = s.cfg.service_interval_hours
  const pct = s.sinceService != null && interval > 0
    ? Math.min(100, Math.round((s.sinceService / interval) * 100))
    : null

  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text break-words">{s.cfg.equipment}</div>
          <div className="text-[10px] text-text-faint">
            Service every {interval.toLocaleString()} hrs
            {s.cfg.service_interval_days ? ` or ${Math.round(s.cfg.service_interval_days / 30)} months` : ''}
          </div>
        </div>
        {/* No due date means there is nothing to judge — a machine whose service
            history was never captured must not read as a green OK. */}
        <span className={`badge ${s.due ? t.badge : 'badge-gray'} shrink-0 whitespace-nowrap`}>
          {s.due ? t.label : 'NO SERVICE DATA'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className={LB}>Current hours</div>
          <div className="text-[15px] font-semibold text-text tabular-nums">
            {s.totalHours != null ? s.totalHours.toLocaleString() : '—'}
          </div>
          <div className="text-[10px] text-text-faint">{s.latest ? fmtD(s.latest.reading_date) : 'no reading'}</div>
        </div>
        <div>
          <div className={LB}>Since service</div>
          <div className={`text-[15px] font-semibold tabular-nums ${t.text}`}>
            {s.sinceService != null ? s.sinceService.toLocaleString() : '—'}
          </div>
          <div className="text-[10px] text-text-faint">
            {s.lastServiceDate ? `serviced ${fmtD(s.lastServiceDate)}`
              : s.serviceWindow ? `serviced ${fmtD(s.serviceWindow.after)}–${fmtD(s.serviceWindow.before)} · date not logged`
              : 'no service logged'}
          </div>
        </div>
        <div>
          <div className={LB}>Next service due</div>
          <div className={`text-[15px] font-semibold ${t.text}`}>{s.due ? fmtD(s.due.toISOString()) : '—'}</div>
          <div className="text-[10px] text-text-faint">
            {s.due
              ? (s.days <= 0 ? `${Math.abs(s.days)}d overdue` : `in ${s.days}d · on ${s.dueReason === 'calendar' ? 'date' : 'hours'}`)
              : 'needs a reading'}
          </div>
        </div>
      </div>

      {/* How far through the hour interval this machine is. */}
      {!compact && pct != null && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-surface-dim overflow-hidden">
            <div className={`h-full ${s.days <= 0 ? 'bg-err' : s.days <= 14 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[10px] text-text-faint mt-0.5 tabular-nums">
            {pct}% of the {interval.toLocaleString()}-hour interval used
          </div>
        </div>
      )}
    </div>
  )
}

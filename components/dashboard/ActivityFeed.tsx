'use client'

import { useMemo } from 'react'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import {
  ClipboardList, CheckCircle2, AlertTriangle, Factory,
  Tag, Zap, Clock,
} from 'lucide-react'
import Link from 'next/link'

interface ScSession {
  id:               string
  count_date:       string
  sup_confirmed_at: string | null
  adm_confirmed_at: string | null
  comparison_status:string | null
  match_rate_pct:   number | null
}

interface ProdSession {
  id:           string
  section_name: string
  shift:        string
  status:       string
  submitted_at: string | null
}

interface Props {
  recentSessions: ScSession[]
  todayProd:      ProdSession[]
  loading:        boolean
}

interface Activity {
  id:    string
  icon:  React.ReactNode
  text:  string
  sub?:  string
  time:  Date
  href:  string
  color: string
}

export default function ActivityFeed({ recentSessions, todayProd, loading }: Props) {
  const activities = useMemo<Activity[]>(() => {
    const items: Activity[] = []

    // Count session events
    for (const s of recentSessions.slice(0, 8)) {
      if (s.adm_confirmed_at) {
        items.push({
          id:    `adm-${s.id}`,
          icon:  <CheckCircle2 size={13} />,
          text:  `Count confirmed`,
          sub:   `${format(parseISO(s.count_date), 'd MMM')} · ${s.match_rate_pct ?? '?'}% match`,
          time:  parseISO(s.adm_confirmed_at),
          href:  '/management',
          color: s.comparison_status === 'differences'
            ? 'text-warn bg-warn/8'
            : 'text-ok bg-ok/8',
        })
      } else if (s.sup_confirmed_at) {
        items.push({
          id:    `sup-${s.id}`,
          icon:  <ClipboardList size={13} />,
          text:  `Count started`,
          sub:   format(parseISO(s.count_date), 'd MMM yyyy'),
          time:  parseISO(s.sup_confirmed_at),
          href:  '/count',
          color: 'text-info bg-info/8',
        })
      }
      if (s.comparison_status === 'differences' && s.adm_confirmed_at) {
        items.push({
          id:    `var-${s.id}`,
          icon:  <AlertTriangle size={13} />,
          text:  `Variance detected`,
          sub:   format(parseISO(s.count_date), 'd MMM yyyy'),
          time:  parseISO(s.adm_confirmed_at),
          href:  '/management',
          color: 'text-warn bg-warn/8',
        })
      }
    }

    // Production session events
    for (const p of todayProd) {
      if (p.submitted_at) {
        items.push({
          id:    `prod-${p.id}`,
          icon:  <Factory size={13} />,
          text:  `${p.section_name} submitted`,
          sub:   `${p.shift} shift`,
          time:  parseISO(p.submitted_at),
          href:  '/production',
          color: 'text-purple-500 bg-purple-500/8',
        })
      }
    }

    return items
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, 18)
  }, [recentSessions, todayProd])

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-surface-rule flex items-center gap-2 shrink-0">
        <Zap size={14} className="text-amber-500" />
        <span className="font-display font-bold text-[14px] text-text">Live Activity</span>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-12 bg-surface rounded-lg animate-pulse" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 gap-2 text-center px-4">
            <Clock size={24} className="text-text-faint" />
            <span className="font-mono text-[11px] text-text-faint">
              No recent activity
            </span>
          </div>
        ) : (
          <div className="divide-y divide-surface-rule/50">
            {activities.map(act => (
              <Link
                key={act.id}
                href={act.href}
                className="flex items-start gap-3 px-4 py-3 hover:bg-surface transition-colors group"
              >
                {/* Icon */}
                <div className={`
                  shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5
                  ${act.color}
                `}>
                  {act.icon}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="font-body font-medium text-[12px] text-text leading-tight">
                    {act.text}
                  </div>
                  {act.sub && (
                    <div className="font-mono text-[10px] text-text-muted mt-0.5">
                      {act.sub}
                    </div>
                  )}
                </div>

                {/* Time */}
                <div className="font-mono text-[10px] text-text-faint shrink-0 text-right mt-0.5">
                  {formatDistanceToNow(act.time, { addSuffix: true })
                    .replace('about ', '')
                    .replace(' ago', '↑')
                    .replace('less than a minute↑', 'just now')}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-surface-rule shrink-0">
        <Link href="/management"
          className="font-mono text-[10px] text-brand hover:underline">
          View all sessions →
        </Link>
      </div>
    </div>
  )
}

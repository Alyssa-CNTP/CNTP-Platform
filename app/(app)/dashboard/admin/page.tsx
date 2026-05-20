'use client'

// This is the existing admin/management dashboard.
// The full implementation lives here — KPIs, session history, quick actions.
// Separated into its own file so the dashboard router can import it cleanly.

import { useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format, subDays, parseISO } from 'date-fns'
import {
  ClipboardList, AlertTriangle, CheckCircle2, Clock,
  TrendingUp, Factory, Tag, BarChart3, ArrowRight,
} from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'

interface ScSession {
  id: string
  count_date: string
  match_rate_pct: number | null
  sup_confirmed_at: string | null
  adm_confirmed_at: string | null
  sup_total_kg: number | null
  adm_total_kg: number | null
  comparison_status: string | null
}

export default function AdminDashboard() {
  const { displayName } = useAuth()
  const [sessions, setSessions]   = useState<ScSession[]>([])
  const [loading, setLoading]     = useState(true)
  const [prodCount, setProdCount] = useState(0)
  const [tagCount, setTagCount]   = useState(0)

  const today   = format(new Date(), 'yyyy-MM-dd')
  const d30     = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const hour    = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    async function load() {
      setLoading(true)
      const db = getDb()
      const [sessRes, prodRes, tagRes] = await Promise.all([
        db.from('sc_sessions')
          .select('id,count_date,match_rate_pct,sup_confirmed_at,adm_confirmed_at,sup_total_kg,adm_total_kg,comparison_status')
          .gte('count_date', d30)
          .order('count_date', { ascending: false }),
        db.from('prod_sessions').select('id', { count: 'exact', head: true }).gte('date', d30),
        db.from('bag_tags').select('id', { count: 'exact', head: true }).gte('captured_at', d30),
      ])
      setSessions((sessRes.data as ScSession[]) ?? [])
      setProdCount((prodRes as any).count ?? 0)
      setTagCount((tagRes as any).count ?? 0)
      setLoading(false)
    }
    load()
  }, [])

  const completed    = sessions.filter(s => s.sup_confirmed_at && s.adm_confirmed_at)
  const avgAccuracy  = completed.length
    ? Math.round(completed.reduce((s, r) => s + (r.match_rate_pct ?? 0), 0) / completed.length)
    : null
  const todaySession = sessions.find(s => s.count_date === today)
  const variance     = sessions.filter(s => s.comparison_status === 'differences').length

  const kpis = [
    { label: 'Count sessions (30d)', value: String(completed.length), icon: <ClipboardList size={16} />, color: 'text-brand', href: '/management' },
    { label: 'Avg accuracy (30d)',   value: avgAccuracy != null ? `${avgAccuracy}%` : '—', icon: <TrendingUp size={16} />, color: avgAccuracy != null && avgAccuracy >= 95 ? 'text-ok' : 'text-warn', href: '/status' },
    { label: 'Variance sessions',    value: String(variance), icon: <AlertTriangle size={16} />, color: variance > 0 ? 'text-warn' : 'text-ok', href: '/management' },
    { label: 'Production sessions',  value: String(prodCount), icon: <Factory size={16} />, color: 'text-purple-400', href: '/production' },
    { label: 'Bag tags captured',    value: String(tagCount), icon: <Tag size={16} />, color: 'text-amber-400', href: '/tags' },
    { label: 'Platform analytics',   value: 'View →', icon: <BarChart3 size={16} />, color: 'text-text-muted', href: '/status' },
  ]

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1100px]">

      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-[24px] text-text">
          {greeting}, {displayName.split(' ')[0]}
        </h1>
        <p className="font-mono text-[11px] text-text-muted mt-0.5">
          {format(new Date(), 'EEEE d MMMM yyyy')} · Admin view
        </p>
      </div>

      {/* Today's count status */}
      {todaySession && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-5 flex items-center gap-4">
          {todaySession.sup_confirmed_at && todaySession.adm_confirmed_at
            ? <CheckCircle2 size={22} className="text-ok shrink-0" />
            : <Clock size={22} className="text-warn shrink-0" />
          }
          <div className="flex-1">
            <div className="font-body font-semibold text-[14px] text-text">
              Today's morning count
            </div>
            <div className="font-mono text-[11px] text-text-muted">
              {todaySession.sup_confirmed_at ? 'Supervisor confirmed' : 'Awaiting supervisor'}
              {' · '}
              {todaySession.adm_confirmed_at ? 'Admin confirmed' : 'Awaiting admin'}
              {todaySession.match_rate_pct != null && ` · ${todaySession.match_rate_pct}% match`}
            </div>
          </div>
          <Link href="/count" className="flex items-center gap-1.5 font-mono text-[11px] text-brand hover:underline">
            Open count <ArrowRight size={12} />
          </Link>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {kpis.map(kpi => (
          <Link key={kpi.label} href={kpi.href} className="bg-surface-card border border-surface-rule rounded-2xl p-5 hover:border-brand/30 transition-colors">
            <div className={`${kpi.color} mb-2`}>{kpi.icon}</div>
            <div className={`font-display font-bold text-[26px] ${kpi.color}`}>
              {loading ? '—' : kpi.value}
            </div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1">{kpi.label}</div>
          </Link>
        ))}
      </div>

      {/* Recent sessions table */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-rule">
          <span className="font-display font-bold text-[14px] text-text">Recent count sessions</span>
          <Link href="/management" className="font-mono text-[11px] text-brand hover:underline">View all →</Link>
        </div>
        {loading ? (
          <div className="px-5 py-8 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
        ) : completed.length === 0 ? (
          <div className="px-5 py-8 text-center font-mono text-[12px] text-text-muted">No completed sessions yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface border-b border-surface-rule">
                  {['Date','Match','Sup kg','Adm kg','Variance','Status'].map(h => (
                    <th key={h} className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {completed.slice(0, 8).map(s => {
                  const variance = Math.abs((s.sup_total_kg ?? 0) - (s.adm_total_kg ?? 0))
                  const rate     = s.match_rate_pct ?? 0
                  return (
                    <tr key={s.id} className="hover:bg-surface transition-colors">
                      <td className="px-5 py-3 font-mono text-[12px] text-text whitespace-nowrap">
                        {format(parseISO(s.count_date), 'd MMM yyyy')}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`font-display font-bold text-[14px] ${rate >= 99 ? 'text-ok' : rate >= 95 ? 'text-info' : 'text-warn'}`}>
                          {rate}%
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px] text-text-muted">
                        {(s.sup_total_kg ?? 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px] text-text-muted">
                        {(s.adm_total_kg ?? 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px]">
                        <span className={variance > 100 ? 'text-err' : variance > 20 ? 'text-warn' : 'text-ok'}>
                          {variance.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`font-mono text-[10px] px-2 py-0.5 rounded-md ${
                          s.comparison_status === 'match' ? 'bg-ok/10 text-ok' :
                          s.comparison_status === 'differences' ? 'bg-warn/10 text-warn' :
                          'bg-surface text-text-muted'
                        }`}>
                          {s.comparison_status ?? 'pending'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
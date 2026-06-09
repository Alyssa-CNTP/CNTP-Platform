'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, subDays, parseISO } from 'date-fns'
import {
  ClipboardList, CheckCircle2, Clock, RotateCcw,
  ChevronRight, RefreshCw, Tag, Scale, AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScSession {
  id: string
  count_date: string
  sup_confirmed_at: string | null
  adm_confirmed_at: string | null
  sup_total_kg: number | null
  adm_total_kg: number | null
  match_rate_pct: number | null
  comparison_status: string | null
}

interface ProdSummary {
  section_id: string
  section_name: string
  shift: string
  status: string
  total_input_kg: number | null
  balance_kg: number | null
  within_tolerance: boolean | null
}

interface TagSummary {
  section_id: string
  count: number
  total_kg: number
}

// ── Section colours ────────────────────────────────────────────────────────────
const SECTION_COLORS: Record<string, string> = {
  sieving: 'bg-blue-500', refining1: 'bg-emerald-600', refining2: 'bg-emerald-500',
  granule: 'bg-amber-500', blender: 'bg-purple-500', pasteuriser: 'bg-red-500',
}
const SECTION_CODES: Record<string, string> = {
  sieving: 'ST', refining1: 'R1', refining2: 'R2',
  granule: 'GL', blender: 'BL', pasteuriser: 'PR',
}

// ═════════════════════════════════════════════════════════════════════════════
// WAREHOUSE SUPERVISOR DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
export default function SupervisorDashboard() {
  const { displayName } = useAuth()
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [countSession, setCount]      = useState<ScSession | null>(null)
  const [prodSummary, setProd]        = useState<ProdSummary[]>([])
  const [tagSummary,  setTags]        = useState<TagSummary[]>([])
  const [hasVariances, setVariances]  = useState(false)

  const today     = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = displayName.split(' ')[0]

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    const db = getDb()

    // 1. Today's count session
    const { data: countData } = await db
      .from('sc_sessions')
      .select('id,count_date,sup_confirmed_at,adm_confirmed_at,sup_total_kg,adm_total_kg,match_rate_pct,comparison_status')
      .eq('count_date', today)
      .maybeSingle()

    const sess = countData as ScSession | null
    setCount(sess)
    setVariances(sess?.comparison_status === 'differences')

    // 2. Yesterday's production sessions + mass balances (what was produced that is being counted)
    const { data: prodData } = await db
      .from('prod_sessions')
      .select('id,section_id,section_name,shift,status')
      .eq('date', yesterday)

    const prodSess = (prodData as any[]) ?? []

    let summaries: ProdSummary[] = []
    if (prodSess.length > 0) {
      const { data: mbData } = await db
        .from('prod_mass_balance')
        .select('session_id,total_input_kg,balance_kg,within_tolerance')
        .in('session_id', prodSess.map((s: any) => s.id))

      const mbs = (mbData as any[]) ?? []
      summaries = prodSess.map((s: any) => {
        const mb = mbs.find((m: any) => m.session_id === s.id)
        return {
          section_id:       s.section_id,
          section_name:     s.section_name,
          shift:            s.shift,
          status:           s.status,
          total_input_kg:   mb?.total_input_kg ?? null,
          balance_kg:       mb?.balance_kg     ?? null,
          within_tolerance: mb?.within_tolerance ?? null,
        }
      })
    }
    setProd(summaries)

    // 3. Today's bag tags — summarised per section
    const { data: tagData } = await db
      .from('bag_tags')
      .select('section_id,weight_kg')
      .eq('tag_date', today)

    const tagAgg: Record<string, TagSummary> = {}
    for (const t of (tagData as any[]) ?? []) {
      if (!tagAgg[t.section_id]) tagAgg[t.section_id] = { section_id: t.section_id, count: 0, total_kg: 0 }
      tagAgg[t.section_id].count++
      tagAgg[t.section_id].total_kg += t.weight_kg ?? 0
    }
    setTags(Object.values(tagAgg))

    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [])

  const countDone   = !!countSession?.sup_confirmed_at
  const bothDone    = !!(countSession?.sup_confirmed_at && countSession?.adm_confirmed_at)
  const matchRate   = countSession?.match_rate_pct

  // Production summary — group by section, show total across all shifts
  const sectionProd: Record<string, { name: string; totalKg: number; shifts: number; flagged: boolean }> = {}
  for (const p of prodSummary) {
    if (!sectionProd[p.section_id]) {
      sectionProd[p.section_id] = { name: p.section_name, totalKg: 0, shifts: 0, flagged: false }
    }
    sectionProd[p.section_id].shifts++
    sectionProd[p.section_id].totalKg += p.total_input_kg ?? 0
    if (p.within_tolerance === false) sectionProd[p.section_id].flagged = true
  }

  const totalTagKg = tagSummary.reduce((s, t) => s + t.total_kg, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-4 max-w-[720px]">

      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">
            {greeting}, {firstName}
          </h1>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {format(new Date(), 'EEEE d MMMM yyyy')} · Warehouse supervisor
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Variance alert */}
      {hasVariances && (
        <Link
          href="/recount"
          className="flex items-center gap-3 px-4 py-3 bg-warn/10 border border-warn/30 rounded-xl"
        >
          <RotateCcw size={15} className="text-warn shrink-0" />
          <span className="font-body font-semibold text-[13px] text-warn flex-1">
            Count variances found — tap to submit a recount
          </span>
          <ChevronRight size={14} className="text-warn shrink-0" />
        </Link>
      )}

      {/* ── MORNING COUNT ─────────────────────────────────────────────────── */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-surface-rule">
          <ClipboardList size={15} className="text-brand" />
          <span className="font-display font-bold text-[14px] text-text">
            Morning count · {format(new Date(), 'd MMM')}
          </span>
          <span className={`ml-auto font-mono text-[10px] px-2 py-0.5 rounded-md ${
            countDone ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'
          }`}>
            {countDone ? 'Your count done' : 'Count pending'}
          </span>
        </div>

        {/* Three stat columns */}
        <div className="grid grid-cols-3 divide-x divide-surface-rule">
          {[
            {
              label: 'Your count',
              value: countDone ? format(parseISO(countSession!.sup_confirmed_at!), 'HH:mm') : '—',
              sub:   countDone
                ? `${(countSession?.sup_total_kg ?? 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg`
                : 'Not started',
              color: countDone ? 'text-ok' : 'text-warn',
            },
            {
              label: 'Admin count',
              value: countSession?.adm_confirmed_at
                ? format(parseISO(countSession.adm_confirmed_at), 'HH:mm')
                : '—',
              sub: countSession?.adm_total_kg != null
                ? `${countSession.adm_total_kg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg`
                : 'Waiting',
              color: countSession?.adm_confirmed_at ? 'text-info' : 'text-text-muted/30',
            },
            {
              label: 'Match',
              value: bothDone && matchRate != null ? `${matchRate}%` : '—',
              sub:   bothDone
                ? countSession?.comparison_status === 'match' ? 'All matched' : 'Differences'
                : 'Pending',
              color: bothDone && matchRate != null
                ? matchRate >= 99 ? 'text-ok' : matchRate >= 95 ? 'text-info' : 'text-warn'
                : 'text-text-muted/30',
            },
          ].map(col => (
            <div key={col.label} className="px-5 py-4 text-center">
              <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-1">{col.label}</div>
              <div className={`font-display font-bold text-[22px] ${col.color}`}>{col.value}</div>
              <div className="font-mono text-[10px] text-text-muted mt-0.5">{col.sub}</div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-4 flex gap-2">
          <Link
            href="/count"
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand text-white rounded-xl font-display font-bold text-[13px]"
          >
            {countDone ? 'View my count' : 'Start count'}
            <ChevronRight size={14} />
          </Link>
          {hasVariances && (
            <Link
              href="/recount"
              className="flex items-center gap-2 px-4 py-3 bg-warn/10 border border-warn/30 text-warn rounded-xl font-mono text-[11px] font-bold"
            >
              <RotateCcw size={13} /> Recount
            </Link>
          )}
        </div>
      </div>

      {/* ── YESTERDAY'S PRODUCTION SUMMARY ────────────────────────────────── */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-surface-rule flex items-center gap-3">
          <Scale size={14} className="text-text-muted" />
          <span className="font-display font-bold text-[14px] text-text">
            Yesterday's production
          </span>
          <span className="font-mono text-[10px] text-text-muted ml-auto">
            {format(new Date(yesterday + 'T12:00:00'), 'd MMM')} · what you're counting
          </span>
        </div>

        {Object.keys(sectionProd).length === 0 ? (
          <div className="px-5 py-6 text-center font-mono text-[12px] text-text-muted">
            No production data for yesterday
          </div>
        ) : (
          <div className="divide-y divide-surface-rule">
            {Object.entries(sectionProd).map(([sectionId, data]) => {
              const color = SECTION_COLORS[sectionId] ?? 'bg-gray-400'
              const code  = SECTION_CODES[sectionId]  ?? '??'
              return (
                <div key={sectionId} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                    <span className="font-mono font-bold text-[9px] text-white">{code}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-body font-medium text-[13px] text-text">{data.name}</div>
                    <div className="font-mono text-[10px] text-text-muted">
                      {data.shifts} shift{data.shifts > 1 ? 's' : ''} captured
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-display font-bold text-[14px] ${data.flagged ? 'text-warn' : 'text-text'}`}>
                      {data.totalKg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
                    </div>
                    {data.flagged && (
                      <div className="flex items-center gap-1 justify-end font-mono text-[10px] text-warn">
                        <AlertTriangle size={9} /> variance
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── BAG TAGS TODAY ─────────────────────────────────────────────────── */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-surface-rule flex items-center gap-3">
          <Tag size={14} className="text-amber-500" />
          <span className="font-display font-bold text-[14px] text-text">Bag tags today</span>
          {totalTagKg > 0 && (
            <span className="ml-auto font-display font-bold text-[14px] text-text">
              {totalTagKg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
            </span>
          )}
        </div>

        {tagSummary.length === 0 ? (
          <div className="px-5 py-5 text-center font-mono text-[12px] text-text-muted">
            No bag tags captured yet today
          </div>
        ) : (
          <div className="divide-y divide-surface-rule">
            {tagSummary.map(t => {
              const color = SECTION_COLORS[t.section_id] ?? 'bg-gray-400'
              const code  = SECTION_CODES[t.section_id]  ?? '??'
              return (
                <div key={t.section_id} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                    <span className="font-mono font-bold text-[9px] text-white">{code}</span>
                  </div>
                  <span className="font-mono text-[11px] text-text-muted flex-1">
                    {t.count} tag{t.count > 1 ? 's' : ''}
                  </span>
                  <span className="font-display font-bold text-[14px] text-text">
                    {t.total_kg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
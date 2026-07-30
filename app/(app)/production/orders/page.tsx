'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { format, parseISO, subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Loader2, CheckCircle2, Clock, Pen, Play, ChevronRight,
  Filter, X, AlertTriangle, Package, PackageCheck, Scale,
  ArrowRight, MoreHorizontal, Pencil, Trash2, RotateCcw,
  Save, Unlock, Archive, BarChart3, List, Gauge, TrendingUp, Undo2,
  Layers, CalendarRange,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta, SECTION_ORDER, massBalanceToleranceFor, VARIANT_OPTIONS } from '@/lib/production/capture-config'
import { sastToday } from '@/lib/production/shifts'

// Production Orders — the single home for captured batch records and the KPIs
// that describe them.
//
// Three things were wrong before and are fixed here:
//
//  1. The page carried a record list and nothing else. "How many tons did we do
//     this week, at what throughput, of which product, off which line" had no
//     answer anywhere on it — the yield analytics existed but were reachable only
//     via /traceability. There are now two views on one page: Records and
//     Analytics, over the same filters, so a KPI and the rows behind it can never
//     describe different sets.
//
//  2. Filters lived in component state, so opening a record and coming back
//     dropped you into an unfiltered 14-day list. Every filter now lives in the
//     URL, and every link into capture carries a `return` pointing back at that
//     exact URL — so Back returns you to the list you were reading, not to the
//     capture landing page.
//
//  3. /supervisor/productions was a second copy of this list. It now redirects
//     here, and its one unique action — a supervisor asking to reopen a signed-off
//     record — is on each record below.

const VARIANT_OPTS = VARIANT_OPTIONS.map(v => v.value)
const SHIFTS = ['morning', 'afternoon', 'night']
const AXIS = { fontSize: 11, fill: '#637056' }
const GRID = '#F0F2F5'
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8, border: '1px solid #E4E7EC' }

interface SessionRow {
  id: string
  section_id: string
  date: string
  shift: string
  status: string
  record_no: string | null
  production_orders: string[] | null
  operator_names: string[] | null
  lot_number: string | null
  variant: string | null
  created_at: string
  submitted_at: string | null
  deleted_at: string | null
  edited_at: string | null
  total_input_kg: number
  total_output_kg: number
  balance_kg: number | null
  debag_count: number
  bag_count: number
  has_raw_data: boolean
}

interface Kpis {
  sessions: number; totalInputKg: number; totalOutputKg: number; totalTons: number
  yieldPct: number | null; activeDays: number; tonsPerDay: number | null; tonsPerWeek: number | null
  bags: number; balanceFlags: number; signedOff: number; outstanding: number; kgPerHour: number | null
}
interface DayRow { date: string; inputKg: number; outputKg: number; tons: number; sessions: number; yieldPct: number | null }
interface WeekRow { weekStart: string; inputKg: number; outputKg: number; tons: number; sessions: number; yieldPct: number | null }
interface SectionRow {
  sectionId: string; sectionName: string; sectionCode: string; colorHex: string
  sessions: number; inputKg: number; outputKg: number; tons: number; yieldPct: number | null
  runMinutes: number; workedMinutes: number; kgPerHour: number | null
  basis: 'run' | 'worked' | null; flagged: number
}
interface ProductRow {
  productType: string; kg: number; tons: number; bags: number; sharePct: number | null
  bySection: { sectionId: string; sectionCode: string; sectionName: string; kg: number }[]
}
interface VariantRow { variant: string; inputKg: number; outputKg: number; tons: number; sessions: number; yieldPct: number | null }
interface Analytics {
  kpis: Kpis; perDay: DayRow[]; perWeek: WeekRow[]
  bySection: SectionRow[]; byProduct: ProductRow[]; byVariant: VariantRow[]
}

// Same predicate as the capture page's hasCaptureData() — checked here too as
// a fallback, not just prod_debagging/prod_bagging row counts. Those tables
// are a normalized COPY written by persistCore(); draft_data.productions is
// what the capture screen itself wrote directly and is the source of truth.
// Relying on the copy alone risked a sync gap flagging a genuinely-captured
// record as "empty" — which, with a Discard action right next to it, is a
// real data-loss risk, not just a cosmetic one.
function hasRawCaptureData(productions: any[] | undefined): boolean {
  const num = (v: any) => parseFloat(String(v ?? '').replace(',', '.')) || 0
  return (productions ?? []).some((p: any) => {
    const d = p?.data ?? {}
    if (Array.isArray(d.debag)   && d.debag.some((r: any) => num(r.nett) > 0 || num(r.weight) > 0)) return true
    if (Array.isArray(d.outputs) && d.outputs.some((b: any) => num(b.weight) > 0 || num(b.bagCount) > 0)) return true
    if (Array.isArray(d.spillage)&& d.spillage.some((r: any) => num(r.kg) > 0)) return true
    if (Array.isArray(d.inputs)  && d.inputs.some((r: any) => num(r.weight) > 0)) return true
    for (const g of [d.outputA, d.outputB, d.outputC, d.outputD]) {
      if (g && Array.isArray(g.bags) && g.bags.some((b: any) => num(b.weight) > 0)) return true
    }
    if (Array.isArray(d.blends) && d.blends.some((bl: any) => Array.isArray(bl.rows) && bl.rows.some((r: any) => num(r.weight) > 0))) return true
    if (Array.isArray(d.dustOutputs) && d.dustOutputs.some((r: any) => num(r.weight) > 0)) return true
    return false
  })
}

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  draft:     { label: 'In progress',       cls: 'bg-warn/10 text-warn',  icon: Pen },
  submitted: { label: 'Awaiting sign-off', cls: 'bg-info/10 text-info',  icon: Clock },
  approved:  { label: 'Signed off',        cls: 'bg-ok/10 text-ok',      icon: CheckCircle2 },
  new:       { label: 'Not started',       cls: 'bg-stone-100 text-stone-500', icon: Play },
}

const hrs = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m` }

export default function ProductionOrdersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>}>
      <OrdersInner />
    </Suspense>
  )
}

function OrdersInner() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // ── Filters live in the URL ─────────────────────────────────────────────────
  // So the view is shareable, survives a reload, and — the reason this changed —
  // can be handed to the capture page as a `return` target that restores exactly
  // what you were looking at.
  const view         = params.get('view') === 'analytics' ? 'analytics' : 'records'
  const dateFrom     = params.get('from')    || format(subDays(new Date(), 14), 'yyyy-MM-dd')
  const dateTo       = params.get('to')      || sastToday()
  const filterSection= params.get('section') || ''
  const filterStatus = params.get('status')  || ''
  const filterShift  = params.get('shift')   || ''
  const filterVariant= params.get('variant') || ''
  const showArchived = params.get('archived') === '1'

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [params, pathname, router])

  // The URL a capture page should come back to — the current filters, verbatim.
  const returnUrl = `${pathname}?${params.toString()}`

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [kpiLoading, setKpiLoading] = useState(true)
  const [kpiError, setKpiError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const reload = () => setRefreshKey(k => k + 1)

  const { p, isFullAdmin } = useAuth()
  const canEdit   = p('can_edit_session')
  const canDelete = p('can_delete_session')
  const canRequestReopen = isFullAdmin || canEdit || p('can_approve_session')

  // ── KPIs / analytics — server-computed over the same filters ───────────────
  useEffect(() => {
    let alive = true
    setKpiLoading(true); setKpiError(null)
    const q = new URLSearchParams({ from: dateFrom, to: dateTo })
    if (filterSection) q.set('section', filterSection)
    if (filterVariant) q.set('variant', filterVariant)
    if (filterShift)   q.set('shift', filterShift)
    fetch(`/api/production/orders-kpis?${q.toString()}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || `Error ${r.status}`); return j })
      .then(j => { if (alive) setAnalytics(j as Analytics) })
      .catch(e => { if (alive) { setKpiError(e.message); setAnalytics(null) } })
      .finally(() => { if (alive) setKpiLoading(false) })
    return () => { alive = false }
  }, [dateFrom, dateTo, filterSection, filterVariant, filterShift, refreshKey])

  // ── Records ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const db = getDb()

      const { data: sess } = await db.schema('production').from('prod_sessions')
        .select('id,section_id,date,shift,status,operator_names,lot_number,variant,production_orders,created_at,submitted_at')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: false }).order('created_at', { ascending: false })
        .limit(200)

      if (!alive) return
      if (!sess?.length) { setSessions([]); setLoading(false); return }

      const ids = (sess as any[]).map(s => s.id)

      // Record-management columns are best-effort: if the migration hasn't been
      // applied to this database yet, selecting them 400s — so fetch them
      // separately and degrade gracefully (no record number / no archived state).
      const extra = new Map<string, any>()
      const { data: ex, error: exErr } = await db.schema('production').from('prod_sessions')
        .select('id,record_no,deleted_at,edited_at').in('id', ids)
      if (!exErr && ex) (ex as any[]).forEach(r => extra.set(r.id, r))

      // Fetched separately (not in the main select) since it's the largest
      // column on this table and only needed as the empty-record fallback below.
      const rawData = new Map<string, boolean>()
      const { data: drafts } = await db.schema('production').from('prod_sessions')
        .select('id,draft_data').in('id', ids)
      ;(drafts as any[] ?? []).forEach(r => rawData.set(r.id, hasRawCaptureData(r.draft_data?.productions)))

      const { data: mb } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_a_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg,balance_kg').in('session_id', ids)
      const mbMap = new Map<string, any>()
      ;(mb ?? []).forEach((r: any) => mbMap.set(r.session_id, r))

      const { data: bags }  = await db.schema('production').from('prod_bagging')
        .select('session_id').in('session_id', ids)
      const { data: debags } = await db.schema('production').from('prod_debagging')
        .select('session_id').in('session_id', ids)
      const bagCount   = new Map<string, number>()
      const debagCount = new Map<string, number>()
      ;(bags  ?? []).forEach((r: any) => bagCount.set(r.session_id,   (bagCount.get(r.session_id)   ?? 0) + 1))
      ;(debags ?? []).forEach((r: any) => debagCount.set(r.session_id, (debagCount.get(r.session_id) ?? 0) + 1))

      if (!alive) return
      const rows: SessionRow[] = (sess as any[]).map(s => {
        const m = mbMap.get(s.id)
        const x = extra.get(s.id) ?? {}
        return {
          ...s,
          record_no:  x.record_no ?? null,
          deleted_at: x.deleted_at ?? null,
          edited_at:  x.edited_at ?? null,
          total_input_kg: m ? parseFloat(m.total_input_kg) : 0,
          total_output_kg: m
            ? (parseFloat(m.total_output_b_kg) || 0)
              + (parseFloat(m.total_output_c_kg) || 0) + (parseFloat(m.total_output_d_kg) || 0)
            : 0,
          balance_kg: m ? parseFloat(m.balance_kg) : null,
          debag_count: debagCount.get(s.id) ?? 0,
          bag_count:   bagCount.get(s.id)   ?? 0,
          has_raw_data: rawData.get(s.id) ?? false,
        }
      })

      setSessions(rows)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [dateFrom, dateTo, refreshKey])

  const filtered = useMemo(() => sessions.filter(s => {
    // Hide stray empty drafts — a draft/new session with no debagging, no bagging
    // and no mass balance is an abandoned "No data" row (e.g. an opened-then-left
    // section). Submitted/approved records always show. New captures create a row
    // only once real weights are entered, so a real in-progress shift still appears.
    const isEmpty = s.debag_count === 0 && s.bag_count === 0 && !s.total_input_kg && !s.total_output_kg && !s.has_raw_data
    if (isEmpty && (s.status === 'draft' || s.status === 'new')) return false
    // Archived (soft-deleted) records are hidden unless the toggle is on.
    if (s.deleted_at && !showArchived) return false
    if (!s.deleted_at && showArchived) return false
    if (filterSection && s.section_id !== filterSection) return false
    if (filterStatus  && s.status !== filterStatus)      return false
    if (filterShift   && s.shift !== filterShift)        return false
    if (filterVariant && s.variant !== filterVariant)    return false
    return true
  }), [sessions, filterSection, filterStatus, filterShift, filterVariant, showArchived])

  const activeFilters = [filterSection, filterStatus, filterShift, filterVariant].filter(Boolean).length
  const clearFilters = () => setParams({ section: null, status: null, shift: null, variant: null })

  const rangeLabel = `${format(parseISO(dateFrom + 'T12:00:00'), 'd MMM')} – ${format(parseISO(dateTo + 'T12:00:00'), 'd MMM yyyy')}`

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-4 border-b border-stone-100 flex-shrink-0 flex-wrap">
        <div>
          <h1 className="font-semibold text-[22px] text-text leading-tight">Production Orders</h1>
          <p className="text-[12px] text-text-muted mt-0.5">
            Captured batch records and output KPIs · {rangeLabel}
            {activeFilters > 0 ? ` · ${activeFilters} filter${activeFilters === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Records vs Analytics — same filters, two readings of one set. */}
          <div className="flex gap-1 p-1 bg-stone-100 rounded-xl">
            {([['records', 'Records', List], ['analytics', 'Analytics', BarChart3]] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => setParams({ view: v === 'records' ? null : v })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${view === v ? 'bg-white text-brand shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {(canEdit || canDelete) && view === 'records' && (
            <button onClick={() => setParams({ archived: showArchived ? null : '1' })}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[13px] font-medium transition-colors
                ${showArchived ? 'border-brand bg-brand/5 text-brand' : 'border-stone-200 text-stone-600 hover:border-brand hover:text-brand'}`}>
              <Archive size={14} /> {showArchived ? 'Viewing archived' : 'Archived'}
            </button>
          )}
          <button onClick={() => setShowFilters(f => !f)}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl border text-[13px] font-medium transition-colors
              ${showFilters || activeFilters > 0 ? 'border-brand bg-brand/5 text-brand' : 'border-stone-200 text-stone-600 hover:border-brand hover:text-brand'}`}>
            <Filter size={14} /> Filters
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">{activeFilters}</span>
            )}
          </button>
        </div>
      </div>

      {/* Filter panel — one row of controls above the content, driving both views. */}
      {showFilters && (
        <div className="px-6 py-4 bg-stone-50 border-b border-stone-100 flex flex-wrap gap-3 items-end flex-shrink-0">
          <Preset label="7 days"  onClick={() => setParams({ from: format(subDays(new Date(), 6), 'yyyy-MM-dd'), to: sastToday() })} />
          <Preset label="14 days" onClick={() => setParams({ from: format(subDays(new Date(), 13), 'yyyy-MM-dd'), to: sastToday() })} />
          <Preset label="30 days" onClick={() => setParams({ from: format(subDays(new Date(), 29), 'yyyy-MM-dd'), to: sastToday() })} />
          <Field label="From">
            <input type="date" value={dateFrom} onChange={e => setParams({ from: e.target.value })} className={INP} />
          </Field>
          <Field label="To">
            <input type="date" value={dateTo} onChange={e => setParams({ to: e.target.value })} className={INP} />
          </Field>
          <Field label="Section">
            <select value={filterSection} onChange={e => setParams({ section: e.target.value })} className={`${INP} cursor-pointer`}>
              <option value="">All sections</option>
              {SECTION_ORDER.map(s => <option key={s} value={s}>{sectionMeta(s).name}</option>)}
            </select>
          </Field>
          <Field label="Variant">
            <select value={filterVariant} onChange={e => setParams({ variant: e.target.value })} className={`${INP} cursor-pointer`}>
              <option value="">All variants</option>
              {VARIANT_OPTS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Shift">
            <select value={filterShift} onChange={e => setParams({ shift: e.target.value })} className={`${INP} cursor-pointer`}>
              <option value="">All shifts</option>
              {SHIFTS.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </Field>
          {view === 'records' && (
            <Field label="Status">
              <select value={filterStatus} onChange={e => setParams({ status: e.target.value })} className={`${INP} cursor-pointer`}>
                <option value="">All statuses</option>
                <option value="draft">In progress</option>
                <option value="submitted">Awaiting sign-off</option>
                <option value="approved">Signed off</option>
              </select>
            </Field>
          )}
          {activeFilters > 0 && (
            <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-stone-500 hover:text-err rounded-xl border border-stone-200 bg-white">
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
      )}

      {/* KPI strip — on BOTH views, because "how did we do" should not require
          switching tabs to find out. */}
      <KpiStrip kpis={analytics?.kpis ?? null} loading={kpiLoading} error={kpiError} />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === 'analytics' ? (
          <AnalyticsView data={analytics} loading={kpiLoading} error={kpiError} />
        ) : loading ? (
          <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Package size={24} className="text-stone-300" />
            <p className="text-[13px] text-stone-400">No production orders found for this date range.</p>
            {activeFilters > 0 && <button onClick={clearFilters} className="text-[12px] text-brand hover:underline">Clear filters</button>}
          </div>
        ) : (
          <div className="px-6 py-4 space-y-2 max-w-[1100px]">
            {groupByDate(filtered).map(({ date: d, rows }) => (
              <div key={d}>
                <div className="flex items-center gap-2 py-2">
                  <span className="text-[11px] font-bold text-stone-400 uppercase tracking-widest">
                    {format(parseISO(d + 'T12:00:00'), 'EEE d MMM yyyy')}
                  </span>
                  <span className="font-mono text-[10px] text-stone-400">
                    {Math.round(rows.reduce((t, r) => t + r.total_output_kg, 0)).toLocaleString()} kg out
                  </span>
                  <div className="flex-1 h-px bg-stone-100" />
                </div>
                <div className="space-y-1.5">
                  {rows.map(s => (
                    <OrderCard key={s.id} session={s} canEdit={canEdit} canDelete={canDelete}
                      canRequestReopen={canRequestReopen} returnUrl={returnUrl} onChanged={reload} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const INP = 'px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand'
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest block">{label}</label>
    {children}
  </div>
)
const Preset = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button onClick={onClick} className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[12px] text-stone-600 hover:border-brand hover:text-brand transition-colors">
    {label}
  </button>
)

// ── KPI strip ────────────────────────────────────────────────────────────────

function KpiStrip({ kpis, loading, error }: { kpis: Kpis | null; loading: boolean; error: string | null }) {
  if (error) {
    return (
      <div className="px-6 py-3 border-b border-stone-100 flex-shrink-0 bg-white">
        <p className="flex items-center gap-2 text-[12px] text-err"><AlertTriangle size={13} /> KPIs unavailable — {error}</p>
      </div>
    )
  }
  const tiles = [
    { label: 'tons out',      value: kpis ? kpis.totalTons.toFixed(2) : '—', hint: kpis ? `${kpis.totalOutputKg.toLocaleString()} kg` : '' },
    { label: 'tons / day',    value: kpis?.tonsPerDay != null ? kpis.tonsPerDay.toFixed(2) : '—', hint: kpis ? `over ${kpis.activeDays} producing day${kpis.activeDays === 1 ? '' : 's'}` : '' },
    { label: 'tons / week',   value: kpis?.tonsPerWeek != null ? kpis.tonsPerWeek.toFixed(2) : '—', hint: 'avg per week in range' },
    { label: 'kg / hour',     value: kpis?.kgPerHour != null ? kpis.kgPerHour.toLocaleString() : '—', hint: 'throughput, all lines' },
    { label: 'yield',         value: kpis?.yieldPct != null ? `${kpis.yieldPct}%` : '—', hint: kpis ? `${kpis.totalInputKg.toLocaleString()} kg in` : '' },
    { label: 'records',       value: kpis ? String(kpis.sessions) : '—', hint: kpis ? `${kpis.signedOff} signed off` : '' },
    { label: 'balance flags', value: kpis ? String(kpis.balanceFlags) : '—', hint: 'over tolerance', warn: !!kpis?.balanceFlags },
  ]
  return (
    <div className="px-6 py-3 border-b border-stone-100 flex items-stretch gap-5 flex-shrink-0 bg-white overflow-x-auto">
      {tiles.map((t, i) => (
        <div key={t.label} className="flex items-stretch gap-5 shrink-0">
          {i > 0 && <div className="w-px bg-stone-200" />}
          <div>
            <div className={`font-mono font-bold text-[18px] leading-tight ${t.warn ? 'text-warn' : 'text-text'}`}>
              {loading && !kpis ? '—' : t.value}
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide">{t.label}</div>
            {t.hint && <div className="text-[9px] text-stone-400">{t.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Analytics view ───────────────────────────────────────────────────────────

function AnalyticsView({ data, loading, error }: { data: Analytics | null; loading: boolean; error: string | null }) {
  if (loading && !data) return <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <AlertTriangle size={24} className="text-warn" />
        <p className="text-[13px] text-err">{error}</p>
      </div>
    )
  }
  if (!data || data.kpis.sessions === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <TrendingUp size={24} className="text-stone-300" />
        <p className="text-[13px] text-stone-400">Nothing was captured in this range, so there is nothing to chart.</p>
      </div>
    )
  }

  const dayData = data.perDay.map(d => ({ ...d, label: format(parseISO(d.date + 'T12:00:00'), 'd MMM') }))
  const weekData = data.perWeek.map(w => ({ ...w, label: `w/c ${format(parseISO(w.weekStart + 'T12:00:00'), 'd MMM')}` }))

  return (
    <div className="px-6 py-5 space-y-4 max-w-[1100px]">
      {/* Tons per day — one series, so no legend: the title names it. */}
      <Card title="Tons produced per day" subtitle="Bagged output, from mass balance">
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={dayData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} unit="t" />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(26,58,14,0.05)' }}
              formatter={(v: any, _n: any, entry: any) => [
                `${Number(v).toFixed(2)} t (${entry?.payload?.outputKg?.toLocaleString()} kg)`, 'Out',
              ]}
              labelFormatter={(l: any, payload: any) => {
                const d = payload?.[0]?.payload
                return d ? `${l} · ${d.sessions} record${d.sessions === 1 ? '' : 's'}${d.yieldPct != null ? ` · ${d.yieldPct}% yield` : ''}` : l
              }} />
            <Bar dataKey="tons" fill="#1A3A0E" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {weekData.length > 1 && (
        <Card title="Tons produced per week" subtitle="Week commencing Monday">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weekData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} unit="t" />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(26,58,14,0.05)' }}
                formatter={(v: any) => [`${Number(v).toFixed(2)} t`, 'Out']} />
              <Bar dataKey="tons" fill="#1A3A0E" radius={[4, 4, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Throughput by line. The line NAME is on the axis, so identity never
          depends on the bar colour — the section palette has two violets that a
          protanope can't separate, and colour here is decoration, not data. */}
      <Card title="Machine throughput by line" subtitle="kg out per producing hour">
        <ResponsiveContainer width="100%" height={Math.max(160, data.bySection.length * 38)}>
          <BarChart data={data.bySection} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="sectionName" tick={AXIS} axisLine={false} tickLine={false} width={110} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(26,58,14,0.05)' }}
              formatter={(v: any, _n: any, entry: any) => [
                `${Number(v).toLocaleString()} kg/h`,
                entry?.payload?.basis === 'run' ? 'From run time' : 'From crew hours',
              ]} />
            <Bar dataKey="kgPerHour" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.bySection.map(s => <Cell key={s.sectionId} fill={s.colorHex} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-text-muted mt-2">
          Measured from the first to the last bag on each record where that window is meaningful,
          otherwise from confirmed crew hours — the basis is shown per line in the table below,
          because the two answer slightly different questions.
        </p>
      </Card>

      {/* Per line, in full. A table because a production manager wants the exact
          numbers, and it carries yield, throughput and its basis together. */}
      <Card title="Per line" subtitle="Yield, throughput and flags" icon={Gauge}>
        <DataTable head={['Line', 'Records', 'kg in', 'kg out', 'Tons', 'Yield', 'Ran for', 'Crew hours', 'kg / hour', 'Basis', 'Flags']}>
          {data.bySection.map(s => (
            <tr key={s.sectionId}>
              <Cellx>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: s.colorHex }}>
                    <span className="font-mono font-bold text-[7px] text-white">{s.sectionCode}</span>
                  </span>
                  {s.sectionName}
                </span>
              </Cellx>
              <Cellx mono right>{s.sessions}</Cellx>
              <Cellx mono right>{s.inputKg.toLocaleString()}</Cellx>
              <Cellx mono right>{s.outputKg.toLocaleString()}</Cellx>
              <Cellx mono right>{s.tons.toFixed(2)}</Cellx>
              <Cellx mono right>{s.yieldPct != null ? `${s.yieldPct}%` : '—'}</Cellx>
              <Cellx mono right>{s.runMinutes ? hrs(s.runMinutes) : '—'}</Cellx>
              <Cellx mono right>{s.workedMinutes ? hrs(s.workedMinutes) : '—'}</Cellx>
              <Cellx mono right className="font-semibold">{s.kgPerHour != null ? s.kgPerHour.toLocaleString() : '—'}</Cellx>
              <Cellx>{s.basis === 'run' ? 'Run time' : s.basis === 'worked' ? 'Crew hours' : '—'}</Cellx>
              <Cellx mono right className={s.flagged ? 'text-warn font-semibold' : ''}>{s.flagged || '—'}</Cellx>
            </tr>
          ))}
        </DataTable>
      </Card>

      {/* How much of each output, and which line produced it. */}
      <Card title="Output produced, by product" subtitle="Every bagged product and the lines it came off" icon={Layers}>
        <DataTable head={['Product', 'Bags', 'kg', 'Tons', 'Share', 'From line(s)']}>
          {data.byProduct.map(pr => (
            <tr key={pr.productType}>
              <Cellx>{pr.productType}</Cellx>
              <Cellx mono right>{pr.bags}</Cellx>
              <Cellx mono right>{pr.kg.toLocaleString()}</Cellx>
              <Cellx mono right>{pr.tons.toFixed(2)}</Cellx>
              <Cellx mono right>
                {pr.sharePct != null ? (
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    <span className="hidden sm:inline-block w-14 h-1.5 rounded-full bg-stone-100 overflow-hidden align-middle">
                      <span className="block h-full bg-brand" style={{ width: `${Math.min(100, pr.sharePct)}%` }} />
                    </span>
                    {pr.sharePct}%
                  </span>
                ) : '—'}
              </Cellx>
              <Cellx>
                <span className="flex flex-wrap gap-1">
                  {pr.bySection.map(bs => (
                    <span key={bs.sectionId} title={`${bs.sectionName} — ${bs.kg.toLocaleString()} kg`}
                      className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                      {bs.sectionCode} {bs.kg.toLocaleString()}
                    </span>
                  ))}
                </span>
              </Cellx>
            </tr>
          ))}
        </DataTable>
      </Card>

      {data.byVariant.length > 1 && (
        <Card title="By variant" subtitle="Yield per material variant" icon={CalendarRange}>
          <DataTable head={['Variant', 'Records', 'kg in', 'kg out', 'Tons', 'Yield']}>
            {data.byVariant.map(v => (
              <tr key={v.variant}>
                <Cellx>{v.variant}</Cellx>
                <Cellx mono right>{v.sessions}</Cellx>
                <Cellx mono right>{v.inputKg.toLocaleString()}</Cellx>
                <Cellx mono right>{v.outputKg.toLocaleString()}</Cellx>
                <Cellx mono right>{v.tons.toFixed(2)}</Cellx>
                <Cellx mono right>{v.yieldPct != null ? `${v.yieldPct}%` : '—'}</Cellx>
              </tr>
            ))}
          </DataTable>
        </Card>
      )}
    </div>
  )
}

function Card({ title, subtitle, icon: Icon, children }: {
  title: string; subtitle?: string; icon?: React.ElementType; children: React.ReactNode
}) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-0.5">
        {Icon && <Icon size={14} className="text-text-muted shrink-0" />}
        <div className="font-display font-semibold text-[13px] text-text">{title}</div>
      </div>
      {subtitle && <div className="text-[11px] text-text-muted mb-3">{subtitle}</div>}
      {children}
    </div>
  )
}

function DataTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-surface-rule">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 font-mono text-[9px] font-semibold text-text-muted uppercase tracking-wide whitespace-nowrap ${i ? 'pl-3' : ''} ${i > 0 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-rule">{children}</tbody>
      </table>
    </div>
  )
}
const Cellx = ({ children, mono, right, className = '' }: {
  children: React.ReactNode; mono?: boolean; right?: boolean; className?: string
}) => (
  <td className={`py-2 pl-3 first:pl-0 text-[12px] text-text align-middle whitespace-nowrap ${mono ? 'font-mono' : ''} ${right ? 'text-right' : ''} ${className}`}>
    {children}
  </td>
)

// ── Records ──────────────────────────────────────────────────────────────────

function groupByDate(rows: SessionRow[]): { date: string; rows: SessionRow[] }[] {
  const map = new Map<string, SessionRow[]>()
  rows.forEach(r => {
    const g = map.get(r.date)
    if (g) g.push(r)
    else   map.set(r.date, [r])
  })
  return Array.from(map.entries()).map(([date, rows]) => ({ date, rows }))
}

function OrderCard({ session: s, canEdit, canDelete, canRequestReopen, returnUrl, onChanged }: {
  session: SessionRow; canEdit: boolean; canDelete: boolean
  canRequestReopen: boolean; returnUrl: string; onChanged: () => void
}) {
  const { displayName } = useAuth()
  const meta       = sectionMeta(s.section_id)
  const st         = STATUS[s.status] ?? STATUS.new
  const StatusIcon = st.icon
  const variance   = s.balance_kg ?? (s.total_input_kg - s.total_output_kg)
  const withinTol  = Math.abs(variance) <= massBalanceToleranceFor(s.section_id)
  const hasData    = s.bag_count > 0 || s.debag_count > 0 || s.has_raw_data
  const archived   = !!s.deleted_at
  const canManage  = canEdit || canDelete
  const yieldPct   = s.total_input_kg > 0 ? Math.round((s.total_output_kg / s.total_input_kg) * 1000) / 10 : null

  const [menuOpen, setMenuOpen] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [reopening, setReopening] = useState(false)
  const [form, setForm] = useState({
    operator_names:    (s.operator_names ?? []).join(', '),
    variant:           s.variant ?? '',
    lot_number:        s.lot_number ?? '',
    production_orders: (s.production_orders ?? []).join(', '),
  })

  async function act(action: string, fields?: any) {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/orders/${s.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, fields }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || 'Action failed') }
      else { setMenuOpen(false); setEditing(false); onChanged() }
    } catch { alert('Action failed') }
    finally { setBusy(false) }
  }
  const saveEdit = () => act('edit', {
    operator_names:    form.operator_names.split(',').map(x => x.trim()).filter(Boolean),
    variant:           form.variant || null,
    lot_number:        form.lot_number.trim() || null,
    production_orders: form.production_orders.split(',').map(x => x.trim()).filter(Boolean),
  })

  // Meta line — one flowing row of muted facts instead of a rigid grid column,
  // so a record with fewer facts (no PO, no lot) doesn't leave a ragged empty
  // cell and one with more doesn't get cramped.
  const metaParts = [
    s.operator_names?.length ? s.operator_names.join(', ') : 'No operators',
    s.lot_number,
  ].filter(Boolean)
  const poLabel = s.production_orders?.length ? `PO ${s.production_orders.join(', ')}` : null

  // Back out of capture returns HERE, with the filters that were applied.
  const href = `/production/capture/${s.section_id}?date=${s.date}&shift=${s.shift}&session=${s.id}`
    + `&return=${encodeURIComponent(returnUrl)}`

  return (
    <div className={`bg-white border rounded-2xl transition-all ${archived ? 'border-stone-200 opacity-70' : 'border-stone-200 hover:border-brand/40 hover:shadow-sm'}`}>
      <div className="flex items-center gap-3 px-5 py-3.5">
        <Link href={href} className="flex items-center gap-3.5 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm" style={{ background: meta.colorHex }}>
            <span className="font-mono font-bold text-[11px] text-white">{meta.code}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-[14px] text-text">{meta.name}</span>
              <span className="text-[11px] text-text-muted capitalize">{s.shift} · {s.variant ?? '—'}</span>
              {s.record_no && <span className="font-mono text-[10px] font-semibold text-brand">{s.record_no}</span>}
              {archived && <span className="text-[9px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">Archived</span>}
            </div>
            <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
              <div className="text-[11px] text-stone-400 truncate">{metaParts.join(' · ')}</div>
              {poLabel && <span className="text-[11px] font-medium text-stone-500 shrink-0">{poLabel}</span>}
            </div>
          </div>

          <div className="text-right shrink-0 hidden sm:block">
            {hasData ? (
              <>
                <div className="flex items-center justify-end gap-1 text-[12px] text-stone-600">
                  <Package size={11} /> {s.total_input_kg.toFixed(1)}
                  <ArrowRight size={10} className="text-stone-300" />
                  <PackageCheck size={11} /> {s.total_output_kg.toFixed(1)} kg
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  {/* Yield on the row — the number the record is actually judged
                      on, previously only visible by opening it. */}
                  {yieldPct != null && (
                    <span className="font-mono text-[10px] font-medium text-stone-500">{yieldPct}% yield</span>
                  )}
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${withinTol ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
                    <Scale size={10} />{variance > 0 ? '+' : ''}{variance.toFixed(1)} kg{!withinTol && <AlertTriangle size={10} />}
                  </span>
                </div>
              </>
            ) : <span className="text-stone-300 text-[11px]">No data</span>}
          </div>
        </Link>

        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${st.cls}`}>
          <StatusIcon size={11} /> {st.label}
        </span>

        {/* A supervisor can't reopen a signed-off record themselves — they ask,
            and the Production Manager decides it on the Sign-off tab. */}
        {canRequestReopen && !archived && (s.status === 'submitted' || s.status === 'approved') && (
          <button onClick={() => setReopening(true)} title="Request that this record be reopened for edits"
            className="p-1.5 rounded-lg text-stone-400 hover:text-warn hover:bg-stone-50 shrink-0">
            <Undo2 size={16} />
          </button>
        )}

        {s.lot_number && (
          <Link href={`/traceability?batch=${encodeURIComponent(s.lot_number)}`} title="Full batch traceability — yield, quality, reconciliation"
            className="p-1.5 rounded-lg text-stone-400 hover:text-brand hover:bg-stone-50 shrink-0">
            <BarChart3 size={16} />
          </Link>
        )}

        {canManage ? (
          <div className="relative shrink-0">
            <button onClick={() => setMenuOpen(o => !o)} disabled={busy}
              className="p-1.5 rounded-lg text-stone-400 hover:text-brand hover:bg-stone-50 disabled:opacity-40">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreHorizontal size={16} />}
            </button>
            {menuOpen && (<>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-20 w-48 bg-white border border-stone-200 rounded-xl shadow-lg py-1 text-[13px]">
                {archived ? (
                  canDelete && <button onClick={() => act('restore')} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50"><RotateCcw size={14} /> Restore</button>
                ) : (<>
                  {canEdit && <button onClick={() => { setEditing(e => !e); setMenuOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50"><Pencil size={14} /> Edit details</button>}
                  {canEdit && (s.status === 'submitted' || s.status === 'approved') &&
                    <button onClick={() => act('reopen')} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50"><Unlock size={14} /> Reopen for edits</button>}
                  {canDelete && <button onClick={() => { if (confirm('Archive this record? It will be hidden but kept for the audit trail and can be restored. Archived orders are excluded from KPI totals.')) act('delete') }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-err hover:bg-err/5"><Trash2 size={14} /> Archive</button>}
                </>)}
              </div>
            </>)}
          </div>
        ) : (
          <ChevronRight size={16} className="text-stone-300 shrink-0" />
        )}
      </div>

      {/* Empty record submitted/signed-off with nothing actually captured — e.g.
          an operator hit errors mid-batch, submitted anyway, and started a new
          record instead. Surfaced directly (not buried in the "…" menu) so it
          doesn't just sit there as silent clutter; discarding still goes
          through the same permissioned archive action as any other record. */}
      {!hasData && !archived && (s.status === 'submitted' || s.status === 'approved') && (
        <div className="flex items-center gap-2 px-5 pb-3 -mt-1 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-warn bg-warn/10 px-2 py-1 rounded-full">
            <AlertTriangle size={11} /> Empty record — no debagging or bagging captured
          </span>
          {canDelete && (
            <button
              onClick={() => { if (confirm('This record has no captured data. Archive it now? It will be hidden but kept for the audit trail and can be restored.')) act('delete') }}
              disabled={busy}
              className="text-[11px] font-medium text-err hover:underline disabled:opacity-40">
              Discard
            </button>
          )}
        </div>
      )}

      {/* Small-screen data row — the two-column right-aligned block above hides
          under sm; show the same facts inline instead of dropping them. */}
      {hasData && (
        <div className="sm:hidden flex items-center gap-2 px-5 pb-3 -mt-1 text-[11px] text-stone-500 flex-wrap">
          <Package size={11} /> {s.total_input_kg.toFixed(1)} kg
          <ArrowRight size={10} className="text-stone-300" />
          <PackageCheck size={11} /> {s.total_output_kg.toFixed(1)} kg
          {yieldPct != null && <span className="font-mono">{yieldPct}%</span>}
          <span className={`inline-flex items-center gap-1 font-medium px-1.5 py-0.5 rounded-full ${withinTol ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
            {variance > 0 ? '+' : ''}{variance.toFixed(1)} kg
          </span>
        </div>
      )}

      {editing && (
        <div className="border-t border-stone-100 px-5 py-4 bg-stone-50/50 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 block"><span className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Operators (comma-separated)</span>
              <input value={form.operator_names} onChange={e => setForm(f => ({ ...f, operator_names: e.target.value }))} className={EDIT_INP} /></label>
            <label className="space-y-1 block"><span className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Variant</span>
              <select value={form.variant} onChange={e => setForm(f => ({ ...f, variant: e.target.value }))} className={EDIT_INP + ' cursor-pointer'}>
                <option value="">—</option>{VARIANT_OPTS.map(v => <option key={v} value={v}>{v}</option>)}
              </select></label>
            <label className="space-y-1 block"><span className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Lot / batch</span>
              <input value={form.lot_number} onChange={e => setForm(f => ({ ...f, lot_number: e.target.value }))} className={EDIT_INP} /></label>
            <label className="space-y-1 block"><span className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Production order(s) (comma-separated)</span>
              <input value={form.production_orders} onChange={e => setForm(f => ({ ...f, production_orders: e.target.value }))} className={EDIT_INP} /></label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={saveEdit} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl border border-stone-200 text-[13px] text-stone-600 hover:bg-white">Cancel</button>
            <span className="text-[11px] text-stone-400 ml-auto hidden sm:block">Weights / batches → open the record to edit in capture.</span>
          </div>
        </div>
      )}

      {reopening && (
        <RequestReopenModal session={s} requestedByName={displayName ?? null}
          onClose={() => setReopening(false)} onDone={() => { setReopening(false); onChanged() }} />
      )}
    </div>
  )
}

const EDIT_INP = 'w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'

// ── "Request reopen" ─────────────────────────────────────────────────────────
// Lifted from the retired /supervisor/productions page so the action sits on the
// record it applies to. The DECISION stays with the Production Manager, on the
// Supervisor Hub's Sign-off tab.
function RequestReopenModal({ session: s, requestedByName, onClose, onDone }: {
  session: SessionRow; requestedByName: string | null
  onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [sent, setSent]     = useState(false)
  const m = sectionMeta(s.section_id)

  async function submit() {
    if (!reason.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/production/orders/${s.id}/reopen-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), requestedByName }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setSent(true)
      setTimeout(onDone, 1200)
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-warn/10 flex items-center justify-center shrink-0"><Undo2 size={18} className="text-warn" /></div>
          <div className="min-w-0">
            <div className="font-semibold text-[16px] text-text leading-tight">Request to reopen</div>
            <div className="text-[12px] text-text-muted mt-0.5">
              {m.name} · {format(parseISO(s.date + 'T12:00:00'), 'EEE d MMM')} · <span className="capitalize">{s.shift}</span>
            </div>
          </div>
        </div>
        {sent ? (
          <p className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 size={15} /> Sent — a Production Manager will decide it.</p>
        ) : (<>
          <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>A Production Manager or IT reviews this and reopens the record for edits if approved.</span>
          </div>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
            placeholder="What needs to be fixed?"
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none" />
          {error && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> {error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onClose} disabled={busy}
              className="py-2.5 rounded-xl border border-stone-200 bg-white text-text font-medium text-[13px] hover:bg-stone-50 disabled:opacity-40 transition-colors">
              Cancel
            </button>
            <button onClick={submit} disabled={busy || !reason.trim()}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand text-white font-medium text-[13px] disabled:opacity-40 hover:bg-brand-mid transition-colors">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Send request
            </button>
          </div>
        </>)}
      </div>
    </div>
  )
}

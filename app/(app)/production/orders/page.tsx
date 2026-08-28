'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { format, parseISO, subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Loader2, CheckCircle2, Clock, Pen, Play, ChevronRight,
  Filter, X, AlertTriangle, Package, ArrowRight, MoreHorizontal, Pencil, Trash2,
  RotateCcw, Save, Unlock, Archive, BarChart3, List, Gauge, TrendingUp, Undo2,
  Layers, Scale, FileText, MessageSquare, MessageSquarePlus,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta, SECTION_ORDER, massBalanceToleranceFor, VARIANT_OPTIONS } from '@/lib/production/capture-config'
import { sastToday } from '@/lib/production/shifts'
import {
  Panel, PanelHead, PanelBody, Stat, StatRow, BarRow, ShareBar, ActionPanel,
  Collapse, Table, Tr, Td, Empty, Pill, SectionChip, MARK, MARK_SOFT,
  type Action,
} from '@/components/production/ui/kit'

// Production Orders — the single home for captured batch records and the KPIs
// that describe them. Two views over one set of filters: Records and Analytics.
//
// Rebuilt on components/production/ui/kit.tsx so this page, the Supervisor Hub
// and the Shift Report read as one product. The changes from the first pass are
// all in the same direction: what needs doing goes above what happened, graphs
// replace table walls, exact numbers move behind a disclosure, and the chrome
// gets out of the way (hairline rules, no shadows, one border weight).
//
// Filters live in the URL, and every link into capture carries a `return`
// pointing back at that exact URL — so Back returns you to the list you were
// reading, with its filters, instead of the capture landing page.

const VARIANT_OPTS = VARIANT_OPTIONS.map(v => v.value)
const SHIFTS = ['morning', 'afternoon', 'night']
const AXIS = { fontSize: 10.5, fill: 'var(--color-text-faint)' }

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
  sup_name_signoff: string | null
  sup_signed_at: string | null
  deleted_at: string | null
  edited_at: string | null
  total_input_kg: number
  total_output_kg: number
  balance_kg: number | null
  debag_count: number
  bag_count: number
  has_raw_data: boolean
  note_count: number
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

const STATUS: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'info'; icon: any }> = {
  draft:     { label: 'In progress',       tone: 'warn',    icon: Pen },
  submitted: { label: 'Awaiting sign-off', tone: 'info',    icon: Clock },
  approved:  { label: 'Signed off',        tone: 'ok',      icon: CheckCircle2 },
  new:       { label: 'Not started',       tone: 'neutral', icon: Play },
}

const hrs = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m` }

export default function ProductionOrdersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={22} className="animate-spin text-text-faint" /></div>}>
      <OrdersInner />
    </Suspense>
  )
}

function OrdersInner() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

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

  const loadedOnceRef = useRef(false)

  useEffect(() => {
    let alive = true
    async function load() {
      // Only block the view with a spinner on the very first load. A
      // background refresh (the 30s poll below, or an explicit reload after
      // an action) must never unmount the row list in place — anything open
      // in it, like the "Request reopen" modal's textarea, would be wiped
      // out mid-type. See loadedOnceRef.current gate further down.
      if (!loadedOnceRef.current) setLoading(true)
      const db = getDb()

      const { data: sess } = await db.schema('production').from('prod_sessions')
        .select('id,section_id,date,shift,status,operator_names,lot_number,variant,production_orders,created_at,submitted_at,sup_name_signoff,sup_signed_at')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: false }).order('created_at', { ascending: false })
        .limit(200)

      if (!alive) return
      if (!sess?.length) { setSessions([]); loadedOnceRef.current = true; setLoading(false); return }

      const ids = (sess as any[]).map(s => s.id)

      // Record-management columns are best-effort: if the migration hasn't been
      // applied to this database yet, selecting them 400s — so fetch them
      // separately and degrade gracefully (no record number / no archived state).
      const extra = new Map<string, any>()
      const { data: ex, error: exErr } = await db.schema('production').from('prod_sessions')
        .select('id,record_no,deleted_at,edited_at').in('id', ids)
      if (!exErr && ex) (ex as any[]).forEach(r => extra.set(r.id, r))

      const rawData = new Map<string, boolean>()
      const { data: drafts } = await db.schema('production').from('prod_sessions')
        .select('id,draft_data').in('id', ids)
      ;(drafts as any[] ?? []).forEach(r => rawData.set(r.id, hasRawCaptureData(r.draft_data?.productions)))

      const { data: mb } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg,balance_kg').in('session_id', ids)
      const mbMap = new Map<string, any>()
      ;(mb ?? []).forEach((r: any) => mbMap.set(r.session_id, r))

      // Output bag count + weight come from the bag_tags ledger (one atomic row
      // per physical bag, the same source Quality reads), NOT prod_bagging —
      // prod_bagging's delete+reinsert-all save intermittently drops bags, so a
      // session with 18 real bags could show "1" here. prod_bagging is unioned
      // in only to cover any bag it has that bag_tags doesn't (no-serial
      // by-products, Pasteuriser range rows); voided bags are excluded.
      const [{ data: tags }, { data: bags }, { data: debags }, { data: noteRows }] = await Promise.all([
        db.schema('production').from('bag_tags').select('session_id,serial_number,weight_kg,status').in('session_id', ids),
        db.schema('production').from('prod_bagging').select('session_id,bag_serial_no,kg').in('session_id', ids),
        db.schema('production').from('prod_debagging').select('session_id').in('session_id', ids),
        db.schema('production').from('po_notes').select('session_id').in('session_id', ids),
      ])
      const noteCount = new Map<string, number>()
      ;(noteRows ?? []).forEach((r: any) => noteCount.set(r.session_id, (noteCount.get(r.session_id) ?? 0) + 1))
      // Per session: build the reliable output set keyed by serial.
      const perSession = new Map<string, { serials: Set<string>; kg: number; noSerial: number; voided: Set<string> }>()
      const bucket = (sid: string) => {
        let b = perSession.get(sid)
        if (!b) { b = { serials: new Set(), kg: 0, noSerial: 0, voided: new Set() }; perSession.set(sid, b) }
        return b
      }
      ;(tags ?? []).forEach((t: any) => {
        const b = bucket(t.session_id)
        if (t.status === 'voided') { b.voided.add(t.serial_number); return }
        if (!b.serials.has(t.serial_number)) { b.serials.add(t.serial_number); b.kg += Number(t.weight_kg) || 0 }
      })
      ;(bags ?? []).forEach((r: any) => {
        const b = bucket(r.session_id)
        if (!r.bag_serial_no) { b.noSerial += 1; b.kg += Number(r.kg) || 0; return }
        if (b.voided.has(r.bag_serial_no) || b.serials.has(r.bag_serial_no)) return
        b.serials.add(r.bag_serial_no); b.kg += Number(r.kg) || 0
      })
      const bagCount    = new Map<string, number>()
      const outputKgMap = new Map<string, number>()
      for (const [sid, b] of perSession) { bagCount.set(sid, b.serials.size + b.noSerial); outputKgMap.set(sid, b.kg) }

      const debagCount = new Map<string, number>()
      ;(debags ?? []).forEach((r: any) => debagCount.set(r.session_id, (debagCount.get(r.session_id) ?? 0) + 1))

      if (!alive) return
      setSessions((sess as any[]).map(s => {
        const m = mbMap.get(s.id)
        const x = extra.get(s.id) ?? {}
        return {
          ...s,
          record_no:  x.record_no ?? null,
          deleted_at: x.deleted_at ?? null,
          edited_at:  x.edited_at ?? null,
          total_input_kg: m ? parseFloat(m.total_input_kg) : 0,
          // Reliable output weight = Σ of the actual bags (bag_tags ledger),
          // not the prod_mass_balance snapshot which can lag when a save races
          // a bag-add. Keeps the list's output figure in step with the bags
          // the order detail now shows.
          total_output_kg: outputKgMap.get(s.id) ?? 0,
          balance_kg: m ? parseFloat(m.balance_kg) : null,
          debag_count: debagCount.get(s.id) ?? 0,
          bag_count:   bagCount.get(s.id)   ?? 0,
          has_raw_data: rawData.get(s.id) ?? false,
          note_count: noteCount.get(s.id) ?? 0,
        }
      }))
      loadedOnceRef.current = true
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [dateFrom, dateTo, refreshKey])

  // Keep the list live while it's open — reporting is watched during a running
  // shift, so a bag captured on the floor should surface here on its own,
  // without a manual refresh or reopening the capture page. A 30s poll is
  // enough for a list view (the per-order detail is realtime-instant).
  useEffect(() => {
    const t = setInterval(() => setRefreshKey(k => k + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => sessions.filter(s => {
    // Hide stray empty drafts — a draft/new session with no debagging, no bagging
    // and no mass balance is an abandoned "No data" row. Submitted/approved
    // records always show.
    const isEmpty = s.debag_count === 0 && s.bag_count === 0 && !s.total_input_kg && !s.total_output_kg && !s.has_raw_data
    if (isEmpty && (s.status === 'draft' || s.status === 'new')) return false
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

  // What needs doing across the visible range — above the figures, as everywhere
  // else in this redesign.
  const actions: Action[] = useMemo(() => {
    const out: Action[] = []
    const awaiting = filtered.filter(s => s.status === 'submitted')
    if (awaiting.length) {
      out.push({
        label: `${awaiting.length} record${awaiting.length === 1 ? '' : 's'} awaiting sign-off`,
        detail: 'Oldest first on the Supervisor Hub’s Sign-off queue',
        href: '/supervisor/signoff', severity: 'warn', count: awaiting.length,
      })
    }
    const flagged = filtered.filter(s => {
      const v = s.balance_kg ?? (s.total_input_kg - s.total_output_kg)
      return (s.bag_count > 0 || s.debag_count > 0) && Math.abs(v) > massBalanceToleranceFor(s.section_id)
    })
    for (const s of flagged.slice(0, 5)) {
      const v = s.balance_kg ?? (s.total_input_kg - s.total_output_kg)
      out.push({
        label: `${sectionMeta(s.section_id).name} is out by ${v.toFixed(1)} kg`,
        detail: `${format(parseISO(s.date + 'T12:00:00'), 'EEE d MMM')} · ${s.shift} · tolerance ±${massBalanceToleranceFor(s.section_id)} kg`,
        href: `/production/capture/${s.section_id}?date=${s.date}&shift=${s.shift}&session=${s.id}&tab=overview&return=${encodeURIComponent(returnUrl)}`,
        severity: 'critical',
      })
    }
    const empties = filtered.filter(s =>
      !s.deleted_at && (s.status === 'submitted' || s.status === 'approved')
      && s.bag_count === 0 && s.debag_count === 0 && !s.has_raw_data)
    if (empties.length) {
      out.push({
        label: `${empties.length} signed record${empties.length === 1 ? '' : 's'} with nothing captured`,
        detail: 'Empty records still count as production orders — archive them',
        href: `${pathname}?${new URLSearchParams({ ...Object.fromEntries(params), status: 'submitted' }).toString()}`,
        severity: 'info', count: empties.length,
      })
    }
    return out
  }, [filtered, pathname, params, returnUrl])

  const rangeLabel = `${format(parseISO(dateFrom + 'T12:00:00'), 'd MMM')} – ${format(parseISO(dateTo + 'T12:00:00'), 'd MMM yyyy')}`

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 px-6 pt-6 pb-4 flex-shrink-0 flex-wrap border-b border-surface-rule/60">
        <div>
          <h1 className="font-display font-semibold text-[22px] text-text leading-tight tracking-[-0.02em]">Production Orders</h1>
          <p className="text-[12px] text-text-muted mt-1">
            {rangeLabel}
            {activeFilters > 0 ? ` · ${activeFilters} filter${activeFilters === 1 ? '' : 's'}` : ''}
            {showArchived ? ' · archived' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 p-1 bg-surface-dim rounded-xl">
            {([['records', 'Records', List], ['analytics', 'Analytics', BarChart3]] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => setParams({ view: v === 'records' ? null : v })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${view === v ? 'bg-surface-card text-brand' : 'text-text-muted hover:text-text'}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {(canEdit || canDelete) && view === 'records' && (
            <button onClick={() => setParams({ archived: showArchived ? null : '1' })}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-[12.5px] font-medium transition-colors
                ${showArchived ? 'border-brand bg-brand/5 text-brand' : 'border-surface-rule text-text-muted hover:border-brand hover:text-brand'}`}>
              <Archive size={14} /> Archived
            </button>
          )}
          <button onClick={() => setShowFilters(f => !f)}
            className={`relative flex items-center gap-2 px-3.5 py-2 rounded-xl border text-[12.5px] font-medium transition-colors
              ${showFilters || activeFilters > 0 ? 'border-brand bg-brand/5 text-brand' : 'border-surface-rule text-text-muted hover:border-brand hover:text-brand'}`}>
            <Filter size={14} /> Filters
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 min-w-[18px] h-[18px] rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">{activeFilters}</span>
            )}
          </button>
        </div>
      </div>

      {/* Filters — one row above the content, driving both views. */}
      {showFilters && (
        <div className="px-6 py-4 bg-surface-raised border-b border-surface-rule/60 flex flex-wrap gap-3 items-end flex-shrink-0">
          {[[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']].map(([d, label]) => (
            <button key={label as string} onClick={() => setParams({ from: format(subDays(new Date(), (d as number) - 1), 'yyyy-MM-dd'), to: sastToday() })}
              className="px-3 py-2 rounded-xl border border-surface-rule bg-surface-card text-[12px] text-text-muted hover:border-brand hover:text-brand transition-colors">
              {label as string}
            </button>
          ))}
          <Field label="From"><input type="date" value={dateFrom} onChange={e => setParams({ from: e.target.value })} className={INP} /></Field>
          <Field label="To"><input type="date" value={dateTo} onChange={e => setParams({ to: e.target.value })} className={INP} /></Field>
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
            <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-text-muted hover:text-err rounded-xl border border-surface-rule bg-surface-card transition-colors">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-5 space-y-4 max-w-[1050px]">
          {kpiError ? (
            <Panel tone="attention">
              <PanelBody className="pt-4">
                <p className="flex items-center gap-2 text-[12px] text-warn"><AlertTriangle size={13} /> KPIs unavailable — {kpiError}</p>
              </PanelBody>
            </Panel>
          ) : (
            <Panel>
              <StatRow>
                <Stat value={analytics ? analytics.kpis.totalTons.toFixed(2) : '—'} unit="t" label="Tons out"
                  hint={analytics ? `${analytics.kpis.totalOutputKg.toLocaleString()} kg` : ''}
                  spark={analytics && analytics.perDay.length > 1 ? analytics.perDay.map(d => d.tons) : undefined} />
                <Stat value={analytics?.kpis.tonsPerDay != null ? analytics.kpis.tonsPerDay.toFixed(2) : '—'} unit="t"
                  label="Tons per day" hint={analytics ? `over ${analytics.kpis.activeDays} producing day${analytics.kpis.activeDays === 1 ? '' : 's'}` : ''} />
                <Stat value={analytics?.kpis.tonsPerWeek != null ? analytics.kpis.tonsPerWeek.toFixed(2) : '—'} unit="t"
                  label="Tons per week" hint="average in range" />
                <Stat value={analytics?.kpis.kgPerHour != null ? analytics.kpis.kgPerHour.toLocaleString() : '—'} unit="kg/h"
                  label="Throughput" hint="all lines" />
                <Stat value={analytics?.kpis.yieldPct != null ? String(analytics.kpis.yieldPct) : '—'} unit="%"
                  label="Yield" hint={analytics ? `${analytics.kpis.totalInputKg.toLocaleString()} kg in` : ''} />
                <Stat value={analytics ? String(analytics.kpis.sessions) : '—'} label="Records"
                  hint={analytics ? `${analytics.kpis.signedOff} signed · ${analytics.kpis.balanceFlags} flagged` : ''}
                  tone={analytics?.kpis.balanceFlags ? 'warn' : 'plain'} />
              </StatRow>
            </Panel>
          )}

          {view === 'records' && actions.length > 0 && <ActionPanel actions={actions} />}

          {view === 'analytics' ? (
            <AnalyticsView data={analytics} loading={kpiLoading} error={kpiError} returnUrl={returnUrl} />
          ) : loading ? (
            <div className="flex items-center justify-center h-48"><Loader2 size={22} className="animate-spin text-text-faint" /></div>
          ) : filtered.length === 0 ? (
            <Panel>
              <div className="flex flex-col items-center justify-center py-16 gap-2.5">
                <Package size={22} className="text-text-faint/40" />
                <p className="text-[13px] text-text-faint">No production orders in this range.</p>
                {activeFilters > 0 && <button onClick={clearFilters} className="text-[12px] text-brand hover:underline">Clear filters</button>}
              </div>
            </Panel>
          ) : (
            <div className="space-y-4">
              {groupByDate(filtered).map(({ date: d, rows }) => (
                <div key={d}>
                  <div className="flex items-baseline gap-2.5 pb-2">
                    <span className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.06em]">
                      {format(parseISO(d + 'T12:00:00'), 'EEE d MMM yyyy')}
                    </span>
                    <span className="font-mono text-[10.5px] text-text-faint">
                      {Math.round(rows.reduce((t, r) => t + r.total_output_kg, 0)).toLocaleString()} kg out · {rows.length} record{rows.length === 1 ? '' : 's'}
                    </span>
                    <div className="flex-1 h-px bg-surface-rule/50" />
                  </div>
                  <Panel>
                    <div className="divide-y divide-surface-rule/40">
                      {rows.map(s => (
                        <OrderRow key={s.id} session={s} canEdit={canEdit} canDelete={canDelete}
                          canRequestReopen={canRequestReopen} returnUrl={returnUrl}
                          maxKg={Math.max(1, ...rows.map(r => r.total_output_kg))} onChanged={reload} />
                      ))}
                    </div>
                  </Panel>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const INP = 'px-3 py-2 rounded-xl border border-surface-rule bg-surface-card text-[12.5px] text-text outline-none focus:border-brand'
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <label className="text-[9.5px] font-semibold text-text-faint uppercase tracking-[0.06em] block">{label}</label>
    {children}
  </div>
)

// ── Analytics ────────────────────────────────────────────────────────────────

function AnalyticsView({ data, loading, error, returnUrl }: {
  data: Analytics | null; loading: boolean; error: string | null; returnUrl: string
}) {
  if (loading && !data) return <div className="flex items-center justify-center h-48"><Loader2 size={22} className="animate-spin text-text-faint" /></div>
  if (error) return null
  if (!data || data.kpis.sessions === 0) {
    return (
      <Panel>
        <div className="flex flex-col items-center justify-center py-16 gap-2.5">
          <TrendingUp size={22} className="text-text-faint/40" />
          <p className="text-[13px] text-text-faint">Nothing was captured in this range, so there is nothing to chart.</p>
        </div>
      </Panel>
    )
  }

  const dayData = data.perDay.map(d => ({ ...d, label: format(parseISO(d.date + 'T12:00:00'), 'd MMM') }))
  const weekData = data.perWeek.map(w => ({ ...w, label: format(parseISO(w.weekStart + 'T12:00:00'), 'd MMM') }))
  const maxThroughput = Math.max(1, ...data.bySection.map(s => s.kgPerHour ?? 0))
  const productTotal = data.byProduct.reduce((t, p) => t + p.kg, 0)

  return (
    <div className="space-y-4">
      {/* Trend. One series, so no legend — the title names it. An axis genuinely
          helps here, which is why this is the only place a chart library is used;
          everywhere else the kit's own marks are lighter and more consistent. */}
      <Panel>
        <PanelHead icon={Scale} title="Tons produced per day" meta="bagged output, from mass balance" />
        <PanelBody>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dayData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--color-surface-rule)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={30} unit="t" />
              <Tooltip cursor={{ fill: MARK_SOFT }}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid var(--color-surface-rule)', background: 'var(--color-surface-card)' }}
                formatter={(v: any, _n: any, entry: any) => [`${Number(v).toFixed(2)} t (${entry?.payload?.outputKg?.toLocaleString()} kg)`, 'Out']}
                labelFormatter={(l: any, payload: any) => {
                  const d = payload?.[0]?.payload
                  return d ? `${l} · ${d.sessions} record${d.sessions === 1 ? '' : 's'}${d.yieldPct != null ? ` · ${d.yieldPct}% yield` : ''}` : l
                }} />
              <Bar dataKey="tons" fill={MARK} radius={[3, 3, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </PanelBody>
      </Panel>

      {weekData.length > 1 && (
        <Panel>
          <PanelHead icon={Scale} title="Tons produced per week" meta="week commencing Monday" />
          <PanelBody>
            <div className="-my-1">
              {weekData.map(w => (
                <BarRow key={w.weekStart} label={`w/c ${w.label}`}
                  sublabel={`${w.sessions} record${w.sessions === 1 ? '' : 's'}${w.yieldPct != null ? ` · ${w.yieldPct}% yield` : ''}`}
                  value={w.tons} max={Math.max(...weekData.map(x => x.tons), 1)}
                  display={`${w.tons.toFixed(2)} t`} />
              ))}
            </div>
          </PanelBody>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Throughput. Line name on the axis, so identity never rests on colour. */}
        <Panel>
          <PanelHead icon={Gauge} title="Throughput by line" meta="kg out per producing hour" />
          <PanelBody className="space-y-3">
            <div className="-my-1">
              {data.bySection.map(s => (
                <BarRow key={s.sectionId} label={s.sectionName}
                  sublabel={s.basis === 'run' ? `ran ${hrs(s.runMinutes)}` : s.basis === 'worked' ? `${hrs(s.workedMinutes)} crew` : 'no basis'}
                  value={s.kgPerHour ?? 0} max={maxThroughput}
                  display={s.kgPerHour != null ? `${s.kgPerHour.toLocaleString()} kg/h` : '—'}
                  badge={s.flagged ? <Pill tone="warn">{s.flagged} flagged</Pill> : undefined} />
              ))}
            </div>
            <p className="text-[11px] text-text-faint">
              Measured first bag to last where that window is meaningful, otherwise from confirmed crew hours.
            </p>
          </PanelBody>
        </Panel>

        {/* Output produced, by product. */}
        <Panel>
          <PanelHead icon={Layers} title="Output by product" meta={`${productTotal.toLocaleString()} kg bagged`} />
          <PanelBody className="space-y-4">
            <ShareBar items={data.byProduct.map(pr => ({
              label: pr.productType, value: pr.kg, display: `${pr.kg.toLocaleString()} kg`,
            }))} total={productTotal} />
            <Collapse label="Show which line produced what">
              <Table head={['Product', 'Bags', 'kg', 'Tons', 'Share', 'From line(s)']}>
                {data.byProduct.map(pr => (
                  <Tr key={pr.productType}>
                    <Td>{pr.productType}</Td>
                    <Td mono right>{pr.bags}</Td>
                    <Td mono right>{pr.kg.toLocaleString()}</Td>
                    <Td mono right>{pr.tons.toFixed(2)}</Td>
                    <Td mono right>{pr.sharePct != null ? `${pr.sharePct}%` : '—'}</Td>
                    <Td right>
                      <span className="flex flex-wrap gap-1 justify-end">
                        {pr.bySection.map(bs => (
                          <span key={bs.sectionId} title={`${bs.sectionName} — ${bs.kg.toLocaleString()} kg`}
                            className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-dim text-text-muted">
                            {bs.sectionCode} {bs.kg.toLocaleString()}
                          </span>
                        ))}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </Table>
            </Collapse>
          </PanelBody>
        </Panel>
      </div>

      {/* Per line, in full — the exact numbers, on request. */}
      <Panel>
        <PanelHead icon={Gauge} title="Per line" meta="yield, throughput and flags" />
        <PanelBody>
          <Collapse label="Show the full per-line table" count={data.bySection.length} defaultOpen>
            <Table head={['Line', 'Records', 'kg in', 'kg out', 'Tons', 'Yield', 'Ran for', 'Crew hours', 'kg / hour', 'Basis', 'Flags']}>
              {data.bySection.map(s => (
                <Tr key={s.sectionId}>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <SectionChip code={s.sectionCode} colorHex={s.colorHex} size={18} />
                      {s.sectionName}
                    </span>
                  </Td>
                  <Td mono right>{s.sessions}</Td>
                  <Td mono right>{s.inputKg.toLocaleString()}</Td>
                  <Td mono right>{s.outputKg.toLocaleString()}</Td>
                  <Td mono right>{s.tons.toFixed(2)}</Td>
                  <Td mono right>{s.yieldPct != null ? `${s.yieldPct}%` : '—'}</Td>
                  <Td mono right>{s.runMinutes ? hrs(s.runMinutes) : '—'}</Td>
                  <Td mono right>{s.workedMinutes ? hrs(s.workedMinutes) : '—'}</Td>
                  <Td mono right>{s.kgPerHour != null ? s.kgPerHour.toLocaleString() : '—'}</Td>
                  <Td right>{s.basis === 'run' ? 'Run time' : s.basis === 'worked' ? 'Crew hours' : '—'}</Td>
                  <Td mono right tone={s.flagged ? 'warn' : undefined}>{s.flagged || '—'}</Td>
                </Tr>
              ))}
            </Table>
          </Collapse>
        </PanelBody>
      </Panel>

      {data.byVariant.length > 1 && (
        <Panel>
          <PanelHead icon={Layers} title="By variant" meta="yield per material variant" />
          <PanelBody>
            <div className="-my-1">
              {data.byVariant.map(v => (
                <BarRow key={v.variant} label={v.variant}
                  sublabel={`${v.sessions} record${v.sessions === 1 ? '' : 's'}${v.yieldPct != null ? ` · ${v.yieldPct}% yield` : ''}`}
                  value={v.tons} max={Math.max(...data.byVariant.map(x => x.tons), 1)}
                  display={`${v.tons.toFixed(2)} t`} />
              ))}
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  )
}

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

function OrderRow({ session: s, canEdit, canDelete, canRequestReopen, returnUrl, maxKg, onChanged }: {
  session: SessionRow; canEdit: boolean; canDelete: boolean
  canRequestReopen: boolean; returnUrl: string; maxKg: number; onChanged: () => void
}) {
  const { displayName } = useAuth()
  const meta       = sectionMeta(s.section_id)
  const st         = STATUS[s.status] ?? STATUS.new
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
  const [noting,    setNoting]    = useState(false)
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

  const href = `/production/capture/${s.section_id}?date=${s.date}&shift=${s.shift}&session=${s.id}`
    + `&return=${encodeURIComponent(returnUrl)}`

  const facts = [
    s.operator_names?.length ? s.operator_names.join(', ') : null,
    s.lot_number,
    s.variant,
    s.production_orders?.length ? `PO ${s.production_orders.join(', ')}` : null,
    // Surfaced right in the list — previously the only way to see who
    // actually signed off was opening the session itself.
    s.status === 'approved' && s.sup_name_signoff ? `Signed off by ${s.sup_name_signoff}` : null,
  ].filter(Boolean)

  return (
    <div className={archived ? 'opacity-60' : ''}>
      <div className="flex items-center gap-3 px-5 py-3 flex-wrap">
        <Link href={href} className="flex items-center gap-3 w-full sm:w-auto sm:flex-1 min-w-0">
          <SectionChip code={meta.code} colorHex={meta.colorHex} size={30} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-body font-medium text-[13.5px] text-text">{meta.name}</span>
              <span className="text-[11px] text-text-faint capitalize">{s.shift}</span>
              {s.record_no && <span className="font-mono text-[10px] text-brand">{s.record_no}</span>}
              {archived && <Pill>Archived</Pill>}
            </div>
            <div className="text-[11px] text-text-faint truncate mt-0.5">{facts.join(' · ') || 'No details captured'}</div>
          </div>

          {hasData ? (
            <div className="shrink-0 hidden sm:block w-40">
              <div className="flex items-baseline justify-end gap-2 mb-1">
                <span className="font-mono text-[12.5px] text-text tabular-nums">{s.total_output_kg.toFixed(0)} kg</span>
                {yieldPct != null && <span className="font-mono text-[10.5px] text-text-faint">{yieldPct}%</span>}
              </div>
              {/* Output relative to the busiest record that day — the shape of the
                  day without a chart per row. */}
              <div className="h-1.5 rounded-full bg-surface-dim overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (s.total_output_kg / maxKg) * 100)}%`, background: meta.colorHex }} />
              </div>
            </div>
          ) : <span className="text-text-faint text-[11px] shrink-0 hidden sm:block">No data</span>}
        </Link>

        {hasData && (
          <Pill tone={withinTol ? 'ok' : 'warn'}>
            {!withinTol && <AlertTriangle size={10} />}
            {variance > 0 ? '+' : ''}{variance.toFixed(1)} kg
          </Pill>
        )}
        <Pill tone={st.tone}><st.icon size={10} /> {st.label}</Pill>

        {canRequestReopen && !archived && (s.status === 'submitted' || s.status === 'approved') && (
          <button onClick={() => setReopening(true)} title="Request that this record be reopened for edits"
            className="p-1.5 rounded-lg text-text-faint hover:text-warn hover:bg-surface-raised shrink-0 transition-colors">
            <Undo2 size={15} />
          </button>
        )}
        <button onClick={() => setNoting(true)}
          title={s.note_count ? `${s.note_count} note${s.note_count === 1 ? '' : 's'} — add another` : 'Add a note'}
          className="relative p-1.5 rounded-lg text-text-faint hover:text-brand hover:bg-surface-raised shrink-0 transition-colors">
          {s.note_count > 0 ? <MessageSquare size={15} className="text-brand" /> : <MessageSquarePlus size={15} />}
          {s.note_count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-brand text-white text-[9px] font-semibold leading-[14px] text-center">
              {s.note_count}
            </span>
          )}
        </button>
        {s.lot_number && (
          <Link href={`/traceability?batch=${encodeURIComponent(s.lot_number)}`} title="Full batch traceability"
            className="p-1.5 rounded-lg text-text-faint hover:text-brand hover:bg-surface-raised shrink-0 transition-colors">
            <BarChart3 size={15} />
          </Link>
        )}
        <Link href={`/production/orders/${s.id}`} title="View full production order"
          className="p-1.5 rounded-lg text-text-faint hover:text-brand hover:bg-surface-raised shrink-0 transition-colors">
          <FileText size={15} />
        </Link>

        {canManage ? (
          <div className="relative shrink-0">
            <button onClick={() => setMenuOpen(o => !o)} disabled={busy}
              className="p-1.5 rounded-lg text-text-faint hover:text-brand hover:bg-surface-raised disabled:opacity-40 transition-colors">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={15} />}
            </button>
            {menuOpen && (<>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-20 w-48 bg-surface-card border border-surface-rule rounded-xl shadow-menu py-1 text-[12.5px]">
                {archived ? (
                  canDelete && <button onClick={() => act('restore')} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised"><RotateCcw size={14} /> Restore</button>
                ) : (<>
                  {canEdit && <button onClick={() => { setEditing(e => !e); setMenuOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised"><Pencil size={14} /> Edit details</button>}
                  {canEdit && (s.status === 'submitted' || s.status === 'approved') &&
                    <button onClick={() => act('reopen')} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised"><Unlock size={14} /> Reopen for edits</button>}
                  {canDelete && <button onClick={() => { if (confirm('Archive this record? It will be hidden but kept for the audit trail and can be restored. Archived orders are excluded from KPI totals.')) act('delete') }} className="w-full flex items-center gap-2 px-3 py-2 text-left text-err hover:bg-err-bg"><Trash2 size={14} /> Archive</button>}
                </>)}
              </div>
            </>)}
          </div>
        ) : (
          <ChevronRight size={15} className="text-text-faint shrink-0" />
        )}
      </div>

      {/* A signed-off record with nothing in it — surfaced directly rather than
          buried in the "…" menu, since it silently counts as a production order. */}
      {!hasData && !archived && (s.status === 'submitted' || s.status === 'approved') && (
        <div className="flex items-center gap-2 px-5 pb-3 flex-wrap">
          <Pill tone="warn"><AlertTriangle size={10} /> Empty record — nothing captured</Pill>
          {canDelete && (
            <button onClick={() => { if (confirm('This record has no captured data. Archive it now? It will be hidden but kept for the audit trail and can be restored.')) act('delete') }}
              disabled={busy} className="text-[11px] font-medium text-err hover:underline disabled:opacity-40">
              Discard
            </button>
          )}
        </div>
      )}

      {hasData && (
        <div className="sm:hidden flex items-center gap-2 px-5 pb-3 text-[11px] text-text-muted flex-wrap">
          <Package size={11} /> {s.total_input_kg.toFixed(0)} kg
          <ArrowRight size={10} className="text-text-faint" />
          {s.total_output_kg.toFixed(0)} kg
          {yieldPct != null && <span className="font-mono">{yieldPct}%</span>}
        </div>
      )}

      {editing && (
        <div className="border-t border-surface-rule/60 px-5 py-4 bg-surface-raised space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              ['Operators (comma-separated)', 'operator_names'],
              ['Lot / batch', 'lot_number'],
              ['Production order(s) (comma-separated)', 'production_orders'],
            ] as const).map(([label, key]) => (
              <label key={key} className="space-y-1 block">
                <span className="text-[9.5px] font-semibold text-text-faint uppercase tracking-[0.06em]">{label}</span>
                <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={`${INP} w-full`} />
              </label>
            ))}
            <label className="space-y-1 block">
              <span className="text-[9.5px] font-semibold text-text-faint uppercase tracking-[0.06em]">Variant</span>
              <select value={form.variant} onChange={e => setForm(f => ({ ...f, variant: e.target.value }))} className={`${INP} w-full cursor-pointer`}>
                <option value="">—</option>{VARIANT_OPTS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={saveEdit} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-[12.5px] font-medium disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl border border-surface-rule text-[12.5px] text-text-muted hover:bg-surface-card">Cancel</button>
            <span className="text-[11px] text-text-faint ml-auto hidden sm:block">Weights &amp; batches → open the record in capture.</span>
          </div>
        </div>
      )}

      {reopening && (
        <RequestReopenModal session={s} requestedByName={displayName ?? null}
          onClose={() => setReopening(false)} onDone={() => { setReopening(false); onChanged() }} />
      )}
      {noting && (
        <AddNoteModal session={s}
          onClose={() => setNoting(false)} onDone={() => { setNoting(false); onChanged() }} />
      )}
    </div>
  )
}

// ── "Add note" ────────────────────────────────────────────────────────────────
// A lightweight, timestamped note log on the order — separate from the single
// "Handover & operator notes" field a shift's own operator writes during
// capture. Anyone can add one; author name and SAST timestamp are stamped
// server-side, never client-supplied, and notes accumulate rather than
// overwrite. Read together with the full log on the order detail page.
function AddNoteModal({ session: s, onClose, onDone }: {
  session: SessionRow; onClose: () => void; onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const m = sectionMeta(s.section_id)

  async function submit() {
    if (!note.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/production/orders/${s.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setSent(true)
      setTimeout(onDone, 900)
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-surface-card rounded-2xl shadow-menu w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-brand-bg flex items-center justify-center shrink-0"><MessageSquarePlus size={17} className="text-brand" /></div>
          <div className="min-w-0">
            <div className="font-display font-semibold text-[15px] text-text leading-tight">Add a note</div>
            <div className="text-[11.5px] text-text-muted mt-0.5">
              {m.name} · {format(parseISO(s.date + 'T12:00:00'), 'EEE d MMM')} · <span className="capitalize">{s.shift}</span>
            </div>
          </div>
        </div>
        {sent ? (
          <p className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 size={15} /> Note added.</p>
        ) : (<>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} autoFocus
            placeholder="Add a note for anyone else looking at this order…"
            className="w-full px-3.5 py-2.5 rounded-xl border border-surface-rule bg-surface-card text-[13px] text-text outline-none focus:border-brand resize-none placeholder:text-text-faint" />
          {error && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> {error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onClose} disabled={busy}
              className="py-2.5 rounded-xl border border-surface-rule text-text font-medium text-[12.5px] hover:bg-surface-raised disabled:opacity-40 transition-colors">
              Cancel
            </button>
            <button onClick={submit} disabled={busy || !note.trim()}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand text-white font-medium text-[12.5px] disabled:opacity-40 hover:bg-brand-mid transition-colors">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquarePlus size={14} />} Add note
            </button>
          </div>
        </>)}
      </div>
    </div>
  )
}

// ── "Request reopen" ─────────────────────────────────────────────────────────
// The action sits on the record it applies to. The DECISION stays with the
// Production Manager, on the Supervisor Hub's Sign-off tab.
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-surface-card rounded-2xl shadow-menu w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-warn-bg flex items-center justify-center shrink-0"><Undo2 size={17} className="text-warn" /></div>
          <div className="min-w-0">
            <div className="font-display font-semibold text-[15px] text-text leading-tight">Request to reopen</div>
            <div className="text-[11.5px] text-text-muted mt-0.5">
              {m.name} · {format(parseISO(s.date + 'T12:00:00'), 'EEE d MMM')} · <span className="capitalize">{s.shift}</span>
            </div>
          </div>
        </div>
        {sent ? (
          <p className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 size={15} /> Sent — a Production Manager will decide it.</p>
        ) : (<>
          <p className="text-[12px] text-text-muted">A Production Manager or IT reviews this and reopens the record for edits if approved.</p>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
            placeholder="What needs to be fixed?"
            className="w-full px-3.5 py-2.5 rounded-xl border border-surface-rule bg-surface-card text-[13px] text-text outline-none focus:border-brand resize-none placeholder:text-text-faint" />
          {error && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> {error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onClose} disabled={busy}
              className="py-2.5 rounded-xl border border-surface-rule text-text font-medium text-[12.5px] hover:bg-surface-raised disabled:opacity-40 transition-colors">
              Cancel
            </button>
            <button onClick={submit} disabled={busy || !reason.trim()}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand text-white font-medium text-[12.5px] disabled:opacity-40 hover:bg-brand-mid transition-colors">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Send request
            </button>
          </div>
        </>)}
      </div>
    </div>
  )
}

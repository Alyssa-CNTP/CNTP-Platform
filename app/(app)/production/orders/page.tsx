'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { format, parseISO, subDays } from 'date-fns'
import {
  Loader2, CheckCircle2, Clock, Pen, Play, Lock, ChevronRight,
  Filter, X, AlertTriangle, Package, PackageCheck, Scale, Users,
  CalendarRange, ArrowRight,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta, SECTION_ORDER, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'

interface SessionRow {
  id: string
  section_id: string
  date: string
  shift: string
  status: string
  operator_names: string[] | null
  lot_number: string | null
  variant: string | null
  created_at: string
  submitted_at: string | null
  total_input_kg: number
  total_output_b_kg: number
  balance_kg: number | null
  debag_count: number
  bag_count: number
}

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  draft:     { label: 'In progress',       cls: 'bg-warn/10 text-warn',  icon: Pen },
  submitted: { label: 'Awaiting sign-off', cls: 'bg-info/10 text-info',  icon: Clock },
  approved:  { label: 'Signed off',        cls: 'bg-ok/10 text-ok',      icon: CheckCircle2 },
  new:       { label: 'Not started',       cls: 'bg-stone-100 text-stone-500', icon: Play },
}

const SHIFTS = ['morning', 'afternoon', 'night']

export default function ProductionOrdersPage() {
  const [sessions,  setSessions]  = useState<SessionRow[]>([])
  const [loading,   setLoading]   = useState(true)

  // Filters
  const [dateFrom,      setDateFrom]      = useState(() => format(subDays(new Date(), 14), 'yyyy-MM-dd'))
  const [dateTo,        setDateTo]        = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [filterSection, setFilterSection] = useState('')
  const [filterStatus,  setFilterStatus]  = useState('')
  const [filterShift,   setFilterShift]   = useState('')
  const [showFilters,   setShowFilters]   = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const db = getDb()

      // Load sessions in the date window
      const { data: sess } = await db.schema('production').from('prod_sessions')
        .select('id,section_id,date,shift,status,operator_names,lot_number,variant,created_at,submitted_at')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: false }).order('created_at', { ascending: false })
        .limit(200)

      if (!sess?.length) { setSessions([]); setLoading(false); return }

      const ids = (sess as any[]).map(s => s.id)

      // Mass balance
      const { data: mb } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_b_kg,balance_kg').in('session_id', ids)
      const mbMap = new Map<string, any>()
      ;(mb ?? []).forEach((r: any) => mbMap.set(r.session_id, r))

      // Bag / debag counts
      const { data: bags }  = await db.schema('production').from('prod_bagging')
        .select('session_id').in('session_id', ids)
      const { data: debags } = await db.schema('production').from('prod_debagging')
        .select('session_id').in('session_id', ids)
      const bagCount   = new Map<string, number>()
      const debagCount = new Map<string, number>()
      ;(bags  ?? []).forEach((r: any) => bagCount.set(r.session_id,   (bagCount.get(r.session_id)   ?? 0) + 1))
      ;(debags ?? []).forEach((r: any) => debagCount.set(r.session_id, (debagCount.get(r.session_id) ?? 0) + 1))

      const rows: SessionRow[] = (sess as any[]).map(s => {
        const m = mbMap.get(s.id)
        return {
          ...s,
          total_input_kg:   m ? parseFloat(m.total_input_kg)   : 0,
          total_output_b_kg: m ? parseFloat(m.total_output_b_kg) : 0,
          balance_kg:        m ? parseFloat(m.balance_kg)       : null,
          debag_count: debagCount.get(s.id) ?? 0,
          bag_count:   bagCount.get(s.id)   ?? 0,
        }
      })

      setSessions(rows)
      setLoading(false)
    }
    load()
  }, [dateFrom, dateTo])

  const filtered = useMemo(() => sessions.filter(s => {
    if (filterSection && s.section_id !== filterSection) return false
    if (filterStatus  && s.status !== filterStatus)      return false
    if (filterShift   && s.shift !== filterShift)        return false
    return true
  }), [sessions, filterSection, filterStatus, filterShift])

  const activeFilters = [filterSection, filterStatus, filterShift].filter(Boolean).length
  function clearFilters() { setFilterSection(''); setFilterStatus(''); setFilterShift('') }

  // Totals across filtered results
  const totals = useMemo(() => filtered.reduce((acc, s) => ({
    in:  acc.in  + s.total_input_kg,
    out: acc.out + s.total_output_b_kg,
    bags: acc.bags + s.bag_count,
  }), { in: 0, out: 0, bags: 0 }), [filtered])

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-stone-100 flex-shrink-0">
        <div>
          <h1 className="font-semibold text-[22px] text-text leading-tight">Production Orders</h1>
          <p className="text-[12px] text-text-muted mt-0.5">All captured batch records across every section</p>
        </div>
        <button onClick={() => setShowFilters(f => !f)}
          className={`relative flex items-center gap-2 px-4 py-2 rounded-xl border text-[13px] font-medium transition-colors
            ${showFilters || activeFilters > 0 ? 'border-brand bg-brand/5 text-brand' : 'border-stone-200 text-stone-600 hover:border-brand hover:text-brand'}`}>
          <Filter size={14} /> Filters
          {activeFilters > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">{activeFilters}</span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="px-6 py-4 bg-stone-50 border-b border-stone-100 flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Section</label>
            <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand cursor-pointer">
              <option value="">All sections</option>
              {SECTION_ORDER.map(s => <option key={s} value={s}>{sectionMeta(s).name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand cursor-pointer">
              <option value="">All statuses</option>
              <option value="draft">In progress</option>
              <option value="submitted">Awaiting sign-off</option>
              <option value="approved">Signed off</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Shift</label>
            <select value={filterShift} onChange={e => setFilterShift(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand cursor-pointer">
              <option value="">All shifts</option>
              {SHIFTS.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </div>
          {activeFilters > 0 && (
            <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-stone-500 hover:text-err rounded-xl border border-stone-200 bg-white">
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
      )}

      {/* Summary stats */}
      {!loading && filtered.length > 0 && (
        <div className="px-6 py-3 border-b border-stone-100 flex items-center gap-6 flex-shrink-0 bg-white">
          <div className="text-center">
            <div className="font-mono font-bold text-[18px] text-text">{filtered.length}</div>
            <div className="text-[10px] text-text-muted">orders</div>
          </div>
          <div className="w-px h-8 bg-stone-200" />
          <div className="text-center">
            <div className="font-mono font-bold text-[18px] text-text">{totals.in.toFixed(0)} kg</div>
            <div className="text-[10px] text-text-muted">total in</div>
          </div>
          <ArrowRight size={14} className="text-stone-300" />
          <div className="text-center">
            <div className="font-mono font-bold text-[18px] text-text">{totals.out.toFixed(0)} kg</div>
            <div className="text-[10px] text-text-muted">total out</div>
          </div>
          <div className="w-px h-8 bg-stone-200" />
          <div className="text-center">
            <div className="font-mono font-bold text-[18px] text-text">{totals.bags}</div>
            <div className="text-[10px] text-text-muted">bags out</div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Package size={24} className="text-stone-300" />
            <p className="text-[13px] text-stone-400">No production orders found for this date range.</p>
            {activeFilters > 0 && <button onClick={clearFilters} className="text-[12px] text-brand hover:underline">Clear filters</button>}
          </div>
        ) : (
          <div className="px-6 py-4 space-y-2 max-w-[1100px]">
            {/* Group by date */}
            {groupByDate(filtered).map(({ date: d, rows }) => (
              <div key={d}>
                <div className="flex items-center gap-2 py-2">
                  <span className="text-[11px] font-bold text-stone-400 uppercase tracking-widest">
                    {format(parseISO(d + 'T12:00:00'), 'EEE d MMM yyyy')}
                  </span>
                  <div className="flex-1 h-px bg-stone-100" />
                </div>
                <div className="space-y-1.5">
                  {rows.map(s => <OrderCard key={s.id} session={s} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function groupByDate(rows: SessionRow[]): { date: string; rows: SessionRow[] }[] {
  const map = new Map<string, SessionRow[]>()
  rows.forEach(r => {
    const g = map.get(r.date)
    if (g) g.push(r)
    else   map.set(r.date, [r])
  })
  return Array.from(map.entries()).map(([date, rows]) => ({ date, rows }))
}

function OrderCard({ session: s }: { session: SessionRow }) {
  const meta     = sectionMeta(s.section_id)
  const st       = STATUS[s.status] ?? STATUS.new
  const StatusIcon = st.icon
  const variance = s.total_input_kg - s.total_output_b_kg
  const withinTol = Math.abs(variance) <= MASS_BALANCE_TOLERANCE_KG
  const hasData  = s.bag_count > 0 || s.debag_count > 0

  return (
    <Link
      href={`/production/capture/${s.section_id}?date=${s.date}&shift=${s.shift}`}
      className="flex items-center gap-4 bg-white border border-stone-200 rounded-2xl px-5 py-4 hover:border-brand/40 hover:shadow-sm transition-all group"
    >
      {/* Section colour dot */}
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm" style={{ background: meta.colorHex }}>
        <span className="font-mono font-bold text-[11px] text-white">{meta.code}</span>
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 items-center">
        <div className="col-span-2 sm:col-span-1">
          <div className="font-semibold text-[14px] text-text">{meta.name}</div>
          <div className="text-[11px] text-text-muted capitalize">{s.shift} shift · {s.variant ?? '—'}</div>
        </div>
        <div>
          {s.operator_names?.length ? (
            <div className="inline-flex items-center gap-1 text-[11px] text-stone-500"><Users size={11} /> {s.operator_names.join(', ')}</div>
          ) : (
            <span className="text-[11px] text-stone-300">No operators</span>
          )}
          {s.lot_number && <div className="font-mono text-[10px] text-stone-400 mt-0.5">{s.lot_number}</div>}
        </div>
        {/* kg in → out */}
        <div className="flex items-center gap-1.5 text-[12px]">
          {hasData ? (
            <>
              <span className="inline-flex items-center gap-1 text-stone-600"><Package size={12} /> {s.total_input_kg.toFixed(1)} kg</span>
              <ArrowRight size={11} className="text-stone-300" />
              <span className="inline-flex items-center gap-1 text-stone-600"><PackageCheck size={12} /> {s.total_output_b_kg.toFixed(1)} kg</span>
            </>
          ) : (
            <span className="text-stone-300 text-[11px]">No data</span>
          )}
        </div>
        {/* Balance */}
        <div>
          {hasData ? (
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full
              ${withinTol ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
              <Scale size={11} />
              {variance > 0 ? '+' : ''}{variance.toFixed(1)} kg
              {!withinTol && <AlertTriangle size={11} />}
            </span>
          ) : null}
        </div>
      </div>

      {/* Status + arrow */}
      <div className="flex items-center gap-3 shrink-0">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${st.cls}`}>
          <StatusIcon size={11} /> {st.label}
        </span>
        <ChevronRight size={16} className="text-stone-300 group-hover:text-brand transition-colors" />
      </div>
    </Link>
  )
}

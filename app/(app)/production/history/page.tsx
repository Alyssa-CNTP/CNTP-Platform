'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { format, subDays, parseISO } from 'date-fns'
import {
  Search, X, Scale, AlertTriangle, CheckCircle2,
  Users, Package, ExternalLink, ChevronDown, ChevronUp,
  Calendar, Loader2, Trash2,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { AcumaticaSummary } from '@/components/production/AcumaticaSummary'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MassBalanceRow {
  total_input_kg: number | null
  total_output_b_kg: number | null
  balance_kg: number | null
  within_tolerance: boolean | null
}

interface SessionRow {
  id: string
  section_id: string
  section_name: string
  date: string
  shift: string
  status: string
  operator_name_text: string | null
  operator_names: string[] | null
  supervisor_name: string | null
  comments: string | null
  lot_number: string | null
  production_orders: string[] | null
  notes: string | null
  created_at: string
  updated_at: string
  // flattened from left join
  mb_total_input_kg: number | null
  mb_balance_kg: number | null
  mb_within_tolerance: boolean | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: '', label: 'All sections' },
  { id: 'sieving',     label: 'Sieving Tower' },
  { id: 'refining1',   label: 'Refining 1' },
  { id: 'refining2',   label: 'Refining 2' },
  { id: 'granule',     label: 'Granule Line' },
  { id: 'blender',     label: 'Blender' },
  { id: 'pasteuriser', label: 'Pasteuriser' },
]

const STATUSES = [
  { id: '',          label: 'All statuses' },
  { id: 'draft',     label: 'In progress' },
  { id: 'submitted', label: 'Needs sign-off' },
  { id: 'approved',  label: 'Signed off' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  if (status === 'approved')  return { label: 'Signed off',     cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
  if (status === 'submitted') return { label: 'Needs sign-off', cls: 'bg-blue-100 text-blue-700 border-blue-200' }
  if (status === 'draft')     return { label: 'In progress',    cls: 'bg-amber-100 text-amber-700 border-amber-200' }
  return { label: status, cls: 'bg-stone-100 text-stone-500 border-stone-200' }
}

function operatorLabel(row: SessionRow): string {
  if (row.operator_names && row.operator_names.length > 0) return row.operator_names.join(', ')
  return row.operator_name_text || '—'
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session, canDelete, onDelete }: { session: SessionRow; canDelete: boolean; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { label: statusLabel, cls: statusCls } = statusBadge(session.status)

  async function handleDelete() {
    if (!confirm(`Delete the ${session.section_name} session from ${session.date} (${session.shift} shift)? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const db = getDb().schema('production')
      await db.from('session_signatures').delete().eq('session_id', session.id)
      await db.from('scan_events').delete().eq('session_id', session.id)
      await db.from('prod_mass_balance').delete().eq('session_id', session.id)
      await db.from('prod_debagging').delete().eq('session_id', session.id)
      await db.from('prod_bagging').delete().eq('session_id', session.id)
      await db.from('prod_sessions').delete().eq('id', session.id)
      onDelete(session.id)
    } catch (e: any) {
      alert('Delete failed: ' + e.message)
      setDeleting(false)
    }
  }
  const href = `/production/section?id=${session.section_id}&shift=${session.shift}&date=${session.date}`

  const orders: string[] = session.production_orders ?? []
  // Show the code before ' — ' separator
  const orderPills = orders.map(o => o.split(' — ')[0].trim()).filter(Boolean)

  let notesData: any = null
  if (session.notes) {
    try { notesData = JSON.parse(session.notes) } catch {}
  }

  const dateLabel = (() => {
    try { return format(parseISO(session.date + 'T12:00:00'), 'd MMM yyyy') }
    catch { return session.date }
  })()

  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex flex-wrap items-start gap-3 px-5 py-4 border-b border-stone-100">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-semibold text-[14px] text-stone-800">{session.section_name}</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${statusCls}`}>
              {statusLabel}
            </span>
            <span className="font-mono text-[11px] text-stone-400 capitalize">{session.shift}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-stone-500">
            <Calendar size={12}/>
            <span>{dateLabel}</span>
          </div>
        </div>

        {/* Mass balance chip */}
        {session.mb_total_input_kg != null && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-mono ${
            session.mb_within_tolerance === false
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}>
            <Scale size={11}/>
            <span>{(session.mb_total_input_kg ?? 0).toFixed(1)} kg in</span>
            {session.mb_balance_kg != null && (
              <>
                <span className="text-stone-300">·</span>
                {session.mb_within_tolerance === false
                  ? <AlertTriangle size={11} className="text-amber-600"/>
                  : <CheckCircle2 size={11} className="text-emerald-600"/>
                }
                <span>{(session.mb_balance_kg ?? 0).toFixed(1)} kg var</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="px-5 py-3 space-y-2">
        {/* Operators & supervisor */}
        <div className="flex flex-wrap gap-4 text-[12px]">
          <div className="flex items-center gap-1.5 text-stone-600">
            <Users size={12} className="text-stone-400 shrink-0"/>
            <span>{operatorLabel(session)}</span>
          </div>
          {session.supervisor_name && (
            <div className="flex items-center gap-1.5 text-stone-500">
              <span className="text-stone-300">·</span>
              <span>Supervisor: {session.supervisor_name}</span>
            </div>
          )}
        </div>

        {/* Production orders */}
        {orderPills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Package size={12} className="text-stone-400 shrink-0"/>
            {orderPills.map(code => (
              <span key={code} className="font-mono text-[11px] px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded text-stone-600">
                {code}
              </span>
            ))}
          </div>
        )}

        {/* Lot number */}
        {session.lot_number && (
          <div className="text-[12px] text-stone-500">
            Lot: <span className="font-mono text-stone-700">{session.lot_number}</span>
          </div>
        )}

        {/* Comments snippet */}
        {session.comments && (
          <p className="text-[12px] text-stone-400 italic truncate max-w-prose">
            &ldquo;{session.comments.slice(0, 100)}{session.comments.length > 100 ? '…' : ''}&rdquo;
          </p>
        )}
      </div>

      {/* Card footer */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-stone-100 bg-stone-50">
        <Link
          href={href}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 text-white text-[12px] font-medium hover:bg-stone-700 transition-colors"
        >
          <ExternalLink size={12}/>
          Open session
        </Link>
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] font-medium text-stone-600 hover:bg-stone-100 transition-colors"
        >
          {expanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
          Acumatica summary
        </button>
        {canDelete && (
          <button
            onClick={handleDelete} disabled={deleting}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-[12px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {deleting ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>}
            Delete
          </button>
        )}
      </div>

      {/* Expanded Acumatica summary */}
      {expanded && (
        <div className="px-5 py-4 border-t border-stone-100">
          {notesData && Object.keys(notesData).length > 0 ? (
            <AcumaticaSummary
              sectionId={session.section_id}
              sessionData={notesData}
              date={session.date}
              shift={session.shift}
            />
          ) : (
            <p className="text-[12px] text-stone-400 text-center py-4">
              No form data saved yet — open the session to capture data.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductionHistoryPage() {
  const { role, sectionId: authSectionId, isSupervisor, isIT } = useAuth()
  const canDelete = isSupervisor || isIT || role === 'admin'

  const today     = format(new Date(), 'yyyy-MM-dd')
  const thirtyAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')

  const [query,      setQuery]      = useState('')
  const [dateFrom,   setDateFrom]   = useState(thirtyAgo)
  const [dateTo,     setDateTo]     = useState(today)
  const [sectionFilter, setSectionFilter] = useState('')
  const [statusFilter,  setStatusFilter]  = useState('')
  const [sessions,   setSessions]   = useState<SessionRow[]>([])
  const [loading,    setLoading]    = useState(true)

  // Section operators only see their own section
  const isSectionOp = role === 'section_operator'

  async function load() {
    setLoading(true)
    try {
      let q = getDb()
        .schema('production')
        .from('prod_sessions')
        .select(`
          id, section_id, section_name, date, shift, status,
          operator_name_text, operator_names, supervisor_name,
          comments, lot_number, production_orders, notes,
          created_at, updated_at,
          prod_mass_balance!left(total_input_kg, total_output_b_kg, balance_kg, within_tolerance)
        `)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .order('section_id')

      if (isSectionOp && authSectionId) {
        q = q.eq('section_id', authSectionId)
      } else if (sectionFilter) {
        q = q.eq('section_id', sectionFilter)
      }

      if (statusFilter) {
        q = q.eq('status', statusFilter)
      }

      const { data, error } = await q
      if (error) throw error

      const rows: SessionRow[] = ((data as any[]) ?? []).map((row: any) => {
        const mb = (row.prod_mass_balance as any)?.[0] ?? {}
        return {
          ...row,
          mb_total_input_kg:  mb.total_input_kg   ?? null,
          mb_balance_kg:      mb.balance_kg        ?? null,
          mb_within_tolerance: mb.within_tolerance ?? null,
        }
      })

      setSessions(rows)
    } catch (e: any) {
      console.error('history load:', e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [dateFrom, dateTo, sectionFilter, statusFilter, isSectionOp, authSectionId])

  // Client-side text filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(s => {
      return (
        s.operator_name_text?.toLowerCase().includes(q) ||
        (s.operator_names ?? []).some((n: string) => n.toLowerCase().includes(q)) ||
        s.supervisor_name?.toLowerCase().includes(q) ||
        s.lot_number?.toLowerCase().includes(q) ||
        s.section_name?.toLowerCase().includes(q) ||
        (s.production_orders ?? []).some((o: string) => o.toLowerCase().includes(q)) ||
        s.comments?.toLowerCase().includes(q)
      )
    })
  }, [sessions, query])

  return (
    <div className="px-4 py-5 space-y-5 max-w-[900px]">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">Session history</h1>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">Search all production sessions</p>
        </div>
        <Link
          href="/production"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-rule font-mono text-[11px] text-text-muted hover:text-text transition-colors"
        >
          ← Back to production
        </Link>
      </div>

      {/* Filters bar — sticky */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border border-stone-200 rounded-2xl shadow-sm p-4 space-y-3">
        {/* Search input */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"/>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search operator, section, production order, lot number…"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-stone-200 bg-white font-mono text-[12px] text-stone-800 placeholder:text-stone-400 outline-none focus:border-stone-400 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              <X size={13}/>
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap gap-2">
          {/* Date from */}
          <div className="flex items-center gap-1.5">
            <Calendar size={12} className="text-stone-400"/>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-stone-200 font-mono text-[11px] text-stone-700 outline-none focus:border-stone-400"
            />
            <span className="text-[11px] text-stone-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-stone-200 font-mono text-[11px] text-stone-700 outline-none focus:border-stone-400"
            />
          </div>

          {/* Section dropdown */}
          {!isSectionOp && (
            <select
              value={sectionFilter}
              onChange={e => setSectionFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white font-mono text-[11px] text-stone-700 outline-none focus:border-stone-400"
            >
              {SECTIONS.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}

          {/* Status dropdown */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white font-mono text-[11px] text-stone-700 outline-none focus:border-stone-400"
          >
            {STATUSES.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center gap-2">
        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-stone-400 font-mono">
            <Loader2 size={13} className="animate-spin"/>
            Loading…
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-100 border border-stone-200 font-mono text-[11px] text-stone-600">
            {filtered.length} session{filtered.length !== 1 ? 's' : ''} found
          </span>
        )}
      </div>

      {/* Session cards */}
      {!loading && (
        <div className="space-y-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-stone-400">
              <Search size={32} className="mb-3 opacity-30"/>
              <p className="text-[13px] font-medium">No sessions match your filters</p>
              <p className="text-[12px] mt-1">Try adjusting the date range or search query</p>
            </div>
          ) : (
            filtered.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                canDelete={canDelete}
                onDelete={id => setSessions(prev => prev.filter(s => s.id !== id))}
              />
            ))
          )}
        </div>
      )}

    </div>
  )
}

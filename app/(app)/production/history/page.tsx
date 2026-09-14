'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { format, subDays, parseISO } from 'date-fns'
import {
  Search, X, Scale, Lock, AlertTriangle,
  Users, Package, ExternalLink, ChevronDown, ChevronUp,
  Calendar, Loader2,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta } from '@/lib/production/capture-config'
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
  /** Derived from `section_id` — prod_sessions has no section_name column. */
  section_name: string
  date: string
  shift: string
  status: string
  /** prod_sessions has no operator_name_text column; kept null for the
   *  fallback path and never selected. */
  operator_name_text: string | null
  operator_names: string[] | null
  supervisor_name: string | null
  comments: string | null
  lot_number: string | null
  production_orders: string[] | null
  notes: string | null
  created_at: string
  /** Nullable in the database; selected but not rendered. */
  updated_at: string | null
  // flattened from left join
  /**
   * What the MACHINE did, summed from the rows themselves — prod_debagging in,
   * prod_bagging out. Never from the prod_mass_balance snapshot: the order page
   * already stopped trusting it, because a stored total that disagrees with the
   * rows under it is how that page came to read 91 036 kg in against 4 704 out.
   */
  in_kg: number
  out_kg: number
  bags_in: number
  bags_out: number
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

/** One row of production.v_session_activity — already aggregated. */
interface ActivityRow {
  session_id: string
  bags_in: number | null
  kg_in: number | string | null
  bags_out: number | null
  kg_out: number | string | null
}

/** Exactly the columns selected from prod_sessions — see the note on the query. */
interface SessionSelect {
  id: string
  section_id: string
  date: string
  shift: string
  status: string
  operator_names: string[] | null
  supervisor_name: string | null
  comments: string | null
  lot_number: string | null
  production_orders: string[] | null
  created_at: string
  updated_at: string | null
}

function operatorLabel(row: SessionRow): string {
  if (row.operator_names && row.operator_names.length > 0) return row.operator_names.join(', ')
  return row.operator_name_text || '—'
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: SessionRow }) {
  const [expanded, setExpanded] = useState(false)
  const { label: statusLabel, cls: statusCls } = statusBadge(session.status)

  /*
   * There is no delete here any more, and its absence is deliberate.
   *
   * It ran six client-side deletes in a row — session_signatures, scan_events,
   * prod_mass_balance, prod_debagging, prod_bagging, then the session — behind
   * a confirm(). ARCHITECTURE.md §4 names one of those outright: "Never
   * blanket-delete scan_events. It is an append-only audit ledger. To undo an
   * event, append a reversing event." There was no audit row and no
   * transaction, so a partial failure orphaned bagging rows against a session
   * that no longer existed, and prod_sessions already carries deleted_at /
   * deleted_by that nothing there used.
   *
   * It survived this long because the page was unreachable — no nav entry, no
   * route guard. This change gives it both, so the control goes before the
   * door opens rather than after. Deleting a session is done from Production
   * Orders, which has the reopen-request flow behind it.
   */
  // /production/section is a REDIRECT to the capture hub whose whole body is
  // redirect('/production/capture') — retired in June 2026, and the redirect
  // drops the query string with it. So every card on this page landed the
  // reader on an empty capture hub, which is the one thing this page is for.
  //
  // The real route takes all three parameters, and `session` matters most:
  // without it the capture page loads the most recently created session for
  // that (section, date, shift), which is the WRONG record whenever a shift ran
  // more than one — normal on the Blender, and normal after any changeover.
  /**
   * The record opens its own PRODUCTION ORDER SUMMARY — not the capture screen.
   *
   * Capture is where you type. This page is where you look, and sending a
   * reader from a read-only history into a live capture form is an invitation
   * to change something they only came to check. The order summary is already
   * the neat version of the same record.
   *
   * `view=record` asks that page for its read-only mode: no 20-second poll, no
   * realtime subscription, no controls that write.
   */
  const href = `/production/orders/${session.id}?view=record`

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
        {/* What ran at the machine: bags in and bags out, summed from
            prod_debagging and prod_bagging. No balance or tolerance verdict —
            this page is the RECORD of what happened, and whether it balanced
            is the Production Order's question, one screen away. */}
        {(session.bags_in > 0 || session.bags_out > 0) && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-[11px] font-mono text-stone-600">
            <Scale size={11}/>
            <span>{session.bags_in} bag{session.bags_in === 1 ? '' : 's'} in · {session.in_kg.toFixed(1)} kg</span>
            <span className="text-stone-300">·</span>
            <span>{session.bags_out} bag{session.bags_out === 1 ? '' : 's'} out · {session.out_kg.toFixed(1)} kg</span>
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
          Open record
        </Link>
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] font-medium text-stone-600 hover:bg-stone-100 transition-colors"
        >
          {expanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
          Acumatica summary
        </button>
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
  const { user, role, sectionId: authSectionId, isSupervisor, isIT } = useAuth()

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
  /**
   * An operator sees the lines they were ROSTERED on, and no others.
   *
   * `isSectionOp` only ever caught `section_operator`; a `floor_operator` — the
   * role this page was opened up for — fell through it and saw every line in
   * the factory. The roster is what says which machine is theirs, so the roster
   * is what scopes the page.
   *
   * Scoped to the DATE RANGE being viewed rather than to today: looking back at
   * last week should show the lines they worked last week, not the one they
   * happen to be on this morning.
   *
   * null = no restriction (supervisors, management, IT).
   * []   = rostered on nothing in this range, which is a real answer and shows
   *        an empty list rather than silently widening to everything.
   */
  const [activityUnavailable, setActivityUnavailable] = useState(false)
  const [mySections, setMySections] = useState<string[] | null>(null)
  /** Who gets scoped. Supervisors, IT and admin see the whole factory. */
  const restrictToRoster = !(isSupervisor || isIT || role === 'admin')

  async function load() {
    setLoading(true)
    try {
      /**
       * This page showed "0 sessions found" for every filter, on production,
       * silently. The select asked for FOUR columns that do not exist —
       * `prod_sessions.section_name`, `.operator_name_text`, `.notes` and
       * `prod_mass_balance.within_tolerance` — so PostgREST answered 400, the
       * catch below logged to the console, and `setSessions` was never called.
       * The reader saw an empty list and no error. Same systemic drift as the
       * bag_tags scan bug: a screen selecting columns the table never had.
       *
       * Every column below was probed against the production database one at a
       * time before this was written, not assumed.
       */
      let q = getDb()
        .schema('production')
        .from('prod_sessions')
        .select(`
          id, section_id, date, shift, status,
          operator_names, supervisor_name,
          comments, lot_number, production_orders,
          created_at, updated_at
        `)
        .is('deleted_at', null)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .order('section_id')

      if (restrictToRoster) {
        // Not yet resolved — ask for nothing rather than everything. One render
        // showing the whole factory is one render too many.
        if (mySections === null) { setSessions([]); setLoading(false); return }
        if (mySections.length === 0) { setSessions([]); setLoading(false); return }
        q = sectionFilter && mySections.includes(sectionFilter)
          ? q.eq('section_id', sectionFilter)
          : q.in('section_id', mySections)
      } else if (isSectionOp && authSectionId) {
        q = q.eq('section_id', authSectionId)
      } else if (sectionFilter) {
        q = q.eq('section_id', sectionFilter)
      }

      if (statusFilter) {
        q = q.eq('status', statusFilter)
      }

      const { data, error } = await q
      if (error) throw error
      const sessionRows = (data ?? []) as SessionSelect[]
      const ids = sessionRows.map(r => r.id)

      /**
       * What happened at the machine, read from the two tables that record it.
       *
       * TWO queries for the whole page, scoped by the session ids already in
       * hand — not one per card, and no polling or realtime subscription
       * anywhere on this screen. It reads when the filters change and then it
       * stops, which is what keeps a read-only history off the database's back.
       */
      /**
       * The tallies come from production.v_session_activity — ONE row per
       * record, aggregated in the database.
       *
       * This used to pull prod_bagging and prod_debagging into the browser and
       * add them up here. Over a 30-day range that is ~2 000 rows of each, and
       * PostgREST caps a response at 1 000 — so the page got the OLDEST
       * thousand and every recent record read "0 bags in". Silently, because a
       * truncated response is a successful one.
       *
       * It was the wrong shape anyway: a read-only history has no business
       * shipping four thousand rows to a tablet to produce forty numbers.
       */
      const { data: actData, error: actErr } = ids.length
        ? await getDb().schema('production').from('v_session_activity')
            .select('session_id, bags_in, kg_in, bags_out, kg_out')
            .in('session_id', ids)
        : { data: [] as ActivityRow[], error: null }
      // The view is a migration away on a database that has not had it run yet.
      // Say so rather than showing zeroes that look like a quiet shift.
      if (actErr) setActivityUnavailable(true)
      else setActivityUnavailable(false)

      const act = new Map<string, ActivityRow>()
      for (const a of ((actData ?? []) as ActivityRow[])) act.set(a.session_id, a)

      const rows: SessionRow[] = (sessionRows as SessionSelect[]).map(row => ({
        ...row,
        // prod_sessions carries none of these; the page asked for them anyway.
        section_name: sectionMeta(row.section_id).name,
        operator_name_text: null,
        notes: null,
        in_kg:    Number(act.get(row.id)?.kg_in)    || 0,
        out_kg:   Number(act.get(row.id)?.kg_out)   || 0,
        bags_in:  Number(act.get(row.id)?.bags_in)  || 0,
        bags_out: Number(act.get(row.id)?.bags_out) || 0,
      }))

      setSessions(rows)
    } catch (e: any) {
      console.error('history load:', e.message)
    }
    setLoading(false)
  }

  /**
   * Which lines is this person rostered on, over the range being viewed?
   *
   * Two small reads, only for people who need restricting — a supervisor never
   * runs them. Resolved through production.operators, which is where a login is
   * tied to a person, and then through the roster. Never through
   * prod_sessions.operator_names: that is an array of display names with no
   * ids, so a rename silently drops someone off their own line.
   */
  useEffect(() => {
    let alive = true
    if (!restrictToRoster || !user?.id) { setMySections(null); return }
    void (async () => {
      const db = getDb().schema('production')
      const { data: me } = await db.from('operators')
        .select('id').eq('user_id', user.id).maybeSingle()
      const opId = (me as { id: string } | null)?.id
      if (!opId) {
        // A login with no operator record is not rostered on anything. Showing
        // them every line because we could not identify them is the wrong way
        // to fail.
        if (alive) setMySections([])
        return
      }
      const { data: rows } = await db.from('shift_assignments')
        .select('section_id')
        .gte('date', dateFrom).lte('date', dateTo)
        .contains('operator_ids', [opId])
      const secs = Array.from(new Set(((rows ?? []) as { section_id: string }[]).map(r => r.section_id)))
      if (alive) setMySections(secs)
    })()
    return () => { alive = false }
  }, [restrictToRoster, user?.id, dateFrom, dateTo])

  useEffect(() => { load() }, [dateFrom, dateTo, sectionFilter, statusFilter, isSectionOp, authSectionId, mySections, restrictToRoster])

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
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display font-bold text-[22px] text-text">Session history</h1>
            {/* Said plainly, on the page, because "why can I not change this"
                is the question a record screen has to answer before it is
                asked. */}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 border border-stone-200 text-[10px] font-medium text-stone-600 uppercase tracking-wide">
              <Lock size={10} /> Read-only
            </span>
          </div>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {restrictToRoster
              ? 'The record of what ran on your line'
              : 'Search all production sessions'}
          </p>
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
          {!isSectionOp && !(restrictToRoster && (mySections?.length ?? 0) <= 1) && (
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
        {activityUnavailable && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Bag counts are unavailable — <span className="font-mono">production.v_session_activity</span> has not
            been created on this database yet. The records below are complete; only the in/out figures are missing.
          </span>
        </div>
      )}

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
              />
            ))
          )}
        </div>
      )}

    </div>
  )
}

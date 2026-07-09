'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import {
  CalendarRange, Loader2, Plus, X, Check, Trash2, Pencil,
  ChevronDown, AlertTriangle, Sun, Moon, Search, Users,
  RefreshCw, Send, CheckCircle2, ArrowRight, Lock, Download, Printer,
  Info, Eye, Edit3, ShieldCheck,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { WorkforceTabs } from '@/components/production/WorkforceTabs'
import {
  ROSTER_SHIFTS, ROSTER_CATEGORIES, ROSTER_ROLE_SEED, SKILL_TAGS,
  tagLabel, categoryMeta,
  type RosterRole, type RosterShift,
} from '@/lib/production/roster-config'
import { rosterPerm, ROSTER_SECTION_LABEL, type RosterSectionKey } from '@/lib/auth/permissions'
import { exportRosterPeriod } from '@/lib/utils/exportExcel'

interface Period {
  id: string; name: string; start_date: string; end_date: string
  day_label: string; night_label: string; notes: string | null
  status: string; published_at: string | null
}
interface Entry {
  id: string; period_id: string; role_key: string; shift: RosterShift
  employee_id: string | null; operator_id: string | null; person_name: string; tags: string[]; sort_order: number
}
interface Employee {
  id: string; name: string; display_name: string | null
  department: string; job_title: string | null; skills: string[]; operator_id: string | null
}
interface SectionStatus { section: string; status: string; submitted_by: string | null; submitted_at: string | null }

const db = () => getDb().schema('production')
const fmtRange = (p: Period) =>
  `${format(parseISO(p.start_date + 'T12:00:00'), 'd MMM')} – ${format(parseISO(p.end_date + 'T12:00:00'), 'd MMM yyyy')}`

// Today + current shift in SAST (Africa/Johannesburg), independent of browser TZ.
function sastNow() {
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(now))
  const shift: RosterShift = hour >= 7 && hour < 16 ? 'day' : 'night'
  return { date, shift }
}

// Days until next Wednesday (change deadline). Returns 0 if today is Wednesday.
function daysUntilWednesday(): number {
  const now = new Date()
  const dow = now.getDay() // 0=Sun, 3=Wed
  return (3 - dow + 7) % 7
}

export default function RosterPage() {
  const { user, p, isFullAdmin } = useAuth()
  // ── Roster permissions (view is global; edit/submit/delete are per section) ──
  // Category keys in ROSTER_CATEGORIES match the RosterSectionKey enum exactly.
  const canView   = isFullAdmin || p('can_view_roster')
  const canEdit   = (s: string) => isFullAdmin || p(rosterPerm('edit',   s as RosterSectionKey))
  const canSubmit = (s: string) => isFullAdmin || p(rosterPerm('submit', s as RosterSectionKey))
  const canDelete = (s: string) => isFullAdmin || p(rosterPerm('delete', s as RosterSectionKey))
  const canEditAny   = isFullAdmin || ROSTER_CATEGORIES.some(c => p(rosterPerm('edit',   c.key as RosterSectionKey)))
  const canDeleteAny = isFullAdmin || ROSTER_CATEGORIES.some(c => p(rosterPerm('delete', c.key as RosterSectionKey)))
  const [roles, setRoles]       = useState<RosterRole[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [periods, setPeriods]   = useState<Period[]>([])
  const [periodId, setPeriodId] = useState<string | null>(null)
  const [entries, setEntries]   = useState<Entry[]>([])
  const [sectionStatus, setSectionStatus] = useState<Record<string, SectionStatus>>({})
  const [submittingSection, setSubmittingSection] = useState<string | null>(null)
  const [leaveEmpIds, setLeaveEmpIds] = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(true)
  const [dbReady, setDbReady]   = useState(true)
  const [showNew,      setShowNew]      = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [showHelp,     setShowHelp]     = useState(false)
  const [generating,   setGenerating]   = useState(false)
  const [publishing,   setPublishing]   = useState(false)
  // which cell editor is open: `add:${roleKey}:${shift}` for an add, entry id for edit
  const [editing, setEditing] = useState<string | null>(null)
  // drag-and-drop state
  const [dragEntryId, setDragEntryId] = useState<string | null>(null)
  const [dragOverCell, setDragOverCell] = useState<string | null>(null) // 'roleKey:shift'

  const period = periods.find(p => p.id === periodId) ?? null
  const isPublished = period?.status === 'published'

  // ── Load roles + employees + periods once ───────────────────────────────────
  useEffect(() => {
    (async () => {
      db().from('employees').select('id,name,display_name,department,job_title,skills,operator_id')
        .eq('active', true).order('name')
        .then(({ data }: any) => setEmployees((data as Employee[]) ?? []))

      try {
        const { data, error } = await db().from('roster_roles')
          .select('key,name,category,sort_order').eq('active', true).order('sort_order')
        if (error) throw error
        const rows = (data as any[]) ?? []
        setRoles(rows.length
          ? rows.map(r => ({ key: r.key, name: r.name, category: r.category, sort: r.sort_order }))
          : ROSTER_ROLE_SEED)
      } catch {
        setRoles(ROSTER_ROLE_SEED)
        setDbReady(false)
      }
      try {
        const { data, error } = await db().from('roster_periods')
          .select('id,name,start_date,end_date,day_label,night_label,notes,status,published_at')
          .order('start_date', { ascending: false })
        if (error) throw error
        const rows = (data as any[]) ?? []
        // Graceful: if status column doesn't exist yet, back-fill default
        const mapped: Period[] = rows.map(r => ({ ...r, status: r.status ?? 'draft', published_at: r.published_at ?? null }))
        setPeriods(mapped)
        const { date } = sastNow()
        const current = mapped.find(p => p.start_date <= date && date <= p.end_date)
        setPeriodId((current ?? mapped[0])?.id ?? null)
      } catch {
        setDbReady(false)
      }
      setLoading(false)
    })()
  }, [])

  // ── Load entries when the selected period changes ───────────────────────────
  useEffect(() => {
    if (!periodId) { setEntries([]); return }
    setDirtyCategories(new Set()) // fresh load clears all unsaved state
    db().from('roster_entries')
      .select('id,period_id,role_key,shift,employee_id,operator_id,person_name,tags,sort_order')
      .eq('period_id', periodId).order('sort_order')
      .then(({ data }: any) => setEntries((data as Entry[]) ?? []))
    // Per-section submission status (graceful if the table isn't migrated yet)
    db().from('roster_section_status')
      .select('section,status,submitted_by,submitted_at')
      .eq('period_id', periodId)
      .then(({ data }: any) => {
        const map: Record<string, SectionStatus> = {}
        ;((data as SectionStatus[]) ?? []).forEach(r => { map[r.section] = r })
        setSectionStatus(map)
      }, () => setSectionStatus({}))
  }, [periodId])

  // Leave flags for the selected period
  useEffect(() => {
    const p = periods.find(x => x.id === periodId)
    if (!p) { setLeaveEmpIds(new Set()); return }
    db().from('employee_leave').select('employee_id')
      .lte('start_date', p.end_date).gte('end_date', p.start_date)
      .then(({ data }: any) => setLeaveEmpIds(new Set(((data as any[]) ?? []).map(r => r.employee_id).filter(Boolean))),
            () => setLeaveEmpIds(new Set()))
  }, [periodId, periods])

  const rolesByCategory = useMemo(() => {
    const map = new Map<string, RosterRole[]>()
    roles.forEach(r => { (map.get(r.category) ?? map.set(r.category, []).get(r.category)!).push(r) })
    return ROSTER_CATEGORIES
      .map(c => ({ cat: c, items: (map.get(c.key) ?? []).sort((a, b) => a.sort - b.sort) }))
      .filter(g => g.items.length)
  }, [roles])

  const roleCategory = useMemo(() => {
    const m = new Map<string, string>()
    roles.forEach(r => m.set(r.key, r.category))
    return m
  }, [roles])

  // ── Per-department staged save ──────────────────────────────────────────────
  // All edits update local state only — no DB write until "Save [Dept]" is clicked.
  // Each department (category) owns its own dirty flag. Two supervisors editing
  // different departments simultaneously will not collide: each save does
  // delete-all + insert-all for only their category's role keys.
  const [dirtyCategories, setDirtyCategories] = useState<Set<string>>(new Set())
  const [savingCategory, setSavingCategory]   = useState<string | null>(null)

  function markDirty(categoryKey: string) {
    setDirtyCategories(s => new Set([...s, categoryKey]))
  }

  function cellEntries(roleKey: string, shift: RosterShift) {
    return entries
      .filter(e => e.role_key === roleKey && e.shift === shift)
      .sort((a, b) => a.sort_order - b.sort_order)
  }

  // Stage locally — no DB write
  function addEntry(roleKey: string, shift: RosterShift, employeeId: string | null, name: string, tags: string[]) {
    if (!periodId || !name.trim()) return
    const cat = roleCategory.get(roleKey) ?? ''
    const sort = cellEntries(roleKey, shift).length
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const emp = employees.find(e => e.id === employeeId)
    setEntries(es => [...es, { id: tempId, period_id: periodId, role_key: roleKey, shift, employee_id: employeeId, operator_id: emp?.operator_id ?? null, person_name: name.trim(), tags, sort_order: sort }])
    markDirty(cat)
    setEditing(null)
  }
  function updateEntry(id: string, employeeId: string | null, name: string, tags: string[]) {
    if (!name.trim()) return
    const entry = entries.find(e => e.id === id)
    const cat = entry ? (roleCategory.get(entry.role_key) ?? '') : ''
    const emp = employees.find(e => e.id === employeeId)
    setEntries(es => es.map(e => e.id === id ? { ...e, employee_id: employeeId, operator_id: emp?.operator_id ?? null, person_name: name.trim(), tags } : e))
    markDirty(cat)
    setEditing(null)
  }
  function deleteEntry(id: string) {
    const entry = entries.find(e => e.id === id)
    const cat = entry ? (roleCategory.get(entry.role_key) ?? '') : ''
    setEntries(es => es.filter(e => e.id !== id))
    markDirty(cat)
    setEditing(null)
  }
  function moveEntry(id: string, newRoleKey: string, newShift: RosterShift) {
    const entry = entries.find(e => e.id === id)
    if (!entry || (entry.role_key === newRoleKey && entry.shift === newShift)) return
    const srcCat = roleCategory.get(entry.role_key) ?? ''
    const dstCat = roleCategory.get(newRoleKey) ?? ''
    setEntries(es => es.map(e => e.id === id ? { ...e, role_key: newRoleKey, shift: newShift } : e))
    markDirty(srcCat)
    if (dstCat !== srcCat) markDirty(dstCat)
  }

  // Persist one department — delete all DB rows for those role keys, re-insert current state
  async function saveDepartment(categoryKey: string) {
    if (!periodId) return
    setSavingCategory(categoryKey)
    try {
      const catRoleKeys = roles.filter(r => r.category === categoryKey).map(r => r.key)
      if (catRoleKeys.length === 0) return
      await db().from('roster_entries').delete()
        .eq('period_id', periodId)
        .in('role_key', catRoleKeys)
      const toInsert = entries
        .filter(e => catRoleKeys.includes(e.role_key))
        .map((e, i) => ({
          period_id: e.period_id, role_key: e.role_key, shift: e.shift,
          employee_id: e.employee_id, operator_id: e.operator_id ?? null,
          person_name: e.person_name, tags: e.tags, sort_order: i,
        }))
      let fresh: Entry[] = []
      if (toInsert.length > 0) {
        const { data, error } = await db().from('roster_entries')
          .insert(toInsert as any)
          .select('id,period_id,role_key,shift,employee_id,operator_id,person_name,tags,sort_order')
        if (error) throw error
        fresh = (data as Entry[]) ?? []
      }
      setEntries(es => [...es.filter(e => !catRoleKeys.includes(e.role_key)), ...fresh])
      setDirtyCategories(s => { const n = new Set(s); n.delete(categoryKey); return n })
      // A save means the section changed — it is no longer "submitted".
      // Best-effort: don't let a missing status table break the save.
      try {
        await db().from('roster_section_status')
          .upsert({ period_id: periodId, section: categoryKey, status: 'draft', submitted_by: null, submitted_at: null } as any,
                   { onConflict: 'period_id,section' })
        setSectionStatus(s => ({ ...s, [categoryKey]: { section: categoryKey, status: 'draft', submitted_by: null, submitted_at: null } }))
      } catch { /* table may not be migrated yet */ }
    } catch (err) {
      console.error('saveDepartment failed', err)
    } finally {
      setSavingCategory(null)
    }
  }

  // Submit (sign off) a section for the period. Persists any pending edits first,
  // then records the submission so the Wednesday reminder cron stops emailing it.
  async function submitSection(categoryKey: string) {
    if (!periodId) return
    if (dirtyCategories.has(categoryKey)) await saveDepartment(categoryKey)
    setSubmittingSection(categoryKey)
    try {
      const submitted_at = new Date().toISOString()
      const { error } = await db().from('roster_section_status')
        .upsert({ period_id: periodId, section: categoryKey, status: 'submitted', submitted_by: user?.id ?? null, submitted_at } as any,
                 { onConflict: 'period_id,section' })
      if (error) throw error
      setSectionStatus(s => ({ ...s, [categoryKey]: { section: categoryKey, status: 'submitted', submitted_by: user?.id ?? null, submitted_at } }))
    } catch (err) {
      console.error('submitSection failed', err)
    } finally {
      setSubmittingSection(null)
    }
  }

  // ── New period ──────────────────────────────────────────────────────────────
  async function createPeriod(p: { name: string; start: string; end: string; dayLabel: string; nightLabel: string }) {
    const { data } = await db().from('roster_periods').insert({
      name: p.name, start_date: p.start, end_date: p.end,
      day_label: p.dayLabel, night_label: p.nightLabel,
      created_by: user?.id ?? null,
    } as any).select('id,name,start_date,end_date,day_label,night_label,notes,status,published_at').single()
    if (data) {
      const mapped = { ...(data as any), status: (data as any).status ?? 'draft', published_at: (data as any).published_at ?? null }
      setPeriods(ps => [mapped as Period, ...ps])
      setPeriodId(mapped.id)
    }
    setShowNew(false)
  }

  // ── Generate next period from current (rotated day↔night) ─────────────────
  async function generateNextPeriod(config: { name: string; start: string; end: string; dayLabel: string; nightLabel: string }) {
    setGenerating(true)
    try {
      const { data: newPeriod } = await db().from('roster_periods').insert({
        name: config.name, start_date: config.start, end_date: config.end,
        day_label: config.dayLabel, night_label: config.nightLabel,
        created_by: user?.id ?? null,
      } as any).select('id,name,start_date,end_date,day_label,night_label,notes,status,published_at').single()
      if (!newPeriod) return
      const np = { ...(newPeriod as any), status: (newPeriod as any).status ?? 'draft', published_at: null }

      // Rotate every entry: day ↔ night
      const rotated = entries.map(e => ({
        period_id: np.id,
        role_key:  e.role_key,
        shift:     e.shift === 'day' ? 'night' : 'day',
        employee_id: e.employee_id,
        operator_id: e.operator_id ?? null,
        person_name: e.person_name,
        tags:        e.tags,
        sort_order:  e.sort_order,
      }))
      if (rotated.length > 0) await db().from('roster_entries').insert(rotated as any)

      const { data: newEntries } = await db().from('roster_entries')
        .select('id,period_id,role_key,shift,employee_id,operator_id,person_name,tags,sort_order')
        .eq('period_id', np.id).order('sort_order')

      setPeriods(ps => [np as Period, ...ps])
      setPeriodId(np.id)
      setEntries((newEntries as Entry[]) ?? [])
      setSectionStatus({})  // fresh period — every section starts as draft

      // Email each section's responsible submitter that next week is ready to
      // review/submit. Fire-and-forget; recipients derive from the submit perm.
      fetch('/api/production/roster/cron?task=remind', { method: 'POST' }).catch(() => {})
    } finally {
      setGenerating(false)
      setShowGenerate(false)
    }
  }

  // ── Publish period + sync maintenance duty_roster ─────────────────────────
  async function publishPeriod() {
    if (!periodId || !period) return
    setPublishing(true)
    try {
      await db().from('roster_periods').update({
        status: 'published', published_at: new Date().toISOString(),
      } as any).eq('id', periodId)
      setPeriods(ps => ps.map(p => p.id === periodId
        ? { ...p, status: 'published', published_at: new Date().toISOString() }
        : p))

      // Sync maintenance entries to maintenance.duty_roster
      const maintRoleKeys = ['maintenance_tech', 'maintenance_asst']
      const maintEntries = entries.filter(e => maintRoleKeys.includes(e.role_key))
      if (maintEntries.length > 0) {
        // Delete any existing duty_roster rows that OVERLAP this period
        // (overlap = start_at < periodEnd AND end_at > periodStart)
        await getDb().schema('maintenance' as any).from('duty_roster')
          .delete()
          .lt('start_at', `${format(addDays(parseISO(period.end_date + 'T12:00:00'), 1), 'yyyy-MM-dd')}T00:00:00Z`)
          .gt('end_at', `${period.start_date}T00:00:00Z`)

        // Create daily slots for each maintenance person over the period
        const slots: any[] = []
        let cur = parseISO(period.start_date + 'T12:00:00')
        const endDate = parseISO(period.end_date + 'T12:00:00')
        while (cur <= endDate) {
          const d = format(cur, 'yyyy-MM-dd')
          maintEntries.forEach(e => {
            // Day shift: 07:00–16:00 SAST = 05:00–14:00 UTC
            // Night shift: 16:00 SAST – 01:00 SAST next day = 14:00–23:00 UTC
            if (e.shift === 'day') {
              slots.push({ technician: e.person_name, technician_user_id: null, start_at: `${d}T05:00:00Z`, end_at: `${d}T14:00:00Z` })
            } else {
              const next = format(addDays(cur, 1), 'yyyy-MM-dd')
              slots.push({ technician: e.person_name, technician_user_id: null, start_at: `${d}T14:00:00Z`, end_at: `${next}T23:00:00Z` })
            }
          })
          cur = addDays(cur, 1)
        }
        if (slots.length > 0) await getDb().schema('maintenance' as any).from('duty_roster').insert(slots)
      }
    } catch { /* maintenance sync is best-effort */ } finally {
      setPublishing(false)
    }
  }

  async function deletePeriod(id: string) {
    await db().from('roster_periods').delete().eq('id', id)
    const rest = periods.filter(p => p.id !== id)
    setPeriods(rest)
    setPeriodId(rest[0]?.id ?? null)
  }

  // ── Export the current period to a branded, colour-coded .xlsx ─────────────
  function exportXlsx() {
    if (!period) return
    exportRosterPeriod(period, entries, roles, roleCategory, ROSTER_CATEGORIES, fmtRange(period))
  }

  // Wednesday deadline
  const daysLeft  = daysUntilWednesday()
  const todayWed  = daysLeft === 0

  // ── Confirmation progress ──────────────────────────────────────────────────
  // Every department shown in the grid must be submitted before the period is
  // considered confirmed. These drive the outstanding tracker + auto-publish.
  const requiredSections  = useMemo(() => rolesByCategory.map(g => g.cat), [rolesByCategory])
  const outstandingSections = requiredSections.filter(c => sectionStatus[c.key]?.status !== 'submitted')
  const submittedCount    = requiredSections.length - outstandingSections.length
  const allSubmitted      = requiredSections.length > 0 && outstandingSections.length === 0

  // Auto-publish once every department has confirmed. This is a system action
  // triggered by the data condition (the last submit, or the first load that
  // observes a fully-confirmed period), so it fires regardless of who completes
  // the set. The ref stops it re-firing for the same period.
  const autoPublishedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!period || isPublished || !allSubmitted) return
    if (autoPublishedRef.current === period.id) return
    autoPublishedRef.current = period.id
    publishPeriod()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, isPublished, allSubmitted])

  // View gate — the roster is permission-gated; without view access, stop here.
  if (!loading && !canView) {
    return (
      <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
        <h1 className="font-display font-bold text-[22px] text-text">Shift Rosters</h1>
        <div className="flex items-start gap-2.5 px-4 py-4 bg-stone-50 border border-stone-200 rounded-2xl text-[13px] text-stone-600">
          <Lock size={16} className="shrink-0 mt-0.5 text-stone-400" />
          <span>You don&apos;t have permission to view the shift roster. Ask an administrator to grant you <strong>View the whole roster</strong> under Users &amp; Roles → Shift Roster.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5 print-full-width">
      <div className="no-print flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="font-display font-bold text-[22px] text-text">Shift Rosters</h1>
            <button
              onClick={() => setShowHelp(true)}
              title="How this page works"
              className="p-1 rounded-full text-stone-300 hover:text-brand hover:bg-brand/8 transition-colors"
            >
              <Info size={16} />
            </button>
          </div>
          <p className="text-[12px] text-stone-400 mt-0.5">The whole-site shift layout — every role and shift across all departments.</p>
        </div>
        {/* Wednesday deadline badge */}
        <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-[12px] font-medium
          ${todayWed ? 'bg-err/8 border-err/30 text-err' : daysLeft <= 2 ? 'bg-warn/8 border-warn/30 text-warn' : 'bg-stone-50 border-stone-200 text-stone-600'}`}>
          {todayWed ? <AlertTriangle size={14} /> : <CalendarRange size={14} />}
          {todayWed
            ? 'Roster change deadline — today!'
            : daysLeft === 1
            ? '1 day until roster deadline (Wed)'
            : `${daysLeft} days until roster deadline (Wed)`}
        </div>
      </div>

      <div className="no-print"><WorkforceTabs /></div>

      {!dbReady && (
        <div className="no-print flex items-start gap-2.5 px-4 py-3 bg-warn-bg border border-warn/30 rounded-xl text-[12px] text-warn">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>Roster tables aren&apos;t set up yet. Run the roster migrations on the database, then reload.</span>
        </div>
      )}

      {/* Period bar */}
      <div className="no-print flex flex-wrap items-center gap-3 bg-surface-card border border-surface-rule rounded-2xl p-4">
        <CalendarRange size={16} className="text-text-muted shrink-0" />
        {periods.length > 0 ? (
          <div className="relative">
            <select
              value={periodId ?? ''} onChange={e => setPeriodId(e.target.value)}
              className="appearance-none pl-3 pr-9 py-2 rounded-lg border border-stone-200 bg-white text-[13px] font-medium text-text outline-none focus:border-brand cursor-pointer"
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.status === 'published' ? '✓ ' : ''}{p.name}{p.name !== fmtRange(p) ? ` · ${fmtRange(p)}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          </div>
        ) : (
          <span className="text-[13px] text-text-muted">No roster periods yet.</span>
        )}

        {/* Status badge */}
        {period && (
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full
            ${isPublished ? 'bg-ok/10 text-ok' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
            {isPublished ? <CheckCircle2 size={11} /> : <Pencil size={11} />}
            {isPublished ? 'Published' : 'Draft'}
          </span>
        )}

        <div className="flex items-center gap-2 flex-wrap ml-auto no-print">
          {/* Export .xlsx — anyone who can view. Turns green once published so the
              confirmed roster is clearly ready to print/share. */}
          {period && (
            <button
              onClick={exportXlsx}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                isPublished
                  ? 'bg-ok text-white hover:opacity-90'
                  : 'border border-stone-200 bg-white text-stone-600 hover:border-brand hover:text-brand'}`}
            >
              <Download size={13} /> Export
            </button>
          )}
          {/* Print — anyone who can view */}
          {period && (
            <button
              onClick={() => window.print()}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
                isPublished
                  ? 'bg-ok text-white hover:opacity-90'
                  : 'border border-stone-200 bg-white text-stone-600 hover:border-brand hover:text-brand'}`}
            >
              <Printer size={13} /> Print
            </button>
          )}
          {/* Generate next week — needs edit rights somewhere */}
          {period && !isPublished && canEditAny && (
            <button
              onClick={() => setShowGenerate(true)} disabled={!dbReady || generating}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 bg-white text-[12px] font-medium text-stone-600 hover:border-brand hover:text-brand disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={13} /> Generate next week
            </button>
          )}
          {/* New period — needs edit rights somewhere */}
          {canEditAny && (
            <button
              onClick={() => setShowNew(true)} disabled={!dbReady}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-mid disabled:opacity-40 transition-colors"
            >
              <Plus size={14} /> New period
            </button>
          )}
          {/* Publish — needs edit rights somewhere */}
          {period && !isPublished && canEditAny && (
            <button
              onClick={publishPeriod} disabled={publishing || !dbReady}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-ok text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40 transition-colors"
            >
              {publishing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Publish
            </button>
          )}
          {/* Delete — needs delete rights somewhere */}
          {period && canDeleteAny && (
            <button
              onClick={() => { if (confirm(`Delete roster period "${period.name}"? This removes all its entries.`)) deletePeriod(period.id) }}
              className="flex items-center gap-1.5 text-[12px] text-stone-400 hover:text-err transition-colors px-1"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Published notice */}
      {isPublished && period?.published_at && (
        <div className="no-print flex items-center gap-2.5 px-4 py-3 bg-ok/5 border border-ok/20 rounded-xl text-[12px] text-ok">
          <Lock size={14} className="shrink-0" />
          <span>Published {format(parseISO(period.published_at), 'd MMM yyyy HH:mm')} — maintenance duty roster has been synced. Printing/export is ready (green buttons above). Changes are still possible but will require re-publishing.</span>
        </div>
      )}

      {/* Confirmation tracker — who's still outstanding. Emphasised on Wednesday
          (the change deadline). Once every department confirms, the period
          auto-publishes and this is replaced by the published notice above. */}
      {period && !isPublished && requiredSections.length > 0 && (
        <div className={`no-print rounded-2xl border p-4 space-y-3 ${
          todayWed ? 'bg-err/5 border-err/30' : 'bg-surface-card border-surface-rule'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {allSubmitted
              ? <Loader2 size={15} className="text-ok animate-spin shrink-0" />
              : todayWed
                ? <AlertTriangle size={15} className="text-err shrink-0" />
                : <Send size={15} className="text-text-muted shrink-0" />}
            <span className="font-display font-semibold text-[13px] text-text">
              {allSubmitted
                ? 'All departments confirmed — publishing…'
                : `Roster confirmations · ${submittedCount}/${requiredSections.length}`}
            </span>
            {todayWed && !allSubmitted && (
              <span className="text-[11px] font-semibold text-err">Deadline today (Wed)</span>
            )}
          </div>

          {!allSubmitted && (
            <>
              <p className="text-[12px] text-text-muted">
                Waiting on {outstandingSections.length} department{outstandingSections.length === 1 ? '' : 's'} to confirm.
                The roster publishes automatically once everyone has submitted.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {requiredSections.map(c => {
                  const done = sectionStatus[c.key]?.status === 'submitted'
                  const at   = sectionStatus[c.key]?.submitted_at
                  return (
                    <span key={c.key}
                      title={done && at ? `Confirmed ${format(parseISO(at), 'd MMM HH:mm')}` : 'Not yet confirmed'}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                        done ? 'bg-ok/10 text-ok border-ok/30' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                      {done ? <CheckCircle2 size={11} /> : <Pencil size={11} />}
                      {ROSTER_SECTION_LABEL[c.key as RosterSectionKey] ?? c.label}
                    </span>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : !period ? (
        <EmptyState canCreate={dbReady} onCreate={() => setShowNew(true)} />
      ) : (
        <div className="no-print space-y-5">
          <OnDutyCard period={period} entries={entries} roleCategory={roleCategory} leaveEmpIds={leaveEmpIds} />
          <RosterGrid
            period={period}
            rolesByCategory={rolesByCategory}
            employees={employees}
            leaveEmpIds={leaveEmpIds}
            cellEntries={cellEntries}
            editing={editing} setEditing={setEditing}
            onAdd={addEntry} onUpdate={updateEntry} onDelete={deleteEntry}
            dragEntryId={dragEntryId} setDragEntryId={setDragEntryId}
            dragOverCell={dragOverCell} setDragOverCell={setDragOverCell}
            onMove={moveEntry}
            dirtyCategories={dirtyCategories}
            savingCategory={savingCategory}
            onSaveDept={saveDepartment}
            canEdit={canEdit} canSubmit={canSubmit}
            sectionStatus={sectionStatus}
            submittingSection={submittingSection}
            onSubmitSection={submitSection}
            currentUserId={user?.id ?? null}
          />
        </div>
      )}

      {/* Legend */}
      <div className="no-print bg-surface-card border border-surface-rule rounded-2xl p-4">
        <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-2.5">Skill / certification tags</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {SKILL_TAGS.map(t => (
            <span key={t.code} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="font-mono font-semibold text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">{t.code}</span>
              {t.label}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-stone-400 mt-2.5 flex items-center gap-1.5">
          <span className="w-4 h-4 rounded bg-stone-100 border border-stone-200 inline-flex items-center justify-center text-[8px]">⠿</span>
          Drag a person chip to move them to a different role or shift.
        </p>
      </div>

      {/* Print-only layout — the on-screen interactive grid is hidden via
          .no-print above; this plain, noticeboard-friendly table is shown
          only inside @media print (see globals.css). */}
      {period && <PrintRoster period={period} rolesByCategory={rolesByCategory} cellEntries={cellEntries} />}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showNew && <NewPeriodModal onClose={() => setShowNew(false)} onCreate={createPeriod} prevPeriod={period} />}
      {showGenerate && period && (
        <GenerateModal
          currentPeriod={period}
          currentEntries={entries}
          employees={employees}
          generating={generating}
          onClose={() => setShowGenerate(false)}
          onGenerate={generateNextPeriod}
        />
      )}
    </div>
  )
}

// ── Print-only layout: a plain, full-width table per section, sized for a
// noticeboard rather than a screenshot of the interactive grid. Hidden on
// screen (.print-only), shown only inside @media print — see globals.css.
function PrintRoster({ period, rolesByCategory, cellEntries }: {
  period: Period
  rolesByCategory: { cat: typeof ROSTER_CATEGORIES[number]; items: RosterRole[] }[]
  cellEntries: (roleKey: string, shift: RosterShift) => Entry[]
}) {
  // Some older periods store the raw time range as the label (e.g. "07h00
  // till 16h00") instead of a shift letter ("Shift A") — only append the
  // fixed time suffix when the label doesn't already read like one, so the
  // header doesn't repeat itself ("07h00 till 16h00 · 07h00–16h00").
  const looksLikeTime = (label: string) => /till|\d{1,2}h\d{2}/i.test(label)
  const dayLabel = period.day_label || 'Day Shift'
  const nightLabel = period.night_label || 'Night Shift'
  const dayHeader = looksLikeTime(dayLabel) ? dayLabel : `${dayLabel} · 07h00–16h00`
  const nightHeader = looksLikeTime(nightLabel) ? nightLabel : `${nightLabel} · 16h00–01h00`
  // Auto-generated names are just a short form of the date range (e.g. "6–10
  // Jul" for "6 Jul – 10 Jul 2026") — showing both is redundant. Only append
  // the name when it's a genuine custom label (no digits in it).
  const hasCustomName = !/\d/.test(period.name)
  const fmtPeople = (list: Entry[]) => list.length
    ? list.map(e => e.person_name + (e.tags.length ? ` (${e.tags.join(' ')})` : '')).join(', ')
    : '—'
  const th: CSSProperties = { textAlign: 'left', padding: '3px 6px', borderBottom: '1.5px solid #333', fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.3, color: '#555' }
  const td: CSSProperties = { padding: '3px 6px', borderBottom: '1px solid #e5e5e5', verticalAlign: 'top', fontSize: 9.5, lineHeight: 1.3 }

  return (
    <div className="print-only" style={{ fontFamily: 'Arial, sans-serif', color: '#111', padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '2px solid #1A3A0E', paddingBottom: 6, marginBottom: 10 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#1A3A0E' }}>Shift Roster</h1>
          <p style={{ fontSize: 11, margin: '2px 0 0', color: '#555' }}>
            {fmtRange(period)}{hasCustomName ? ` · ${period.name}` : ''}
          </p>
        </div>
        <p style={{ fontSize: 9, color: '#999', margin: 0 }}>Printed {format(new Date(), 'd MMM yyyy HH:mm')}</p>
      </div>

      {/* One full-width table per department, stacked top to bottom. CSS
          multi-column (column-count) looked good but Chromium's print engine
          balances column height to a single page and silently drops any
          content that doesn't fit — it does not flow the rest onto page 2.
          Plain block stacking has no such ceiling: the browser's normal print
          pagination reliably continues onto as many landscape pages as the
          roster needs. Each department is break-inside:avoid so its table
          only splits across a page if it genuinely can't fit on one. */}
      <div>
        {rolesByCategory.map(({ cat, items }) => (
          <div key={cat.key} style={{ marginBottom: 10, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <div style={{ borderLeft: `4px solid ${cat.colorHex}`, background: cat.colorHex + '14', padding: '2px 8px', marginBottom: 3 }}>
              <span style={{ fontWeight: 700, fontSize: 10.5, color: cat.colorHex, textTransform: 'uppercase', letterSpacing: 0.3 }}>{cat.label}</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: '22%' }}>Role</th>
                  <th style={th}>{dayHeader}</th>
                  <th style={th}>{nightHeader}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(role => (
                  <tr key={role.key}>
                    <td style={{ ...td, fontWeight: 600 }}>{role.name}</td>
                    <td style={td}>{fmtPeople(cellEntries(role.key, 'day'))}</td>
                    <td style={td}>{fmtPeople(cellEntries(role.key, 'night'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #ccc', fontSize: 8.5, color: '#555' }}>
        <strong style={{ color: '#111' }}>Skill / certification tags: </strong>
        {SKILL_TAGS.map(t => `${t.code} = ${t.label}`).join('   ·   ')}
      </div>
    </div>
  )
}

// ── Help modal: how the roster page works (view/edit/submit/delete, rotation,
// deadline, publish). Opened from the info icon next to the page title.
function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[560px] max-h-[85vh] overflow-y-auto p-5 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[17px] text-text">How the Shift Roster works</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={16} /></button>
        </div>

        {/* Four permissions */}
        <div>
          <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest mb-2">Four separate permissions per section</p>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { icon: Eye, label: 'View', desc: 'See all sections, read-only' },
              { icon: Edit3, label: 'Edit', desc: 'Add, move or remove people' },
              { icon: Send, label: 'Submit', desc: 'Sign the section off' },
              { icon: ShieldCheck, label: 'Delete', desc: 'Remove entries or periods' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2.5">
                <Icon size={14} className="text-brand shrink-0 mt-0.5" />
                <div>
                  <div className="text-[12px] font-semibold text-text">{label}</div>
                  <div className="text-[11px] text-stone-500">{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-stone-400 mt-2">Granted per section (Production, Store, Quality, Cleaning, Maintenance, H&amp;S) under Users &amp; Roles → Shift Roster. A lock icon on a section means you can view it but not edit it.</p>
        </div>

        {/* Editing */}
        <div>
          <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest mb-2">Adding &amp; moving people</p>
          <ul className="text-[12px] text-text-muted space-y-1.5 list-disc pl-4">
            <li>Click <strong className="text-text">Add</strong> under a Day/Night cell, search for the person, tick any skill tags, then <strong className="text-text">Save</strong>.</li>
            <li>Hover a person&apos;s chip and click the pencil to edit them, or drag the chip to a different role/shift.</li>
            <li>Changes are local until you click <strong className="text-text">Save [Section]</strong> — the status chip flips to Draft while you edit.</li>
          </ul>
        </div>

        {/* Submit / deadline / rotation */}
        <div>
          <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest mb-2">Submitting, the deadline &amp; rotation</p>
          <ul className="text-[12px] text-text-muted space-y-1.5 list-disc pl-4">
            <li>Click <strong className="text-text">Submit [Section]</strong> once it&apos;s final — this is what the Wednesday deadline badge is tracking.</li>
            <li>The <strong className="text-text">confirmations tracker</strong> shows which departments are still outstanding. It&apos;s highlighted red on Wednesday (the change deadline).</li>
            <li>Every <strong className="text-text">Sunday night</strong>, next week&apos;s roster is generated automatically with day/night shifts swapped, and every section resets to Draft.</li>
            <li><strong className="text-text">Monday &amp; Wednesday mornings</strong>, anyone who holds the Submit permission for a section that&apos;s still Draft gets a reminder email.</li>
          </ul>
        </div>

        {/* Publish */}
        <div className="flex items-start gap-2.5 px-3.5 py-3 bg-ok/5 border border-ok/20 rounded-xl">
          <CheckCircle2 size={14} className="text-ok shrink-0 mt-0.5" />
          <p className="text-[12px] text-text-muted"><strong className="text-text">The roster publishes automatically once every department has confirmed.</strong> You can still publish early with the green <strong>Publish</strong> button (needs edit rights). Publishing syncs the Maintenance section to the maintenance duty roster and turns the <strong>Export</strong> / <strong>Print</strong> buttons green so the confirmed roster is ready to share. The roster stays visible across the app whether or not it&apos;s been published.</p>
        </div>

        {/* Export / print */}
        <div>
          <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest mb-2">Export &amp; print</p>
          <ul className="text-[12px] text-text-muted space-y-1.5 list-disc pl-4">
            <li><strong className="text-text">Export</strong> downloads a branded, colour-coded <code className="text-[11px] bg-stone-100 px-1 rounded">.xlsx</code> matching what&apos;s on screen.</li>
            <li><strong className="text-text">Print</strong> produces a plain, full-width table — one section per block — sized for a noticeboard rather than a screenshot of the app.</li>
          </ul>
        </div>

        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium hover:bg-brand-mid transition-colors">Got it</button>
      </div>
    </div>
  )
}

// ── "Who's on when": today's on-duty roster, grouped by department ────────────
function OnDutyCard({ period, entries, roleCategory, leaveEmpIds }: {
  period: Period; entries: Entry[]; roleCategory: Map<string, string>; leaveEmpIds: Set<string>
}) {
  const { date, shift: currentShift } = sastNow()
  const coversToday = period.start_date <= date && date <= period.end_date
  const [shift, setShift] = useState<RosterShift>(currentShift)

  if (!coversToday) return null

  const onShift = entries.filter(e => e.shift === shift)
  const byDept = ROSTER_CATEGORIES
    .map(c => ({
      cat: c,
      people: onShift
        .filter(e => roleCategory.get(e.role_key) === c.key)
        .sort((a, b) => a.sort_order - b.sort_order),
    }))
    .filter(g => g.people.length)

  const todayLabel = format(parseISO(date + 'T12:00:00'), 'EEE d MMM')
  const shiftMeta = ROSTER_SHIFTS.find(s => s.key === shift)!

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-brand" />
          <span className="font-display font-bold text-[14px] text-text">On duty</span>
          <span className="text-[12px] text-text-muted">· {todayLabel}</span>
        </div>
        <div className="ml-auto inline-flex rounded-lg border border-stone-200 overflow-hidden">
          {ROSTER_SHIFTS.map(s => {
            const on = s.key === shift
            const isNow = s.key === currentShift
            return (
              <button key={s.key} onClick={() => setShift(s.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors ${on ? 'bg-brand text-white' : 'bg-white text-stone-500 hover:text-text'}`}>
                {s.key === 'day' ? <Sun size={12} /> : <Moon size={12} />}
                {(s.key === 'day' ? period.day_label : period.night_label) || s.label}
                {isNow && <span className={`text-[8px] font-semibold px-1 py-0.5 rounded-full ${on ? 'bg-white/25' : 'bg-ok/15 text-ok'}`}>now</span>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="font-mono text-[10px] text-text-muted">{shiftMeta.label} · {shift === 'day' ? period.day_label : period.night_label} · {onShift.length} people</div>

      {byDept.length === 0 ? (
        <p className="text-[12px] text-text-muted py-2">Nobody rostered for this shift yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {byDept.map(({ cat, people }) => (
            <div key={cat.key} className="rounded-xl border border-surface-rule bg-surface p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: cat.colorHex }} />
                <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: cat.colorHex }}>{cat.label}</span>
                <span className="text-[10px] text-stone-400">{people.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {people.map(e => {
                  const away = !!e.employee_id && leaveEmpIds.has(e.employee_id)
                  return (
                    <span key={e.id} title={away ? 'On leave this period' : undefined}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] ${away ? 'bg-amber-50 border-amber-200 text-amber-700 line-through' : 'bg-white border-stone-200 text-text'}`}>
                      {e.person_name}
                      {e.tags.map(code => (
                        <span key={code} title={tagLabel(code)} className="font-mono font-semibold text-[8px] px-1 py-0.5 rounded bg-brand/8 text-brand">{code}</span>
                      ))}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── The grid: categories → role rows × Day/Night columns ──────────────────────
function RosterGrid({
  period, rolesByCategory, employees, leaveEmpIds, cellEntries, editing, setEditing,
  onAdd, onUpdate, onDelete, dragEntryId, setDragEntryId, dragOverCell, setDragOverCell, onMove,
  dirtyCategories, savingCategory, onSaveDept,
  canEdit, canSubmit, sectionStatus, submittingSection, onSubmitSection, currentUserId,
}: {
  period: Period
  rolesByCategory: { cat: typeof ROSTER_CATEGORIES[number]; items: RosterRole[] }[]
  employees: Employee[]
  leaveEmpIds: Set<string>
  cellEntries: (roleKey: string, shift: RosterShift) => Entry[]
  editing: string | null
  setEditing: (v: string | null) => void
  onAdd: (roleKey: string, shift: RosterShift, employeeId: string | null, name: string, tags: string[]) => void
  onUpdate: (id: string, employeeId: string | null, name: string, tags: string[]) => void
  onDelete: (id: string) => void
  dragEntryId: string | null
  setDragEntryId: (id: string | null) => void
  dragOverCell: string | null
  setDragOverCell: (key: string | null) => void
  onMove: (id: string, roleKey: string, shift: RosterShift) => void
  dirtyCategories: Set<string>
  savingCategory: string | null
  onSaveDept: (cat: string) => void
  canEdit: (section: string) => boolean
  canSubmit: (section: string) => boolean
  sectionStatus: Record<string, SectionStatus>
  submittingSection: string | null
  onSubmitSection: (section: string) => void
  currentUserId: string | null
}) {
  const shiftLabel = (s: RosterShift) => s === 'day' ? period.day_label : period.night_label
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-x-auto">
      <table className="w-full border-collapse min-w-[760px]">
        <thead>
          <tr className="border-b border-surface-rule bg-surface">
            <th className="px-4 py-3 text-left font-mono text-[10px] text-text-muted uppercase tracking-wide w-[200px] sticky left-0 bg-surface z-10">Role</th>
            {ROSTER_SHIFTS.map(s => {
              const label = shiftLabel(s.key)
              return (
                <th key={s.key} className="px-4 py-3 text-left">
                  <div className="flex items-center gap-1.5">
                    {s.key === 'day' ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} className="text-indigo-400" />}
                    <span className="font-display font-bold text-[13px] text-text">{label || s.label}</span>
                  </div>
                  <div className="font-mono text-[10px] text-text-muted mt-0.5">{s.time}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rolesByCategory.map(({ cat, items }) => (
            <CategoryGroup key={cat.key} cat={cat} items={items} employees={employees} leaveEmpIds={leaveEmpIds}
              cellEntries={cellEntries} editing={editing} setEditing={setEditing}
              onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete}
              dragEntryId={dragEntryId} setDragEntryId={setDragEntryId}
              dragOverCell={dragOverCell} setDragOverCell={setDragOverCell}
              onMove={onMove}
              isDirty={dirtyCategories.has(cat.key)}
              isSaving={savingCategory === cat.key}
              onSave={() => onSaveDept(cat.key)}
              canEdit={canEdit(cat.key)} canSubmit={canSubmit(cat.key)}
              status={sectionStatus[cat.key]}
              isSubmitting={submittingSection === cat.key}
              onSubmit={() => onSubmitSection(cat.key)}
              currentUserId={currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CategoryGroup({ cat, items, employees, leaveEmpIds, cellEntries, editing, setEditing, onAdd, onUpdate, onDelete, dragEntryId, setDragEntryId, dragOverCell, setDragOverCell, onMove, isDirty, isSaving, onSave, canEdit, canSubmit, status, isSubmitting, onSubmit, currentUserId }: any) {
  const isSubmitted = status?.status === 'submitted'
  const submittedByYou = isSubmitted && status?.submitted_by && status.submitted_by === currentUserId
  return (
    <>
      <tr>
        <td colSpan={3} className="px-3 py-1.5 border-y border-surface-rule"
          style={{ background: cat.colorHex + '14', borderLeft: `3px solid ${cat.colorHex}` }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide font-semibold" style={{ color: cat.colorHex }}>
              <span className="w-2 h-2 rounded-full" style={{ background: cat.colorHex }} /> {cat.label}
            </span>
            {/* Read-only lock for sections the user cannot edit */}
            {!canEdit && (
              <span title="You can view this section but not edit it" className="inline-flex items-center gap-1 text-[9px] text-stone-400">
                <Lock size={10} /> view only
              </span>
            )}
            {/* Submission status chip */}
            {isSubmitted ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-ok/10 text-ok">
                <CheckCircle2 size={11} /> Submitted{submittedByYou ? ' by you' : ''}
                {status?.submitted_at ? ` · ${format(parseISO(status.submitted_at), 'd MMM HH:mm')}` : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                <Pencil size={10} /> Draft
              </span>
            )}
            <div className="ml-auto inline-flex items-center gap-2">
              {isDirty && canEdit && (
                <button onClick={onSave} disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-ok/40 text-ok text-[10px] font-semibold disabled:opacity-60 hover:bg-ok/5 transition-colors">
                  {isSaving
                    ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                    : <><Check size={11} /> Save {cat.label}</>}
                </button>
              )}
              {canSubmit && !isSubmitted && (
                <button onClick={onSubmit} disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ok text-white text-[10px] font-semibold disabled:opacity-60 hover:opacity-90 transition-opacity">
                  {isSubmitting
                    ? <><Loader2 size={11} className="animate-spin" /> Submitting…</>
                    : <><Send size={11} /> Submit {cat.label}</>}
                </button>
              )}
            </div>
          </div>
        </td>
      </tr>
      {items.map((role: RosterRole) => (
        <tr key={role.key} className="border-b border-surface-rule last:border-0 align-top">
          <td className="px-4 py-2.5 sticky left-0 bg-surface-card z-10 border-r border-surface-rule"
            style={{ borderLeft: `3px solid ${cat.colorHex}` }}>
            <span className="font-body font-medium text-[13px] text-text leading-tight">{role.name}</span>
          </td>
          {ROSTER_SHIFTS.map((s: { key: RosterShift }) => (
            <RosterCell key={s.key} roleKey={role.key} shift={s.key} employees={employees} leaveEmpIds={leaveEmpIds}
              entries={cellEntries(role.key, s.key)}
              editing={editing} setEditing={setEditing}
              onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete}
              dragEntryId={dragEntryId} setDragEntryId={setDragEntryId}
              dragOverCell={dragOverCell} setDragOverCell={setDragOverCell}
              onMove={onMove} canEdit={canEdit} />
          ))}
        </tr>
      ))}
    </>
  )
}

function RosterCell({ roleKey, shift, employees, leaveEmpIds, entries, editing, setEditing, onAdd, onUpdate, onDelete, dragEntryId, setDragEntryId, dragOverCell, setDragOverCell, onMove, canEdit }: {
  roleKey: string; shift: RosterShift; employees: Employee[]; leaveEmpIds: Set<string>; entries: Entry[]
  editing: string | null; setEditing: (v: string | null) => void
  onAdd: (roleKey: string, shift: RosterShift, employeeId: string | null, name: string, tags: string[]) => void
  onUpdate: (id: string, employeeId: string | null, name: string, tags: string[]) => void
  onDelete: (id: string) => void
  dragEntryId: string | null; setDragEntryId: (id: string | null) => void
  dragOverCell: string | null; setDragOverCell: (key: string | null) => void
  onMove: (id: string, roleKey: string, shift: RosterShift) => void
  canEdit: boolean
}) {
  const addKey  = `add:${roleKey}:${shift}`
  const cellKey = `${roleKey}:${shift}`
  const isDropTarget = canEdit && dragEntryId !== null && dragOverCell === cellKey
  const takenIds = entries.map(e => e.employee_id).filter(Boolean) as string[]

  return (
    <td
      className={`px-3 py-2 align-top transition-colors ${isDropTarget ? 'bg-brand/8 ring-1 ring-inset ring-brand/30' : ''}`}
      onDragOver={canEdit ? (e => { if (dragEntryId) { e.preventDefault(); setDragOverCell(cellKey) } }) : undefined}
      onDragLeave={canEdit ? (() => setDragOverCell(null)) : undefined}
      onDrop={canEdit ? (e => {
        e.preventDefault()
        const id = e.dataTransfer.getData('entryId')
        if (id) onMove(id, roleKey, shift)
        setDragOverCell(null); setDragEntryId(null)
      }) : undefined}
    >
      <div className="flex flex-col gap-1.5">
        {entries.map(e => canEdit && editing === e.id ? (
          <PersonEditor key={e.id} employees={employees} leaveEmpIds={leaveEmpIds} excludeIds={takenIds.filter(id => id !== e.employee_id)}
            initialEmployeeId={e.employee_id} initialName={e.person_name} initialTags={e.tags}
            onSave={(empId, n, t) => onUpdate(e.id, empId, n, t)} onCancel={() => setEditing(null)}
            onDelete={() => onDelete(e.id)} />
        ) : (
          <PersonChip key={e.id} entry={e} away={!!e.employee_id && leaveEmpIds.has(e.employee_id)}
            canEdit={canEdit}
            onEdit={() => setEditing(e.id)}
            onDragStart={id => { setDragEntryId(id) }}
            onDragEnd={() => { setDragEntryId(null); setDragOverCell(null) }} />
        ))}

        {canEdit && (editing === addKey ? (
          <PersonEditor employees={employees} leaveEmpIds={leaveEmpIds} excludeIds={takenIds}
            onSave={(empId, n, t) => onAdd(roleKey, shift, empId, n, t)} onCancel={() => setEditing(null)} />
        ) : (
          <button onClick={() => setEditing(addKey)}
            className="self-start inline-flex items-center gap-1 text-[12px] text-stone-400 hover:text-brand transition-colors py-1 no-print">
            <Plus size={13} /> Add
          </button>
        ))}
      </div>
    </td>
  )
}

function PersonChip({ entry, away, canEdit = true, onEdit, onDragStart, onDragEnd }: {
  entry: Entry; away?: boolean; canEdit?: boolean; onEdit: () => void
  onDragStart?: (id: string) => void; onDragEnd?: () => void
}) {
  return (
    <div
      draggable={canEdit}
      onDragStart={canEdit ? (e => { e.dataTransfer.setData('entryId', entry.id); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(entry.id) }) : undefined}
      onDragEnd={canEdit ? (() => onDragEnd?.()) : undefined}
      className={`group inline-flex items-center gap-1.5 self-start max-w-full px-3 py-2 rounded-lg border transition-colors
        ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
        ${away ? 'bg-amber-50 border-amber-200 hover:border-amber-300' : 'bg-stone-50 border-stone-200 hover:border-brand/40 hover:bg-white'}`}
      title={!canEdit ? 'View only' : away ? 'On leave this period — consider a stand-in' : 'Drag to move to another cell'}
    >
      {away && <span title="On leave" className="text-amber-600 shrink-0">✈</span>}
      <span className={`text-[13px] font-medium truncate ${away ? 'text-amber-700' : 'text-text'}`}>{entry.person_name}</span>
      {entry.tags.map(code => (
        <span key={code} title={tagLabel(code)}
          className="font-mono font-semibold text-[9px] px-1.5 py-0.5 rounded bg-brand/8 text-brand shrink-0">{code}</span>
      ))}
      {canEdit && (
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 shrink-0 no-print"
        >
          <Pencil size={11} className="text-stone-300" />
        </button>
      )}
    </div>
  )
}

function PersonEditor({ employees, leaveEmpIds, excludeIds = [], initialEmployeeId = null, initialName = '', initialTags = [], onSave, onCancel, onDelete }: {
  employees: Employee[]; leaveEmpIds?: Set<string>; excludeIds?: string[]
  initialEmployeeId?: string | null; initialName?: string; initialTags?: string[]
  onSave: (employeeId: string | null, name: string, tags: string[]) => void; onCancel: () => void; onDelete?: () => void
}) {
  const [employeeId, setEmployeeId] = useState<string | null>(initialEmployeeId)
  const [name, setName] = useState(initialName)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(!initialName)
  const toggle = (c: string) => setTags(t => t.includes(c) ? t.filter(x => x !== c) : [...t, c])
  const empLabel = (e: Employee) => e.display_name || e.name

  const q = query.trim().toLowerCase()
  const matches = employees
    .filter(e => !excludeIds.includes(e.id))
    .filter(e => q === '' || empLabel(e).toLowerCase().includes(q) || (e.job_title ?? '').toLowerCase().includes(q))
    .slice(0, 8)

  function pick(e: Employee) {
    setEmployeeId(e.id); setName(empLabel(e)); setQuery(''); setOpen(false)
    if (tags.length === 0 && e.skills?.length) setTags(e.skills)
  }

  // Click anywhere outside this card dismisses it, same as onCancel — the
  // search dropdown was otherwise staying open until Escape or Save/Cancel.
  // Registered on the CAPTURE phase (not bubble): picking a match flips
  // `open` to false, which unmounts the search/dropdown DOM synchronously
  // as part of the same click — by the bubble phase, the clicked button is
  // already detached, so contains(ev.target) would wrongly read "outside"
  // and cancel the very selection just made. Capture runs before that
  // mutation, while the DOM is still in its pre-click state.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handle(ev: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) onCancel()
    }
    document.addEventListener('mousedown', handle, true)
    return () => document.removeEventListener('mousedown', handle, true)
  }, [onCancel])

  return (
    <div ref={rootRef} className="rounded-xl border border-brand/40 bg-white p-3.5 shadow-lg space-y-3 w-[320px] max-w-full">
      {name && !open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-stone-200 bg-stone-50 text-left">
          <span className="text-[14px] font-medium text-text truncate">{name}</span>
          <Pencil size={13} className="text-stone-300 shrink-0" />
        </button>
      ) : (
        <div className="relative">
          <div className="flex items-center gap-2 px-3 rounded-lg border border-stone-200 bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10 transition-shadow">
            <Search size={15} className="text-stone-400" />
            <input
              autoFocus value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
              placeholder="Search staff…"
              className="flex-1 py-2.5 text-[14px] text-text outline-none bg-transparent"
            />
          </div>
          {(matches.length > 0 || query.trim() !== '') && (
            <div className="absolute z-20 left-0 right-0 mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl overflow-hidden">
              {matches.length > 0 ? (
                <div className="max-h-72 overflow-y-auto divide-y divide-stone-100">
                  {matches.map(e => {
                    const meta = categoryMeta(e.department)
                    return (
                      <button key={e.id} type="button" onMouseDown={ev => { ev.preventDefault(); pick(e) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-brand/5">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                          style={{ background: meta.colorHex }}>
                          {empLabel(e).charAt(0).toUpperCase()}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-medium text-text truncate">{empLabel(e)}</span>
                          <span className="block text-[11px] mt-0.5" style={{ color: meta.colorHex }}>{meta.label}</span>
                        </span>
                        {leaveEmpIds?.has(e.id) && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">leave</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="px-3 py-4 text-[12px] text-text-muted text-center">No staff match &ldquo;{query.trim()}&rdquo;</p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {SKILL_TAGS.map(t => {
          const on = tags.includes(t.code)
          return (
            <button key={t.code} type="button" onClick={() => toggle(t.code)} title={t.label}
              className={`font-mono font-semibold text-[11px] px-2 py-1.5 rounded-lg border transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-500 border-stone-200 hover:border-brand/40'}`}>
              {t.code}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => name.trim() && onSave(employeeId, name, tags)} disabled={!name.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
          <Check size={14} /> Save
        </button>
        <button onClick={onCancel} className="p-2.5 rounded-lg border border-stone-200 text-stone-400 hover:text-text"><X size={15} /></button>
        {onDelete && (
          <button onClick={onDelete} className="p-2.5 rounded-lg border border-stone-200 text-stone-400 hover:text-err hover:border-err/40"><Trash2 size={15} /></button>
        )}
      </div>
    </div>
  )
}

function EmptyState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center bg-surface-card border border-dashed border-surface-rule rounded-2xl">
      <CalendarRange size={28} className="text-stone-300 mb-3" />
      <p className="font-display font-semibold text-[15px] text-text">No roster period yet</p>
      <p className="text-[12px] text-text-muted mt-1 max-w-[320px]">Create a date-range period, then roster people onto each role and shift.</p>
      {canCreate && (
        <button onClick={onCreate} className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-mid transition-colors">
          <Plus size={14} /> Create first period
        </button>
      )}
    </div>
  )
}

function NewPeriodModal({ onClose, onCreate, prevPeriod }: {
  onClose: () => void
  onCreate: (p: { name: string; start: string; end: string; dayLabel: string; nightLabel: string }) => void
  prevPeriod?: Period | null
}) {
  const [name, setName]   = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd]     = useState('')
  // Infer the default shift A/B assignment from the previous period (swap it)
  const defaultDayIsA = prevPeriod
    ? prevPeriod.day_label === 'Shift B'   // last week day=B → this week day=A
    : true                                  // first ever period: day = A
  const [dayIsA, setDayIsA] = useState(defaultDayIsA)

  const dayLabel   = dayIsA ? 'Shift A' : 'Shift B'
  const nightLabel = dayIsA ? 'Shift B' : 'Shift A'

  const valid = name.trim() && start && end && start <= end

  const suggested = useMemo(() => {
    if (!start || !end) return ''
    try {
      const s = parseISO(start + 'T12:00:00'), e = parseISO(end + 'T12:00:00')
      return `${format(s, 'd')}–${format(e, 'd MMM')}`
    } catch { return '' }
  }, [start, end])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[400px] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[16px] text-text">New roster period</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Start date</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] text-text outline-none focus:border-brand" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">End date</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] text-text outline-none focus:border-brand" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Label</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={suggested || 'e.g. July wk 1'}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] text-text outline-none focus:border-brand" />
        </div>
        {/* Shift A/B assignment */}
        <div className="space-y-2">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Shift letters this week</label>
          <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden">
            <button type="button" onClick={() => setDayIsA(true)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${dayIsA ? 'bg-brand text-white' : 'bg-white text-stone-500 hover:text-text'}`}>
              <Sun size={13} /> Day = Shift A
            </button>
            <button type="button" onClick={() => setDayIsA(false)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${!dayIsA ? 'bg-brand text-white' : 'bg-white text-stone-500 hover:text-text'}`}>
              <Moon size={13} /> Day = Shift B
            </button>
          </div>
          <p className="text-[11px] text-stone-400">Morning (07:00–16:00) = <strong>{dayLabel}</strong> · Night (16:00–01:00) = <strong>{nightLabel}</strong></p>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
          <button onClick={() => valid && onCreate({ name: name.trim() || suggested, start, end, dayLabel, nightLabel })} disabled={!valid}
            className="flex-1 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Generate next week modal ──────────────────────────────────────────────────
function GenerateModal({ currentPeriod, currentEntries, employees, generating, onClose, onGenerate }: {
  currentPeriod: Period
  currentEntries: Entry[]
  employees: Employee[]
  generating: boolean
  onClose: () => void
  onGenerate: (config: { name: string; start: string; end: string; dayLabel: string; nightLabel: string }) => void
}) {
  const nextStart = addDays(parseISO(currentPeriod.start_date + 'T12:00:00'), 7)
  const nextEnd   = addDays(parseISO(currentPeriod.end_date   + 'T12:00:00'), 7)
  const [start, setStart] = useState(format(nextStart, 'yyyy-MM-dd'))
  const [end,   setEnd]   = useState(format(nextEnd,   'yyyy-MM-dd'))
  const [name,  setName]  = useState(`${format(nextStart, 'd')}–${format(nextEnd, 'd MMM')}`)

  // Shift labels swap each week (Shift A ↔ Shift B follow the people, not the clock)
  const nextDayLabel   = currentPeriod.night_label || 'Shift B'
  const nextNightLabel = currentPeriod.day_label   || 'Shift A'

  const valid = name.trim() && start && end && start <= end

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _employees = employees  // retained for future leave lookup by name
  // Who is being rotated and what their new shift will be
  const rotated = useMemo(() => {
    return currentEntries.map(e => ({
      ...e,
      newShift:      e.shift === 'day' ? 'night' as RosterShift : 'day' as RosterShift,
      newShiftLabel: e.shift === 'day' ? nextNightLabel : nextDayLabel,
    }))
  }, [currentEntries, nextDayLabel, nextNightLabel])

  // Check leave for the new period dates using what we already have
  const [newLeaveIds, setNewLeaveIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    getDb().schema('production').from('employee_leave').select('employee_id')
      .lte('start_date', end).gte('end_date', start)
      .then(({ data }: any) => setNewLeaveIds(new Set(((data as any[]) ?? []).map((r: any) => r.employee_id).filter(Boolean))))
  }, [start, end])

  const conflicts = rotated.filter(e => e.employee_id && newLeaveIds.has(e.employee_id))

  // Group rotation preview by new shift
  const dayOps  = rotated.filter(e => e.newShift === 'day')
  const nightOps = rotated.filter(e => e.newShift === 'night')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto p-5 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-[16px] text-text">Generate next week</h3>
            <p className="text-[12px] text-text-muted mt-0.5">All staff rotate shifts: day ↔ night. Review and confirm.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={16} /></button>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Start date</label>
            <input type="date" value={start} onChange={e => { setStart(e.target.value); setName(`${format(parseISO(e.target.value + 'T12:00:00'), 'd')}–${format(parseISO(end + 'T12:00:00'), 'd MMM')}`) }}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] outline-none focus:border-brand" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">End date</label>
            <input type="date" value={end} onChange={e => { setEnd(e.target.value); setName(`${format(parseISO(start + 'T12:00:00'), 'd')}–${format(parseISO(e.target.value + 'T12:00:00'), 'd MMM')}`) }}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] outline-none focus:border-brand" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Label</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] outline-none focus:border-brand" />
        </div>

        {/* Rotation preview */}
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200 flex items-center gap-2">
            <RefreshCw size={13} className="text-stone-500" />
            <span className="text-[12px] font-semibold text-stone-600">Rotation — {currentEntries.length} entries</span>
            <ArrowRight size={12} className="text-stone-400 ml-auto" />
            <span className="text-[11px] text-stone-500">{dayOps.length} day · {nightOps.length} night</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-stone-100">
            {(['day', 'night'] as RosterShift[]).map(s => {
              const people    = rotated.filter(e => e.newShift === s)
              const shiftName = s === 'day' ? nextDayLabel : nextNightLabel
              return (
                <div key={s} className="p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    {s === 'day' ? <Sun size={12} className="text-amber-500" /> : <Moon size={12} className="text-indigo-400" />}
                    <span className="text-[11px] font-semibold text-stone-600">{shiftName}</span>
                    <span className="text-[10px] text-stone-400">({s})</span>
                  </div>
                  {people.slice(0, 8).map(e => {
                    const onLeave = !!e.employee_id && newLeaveIds.has(e.employee_id)
                    return (
                      <div key={e.id} className={`text-[11px] flex items-center gap-1 ${onLeave ? 'text-amber-600' : 'text-stone-700'}`}>
                        {onLeave && <span title="On leave">✈</span>}
                        {e.person_name}
                      </div>
                    )
                  })}
                  {people.length > 8 && <div className="text-[10px] text-stone-400">+{people.length - 8} more</div>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Leave conflicts */}
        {conflicts.length > 0 && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-1">{conflicts.length} leave conflict{conflicts.length !== 1 ? 's' : ''} — review after generating</div>
              <div className="text-[11px] text-amber-700">{conflicts.map(c => c.person_name).join(', ')} {conflicts.length === 1 ? 'is' : 'are'} on leave during this period.</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
          <button onClick={() => valid && onGenerate({ name: name.trim(), start, end, dayLabel: nextDayLabel, nightLabel: nextNightLabel })} disabled={!valid || generating}
            className="flex-1 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors flex items-center justify-center gap-2">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Generate & rotate
          </button>
        </div>
      </div>
    </div>
  )
}

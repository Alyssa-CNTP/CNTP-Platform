'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import {
  Loader2, Plus, X, Trash2, Search, AlertTriangle,
  Phone, Plane, ChevronDown, ChevronRight, ChevronUp, KeyRound, UserCheck, IdCard,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { StaffTabs } from '@/components/production/StaffTabs'
import { PageInfoButton } from '@/components/hr/PageInfo'
import { ROSTER_CATEGORIES, categoryMeta, tagLabel } from '@/lib/production/roster-config'
import { EmployeeModal } from '@/components/production/EmployeeModal'

interface Employee {
  id: string; name: string; display_name: string | null
  department: string; job_title: string | null; skills: string[]
  phone: string | null; active: boolean
  position: string | null; position_code: string | null
  employee_code: string | null; start_date: string | null
}

interface CompetencySummary {
  employee_id: string
  total: number
  competent: number
}
interface Leave {
  id: string; employee_id: string; start_date: string; end_date: string
  kind: string; reason: string | null
}
interface OperatorBadge { operator_code: string | null; active: boolean }
interface LabPinBadge { active: boolean }
interface LoginBadge { has_login: true; is_active: boolean; sso?: boolean; email?: string | null; role?: string | null }
interface IdentitiesMap {
  operators: Record<string, OperatorBadge>
  labPins?: Record<string, LabPinBadge>
  logins: Record<string, LoginBadge>
}

const db = () => getDb().schema('production')

const DEPARTMENTS = [
  ...ROSTER_CATEGORIES,
  { key: 'admin',      label: 'Admin',      colorHex: '#637056' },
  { key: 'laboratory', label: 'Laboratory', colorHex: '#1A7A3C' },
]


// Today in SAST (Africa/Johannesburg) as YYYY-MM-DD.
const todaySAST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

const fmtD = (d: string) => format(parseISO(d + 'T12:00:00'), 'd MMM')

// Explicit PIN / EMAIL badges on every row, so a supervisor can see how each
// person signs in — and who has neither — without opening each profile.
// Login email is only ever present when the API decided the caller may see
// it (IT / can_manage_users); the badge itself still renders either way.
function SignInBadge({ kind, set, active, detail }: { kind: 'PIN' | 'EMAIL'; set: boolean; active: boolean; detail?: string | null }) {
  const Icon = kind === 'PIN' ? IdCard : KeyRound
  const cls = !set ? 'bg-stone-100 text-stone-400' : active ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
  const title = !set
    ? `No ${kind === 'PIN' ? 'PIN operator' : 'login account'} set up`
    : `${kind === 'PIN' ? 'PIN operator (Capture)' : 'Login account (Users & Roles)'}${active ? '' : ' — inactive'}${detail ? ` · ${detail}` : ''}`
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cls}`} title={title}>
      <Icon size={9} /> {kind}
    </span>
  )
}

// The Microsoft SSO badge (orange) — shown ONLY for genuine Azure-AD sign-in,
// never for supabase password/PIN accounts (which use a synthetic email).
function SSOBadge({ active, email }: { active: boolean; email?: string | null }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-amber-100 text-amber-700' : 'bg-warn/15 text-warn'}`}
      title={`Microsoft SSO sign-in${active ? '' : ' — inactive'}${email ? ` · ${email}` : ''}`}>
      <KeyRound size={9} /> Microsoft
    </span>
  )
}

function IdentityBadges({ operator, labPin, login }: { operator?: OperatorBadge; labPin?: LabPinBadge; login?: LoginBadge }) {
  // A person has a PIN sign-in via either a Capture operator record or a lab PIN.
  const hasPin = !!operator || !!labPin
  const pinActive = operator ? operator.active : !!labPin?.active
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <SignInBadge kind="PIN" set={hasPin} active={pinActive} detail={operator?.operator_code} />
      {login?.sso && <SSOBadge active={!!login?.is_active} email={login?.email} />}
    </div>
  )
}

export default function StaffDirectoryPage() {
  const { p } = useAuth()
  const { user } = useAuth()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [leave, setLeave] = useState<Leave[]>([])
  const [competencySummaries, setCompetencySummaries] = useState<CompetencySummary[]>([])
  const [identities, setIdentities] = useState<IdentitiesMap>({ operators: {}, logins: {} })
  const [loading, setLoading] = useState(true)
  const [dbReady, setDbReady] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  // accordion open/close per dept key — all open by default
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // inline delete confirmation: empId being confirmed
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  // page-level error banner (e.g. a delete rejected by the server permission gate)
  const [actionError, setActionError] = useState<string | null>(null)

  async function load() {
    try {
      const { data, error } = await db().from('employees')
        .select('id,name,display_name,department,job_title,skills,phone,active,position,position_code,employee_code,start_date').order('name')
      if (error) throw error
      setEmployees((data as Employee[]) ?? [])
      const { data: lv } = await db().from('employee_leave')
        .select('id,employee_id,start_date,end_date,kind,reason').order('start_date', { ascending: false })
      setLeave((lv as Leave[]) ?? [])
      // Load competency summaries for the chip display
      const { data: comps } = await db().from('employee_competencies')
        .select('employee_id,status')
      if (comps) {
        const byEmp: Record<string, { total: number; competent: number }> = {}
        for (const c of comps as { employee_id: string; status: string }[]) {
          if (!byEmp[c.employee_id]) byEmp[c.employee_id] = { total: 0, competent: 0 }
          byEmp[c.employee_id].total++
          if (c.status === 'competent') byEmp[c.employee_id].competent++
        }
        setCompetencySummaries(
          Object.entries(byEmp).map(([employee_id, v]) => ({ employee_id, ...v }))
        )
      }
    } catch {
      setDbReady(false)
    }
    // Best-effort — a failed identities fetch shouldn't block the directory
    // from loading, it just leaves the PIN/login badges blank.
    fetch('/api/staff/identities').then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setIdentities({ operators: data.operators ?? {}, labPins: data.labPins ?? {}, logins: data.logins ?? {} }) })
      .catch(() => {})
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const today = todaySAST()
  const leaveByEmp = useMemo(() => {
    const m = new Map<string, Leave[]>()
    leave.forEach(l => { (m.get(l.employee_id) ?? m.set(l.employee_id, []).get(l.employee_id)!).push(l) })
    return m
  }, [leave])
  const onLeaveToday = (id: string) =>
    (leaveByEmp.get(id) ?? []).find(l => l.start_date <= today && today <= l.end_date) ?? null

  const compByEmp = useMemo(() => {
    const m = new Map<string, CompetencySummary>()
    competencySummaries.forEach(s => m.set(s.employee_id, s))
    return m
  }, [competencySummaries])

  // Filtered employees (search only — dept grouping replaces dept filter chip)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return employees
    return employees.filter(e =>
      (e.display_name || e.name).toLowerCase().includes(q) ||
      (e.job_title ?? '').toLowerCase().includes(q) ||
      (e.position ?? '').toLowerCase().includes(q) ||
      (e.employee_code ?? '').toLowerCase().includes(q)
    )
  }, [employees, query])

  // Group by department, alphabetical within each group
  const grouped = useMemo(() => {
    const byDept = new Map<string, Employee[]>()
    for (const dept of DEPARTMENTS) byDept.set(dept.key, [])
    for (const e of filtered) {
      if (!byDept.has(e.department)) byDept.set(e.department, [])
      byDept.get(e.department)!.push(e)
    }
    // Sort each dept alphabetically (already ordered from DB but search may reorder)
    byDept.forEach(arr => arr.sort((a, b) => (a.display_name || a.name).localeCompare(b.display_name || b.name)))
    return byDept
  }, [filtered])

  function toggleCollapse(key: string) {
    setCollapsed(s => {
      const next = new Set(s)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── persistence ─────────────────────────────────────────────────────────────
  // Add / edit go through /api/staff, which enforces can_edit_staff_profiles
  // server-side (the browser-only check was not real enforcement — open RLS).
  // Throws on failure so the modal can keep itself open and show the error.
  async function saveEmployee(emp: Partial<Employee> & {
    position?: string | null; position_code?: string | null
    employee_code?: string | null; start_date?: string | null
  }, id: string | null) {
    const payload = {
      name: emp.name?.trim(), display_name: emp.display_name?.trim() || null,
      department: emp.department, job_title: emp.job_title?.trim() || null,
      skills: emp.skills ?? [], phone: emp.phone?.trim() || null, active: emp.active ?? true,
      position: emp.position?.trim() || null, position_code: emp.position_code?.trim() || null,
      employee_code: emp.employee_code?.trim() || null, start_date: emp.start_date || null,
    }
    const res = await fetch(id ? `/api/staff/${id}` : '/api/staff', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Could not save this person')

    if (id) {
      setEmployees(es => es.map(e => e.id === id ? { ...e, ...(data as Employee) } : e))
    } else {
      setEmployees(es => [...es, data as Employee].sort((a, b) => a.name.localeCompare(b.name)))
    }
    setEditing(null)
  }

  // Offboard = coordinated soft-deactivate (employee + linked PIN + linked
  // login, plus an IT ticket to delete the auth account) — not a hard delete.
  // See app/api/staff/[id]/offboard/route.ts.
  async function offboardEmployee(id: string) {
    const res = await fetch(`/api/staff/${id}/offboard`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setActionError(data?.error || 'Could not offboard this person')
      setConfirmDelete(null)
      return
    }
    setEmployees(es => es.map(e => e.id === id ? { ...e, active: false } : e))
    setConfirmDelete(null)
  }

  async function reactivateEmployee(id: string) {
    const res = await fetch(`/api/staff/${id}/offboard`, { method: 'PATCH' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setActionError(data?.error || 'Could not reactivate this person')
      return
    }
    setEmployees(es => es.map(e => e.id === id ? { ...e, active: true } : e))
  }

  async function addLeave(employeeId: string, l: { start: string; end: string; kind: string; reason: string }) {
    const { data } = await db().from('employee_leave').insert({
      employee_id: employeeId, start_date: l.start, end_date: l.end,
      kind: l.kind, reason: l.reason.trim() || null, created_by: user?.id ?? null,
    } as any).select('id,employee_id,start_date,end_date,kind,reason').single()
    if (data) setLeave(ls => [data as Leave, ...ls])
  }
  async function removeLeave(id: string) {
    await db().from('employee_leave').delete().eq('id', id)
    setLeave(ls => ls.filter(l => l.id !== id))
  }

  // p is a function — call it. (Was `p?.can_edit_staff_profiles`, which reads a
  // property off the function and is always undefined, so these gates never
  // opened for anyone and the add/edit/delete controls stayed hidden.)
  const canEdit   = p('can_edit_staff_profiles')
  const canDelete = p('can_delete_staff')

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="font-display font-bold text-[22px] text-text">Staff Directory</h1>
            <PageInfoButton title="The one profile every identity links to">
              <p>This is the <strong className="text-text">canonical person record</strong> — one row per human on site. Everything else attaches to it:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Open a person's profile to see their <strong className="text-text">Identity hub</strong> — PIN (Capture sign-in) and login account (Microsoft sign-in), each linked here.</li>
                <li><strong className="text-text">Training</strong> courses and the <strong className="text-text">Skills Matrix</strong> both key off this record.</li>
                <li>The <strong className="text-text">Shift Roster</strong> schedules these same people into sections and shifts.</li>
                <li>Login accounts are created in <strong className="text-text">Users &amp; Roles</strong> (IT-only) — from a profile with no login, "Create one →" takes IT straight there, already linked to this person.</li>
              </ul>
            </PageInfoButton>
          </div>
          <p className="text-[12px] text-stone-400 mt-0.5">One shared list of everyone on site — operators, cleaning, QC, store, maintenance, H&S. Editable here; the Shift Roster and Capture both draw from it.</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditing('new')} disabled={!dbReady}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-mid disabled:opacity-40 transition-colors">
            <Plus size={14} /> Add person
          </button>
        )}
      </div>

      <StaffTabs />

      {!dbReady && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-warn-bg border border-warn/30 rounded-xl text-[12px] text-warn">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>The staff directory isn&apos;t set up yet. Run <code className="font-mono">20260623_001_staff_directory.sql</code> and <code className="font-mono">20260623_003_employee_leave.sql</code> on the database, then reload.</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-err/5 border border-err/30 rounded-xl text-[12px] text-err">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-err/60 hover:text-err"><X size={14} /></button>
        </div>
      )}

      {/* Global search */}
      <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200 bg-white focus-within:border-brand">
        <Search size={15} className="text-stone-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, job title, position, or employee code…"
          className="flex-1 py-2.5 text-[13px] outline-none bg-transparent" />
        {query && (
          <button onClick={() => setQuery('')} className="text-stone-300 hover:text-text"><X size={14} /></button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : (
        <div className="space-y-3">
          {DEPARTMENTS.map(dept => {
            const members = grouped.get(dept.key) ?? []
            // Skip empty departments when searching
            if (query && members.length === 0) return null
            const open = !collapsed.has(dept.key)
            return (
              <div key={dept.key} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden"
                style={{ borderLeft: `3px solid ${dept.colorHex}` }}>
                {/* Dept header / accordion toggle */}
                <button
                  onClick={() => toggleCollapse(dept.key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-semibold text-[13px] text-text">{dept.label}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                      style={{ background: dept.colorHex }}>
                      {members.length}
                    </span>
                  </div>
                  {open ? <ChevronUp size={15} className="text-stone-400" /> : <ChevronDown size={15} className="text-stone-400" />}
                </button>

                {open && members.length > 0 && (
                  <div className="border-t border-surface-rule">
                    {members.map(e => {
                      const ol = onLeaveToday(e.id)
                      const comp = compByEmp.get(e.id)
                      const isConfirming = confirmDelete === e.id

                      if (isConfirming) {
                        return (
                          <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-surface-rule last:border-0 bg-err/5">
                            <span className="text-[13px] text-err font-medium flex-1">
                              Offboard <strong>{e.display_name || e.name}</strong>? Deactivates their PIN and login and marks them inactive — history is kept, and this can be reversed.
                            </span>
                            <button onClick={() => setConfirmDelete(null)}
                              className="px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] font-medium text-stone-500 hover:bg-stone-50 transition-colors">
                              Cancel
                            </button>
                            <button onClick={() => offboardEmployee(e.id)}
                              className="px-3 py-1.5 rounded-lg bg-err text-white text-[12px] font-medium hover:opacity-90 transition-opacity">
                              Offboard
                            </button>
                          </div>
                        )
                      }

                      return (
                        <div key={e.id} className="flex items-center border-b border-surface-rule last:border-0">
                          {/* Main row info */}
                          <div className="flex-1 flex items-center gap-3 px-4 py-3 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dept.colorHex }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[13px] font-semibold truncate ${e.active ? 'text-text' : 'text-stone-400 line-through'}`}>
                                  {e.display_name || e.name}
                                </span>
                                {ol && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
                                    <Plane size={9} /> On {ol.kind} · till {fmtD(ol.end_date)}
                                  </span>
                                )}
                                {!e.active && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 shrink-0">Inactive</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-muted flex-wrap">
                                {(e.position || e.job_title) && (
                                  <span className="truncate max-w-[220px]">{e.position || e.job_title}</span>
                                )}
                                {e.employee_code && (
                                  <span className="font-mono text-[10px] text-stone-400">{e.employee_code}</span>
                                )}
                                {e.phone && (
                                  <span className="inline-flex items-center gap-1"><Phone size={9} />{e.phone}</span>
                                )}
                              </div>
                              <IdentityBadges operator={identities.operators[e.id]} labPin={identities.labPins?.[e.id]} login={identities.logins[e.id]} />
                            </div>
                            {/* Competency chip + skill tags */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {comp && comp.total > 0 && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  comp.competent === comp.total
                                    ? 'bg-ok/15 text-ok'
                                    : comp.competent === 0
                                    ? 'bg-stone-100 text-stone-400'
                                    : 'bg-warn/15 text-warn'
                                }`}>
                                  {comp.competent}/{comp.total}
                                </span>
                              )}
                              {e.skills.map(c => (
                                <span key={c} title={tagLabel(c)} className="font-mono font-semibold text-[8px] px-1 py-0.5 rounded bg-brand/8 text-brand">{c}</span>
                              ))}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center shrink-0">
                            {canDelete && e.active && (
                              <button onClick={() => setConfirmDelete(e.id)} title="Offboard"
                                className="flex items-center px-2.5 py-3 text-stone-300 hover:text-err transition-colors">
                                <Trash2 size={14} />
                              </button>
                            )}
                            {canDelete && !e.active && (
                              <button onClick={() => reactivateEmployee(e.id)} title="Reactivate"
                                className="flex items-center px-2.5 py-3 text-stone-300 hover:text-ok transition-colors">
                                <UserCheck size={14} />
                              </button>
                            )}
                            <Link href={`/production/staff/${e.id}`}
                              className="flex items-center px-3 py-3 text-stone-300 hover:text-brand transition-colors"
                              title="View full profile">
                              <ChevronRight size={16} />
                            </Link>
                          </div>
                        </div>
                      )
                    })}
                    {members.length === 0 && (
                      <p className="text-[12px] text-text-muted text-center py-6">No staff in this department.</p>
                    )}
                  </div>
                )}

                {open && members.length === 0 && !query && (
                  <div className="border-t border-surface-rule">
                    <p className="text-[12px] text-text-muted text-center py-6">No staff in this department.</p>
                  </div>
                )}
              </div>
            )
          })}

          {/* Catch-all for depts not in the DEPARTMENTS list */}
          {(() => {
            const knownKeys = new Set(DEPARTMENTS.map(d => d.key))
            const overflow: Employee[] = filtered.filter(e => !knownKeys.has(e.department))
            if (overflow.length === 0) return null
            const open = !collapsed.has('__other__')
            return (
              <div key="__other__" className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden"
                style={{ borderLeft: '3px solid #9CA3AF' }}>
                <button onClick={() => toggleCollapse('__other__')}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-semibold text-[13px] text-text">Other</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white bg-stone-400">
                      {overflow.length}
                    </span>
                  </div>
                  {open ? <ChevronUp size={15} className="text-stone-400" /> : <ChevronDown size={15} className="text-stone-400" />}
                </button>
                {open && (
                  <div className="border-t border-surface-rule">
                    {overflow.map(e => {
                      const ol = onLeaveToday(e.id)
                      const comp = compByEmp.get(e.id)
                      const meta = categoryMeta(e.department)
                      const isConfirming = confirmDelete === e.id
                      if (isConfirming) {
                        return (
                          <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-surface-rule last:border-0 bg-err/5">
                            <span className="text-[13px] text-err font-medium flex-1">
                              Offboard <strong>{e.display_name || e.name}</strong>? Deactivates their PIN and login and marks them inactive — history is kept, and this can be reversed.
                            </span>
                            <button onClick={() => setConfirmDelete(null)}
                              className="px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] font-medium text-stone-500 hover:bg-stone-50 transition-colors">
                              Cancel
                            </button>
                            <button onClick={() => offboardEmployee(e.id)}
                              className="px-3 py-1.5 rounded-lg bg-err text-white text-[12px] font-medium hover:opacity-90 transition-opacity">
                              Offboard
                            </button>
                          </div>
                        )
                      }
                      return (
                        <div key={e.id} className="flex items-center border-b border-surface-rule last:border-0">
                          <div className="flex-1 flex items-center gap-3 px-4 py-3 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.colorHex }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[13px] font-semibold truncate ${e.active ? 'text-text' : 'text-stone-400 line-through'}`}>
                                  {e.display_name || e.name}
                                </span>
                                {ol && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
                                    <Plane size={9} /> On {ol.kind} · till {fmtD(ol.end_date)}
                                  </span>
                                )}
                                {!e.active && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 shrink-0">Inactive</span>}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-muted flex-wrap">
                                {(e.position || e.job_title) && <span className="truncate max-w-[220px]">{e.position || e.job_title}</span>}
                                {e.employee_code && <span className="font-mono text-[10px] text-stone-400">{e.employee_code}</span>}
                              </div>
                              <IdentityBadges operator={identities.operators[e.id]} labPin={identities.labPins?.[e.id]} login={identities.logins[e.id]} />
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {comp && comp.total > 0 && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  comp.competent === comp.total ? 'bg-ok/15 text-ok'
                                    : comp.competent === 0 ? 'bg-stone-100 text-stone-400'
                                    : 'bg-warn/15 text-warn'
                                }`}>{comp.competent}/{comp.total}</span>
                              )}
                              {e.skills.map(c => (
                                <span key={c} title={tagLabel(c)} className="font-mono font-semibold text-[8px] px-1 py-0.5 rounded bg-brand/8 text-brand">{c}</span>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center shrink-0">
                            {canDelete && e.active && (
                              <button onClick={() => setConfirmDelete(e.id)} title="Offboard"
                                className="flex items-center px-2.5 py-3 text-stone-300 hover:text-err transition-colors">
                                <Trash2 size={14} />
                              </button>
                            )}
                            {canDelete && !e.active && (
                              <button onClick={() => reactivateEmployee(e.id)} title="Reactivate"
                                className="flex items-center px-2.5 py-3 text-stone-300 hover:text-ok transition-colors">
                                <UserCheck size={14} />
                              </button>
                            )}
                            <Link href={`/production/staff/${e.id}`}
                              className="flex items-center px-3 py-3 text-stone-300 hover:text-brand transition-colors"
                              title="View full profile">
                              <ChevronRight size={16} />
                            </Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {filtered.length === 0 && query && (
            <p className="text-[13px] text-text-muted text-center py-12">No staff match &ldquo;{query}&rdquo;.</p>
          )}
        </div>
      )}

      {editing && (
        <EmployeeModal
          employee={editing === 'new' ? null : editing}
          leave={editing === 'new' ? [] : (leaveByEmp.get((editing as Employee).id) ?? [])}
          onClose={() => setEditing(null)}
          onSave={saveEmployee}
          onAddLeave={addLeave} onRemoveLeave={removeLeave}
        />
      )}
    </div>
  )
}

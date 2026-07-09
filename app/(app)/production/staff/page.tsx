'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import {
  Users, Loader2, Plus, X, Check, Trash2, Search, AlertTriangle,
  Phone, Plane, ChevronDown, ChevronRight, ChevronUp, Pencil, KeyRound, UserCheck, IdCard,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { StaffTabs } from '@/components/production/StaffTabs'
import { ROSTER_CATEGORIES, SKILL_TAGS, categoryMeta, tagLabel } from '@/lib/production/roster-config'

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
interface LoginBadge { has_login: true; is_active: boolean; email?: string | null; role?: string | null }
interface IdentitiesMap {
  operators: Record<string, OperatorBadge>
  logins: Record<string, LoginBadge>
}

const db = () => getDb().schema('production')

const DEPARTMENTS = [
  ...ROSTER_CATEGORIES,
  { key: 'admin',      label: 'Admin',      colorHex: '#637056' },
  { key: 'laboratory', label: 'Laboratory', colorHex: '#1A7A3C' },
]

const LEAVE_KINDS = ['leave', 'sick', 'training', 'other']

// Today in SAST (Africa/Johannesburg) as YYYY-MM-DD.
const todaySAST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

const fmtD = (d: string) => format(parseISO(d + 'T12:00:00'), 'd MMM')

// PIN + login status inline on the list row, so a supervisor can see who's
// signed-in-capable without opening each profile. Login email is only ever
// present when the API decided the caller may see it (IT / can_manage_users).
function IdentityBadges({ operator, login }: { operator?: OperatorBadge; login?: LoginBadge }) {
  if (!operator && !login) return null
  return (
    <div className="flex items-center gap-2 mt-0.5 text-[11px] flex-wrap">
      {operator && (
        <span className={`inline-flex items-center gap-1 font-mono ${operator.active ? 'text-brand' : 'text-stone-400'}`} title="PIN operator (Capture)">
          <IdCard size={10} /> {operator.operator_code || 'PIN'}{!operator.active && ' (inactive)'}
        </span>
      )}
      {login && (
        <span className={`inline-flex items-center gap-1 ${login.is_active ? 'text-brand' : 'text-stone-400'}`} title="Login account (Users & Roles)">
          <KeyRound size={10} /> {login.email || 'Login'}{!login.is_active && ' (inactive)'}
        </span>
      )}
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
      .then(data => { if (data) setIdentities({ operators: data.operators ?? {}, logins: data.logins ?? {} }) })
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
          <h1 className="font-display font-bold text-[22px] text-text">Staff Directory</h1>
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
                              <IdentityBadges operator={identities.operators[e.id]} login={identities.logins[e.id]} />
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
                            {canEdit && (
                              <button onClick={() => setEditing(e)} title="Edit"
                                className="flex items-center px-2.5 py-3 text-stone-300 hover:text-brand transition-colors">
                                <Pencil size={14} />
                              </button>
                            )}
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
                              <IdentityBadges operator={identities.operators[e.id]} login={identities.logins[e.id]} />
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
                            {canEdit && (
                              <button onClick={() => setEditing(e)} title="Edit"
                                className="flex items-center px-2.5 py-3 text-stone-300 hover:text-brand transition-colors">
                                <Pencil size={14} />
                              </button>
                            )}
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

function EmployeeModal({ employee, leave, onClose, onSave, onAddLeave, onRemoveLeave }: {
  employee: Employee | null; leave: Leave[]
  onClose: () => void
  onSave: (emp: Partial<Employee>, id: string | null) => Promise<void>
  onAddLeave: (employeeId: string, l: { start: string; end: string; kind: string; reason: string }) => void
  onRemoveLeave: (id: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [name, setName] = useState(employee?.name ?? '')
  const [display, setDisplay] = useState(employee?.display_name ?? '')
  const [department, setDepartment] = useState(employee?.department ?? 'production')
  const [jobTitle, setJobTitle] = useState(employee?.job_title ?? '')
  const [position, setPosition] = useState(employee?.position ?? '')
  const [positionCode, setPositionCode] = useState(employee?.position_code ?? '')
  const [employeeCode, setEmployeeCode] = useState(employee?.employee_code ?? '')
  const [startDate, setStartDate] = useState(employee?.start_date ?? '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [skills, setSkills] = useState<string[]>(employee?.skills ?? [])
  const [active, setActive] = useState(employee?.active ?? true)
  const toggle = (c: string) => setSkills(s => s.includes(c) ? s.filter(x => x !== c) : [...s, c])

  // new-leave form
  const [lStart, setLStart] = useState('')
  const [lEnd, setLEnd] = useState('')
  const [lKind, setLKind] = useState('leave')
  const [lReason, setLReason] = useState('')
  const canAddLeave = employee && lStart && lEnd && lStart <= lEnd

  const valid = name.trim().length > 0

  async function handleSave() {
    if (!valid || saving) return
    setSaving(true); setSaveError(null)
    try {
      await onSave(
        { name, display_name: display, department, job_title: jobTitle,
          position, position_code: positionCode, employee_code: employeeCode,
          start_date: startDate || null, phone, skills, active },
        employee?.id ?? null
      )
      // success unmounts this modal (parent clears `editing`)
    } catch (e: any) {
      setSaveError(e?.message || 'Could not save this person')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[480px] my-8 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[16px] text-text">{employee ? 'Edit person' : 'Add person'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" className="col-span-2">
            <input value={name} onChange={e => setName(e.target.value)} className={INP} placeholder="e.g. Arnold Ndibongo" />
          </Field>
          <Field label="Display name">
            <input value={display} onChange={e => setDisplay(e.target.value)} className={INP} placeholder="optional" />
          </Field>
          <Field label="Department">
            <div className="relative">
              <select value={department} onChange={e => setDepartment(e.target.value)} className={`${INP} appearance-none pr-8 cursor-pointer`}>
                {DEPARTMENTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            </div>
          </Field>
          <Field label="Position">
            <input value={position} onChange={e => setPosition(e.target.value)} className={INP} placeholder="e.g. Sieving Tower Operator" />
          </Field>
          <Field label="Position code">
            <input value={positionCode} onChange={e => setPositionCode(e.target.value)} className={INP} placeholder="e.g. OPS-003" />
          </Field>
          <Field label="Job title">
            <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} className={INP} placeholder="e.g. Sieving Tower" />
          </Field>
          <Field label="Employee code">
            <input value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} className={INP} placeholder="e.g. EMP-042" />
          </Field>
          <Field label="Start date">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={INP} />
          </Field>
          <Field label="Phone (for WhatsApp)">
            <input value={phone} onChange={e => setPhone(e.target.value)} className={INP} placeholder="+27…" />
          </Field>
        </div>

        <Field label="Skills / certifications">
          <div className="flex flex-wrap gap-1">
            {SKILL_TAGS.map(t => {
              const on = skills.includes(t.code)
              return (
                <button key={t.code} type="button" onClick={() => toggle(t.code)} title={t.label}
                  className={`font-mono font-semibold text-[9px] px-1.5 py-1 rounded border transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-500 border-stone-200 hover:border-brand/40'}`}>
                  {t.code}
                </button>
              )
            })}
          </div>
        </Field>

        <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand" />
          Active (uncheck if the person has left the company)
        </label>

        {/* Leave — only for existing people (needs an id to attach to) */}
        {employee && (
          <div className="border-t border-stone-100 pt-3 space-y-2">
            <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide flex items-center gap-1.5"><Plane size={11} /> Leave &amp; availability</p>
            {leave.length > 0 && (
              <div className="space-y-1">
                {leave.map(l => (
                  <div key={l.id} className="flex items-center gap-2 text-[12px] text-text bg-stone-50 rounded-lg px-2.5 py-1.5">
                    <span className="capitalize font-medium">{l.kind}</span>
                    <span className="text-text-muted">{fmtD(l.start_date)} – {fmtD(l.end_date)}</span>
                    {l.reason && <span className="text-stone-400 truncate">· {l.reason}</span>}
                    <button onClick={() => onRemoveLeave(l.id)} className="ml-auto text-stone-300 hover:text-err"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={lStart} onChange={e => setLStart(e.target.value)} className={INP} />
              <input type="date" value={lEnd} onChange={e => setLEnd(e.target.value)} className={INP} />
              <div className="relative">
                <select value={lKind} onChange={e => setLKind(e.target.value)} className={`${INP} appearance-none pr-8 capitalize cursor-pointer`}>
                  {LEAVE_KINDS.map(k => <option key={k} value={k} className="capitalize">{k}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              </div>
              <input value={lReason} onChange={e => setLReason(e.target.value)} className={INP} placeholder="reason (optional)" />
            </div>
            <button disabled={!canAddLeave}
              onClick={() => { onAddLeave(employee.id, { start: lStart, end: lEnd, kind: lKind, reason: lReason }); setLStart(''); setLEnd(''); setLReason('') }}
              className="text-[12px] text-brand font-medium hover:underline disabled:opacity-40 disabled:no-underline">
              + Add leave period
            </button>
          </div>
        )}

        {/* Login account — only for existing people. Creating accounts is IT-only;
            everyone else raises a request that opens an Axis ticket to IT. */}
        {employee && (
          <LoginAccountBlock employeeId={employee.id} personName={employee.display_name || employee.name} />
        )}

        {saveError && (
          <p className="flex items-center gap-1.5 text-[12px] text-err"><AlertTriangle size={13} /> {saveError}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-40">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {employee ? 'Save changes' : 'Add person'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Login account for a staff member. Creating the account is IT-only (done at
// /users). Non-IT staff managers get a "Request login account" button that opens
// an Axis ticket routed to IT via /api/staff/[id]/request-login.
function LoginAccountBlock({ employeeId, personName }: { employeeId: string; personName: string }) {
  const { isIT } = useAuth()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [ticket, setTicket] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function request() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/staff/${employeeId}/request-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() || null, note: note.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not send the request')
      setTicket(data?.ticket_number || 'sent')
    } catch (e: any) {
      setErr(e?.message || 'Could not send the request')
    }
    setBusy(false)
  }

  return (
    <div className="border-t border-stone-100 pt-3 space-y-2">
      <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide flex items-center gap-1.5">
        <KeyRound size={11} /> Login account
      </p>

      {isIT ? (
        <p className="text-[12px] text-text-muted">
          Create or manage this person’s sign-in account in{' '}
          <Link href="/users" className="text-brand font-medium hover:underline">Users &amp; Roles →</Link>
        </p>
      ) : ticket ? (
        <p className="flex items-center gap-1.5 text-[12px] text-ok">
          <Check size={13} /> Request sent to IT{ticket !== 'sent' ? ` — ticket ${ticket}` : ''}. They’ll set up {personName}’s login.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-text-muted">
            Needs to sign in to the app? Request a login account and IT will create it.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input value={email} onChange={e => setEmail(e.target.value)} className={INP} placeholder="work email (optional)" />
            <input value={note} onChange={e => setNote(e.target.value)} className={INP} placeholder="note for IT (optional)" />
          </div>
          {err && <p className="text-[11px] text-err flex items-center gap-1"><AlertTriangle size={11} /> {err}</p>}
          <button onClick={request} disabled={busy}
            className="text-[12px] text-brand font-medium hover:underline disabled:opacity-40 disabled:no-underline">
            {busy ? 'Sending…' : '+ Request login account'}
          </button>
        </>
      )}
    </div>
  )
}

const INP = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}

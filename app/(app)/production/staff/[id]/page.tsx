'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO, differenceInYears, isPast } from 'date-fns'
import {
  ArrowLeft, Loader2, User, Phone, Plane, Calendar, Award,
  ClipboardList, ChevronDown, ChevronUp, History, AlertTriangle,
  Check, X, Edit2, KeyRound, IdCard, GraduationCap, Plus, CalendarClock,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { StaffTabs } from '@/components/production/StaffTabs'
import { SKILL_TAGS, tagLabel, categoryMeta } from '@/lib/production/roster-config'
import { SOP_AREAS, sopAreaMeta, statusMeta, COMPETENCY_STATUSES } from '@/lib/production/competency-config'
import type { CompetencyStatus } from '@/lib/production/competency-config'
import { SECTION_ORDER, sectionMeta } from '@/lib/production/capture-config'

const db = () => getDb().schema('production')

interface Employee {
  id: string; name: string; display_name: string | null
  department: string; job_title: string | null; position: string | null
  position_code: string | null; employee_code: string | null
  department_code: string | null; start_date: string | null
  years_of_service: number | null; skills: string[]; phone: string | null
  email: string | null; photo_url: string | null; active: boolean
}
interface Sop {
  id: string; doc_no: string; title: string; area: string
  revision: string | null; status: string; section_id: string | null; sort_order: number
}
interface Competency {
  id: string; sop_id: string; status: CompetencyStatus; raw_code: string | null
  score: number | null; training_completed: boolean; date_completed: string | null
  assessed_at: string | null; next_review: string | null; notes: string | null
}
interface HistoryRow {
  id: string; action: string; from_status: string | null; to_status: string | null
  from_score: number | null; to_score: number | null; changed_by_name: string | null
  note: string | null; created_at: string; sop_id: string
}
interface LinkedOperator {
  id: string; operator_code: string | null; role: string; section_ids: string[]; active: boolean
}
interface LinkedLogin {
  has_login?: boolean
  user_id?: string; email?: string | null; department?: string | null; role?: string | null
  is_active: boolean
}
interface Identities {
  operator: LinkedOperator | null
  login: LinkedLogin | null
  linksAvailable: boolean
}

const fmtDate = (d: string | null) => d ? format(parseISO(d + 'T12:00:00'), 'd MMM yyyy') : '—'

export default function StaffProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { p, isIT } = useAuth()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [sops, setSops] = useState<Sop[]>([])
  const [competencies, setCompetencies] = useState<Competency[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingComp, setEditingComp] = useState<{ sopId: string; comp: Competency | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set(SOP_AREAS.map(a => a.key)))
  const [showHistory, setShowHistory] = useState(false)
  const [identities, setIdentities] = useState<Identities | null>(null)
  const [assigningPin, setAssigningPin] = useState(false)
  const [requestingLogin, setRequestingLogin] = useState(false)
  const [requestSent, setRequestSent] = useState<string | null>(null)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [trainingCourses, setTrainingCourses] = useState<any[]>([])
  const [assigningTraining, setAssigningTraining] = useState(false)

  const canEdit = p('can_manage_competencies')
  const canAssignPin = p('can_reset_operator_pin')
  const canAssignTraining = p('can_assign_training')

  async function loadIdentities() {
    const res = await fetch(`/api/staff/${id}/identities`)
    if (res.ok) setIdentities(await res.json())
  }

  useEffect(() => {
    async function load() {
      const [empRes, sopRes, compRes, histRes] = await Promise.all([
        db().from('employees').select('*').eq('id', id).single(),
        db().from('sops').select('id,doc_no,title,area,revision,status,section_id,sort_order').eq('active', true).order('sort_order'),
        db().from('employee_competencies').select('id,sop_id,status,raw_code,score,training_completed,date_completed,assessed_at,next_review,notes').eq('employee_id', id),
        db().from('competency_history').select('id,action,from_status,to_status,from_score,to_score,changed_by_name,note,created_at,sop_id').eq('employee_id', id).order('created_at', { ascending: false }).limit(50),
      ])
      if (!empRes.data) { router.replace('/production/staff'); return }
      setEmployee(empRes.data as Employee)
      setSops((sopRes.data ?? []) as Sop[])
      setCompetencies((compRes.data ?? []) as Competency[])
      setHistory((histRes.data ?? []) as HistoryRow[])
      setLoading(false)
    }
    if (id) { load(); loadIdentities() }
  }, [id, router])

  const loadTraining = useCallback(() => {
    if (!id) return
    fetch(`/api/training/courses?employeeId=${id}`).then(r => r.json()).then(d => setTrainingCourses(d.courses ?? [])).catch(() => {})
  }, [id])

  useEffect(() => { loadTraining() }, [loadTraining])

  const compBySop = useMemo(() => {
    const m = new Map<string, Competency>()
    competencies.forEach(c => m.set(c.sop_id, c))
    return m
  }, [competencies])

  const sopByArea = useMemo(() => {
    const m = new Map<string, Sop[]>()
    sops.forEach(s => {
      const arr = m.get(s.area) ?? []
      arr.push(s)
      m.set(s.area, arr)
    })
    return m
  }, [sops])

  const sopById = useMemo(() => {
    const m = new Map<string, Sop>()
    sops.forEach(s => m.set(s.id, s))
    return m
  }, [sops])

  const summary = useMemo(() => {
    const total = competencies.length
    const competent = competencies.filter(c => c.status === 'competent').length
    return { total, competent }
  }, [competencies])

  const yearsOfService = useMemo(() => {
    if (employee?.start_date) return differenceInYears(new Date(), parseISO(employee.start_date))
    return employee?.years_of_service ?? null
  }, [employee])

  async function requestLogin() {
    setRequestingLogin(true); setIdentityError(null)
    try {
      const res = await fetch(`/api/staff/${id}/request-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not send the request')
      setRequestSent(data?.ticket_number || 'sent')
    } catch (e: any) {
      setIdentityError(e?.message || 'Could not send the request')
    }
    setRequestingLogin(false)
  }

  async function saveCompetency(sopId: string, patch: Partial<Competency>) {
    setSaving(true)
    const res = await fetch('/api/staff/competencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: id, sop_id: sopId, ...patch }),
    })
    if (res.ok) {
      const { competency, historyRow } = await res.json()
      setCompetencies(cs => {
        const idx = cs.findIndex(c => c.sop_id === sopId)
        return idx >= 0 ? cs.map((c, i) => i === idx ? competency : c) : [...cs, competency]
      })
      if (historyRow) setHistory(hs => [historyRow, ...hs])
    }
    setSaving(false)
    setEditingComp(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={22} className="animate-spin text-stone-300" />
      </div>
    )
  }
  if (!employee) return null

  const deptMeta = categoryMeta(employee.department)

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <Link href="/production/staff" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand mb-3">
          <ArrowLeft size={13} /> Staff & Skills
        </Link>
        <StaffTabs />
      </div>

      {/* Profile header */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-[20px] font-bold shrink-0"
            style={{ background: deptMeta.colorHex }}>
            {employee.photo_url
              ? <img src={employee.photo_url} alt="" className="w-14 h-14 rounded-xl object-cover" />
              : (employee.display_name || employee.name).charAt(0).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display font-bold text-[20px] text-text">{employee.display_name || employee.name}</h1>
              {!employee.active && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">Inactive</span>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[12px] text-text-muted flex-wrap">
              <span className="capitalize font-medium" style={{ color: deptMeta.colorHex }}>{deptMeta.label}</span>
              {(employee.position || employee.job_title) && <><span>·</span><span>{employee.position || employee.job_title}</span></>}
              {employee.position_code && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{employee.position_code}</span>}
              {employee.employee_code && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{employee.employee_code}</span>}
            </div>

            <div className="flex items-center gap-4 mt-2 text-[12px] text-text-muted flex-wrap">
              {employee.phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{employee.phone}</span>}
              {employee.email && <span>{employee.email}</span>}
              {yearsOfService !== null && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} />
                  {yearsOfService} {yearsOfService === 1 ? 'year' : 'years'} of service
                  {employee.start_date && ` (since ${fmtDate(employee.start_date)})`}
                </span>
              )}
            </div>

            {/* Skill/cert tags */}
            {employee.skills.length > 0 && (
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                {employee.skills.map(c => (
                  <span key={c} title={tagLabel(c)}
                    className="inline-flex items-center gap-1 font-mono font-semibold text-[9px] px-1.5 py-0.5 rounded border border-brand/20 bg-brand/8 text-brand">
                    <Award size={9} /> {c}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Competency summary */}
          <div className="text-right shrink-0">
            <div className="text-[28px] font-bold" style={{ color: summary.competent === summary.total && summary.total > 0 ? '#1A7A3C' : summary.competent === 0 ? '#9CA3AF' : '#B85C0A' }}>
              {summary.competent}<span className="text-[16px] text-stone-300">/{summary.total}</span>
            </div>
            <div className="text-[11px] text-text-muted">SOPs competent</div>
          </div>
        </div>
      </div>

      {/* How they sign in — PIN operator (Capture) + login account (Users & Roles)
          linked to this person. Summary badges up top match the same PIN/EMAIL
          language used on the Directory list; a prompt appears when neither is
          set up yet, so allocating a sign-in method is never a dead end. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-display font-semibold text-[15px] text-text">How they sign in</h2>
          <SignInBadge kind="PIN" set={!!identities?.operator} active={!!identities?.operator?.active} />
          <SignInBadge kind="EMAIL" set={!!identities?.login} active={!!identities?.login?.is_active} />
        </div>

        {!identities?.operator && !identities?.login && (canAssignPin || isIT || !requestSent) && (
          <div className="flex items-center gap-2 flex-wrap px-4 py-3 bg-warn-bg border border-warn/30 rounded-xl text-[12px] text-warn">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1 min-w-[160px]">No sign-in method set up yet — this person can&rsquo;t sign in to Capture or the app.</span>
            {canAssignPin && (
              <button onClick={() => setAssigningPin(true)} className="font-medium underline underline-offset-2 shrink-0">Assign a PIN</button>
            )}
            {isIT ? (
              <Link href={`/users?newFor=${employee.id}&name=${encodeURIComponent(employee.display_name || employee.name)}${employee.email ? `&email=${encodeURIComponent(employee.email)}` : ''}`}
                className="font-medium underline underline-offset-2 shrink-0">Set up EMAIL login →</Link>
            ) : requestSent ? (
              <span className="font-medium shrink-0">EMAIL login requested</span>
            ) : (
              <button onClick={requestLogin} disabled={requestingLogin} className="font-medium underline underline-offset-2 shrink-0 disabled:opacity-40">
                {requestingLogin ? 'Sending…' : 'Request EMAIL login'}
              </button>
            )}
          </div>
        )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* PIN operator */}
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide flex items-center gap-1.5">
            <IdCard size={11} /> PIN operator (Capture)
          </p>
          {identities?.operator ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] text-text">
                <span className="font-mono font-semibold">{identities.operator.operator_code || '—'}</span>
                <span className="text-text-muted"> · {identities.operator.section_ids.length} section{identities.operator.section_ids.length === 1 ? '' : 's'}</span>
                {!identities.operator.active && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">Inactive</span>}
              </div>
              {canAssignPin && (
                <Link href="/production/operators" className="text-[11px] text-brand font-medium hover:underline shrink-0">Manage →</Link>
              )}
            </div>
          ) : canAssignPin ? (
            <button onClick={() => setAssigningPin(true)}
              className="text-[12px] text-brand font-medium hover:underline">
              + Assign PIN &amp; sections
            </button>
          ) : (
            <p className="text-[12px] text-text-muted">No PIN assigned.</p>
          )}
        </div>

        {/* Login account */}
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide flex items-center gap-1.5">
            <KeyRound size={11} /> Login account (Users &amp; Roles)
          </p>
          {identities?.login ? (
            <div className="text-[12px] text-text">
              {isIT && identities.login.email ? (
                <>
                  <span>{identities.login.email}</span>
                  <span className="text-text-muted"> · {identities.login.role?.replace(/_/g, ' ') ?? '—'}</span>
                </>
              ) : (
                <span className="text-text-muted">Has a login account</span>
              )}
              {!identities.login.is_active && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">Inactive</span>}
              {isIT && (
                <Link href="/users" className="ml-2 text-[11px] text-brand font-medium hover:underline">Manage →</Link>
              )}
            </div>
          ) : isIT ? (
            <p className="text-[12px] text-text-muted">
              No login yet.{' '}
              <Link href={`/users?newFor=${employee.id}&name=${encodeURIComponent(employee.display_name || employee.name)}${employee.email ? `&email=${encodeURIComponent(employee.email)}` : ''}`}
                className="text-brand font-medium hover:underline">Create one →</Link>
            </p>
          ) : requestSent ? (
            <p className="flex items-center gap-1.5 text-[12px] text-ok">
              <Check size={13} /> Request sent to IT{requestSent !== 'sent' ? ` — ticket ${requestSent}` : ''}.
            </p>
          ) : (
            <button onClick={requestLogin} disabled={requestingLogin}
              className="text-[12px] text-brand font-medium hover:underline disabled:opacity-40 disabled:no-underline">
              {requestingLogin ? 'Sending…' : '+ Request login account'}
            </button>
          )}
          {identityError && <p className="text-[11px] text-err flex items-center gap-1"><AlertTriangle size={11} /> {identityError}</p>}
        </div>
      </div>
      </div>

      {/* Training portfolio — courses assigned/completed, feeding the competency matrix below.
          Shows for anyone who can assign training (so a course can be allocated straight from
          the profile) or whenever this person already has courses on record. */}
      {(canAssignTraining || trainingCourses.some(c => c.assignment || c.latest_attempt)) && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-[15px] text-text flex items-center gap-2">
              <GraduationCap size={15} /> Training portfolio
            </h2>
            {canAssignTraining && (
              <button onClick={() => setAssigningTraining(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
                <Plus size={12} /> Assign course
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {trainingCourses.filter(c => c.assignment || c.latest_attempt).map(c => {
              const due = c.assignment?.due_date as string | undefined
              const overdue = due && !c.latest_attempt?.passed && isPast(parseISO(due))
              return (
                <Link key={c.id} href={`/training/course/${c.slug}?as=${id}`}
                  className="flex items-center justify-between gap-2 text-[12px] px-3 py-2 rounded-xl hover:bg-surface transition-colors">
                  <span className="min-w-0">
                    <span className="text-text">{c.title}</span>
                    {due && (
                      <span className={`ml-2 inline-flex items-center gap-1 text-[10px] ${overdue ? 'text-err font-medium' : 'text-text-muted'}`}>
                        <CalendarClock size={10} /> Due {fmtDate(due)}{overdue ? ' · overdue' : ''}
                      </span>
                    )}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    c.latest_attempt?.passed ? 'bg-ok/15 text-ok'
                    : c.latest_attempt?.needs_review ? 'bg-warn/15 text-warn'
                    : c.assignment ? 'bg-azure/15 text-azure' : 'bg-stone-100 text-stone-400'
                  }`}>
                    {c.latest_attempt?.passed ? 'Completed' : c.latest_attempt?.needs_review ? 'Pending review' : c.assignment ? 'Assigned' : 'Available'}
                  </span>
                </Link>
              )
            })}
            {canAssignTraining && !trainingCourses.some(c => c.assignment || c.latest_attempt) && (
              <p className="text-[12px] text-text-muted px-1 py-1">No courses assigned yet — assign one to schedule training with a due date.</p>
            )}
          </div>
        </div>
      )}

      {/* Competency matrix by area */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-[15px] text-text flex items-center gap-2">
            <ClipboardList size={15} /> Competency by SOP
          </h2>
          <button onClick={() => setShowHistory(v => !v)}
            className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand transition-colors">
            <History size={13} />
            {showHistory ? 'Hide history' : 'View history'}
          </button>
        </div>

        {SOP_AREAS.filter(a => sopByArea.has(a.key)).map(area => {
          const areaSops = sopByArea.get(area.key) ?? []
          const expanded = expandedAreas.has(area.key)
          const areaComps = areaSops.map(s => compBySop.get(s.id)).filter(Boolean)
          const areaCompetent = areaComps.filter(c => c!.status === 'competent').length
          return (
            <div key={area.key} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors"
                onClick={() => setExpandedAreas(s => {
                  const n = new Set(s)
                  expanded ? n.delete(area.key) : n.add(area.key)
                  return n
                })}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: area.colorHex }} />
                  <span className="font-medium text-[13px] text-text">{area.label}</span>
                  <span className="text-[11px] text-text-muted">{areaSops.length} SOPs</span>
                </div>
                <div className="flex items-center gap-2">
                  {areaComps.length > 0 && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      areaCompetent === areaSops.length ? 'bg-ok/15 text-ok'
                      : areaCompetent === 0 ? 'bg-stone-100 text-stone-400'
                      : 'bg-warn/15 text-warn'
                    }`}>{areaCompetent}/{areaSops.length}</span>
                  )}
                  {expanded ? <ChevronUp size={14} className="text-stone-400" /> : <ChevronDown size={14} className="text-stone-400" />}
                </div>
              </button>

              {expanded && (
                <div className="border-t border-surface-rule">
                  {areaSops.map(sop => {
                    const comp = compBySop.get(sop.id)
                    const sm = statusMeta(comp?.status ?? 'not_started')
                    return (
                      <div key={sop.id}
                        className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-rule last:border-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium text-text truncate">{sop.title}</span>
                            <span className="font-mono text-[10px] text-stone-400">{sop.doc_no}</span>
                          </div>
                          {comp && (comp.date_completed || comp.assessed_at) && (
                            <div className="text-[11px] text-text-muted mt-0.5 flex items-center gap-2">
                              {comp.date_completed && <span>Completed {fmtDate(comp.date_completed)}</span>}
                              {comp.assessed_at && <span>· Assessed {fmtDate(comp.assessed_at)}</span>}
                              {comp.next_review && <span>· Review {fmtDate(comp.next_review)}</span>}
                            </div>
                          )}
                        </div>
                        {/* Status badge */}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sm.bgClass} ${sm.textClass} shrink-0`}>
                          {sm.short}
                        </span>
                        {/* Edit button */}
                        {canEdit && (
                          <button onClick={() => setEditingComp({ sopId: sop.id, comp: comp ?? null })}
                            className="text-stone-300 hover:text-brand transition-colors shrink-0">
                            <Edit2 size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Competency history */}
      {showHistory && history.length > 0 && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1.5">
            <History size={11} /> Competency history
          </h3>
          <div className="space-y-1.5">
            {history.map(h => {
              const sop = sopById.get(h.sop_id)
              return (
                <div key={h.id} className="flex items-start gap-2 text-[12px]">
                  <span className="text-stone-300 shrink-0 mt-0.5">{format(parseISO(h.created_at), 'd MMM yy')}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-text-muted truncate">{sop?.title ?? h.sop_id}</span>
                    {h.from_status !== h.to_status && (
                      <span className="ml-1.5 text-stone-400">
                        {statusMeta(h.from_status ?? 'not_started').short} → {statusMeta(h.to_status ?? 'not_started').short}
                      </span>
                    )}
                    {h.changed_by_name && <span className="ml-1.5 text-stone-400">by {h.changed_by_name}</span>}
                    {h.note && <span className="ml-1.5 text-stone-400">· {h.note}</span>}
                  </div>
                  <span className="text-[10px] font-mono text-stone-300 shrink-0 capitalize">{h.action.replace('_', ' ')}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Competency edit modal */}
      {editingComp && (
        <CompetencyEditModal
          sopId={editingComp.sopId}
          sop={sops.find(s => s.id === editingComp.sopId) ?? null}
          current={editingComp.comp}
          saving={saving}
          onClose={() => setEditingComp(null)}
          onSave={patch => saveCompetency(editingComp.sopId, patch)}
        />
      )}

      {/* Assign a training course + due date straight from the profile */}
      {assigningTraining && employee && (
        <AssignTrainingModal
          employeeId={employee.id}
          personName={employee.display_name || employee.name}
          onClose={() => setAssigningTraining(false)}
          onDone={() => { setAssigningTraining(false); loadTraining() }}
        />
      )}

      {/* Assign PIN + sections — creates a linked operator via /api/production/operators */}
      {assigningPin && employee && (
        <AssignPinModal
          employeeId={employee.id}
          defaultName={employee.display_name || employee.name}
          onClose={() => setAssigningPin(false)}
          onDone={() => { setAssigningPin(false); loadIdentities() }}
        />
      )}
    </div>
  )
}

function AssignTrainingModal({ employeeId, personName, onClose, onDone }: {
  employeeId: string; personName: string
  onClose: () => void
  onDone: () => void
}) {
  const [courses, setCourses] = useState<{ id: string; title: string; slug: string }[]>([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [courseId, setCourseId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Active courses only — the picker offers what someone can actually be assigned.
    fetch('/api/training/courses')
      .then(r => r.json())
      .then(d => setCourses(d.courses ?? []))
      .catch(() => setError('Could not load courses'))
      .finally(() => setLoadingCourses(false))
  }, [])

  async function assign() {
    if (!courseId) { setError('Pick a course'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/training/assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: courseId, employee_ids: [employeeId], due_date: dueDate || null, reason: reason || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not assign the course')
      onDone()
    } catch (e: any) {
      setError(e?.message || 'Could not assign the course')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[400px] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-[15px] text-text">Assign training</h3>
            <p className="text-[11px] text-text-muted mt-0.5">{personName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={15} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={LBL}>Course</label>
            <select value={courseId} onChange={e => setCourseId(e.target.value)} disabled={loadingCourses} className={INP + ' cursor-pointer'}>
              <option value="">{loadingCourses ? 'Loading…' : 'Select a course…'}</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className={LBL}>Training due date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={INP} />
          </div>
          <div>
            <label className={LBL}>Reason (optional)</label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Assigned to Sieving Tower line" className={INP} />
          </div>
        </div>

        {error && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-40">Cancel</button>
          <button onClick={assign} disabled={saving || loadingCourses}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Assign
          </button>
        </div>
      </div>
    </div>
  )
}

function AssignPinModal({ employeeId, defaultName, onClose, onDone }: {
  employeeId: string; defaultName: string
  onClose: () => void
  onDone: () => void
}) {
  const [pin, setPin] = useState('')
  const [sectionIds, setSectionIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleSection(sid: string) {
    setSectionIds(s => s.includes(sid) ? s.filter(x => x !== sid) : [...s, sid])
  }

  async function save() {
    if (!/^\d{4}$/.test(pin)) { setError('PIN must be exactly 4 digits'); return }
    if (sectionIds.length === 0) { setError('Assign at least one section'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/production/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: defaultName, role: 'floor_operator', section_ids: sectionIds, pin, employee_id: employeeId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not assign the PIN')
      onDone()
    } catch (e: any) {
      setError(e?.message || 'Could not assign the PIN')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[380px] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[15px] text-text">Assign PIN &amp; sections</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={15} /></button>
        </div>
        <p className="text-[12px] text-text-muted">{defaultName} will be able to sign in on the Capture floor app with this PIN. An operator code is assigned automatically.</p>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">4-digit PIN</label>
          <input value={pin} inputMode="numeric" maxLength={4}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[18px] font-mono tracking-[0.4em] text-center outline-none focus:border-brand"
            placeholder="••••" />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Allowed sections</label>
          <div className="flex flex-wrap gap-2">
            {SECTION_ORDER.map(sid => {
              const m = sectionMeta(sid)
              const on = sectionIds.includes(sid)
              return (
                <button key={sid} type="button" onClick={() => toggleSection(sid)}
                  className={`px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200'}`}>
                  {m.name}
                </button>
              )
            })}
          </div>
        </div>

        {error && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-40">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Assign
          </button>
        </div>
      </div>
    </div>
  )
}

function CompetencyEditModal({ sopId, sop, current, saving, onClose, onSave }: {
  sopId: string; sop: Sop | null; current: Competency | null; saving: boolean
  onClose: () => void
  onSave: (patch: Partial<Competency>) => void
}) {
  const [status, setStatus] = useState<CompetencyStatus>(current?.status ?? 'not_started')
  const [score, setScore] = useState(current?.score?.toString() ?? '')
  const [trainingCompleted, setTrainingCompleted] = useState(current?.training_completed ?? false)
  const [dateCompleted, setDateCompleted] = useState(current?.date_completed ?? '')
  const [assessedAt, setAssessedAt] = useState(current?.assessed_at ?? '')
  const [nextReview, setNextReview] = useState(current?.next_review ?? '')
  const [notes, setNotes] = useState(current?.notes ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[440px] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-[15px] text-text">Update competency</h3>
            {sop && <p className="text-[11px] text-text-muted mt-0.5">{sop.title} · {sop.doc_no}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={15} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={LBL}>Status</label>
            <div className="flex flex-wrap gap-1.5">
              {COMPETENCY_STATUSES.map(s => (
                <button key={s.status} type="button"
                  onClick={() => setStatus(s.status)}
                  className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                    status === s.status
                      ? `${s.bgClass} ${s.textClass} border-current`
                      : 'bg-white text-stone-400 border-stone-200 hover:border-stone-300'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LBL}>Score (0–1)</label>
              <input type="number" min="0" max="1" step="0.01" value={score} onChange={e => setScore(e.target.value)} className={INP} placeholder="e.g. 0.85" />
            </div>
            <div>
              <label className={LBL}>Date completed</label>
              <input type="date" value={dateCompleted} onChange={e => setDateCompleted(e.target.value)} className={INP} />
            </div>
            <div>
              <label className={LBL}>Assessed on</label>
              <input type="date" value={assessedAt} onChange={e => setAssessedAt(e.target.value)} className={INP} />
            </div>
            <div>
              <label className={LBL}>Next review</label>
              <input type="date" value={nextReview} onChange={e => setNextReview(e.target.value)} className={INP} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
            <input type="checkbox" checked={trainingCompleted} onChange={e => setTrainingCompleted(e.target.checked)} className="accent-brand" />
            Training completed
          </label>

          <div>
            <label className={LBL}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${INP} resize-none`} placeholder="Optional notes…" />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
          <button
            disabled={saving}
            onClick={() => onSave({
              status, score: score ? parseFloat(score) : undefined,
              training_completed: trainingCompleted,
              date_completed: dateCompleted || undefined,
              assessed_at: assessedAt || undefined,
              next_review: nextReview || undefined,
              notes: notes || undefined,
            })}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

const INP = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'
const LBL = 'block text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1'

// Same PIN/EMAIL badge language as the Directory list (components handle
// their own list separately — kept local rather than a shared import, same
// pattern this file already follows for its other small subcomponents).
function SignInBadge({ kind, set, active }: { kind: 'PIN' | 'EMAIL'; set: boolean; active: boolean }) {
  const Icon = kind === 'PIN' ? IdCard : KeyRound
  const cls = !set ? 'bg-stone-100 text-stone-400' : active ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>
      <Icon size={10} /> {kind}
    </span>
  )
}

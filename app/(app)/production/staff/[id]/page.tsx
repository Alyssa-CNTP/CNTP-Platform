'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO, differenceInYears, isPast } from 'date-fns'
import {
  ArrowLeft, Loader2, Phone, Calendar, Award,
  AlertTriangle, Check, X, KeyRound, IdCard, GraduationCap, Plus, CalendarClock, Pencil,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import SignaturePad from '@/components/ui/SignaturePad'
import { getMySignatureStatus, setEmployeeSignature, loadEmployeeSignature, getEmployeeSignatureStatus, SIGNATURE_CONSENT_TEXT_SELF, SIGNATURE_CONSENT_TEXT_ADMIN_SETUP } from '@/lib/production/employee-signature'
import { StaffTabs } from '@/components/production/StaffTabs'
import { EmployeeModal, type Leave } from '@/components/production/EmployeeModal'
import { tagLabel, categoryMeta } from '@/lib/production/roster-config'
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
interface LinkedOperator {
  id: string; operator_code: string | null; role: string; section_ids: string[]; active: boolean
}
interface LinkedLogin {
  has_login?: boolean
  user_id?: string; email?: string | null; department?: string | null; role?: string | null
  is_active: boolean
  sso?: boolean
}
interface Identities {
  operator: LinkedOperator | null
  labPin: { active: boolean; section_ids?: string[] } | null
  login: LinkedLogin | null
  linksAvailable: boolean
}

const fmtDate = (d: string | null) => d ? format(parseISO(d + 'T12:00:00'), 'd MMM yyyy') : '—'

const INP = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'
const LBL = 'block text-[10px] font-semibold text-stone-500 uppercase tracking-widest mb-1'

export default function StaffProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { p, isIT, user, role } = useAuth()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [leave, setLeave] = useState<Leave[]>([])
  const [identities, setIdentities] = useState<Identities | null>(null)
  const [assigningPin, setAssigningPin] = useState(false)
  const [requestingLogin, setRequestingLogin] = useState(false)
  const [requestSent, setRequestSent] = useState<string | null>(null)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [linkCandidates, setLinkCandidates] = useState<any[]>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [trainingCourses, setTrainingCourses] = useState<any[]>([])
  const [assigningTraining, setAssigningTraining] = useState(false)
  const [mySignatureEmployeeId, setMySignatureEmployeeId] = useState<string | null | undefined>(undefined)
  const [signature, setSignature] = useState<string | null>(null)
  const [otherHasSignature, setOtherHasSignature] = useState(false)
  const [signatureDraft, setSignatureDraft] = useState<string | null>(null)
  const [signatureConsent, setSignatureConsent] = useState(false)
  const [savingSignature, setSavingSignature] = useState(false)
  const [signatureError, setSignatureError] = useState<string | null>(null)

  const canEditProfile = p('can_edit_staff_profiles')
  const canAssignPin = p('can_reset_operator_pin')
  const canAssignTraining = p('can_assign_training')
  const isSelf = mySignatureEmployeeId === id
  // Self, or — TEMPORARY, while the platform is being set up — a developer.
  // No HR/admin permission bypass: a signature drawn by anyone other than its
  // owner is exactly what this platform must never allow long-term, since
  // every "Verify & Sign" flow downstream trusts whatever image is on file.
  const isSetupOverride = !isSelf && (role === 'senior_developer' || role === 'co_developer')
  const canEditSignature = isSelf || isSetupOverride

  async function loadIdentities() {
    const res = await fetch(`/api/staff/${id}/identities`)
    if (res.ok) setIdentities(await res.json())
  }

  // Manual login linking (IT): open a picker of unlinked accounts, link one to
  // this person by ID (the API suggests the likely name match), or unlink.
  async function openLinkPicker() {
    setLinking(true); setLinkLoading(true); setIdentityError(null)
    try {
      const r = await fetch(`/api/staff/${id}/link-login`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || 'Could not load accounts')
      setLinkCandidates(d.candidates ?? [])
    } catch (e: any) {
      setIdentityError(e?.message || 'Could not load accounts'); setLinking(false)
    } finally { setLinkLoading(false) }
  }
  async function linkLogin(userId: string) {
    setIdentityError(null)
    const r = await fetch(`/api/staff/${id}/link-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }),
    })
    if (r.ok) { setLinking(false); await loadIdentities() }
    else { const d = await r.json().catch(() => ({})); setIdentityError(d?.error || 'Could not link this login') }
  }
  async function unlinkLogin(userId: string) {
    if (!confirm('Unlink this login account from this person?')) return
    const r = await fetch(`/api/staff/${id}/link-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, unlink: true }),
    })
    if (r.ok) await loadIdentities()
    else { const d = await r.json().catch(() => ({})); setIdentityError(d?.error || 'Could not unlink') }
  }

  useEffect(() => {
    getMySignatureStatus().then(s => setMySignatureEmployeeId(s.employeeId))
  }, [])

  // Never fetch or render someone ELSE's actual signature image — only the
  // owner ever sees it. mySignatureEmployeeId !== undefined guards against
  // firing before we know who "self" even is (would otherwise briefly treat
  // the viewer's own profile as "someone else's" on first paint).
  useEffect(() => {
    if (!id || mySignatureEmployeeId === undefined) return
    if (isSelf) {
      loadEmployeeSignature(id).then(setSignature)
    } else {
      setSignature(null)
      if (isSetupOverride) getEmployeeSignatureStatus(id).then(s => setOtherHasSignature(s.hasSignature))
    }
  }, [id, isSelf, isSetupOverride, mySignatureEmployeeId])

  function signatureConsentText() {
    return isSelf
      ? SIGNATURE_CONSENT_TEXT_SELF
      : SIGNATURE_CONSENT_TEXT_ADMIN_SETUP(employee?.display_name || employee?.name || 'this employee')
  }

  async function saveSignature() {
    if (!signatureDraft || !signatureConsent) return
    setSavingSignature(true); setSignatureError(null)
    const res = await setEmployeeSignature(id, signatureDraft, signatureConsentText())
    if (res.ok) { setSignature(signatureDraft); setSignatureDraft(null); setSignatureConsent(false) }
    else setSignatureError(res.error ?? 'Could not save signature')
    setSavingSignature(false)
  }

  async function loadLeave() {
    const { data } = await db().from('employee_leave')
      .select('id,employee_id,start_date,end_date,kind,reason').eq('employee_id', id)
      .order('start_date', { ascending: false })
    setLeave((data as Leave[]) ?? [])
  }

  useEffect(() => {
    async function load() {
      const empRes = await db().from('employees').select('*').eq('id', id).single()
      if (!empRes.data) { router.replace('/production/staff'); return }
      setEmployee(empRes.data as Employee)
      setLoading(false)
    }
    if (id) { load(); loadIdentities(); loadLeave() }
  }, [id, router])

  // Save edits to this person (all the same fields as the Add form) + manage
  // their leave — the profile is now the single place to edit everything.
  async function saveProfile(emp: any) {
    const payload = {
      name: emp.name?.trim(), display_name: emp.display_name?.trim() || null,
      department: emp.department, job_title: emp.job_title?.trim() || null,
      skills: emp.skills ?? [], phone: emp.phone?.trim() || null, active: emp.active ?? true,
      position: emp.position?.trim() || null, position_code: emp.position_code?.trim() || null,
      employee_code: emp.employee_code?.trim() || null, start_date: emp.start_date || null,
    }
    const res = await fetch(`/api/staff/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Could not save this person')
    setEmployee(e => e ? { ...e, ...(data as Employee) } : e)
    setEditing(false)
  }
  async function addLeave(employeeId: string, l: { start: string; end: string; kind: string; reason: string }) {
    const { data } = await db().from('employee_leave').insert({
      employee_id: employeeId, start_date: l.start, end_date: l.end,
      kind: l.kind, reason: l.reason.trim() || null, created_by: user?.id ?? null,
    } as any).select('id,employee_id,start_date,end_date,kind,reason').single()
    if (data) setLeave(ls => [data as Leave, ...ls])
  }
  async function removeLeave(lid: string) {
    await db().from('employee_leave').delete().eq('id', lid)
    setLeave(ls => ls.filter(l => l.id !== lid))
  }

  const loadTraining = useCallback(() => {
    if (!id) return
    fetch(`/api/training/courses?employeeId=${id}`).then(r => r.json()).then(d => setTrainingCourses(d.courses ?? [])).catch(() => {})
  }, [id])

  useEffect(() => { loadTraining() }, [loadTraining])

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
        <div className="flex items-center justify-between gap-2 mb-3">
          <Link href="/production/staff" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
            <ArrowLeft size={13} /> Staff & Skills
          </Link>
          {canEditProfile && (
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] font-medium text-stone-600 hover:border-brand hover:text-brand transition-colors">
              <Pencil size={13} /> Edit details
            </button>
          )}
        </div>
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

        </div>
      </div>

      {/* How they sign in — PIN operator (Capture) + login account (Users & Roles)
          linked to this person. Summary badges up top match the same PIN/EMAIL
          language used on the Directory list; a prompt appears when neither is
          set up yet, so allocating a sign-in method is never a dead end. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-display font-semibold text-[15px] text-text">How they sign in</h2>
          <SignInBadge kind="PIN" set={!!identities?.operator || !!identities?.labPin} active={identities?.operator ? !!identities?.operator?.active : !!identities?.labPin?.active} />
          {identities?.login?.sso && <SSOBadge active={!!identities?.login?.is_active} />}
        </div>

        {!identities?.operator && !identities?.labPin && !identities?.login && (canAssignPin || isIT || !requestSent) && (
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
                <>
                  <Link href="/users" className="ml-2 text-[11px] text-brand font-medium hover:underline">Manage →</Link>
                  {identities.login.user_id && (
                    <button onClick={() => unlinkLogin(identities.login!.user_id!)} className="ml-2 text-[11px] text-stone-400 hover:text-err font-medium">Unlink</button>
                  )}
                </>
              )}
            </div>
          ) : isIT ? (
            <p className="text-[12px] text-text-muted">
              No login linked.{' '}
              <button onClick={openLinkPicker} className="text-brand font-medium hover:underline">Link an existing login →</button>
              <span className="text-stone-300"> · </span>
              <Link href={`/users?newFor=${employee.id}&name=${encodeURIComponent(employee.display_name || employee.name)}${employee.email ? `&email=${encodeURIComponent(employee.email)}` : ''}`}
                className="text-brand font-medium hover:underline">Create new →</Link>
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

      {/* Signature on file — drawn ONCE here, then reused everywhere a
          sign-off needs it (e.g. Pasteuriser job cards' "Verify & Sign").
          Self-service, or — TEMPORARY, while the platform is being set up —
          a developer acting on someone's behalf (isSetupOverride). Saving
          always requires an explicit consent tick, worded honestly for
          whichever case applies, fresh on every redraw. */}
      <div className="space-y-2">
        <h2 className="font-display font-semibold text-[15px] text-text">Signature on file</h2>
        {isSetupOverride && (
          <p className="text-[11px] text-warn">Setting this up on {employee?.display_name || employee?.name}'s behalf (developer setup override).</p>
        )}
        {signature && !signatureDraft ? (
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-surface-rule bg-white px-3 py-2">
              <img src={signature} alt="Signature on file" style={{ height: 36 }} />
            </div>
            {canEditSignature && (
              <button onClick={() => { setSignatureDraft('__redraw__'); setSignatureConsent(false) }} className="text-[12px] text-brand font-medium hover:underline">Redraw →</button>
            )}
          </div>
        ) : canEditSignature ? (
          <div className="space-y-2">
            {isSetupOverride && otherHasSignature && (
              <p className="text-[11px] text-warn">This person already has a signature on file — it can't be viewed here; drawing a new one below will replace it.</p>
            )}
            <SignaturePad label={isSelf ? 'Your signature' : `${employee?.display_name || employee?.name}'s signature`}
              name={employee?.display_name || employee?.name || 'Signature'}
              value={signatureDraft === '__redraw__' ? null : signatureDraft} onChange={setSignatureDraft} />
            {signatureDraft && signatureDraft !== '__redraw__' && (
              <label className="flex items-start gap-2 text-[11px] text-text-muted cursor-pointer">
                <input type="checkbox" checked={signatureConsent} onChange={e => setSignatureConsent(e.target.checked)} className="mt-0.5" />
                <span>{signatureConsentText()}</span>
              </label>
            )}
            <button onClick={saveSignature} disabled={!signatureDraft || signatureDraft === '__redraw__' || !signatureConsent || savingSignature}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-brand text-white disabled:opacity-40 disabled:cursor-not-allowed">
              {savingSignature ? 'Saving…' : 'Save signature'}
            </button>
            {signatureError && <p className="text-[11px] text-err flex items-center gap-1"><AlertTriangle size={11} /> {signatureError}</p>}
          </div>
        ) : (
          <p className="text-[12px] text-text-muted">
            {isSelf === false && mySignatureEmployeeId !== undefined
              ? 'Only this person can set up their own signature — it requires their own login.'
              : 'No signature on file yet.'}
          </p>
        )}
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

      {/* Edit everything about this person — the same form as "Add person". */}
      {editing && employee && (
        <EmployeeModal
          employee={employee as any}
          leave={leave}
          onClose={() => setEditing(false)}
          onSave={(emp) => saveProfile(emp)}
          onAddLeave={addLeave}
          onRemoveLeave={removeLeave}
        />
      )}

      {/* Link an existing login account to this person (IT) */}
      {linking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 overflow-y-auto" onClick={() => setLinking(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[460px] my-8 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-[16px] text-text">Link a login account</h3>
                <p className="text-[12px] text-text-muted mt-0.5">Pick the account that belongs to {employee?.display_name || employee?.name}. A suggested name match is highlighted.</p>
              </div>
              <button onClick={() => setLinking(false)} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={16} /></button>
            </div>
            {linkLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
            ) : linkCandidates.length === 0 ? (
              <p className="text-[12px] text-text-muted py-4 text-center">No unlinked login accounts available.</p>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto divide-y divide-stone-100 border border-stone-200 rounded-xl">
                {linkCandidates.map(c => (
                  <button key={c.user_id} onClick={() => linkLogin(c.user_id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-brand/5 ${c.suggested ? 'bg-brand/5' : ''}`}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-text truncate">{c.full_name || c.email || '(unnamed account)'}</span>
                      <span className="block text-[11px] text-text-muted truncate">{(c.role || '—').replace(/_/g, ' ')}{c.email ? ` · ${c.email}` : ''}{c.sso ? ' · Microsoft SSO' : ''}</span>
                    </span>
                    {c.suggested && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-brand/10 text-brand shrink-0">suggested</span>}
                  </button>
                ))}
              </div>
            )}
            {identityError && <p className="text-[11px] text-err flex items-center gap-1"><AlertTriangle size={11} /> {identityError}</p>}
          </div>
        </div>
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

function SignInBadge({ kind, set, active }: { kind: 'PIN' | 'EMAIL'; set: boolean; active: boolean }) {
  const Icon = kind === 'PIN' ? IdCard : KeyRound
  const cls = !set ? 'bg-stone-100 text-stone-400' : active ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>
      <Icon size={10} /> {kind}
    </span>
  )
}

// Microsoft SSO (orange) — only for genuine Azure-AD accounts.
function SSOBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${active ? 'bg-amber-100 text-amber-700' : 'bg-warn/15 text-warn'}`}
      title={`Microsoft SSO sign-in${active ? '' : ' — inactive'}`}>
      <KeyRound size={10} /> Microsoft
    </span>
  )
}

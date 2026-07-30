'use client'

// Shared Add/Edit person editor — used by the Staff Directory list ("Add person")
// and by each person's profile ("Edit"), so all fields are editable from either.
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { X, ChevronDown, Plane, Trash2, Check, Loader2, AlertTriangle, KeyRound } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { ROSTER_CATEGORIES, SKILL_TAGS } from '@/lib/production/roster-config'

export interface Employee {
  id: string; name: string; display_name: string | null
  department: string; job_title: string | null; skills: string[]
  phone: string | null; active: boolean
  position: string | null; position_code: string | null
  employee_code: string | null; start_date: string | null
}
export interface Leave {
  id: string; employee_id: string; start_date: string; end_date: string
  kind: string; reason: string | null
}

export const DEPARTMENTS = [
  ...ROSTER_CATEGORIES,
  { key: 'admin',      label: 'Admin',      colorHex: '#637056' },
  { key: 'laboratory', label: 'Laboratory', colorHex: '#1A7A3C' },
]
const LEAVE_KINDS = ['leave', 'sick', 'training', 'other']
export const fmtD = (d: string) => format(parseISO(d + 'T12:00:00'), 'd MMM')

const INP = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}

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

export function EmployeeModal({ employee, leave, onClose, onSave, onAddLeave, onRemoveLeave }: {
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

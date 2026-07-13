'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, Loader2, Plus, Pencil, UserCheck, UserX, X, Save, ShieldCheck, Trash2, Search, Eye, EyeOff,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SECTION_ORDER, sectionMeta } from '@/lib/production/capture-config'
import type { Operator } from '@/lib/supabase/database.types'

interface FormState {
  id?: string
  name: string
  section_ids: string[]
  pin: string
  active: boolean
  employeeId: string | null
  newPersonName: string
}

interface EmployeeOption {
  id: string; name: string; display_name: string | null; operator_id: string | null
}

const emptyForm = (): FormState => ({ name: '', section_ids: [], pin: '', active: true, employeeId: null, newPersonName: '' })

export default function OperatorsPage() {
  const router = useRouter()
  const { isSupervisor, isIT, role } = useAuth()
  const canManage = isSupervisor || isIT || role === 'admin'

  const [operators, setOperators] = useState<Operator[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState<FormState | null>(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [query,       setQuery]      = useState('')
  const [activeOnly,  setActiveOnly] = useState(true)
  const [revealedPin, setRevealedPin] = useState<string | null>(null)
  const [creatingPerson, setCreatingPerson] = useState(false)

  async function load() {
    const [opsRes, empRes] = await Promise.all([
      getDb().schema('production').from('operators').select('*').order('name'),
      getDb().schema('production').from('employees').select('id,name,display_name,operator_id').order('name'),
    ])
    setOperators((opsRes.data as Operator[]) ?? [])
    setEmployees((empRes.data as EmployeeOption[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function startAdd()  { setError(null); setCreatingPerson(false); setEditing(emptyForm()) }
  function startEdit(op: Operator) {
    setError(null); setCreatingPerson(false)
    setEditing({
      id: op.id, name: op.name, section_ids: op.section_ids ?? [], pin: op.pin ?? '', active: op.active,
      employeeId: (op as any).employee_id ?? null, newPersonName: '',
    })
  }

  function toggleSection(id: string) {
    setEditing(e => e ? {
      ...e,
      section_ids: e.section_ids.includes(id) ? e.section_ids.filter(s => s !== id) : [...e.section_ids, id],
    } : e)
  }

  async function save() {
    if (!editing) return
    if (!editing.name.trim())       { setError('Name is required'); return }
    if (!/^\d{4}$/.test(editing.pin)) { setError('PIN must be exactly 4 digits'); return }
    if (editing.section_ids.length === 0) { setError('Assign at least one section'); return }
    // New PINs must be tied to a Staff Directory person — either pick an
    // existing one or create it inline. Existing operators can be edited
    // without one (legacy records the migration didn't find a match for).
    if (!editing.id && !editing.employeeId && !editing.newPersonName.trim()) {
      setError('Select or create the Staff Directory person this PIN belongs to'); return
    }
    setSaving(true); setError(null)
    try {
      let employeeId = editing.employeeId
      if (!employeeId && editing.newPersonName.trim()) {
        const empRes = await fetch('/api/staff', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editing.newPersonName.trim(), department: 'production' }),
        })
        const empJson = await empRes.json()
        if (!empRes.ok) throw new Error(empJson.error ?? 'Could not create the staff record')
        employeeId = empJson.id
      }

      const payload = {
        id:          editing.id,
        name:        editing.name.trim(),
        role:        'floor_operator',     // display name + code are auto-assigned server-side
        section_ids: editing.section_ids,
        pin:         editing.pin,
        active:      editing.active,
        employee_id: employeeId,
      }
      const res = await fetch('/api/production/operators', {
        method:  editing.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setEditing(null)
      await load()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function toggleActive(op: Operator) {
    await fetch('/api/production/operators', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id: op.id, name: op.name, display_name: op.display_name,
        operator_code: op.operator_code, role: op.role,
        section_ids: op.section_ids, pin: op.pin, active: !op.active,
      }),
    }).catch(() => {})
    await load()
  }

  async function remove(op: Operator) {
    if (!confirm(`Remove ${op.display_name || op.name}? Their login will be deleted.`)) return
    await fetch(`/api/production/operators/${op.id}`, { method: 'DELETE' }).catch(() => {})
    await load()
  }

  const q = query.trim().toLowerCase()
  const filtered = operators
    .filter(op => !activeOnly || op.active)
    .filter(op => q === '' ||
      (op.display_name ?? '').toLowerCase().includes(q) ||
      op.name.toLowerCase().includes(q) ||
      (op.operator_code ?? '').toLowerCase().includes(q))

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-4">
        <ShieldCheck size={24} className="text-stone-400" />
        <p className="text-[14px] font-medium text-text">Supervisors and IT only</p>
        <button onClick={() => router.push('/production/capture')} className="text-[12px] text-brand hover:underline">← Back</button>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-[820px] space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/production/capture')} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400"><ChevronLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="font-semibold text-[22px] text-text leading-tight">Operators</h1>
          <p className="text-[12px] text-text-muted mt-0.5">Floor operators sign in with their name + 4-digit PIN. A code is assigned automatically. Supervisors are managed in Users &amp; Roles.</p>
        </div>
        <button onClick={startAdd} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white font-medium text-[13px] hover:bg-brand-mid transition-colors">
          <Plus size={15} /> Add operator
        </button>
      </div>

      {!loading && operators.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200 bg-white flex-1 min-w-[200px] focus-within:border-brand">
            <Search size={15} className="text-stone-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search operators by name…"
              className="flex-1 py-2.5 text-[13px] outline-none bg-transparent" />
          </div>
          <button onClick={() => setActiveOnly(a => !a)}
            className={`px-3 py-2.5 rounded-xl border text-[12px] font-medium transition-colors ${activeOnly ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200'}`}>
            {activeOnly ? 'Active only' : 'Showing all'}
          </button>
          <span className="text-[12px] text-text-muted font-mono">{filtered.length} / {operators.length}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 size={22} className="animate-spin text-text-muted" /></div>
      ) : operators.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-[13px] text-text-muted">
          No operators yet. Tap “Add operator” to create the first one.
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-[13px] text-text-muted">
          No operators match “{query}”.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(op => (
            <div key={op.id} className={`flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-2xl ${!op.active ? 'opacity-50' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                <span className="font-mono font-bold text-[11px] text-stone-600">{(op.operator_code || op.name).slice(0, 3).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14px] text-text flex items-center gap-2 flex-wrap">
                  {op.display_name || op.name}
                  {op.operator_code && <span className="text-[10px] font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{op.operator_code}</span>}
                  {!op.pin && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">No PIN</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {op.pin ? (
                    <>
                      <span className="font-mono text-[12px] text-text-muted tracking-widest">
                        {revealedPin === op.id ? op.pin : '••••'}
                      </span>
                      <button
                        onClick={() => setRevealedPin(revealedPin === op.id ? null : op.id ?? null)}
                        className="text-stone-400 hover:text-text p-0.5"
                        title={revealedPin === op.id ? 'Hide PIN' : 'Reveal PIN'}
                      >
                        {revealedPin === op.id ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <span className="text-[11px] text-text-faint">·</span>
                    </>
                  ) : null}
                  <span className="text-[11px] text-text-muted font-mono truncate">
                    {sectionSummary(op.section_ids ?? [])}
                  </span>
                </div>
              </div>
              <button onClick={() => toggleActive(op)} title={op.active ? 'Deactivate' : 'Activate'} className="p-2 text-stone-400 hover:text-text">
                {op.active ? <UserCheck size={16} className="text-ok" /> : <UserX size={16} />}
              </button>
              <button onClick={() => startEdit(op)} className="p-2 text-stone-400 hover:text-brand"><Pencil size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Edit / add modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
              <span className="font-semibold text-[16px] text-text">{editing.id ? 'Edit operator' : 'Add operator'}</span>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Full name *">
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className={INP} placeholder="e.g. John Smith" />
              </Field>

              <p className="text-[11px] text-text-muted leading-relaxed">
                Display name and operator code are assigned automatically. Supervisors are added in{' '}
                <a href="/users" className="text-brand hover:underline">Users &amp; Roles</a> (Production → Production Supervisor).
              </p>

              <Field label={editing.id ? 'Linked Staff Directory person' : 'Staff Directory person *'}>
                {!creatingPerson ? (
                  <>
                    <select
                      value={editing.employeeId ?? ''}
                      onChange={e => setEditing({ ...editing, employeeId: e.target.value || null })}
                      className={INP}
                    >
                      <option value="">
                        {editing.id ? '— not linked —' : 'Select a person…'}
                      </option>
                      {/* Include the currently-linked person even though they're
                          "linked" — otherwise editing this operator would show
                          them as missing from their own selection. */}
                      {employees
                        .filter(emp => !emp.operator_id || emp.id === editing.employeeId)
                        .map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.display_name || emp.name}</option>
                        ))}
                    </select>
                    <button type="button" onClick={() => setCreatingPerson(true)}
                      className="mt-1.5 text-[11px] text-brand font-medium hover:underline">
                      + Create a new person
                    </button>
                  </>
                ) : (
                  <>
                    <input value={editing.newPersonName}
                      onChange={e => setEditing({ ...editing, newPersonName: e.target.value })}
                      className={INP} placeholder="New person's full name" />
                    <button type="button" onClick={() => { setCreatingPerson(false); setEditing({ ...editing, newPersonName: '' }) }}
                      className="mt-1.5 text-[11px] text-text-muted font-medium hover:underline">
                      ← Pick an existing person instead
                    </button>
                  </>
                )}
                <p className="text-[10px] text-text-muted mt-1">
                  Every PIN belongs to one person in the Staff Directory — this keeps the Shift Roster and Capture in sync.
                </p>
              </Field>

              <Field label="4-digit PIN *">
                <input
                  value={editing.pin} inputMode="numeric" maxLength={4}
                  onChange={e => setEditing({ ...editing, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className={INP + ' font-mono tracking-[0.4em] text-center text-[18px]'} placeholder="••••"
                />
              </Field>

              <Field label="Allowed sections *">
                <div className="flex flex-wrap gap-2">
                  {SECTION_ORDER.map(id => {
                    const m = sectionMeta(id)
                    const on = editing.section_ids.includes(id)
                    return (
                      <button key={id} onClick={() => toggleSection(id)}
                        className={`px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200'}`}>
                        {m.name}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} className="w-4 h-4 accent-brand" />
                <span className="text-[13px] text-text">Active (can sign in)</span>
              </label>

              {error && <p className="text-[12px] text-err">{error}</p>}

              {editing.id && (
                <button onClick={() => { const e = editing; setEditing(null); remove({ id: e.id, name: e.name, section_ids: e.section_ids, pin: e.pin, active: e.active } as any) }}
                  className="flex items-center gap-1.5 text-[12px] text-err hover:underline">
                  <Trash2 size={13} /> Remove operator
                </button>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(null)} className="flex-1 py-3 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500">Cancel</button>
                <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {editing.id ? 'Save changes' : 'Create operator'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Collapse the per-section code list — operators rostered to every section show
// "All sections" instead of six codes, which kept the list noisy.
function sectionSummary(ids: string[]): string {
  if (!ids.length) return 'No sections'
  if (SECTION_ORDER.every(s => ids.includes(s))) return 'All sections'
  return ids.map(s => sectionMeta(s).code).join(' · ')
}

const INP = 'w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}

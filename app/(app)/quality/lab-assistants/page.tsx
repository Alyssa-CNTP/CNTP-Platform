'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, Plus, Pencil, UserCheck, UserX, X, Save, ShieldCheck, Search, KeyRound, Eye, EyeOff,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'

interface LabAssistant {
  user_id:    string | null
  full_name:  string
  pin:        string | null
  active:     boolean
}

interface FormState {
  full_name: string
  pin:       string
  is_active: boolean
  isNew:     boolean
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

export default function LabAssistantsPage() {
  const router = useRouter()
  const { role, isFullAdmin, isIT } = useAuth() as any
  const canManage = isFullAdmin || isIT || role === 'quality_manager' || role === 'lab_manager'

  const [assistants,  setAssistants]  = useState<LabAssistant[]>([])
  const [loading,     setLoading]     = useState(true)
  const [editing,     setEditing]     = useState<FormState | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [query,       setQuery]       = useState('')
  const [revealedPin, setRevealedPin] = useState<string | null>(null)

  async function load() {
    const res  = await fetch('/api/quality/lab-assistants/manage')
    const data = await res.json()
    setAssistants(Array.isArray(data) ? data : [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function startNew() {
    setError(null)
    setEditing({ full_name: '', pin: '', is_active: true, isNew: true })
  }

  function startEdit(asst: LabAssistant) {
    setError(null)
    setEditing({ full_name: asst.full_name, pin: '', is_active: asst.active, isNew: false })
  }

  async function save() {
    if (!editing) return
    if (editing.isNew && !editing.full_name.trim()) { setError('Name is required'); return }
    if (!/^\d{4}$/.test(editing.pin)) { setError('PIN must be exactly 4 digits'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/quality/lab-assistants', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ full_name: editing.full_name.trim(), pin: editing.pin }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setEditing(null)
      await load()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function toggleActive(asst: LabAssistant) {
    if (!asst.user_id) return
    await fetch('/api/quality/lab-assistants', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ full_name: asst.full_name, active: !asst.active }),
    }).catch(() => {})
    await load()
  }

  const q = query.trim().toLowerCase()
  const filtered = assistants.filter(a => q === '' || a.full_name.toLowerCase().includes(q))

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-4">
        <ShieldCheck size={24} className="text-stone-400" />
        <p className="text-[14px] font-medium text-text">Quality Manager, Lab Manager, and IT only</p>
        <button onClick={() => router.push('/quality/lab-results')} className="text-[12px] text-brand hover:underline">← Back</button>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-[820px] space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="font-semibold text-[22px] text-text leading-tight">Lab Assistant PINs</h1>
          <p className="text-[12px] text-text-muted mt-0.5">
            Lab assistants sign in at the tablet using their name and 4-digit PIN.
          </p>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium hover:bg-brand/90 transition"
        >
          <Plus size={15} /> Add assistant
        </button>
      </div>

      {!loading && assistants.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200 bg-white flex-1 min-w-[200px] focus-within:border-brand">
            <Search size={15} className="text-stone-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search assistants…"
              className="flex-1 py-2.5 text-[13px] outline-none bg-transparent" />
          </div>
          <span className="text-[12px] text-text-muted font-mono">{filtered.length} / {assistants.length}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 size={22} className="animate-spin text-text-muted" /></div>
      ) : assistants.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-[13px] text-text-muted">
          No lab assistants yet. Click <strong>Add assistant</strong> to create the first one.
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-[13px] text-text-muted">
          No assistants match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(asst => (
            <div key={asst.full_name} className={`flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-2xl ${!asst.active ? 'opacity-50' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                <span className="font-mono font-bold text-[11px] text-stone-600">
                  {asst.full_name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14px] text-text flex items-center gap-2 flex-wrap">
                  {asst.full_name}
                  {!asst.active && (
                    <span className="text-[10px] font-medium text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">Inactive</span>
                  )}
                </div>
                {/* PIN display with reveal toggle */}
                <div className="flex items-center gap-2 mt-0.5">
                  {asst.pin ? (
                    <>
                      <span className="font-mono text-[13px] text-text-muted tracking-widest">
                        {revealedPin === asst.full_name ? asst.pin : '••••'}
                      </span>
                      <button
                        onClick={() => setRevealedPin(revealedPin === asst.full_name ? null : asst.full_name)}
                        className="text-stone-400 hover:text-text p-0.5"
                        title={revealedPin === asst.full_name ? 'Hide PIN' : 'Reveal PIN'}
                      >
                        {revealedPin === asst.full_name ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">No PIN set</span>
                  )}
                </div>
              </div>
              {asst.user_id && (
                <button onClick={() => toggleActive(asst)} title={asst.active ? 'Deactivate' : 'Activate'} className="p-2 text-stone-400 hover:text-text">
                  {asst.active ? <UserCheck size={16} className="text-ok" /> : <UserX size={16} />}
                </button>
              )}
              <button onClick={() => startEdit(asst)} className="p-2 text-stone-400 hover:text-brand">
                <Pencil size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
              <span className="font-semibold text-[16px] text-text">
                {editing.isNew ? 'Add lab assistant' : `Change PIN — ${editing.full_name}`}
              </span>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              {editing.isNew && (
                <Field label="Full name *">
                  <input
                    value={editing.full_name}
                    autoFocus
                    onChange={e => setEditing({ ...editing, full_name: e.target.value })}
                    className={INP}
                    placeholder="e.g. Fatima Davids"
                  />
                </Field>
              )}

              <Field label="4-digit PIN *">
                <input
                  value={editing.pin}
                  inputMode="numeric"
                  maxLength={4}
                  autoFocus={!editing.isNew}
                  onChange={e => setEditing({ ...editing, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className={INP + ' font-mono tracking-[0.4em] text-center text-[18px]'}
                  placeholder="••••"
                />
              </Field>

              {error && <p className="text-[12px] text-err">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(null)} className="flex-1 py-3 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500">Cancel</button>
                <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  {editing.isNew ? 'Create & set PIN' : 'Save PIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

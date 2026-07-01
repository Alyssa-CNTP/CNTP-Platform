'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, Pencil, UserCheck, UserX, X, Save, ShieldCheck, Search, KeyRound,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'

interface Tech {
  full_name: string
  role:      string
  has_pin:   boolean
  is_active: boolean
  on_shift:  boolean
  user_id:   string | null
}

interface FormState {
  full_name: string
  pin:       string
  is_active: boolean
}

const ROLE_LABELS: Record<string, string> = {
  maintenance_tech: 'Tech',
  maintenance_asst: 'Asst',
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

export default function TechnicianPinsPage() {
  const router = useRouter()
  const { role, isFullAdmin, isIT } = useAuth() as any
  const canManage = isFullAdmin || isIT || role === 'maintenance_manager'

  const [techs,      setTechs]      = useState<Tech[]>([])
  const [loading,    setLoading]    = useState(true)
  const [editing,    setEditing]    = useState<FormState | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [query,      setQuery]      = useState('')
  const [activeOnly, setActiveOnly] = useState(true)

  async function load() {
    const res  = await fetch('/api/maintenance/technicians/manage')
    const data = await res.json()
    setTechs(Array.isArray(data) ? data : [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function startEdit(tech: Tech) {
    setError(null)
    setEditing({ full_name: tech.full_name, pin: '', is_active: tech.is_active })
  }

  async function save() {
    if (!editing) return
    if (!/^\d{4}$/.test(editing.pin)) { setError('PIN must be exactly 4 digits'); return }
    setSaving(true); setError(null)
    try {
      const res  = await fetch('/api/maintenance/technicians', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ person_name: editing.full_name, pin: editing.pin }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setEditing(null)
      await load()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function toggleActive(tech: Tech) {
    // Only works for provisioned techs (has user_id).
    if (!tech.user_id) return
    await fetch('/api/maintenance/technicians', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ person_name: tech.full_name, active: !tech.is_active }),
    }).catch(() => {})
    await load()
  }

  const q = query.trim().toLowerCase()
  const filtered = techs
    .filter(t => !activeOnly || t.is_active)
    .filter(t => q === '' || t.full_name.toLowerCase().includes(q))

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-4">
        <ShieldCheck size={24} className="text-stone-400" />
        <p className="text-[14px] font-medium text-text">Maintenance manager and IT only</p>
        <button onClick={() => router.push('/maintenance/job-cards')} className="text-[12px] text-brand hover:underline">← Back</button>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-[820px] space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="font-semibold text-[22px] text-text leading-tight">Technician PINs</h1>
          <p className="text-[12px] text-text-muted mt-0.5">
            Technicians sign in with their name + 4-digit PIN. Names are sourced from the shift roster.
          </p>
        </div>
      </div>

      {!loading && techs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200 bg-white flex-1 min-w-[200px] focus-within:border-brand">
            <Search size={15} className="text-stone-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search technicians…"
              className="flex-1 py-2.5 text-[13px] outline-none bg-transparent" />
          </div>
          <button onClick={() => setActiveOnly(a => !a)}
            className={`px-3 py-2.5 rounded-xl border text-[12px] font-medium transition-colors ${activeOnly ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200'}`}>
            {activeOnly ? 'Active only' : 'Showing all'}
          </button>
          <span className="text-[12px] text-text-muted font-mono">{filtered.length} / {techs.length}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 size={22} className="animate-spin text-text-muted" /></div>
      ) : techs.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-[13px] text-text-muted">
          No maintenance technicians found in the shift roster.
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-[13px] text-text-muted">
          No technicians match "{query}".
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(tech => (
            <div key={tech.full_name} className={`flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-2xl ${!tech.is_active ? 'opacity-50' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                <span className="font-mono font-bold text-[11px] text-stone-600">
                  {tech.full_name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14px] text-text flex items-center gap-2 flex-wrap">
                  {tech.full_name}
                  <span className="text-[10px] font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                    {ROLE_LABELS[tech.role] ?? tech.role}
                  </span>
                  {tech.on_shift && (
                    <span className="text-[10px] font-semibold text-brand bg-brand/10 px-1.5 py-0.5 rounded">On shift</span>
                  )}
                  {!tech.has_pin && (
                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">No PIN</span>
                  )}
                </div>
              </div>
              {tech.user_id && (
                <button onClick={() => toggleActive(tech)} title={tech.is_active ? 'Deactivate' : 'Activate'} className="p-2 text-stone-400 hover:text-text">
                  {tech.is_active ? <UserCheck size={16} className="text-ok" /> : <UserX size={16} />}
                </button>
              )}
              <button onClick={() => startEdit(tech)} className="p-2 text-stone-400 hover:text-brand">
                <Pencil size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
              <span className="font-semibold text-[16px] text-text">Set PIN — {editing.full_name}</span>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="4-digit PIN *">
                <input
                  value={editing.pin}
                  inputMode="numeric"
                  maxLength={4}
                  autoFocus
                  onChange={e => setEditing({ ...editing, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className={INP + ' font-mono tracking-[0.4em] text-center text-[18px]'}
                  placeholder="••••"
                />
              </Field>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={editing.is_active}
                  onChange={e => setEditing({ ...editing, is_active: e.target.checked })}
                  className="w-4 h-4 accent-brand" />
                <span className="text-[13px] text-text">Active (can sign in)</span>
              </label>

              {error && <p className="text-[12px] text-err">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(null)} className="flex-1 py-3 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500">Cancel</button>
                <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Save PIN
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

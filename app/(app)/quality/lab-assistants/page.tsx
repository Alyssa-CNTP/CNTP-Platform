'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, Pencil, UserCheck, UserX, X, ShieldCheck, Search, KeyRound, Eye, EyeOff,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { SECTION_ORDER, sectionMeta } from '@/lib/production/capture-config'

interface LabAssistant {
  full_name:   string
  role:        string
  has_pin:     boolean
  pin:         string | null
  section_ids: string[]
  is_active:   boolean
  user_id:     string | null
}

interface FormState {
  full_name:   string
  pin:         string
  section_ids: string[]
  is_active:   boolean
}

const ROLE_LABELS: Record<string, string> = {
  qc_supervisor:       'QC Supervisor',
  qc:                  'QC',
  lab_analyst:         'Lab Analyst',
  incoming_goods_qc:   'Incoming Goods QC',
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

  function startEdit(asst: LabAssistant) {
    setError(null)
    setEditing({ full_name: asst.full_name, pin: '', section_ids: asst.section_ids ?? [], is_active: asst.is_active })
  }

  function toggleSection(id: string) {
    setEditing(e => e ? {
      ...e,
      section_ids: e.section_ids.includes(id) ? e.section_ids.filter(s => s !== id) : [...e.section_ids, id],
    } : e)
  }

  async function save() {
    if (!editing) return
    if (editing.pin && !/^\d{4}$/.test(editing.pin)) { setError('PIN must be exactly 4 digits'); return }
    setSaving(true); setError(null)
    try {
      // Use POST to provision/update (idempotent), PATCH for sections-only update.
      if (editing.pin) {
        const res = await fetch('/api/quality/lab-assistants', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            full_name:   editing.full_name,
            pin:         editing.pin,
            section_ids: editing.section_ids,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Save failed')
      } else {
        // Sections-only update (no PIN change).
        const res = await fetch('/api/quality/lab-assistants', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            full_name:   editing.full_name,
            section_ids: editing.section_ids,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Save failed')
      }
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
      body:    JSON.stringify({ full_name: asst.full_name, active: !asst.is_active }),
    }).catch(() => {})
    await load()
  }

  const q = query.trim().toLowerCase()
  const filtered = assistants.filter(a => q === '' || a.full_name.toLowerCase().includes(q))

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center px-4">
        <ShieldCheck size={24} className="text-stone-400" />
        <p className="text-[14px] font-medium text-text">Quality Manager and Lab Manager only</p>
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
            Names are sourced from the shift roster. Assign a PIN and sections to each assistant so they can sign in at the tablet.
          </p>
        </div>
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
          No lab assistants found in the shift roster.
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-[13px] text-text-muted">
          No assistants match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(asst => (
            <div key={asst.full_name} className={`flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-2xl ${!asst.is_active ? 'opacity-50' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                <span className="font-mono font-bold text-[11px] text-stone-600">
                  {asst.full_name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14px] text-text flex items-center gap-2 flex-wrap">
                  {asst.full_name}
                  <span className="text-[10px] font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                    {ROLE_LABELS[asst.role] ?? asst.role}
                  </span>
                  {!asst.has_pin && (
                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">No PIN</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {asst.pin ? (
                    <>
                      <span className="font-mono text-[12px] text-text-muted tracking-widest">
                        {revealedPin === asst.full_name ? asst.pin : '••••'}
                      </span>
                      <button
                        onClick={() => setRevealedPin(revealedPin === asst.full_name ? null : asst.full_name)}
                        className="text-stone-400 hover:text-text p-0.5"
                        title={revealedPin === asst.full_name ? 'Hide PIN' : 'Reveal PIN'}
                      >
                        {revealedPin === asst.full_name ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      {asst.section_ids?.length > 0 && (
                        <>
                          <span className="text-[11px] text-text-faint">·</span>
                          <span className="text-[11px] text-text-muted font-mono">
                            {sectionSummary(asst.section_ids)}
                          </span>
                        </>
                      )}
                    </>
                  ) : asst.section_ids?.length > 0 ? (
                    <span className="text-[11px] text-text-muted font-mono">
                      {sectionSummary(asst.section_ids)}
                    </span>
                  ) : null}
                </div>
              </div>
              {asst.user_id && (
                <button onClick={() => toggleActive(asst)} title={asst.is_active ? 'Deactivate' : 'Activate'} className="p-2 text-stone-400 hover:text-text">
                  {asst.is_active ? <UserCheck size={16} className="text-ok" /> : <UserX size={16} />}
                </button>
              )}
              <button onClick={() => startEdit(asst)} className="p-2 text-stone-400 hover:text-brand">
                <Pencil size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
              <span className="font-semibold text-[16px] text-text">{editing.full_name}</span>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">

              <Field label="4-digit PIN (leave blank to keep current)">
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

              <Field label="Assigned sections">
                <div className="flex flex-wrap gap-2">
                  {SECTION_ORDER.map(id => {
                    const m = sectionMeta(id)
                    const on = editing.section_ids.includes(id)
                    return (
                      <button key={id} type="button" onClick={() => toggleSection(id)}
                        className={`px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200'}`}>
                        {m.name}
                      </button>
                    )
                  })}
                </div>
              </Field>

              {error && <p className="text-[12px] text-err">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(null)} className="flex-1 py-3 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500">Cancel</button>
                <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function sectionSummary(ids: string[]): string {
  if (!ids.length) return ''
  if (SECTION_ORDER.every(s => ids.includes(s))) return 'All sections'
  return ids.map(s => sectionMeta(s).code).join(' · ')
}

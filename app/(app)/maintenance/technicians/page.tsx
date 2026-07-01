'use client'

// app/(app)/maintenance/technicians/page.tsx
// Maintenance manager PIN management — view all technicians, set or reset PINs,
// toggle active status. Only visible to maintenance_manager and IT roles.

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { useRouter } from 'next/navigation'
import { Loader2, KeyRound, CheckCircle, XCircle, RefreshCw, Eye, EyeOff, ShieldCheck } from 'lucide-react'

interface Tech {
  user_id:      string
  full_name:    string
  role:         string
  is_active:    boolean
  has_pin:      boolean   // whether tech_auth row exists
  on_shift:     boolean
}

interface FormState {
  pin:    string
  saving: boolean
  error:  string
  done:   boolean
}

function initForm(): FormState { return { pin: '', saving: false, error: '', done: false } }

export default function TechnicianPinsPage() {
  const auth   = useRouter()
  const { role, department, isFullAdmin, isIT } = useAuth() as any
  const router = useRouter()

  const canManage = isFullAdmin || isIT || role === 'maintenance_manager'

  const [techs,   setTechs]   = useState<Tech[]>([])
  const [loading, setLoading] = useState(true)
  const [forms,   setForms]   = useState<Record<string, FormState>>({})
  const [showPin, setShowPin] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!canManage) { router.replace('/maintenance/job-cards'); return }
    fetchTechs()
  }, [canManage]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchTechs() {
    setLoading(true)
    try {
      const res  = await fetch('/api/maintenance/technicians/manage')
      const data = await res.json()
      if (Array.isArray(data)) {
        setTechs(data)
        const initial: Record<string, FormState> = {}
        data.forEach((t: Tech) => { initial[t.user_id] = initForm() })
        setForms(initial)
      }
    } finally {
      setLoading(false)
    }
  }

  function setField(userId: string, field: keyof FormState, value: any) {
    setForms(f => ({ ...f, [userId]: { ...f[userId], [field]: value } }))
  }

  async function savePin(tech: Tech) {
    const form = forms[tech.user_id]
    if (!form) return
    if (!/^\d{4}$/.test(form.pin)) {
      setField(tech.user_id, 'error', 'PIN must be exactly 4 digits')
      return
    }
    setField(tech.user_id, 'saving', true)
    setField(tech.user_id, 'error', '')

    const res  = await fetch('/api/maintenance/technicians', {
      method:  tech.has_pin ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: tech.user_id, pin: form.pin }),
    })
    const json = await res.json()

    if (!res.ok) {
      setField(tech.user_id, 'error',  json.error ?? 'Save failed')
      setField(tech.user_id, 'saving', false)
      return
    }

    setField(tech.user_id, 'saving', false)
    setField(tech.user_id, 'done',   true)
    setField(tech.user_id, 'pin',    '')
    setTechs(ts => ts.map(t => t.user_id === tech.user_id ? { ...t, has_pin: true } : t))
    setTimeout(() => setField(tech.user_id, 'done', false), 3000)
  }

  async function toggleActive(tech: Tech) {
    const next = !tech.is_active
    setTechs(ts => ts.map(t => t.user_id === tech.user_id ? { ...t, is_active: next } : t))
    await fetch('/api/maintenance/technicians', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: tech.user_id, active: next }),
    })
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="card p-8 flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-stone-300" />
        </div>
      </div>
    )
  }

  const onShift  = techs.filter(t => t.on_shift)
  const offShift = techs.filter(t => !t.on_shift)

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">Technician PINs</h1>
          <p className="text-sm text-text-muted mt-1">
            Set or reset 4-digit PINs for maintenance technician tablet login.
          </p>
        </div>
        <button onClick={fetchTechs} className="btn btn-ghost flex items-center gap-1.5 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {techs.length === 0 ? (
        <div className="card p-8 text-center text-sm text-text-muted">
          No maintenance technicians found in app_roles. Add them via the staff directory first.
        </div>
      ) : (
        <div className="space-y-6">
          {[{ label: 'On shift now', list: onShift }, { label: 'Off shift', list: offShift }].map(group =>
            group.list.length === 0 ? null : (
              <div key={group.label}>
                <p className="text-[11px] font-semibold text-text-faint uppercase tracking-wider mb-3">
                  {group.label}
                </p>
                <div className="space-y-3">
                  {group.list.map(tech => {
                    const form = forms[tech.user_id] ?? initForm()
                    const show = !!showPin[tech.user_id]
                    return (
                      <div key={tech.user_id} className={`card p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${!tech.is_active ? 'opacity-60' : ''}`}>
                        {/* Identity */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                            <span className="font-mono font-bold text-[13px] text-stone-600">
                              {tech.full_name.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-[15px] text-text truncate">{tech.full_name}</p>
                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                              <span className="text-[11px] text-text-muted">{tech.role}</span>
                              {tech.has_pin
                                ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-ok bg-ok/10 rounded-full px-2 py-0.5"><ShieldCheck size={10} /> PIN set</span>
                                : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-warn bg-warn/10 rounded-full px-2 py-0.5"><KeyRound size={10} /> No PIN</span>
                              }
                              {tech.on_shift && (
                                <span className="text-[10px] font-semibold text-brand bg-brand/10 rounded-full px-2 py-0.5 uppercase tracking-wide">On shift</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* PIN input */}
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <input
                              type={show ? 'text' : 'password'}
                              inputMode="numeric"
                              maxLength={4}
                              placeholder="New PIN"
                              value={form.pin}
                              onChange={e => {
                                const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                                setField(tech.user_id, 'pin', v)
                                setField(tech.user_id, 'error', '')
                                setField(tech.user_id, 'done', false)
                              }}
                              className="w-28 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px] font-mono text-center focus:outline-none focus:border-brand"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPin(s => ({ ...s, [tech.user_id]: !show }))}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-text"
                            >
                              {show ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                          <button
                            onClick={() => savePin(tech)}
                            disabled={form.saving || form.pin.length !== 4}
                            className="bg-brand text-white rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {form.saving
                              ? <Loader2 size={13} className="animate-spin" />
                              : form.done
                                ? <CheckCircle size={13} />
                                : <KeyRound size={13} />
                            }
                            {form.done ? 'Saved' : tech.has_pin ? 'Reset' : 'Set PIN'}
                          </button>
                        </div>

                        {/* Active toggle */}
                        <button
                          onClick={() => toggleActive(tech)}
                          title={tech.is_active ? 'Deactivate' : 'Activate'}
                          className={`shrink-0 rounded-lg px-3 py-2 text-[12px] font-semibold flex items-center gap-1.5 ${
                            tech.is_active
                              ? 'text-text-muted bg-stone-100 hover:bg-stone-200'
                              : 'text-ok bg-ok/10 hover:bg-ok/20'
                          }`}
                        >
                          {tech.is_active ? <XCircle size={13} /> : <CheckCircle size={13} />}
                          {tech.is_active ? 'Active' : 'Inactive'}
                        </button>

                        {/* Inline error */}
                        {form.error && (
                          <p className="w-full text-[12px] text-err sm:col-span-full">{form.error}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

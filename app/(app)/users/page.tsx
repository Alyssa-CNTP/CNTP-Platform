'use client'

// app/(app)/users/page.tsx

import { useEffect, useState, useCallback } from 'react'
import { useAuth }   from '@/lib/auth/context'
import {
  ALL_DEPARTMENTS, DEPARTMENT_META, DEPARTMENT_ROLES,
  PERMISSION_GROUPS, ROLE_PERMISSION_DEFAULTS,
  resolvePermission,
  type Department, type PermissionKey, type Permissions,
} from '@/lib/auth/permissions'
import { Plus, Trash2, KeyRound, RefreshCw, ChevronDown, ChevronUp, Check, Mail } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppUser {
  id:              string
  display_name:    string
  email:           string
  email_confirmed: boolean
  department:      Department | null
  role:            string | null
  section_id:      string | null
  permissions:     Permissions
  created_at:      string
  last_sign_in:    string | null
}

function fmt(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' })
}

function DeptBadge({ dept }: { dept: Department | null }) {
  if (!dept) return <span className="text-text-faint text-[10px]">—</span>
  const m = DEPARTMENT_META[dept]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${m.color}`}>{m.label}</span>
}

// ─── Permission toggle panel ──────────────────────────────────────────────────

function PermissionsPanel({ role, department, overrides, onChange, readOnly }: {
  role:       string | null
  department: Department | null
  overrides:  Permissions
  onChange:   (key: PermissionKey, value: boolean | null) => void
  readOnly?:  boolean
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const visibleGroups = PERMISSION_GROUPS.filter((g: typeof PERMISSION_GROUPS[number]) =>
    !g.department || g.department === department || department === 'IT'
  )

  function resolved(key: PermissionKey) {
    const defaultVal = resolvePermission(role, {}, key)
    if (key in overrides) return { value: overrides[key] === true, overridden: true, defaultVal }
    return { value: defaultVal, overridden: false, defaultVal }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-bold">Permission Overrides</span>
        <span className="text-[10px] text-text-faint">{Object.keys(overrides).length} override(s) from role default</span>
      </div>

      {visibleGroups.map(({ group, permissions }: typeof PERMISSION_GROUPS[number]) => {
        const keys     = permissions.map((p: { key: PermissionKey; label: string }) => p.key)
        const ovCount  = keys.filter((k: PermissionKey) => k in overrides).length
        const isOpen   = open[group] ?? false

        return (
          <div key={group} className="border border-surface-rule rounded-xl overflow-hidden">
            <button type="button" onClick={() => setOpen(p => ({ ...p, [group]: !p[group] }))}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-surface hover:bg-surface-card transition-colors text-left">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-[12px] text-text">{group}</span>
                {ovCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-warn/15 text-warn text-[9px] font-bold border border-warn/20">{ovCount} override{ovCount > 1 ? 's' : ''}</span>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3" onClick={e => e.stopPropagation()}>
                {!readOnly && <>
                  <button type="button" onClick={() => keys.forEach((k: PermissionKey) => onChange(k, true))} className="px-2 py-0.5 rounded text-[9px] font-semibold border border-ok/30 bg-ok/8 text-ok hover:bg-ok/15">All on</button>
                  <button type="button" onClick={() => keys.forEach((k: PermissionKey) => onChange(k, false))} className="px-2 py-0.5 rounded text-[9px] font-semibold border border-err/30 bg-err/8 text-err hover:bg-err/15">All off</button>
                  <button type="button" onClick={() => keys.forEach((k: PermissionKey) => onChange(k, null))} className="px-2 py-0.5 rounded text-[9px] font-semibold border border-surface-rule bg-surface text-text-muted hover:bg-surface-card">Reset</button>
                </>}
                {isOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
              </div>
            </button>

            {isOpen && (
              <div className="divide-y divide-surface-rule">
                {permissions.map(({ key, label }: { key: PermissionKey; label: string }) => {
                  const { value, overridden, defaultVal } = resolved(key)
                  return (
                    <div key={key} className={`flex items-center gap-3 px-4 py-2.5 ${overridden ? 'bg-warn/4' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-text">{label}</span>
                          {overridden && <span className="text-[9px] font-bold text-warn">{value ? '↑ granted' : '↓ revoked'}</span>}
                        </div>
                        <div className="font-mono text-[9px] text-text-faint mt-0.5">
                          {key} · default: <span className={defaultVal ? 'text-ok' : 'text-text-faint'}>{defaultVal ? 'on' : 'off'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {overridden && !readOnly && (
                          <button type="button" onClick={() => onChange(key, null)} className="text-[9px] px-1.5 py-0.5 rounded border border-surface-rule text-text-muted hover:text-text">reset</button>
                        )}
                        <button type="button" disabled={readOnly} onClick={() => !readOnly && onChange(key, !value)}
                          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${readOnly ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${value ? overridden ? 'bg-warn' : 'bg-ok' : overridden ? 'bg-err/60' : 'bg-surface-rule'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── User Modal ───────────────────────────────────────────────────────────────

function UserModal({ existing, onSave, onClose }: {
  existing?: AppUser | null; onSave: () => void; onClose: () => void
}) {
  const isEdit = !!existing
  const [tab,        setTab]        = useState<'details' | 'permissions'>('details')
  const [dept,       setDept]       = useState<Department>(existing?.department ?? 'Quality')
  const [role,       setRole]       = useState(existing?.role ?? '')
  const [customRole, setCustomRole] = useState('')
  const [useCustom,  setUseCustom]  = useState(false)
  const [email,      setEmail]      = useState(existing?.email ?? '')
  const [fullName,   setFullName]   = useState(existing?.display_name ?? '')
  const [password,   setPassword]   = useState('')
  const [sendInvite, setSendInvite] = useState(!isEdit)
  const [sectionId,  setSectionId]  = useState(existing?.section_id ?? '')
  const [overrides,  setOverrides]  = useState<Permissions>(existing?.permissions ?? {})
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const effectiveRole = useCustom ? customRole : role
  const overrideCount = Object.keys(overrides).length

  function handleDeptChange(d: Department) {
    setDept(d); setRole(DEPARTMENT_ROLES[d]?.[0]?.role ?? '')
    setUseCustom(false); setCustomRole(''); setOverrides({})
  }

  function handlePermChange(key: PermissionKey, value: boolean | null) {
    setOverrides((prev: Permissions) => {
      const next: Permissions = { ...prev }
      if (value === null) delete next[key]
      else next[key] = value
      return next
    })
  }

  async function handleSave() {
    if (!email.trim())         { setError('Email is required'); return }
    if (!email.includes('@'))  { setError('Enter a valid email address'); return }
    if (!effectiveRole.trim()) { setError('Role is required'); return }
    if (!isEdit && !sendInvite && (!password || password.length < 8)) {
      setError('Password must be at least 8 characters'); return
    }
    setSaving(true); setError('')

    const body: any = {
      department: dept,
      role:       effectiveRole.trim().toLowerCase().replace(/\s+/g, '_'),
      fullName:   fullName.trim() || undefined,
      sectionId:  sectionId.trim() || null,
      permissions: overrides,
    }
    if (!isEdit) {
      body.email = email.trim().toLowerCase()
      body.sendInvite = sendInvite
      if (!sendInvite) body.password = password
    } else {
      if (fullName !== existing?.display_name) body.fullName = fullName
    }

    const url    = isEdit ? `/api/admin/users/${existing!.id}` : '/api/admin/users'
    const method = isEdit ? 'PATCH' : 'POST'
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data   = await res.json()
    if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }
    onSave(); setSaving(false); onClose()
  }

  const presetRoles = DEPARTMENT_ROLES[dept] ?? []

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-2xl shadow-menu my-4">
        <div className="flex items-center justify-between px-6 py-4 bg-brand rounded-t-2xl">
          <div className="text-white font-bold text-[15px]">{isEdit ? `✏️ Edit — ${existing?.display_name}` : '👤 New User'}</div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white text-lg">×</button>
        </div>

        <div className="flex border-b border-surface-rule bg-surface">
          {(['details', 'permissions'] as const).map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-5 py-2.5 text-[12px] font-semibold border-b-2 transition-colors ${tab === k ? 'border-brand text-brand' : 'border-transparent text-text-muted hover:text-text'}`}>
              {k === 'permissions' ? `Permissions${overrideCount > 0 ? ` (${overrideCount})` : ''}` : 'Details & Role'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="px-4 py-2.5 bg-err/8 border border-err/20 rounded-xl text-[11px] text-err">⚠ {error}</div>}

          {tab === 'details' && <>
            {!isEdit && (
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Email Address *</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@rooibostea.co.za"
                  className="w-full px-3 py-2 border border-surface-rule rounded-lg font-mono text-[12px] text-text bg-surface-card outline-none focus:border-brand" />
              </div>
            )}

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Full Name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Monique van der Merwe"
                className="w-full px-3 py-2 border border-surface-rule rounded-lg font-mono text-[12px] text-text bg-surface-card outline-none focus:border-brand" />
            </div>

            {!isEdit && (
              <>
                <label className="flex items-center gap-3 cursor-pointer px-4 py-3 bg-surface rounded-xl border border-surface-rule">
                  <div className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${sendInvite ? 'bg-ok' : 'bg-surface-rule'}`} onClick={() => setSendInvite(s => !s)}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sendInvite ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-text flex items-center gap-1.5"><Mail size={12} /> Send invitation email</div>
                    <div className="text-[10px] text-text-muted">User clicks the link and sets their own password</div>
                  </div>
                </label>

                {!sendInvite && (
                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Password *</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters"
                      className="w-full px-3 py-2 border border-surface-rule rounded-lg font-mono text-[12px] text-text bg-surface-card outline-none focus:border-brand" />
                    <p className="mt-1 text-[10px] text-text-faint">Share securely. User can request a password reset from Settings.</p>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-2">Department *</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALL_DEPARTMENTS.map((d: Department) => {
                  const m = DEPARTMENT_META[d]
                  return (
                    <button key={d} type="button" onClick={() => !isEdit && handleDeptChange(d)} disabled={isEdit}
                      className={`px-3 py-2.5 rounded-xl border text-left transition-all disabled:opacity-60 disabled:cursor-not-allowed ${dept === d ? 'border-brand bg-brand/8 ring-1 ring-brand' : 'border-surface-rule hover:border-brand/30'}`}>
                      <div className="font-semibold text-[11px] text-text">{m.label}</div>
                      <div className="text-[9px] text-text-muted mt-0.5 leading-tight line-clamp-2">{m.desc}</div>
                    </button>
                  )
                })}
              </div>
              {isEdit && <p className="mt-1 text-[10px] text-text-faint">Department cannot be changed after creation.</p>}
            </div>

            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-2">Role *</label>
              <div className="space-y-1.5 mb-3">
                {presetRoles.map((r: { role: string; label: string; desc: string }) => (
                  <label key={r.role} className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${!useCustom && role === r.role ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-surface-rule hover:border-brand/30'}`}>
                    <input type="radio" name="role" checked={!useCustom && role === r.role} onChange={() => { setUseCustom(false); setRole(r.role); setOverrides({}) }} className="mt-0.5 accent-brand flex-shrink-0" />
                    <div>
                      <div className="font-semibold text-[12px] text-text">{r.label}</div>
                      <div className="text-[10px] text-text-muted mt-0.5">{r.desc}</div>
                    </div>
                  </label>
                ))}
                <label className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${useCustom ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-surface-rule hover:border-brand/30'}`}>
                  <input type="radio" name="role" checked={useCustom} onChange={() => setUseCustom(true)} className="mt-0.5 accent-brand flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-[12px] text-text mb-1">Custom role</div>
                    {useCustom
                      ? <input value={customRole} onChange={e => setCustomRole(e.target.value)} placeholder="e.g. senior_lab_technician" autoFocus
                          className="w-full px-3 py-1.5 border border-brand/40 rounded-lg font-mono text-[11px] text-text bg-surface-card outline-none focus:border-brand" />
                      : <div className="text-[10px] text-text-muted">Create a new role name — starts with all permissions off</div>}
                  </div>
                </label>
              </div>
            </div>

            {dept === 'Production' && (
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">Section ID <span className="text-text-faint font-normal">(optional)</span></label>
                <input value={sectionId} onChange={e => setSectionId(e.target.value)} placeholder="e.g. dryer_1"
                  className="w-full px-3 py-2 border border-surface-rule rounded-lg font-mono text-[12px] text-text bg-surface-card outline-none focus:border-brand" />
              </div>
            )}
          </>}

          {tab === 'permissions' && (
            <div>
              <div className="px-4 py-3 bg-info/5 border border-info/20 rounded-xl mb-4 text-[11px] text-info leading-relaxed">
                <strong>Department:</strong> {DEPARTMENT_META[dept]?.label} · <strong>Role:</strong> {effectiveRole || '—'}<br/>
                Green = on · Off = off · Orange = overridden from role default.
              </div>
              <PermissionsPanel role={effectiveRole || null} department={dept} overrides={overrides} onChange={handlePermChange} />
            </div>
          )}

          <div className="flex justify-between items-center gap-3 pt-2 border-t border-surface-rule">
            <span className="text-[10px] text-text-faint">{overrideCount > 0 ? `${overrideCount} override(s) from role default` : 'Using role defaults'}</span>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-6 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Reset Password Modal ─────────────────────────────────────────────────────

function ResetPasswordModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [done,   setDone]   = useState(false)

  async function sendReset() {
    setSaving(true); setError('')
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendPasswordReset: true }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed'); setSaving(false); return }
    setDone(true); setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-sm shadow-menu">
        <div className="flex items-center justify-between px-6 py-4 bg-warn rounded-t-2xl">
          <div className="text-white font-bold text-[14px]">🔑 Password Reset — {user.display_name}</div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          {done ? (
            <div className="text-center py-4">
              <div className="text-ok text-[28px] mb-2">✓</div>
              <div className="font-semibold text-ok">Reset email sent</div>
              <div className="text-[11px] text-text-muted mt-1">Sent to {user.email}</div>
              <button onClick={onClose} className="mt-4 px-6 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold">Done</button>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 bg-info/5 border border-info/20 rounded-xl text-[11px] text-info">
                A password reset link will be sent to <strong>{user.email}</strong>. The user clicks the link to set a new password. Supabase logs the change automatically.
              </div>
              {error && <div className="text-[11px] text-err">⚠ {error}</div>}
              <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
                <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
                <button onClick={sendReset} disabled={saving} className="px-6 py-2 rounded-xl bg-warn text-white text-[12px] font-semibold disabled:opacity-50">
                  {saving ? 'Sending…' : 'Send Reset Email'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { p, department: callerDept, userId: myId, loading: authLoading, permissionsReady, isIT } = useAuth()

  // These are derived from p() — only meaningful after authLoading is false
  const canCreate  = p('can_manage_users')
  const canEdit    = p('can_edit_permissions') || canCreate
  const canDelete  = p('can_manage_users')
  const canResetPw = p('can_reset_passwords')
  const canConfirm = p('can_confirm_emails')

  const [users,    setUsers]    = useState<AppUser[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [modal,    setModal]    = useState<'new' | AppUser | null>(null)
  const [resetFor, setResetFor] = useState<AppUser | null>(null)
  const [filterD,  setFilterD]  = useState<Department | ''>('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || `Error ${res.status}`)
        setLoading(false); return
      }
      setUsers(await res.json())
    } catch {
      setError('Network error — could not load users')
    }
    setLoading(false)
  }, [])

  // Load users once permissions are confirmed — no redirect, no race condition
  useEffect(() => {
    if (!permissionsReady) return
    if (canEdit) load()
  }, [permissionsReady, canEdit, load])

  async function confirmEmail(u: AppUser) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail: true }),
    })
    if (!res.ok) { alert('Failed to confirm email'); return }
    setUsers(p => p.map(x => x.id === u.id ? { ...x, email_confirmed: true } : x))
  }

  async function deleteUser(u: AppUser) {
    if (!confirm(`Delete "${u.display_name}" (${u.email})? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to delete user'); return }
    setUsers(p => p.filter(x => x.id !== u.id))
  }

  // Still loading auth or permissions
  if (authLoading || !permissionsReady) return (
    <div className="flex items-center justify-center h-full p-10">
      <div className="font-mono text-[11px] tracking-[2px] uppercase text-text-muted animate-pulse">Loading…</div>
    </div>
  )

  // Permissions loaded but no access — show denied message (no redirect/flicker)
  if (!canEdit) return (
    <div className="flex items-center justify-center h-full p-10">
      <div className="text-center">
        <div className="text-[32px] mb-3">🔒</div>
        <div className="font-semibold text-text mb-1">Access restricted</div>
        <div className="text-[12px] text-text-muted">You need user management permissions to view this page.</div>
      </div>
    </div>
  )

  const filtered = filterD ? users.filter(u => u.department === filterD) : users
  const depts    = [...new Set(users.map(u => u.department).filter(Boolean))] as Department[]

  return (
    <div className="p-5 max-w-6xl">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="font-display font-extrabold text-3xl text-text mb-1">Users & Access</h2>
          <p className="text-sm text-text-muted">
            {users.length} user{users.length !== 1 ? 's' : ''} across {depts.length} department{depts.length !== 1 ? 's' : ''}
            {callerDept && !isIT && <span className="ml-1 text-text-faint">· showing {callerDept} only</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {depts.length > 1 && (
            <select value={filterD} onChange={e => setFilterD(e.target.value as Department | '')}
              className="px-3 py-2 border border-surface-rule rounded-xl text-[12px] bg-surface-card text-text outline-none">
              <option value="">All departments</option>
              {depts.map(d => <option key={d} value={d}>{DEPARTMENT_META[d]?.label ?? d}</option>)}
            </select>
          )}
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px] hover:text-text">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {canCreate && (
            <button onClick={() => setModal('new')} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold">
              <Plus size={14} /> New User
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-3 bg-err/8 border border-err/20 rounded-xl text-[12px] text-err">⚠ {error}</div>}

      <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
        {loading && <div className="p-10 text-center text-text-muted text-[12px] animate-pulse">Loading users…</div>}

        {!loading && filtered.length === 0 && (
          <div className="p-10 text-center text-text-muted text-[12px]">
            No users yet{canCreate ? ' — click "New User" to add the first one' : ''}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr className="bg-surface border-b border-surface-rule">
                  {['User', 'Department', 'Role', 'Permissions', 'Email', 'Last login', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {filtered.map(u => {
                  const isMe     = u.id === myId
                  const ovCount  = Object.keys(u.permissions || {}).length
                  return (
                    <tr key={u.id} className="hover:bg-surface transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center font-bold text-[12px] text-brand flex-shrink-0">
                            {u.display_name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-text">{u.display_name}{isMe && <span className="ml-1.5 text-[9px] text-text-faint">(you)</span>}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-[10px] text-text-faint">{u.email}</span>
                              {!u.email_confirmed && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-warn/15 text-warn border border-warn/20 font-bold">unconfirmed</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><DeptBadge dept={u.department} /></td>
                      <td className="px-4 py-3"><span className="font-mono text-[11px] text-text">{u.role?.replace(/_/g, ' ') ?? '—'}</span></td>
                      <td className="px-4 py-3">
                        {ovCount > 0
                          ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20 font-semibold">{ovCount} override{ovCount > 1 ? 's' : ''}</span>
                          : <span className="text-[10px] text-text-faint">defaults</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {u.email_confirmed
                          ? <Check size={14} className="text-ok mx-auto" />
                          : canConfirm
                            ? <button onClick={() => confirmEmail(u)} className="text-[10px] px-2 py-0.5 rounded border border-warn/30 bg-warn/8 text-warn font-semibold hover:bg-warn/15">Confirm</button>
                            : <span className="text-warn text-[10px]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-text-muted whitespace-nowrap">{fmt(u.last_sign_in)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {canEdit && <button onClick={() => setModal(u)} title="Edit" className="p-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-brand hover:border-brand/30 transition-colors text-[11px]">✏️</button>}
                          {canResetPw && <button onClick={() => setResetFor(u)} title="Reset password" className="p-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-warn hover:border-warn/30 transition-colors"><KeyRound size={13} /></button>}
                          {canDelete && !isMe && <button onClick={() => deleteUser(u)} title="Delete" className="p-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-err hover:border-err/30 transition-colors"><Trash2 size={13} /></button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal === 'new' && <UserModal onSave={load} onClose={() => setModal(null)} />}
      {modal && modal !== 'new' && <UserModal existing={modal as AppUser} onSave={load} onClose={() => setModal(null)} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  )
}
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
  no_role?:        boolean   // auth user exists but no app_roles row
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
  const FONT = { fontFamily: 'Arial, -apple-system, BlinkMacSystemFont, sans-serif' }

  function resolved(key: PermissionKey) {
    const defaultVal = resolvePermission(role, {}, key)
    if (key in overrides) return { value: overrides[key] === true, overridden: true, defaultVal }
    return { value: defaultVal, overridden: false, defaultVal }
  }

  const totalOverrides = Object.keys(overrides).length

  const relevantGroups = PERMISSION_GROUPS.filter((g: any) =>
    !g.department || g.department === department
  )

  const permDesc: Record<string, string> = {
    can_delete_records:  'Permanently remove quality records',
    can_upload_pdfs:     'Upload PDFs and trigger AI data extraction',
    can_export_csv:      'Download data as spreadsheet',
    can_manage_users:    'Add, edit and delete platform users',
    can_reset_passwords: 'Send password reset emails',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ ...FONT, fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Permission Overrides
        </span>
        <span style={{ ...FONT, fontSize: 11, color: '#9CA3AF' }}>
          {totalOverrides} override{totalOverrides !== 1 ? 's' : ''} from role default
        </span>
      </div>

      {relevantGroups.map(({ group, permissions: perms }: typeof PERMISSION_GROUPS[number]) => {
        const keys    = perms.map((p: { key: PermissionKey; label: string }) => p.key)
        const ovCount = keys.filter((k: PermissionKey) => k in overrides).length
        const isOpen  = open[group] ?? false

        return (
          <div key={group} style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>

            {/* Group header — two rows to avoid overflow */}
            <div style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              {/* Row 1: name + badges */}
              <div
                role="button" tabIndex={0}
                onClick={() => setOpen(p => ({ ...p, [group]: !p[group] }))}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(p => ({ ...p, [group]: !p[group] }))}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 6px', cursor: 'pointer', userSelect: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...FONT, fontSize: 13, fontWeight: 600, color: '#111827' }}>{group}</span>
                  {ovCount > 0 && (
                    <span style={{ ...FONT, fontSize: 10, fontWeight: 700, color: '#D97706', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 20, padding: '1px 7px' }}>
                      {ovCount} override{ovCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {isOpen ? <ChevronUp size={14} style={{ color: '#9CA3AF', flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: '#9CA3AF', flexShrink: 0 }} />}
              </div>

              {/* Row 2: action buttons (separate click zone) */}
              {!readOnly && (
                <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px' }} onClick={e => e.stopPropagation()}>
                  <button type="button"
                    onClick={() => keys.forEach((k: PermissionKey) => onChange(k, true))}
                    style={{ ...FONT, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, border: '1px solid #86EFAC', background: '#F0FDF4', color: '#166534', cursor: 'pointer' }}>
                    All on
                  </button>
                  <button type="button"
                    onClick={() => keys.forEach((k: PermissionKey) => onChange(k, false))}
                    style={{ ...FONT, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}>
                    All off
                  </button>
                  <button type="button"
                    onClick={() => keys.forEach((k: PermissionKey) => onChange(k, null))}
                    style={{ ...FONT, fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: 'white', color: '#6B7280', cursor: 'pointer' }}>
                    Reset
                  </button>
                </div>
              )}
            </div>

            {/* Permission rows */}
            {isOpen && (
              <div>
                {perms.map(({ key, label }: { key: PermissionKey; label: string }) => {
                  const { value, overridden, defaultVal } = resolved(key)
                  const desc = permDesc[key as string] ?? null
                  return (
                    <div key={key} style={{
                      display: 'flex', alignItems: 'center',
                      padding: '10px 14px',
                      borderBottom: '1px solid #F3F4F6',
                      background: overridden ? (value ? '#F0FDF4' : '#FEF2F2') : 'white',
                    }}>
                      {/* Label column */}
                      <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ ...FONT, fontSize: 13, color: '#111827', fontWeight: 500 }}>{label}</span>
                          {overridden && (
                            <span style={{ ...FONT, fontSize: 10, fontWeight: 700, color: value ? '#166534' : '#DC2626' }}>
                              {value ? '↑ granted' : '↓ revoked'}
                            </span>
                          )}
                        </div>
                        {desc && (
                          <div style={{ ...FONT, fontSize: 11, color: '#6B7280', fontStyle: 'italic', marginTop: 1 }}>{desc}</div>
                        )}
                        <div style={{ ...FONT, fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                          {key} · default:{' '}
                          <span style={{ color: defaultVal ? '#16A34A' : '#9CA3AF', fontWeight: 500 }}>
                            {defaultVal ? 'on' : 'off'}
                          </span>
                        </div>
                      </div>

                      {/* Controls column — fixed width, never wraps */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {overridden && !readOnly && (
                          <button type="button"
                            onClick={() => onChange(key, null)}
                            style={{ ...FONT, fontSize: 10, padding: '2px 8px', borderRadius: 5, border: '1px solid #E5E7EB', background: 'white', color: '#6B7280', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            reset
                          </button>
                        )}
                        {/* Toggle */}
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => !readOnly && onChange(key, !value)}
                          style={{
                            position: 'relative', width: 40, height: 22, borderRadius: 11,
                            border: 'none', cursor: readOnly ? 'not-allowed' : 'pointer',
                            background: value ? '#16A34A' : '#D1D5DB',
                            opacity: readOnly ? 0.5 : 1,
                            transition: 'background 150ms',
                            flexShrink: 0,
                          }}
                          aria-checked={value}
                        >
                          <span style={{
                            position: 'absolute', top: 3, width: 16, height: 16,
                            borderRadius: '50%', background: 'white',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            transition: 'left 150ms',
                            left: value ? 21 : 3,
                          }} />
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

function UserModal({ existing, onSave, onClose, isAssignRole }: {
  existing?: AppUser | null; onSave: () => void; onClose: () => void; isAssignRole?: boolean
}) {
  const { isIT } = useAuth()
  const isEdit = !!existing && !isAssignRole
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
    // Email/password validation only applies when creating a brand-new user
    if (!isEdit && !isAssignRole) {
      if (!email.trim())         { setError('Email is required'); return }
      if (!email.includes('@'))  { setError('Enter a valid email address'); return }
      if (!sendInvite && (!password || password.length < 8)) {
        setError('Password must be at least 8 characters'); return
      }
    }
    if (!fullName.trim())      { setError('Full name is required'); return }
    if (!effectiveRole.trim()) { setError('Role is required'); return }
    if (dept === 'Production' && effectiveRole === 'section_operator' && !sectionId.trim()) {
      setError('Section is required for Section Operator'); return
    }
    setSaving(true); setError('')

    const body: any = {
      department:  dept,
      role:        effectiveRole.trim().toLowerCase().replace(/\s+/g, '_'),
      full_name:   fullName.trim(),
      fullName:    fullName.trim(),
      section_id:  sectionId.trim() || null,
      sectionId:   sectionId.trim() || null,
      permissions: overrides,
    }
    if (!isEdit && !isAssignRole) {
      body.email       = email.trim().toLowerCase()
      body.send_invite = sendInvite
      body.sendInvite  = sendInvite
      if (!sendInvite) body.password = password
    } else if (isEdit) {
      if (fullName !== existing?.display_name) body.fullName = fullName
      if (isIT && dept !== existing?.department) {
        body.department = dept
      }
    }

    // isAssignRole must use PATCH to /api/admin/users/:id (the INSERT-if-missing branch)
    // NOT POST to /api/admin/users (which creates a new auth user — wrong for existing users)
    const url    = (isEdit || isAssignRole) ? `/api/admin/users/${existing!.id}` : '/api/admin/users'
    const method = (isEdit || isAssignRole) ? 'PATCH' : 'POST'
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data   = await res.json()
    if (!res.ok) { setError(data.error || 'Save failed'); setSaving(false); return }
    onSave(); setSaving(false); onClose()
  }

  const presetRoles = DEPARTMENT_ROLES[dept] ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)' }}>
      <div style={{ background: 'white', borderRadius: 8, border: '1px solid #D0D0D0', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', width: '100%', maxWidth: 672 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F3F4F6', borderBottom: '1px solid #E0E0E0', padding: '16px 24px', borderRadius: '8px 8px 0 0' }}>
          <span style={{ fontFamily: 'Arial, -apple-system, sans-serif', fontSize: 15, fontWeight: 600, color: '#111827' }}>
            {isAssignRole ? `Assign role — ${existing?.display_name}` : isEdit ? `Edit — ${existing?.display_name}` : 'New User'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#6B7280', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E0E0E0', background: 'white' }}>
          {(['details', 'permissions'] as const).map(k => (
            <button key={k} onClick={() => setTab(k)} style={{
              fontFamily: 'Arial, -apple-system, sans-serif',
              fontSize: 13,
              fontWeight: 500,
              padding: '10px 20px',
              border: 'none',
              borderBottom: tab === k ? '2px solid #1A3A0E' : '2px solid transparent',
              color: tab === k ? '#1A3A0E' : '#6B7280',
              background: 'none',
              cursor: 'pointer',
              transition: 'color 150ms',
            }}>
              {k === 'permissions' ? `Permissions${overrideCount > 0 ? ` (${overrideCount})` : ''}` : 'Details & Role'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="px-4 py-2.5 bg-err/8 border border-err/20 rounded-xl text-[11px] text-err">⚠ {error}</div>}

          {tab === 'details' && <>
            {isAssignRole && (
              <div>
                <label style={{ display: 'block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 4 }}>Email Address</label>
                <div className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-surface cursor-default" style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#6B7280' }}>
                  {existing?.email ?? '—'}
                </div>
              </div>
            )}
            {!isEdit && !isAssignRole && (
              <div>
                <label style={{ display: 'block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 4 }}>Email Address *</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@rooibostea.co.za"
                  className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-surface-card outline-none focus:border-brand"
                  style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#111827' }} />
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 4 }}>Full Name *</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Alyssa Krishna"
                className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-surface-card outline-none focus:border-brand"
                style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#111827' }} />
            </div>

            {!isEdit && !isAssignRole && (
              <>
                <div
                  role="button" tabIndex={0}
                  onClick={() => setSendInvite(s => !s)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setSendInvite(s => !s)}
                  className="flex items-center gap-3 cursor-pointer px-4 py-3 bg-surface rounded-xl border border-surface-rule select-none">
                  <div className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${sendInvite ? 'bg-ok' : 'bg-surface-rule'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sendInvite ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-text flex items-center gap-1.5"><Mail size={12} /> Send invitation email</div>
                    <div className="text-[10px] text-text-muted">User clicks the link and sets their own password</div>
                  </div>
                </div>

                {!sendInvite && (
                  <div>
                    <label style={{ display: 'block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 4 }}>Password *</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters"
                      className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-surface-card outline-none focus:border-brand"
                      style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#111827' }} />
                    <p className="mt-1 text-[10px] text-text-faint">Share securely. User can request a password reset from Settings.</p>
                  </div>
                )}
              </>
            )}

            <div>
              <label style={{ display: 'block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 8 }}>Department *</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALL_DEPARTMENTS.map((d: Department) => {
                  const m = DEPARTMENT_META[d]
                  const isSelected = dept === d
                  return (
                    <button key={d} type="button" onClick={() => !(isEdit && !isIT) && handleDeptChange(d)} disabled={isEdit && !isIT}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: isSelected ? '2px solid #1A3A0E' : '1px solid #E0E0E0',
                        background: isSelected ? '#F0F7EC' : 'white',
                        textAlign: 'left',
                        cursor: (isEdit && !isIT) ? 'not-allowed' : 'pointer',
                        opacity: (isEdit && !isIT) ? 0.6 : 1,
                        transition: 'all 150ms',
                      }}>
                      <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 600, color: '#111827' }}>{m.label}</div>
                      <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.3 }}>{m.desc}</div>
                    </button>
                  )
                })}
              </div>
              {isEdit && !isIT && <p className="mt-1 text-[10px] text-text-faint">Department cannot be changed after creation.</p>}
              {dept === 'IT' && (
                <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: '#FEF3C7', border: '1px solid #FCD34D', display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 15 }}>⚠️</span>
                  <div>
                    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#92400E' }}>IT department bypasses all permission checks</div>
                    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#B45309', marginTop: 2, lineHeight: 1.4 }}>
                      Only assign this to developers or IT administrators. Any IT user has full unrestricted access to every module in the platform.
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 4 }}>Role Name *</label>
              <input
                value={useCustom ? customRole : role}
                onChange={e => { setUseCustom(true); setCustomRole(e.target.value) }}
                placeholder="e.g. senior_lab_technician or quality_default"
                className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-surface-card outline-none focus:border-brand"
                style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#111827' }}
              />
              <p className="mt-1 text-[10px] text-text-faint">Type any role name. Use the presets below as a starting point — clicking one fills the field and loads its default permissions.</p>
              {presetRoles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {presetRoles.map((r: { role: string; label: string; desc: string }) => {
                    const active = !useCustom && role === r.role
                    return (
                      <button key={r.role} type="button" title={r.desc}
                        onClick={() => { setUseCustom(false); setRole(r.role); setCustomRole(''); setOverrides({}) }}
                        style={{
                          fontFamily: 'Arial, sans-serif',
                          fontSize: 11,
                          border: '1px solid #D0D0D0',
                          borderRadius: 4,
                          padding: '4px 10px',
                          background: active ? '#1A3A0E' : 'white',
                          color: active ? 'white' : '#374151',
                          cursor: 'pointer',
                          transition: 'all 150ms',
                        }}>
                        {r.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {dept === 'Production' && (
              <div>
                <label style={{ display: 'block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#374151', marginBottom: 4 }}>
                  Section <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#9CA3AF' }}>(required for Section Operator)</span>
                </label>
                <select value={sectionId} onChange={e => setSectionId(e.target.value)}
                  className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-surface-card outline-none focus:border-brand"
                  style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#111827' }}>
                  <option value="">— None —</option>
                  {['sieving','refining1','refining2','granule','blender','pasteuriser'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}
          </>}

          {tab === 'permissions' && (
            <div>
              {/* Access Summary box */}
              <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
                  What this person will be able to access
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7280', marginBottom: 6 }}>Sidebar Modules</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {dept === 'IT' && ['Operations', 'Logistics', 'Quality', 'Sales', 'Management', 'AXIS'].map(m => (
                        <li key={m} style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#374151' }}>· {m}</li>
                      ))}
                      {dept === 'Production' && ['Operations', 'Logistics'].map(m => (
                        <li key={m} style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#374151' }}>· {m}</li>
                      ))}
                      {dept === 'Quality' && ['Quality', 'Operations'].map(m => (
                        <li key={m} style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#374151' }}>· {m}</li>
                      ))}
                      {dept === 'Sales' && ['Sales'].map(m => (
                        <li key={m} style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#374151' }}>· {m}</li>
                      ))}
                      {dept === 'Management' && ['Management', 'Sales (read)'].map(m => (
                        <li key={m} style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#374151' }}>· {m}</li>
                      ))}
                      {!['IT','Production','Quality','Sales','Management'].includes(dept) && (
                        <li style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#9CA3AF' }}>Select a department above</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7280', marginBottom: 6 }}>Action Permissions</div>
                    <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#374151', margin: 0, lineHeight: 1.5 }}>
                      {effectiveRole
                        ? <>Role <strong>{effectiveRole.replace(/_/g, ' ')}</strong> has {overrideCount > 0 ? `${overrideCount} override${overrideCount !== 1 ? 's' : ''} from` : 'the'} role defaults. You can override individual actions below.</>
                        : 'No role selected. Set a role on the Details tab to see default permissions.'}
                    </p>
                  </div>
                </div>
              </div>
              <PermissionsPanel role={effectiveRole || null} department={dept} overrides={overrides} onChange={handlePermChange} />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 12, borderTop: '1px solid #E0E0E0' }}>
            <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 10, color: '#9CA3AF' }}>{overrideCount > 0 ? `${overrideCount} override(s) from role default` : 'Using role defaults'}</span>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={onClose} style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 500, padding: '10px 20px', borderRadius: 6, border: '1px solid #D0D0D0', background: 'white', color: '#374151', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 500, padding: '10px 20px', borderRadius: 6, border: 'none', background: '#1A3A0E', color: 'white', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Saving…' : isAssignRole ? 'Assign Role' : isEdit ? 'Save Changes' : 'Create User'}
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)' }}>
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

  const [users,     setUsers]     = useState<AppUser[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [modal,     setModal]     = useState<'new' | AppUser | null>(null)
  const [resetFor,  setResetFor]  = useState<AppUser | null>(null)
  const [assignFor, setAssignFor] = useState<AppUser | null>(null)
  const [filterD,   setFilterD]   = useState<Department | ''>('')
  const [search,    setSearch]    = useState('')

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

  const filtered = (filterD ? users.filter(u => u.department === filterD) : users)
    .filter(u => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    })
    .slice()
    .sort((a, b) => {
      if (a.no_role && !b.no_role) return 1
      if (!a.no_role && b.no_role) return -1
      return 0
    })
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
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              fontFamily: 'Arial, -apple-system, sans-serif',
              fontSize: 12,
              background: 'white',
              border: '1px solid #E0E0E0',
              borderRadius: 6,
              padding: '7px 12px',
              color: '#111827',
              outline: 'none',
              minWidth: 220,
            }}
          />
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
                <tr style={{ background: '#F9FAFB', borderBottom: '1.5px solid #E5E7EB' }}>
                  {['User', 'Department', 'Role', 'Permissions', 'Email', 'Last Login', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6B7280', whiteSpace: 'nowrap' }}>{h}</th>
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
                            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 600, color: '#111827' }}>{u.display_name}{isMe && <span style={{ marginLeft: 6, fontSize: 10, color: '#9CA3AF', fontWeight: 400 }}>(you)</span>}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#6B7280' }}>{u.email}</span>
                              {!u.email_confirmed && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-warn/15 text-warn border border-warn/20 font-bold">unconfirmed</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {u.no_role
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border border-warn/30 bg-warn/10 text-warn">⚠ No role assigned</span>
                          : u.department === null
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border border-err/30 bg-err/10 text-err">Missing dept</span>
                            : <DeptBadge dept={u.department} />
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 600, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {u.role?.replace(/_/g, ' ') ?? '—'}
                        </span>
                      </td>
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
                          {u.no_role
                            ? canEdit && <button onClick={() => setAssignFor(u)} className="text-[10px] px-2 py-1 rounded-lg border border-warn/30 bg-warn/8 text-warn font-semibold hover:bg-warn/15">Assign →</button>
                            : <>
                                {canEdit && <button onClick={() => setModal(u)} title="Edit" className="p-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-brand hover:border-brand/30 transition-colors text-[11px]">✏️</button>}
                              </>
                          }
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
      {assignFor && <UserModal existing={assignFor} isAssignRole onSave={load} onClose={() => setAssignFor(null)} />}
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  )
}
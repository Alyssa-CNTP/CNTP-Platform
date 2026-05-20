'use client'
// app/(app)/settings/page.tsx

import { useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { DEPARTMENT_META } from '@/lib/auth/permissions'

export default function SettingsPage() {
  const { displayName, role, department, changePassword } = useAuth()

  const [current,  setCurrent]  = useState('')
  const [next,     setNext]     = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess(false)
    if (!current || !next || !confirm) { setError('All fields are required'); return }
    if (next !== confirm)              { setError('New passwords do not match'); return }
    if (next.length < 8)               { setError('Password must be at least 8 characters'); return }
    setSaving(true)
    const { error } = await changePassword(current, next)
    if (error) { setError(error); setSaving(false); return }
    setSuccess(true); setSaving(false)
    setCurrent(''); setNext(''); setConfirm('')
  }

  const deptMeta = department ? DEPARTMENT_META[department] : null

  return (
    <div className="p-5 max-w-lg">
      <div className="mb-6">
        <h2 className="font-display font-extrabold text-3xl text-text mb-1">Account Settings</h2>
        <div className="flex items-center gap-2 text-sm text-text-muted flex-wrap">
          <span>{displayName}</span>
          {deptMeta && (
            <span className={`badge border text-[10px] ${deptMeta.color}`}>{deptMeta.label}</span>
          )}
          {role && (
            <span className="badge border border-surface-rule text-text-muted text-[10px]">{role.replace(/_/g,' ')}</span>
          )}
        </div>
      </div>

      <div className="bg-surface-card border border-surface-rule rounded-2xl p-6">
        <h3 className="font-semibold text-[14px] text-text mb-4">Change Password</h3>
        <form onSubmit={handle} className="space-y-4">
          {error   && <div className="px-4 py-2.5 bg-err/8 border border-err/20 rounded-xl text-[12px] text-err">⚠ {error}</div>}
          {success && <div className="px-4 py-2.5 bg-ok/8 border border-ok/20 rounded-xl text-[12px] text-ok">✓ Password changed successfully</div>}

          {([
            ['Current password',     current, setCurrent, 'current-password'],
            ['New password',         next,    setNext,    'new-password'],
            ['Confirm new password', confirm, setConfirm, 'new-password'],
          ] as const).map(([label, value, setter, ac]) => (
            <div key={label}>
              <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">{label}</label>
              <input type="password" value={value} onChange={e => setter(e.target.value)}
                autoComplete={ac} placeholder="••••••••"
                className="w-full px-3 py-2.5 border border-surface-rule rounded-xl font-mono text-[12px] text-text bg-surface-card outline-none focus:border-brand" />
            </div>
          ))}

          <button type="submit" disabled={saving}
            className="w-full py-2.5 rounded-xl bg-brand text-white text-[12px] font-semibold disabled:opacity-50">
            {saving ? 'Changing password…' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
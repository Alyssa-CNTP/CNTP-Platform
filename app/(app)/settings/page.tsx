'use client'
// app/(app)/settings/page.tsx

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { DEPARTMENT_META } from '@/lib/auth/permissions'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/context'
import { LANGUAGES, LANGUAGE_META } from '@/lib/i18n/translations'
import { getDb } from '@/lib/supabase/db'

// ─── Theme helpers ────────────────────────────────────────────────────────────

type ThemeChoice = 'light' | 'dark' | 'system'

function applyTheme(t: ThemeChoice) {
  if (t === 'dark') {
    document.documentElement.dataset.theme = 'dark'
  } else if (t === 'light') {
    document.documentElement.dataset.theme = 'light'
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light'
  }
}

// ─── Settings page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { displayName, role, department, user, changePassword, initials } = useAuth()
  const { lang, setLang } = useLanguage()

  // ── Appearance state ──
  const [theme, setTheme] = useState<ThemeChoice>('system')

  useEffect(() => {
    // Read from localStorage first for instant render, then sync from Supabase
    try {
      const local = (localStorage.getItem('cntp_theme') || 'system') as ThemeChoice
      setTheme(local)
      applyTheme(local)
    } catch {}
    async function loadFromDb() {
      try {
        const db = getDb()
        const { data: { user } } = await db.auth.getUser()
        if (!user) return
        const { data } = await db
          .schema('shared' as any)
          .from('user_preferences')
          .select('theme')
          .eq('user_id', user.id)
          .maybeSingle()
        const saved = (data as any)?.theme as ThemeChoice | null
        if (saved) { setTheme(saved); applyTheme(saved); localStorage.setItem('cntp_theme', saved) }
      } catch {}
    }
    loadFromDb()
  }, [])

  async function handleThemeChange(t: ThemeChoice) {
    setTheme(t)
    applyTheme(t)
    // Write to both localStorage (for FOUC prevention on next load) and Supabase
    try { localStorage.setItem('cntp_theme', t) } catch {}
    try {
      const db = getDb()
      const { data: { user } } = await db.auth.getUser()
      if (!user) return
      await db
        .schema('shared' as any)
        .from('user_preferences')
        .upsert({ user_id: user.id, theme: t, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    } catch {}
  }

  // ── Password change state ──
  const [current,  setCurrent]  = useState('')
  const [next,     setNext]     = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [pwError,  setPwError]  = useState('')
  const [pwOk,     setPwOk]     = useState(false)

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPwError(''); setPwOk(false)
    if (!current || !next || !confirm) { setPwError('All fields are required'); return }
    if (next !== confirm)              { setPwError('New passwords do not match'); return }
    if (next.length < 8)              { setPwError('Password must be at least 8 characters'); return }
    setSaving(true)
    const { error } = await changePassword(current, next)
    if (error) { setPwError(error); setSaving(false); return }
    setPwOk(true); setSaving(false)
    setCurrent(''); setNext(''); setConfirm('')
  }

  const deptMeta = department ? DEPARTMENT_META[department] : null

  const CARD = 'rounded-2xl border border-surface-rule bg-surface-card shadow-sm p-5'
  const SECTION_HEADER = 'font-mono text-[10px] uppercase tracking-widest text-text-muted font-bold mb-4'

  const themeOptions: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { value: 'light',  label: 'Light',  Icon: Sun },
    { value: 'dark',   label: 'Dark',   Icon: Moon },
    { value: 'system', label: 'System', Icon: Monitor },
  ]

  return (
    <div className="px-4 py-6 space-y-6 max-w-2xl">

      {/* Page title */}
      <div>
        <h2 className="font-display font-extrabold text-3xl text-text mb-1">Settings</h2>
        <p className="text-sm text-text-muted">{displayName}</p>
      </div>

      {/* ── Section A: Profile ─────────────────────────────────────────────── */}
      <div className={CARD}>
        <p className={SECTION_HEADER}>Profile</p>
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-14 h-14 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center font-bold text-[18px] text-brand flex-shrink-0">
            {initials}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <p className="font-semibold text-[15px] text-text leading-tight">{displayName}</p>
              <p className="font-mono text-[11px] text-text-muted mt-0.5">{user?.email ?? '—'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {deptMeta && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${deptMeta.color}`}>
                  {deptMeta.label}
                </span>
              )}
              {role && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border border-surface-rule text-text-muted bg-surface">
                  {role.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {user?.last_sign_in_at && (
              <p className="text-[10px] text-text-faint">
                Last sign in: {new Date(user.last_sign_in_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Section B: Appearance ──────────────────────────────────────────── */}
      <div className={CARD}>
        <p className={SECTION_HEADER}>Appearance</p>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map(({ value, label, Icon }) => {
            const selected = theme === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => handleThemeChange(value)}
                className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all ${
                  selected
                    ? 'border-brand bg-brand/8 ring-1 ring-brand'
                    : 'border-surface-rule hover:border-brand/30 bg-surface-card'
                }`}
              >
                <Icon size={20} className={selected ? 'text-brand' : 'text-text-muted'} />
                <span className={`text-[11px] font-semibold ${selected ? 'text-brand' : 'text-text-muted'}`}>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Section B2: Language ──────────────────────────────────────────── */}
      <div className={CARD}>
        <p className={SECTION_HEADER}>Language · Taal · Ulimi</p>
        <p className="text-[11px] text-text-muted mb-4">
          Choose the language for production form labels. Technical codes (serial numbers, lot numbers, product codes) stay in English.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {LANGUAGES.map(l => {
            const meta = LANGUAGE_META[l]
            const selected = lang === l
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all ${
                  selected
                    ? 'border-brand bg-brand/8 ring-1 ring-brand'
                    : 'border-surface-rule hover:border-brand/30 bg-surface-card'
                }`}
              >
                <span className="text-[22px]">🇿🇦</span>
                <div className="text-center">
                  <p className={`text-[11px] font-bold ${selected ? 'text-brand' : 'text-text'}`}>{meta.nativeName}</p>
                  {meta.label !== meta.nativeName && (
                    <p className="text-[9px] text-text-muted mt-0.5">{meta.label}</p>
                  )}
                </div>
                {selected && (
                  <span className="w-4 h-4 rounded-full bg-brand flex items-center justify-center">
                    <span className="text-white text-[9px] font-bold">✓</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {lang !== 'en' && (
          <div className="mt-3 px-3 py-2.5 bg-brand/5 border border-brand/20 rounded-xl">
            <p className="text-[11px] text-brand font-semibold">
              {lang === 'af' && '✓ Afrikaans is gekies. Produksie vorms sal in Afrikaans vertoon.'}
              {lang === 'zu' && '✓ IsiZulu ikhethiwe. Izindlela zokukhiqiza zizokhombiswa ngesiZulu.'}
              {lang === 'xh' && '✓ IsiXhosa ikhethiwe. Iifom zokuvelisa ziya kuboniswa ngesiXhosa.'}
            </p>
          </div>
        )}
      </div>

      {/* ── Section C: Security ────────────────────────────────────────────── */}
      <div className={CARD}>
        <p className={SECTION_HEADER}>Security</p>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          {pwError && (
            <div className="px-4 py-2.5 bg-err/8 border border-err/20 rounded-xl text-[12px] text-err">
              ⚠ {pwError}
            </div>
          )}
          {pwOk && (
            <div className="px-4 py-2.5 bg-ok/8 border border-ok/20 rounded-xl text-[12px] text-ok">
              ✓ Password changed successfully
            </div>
          )}

          {([
            ['Current password',     current, setCurrent, 'current-password'] as const,
            ['New password',         next,    setNext,    'new-password'] as const,
            ['Confirm new password', confirm, setConfirm, 'new-password'] as const,
          ]).map(([label, value, setter, ac]) => (
            <div key={label}>
              <label className="block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">{label}</label>
              <input
                type="password"
                value={value}
                onChange={e => setter(e.target.value)}
                autoComplete={ac}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 border border-surface-rule rounded-xl font-mono text-[12px] text-text bg-surface-card outline-none focus:border-brand"
              />
            </div>
          ))}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-brand text-white text-[12px] font-semibold disabled:opacity-50"
          >
            {saving ? 'Changing password…' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* ── Section D: About ───────────────────────────────────────────────── */}
      <div className={CARD}>
        <p className={SECTION_HEADER}>About</p>
        <dl className="space-y-2">
          {[
            ['App',         'CNTP · Ops'],
            ['Environment', process.env.NODE_ENV],
            ['Build',       process.env.NEXT_PUBLIC_APP_VERSION || '—'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <dt className="font-mono text-[11px] text-text-muted">{k}</dt>
              <dd className="font-mono text-[11px] text-text">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

    </div>
  )
}

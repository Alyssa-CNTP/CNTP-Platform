'use client'
// app/(app)/settings/page.tsx

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { DEPARTMENT_META, PERMISSION_GROUPS } from '@/lib/auth/permissions'
import {
  Sun, Moon, Monitor, User, Palette, Globe, Bell, ShieldCheck,
  Activity, Check, ChevronRight, Mail, MessageSquareWarning,
} from 'lucide-react'
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

// ─── Notification preferences ───────────────────────────────────────────────
// Stored in shared.user_preferences.notifications. Absent / true = on.
// Consumed server-side by lib/notifications/notify() for the email + urgent channels.
type NotifPrefs = { email?: boolean; urgent?: boolean }

// ─── Shared styles ────────────────────────────────────────────────────────────

const CARD = 'rounded-2xl border border-surface-rule bg-surface-card shadow-sm p-5'
const SECTION_HEADER = 'font-mono text-[10px] uppercase tracking-widest text-text-muted font-bold mb-4'

// ─── Section registry ─────────────────────────────────────────────────────────

type SectionId =
  | 'profile' | 'appearance' | 'language' | 'notifications'
  | 'access' | 'activity'

const SECTIONS: { id: SectionId; label: string; Icon: typeof User }[] = [
  { id: 'profile',       label: 'Profile',       Icon: User },
  { id: 'appearance',    label: 'Appearance',    Icon: Palette },
  { id: 'language',      label: 'Language',      Icon: Globe },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'access',        label: 'My Access',     Icon: ShieldCheck },
  { id: 'activity',      label: 'Activity',      Icon: Activity },
]

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-brand' : 'bg-surface-rule'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const auth = useAuth()
  const { displayName, role, department, sectionId, user, initials, p } = auth
  const { lang, setLang } = useLanguage()

  const [active, setActive] = useState<SectionId>('profile')

  // ── Appearance ──
  const [theme, setTheme] = useState<ThemeChoice>('system')

  // ── Notifications ──
  const [notif, setNotif] = useState<NotifPrefs>({})
  const [notifLoaded, setNotifLoaded] = useState(false)

  useEffect(() => {
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
          .select('theme, notifications')
          .eq('user_id', user.id)
          .maybeSingle()
        const saved = (data as any)?.theme as ThemeChoice | null
        if (saved) { setTheme(saved); applyTheme(saved); localStorage.setItem('cntp_theme', saved) }
        setNotif(((data as any)?.notifications ?? {}) as NotifPrefs)
      } catch {}
      setNotifLoaded(true)
    }
    loadFromDb()
  }, [])

  async function handleThemeChange(t: ThemeChoice) {
    setTheme(t)
    applyTheme(t)
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

  async function setNotifPref(key: keyof NotifPrefs, value: boolean) {
    const next = { ...notif, [key]: value }
    setNotif(next)
    try {
      const db = getDb()
      const { data: { user } } = await db.auth.getUser()
      if (!user) return
      await db
        .schema('shared' as any)
        .from('user_preferences')
        .upsert({ user_id: user.id, notifications: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    } catch {}
  }

  const deptMeta = department ? DEPARTMENT_META[department] : null
  const roleLabel = role?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? null

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto">
      {/* Page title */}
      <div className="mb-6">
        <h2 className="font-display font-extrabold text-3xl text-text mb-1">Settings</h2>
        <p className="text-sm text-text-muted">{displayName}{roleLabel ? ` · ${roleLabel}` : ''}</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* ── Left nav ─────────────────────────────────────────────────── */}
        <nav className="md:w-52 flex-shrink-0">
          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 md:sticky md:top-4 scrollbar-none">
            {SECTIONS.map(({ id, label, Icon }) => {
              const selected = active === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                    selected
                      ? 'bg-brand/10 text-brand'
                      : 'text-text-muted hover:bg-surface-dim hover:text-text'
                  }`}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  {label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* ── Content ───────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-6 animate-in">

          {/* ── Profile ── */}
          {active === 'profile' && (
            <div className={CARD}>
              <p className={SECTION_HEADER}>Profile</p>
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center font-bold text-[18px] text-brand flex-shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0 space-y-3">
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
                    {sectionId && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border border-surface-rule text-text-muted bg-surface">
                        Section · {sectionId}
                      </span>
                    )}
                  </div>
                  <dl className="space-y-1.5 pt-1">
                    {user?.created_at && (
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-[11px] text-text-muted">Account created</dt>
                        <dd className="font-mono text-[11px] text-text">
                          {new Date(user.created_at).toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                        </dd>
                      </div>
                    )}
                    {user?.last_sign_in_at && (
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-[11px] text-text-muted">Last sign in</dt>
                        <dd className="font-mono text-[11px] text-text">
                          {new Date(user.last_sign_in_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <p className="text-[10px] text-text-faint pt-1">
                    Your name, department and role are managed by an administrator in Users &amp; Roles.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Appearance ── */}
          {active === 'appearance' && (
            <div className={CARD}>
              <p className={SECTION_HEADER}>Appearance</p>
              <p className="text-[11px] text-text-muted mb-4">Choose how the platform looks. Synced to your account across devices.</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { value: 'light',  label: 'Light',  Icon: Sun },
                  { value: 'dark',   label: 'Dark',   Icon: Moon },
                  { value: 'system', label: 'System', Icon: Monitor },
                ] as const).map(({ value, label, Icon }) => {
                  const selected = theme === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleThemeChange(value)}
                      className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all ${
                        selected ? 'border-brand bg-brand/8 ring-1 ring-brand' : 'border-surface-rule hover:border-brand/30 bg-surface-card'
                      }`}
                    >
                      <Icon size={20} className={selected ? 'text-brand' : 'text-text-muted'} />
                      <span className={`text-[11px] font-semibold ${selected ? 'text-brand' : 'text-text-muted'}`}>{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Language ── */}
          {active === 'language' && (
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
                        selected ? 'border-brand bg-brand/8 ring-1 ring-brand' : 'border-surface-rule hover:border-brand/30 bg-surface-card'
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
                          <Check size={10} className="text-white" strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {active === 'notifications' && (
            <div className={CARD}>
              <p className={SECTION_HEADER}>Notifications</p>
              <p className="text-[11px] text-text-muted mb-4">
                Choose which channels reach you for assignments, mentions, breakdowns and other alerts.
                In-app notifications (the bell) are always on.
              </p>
              <div className="space-y-3">
                <NotifRow
                  Icon={Mail}
                  title="Email notifications"
                  desc="Receive an email when something needs your attention."
                  on={notif.email !== false}
                  disabled={!notifLoaded}
                  onChange={v => setNotifPref('email', v)}
                />
                <NotifRow
                  Icon={MessageSquareWarning}
                  title="Urgent WhatsApp / SMS"
                  desc="Get a message for urgent items like breakdowns. Requires a phone number on file."
                  on={notif.urgent !== false}
                  disabled={!notifLoaded}
                  onChange={v => setNotifPref('urgent', v)}
                />
              </div>
              <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-info-bg border border-info/20 rounded-xl">
                <Bell size={13} className="text-info mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-text-muted">
                  Turning a channel off stops new email or urgent messages immediately. You&apos;ll still see everything in the bell.
                </p>
              </div>
            </div>
          )}

          {/* ── My Access ── */}
          {active === 'access' && <AccessSection auth={auth} />}

          {/* ── Activity ── */}
          {active === 'activity' && <ActivitySection />}

        </div>
      </div>
    </div>
  )
}

// ─── Notification row ──────────────────────────────────────────────────────────

function NotifRow({
  Icon, title, desc, on, onChange, disabled,
}: {
  Icon: typeof Mail; title: string; desc: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-3 px-3.5 rounded-xl border border-surface-rule">
      <div className="w-8 h-8 rounded-lg bg-surface-dim flex items-center justify-center flex-shrink-0">
        <Icon size={15} className="text-text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-text leading-tight">{title}</p>
        <p className="text-[11px] text-text-muted mt-0.5">{desc}</p>
      </div>
      <Toggle on={on} onChange={onChange} disabled={disabled} />
    </div>
  )
}

// ─── My Access section ─────────────────────────────────────────────────────────

const MODULES: { label: string; href: string; flag: keyof ReturnType<typeof useAuth> }[] = [
  { label: 'Quality',     href: '/quality/lab-results',     flag: 'canAccessQuality' },
  { label: 'Production',  href: '/production/operations',   flag: 'canAccessProduction' },
  { label: 'Maintenance', href: '/maintenance',             flag: 'canAccessMaintenance' },
  { label: 'Management',  href: '/management',              flag: 'canAccessManagement' },
  { label: 'Sales',       href: '/sales',                   flag: 'canAccessSales' },
  { label: 'Marketing',   href: '/marketing',               flag: 'canAccessMarketing' },
  { label: 'Admin',       href: '/users',                   flag: 'canAccessAdmin' },
]

function AccessSection({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const { p, role, department, isFullAdmin } = auth

  const modules = MODULES.filter(m => auth[m.flag] === true)
  if (p('can_access_workspace')) modules.push({ label: 'Workspace', href: '/workspace', flag: 'canAccessAdmin' })

  // Granted permissions, grouped — only show groups where the user has at least one.
  const grantedGroups = PERMISSION_GROUPS
    .map(g => ({ group: g.group, granted: g.permissions.filter(perm => p(perm.key)) }))
    .filter(g => g.granted.length > 0)

  const totalGranted = grantedGroups.reduce((n, g) => n + g.granted.length, 0)

  return (
    <>
      <div className={CARD}>
        <p className={SECTION_HEADER}>My Access</p>
        <p className="text-[11px] text-text-muted mb-4">
          What you can see and do on the platform. Managed by an administrator — to request a change, ask your manager or IT.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[
            ['Department', department ?? '—'],
            ['Role', role?.replace(/_/g, ' ') ?? '—'],
            ['Permissions', isFullAdmin ? 'All (admin)' : String(totalGranted)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-surface-rule bg-surface px-3 py-3 text-center">
              <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-1">{k}</p>
              <p className="text-[13px] font-bold text-text capitalize truncate">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {modules.length > 0 && (
        <div className={CARD}>
          <p className={SECTION_HEADER}>Modules you can open</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {modules.map(m => (
              <Link
                key={m.label}
                href={m.href}
                className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-surface-rule hover:border-brand/40 hover:bg-brand/5 transition-colors group"
              >
                <span className="text-[12.5px] font-semibold text-text">{m.label}</span>
                <ChevronRight size={14} className="text-text-faint group-hover:text-brand transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className={CARD}>
        <p className={SECTION_HEADER}>Permissions granted</p>
        {isFullAdmin ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-brand/5 border border-brand/20 rounded-xl">
            <ShieldCheck size={15} className="text-brand flex-shrink-0" />
            <p className="text-[12px] text-text">You have full administrator access to every feature.</p>
          </div>
        ) : grantedGroups.length === 0 ? (
          <p className="text-[12px] text-text-muted">No permissions are currently enabled on your account.</p>
        ) : (
          <div className="space-y-4">
            {grantedGroups.map(g => (
              <div key={g.group}>
                <p className="text-[11px] font-bold text-text-muted mb-1.5">{g.group}</p>
                <ul className="space-y-1">
                  {g.granted.map(perm => (
                    <li key={perm.key} className="flex items-start gap-2 text-[12px] text-text">
                      <Check size={13} className="text-ok mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                      <span>{perm.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Activity section ──────────────────────────────────────────────────────────

interface ActivityEntry {
  id: number
  action: string
  schema_name: string | null
  table_name: string | null
  record_id: string | null
  ip_address: string | null
  created_at: string
}

function humanAction(a: string) {
  return a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function ActivitySection() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/me/activity?limit=30')
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || `Error ${res.status}`)
      } else {
        setEntries(await res.json())
      }
    } catch {
      setError('Network error')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className={CARD}>
      <p className={SECTION_HEADER}>Recent Activity</p>
      <p className="text-[11px] text-text-muted mb-4">Your last 30 recorded actions on the platform.</p>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl skeleton" />)}
        </div>
      ) : error ? (
        <p className="text-[12px] text-err">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-text-muted">No recorded activity yet.</p>
      ) : (
        <ul className="divide-y divide-surface-rule">
          {entries.map(e => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-text">{humanAction(e.action)}</p>
                <p className="font-mono text-[10px] text-text-faint truncate">
                  {[e.schema_name, e.table_name].filter(Boolean).join('.') || '—'}
                  {e.ip_address ? ` · ${e.ip_address}` : ''}
                </p>
              </div>
              <time className="font-mono text-[10px] text-text-muted whitespace-nowrap flex-shrink-0">
                {new Date(e.created_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

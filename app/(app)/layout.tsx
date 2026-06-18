'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const INACTIVITY_MS = 60 * 60 * 1000  // 60 minutes until sign-out
const WARNING_MS    =  5 * 60 * 1000  // show warning 5 mins before
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import type { PermissionKey } from '@/lib/auth/permissions'
import Sidebar          from '@/components/layout/Sidebar'
import Topbar           from '@/components/layout/Topbar'
import NotificationBell from '@/components/layout/NotificationBell'
import CommandSearch    from '@/components/search/CommandSearch'
import { LanguageProvider } from '@/lib/i18n/context'

// ─── Route access rules ────────────────────────────────────────────────────────
// Mirrors Sidebar NAV. More-specific prefixes must come first.
// /dashboard, /settings, /axis/request are always open (excluded below).
//
// IT is NOT a blanket key. Being in the IT department does not grant access to
// another department's module — IT users are gated by the same department/
// permission rules as everyone else. AXIS and /status are IT's OWN modules, so
// they stay IT-scoped. Only the full admin (senior_developer) bypasses guards.

const ROUTE_GUARDS: Array<{
  prefix:       string
  departments?: string[]
  permission?:  PermissionKey
  itOnly?:      boolean
}> = [
  // AXIS — IT only (except /axis/request, excluded in guard logic)
  { prefix: '/axis/consideration', itOnly: true },
  { prefix: '/axis/changelog',     itOnly: true },
  { prefix: '/axis/projects',      itOnly: true },
  { prefix: '/axis',               itOnly: true },

  // Quality — Sales can only reach customer-specs
  { prefix: '/quality/customer-specs', departments: ['Quality','Sales'], permission: 'can_edit_customer_specs' },
  { prefix: '/quality',                departments: ['Quality'] },

  // Supervisor hub — production supervisors + management
  { prefix: '/supervisor',           departments: ['Production','Management'] },

  // Production
  { prefix: '/count',                departments: ['Production'], permission: 'can_submit_count'       },
  { prefix: '/info',                 departments: ['Production'], permission: 'can_view_ops_dashboard' },
  { prefix: '/production/operations',departments: ['Management'] },
  { prefix: '/production/live',      departments: ['Production'] },
  { prefix: '/production',           departments: ['Production'] },

  // Maintenance — full module is Maintenance + Management. Production may only
  // reach Job Cards (to report breakdowns + track their own cards). Longest-prefix
  // matcher means the job-cards rule wins for that sub-route.
  { prefix: '/maintenance/job-cards', departments: ['Maintenance','Management','Production'] },
  { prefix: '/maintenance',           departments: ['Maintenance','Management'] },

  // Logistics (barcode-driven receiving, warehouse, dispatch)
  { prefix: '/logistics',        departments: ['Production','Quality','Management'] },

  // Management — /status is IT's platform-diagnostics module
  { prefix: '/status',     departments: ['IT'] },
  { prefix: '/management', departments: ['Management'] },

  // Sales & Research
  { prefix: '/research',   departments: ['Sales','Management','Marketing'], permission: 'can_access_research' },
  { prefix: '/sales',      departments: ['Sales','Management'], permission: 'can_access_sales'    },

  // Marketing
  { prefix: '/marketing',  departments: ['Marketing','Management'], permission: 'can_access_marketing' as PermissionKey },

  // Intelligence — `can_access_intelligence` is a planned permission key honoured
  // by the /api/signals route; cast until it's added to PermissionKey.
  { prefix: '/intelligence', departments: ['Sales', 'Management', 'Marketing'], permission: 'can_access_intelligence' as PermissionKey },

  // Admin
  { prefix: '/users',      permission: 'can_manage_users' },
  { prefix: '/tags',       departments: ['Production'] },
]

// ─── Route metadata ────────────────────────────────────────────────────────────

const ROUTE_META: Record<string, {
  title:   string
  variant: 'default' | 'research' | 'sales' | 'management'
  chips?:  Array<{ label: string; color: 'green' | 'amber' | 'gray' | 'blue' | 'red' | 'purple' }>
}> = {
  '/dashboard':              { title: 'Dashboard',              variant: 'default',    chips: [{ label: 'Live', color: 'green' }] },
  '/count':                  { title: 'Stock Count',            variant: 'default',    chips: [{ label: 'BHW · Blackheath', color: 'gray' }] },
  '/production':             { title: 'Live Production',        variant: 'default',    chips: [{ label: 'Live', color: 'green' }] },
  '/production/live':        { title: 'Live Production',        variant: 'default',    chips: [{ label: 'Live', color: 'green' }] },
  '/production/live/capture':{ title: 'Capture Session',        variant: 'default' },
  '/production/capture':     { title: 'Production Capture',      variant: 'default' },
  '/production/operators':   { title: 'Operators',              variant: 'default' },
  '/info':                   { title: 'Section Information',    variant: 'default' },
  '/status':                 { title: 'Platform Analytics',     variant: 'default',    chips: [{ label: 'v3.0', color: 'gray' }] },
  '/users':                  { title: 'Users & Roles',          variant: 'default' },
  '/settings':               { title: 'Account Settings',       variant: 'default' },
  '/tags':                   { title: 'Bag Tracking',           variant: 'default' },

  // Supervisor hub
  '/supervisor':             { title: 'Supervisor Hub',         variant: 'default', chips: [{ label: 'Production', color: 'green' }] },
  '/supervisor/timesheets':  { title: 'Timesheets',             variant: 'default' },
  '/supervisor/productions': { title: 'Productions',            variant: 'default' },
  '/supervisor/calendar':    { title: 'Shift Calendar',         variant: 'default' },
  '/supervisor/messages':    { title: 'Messages',               variant: 'default' },
  '/supervisor/analytics':   { title: 'Analytics',              variant: 'default' },

  // Quality section
  '/quality/raw-material':   { title: 'Raw Material',           variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/pasteuriser':    { title: 'Pasteuriser',            variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/granule':        { title: 'Granule Line',           variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/sieving':        { title: 'Sieving',                variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/lab-results':    { title: 'Final Product Lab Results', variant: 'default', chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/customer-specs': { title: 'Customer Specifications', variant: 'default',   chips: [{ label: 'Quality', color: 'blue' }] },

  // Maintenance section — own module, separate from Quality
  '/maintenance':            { title: 'Maintenance',            variant: 'default',    chips: [{ label: 'FSSC 22000', color: 'green' }] },
  '/maintenance/job-cards':  { title: 'Job Cards',              variant: 'default' },
  '/maintenance/scheduled':  { title: 'Scheduled Maintenance',  variant: 'default' },
  '/maintenance/planner':    { title: 'Planner & Roster',       variant: 'default' },
  '/maintenance/stock':      { title: 'Stock & Spares',         variant: 'default' },

  // Management section
  '/management':                   { title: 'Management',           variant: 'management' },
  '/production/operations':        { title: 'Production Operations', variant: 'management', chips: [{ label: 'IT + Management', color: 'purple' }] },

  // Sales section
  '/sales':                  { title: 'Sales Dashboard',        variant: 'sales', chips: [{ label: 'CONFIDENTIAL', color: 'amber' }] },
  '/sales/customers':        { title: 'Accounts',               variant: 'sales' },
  '/sales/intelligence':     { title: 'Intelligence',           variant: 'sales' },
  '/sales/targets':          { title: 'Targets & OKRs',         variant: 'sales' },

  // Research
  '/research':               { title: 'Research Engine',        variant: 'research' },

  // Marketing
  '/marketing':              { title: 'Marketing',              variant: 'sales',   chips: [{ label: 'Live', color: 'green' }] },

  // Intelligence
  '/intelligence':              { title: 'Signal Engine',            variant: 'sales', chips: [{ label: 'Live', color: 'green' }] },
  '/intelligence/sales':        { title: 'Sales Intelligence',       variant: 'sales' },
  '/intelligence/expansion':    { title: 'Expansion Intelligence',   variant: 'sales' },
  '/intelligence/marketing':    { title: 'Marketing Intelligence',   variant: 'sales' },
  '/intelligence/south-africa': { title: 'South Africa',             variant: 'sales' },
  '/intelligence/linkedin':     { title: 'LinkedIn Intelligence',    variant: 'sales', chips: [{ label: 'Phase 2', color: 'purple' }] },

  // Logistics — barcode operations layer
  '/logistics':                    { title: 'Logistics',              variant: 'default', chips: [{ label: 'Live', color: 'green' }] },
  '/logistics/receiving':          { title: 'Receiving',              variant: 'default' },
  '/logistics/warehouse':          { title: 'Warehouse',              variant: 'default' },
  '/logistics/dispatch':           { title: 'Dispatch',               variant: 'default' },

  // AXIS — IT change & project tracking
  '/axis':                   { title: 'AXIS',                    variant: 'default', chips: [{ label: 'IT', color: 'purple' }] },
  '/axis/consideration':     { title: 'Consideration Board',     variant: 'default', chips: [{ label: 'IT', color: 'purple' }] },
  '/axis/projects':          { title: 'Projects',                variant: 'default', chips: [{ label: 'IT', color: 'purple' }] },
  '/axis/changelog':         { title: 'Change Log',              variant: 'default', chips: [{ label: 'IT', color: 'purple' }] },
  '/axis/request':           { title: 'Submit a Request',        variant: 'default' },
  '/axis/standards':         { title: 'Dev Standards & Protocol', variant: 'default', chips: [{ label: 'IT', color: 'purple' }] },
  '/suggest':                { title: 'Suggestions',             variant: 'default' },
}

// ─── Layout ────────────────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen,  setMobileOpen]  = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [countdown,   setCountdown]   = useState(0)
  const { user, loading, permissionsReady, isIT, isFullAdmin, department, role, p, signOut } = useAuth()
  const router   = useRouter()
  const pathname = usePathname()

  // ── Inactivity auto sign-out ───────────────────────────────────────────────
  const timeoutRef   = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const warningRef   = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearAll = useCallback(() => {
    if (timeoutRef.current)  clearTimeout(timeoutRef.current)
    if (warningRef.current)  clearTimeout(warningRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [])

  const resetTimer = useCallback(() => {
    clearAll()
    setShowWarning(false)
    // Warning banner 5 mins before sign-out
    warningRef.current = setTimeout(() => {
      setShowWarning(true)
      setCountdown(WARNING_MS / 1000)
      intervalRef.current = setInterval(() =>
        setCountdown(c => (c <= 1 ? (clearInterval(intervalRef.current!), 0) : c - 1)), 1000)
    }, INACTIVITY_MS - WARNING_MS)
    // Sign out after full inactivity period
    timeoutRef.current = setTimeout(() => { clearAll(); signOut() }, INACTIVITY_MS)
  }, [clearAll, signOut])

  useEffect(() => {
    if (!user) return
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const
    const handle = () => resetTimer()
    events.forEach(e => window.addEventListener(e, handle, { passive: true }))
    resetTimer()
    return () => { clearAll(); events.forEach(e => window.removeEventListener(e, handle)) }
  }, [user, resetTimer, clearAll])

  // Session check — redirect to login if unauthenticated
  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  // Authorization guard — department first, then per-user permission
  useEffect(() => {
    if (loading || !permissionsReady || !user) return

    // Floor operators are sandboxed to their capture area + custom dashboard.
    // They never see the general dashboard, settings, or any other module.
    if (role === 'floor_operator') {
      if (!pathname.startsWith('/production/capture')) router.replace('/production/capture')
      return
    }

    // Always-open routes
    if (
      pathname === '/dashboard' ||
      pathname === '/settings'  ||
      pathname === '/suggest'   ||
      pathname === '/axis/request' ||
      pathname.startsWith('/axis/request/')
    ) return

    // Find the most specific matching rule (longest prefix wins)
    const guard = ROUTE_GUARDS
      .filter(g => pathname === g.prefix || pathname.startsWith(g.prefix + '/'))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0]

    if (!guard) return

    // IT-only routes (AXIS internals) — only IT dept or full admin
    if (guard.itOnly && !isIT && !isFullAdmin) { router.replace('/dashboard'); return }

    // If the user has the required permission explicitly enabled, they get through
    // regardless of department. Permission is the single source of truth.
    const hasExplicitPermission = guard.permission && !isFullAdmin && p(guard.permission)
    if (isFullAdmin || hasExplicitPermission) return

    // No explicit permission — enforce department check
    if (guard.departments && !(department && guard.departments.includes(department))) {
      router.replace('/dashboard'); return
    }
    // Department matches but permission still required
    if (guard.permission && !p(guard.permission)) {
      router.replace('/dashboard'); return
    }
  }, [loading, permissionsReady, user, pathname, isIT, isFullAdmin, department, role, p, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand">
        <div className="font-mono text-[11px] tracking-[2px] uppercase text-white/30 animate-pulse">
          Loading…
        </div>
      </div>
    )
  }

  if (!user) return null

  // Find best matching route key (longest prefix match)
  const routeKey = Object.keys(ROUTE_META)
    .filter(k => pathname === k || pathname.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length)[0] ?? '/dashboard'

  const meta = ROUTE_META[routeKey] ?? { title: 'CNTP Ops', variant: 'default' as const }

  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <LanguageProvider>
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar
            title={meta.title}
            onMobileMenu={() => setMobileOpen(true)}
            chips={meta.chips ?? []}
            variant={meta.variant}
            acumaticaSync={routeKey === '/sales' ? 'ok' : undefined}
            rightSlot={<NotificationBell />}
          />
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            {children}
          </main>
        </div>
        <CommandSearch />
      </div>

      {/* Inactivity warning — appears 5 mins before auto sign-out */}
      {showWarning && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: 16,
          background: '#1A3A0E', color: '#fff', borderRadius: 12,
          padding: '14px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.30)',
          fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap',
        }}>
          <span>⚠️ Signing out in <strong>{fmtCountdown(countdown)}</strong> due to inactivity</span>
          <button
            onClick={resetTimer}
            style={{
              background: '#fff', color: '#1A3A0E', border: 'none',
              borderRadius: 8, padding: '6px 18px', fontSize: 13,
              fontWeight: 700, cursor: 'pointer', marginLeft: 4,
            }}
          >
            Stay signed in
          </button>
        </div>
      )}
    </LanguageProvider>
  )
}
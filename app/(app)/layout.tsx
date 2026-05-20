'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import Sidebar from '@/components/layout/Sidebar'
import Topbar  from '@/components/layout/Topbar'

// ─── Route metadata ────────────────────────────────────────────────────────────

const ROUTE_META: Record<string, {
  title:   string
  variant: 'default' | 'research' | 'sales' | 'management'
  chips?:  Array<{ label: string; color: 'green' | 'amber' | 'gray' | 'blue' | 'red' | 'purple' }>
}> = {
  '/dashboard':              { title: 'Dashboard',         variant: 'default',    chips: [{ label: 'Live', color: 'green' }] },
  '/count':                  { title: 'Morning count',     variant: 'default',    chips: [{ label: 'BHW · Blackheath', color: 'gray' }] },
  '/recount':                { title: 'Recount',           variant: 'default' },
  '/production':             { title: 'Live capture',      variant: 'default' },
  '/info':                   { title: 'Section info',      variant: 'default' },
  '/status':                 { title: 'Platform analytics',variant: 'default',    chips: [{ label: 'v3.0', color: 'gray' }] },
  '/users':                  { title: 'Users & roles',     variant: 'default' },
  '/settings':               { title: 'Account settings',  variant: 'default' },
  '/tags':                   { title: 'Bag tags',          variant: 'default' },

  // Quality section
  '/quality/raw-material':   { title: 'Raw material',      variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/pasteuriser':    { title: 'Pasteuriser',       variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/granule':        { title: 'Granule line',      variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/sieving':        { title: 'Sieving',           variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/lab-results':    { title: 'Lab results',       variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },
  '/quality/customer-specs': { title: 'Customer specs',    variant: 'default',    chips: [{ label: 'Quality', color: 'blue' }] },

  // Management section
  '/management':             { title: 'Management overview', variant: 'management', chips: [{ label: 'Read only', color: 'purple' }] },
  '/management/recounts':    { title: 'Recount review',      variant: 'management' },

  // Sales section
  '/sales':                  { title: 'Sales overview',    variant: 'sales' },
  '/sales/customers':        { title: 'Accounts',          variant: 'sales' },
  '/sales/intelligence':     { title: 'Intelligence',      variant: 'sales' },
  '/sales/targets':          { title: 'Targets & OKRs',    variant: 'sales' },

  // Research
  '/research':               { title: 'Research engine',   variant: 'research' },
}

// ─── Layout ────────────────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, loading } = useAuth()
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

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

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          title={meta.title}
          onMobileMenu={() => setMobileOpen(true)}
          chips={meta.chips ?? []}
          variant={meta.variant}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
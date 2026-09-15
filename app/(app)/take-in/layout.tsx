'use client'

// app/(app)/take-in/layout.tsx
//
// The Raw Material Take-In shell, for the two things that are NOT a site's own
// work: the consolidated view over every site, and the company-wide contract
// register. Settlement joins them for whoever holds its key.
//
// THE INTAKE CHAIN LIVES PER SITE, under /take-in/site/[code] — schedule,
// weighbridge, mini lab, documents, history. A site is where an operator
// actually stands, so that is where the work is; Warehousing in the sidebar
// goes straight there.
//
// The route guard in app/(app)/layout.tsx enforces the settlement key
// independently — this is the signpost, not the lock.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { Warehouse, FileSignature, Banknote } from 'lucide-react'

// Only the things that are NOT a site's own work. The intake chain — schedule,
// weighbridge, mini lab, documents, history — belongs to a site and lives under
// /take-in/site/[code], because that is where an operator actually stands.
const TABS = [
  { href: '/take-in',           label: 'All sites', icon: Warehouse     },
  { href: '/take-in/contracts', label: 'Contracts', icon: FileSignature },
] as const

export default function TakeInLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { p, depotCodes } = useAuth()

  // A site draws its own header and tabs; two stacked headers reads as a bug.
  // Checked AFTER the hooks above, never before — a conditional hook call is
  // the error-#310 class that took capture down for two days.
  const onSite = pathname.startsWith('/take-in/site/')

  const tabs = [
    ...TABS,
    ...(p('can_view_takein_settlement')
      ? [{ href: '/take-in/settlement', label: 'Settlement', icon: Banknote } as const]
      : []),
  ]

  if (onSite) return <>{children}</>

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">Raw Material Take-In</h1>
          <p className="text-[12px] text-text-muted mt-0.5 max-w-3xl">
            The farmer intake chain — contract, booking, weighbridge, GRN, mini lab,
            Afleweringsbewys, confirming lab, COA.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-rule
                         bg-surface-card px-3 py-1.5 font-mono text-[11px] text-text-muted">
          <Warehouse className="h-3.5 w-3.5" />
          {depotCodes.length ? depotCodes.join(' · ') : 'All sites'}
        </span>
      </header>

      <nav className="flex flex-wrap gap-1.5 border-b border-surface-rule pb-3">
        {tabs.map(t => {
          // Exact match for the index, prefix match for the rest, so
          // /take-in/contracts does not also light up Overview.
          const active = t.href === '/take-in'
            ? pathname === '/take-in'
            : pathname.startsWith(t.href)
          const Icon = t.icon
          return (
            <Link key={t.href} href={t.href}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2
                          text-[12px] font-semibold transition-colors ${
                active
                  ? 'border-brand bg-brand text-white'
                  : 'border-surface-rule bg-surface-card text-text-muted hover:text-text hover:border-accent'
              }`}>
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}

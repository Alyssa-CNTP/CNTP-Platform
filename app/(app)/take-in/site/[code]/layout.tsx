'use client'

// app/(app)/take-in/site/[code]/layout.tsx
//
// A SITE'S TAKE-IN STATION. Clicking Graafwater Depot under Warehousing lands
// here, and everything on the page is that site's: its bookings, its
// weighbridge, its mini lab, its documents.
//
// The tabs follow the physical chain, because that is the order the work
// happens in and the order the floor asks about it:
//
//   Overview → Schedule → Intake & GRN → Mini Lab → Documents → History
//
// BLACKHEATH IS DIFFERENT and deliberately so. Farmers do not deliver there,
// so it gets no Schedule, Intake or Mini Lab — it is the consolidated view over
// the other four, and the place the company-wide things live: the contract
// register and settlement. Offering a weighbridge tab at a site that has no
// weighbridge is how an operator ends up capturing a delivery against the wrong
// depot.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useParams } from 'next/navigation'
import { ArrowLeft, CalendarRange, PackageOpen, Beaker, FileText, Search,
         Warehouse, FileSignature, Banknote, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { loadSites, seesSite, errMsg } from '@/lib/takein/db'
import type { Site } from '@/lib/takein/types'

export default function SiteTakeInLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const code = (useParams<{ code: string }>().code ?? '').toUpperCase()
  const { p, depotCodes } = useAuth()

  const [site, setSite] = useState<Site | null>(null)
  const [err,  setErr]  = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    loadSites()
      .then(all => {
        if (!live) return
        setSite(all.find(s => s.code === code) ?? null)
        setReady(true)
      })
      .catch(e => { if (live) { setErr(errMsg(e, 'Could not load this site.')); setReady(true) } })
    return () => { live = false }
  }, [code])

  // Scope is checked here as a signpost. The route guard in app/(app)/layout.tsx
  // and the database's own policies are the locks.
  const maySee = seesSite(depotCodes, code)

  const operational = !!site?.takes_farmer_delivery
  const base = `/take-in/site/${code}`

  const tabs = [
    { href: base, label: 'Overview', icon: Warehouse, on: true },
    { href: `${base}/schedule`,  label: 'Schedule',      icon: CalendarRange, on: operational },
    { href: `${base}/intake`,    label: 'Intake & GRN',  icon: PackageOpen,   on: operational },
    { href: `${base}/mini-lab`,  label: 'Mini Lab',      icon: Beaker,        on: operational },
    { href: `${base}/documents`, label: 'Documents',     icon: FileText,      on: true },
    { href: `${base}/history`,   label: 'History',       icon: Search,        on: true },
    // Company-wide, and they live at head office rather than on a weighbridge.
    { href: '/take-in/contracts', label: 'Contracts', icon: FileSignature,
      on: !operational && p('can_manage_takein_contracts') },
    { href: '/take-in/settlement', label: 'Settlement', icon: Banknote,
      on: !operational && p('can_view_takein_settlement') },
  ].filter(t => t.on)

  return (
    <div className="space-y-5">
      <Link href="/take-in" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> All sites
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold text-text">{site?.name ?? code}</h1>
          <p className="mt-0.5 max-w-3xl text-[12px] text-text-muted">
            {operational
              ? 'Raw material take-in and mini lab station — booking, weighbridge, GRN, mini lab, Afleweringsbewys.'
              : 'Consolidated view over every site, and where the contract register and settlement live. Farmers do not deliver here.'}
          </p>
        </div>
        {site?.batch_prefix && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-rule
                           bg-surface-card px-3 py-1.5 font-mono text-[11px] text-text-muted">
            <Warehouse className="h-3.5 w-3.5" /> {site.batch_prefix}{String(site.batch_seq + 1).padStart(4, '0')} next
          </span>
        )}
      </header>

      {err && (
        <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{err}
        </div>
      )}

      {site?.series_provisional && (
        <div className="rounded-xl border border-warn/25 bg-warn-bg px-4 py-3 text-[12px] text-text-muted">
          <strong className="text-text">This site&apos;s batch series is provisional.</strong>{' '}
          <span className="font-mono">{site.batch_prefix}</span> is a placeholder until the real series
          from this site&apos;s book is set. Fine for testing; set it before the first live take-in,
          because a guessed series on a printed bag cannot be told apart from a real one.
        </div>
      )}

      {ready && !site && !err && (
        <p className="text-[13px] text-text-muted">There is no site with the code &ldquo;{code}&rdquo;.</p>
      )}

      {ready && site && !maySee && (
        <div className="rounded-xl border border-surface-rule bg-surface-dim px-4 py-3 text-[12px] text-text-muted">
          <strong className="text-text">{site.name} is not in scope for your account.</strong> Depot
          access is set on Users &amp; Access.
        </div>
      )}

      {site && maySee && (
        <>
          <nav className="flex flex-wrap gap-1.5">
            {tabs.map(t => {
              const active = t.href === base ? pathname === base : pathname.startsWith(t.href)
              return (
                <Link key={t.href} href={t.href}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition
                    ${active
                      ? 'border-brand bg-brand text-white'
                      : 'border-surface-rule bg-surface-card text-text-muted hover:border-text-faint hover:text-text'}`}>
                  <t.icon className="h-3.5 w-3.5" /> {t.label}
                </Link>
              )
            })}
          </nav>
          {children}
        </>
      )}
    </div>
  )
}

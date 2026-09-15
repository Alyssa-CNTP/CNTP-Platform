'use client'

// components/takein/SiteTakeInTabs.tsx
//
// The farmer take-in strip on a Warehousing site's page. Clicking Graafwater
// Depot in the sidebar should land you on that site's whole working set — its
// GRN and DN books AND its farmer intake chain — so this sits alongside the
// book tabs rather than in a separate module.
//
// IT LINKS; IT DOES NOT DUPLICATE. Each tab opens the one take-in screen with
// `?site=<code>`, and `scopedSites()` narrows that screen to this site. Copying
// eight screens per site is exactly the duplication this module was asked not
// to create, and it is how two sites end up disagreeing about one delivery.
//
// A site that does not take farmer deliveries gets no strip at all: Blackheath
// is the consolidated view over the other four, and farmers do not deliver
// there.

import Link from 'next/link'
import { CalendarRange, PackageOpen, Beaker, FileText, Search } from 'lucide-react'

const TABS = [
  { slug: 'schedule',  label: 'Delivery Schedule', icon: CalendarRange },
  { slug: 'intake',    label: 'Intake & GRN',      icon: PackageOpen },
  { slug: 'mini-lab',  label: 'Mini Lab',          icon: Beaker },
  { slug: 'documents', label: 'Documents',         icon: FileText },
  { slug: 'history',   label: 'History',           icon: Search },
] as const

export default function SiteTakeInTabs({
  code, batchPrefix, seriesProvisional,
}: {
  code: string
  batchPrefix: string | null
  /** True while the series is a placeholder rather than this site's own paper
   *  book. Said out loud, because a guessed series printed on a bag cannot be
   *  told apart from a real one once it is in the warehouse. */
  seriesProvisional: boolean
}) {
  return (
    <section className="mb-6 rounded-xl border border-surface-rule bg-surface-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-text">Farmer Take-In</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            Booking → weighbridge → GRN → mini lab → Afleweringsbewys, for this site only.
          </p>
        </div>
        {batchPrefix && (
          <span className="rounded-md border border-surface-rule bg-surface-dim px-2 py-1 font-mono text-[11px] text-text-muted">
            {batchPrefix}0001 next
          </span>
        )}
      </div>

      {seriesProvisional && (
        <p className="mb-3 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2 text-[11px] text-text-muted">
          <strong className="text-text">This site&apos;s batch series is provisional.</strong>{' '}
          <span className="font-mono">{batchPrefix}</span> is a placeholder until the real series
          from this site&apos;s book is set. Fine for testing; set it before the first live take-in,
          because a guessed series on a printed bag cannot be told apart from a real one.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <Link
            key={t.slug}
            href={`/take-in/${t.slug}?site=${code}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-surface-rule bg-white px-3 py-1.5
                       text-[13px] font-medium text-text-muted transition
                       hover:border-text-faint hover:text-text"
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </Link>
        ))}
      </div>
    </section>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Search } from 'lucide-react'
import {
  SEED_TEMPLATES, fetchTemplates, toTemplate, type LabelTemplateRow,
  errMessage,
} from '@/features/pasteuriser-labels'
import type { LabelTemplateStatus } from '@/lib/core/labels'
import { groupLibraryByCustomer } from '@/lib/core/labels/library'
import { useAuth } from '@/lib/auth/context'

/**
 * The label library.
 *
 * Grouped by CUSTOMER, then by label family, then by version.
 *
 * Not by certification scheme. The library is named EU-ORG / JAS / NOP-USA /
 * EU-NOP-RA-ORG, so browsing it used to mean knowing which union's rules apply
 * to your customer before you could find their label — which is backwards, and
 * bombards a salesperson with the names of certification bodies they do not
 * need to think about. The scheme code is still there, one line down, for when
 * it matters.
 *
 * A customer legitimately has SEVERAL labels at once — rooibos carrying the
 * importer address and rosehips not, each approved separately for its product —
 * so the family level stays. Flattening to customer -> versions would imply two
 * independently approved labels were versions of one another.
 *
 * The grouping itself is lib/core/labels/library.ts: it decides what is shown
 * and in what order, it is pure arithmetic on data, and the job-card picker and
 * the print screen will need exactly the same answer. One owner, tested.
 */

const STATUS_STYLE: Record<LabelTemplateStatus, { label: string; cls: string }> = {
  draft:            { label: 'Draft',            cls: 'bg-slate-100 text-slate-700' },
  pending_approval: { label: 'Awaiting approval', cls: 'bg-amber-100 text-amber-800' },
  approved:         { label: 'Approved',         cls: 'bg-emerald-100 text-emerald-800' },
  rejected:         { label: 'Rejected',         cls: 'bg-red-100 text-red-700' },
  superseded:       { label: 'Superseded',       cls: 'bg-slate-100 text-slate-500' },
}

export function StatusPill({ status }: { status: LabelTemplateStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  )
}

export default function LabelLibraryPage() {
  const router = useRouter()
  const { p: perm, isFullAdmin } = useAuth()
  const can = (k: Parameters<typeof perm>[0]) => isFullAdmin || perm(k)
  const [rows, setRows] = useState<LabelTemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    setLoading(true)
    try { setRows(await fetchTemplates()); setError(null) }
    catch (e) { setError(errMessage(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const matching = needle
      // Customer is part of the haystack, so typing "kunitaro" finds their
      // labels even though no label is named that.
      ? rows.filter(r => `${r.code} ${r.name} ${r.market} ${r.customer ?? ''}`
          .toLowerCase().includes(needle))
      : rows
    return groupLibraryByCustomer(matching)
  }, [rows, q])

  const familyCount = useMemo(
    () => groups.reduce((a, g) => a + g.families.length, 0),
    [groups],
  )

  // Seed designs not yet in the library — the thirteen BarTender files.
  const unseeded = useMemo(() => {
    const have = new Set(rows.map(r => r.code))
    return SEED_TEMPLATES.filter(s => !have.has(s.code))
  }, [rows])

  async function create(seedFrom?: string) {
    setCreating(true)
    try {
      const seed = seedFrom ? SEED_TEMPLATES.find(s => s.code === seedFrom) : null
      const code = seedFrom ?? window.prompt('New label code (e.g. EU-ORG-2027)')?.trim().toUpperCase()
      if (!code) return
      const res = await fetch('/api/pasteuriser/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: seed?.name, seedFrom }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not create the label')
      router.push(`/pasteuriser/labels/${json.template.id}`)
    } catch (e) { setError(errMessage(e)) }
    finally { setCreating(false) }
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-text">Labels</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Finished-product label templates, their approvals, and the POs assigned to them
          </p>
        </div>
        {can('can_design_labels') && (
          <button onClick={() => create()} disabled={creating}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-mid transition-colors text-sm font-medium disabled:opacity-50">
            <Plus size={15} /> New label
          </button>
        )}
      </div>

      {error && (
        <div className="card p-3 border-l-4 border-l-red-500 text-sm text-text-muted">{error}</div>
      )}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search by code, name or market"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-surface-rule bg-surface text-sm text-text" />
      </div>

      {loading ? (
        <p className="text-sm text-text-muted py-8 text-center">Loading…</p>
      ) : familyCount === 0 ? (
        <p className="text-sm text-text-muted py-8 text-center">
          No labels yet{q ? ' matching that search' : ''}.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <div key={g.label} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="font-display font-bold text-[13px] uppercase tracking-wide text-text-muted">
                  {g.label}
                </h2>
                <span className="text-[11px] text-text-faint">
                  {g.families.length} label{g.families.length === 1 ? '' : 's'}
                </span>
              </div>
              {g.families.map(f => (
                <button key={f.code} onClick={() => router.push(`/pasteuriser/labels/${f.headline.id}`)}
                  className="w-full text-left card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-bold text-[15px] text-text">{f.headline.name}</p>
                      <StatusPill status={f.headline.status} />
                    </div>
                    <p className="font-mono text-[10px] text-text-muted mt-0.5">
                      {f.code} · v{f.headline.version}
                      {f.versions.length > 1 && ` · ${f.versions.length} versions`}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {f.headline.market.toUpperCase()}
                      {f.headline.organic && ' · Organic'}
                      {f.headline.certifications?.length
                        ? ` · ${f.headline.certifications.map(c => c.mark.replace(/_/g, ' ')).join(', ')}`
                        : ''}
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-text-faint flex-shrink-0" />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* The existing BarTender designs, offered as starting points. They land
          as drafts and still go round the approval loop — see the route. */}
      {can('can_design_labels') && unseeded.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-text-faint">
            Import from the existing BarTender set
          </p>
          <p className="text-xs text-text-muted">
            These come in as drafts. What Control Union approved was a BarTender file, so each one
            still needs a proof and a fresh approval before it can print from here.
          </p>
          <div className="flex flex-wrap gap-2">
            {unseeded.map(s => (
              <button key={s.code} onClick={() => create(s.code)} disabled={creating}
                className="px-2.5 py-1.5 rounded-lg border border-surface-rule text-xs font-medium text-text-muted hover:text-text hover:border-text-faint disabled:opacity-50">
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

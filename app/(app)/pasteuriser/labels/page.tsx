'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Search } from 'lucide-react'
import {
  SEED_TEMPLATES, fetchTemplates, toTemplate, type LabelTemplateRow,
  fetchCustomerAccounts, fetchAssignableReps, setCustomerSalesRep,
  type AssignableRep,
  errMessage,
} from '@/features/pasteuriser-labels'
import type { LabelTemplateStatus } from '@/lib/core/labels'
import {
  groupLibraryByCustomer, withOwnership, unassignedAccounts,
  type CustomerAccount,
} from '@/lib/core/labels/library'
import { useAuth } from '@/lib/auth/context'
import { useMyEmployee } from '@/lib/training/use-my-employee'

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
  // Account ownership is a sales-management act, and can_assign_label_po is the
  // key sales already holds for binding work to a customer. Deliberately not a
  // sixth label permission: adding one mid-testing means four more
  // registrations (union, registry, route guard, nav) for a control that sits
  // on a page the same people already reach.
  const canAssign = can('can_assign_label_po')
  const [rows, setRows] = useState<LabelTemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  // Who owns which account, and who the viewer is in the Staff Directory.
  // useMyEmployee is the app's existing resolver for auth.users.id ->
  // employees.id; the auth context carries userId but not the employee link.
  const { userId } = useAuth()
  const { employeeId } = useMyEmployee(userId)
  const [accounts, setAccounts] = useState<CustomerAccount[]>([])
  const [reps, setReps] = useState<AssignableRep[]>([])

  async function load() {
    setLoading(true)
    try { setRows(await fetchTemplates()); setError(null) }
    catch (e) { setError(errMessage(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  // Ownership loads separately and never blocks the library. An empty or
  // failed customer master means every group reads as unassigned, which is
  // the honest degradation -- a label list that will not render because
  // nobody has been given an account would be a worse trade.
  const loadAccounts = async () => {
    try { setAccounts(await fetchCustomerAccounts()) } catch { setAccounts([]) }
  }
  useEffect(() => { void loadAccounts() }, [])

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

  // Annotated with the sales lead, viewer's own accounts first. The rule is
  // lib/core/labels/library.ts, so the job-card picker and the approval queue
  // get the same answer as this screen.
  const owned = useMemo(
    () => withOwnership(groups, accounts, employeeId),
    [groups, accounts, employeeId],
  )
  const mineCount = useMemo(() => owned.filter(g => g.mine).length, [owned])

  const familyCount = useMemo(
    () => groups.reduce((a, g) => a + g.families.length, 0),
    [groups],
  )

  // An account nobody owns is invisible work: no rep sees it under their own
  // customers, so nobody is prompted to approve its labels.
  const orphans = useMemo(() => unassignedAccounts(accounts), [accounts])

  // Seed designs not yet in the library — the thirteen BarTender files.
  const unseeded = useMemo(() => {
    const have = new Set(rows.map(r => r.code))
    return SEED_TEMPLATES.filter(s => !have.has(s.code))
  }, [rows])

  // Reps are only fetched when someone actually opens a picker. The Staff
  // Directory is not needed to read the library, and loading every employee on
  // every page view to populate a control most viewers cannot use is the kind
  // of cost ARCHITECTURE.md 3 calls out.
  async function ensureReps() {
    if (reps.length) return
    try { setReps(await fetchAssignableReps()) }
    catch (e) { setError(errMessage(e)) }
  }

  async function assignRep(customer: string, employee: string | null) {
    try {
      await setCustomerSalesRep(customer, employee)
      await loadAccounts()
      setError(null)
    } catch (e) { setError(errMessage(e)) }
  }

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

      {mineCount > 0 && (
        <p className="text-[11px] text-text-muted -mt-2">
          Your {mineCount} account{mineCount === 1 ? '' : 's'} first, then the rest alphabetically.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-text-muted py-8 text-center">Loading…</p>
      ) : familyCount === 0 ? (
        <p className="text-sm text-text-muted py-8 text-center">
          No labels yet{q ? ' matching that search' : ''}.
        </p>
      ) : (
        <div className="space-y-5">
          {owned.map(g => (
            <div key={g.label} className="space-y-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="font-display font-bold text-[13px] uppercase tracking-wide text-text-muted">
                  {g.label}
                </h2>
                {g.mine && (
                  <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-semibold uppercase tracking-wide">
                    Mine
                  </span>
                )}
                <span className="text-[11px] text-text-faint">
                  {g.families.length} label{g.families.length === 1 ? '' : 's'}
                </span>
                {/* The generic group belongs to no customer, so it can have no
                    lead -- offering a picker there would invite an assignment
                    that has nowhere to be stored. */}
                {g.customer && (
                  <CustomerLead
                    customer={g.customer}
                    repId={g.salesRepEmployeeId}
                    repName={g.salesRepName}
                    reps={reps}
                    canAssign={canAssign}
                    onLoadReps={ensureReps}
                    onAssign={assignRep}
                  />
                )}
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

      {/* Accounts with no sales lead. Only shown to whoever can fix it, and
          only when there are some -- a permanent empty panel teaches people to
          stop reading that part of the screen. */}
      {canAssign && orphans.length > 0 && (
        <div className="card p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-text-faint">
            {orphans.length} customer{orphans.length === 1 ? '' : 's'} with no sales lead
          </p>
          <p className="text-xs text-text-muted">
            Nobody sees these under their own customers, so nothing prompts anyone to get their
            labels approved.
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            {orphans.map(a => (
              <CustomerLead key={a.name} customer={a.name} repId={null} repName={null}
                reps={reps} canAssign={canAssign} onLoadReps={ensureReps} onAssign={assignRep}
                prefix={a.name} />
            ))}
          </div>
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

/**
 * The sales lead on a customer, and the control to change it.
 *
 * Reads as plain text until someone who can assign clicks it, so the library
 * stays a reading surface for the people who only read it. A `<select>` rather
 * than a bespoke menu: it is a single-choice list of people, and the native
 * control already handles keyboard, typeahead and small screens.
 *
 * The rep list loads on first open, not on page load — see onLoadReps.
 */
function CustomerLead({
  customer, repId, repName, reps, canAssign, onLoadReps, onAssign, prefix,
}: {
  customer: string
  repId: string | null
  repName: string | null
  reps: AssignableRep[]
  canAssign: boolean
  onLoadReps: () => void | Promise<void>
  onAssign: (customer: string, employeeId: string | null) => void | Promise<void>
  /** Shown before the lead — used by the unassigned panel, where the customer
   *  name is not already a heading above it. */
  prefix?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // The name is only known for a rep who still has an active Staff Directory
  // row. An id with no name is an offboarded person still holding an account,
  // which is worth saying rather than rendering as blank.
  const lead = repId ? (repName ?? 'Unknown (offboarded?)') : 'Unassigned'

  if (!canAssign || !open) {
    return (
      <button
        type="button"
        disabled={!canAssign}
        onClick={async () => { setOpen(true); await onLoadReps() }}
        className={`text-[11px] ${repId ? 'text-text-muted' : 'text-text-faint italic'} ${
          canAssign ? 'hover:text-brand underline decoration-dotted underline-offset-2' : 'cursor-default'
        }`}
        title={canAssign ? `Change the sales lead for ${customer}` : undefined}
      >
        {prefix ? `${prefix} · ` : ''}{lead}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {prefix && <span className="text-[11px] text-text-muted">{prefix}</span>}
      <select
        autoFocus
        disabled={busy}
        value={repId ?? ''}
        onChange={async e => {
          const next = e.target.value || null
          if (next === repId) { setOpen(false); return }
          setBusy(true)
          await onAssign(customer, next)
          setBusy(false)
          setOpen(false)
        }}
        onBlur={() => setOpen(false)}
        className="text-[11px] rounded border border-surface-rule bg-surface px-1.5 py-0.5 text-text"
      >
        <option value="">Unassigned</option>
        {reps.map(r => (
          <option key={r.id} value={r.id}>
            {r.name}{r.jobTitle ? ` — ${r.jobTitle}` : ''}
          </option>
        ))}
      </select>
    </span>
  )
}

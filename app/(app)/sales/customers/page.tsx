'use client'

// app/(app)/sales/customers/page.tsx
// Accounts — every customer, who owns it, and what its Acumatica order book
// says. A rep opens this to see THEIR customers, so their own sort first.
//
// Read-only against Acumatica. Nothing on this page or the one behind it ever
// writes to the ERP; the only things written are ours — who owns an account,
// and which Acumatica customer it is.
//
// Distinct from the Customers tab on /sales, which is the commercial view:
// tiers, GP%, targets against plan. This is the operational one — orders,
// labels, specs — and it is what the pasteuriser workflow reads a customer
// from.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Search, Link2Off, UserCircle2 } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMyEmployee } from '@/lib/training/use-my-employee'
import {
  fetchAccounts, fetchAllOrderLines, errMessage,
} from '@/lib/sales/customer-accounts'
import {
  buildAccountRows, filterAccounts, ordersByCustomerId,
  type AccountFilter, type AccountRow, type OrderLine, type SalesAccount,
} from '@/lib/core/sales/accounts'

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`

export default function AccountsPage() {
  const { userId } = useAuth()
  const { employeeId } = useMyEmployee(userId)

  const [accounts, setAccounts] = useState<SalesAccount[]>([])
  const [lines, setLines] = useState<OrderLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<AccountFilter>('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [a, l] = await Promise.all([fetchAccounts(), fetchAllOrderLines()])
        setAccounts(a); setLines(l); setError(null)
      } catch (e) { setError(errMessage(e)) }
      finally { setLoading(false) }
    })()
  }, [])

  const rows = useMemo(
    () => buildAccountRows(accounts, ordersByCustomerId(lines), employeeId),
    [accounts, lines, employeeId],
  )
  const shown = useMemo(() => filterAccounts(rows, filter, q), [rows, filter, q])
  const mineCount = useMemo(() => rows.filter(r => r.mine).length, [rows])
  const unassigned = useMemo(() => rows.filter(r => !r.salesRepEmployeeId).length, [rows])

  // Default to "mine" once we know the viewer actually has accounts — a rep
  // opening this page wants their own book, not all 25. Only once, so a
  // deliberate switch to All is never undone by a re-render.
  const [defaulted, setDefaulted] = useState(false)
  useEffect(() => {
    if (defaulted || loading || !employeeId) return
    if (mineCount > 0) setFilter('mine')
    setDefaulted(true)
  }, [defaulted, loading, employeeId, mineCount])

  const TABS: { key: AccountFilter; label: string; count: number }[] = [
    { key: 'mine',       label: 'My accounts', count: mineCount },
    { key: 'unassigned', label: 'Unassigned',  count: unassigned },
    { key: 'all',        label: 'All',         count: rows.length },
  ]

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-text">Accounts</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Customers, their sales lead, and what is open against them in Acumatica
        </p>
      </div>

      {error && <div className="card p-3 border-l-4 border-l-red-500 text-sm text-text-muted">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
              filter === t.key
                ? 'border-brand bg-brand/5 text-brand'
                : 'border-surface-rule text-text-muted hover:text-text hover:border-text-faint'
            }`}>
            {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
          </button>
        ))}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Customer, sales lead or Acumatica ID"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-surface-rule bg-surface text-sm text-text" />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted py-10 text-center">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-text-muted py-10 text-center">
          {filter === 'mine' && mineCount === 0
            ? 'No accounts are assigned to you yet.'
            : 'No accounts match.'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map(r => <AccountCard key={r.name} row={r} />)}
        </div>
      )}
    </div>
  )
}

function AccountCard({ row: r }: { row: AccountRow }) {
  const o = r.orders
  return (
    <Link href={`/sales/customers/${encodeURIComponent(r.name)}`}
      className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-display font-bold text-[15px] text-text">{r.name}</p>
          {r.mine && (
            <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-semibold uppercase tracking-wide">
              Mine
            </span>
          )}
          {!r.linked && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase tracking-wide"
              title="No Acumatica customer linked — this account has no order book to read, which is not the same as having no orders">
              <Link2Off size={10} /> Not linked
            </span>
          )}
        </div>

        <p className="text-[11.5px] text-text-muted mt-0.5 inline-flex items-center gap-1">
          <UserCircle2 size={12} className="text-text-faint" />
          {r.salesRepName ?? <span className="italic text-text-faint">No sales lead</span>}
          {r.acumaticaCustomerId && (
            <span className="font-mono text-[10px] text-text-faint ml-1.5">{r.acumaticaCustomerId}</span>
          )}
        </p>

        {r.linked && (
          <p className="text-xs text-text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className={o.liveLines ? 'text-text' : ''}>
              <span className="tabular-nums font-medium">{o.liveLines}</span> open
              {o.liveQty > 0 && <span className="text-text-faint"> · {kg(o.liveQty)}</span>}
            </span>
            {o.onHoldLines > 0 && (
              <span className="text-amber-700">
                <span className="tabular-nums font-medium">{o.onHoldLines}</span> on hold
              </span>
            )}
            {o.blanketLines > 0 && (
              <span className="text-text-faint" title="Contracts — never counted as production">
                <span className="tabular-nums">{o.blanketLines}</span> blanket
              </span>
            )}
            {o.nextRequestedOn && (
              <span className="text-text-faint">next {o.nextRequestedOn}</span>
            )}
          </p>
        )}
      </div>
      <ChevronRight size={18} className="text-text-faint flex-shrink-0" />
    </Link>
  )
}

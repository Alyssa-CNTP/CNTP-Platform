'use client'

// app/(app)/sales/customers/[name]/page.tsx
// One account. Everything about a customer in one place: who owns it, what is
// open against it in Acumatica, its finished-product labels, its quality specs.
//
// Routed by NAME, not by the uuid on sales.customers, because the name is the
// natural key the rest of the system already stores — label_templates.customer,
// qms.customer_specs.customer. Routing by id would force a join for every
// lookup and break for a label naming a customer the master has not caught up
// with.
//
// READ-ONLY against Acumatica. The two things this page writes are ours: which
// rep owns the account, and which Acumatica customer it is.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, Link2, Link2Off, Loader2, Tags, FileText, ClipboardCheck,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMyEmployee } from '@/lib/training/use-my-employee'
import {
  fetchAccounts, fetchAllOrderLines, fetchOrderLinesFor, fetchSalesPeople,
  fetchAccountLabels, fetchAccountSpecs, setAccountRep, setAcumaticaCustomerId,
  acumaticaCustomerOptions, errMessage,
  type SalesPerson, type AccountLabel, type AccountSpec,
} from '@/lib/sales/customer-accounts'
import {
  summariseOrders, JOB_CARD_ORDER_TYPE,
  type OrderLine, type SalesAccount,
} from '@/lib/core/sales/accounts'

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`

export default function AccountPage() {
  const params = useParams<{ name: string }>()
  const name = decodeURIComponent(params.name ?? '')
  const { userId, p: perm, isFullAdmin } = useAuth()
  const { employeeId } = useMyEmployee(userId)
  const canManage = isFullAdmin || perm('can_assign_label_po')

  const [account, setAccount] = useState<SalesAccount | null>(null)
  const [lines, setLines] = useState<OrderLine[]>([])
  const [allLines, setAllLines] = useState<OrderLine[]>([])
  const [people, setPeople] = useState<SalesPerson[]>([])
  const [labels, setLabels] = useState<AccountLabel[]>([])
  const [specs, setSpecs] = useState<AccountSpec[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const accounts = await fetchAccounts()
      const a = accounts.find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null
      setAccount(a)
      const [ls, sp] = await Promise.all([fetchAccountLabels(name), fetchAccountSpecs(name)])
      setLabels(ls); setSpecs(sp)
      setLines(a?.acumaticaCustomerId ? await fetchOrderLinesFor(a.acumaticaCustomerId) : [])
      setError(null)
    } catch (e) { setError(errMessage(e)) }
    finally { setLoading(false) }
  }, [name])

  useEffect(() => { void load() }, [load])
  // Only needed by the two management controls, so it is not on the load path.
  useEffect(() => {
    if (!canManage) return
    ;(async () => {
      try {
        const [sp, al] = await Promise.all([fetchSalesPeople(), fetchAllOrderLines()])
        setPeople(sp); setAllLines(al)
      } catch { /* the controls degrade to read-only; the page still reads */ }
    })()
  }, [canManage])

  const summary = useMemo(() => summariseOrders(lines), [lines])
  const soLines = useMemo(
    () => lines.filter(l => l.order_type === JOB_CARD_ORDER_TYPE), [lines])
  const blanketLines = useMemo(() => lines.filter(l => l.order_type === 'BL'), [lines])
  const acuOptions = useMemo(() => acumaticaCustomerOptions(allLines), [allLines])

  async function saveRep(id: string | null) {
    setBusy(true)
    try { await setAccountRep(name, id); await load() }
    catch (e) { setError(errMessage(e)) }
    finally { setBusy(false) }
  }
  async function saveAcu(id: string | null) {
    setBusy(true)
    try { await setAcumaticaCustomerId(name, id); await load() }
    catch (e) { setError(errMessage(e)) }
    finally { setBusy(false) }
  }

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-text-faint" /></div>

  const mine = !!employeeId && account?.salesRepEmployeeId === employeeId

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      <Link href="/sales/customers"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft size={16} /> Accounts
      </Link>

      {error && <div className="card p-3 border-l-4 border-l-red-500 text-sm text-text-muted">{error}</div>}

      {/* Header — who this is and who owns them */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display font-bold text-2xl text-text">{name}</h1>
              {mine && (
                <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-semibold uppercase tracking-wide">
                  Mine
                </span>
              )}
            </div>
            {!account && (
              <p className="text-xs text-amber-700 mt-1">
                This customer is named on a label or a spec but has no row in the customer master.
                Assigning a sales lead below will create one.
              </p>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 pt-1">
          <Field label="Sales lead">
            <RepPicker value={account?.salesRepEmployeeId ?? null} valueName={account?.salesRepName ?? null}
              people={people} canManage={canManage} busy={busy} onChange={saveRep} />
          </Field>
          <Field label="Acumatica customer">
            <AcumaticaPicker value={account?.acumaticaCustomerId ?? null} options={acuOptions}
              canManage={canManage} busy={busy} onChange={saveAcu} />
          </Field>
        </div>
      </div>

      {/* Order book */}
      {!account?.acumaticaCustomerId ? (
        <div className="card p-4">
          <p className="text-sm text-text-muted">
            <Link2Off size={14} className="inline -mt-0.5 mr-1 text-text-faint" />
            Not linked to an Acumatica customer, so there is no order book to show. That is not the
            same as having no orders — link it above and the orders appear.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Open lines" value={String(summary.liveLines)} sub={summary.liveQty ? kg(summary.liveQty) : undefined} />
            <Stat label="On hold" value={String(summary.onHoldLines)} sub={summary.onHoldQty ? kg(summary.onHoldQty) : undefined} tone={summary.onHoldLines ? 'warn' : undefined} />
            <Stat label="Next due" value={summary.nextRequestedOn ?? '—'} />
            <Stat label="Blanket lines" value={String(summary.blanketLines)} sub="contracts" />
          </div>

          <Panel title="Sales orders" icon={FileText}
            meta={`${soLines.length} line${soLines.length === 1 ? '' : 's'} · a job card can only be raised against one of these`}>
            {soLines.length === 0
              ? <Empty>No sales orders synced for this customer.</Empty>
              : <OrderTable rows={soLines} />}
          </Panel>

          {blanketLines.length > 0 && (
            <Panel title="Blanket orders" icon={FileText}
              meta="contracts — shown so you can see what an SO was released against, never counted as production">
              <OrderTable rows={blanketLines} />
            </Panel>
          )}
        </>
      )}

      <Panel title="Labels" icon={Tags} meta={`${labels.length} template${labels.length === 1 ? '' : 's'}`}>
        {labels.length === 0 ? <Empty>No labels carry this customer&apos;s name.</Empty> : (
          <ul className="divide-y divide-surface-rule/60">
            {labels.map(l => (
              <li key={l.id}>
                <Link href={`/pasteuriser/labels/${l.id}`}
                  className="flex items-center gap-3 px-1 py-2 text-[13px] hover:text-brand">
                  <span className="flex-1 min-w-0 truncate text-text">{l.name}</span>
                  <span className="font-mono text-[10px] text-text-faint">{l.code} · v{l.version}</span>
                  <span className="text-[11px] text-text-muted capitalize">{l.status.replace(/_/g, ' ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Quality specs" icon={ClipboardCheck} meta={`${specs.length} spec${specs.length === 1 ? '' : 's'}`}>
        {specs.length === 0 ? <Empty>No specs recorded for this customer.</Empty> : (
          <ul className="divide-y divide-surface-rule/60">
            {specs.map(s => (
              <li key={String(s.id)} className="flex items-center gap-3 px-1 py-2 text-[13px]">
                <span className="flex-1 min-w-0 truncate text-text">{s.product ?? '—'}</span>
                <span className="font-mono text-[10px] text-text-faint">{s.doc_no ?? '—'}{s.revision ? ` rev ${s.revision}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

function RepPicker({ value, valueName, people, canManage, busy, onChange }: {
  value: string | null; valueName: string | null; people: SalesPerson[]
  canManage: boolean; busy: boolean; onChange: (id: string | null) => void
}) {
  if (!canManage) {
    return <span className="text-[13px] text-text">{valueName ?? <span className="italic text-text-faint">Unassigned</span>}</span>
  }
  const linkable = people.filter(p => p.employeeId)
  const unlinked = people.filter(p => !p.employeeId)
  return (
    <div className="space-y-1">
      <select value={value ?? ''} disabled={busy}
        onChange={e => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-surface-rule bg-surface px-2 py-1.5 text-[13px] text-text">
        <option value="">Unassigned</option>
        {/* Whoever currently holds it, even if they have since left Sales — an
            assignment must never become uneditable because the holder moved. */}
        {value && !linkable.some(p => p.employeeId === value) && (
          <option value={value}>{valueName ?? 'Current holder'} (not in Sales)</option>
        )}
        {linkable.map(p => <option key={p.employeeId!} value={p.employeeId!}>{p.name}</option>)}
      </select>
      {linkable.length === 0 && (
        <p className="text-[11px] text-amber-700">
          Nobody in the Sales department has a Staff Directory link yet, so there is nobody to
          assign. Departments are set on a user&apos;s role; the link is made from the Staff Directory.
        </p>
      )}
      {unlinked.length > 0 && (
        <p className="text-[11px] text-text-faint">
          In Sales but not selectable, no Staff Directory link: {unlinked.map(p => p.name).join(', ')}
        </p>
      )}
    </div>
  )
}

function AcumaticaPicker({ value, options, canManage, busy, onChange }: {
  value: string | null; options: { id: string; name: string; lines: number }[]
  canManage: boolean; busy: boolean; onChange: (id: string | null) => void
}) {
  const current = options.find(o => o.id === value)
  if (!canManage) {
    return (
      <span className="text-[13px] text-text">
        {value ? <>{current?.name ?? value} <span className="font-mono text-[10px] text-text-faint">{value}</span></>
               : <span className="italic text-text-faint">Not linked</span>}
      </span>
    )
  }
  return (
    <div className="space-y-1">
      <select value={value ?? ''} disabled={busy}
        onChange={e => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-surface-rule bg-surface px-2 py-1.5 text-[13px] text-text">
        <option value="">Not linked</option>
        {value && !current && <option value={value}>{value} (no orders synced)</option>}
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.name} — {o.id} ({o.lines})</option>
        ))}
      </select>
      <p className="text-[11px] text-text-faint">
        <Link2 size={10} className="inline -mt-0.5 mr-0.5" />
        Names cannot be matched automatically — OTG is Ostfriesische Tee Gesellschaft. Pick the
        Acumatica customer this account is.
      </p>
    </div>
  )
}

// ── Chrome ───────────────────────────────────────────────────────────────────

function OrderTable({ rows }: { rows: OrderLine[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[640px]">
        <thead>
          <tr>
            {['Order', 'Status', 'Item', 'Qty', 'Customer PO', 'Requested'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-mono text-[9px] font-semibold text-text-faint uppercase tracking-[0.06em] whitespace-nowrap ${i === 3 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-rule/60">
          {rows.map(l => (
            <tr key={`${l.order_nbr}-${l.line_nbr}`}>
              <td className="px-2 py-1.5 font-mono text-[12px] text-text whitespace-nowrap">{l.order_nbr}</td>
              <td className="px-2 py-1.5 text-[12px] whitespace-nowrap">
                <span className={l.status === 'Open' ? 'text-emerald-700' : l.status === 'On Hold' ? 'text-amber-700' : 'text-text-muted'}>
                  {l.status ?? '—'}
                </span>
              </td>
              <td className="px-2 py-1.5 text-[12px] text-text-muted">
                {l.line_desc ?? '—'}
                {l.inventory_id && <span className="block font-mono text-[10px] text-text-faint">{l.inventory_id}</span>}
              </td>
              <td className="px-2 py-1.5 font-mono text-[12px] text-text text-right tabular-nums whitespace-nowrap">
                {l.order_qty?.toLocaleString() ?? '—'} {l.uom ?? ''}
              </td>
              <td className="px-2 py-1.5 text-[12px] text-text-muted whitespace-nowrap">{l.customer_order ?? '—'}</td>
              <td className="px-2 py-1.5 font-mono text-[11px] text-text-muted whitespace-nowrap">{l.requested_on ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Panel({ title, meta, icon: Icon, children }: {
  title: string; meta?: string; icon: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-display font-bold text-[15px] text-text inline-flex items-center gap-1.5">
          <Icon size={14} className="text-text-faint" /> {title}
        </h2>
        {meta && <span className="text-[11px] text-text-faint">{meta}</span>}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="card p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-faint">{label}</p>
      <p className={`font-display font-bold text-xl mt-0.5 tabular-nums ${tone === 'warn' ? 'text-amber-700' : 'text-text'}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-faint">{sub}</p>}
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) =>
  <p className="text-[13px] text-text-muted py-2">{children}</p>

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-faint mb-1">{label}</p>
    {children}
  </div>
)

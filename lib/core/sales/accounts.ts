/**
 * A sales account, and what its Acumatica order book says about it.
 *
 * Pure arithmetic over rows the app has already fetched — no I/O, no React.
 * The accounts list and the single-account dashboard must agree on what "open"
 * means and on which order types can carry a job card; two screens deciding
 * that separately is how one of them ends up quietly counting a blanket order
 * as production work.
 */

/** Acumatica order types seen in CNTP's tenant, 2026-09-09. */
export type OrderType = 'SO' | 'BL' | 'RM' | 'TR' | string

/**
 * A job card is raised against a SALES ORDER and nothing else.
 *
 * A blanket order is a contract, not an instruction to make something:
 * BH-BSO0000014 is Kunitaro's "2026 SECOND HALF CONTRACT", 30 000 units with
 * 25 000 still open — 540 tonnes against a paper job card of 18 000 kg.
 * Individual SOs are released against it as shipments happen, and those are
 * what the floor makes.
 *
 * Blanket orders are still shown, as context, so a rep can see what an SO was
 * released against. They are never counted as production.
 */
export const JOB_CARD_ORDER_TYPE = 'SO'

/** Acumatica statuses that mean the line is still live work. */
const LIVE_STATUSES = new Set(['Open', 'Back Order'])

/** One line of acumatica.sales_orders, as much of it as this module reads. */
export interface OrderLine {
  order_type: OrderType
  order_nbr: string
  line_nbr: number
  status: string | null
  customer_id: string | null
  customer_name: string | null
  customer_order: string | null
  inventory_id: string | null
  line_desc: string | null
  order_qty: number | null
  uom: string | null
  requested_on: string | null   // yyyy-mm-dd
  order_date: string | null     // yyyy-mm-dd
}

export interface AccountOrderSummary {
  /** Lines that can carry a job card: type SO, status Open or Back Order. */
  liveLines: number
  liveQty: number
  /** Type SO, status On Hold. Real demand, not yet releasable. */
  onHoldLines: number
  onHoldQty: number
  /** Contracts. Never counted as production — see JOB_CARD_ORDER_TYPE. */
  blanketLines: number
  blanketQty: number
  /** Anything else Acumatica returned (RM, TR …), so nothing is silently dropped. */
  otherLines: number
  /** Earliest requested date across the live lines — what is due first. */
  nextRequestedOn: string | null
  /** Distinct SO numbers with live lines, newest-looking first. */
  liveOrderNbrs: string[]
}

export function emptySummary(): AccountOrderSummary {
  return {
    liveLines: 0, liveQty: 0,
    onHoldLines: 0, onHoldQty: 0,
    blanketLines: 0, blanketQty: 0,
    otherLines: 0,
    nextRequestedOn: null,
    liveOrderNbrs: [],
  }
}

const qty = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/**
 * Summarise one account's order lines.
 *
 * Every line lands in exactly one bucket, and `otherLines` catches the types
 * this module was not written for. A summary that silently ignored RM and TR
 * would read as complete while under-reporting the book.
 */
export function summariseOrders(lines: readonly OrderLine[]): AccountOrderSummary {
  const out = emptySummary()
  const liveNbrs = new Set<string>()

  for (const l of lines) {
    const q = qty(l.order_qty)
    if (l.order_type === 'BL') {
      out.blanketLines++
      out.blanketQty += q
      continue
    }
    if (l.order_type !== JOB_CARD_ORDER_TYPE) {
      out.otherLines++
      continue
    }
    if (LIVE_STATUSES.has(l.status ?? '')) {
      out.liveLines++
      out.liveQty += q
      liveNbrs.add(l.order_nbr)
      // Earliest requested date wins — that is the next thing due, and a null
      // date must never beat a real one.
      if (l.requested_on && (!out.nextRequestedOn || l.requested_on < out.nextRequestedOn)) {
        out.nextRequestedOn = l.requested_on
      }
    } else {
      out.onHoldLines++
      out.onHoldQty += q
    }
  }

  // Descending: Acumatica numbers ascend over time, so the newest order reads
  // first without needing a date on every line.
  out.liveOrderNbrs = [...liveNbrs].sort().reverse()
  return out
}

/** Group order lines by Acumatica customer id. Lines with no id are dropped —
 *  they cannot be attributed to an account, and guessing is what the explicit
 *  `acumatica_customer_id` link exists to avoid. */
export function ordersByCustomerId(lines: readonly OrderLine[]): Map<string, OrderLine[]> {
  const m = new Map<string, OrderLine[]>()
  for (const l of lines) {
    const id = (l.customer_id ?? '').trim()
    if (!id) continue
    const list = m.get(id)
    if (list) list.push(l)
    else m.set(id, [l])
  }
  return m
}

// ── The accounts list ────────────────────────────────────────────────────────

export interface SalesAccount {
  name: string
  salesRepEmployeeId: string | null
  salesRepName: string | null
  acumaticaCustomerId: string | null
}

export interface AccountRow extends SalesAccount {
  mine: boolean
  /** False when acumaticaCustomerId is null — the account has no order book to
   *  read, which is different from having an empty one. */
  linked: boolean
  orders: AccountOrderSummary
}

export type AccountFilter = 'mine' | 'unassigned' | 'all'

/**
 * Build the rows the accounts list renders.
 *
 * Own accounts first, then alphabetical — the same ordering rule the label
 * library uses, for the same reason: a rep opens this page to see their own
 * customers and should not have to scan past everyone else's.
 *
 * A viewer with no Staff Directory link owns nothing, rather than everything.
 */
export function buildAccountRows(
  accounts: readonly SalesAccount[],
  ordersById: ReadonlyMap<string, OrderLine[]>,
  viewerEmployeeId: string | null,
): AccountRow[] {
  const rows = accounts.map<AccountRow>(a => ({
    ...a,
    mine: !!viewerEmployeeId && a.salesRepEmployeeId === viewerEmployeeId,
    linked: !!a.acumaticaCustomerId,
    orders: a.acumaticaCustomerId
      ? summariseOrders(ordersById.get(a.acumaticaCustomerId) ?? [])
      : emptySummary(),
  }))

  const byName = (a: AccountRow, b: AccountRow) => a.name.localeCompare(b.name)
  return [...rows.filter(r => r.mine).sort(byName), ...rows.filter(r => !r.mine).sort(byName)]
}

/** Apply the list's filter and free-text search. */
export function filterAccounts(
  rows: readonly AccountRow[],
  filter: AccountFilter,
  search: string,
): AccountRow[] {
  const needle = search.trim().toLowerCase()
  return rows.filter(r => {
    if (filter === 'mine' && !r.mine) return false
    if (filter === 'unassigned' && r.salesRepEmployeeId) return false
    if (!needle) return true
    // The rep's name is searchable too, so "who has Shaun's accounts" is one
    // question rather than a filter plus a scan.
    return `${r.name} ${r.salesRepName ?? ''} ${r.acumaticaCustomerId ?? ''}`
      .toLowerCase().includes(needle)
  })
}

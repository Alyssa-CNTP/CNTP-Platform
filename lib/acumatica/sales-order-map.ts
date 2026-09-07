// Mapping an Acumatica SalesOrder payload into acumatica.sales_orders rows.
//
// PURE — no network, no database, no imports with side effects. Split out from
// sales-order-sync.ts because that module builds the Supabase admin client at
// import time, which needs service-role env vars and therefore cannot be
// imported by a unit test. The mapping is the part most likely to be wrong and
// the part most worth testing, so it does not live behind that.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// A pasteuriser job card is an instruction to produce one customer's sales
// order, and every field at the top of the paper card comes from that order:
// customer, job card number, item, quantity, customer PO, dates. Today someone
// retypes them.
//
// The job card number in particular is Acumatica's, not ours. The paper card is
// numbered 26252 and its batch number is 26252-CON-SFC — the batch number
// embeds the order number, so a locally-minted `JC-2026-0001` would produce
// batch numbers matching nothing in the ERP.
//
// ── Field names VERIFIED against the live tenant, 2026-09-07 ────────────────
//
// Probed Default/24.200.001. Most of the guessed names were right. Two were not,
// and one of those was serious:
//
//   CustomerName  DOES NOT EXIST on the header. There is only CustomerID
//                 ("C-KUN001"). Every row would have had a null customer, which
//                 breaks the one thing this sync is for. The name now comes from
//                 a separate Customer fetch, passed in as a map.
//   OrderNbr      is "BH-BSO0000002" on the sampled record, not "26252" — that
//                 sample is OrderType "BL" (a blanket order). Job card 26252 is
//                 presumably an "SO". The number format therefore varies BY
//                 ORDER TYPE, so order_type is part of the key and must be shown
//                 wherever a number is.
//
// ── ⚠ THE UOM TRAP ──────────────────────────────────────────────────────────
//
// OrderQty is in the line's UOM, and the UOM on real lines is "BV18KG" — an
// 18kg bulk vessel. OrderQty 3000 is 3000 BAGS, i.e. 54 000 kg, not 3000 kg.
// The paper job card says the same thing from the other side: 18 000 kg total,
// 18 kg per bag, 1000 bags.
//
// NEVER treat order_qty as a mass. Anything showing kg has to multiply by the
// UOM's weight, and that conversion does not live here.
//
// This was written without Acumatica credentials in the environment — only
// ACUMATICA_BASE_URL and ACUMATICA_COMPANY are set locally, so
// getAcumaticaRestConfig() returns null and no live call could be made to see
// what the CNTP endpoint actually returns.
//
// The names are Acumatica's standard contract-based SalesOrder entity. The
// CNTP endpoint is a CUSTOM endpoint and may differ — that is not hypothetical,
// it is exactly what happened with LotDetail, which carried Variant, TeaCourt,
// HarvestYear and LandName that no standard schema would have predicted.
//
// So: `mapLine` is deliberately tolerant (a missing field maps to null rather
// than throwing), the whole raw line is kept in the `raw` column, and the route
// has a PROBE mode that returns the first record untouched. Run the probe once
// against the real endpoint, read the actual field names, and correct the map
// here. Do not assume this is right because it compiles.

/** Statuses worth pulling (used by the sync; here so the two stay together). Completed orders stay in the table once synced —
 *  the upsert never deletes — but there is no reason to keep re-fetching years
 *  of history on every run. */
export const OPEN_STATUSES = ['Open', 'Back Order', 'On Hold']

function val(v: unknown): string | null {
  if (v === null || v === undefined) return null

  if (typeof v === 'object') {
    /**
     * Acumatica has THREE representations for a field, and the third is the
     * one that bit:
     *
     *   { value: 'BHW' }   a set field
     *   'BHW'              a bare scalar, on some custom endpoints
     *   { }                EMPTY — an object with no `value` key at all
     *
     * The first version fell through on the third case and did String({}),
     * writing the literal text "[object Object]" into ship_via and
     * external_ref for all 147 synced rows. It is not a crash and it is not
     * blank; it is plausible-looking nonsense in a column, which is worse.
     */
    if (!('value' in (v as Record<string, unknown>))) return null
    const inner = (v as { value: unknown }).value
    if (inner === null || inner === undefined || inner === '') return null
    // A nested object is not a scalar and must never be stringified either.
    if (typeof inner === 'object') return null
    return String(inner)
  }

  return v === '' ? null : String(v)
}

function num(v: unknown): number | null {
  const s = val(v)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function date(v: unknown): string | null {
  const s = val(v)
  if (!s) return null

  /**
   * Take the calendar date AS WRITTEN. Do not route it through a Date.
   *
   * Acumatica sends '2026-09-02T00:00:00+02:00' — midnight, SAST. Parsing that
   * and calling toISOString() converts to UTC first, which is 22:00 on the 1st,
   * and the date silently becomes 2026-09-01. A job card dated a day early,
   * from a value that looked completely correct in the payload.
   *
   * The first ten characters ARE the date Acumatica means, in its own locale,
   * and no timezone arithmetic can improve on that (ARCHITECTURE.md §9: a bare
   * conversion is how two screens end up disagreeing about which day a thing
   * belongs to).
   */
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  if (iso) return iso[1]

  // Anything else (a US-style string, say) still has to become a date or null;
  // an unparseable value must not reach a `date` column and fail the batch.
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface SalesOrderRow {
  order_type: string
  order_nbr: string
  line_nbr: number
  status: string | null
  customer_id: string | null
  customer_name: string | null
  customer_order: string | null
  order_date: string | null
  requested_on: string | null
  ship_via: string | null
  order_desc: string | null
  inventory_id: string | null
  line_desc: string | null
  order_qty: number | null
  uom: string | null
  warehouse_id: string | null
  external_ref: string | null
  open_qty: number | null
  completed: boolean
  ship_on: string | null
  raw: unknown
}

type Rec = Record<string, unknown>

/**
 * One order + one of its detail lines -> one row.
 *
 * Exported and pure so it can be tested against a captured payload without a
 * network call — which is the only way to test this until the endpoint is
 * reachable.
 */
export function mapLine(
  order: Rec,
  line: Rec,
  index: number,
  /** CustomerID -> name. The header has no CustomerName; see the note above. */
  customerNames?: ReadonlyMap<string, string>,
): SalesOrderRow | null {
  const orderNbr = val(order.OrderNbr)
  // Without an order number the row has no identity and cannot be upserted.
  // Skipping is right: one malformed order must not fail the batch.
  if (!orderNbr) return null

  return {
    order_type:     val(order.OrderType) ?? 'SO',
    order_nbr:      orderNbr,
    // LineNbr is Acumatica's; the index is a fallback so a payload without it
    // still produces stable, distinct keys within one order.
    line_nbr:       num(line.LineNbr) ?? index + 1,
    status:         val(order.Status),
    customer_id:    val(order.CustomerID),
    // Resolved, never read off the order — the field is not there.
    customer_name:  (() => {
      const id = val(order.CustomerID)
      return id ? customerNames?.get(id) ?? null : null
    })(),
    customer_order: val(order.CustomerOrder),
    order_date:     date(order.Date),
    requested_on:   date(order.RequestedOn),
    ship_via:       val(order.ShipVia),
    order_desc:     val(order.Description),
    inventory_id:   val(line.InventoryID),
    line_desc:      val(line.LineDescription) ?? val(line.Description),
    order_qty:      num(line.OrderQty) ?? num(line.Quantity),
    uom:            val(line.UOM),
    warehouse_id:   val(line.WarehouseID),
    external_ref:   val(order.ExternalRef),
    // Per LINE, not per order: one line of an order can be finished while
    // another is still open, and a job card is raised against a line.
    open_qty:       num(line.OpenQty),
    completed:      val(line.Completed) === 'true',
    ship_on:        date(line.ShipOn) ?? date(line.SchedOrderDate),
    raw:            line,
  }
}

/** Flatten an Acumatica SalesOrder payload into rows. Pure, so it is testable. */
export function rowsFromPayload(
  data: unknown,
  customerNames?: ReadonlyMap<string, string>,
): SalesOrderRow[] {
  const orders = (Array.isArray(data) ? data : [data]) as Rec[]
  const rows: SalesOrderRow[] = []
  for (const order of orders) {
    if (!order || typeof order !== 'object') continue
    const details = (order.Details ?? order.SalesOrderDetails ?? []) as Rec[]
    if (!Array.isArray(details) || details.length === 0) {
      // A header with no lines is still worth recording: the job card picker
      // shows the order, and the line arrives on the next sync.
      const r = mapLine(order, {}, 0, customerNames)
      if (r) rows.push(r)
      continue
    }
    details.forEach((line, i) => {
      const r = mapLine(order, line ?? {}, i, customerNames)
      if (r) rows.push(r)
    })
  }
  return rows
}


/**
 * CustomerID -> CustomerName, from an Acumatica Customer payload.
 *
 * Separate call because SalesOrder carries only the id. Pure so the shape can
 * be tested without a network call, same reason as the rest of this module.
 */
export function customerNameMap(data: unknown): Map<string, string> {
  const out = new Map<string, string>()
  for (const c of (Array.isArray(data) ? data : [data]) as Rec[]) {
    if (!c || typeof c !== 'object') continue
    const id = val(c.CustomerID)
    const name = val(c.CustomerName)
    if (id && name) out.set(id, name)
  }
  return out
}

/**
 * The fields the mapper reads — and therefore the only ones worth asking for.
 *
 * Kept HERE, next to mapLine, so the query and the mapping cannot drift: a
 * field added to one without the other is the bug where a column silently goes
 * null forever.
 *
 * Without a $select Acumatica returns everything: the sampled order carried ~50
 * header fields and ~55 per line, of which this uses 16. On every open order,
 * expanded, that is the difference between a response and a 504.
 */
export const SELECT_HEADER = [
  'OrderType', 'OrderNbr', 'Status', 'CustomerID', 'CustomerOrder',
  'Date', 'RequestedOn', 'ShipVia', 'Description', 'ExternalRef',
] as const

export const SELECT_LINE = [
  'LineNbr', 'InventoryID', 'LineDescription', 'OrderQty', 'OpenQty',
  'Completed', 'UOM', 'WarehouseID', 'ShipOn', 'SchedOrderDate',
] as const

/** `$select` for a SalesOrder query with Details expanded. */
export function salesOrderSelect(): string {
  return [...SELECT_HEADER, ...SELECT_LINE.map(f => `Details/${f}`)].join(',')
}

import { describe, it, expect } from 'vitest'
import { mapLine, rowsFromPayload } from './sales-order-map'

/**
 * The payload mapping, on synthetic records.
 *
 * ── What these can and cannot prove ─────────────────────────────────────────
 *
 * They CANNOT prove the field names are right. No credentials were available
 * when this was written, so the names are Acumatica's standard SalesOrder
 * entity and the CNTP endpoint is a custom one that may differ — the LotDetail
 * endpoint did. `?probe=1` on the route exists to settle that against the real
 * thing.
 *
 * They CAN prove the mapper survives the shapes Acumatica actually sends: the
 * { value: … } scalar wrapper, missing optional fields, an order with no
 * detail lines, and an unparseable date. Every one of those, unhandled, poisons
 * a whole upsert batch and loses the good rows with it — which is the failure
 * worth pinning before the endpoint is even reachable.
 *
 * The fixture below is the paper job card for Kunitaro order 26252, so the
 * expected values are checkable against a real document rather than invented.
 */

/** Acumatica wraps scalars. */
const v = (value: unknown) => ({ value })

const KUNITARO_26252 = {
  OrderType:     v('SO'),
  OrderNbr:      v('26252'),
  Status:        v('Open'),
  CustomerID:    v('KUNITARO'),
  CustomerName:  v('Kunitaro'),
  CustomerOrder: v('KTR 1020'),
  Date:          v('2026-09-02T00:00:00+02:00'),
  RequestedOn:   v('2026-09-15T00:00:00+02:00'),
  Description:   v('Rooibos Super Fine Cut'),
  Details: [
    {
      LineNbr:         v(1),
      InventoryID:     v('30FPSFC-KUN25-C'),
      LineDescription: v('Rooibos Super Fine Cut'),
      OrderQty:        v(18000),
      UOM:             v('KG'),
      WarehouseID:     v('BHW'),
    },
  ],
}

describe('mapLine', () => {
  const [row] = rowsFromPayload(KUNITARO_26252)

  it('reads the paper job card back out of the payload', () => {
    expect(row.order_nbr).toBe('26252')          // this IS the job card number
    expect(row.customer_name).toBe('Kunitaro')
    expect(row.customer_order).toBe('KTR 1020')  // the customer's PO
    expect(row.inventory_id).toBe('30FPSFC-KUN25-C')
    expect(row.line_desc).toBe('Rooibos Super Fine Cut')
    expect(row.order_qty).toBe(18000)
    expect(row.uom).toBe('KG')
  })

  it('reduces timestamps to a date, because the column is a date', () => {
    expect(row.order_date).toBe('2026-09-02')
    expect(row.requested_on).toBe('2026-09-15')
  })

  it('does NOT shift the date through UTC — this was a real off-by-one', () => {
    /**
     * Acumatica sends midnight SAST: '2026-09-02T00:00:00+02:00'. The first
     * implementation did `new Date(s).toISOString().slice(0,10)`, which
     * converts to UTC (22:00 on the 1st) and produced 2026-09-01 — a job card
     * dated a day early, from a payload that looked entirely correct.
     * ARCHITECTURE.md §9 is explicit that this is how two screens end up
     * disagreeing about what day something belongs to.
     */
    const r = mapLine({ OrderNbr: v('1'), Date: v('2026-09-02T00:00:00+02:00') }, {}, 0)
    expect(r?.order_date).toBe('2026-09-02')
  })

  it('holds the date across midnight-adjacent offsets in both directions', () => {
    const early = mapLine({ OrderNbr: v('1'), Date: v('2026-01-01T00:30:00+02:00') }, {}, 0)
    const late  = mapLine({ OrderNbr: v('1'), Date: v('2026-12-31T23:30:00+02:00') }, {}, 0)
    expect(early?.order_date).toBe('2026-01-01')
    expect(late?.order_date).toBe('2026-12-31')
  })

  it('keeps the raw line, so an unmapped custom field is not lost', () => {
    expect(row.raw).toEqual(KUNITARO_26252.Details[0])
  })

  it('unwraps { value } but also accepts a bare scalar', () => {
    // Not every custom endpoint wraps. LotDetail's did; assuming it always
    // happens would turn every field into the string "[object Object]".
    const bare = mapLine({ OrderNbr: '9', OrderType: 'SO' }, { InventoryID: 'X' }, 0)
    expect(bare?.order_nbr).toBe('9')
    expect(bare?.inventory_id).toBe('X')
  })

  it('treats an empty string as absent, not as a value', () => {
    const r = mapLine({ OrderNbr: v('9'), CustomerName: v('') }, {}, 0)
    expect(r?.customer_name).toBeNull()
  })

  it('nulls an unparseable date rather than poisoning the batch', () => {
    // A bad string reaching a `date` column fails the WHOLE upsert, taking
    // every good row with it.
    const r = mapLine({ OrderNbr: v('9'), Date: v('not a date') }, {}, 0)
    expect(r?.order_date).toBeNull()
  })

  it('nulls a non-numeric quantity for the same reason', () => {
    const r = mapLine({ OrderNbr: v('9') }, { OrderQty: v('TBC') }, 0)
    expect(r?.order_qty).toBeNull()
  })

  it('skips a line with no order number — it has no identity to upsert on', () => {
    expect(mapLine({ Status: v('Open') }, { InventoryID: v('X') }, 0)).toBeNull()
  })

  it('defaults the order type rather than dropping the row', () => {
    expect(mapLine({ OrderNbr: v('9') }, {}, 0)?.order_type).toBe('SO')
  })

  it('falls back to the array index when LineNbr is absent', () => {
    // The key is (order_type, order_nbr, line_nbr); a null there collides every
    // line of an order onto one row.
    const rows = rowsFromPayload({
      OrderNbr: v('9'), Details: [{ InventoryID: v('A') }, { InventoryID: v('B') }],
    })
    expect(rows.map(r => r.line_nbr)).toEqual([1, 2])
  })
})

describe('rowsFromPayload', () => {
  it('handles a single record and an array identically', () => {
    expect(rowsFromPayload([KUNITARO_26252])).toEqual(rowsFromPayload(KUNITARO_26252))
  })

  it('keeps a header that has no lines yet', () => {
    // The job card picker should still show the order; the line arrives on the
    // next sync rather than the order being invisible until then.
    const rows = rowsFromPayload({ OrderNbr: v('26253'), CustomerName: v('Lupicia') })
    expect(rows).toHaveLength(1)
    expect(rows[0].inventory_id).toBeNull()
    expect(rows[0].customer_name).toBe('Lupicia')
  })

  it('accepts SalesOrderDetails as well as Details', () => {
    const rows = rowsFromPayload({
      OrderNbr: v('9'), SalesOrderDetails: [{ InventoryID: v('A') }],
    })
    expect(rows[0].inventory_id).toBe('A')
  })

  it('expands a multi-line order — the flavoured-tea case', () => {
    // An order needing several final-product BOMs is several lines under one
    // order number, and each must survive as its own row.
    const rows = rowsFromPayload({
      OrderNbr: v('26260'),
      Details: [
        { LineNbr: v(1), InventoryID: v('30FP-A') },
        { LineNbr: v(2), InventoryID: v('30FP-B') },
        { LineNbr: v(3), InventoryID: v('30FP-C') },
      ],
    })
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.order_nbr === '26260')).toBe(true)
    expect(rows.map(r => r.inventory_id)).toEqual(['30FP-A', '30FP-B', '30FP-C'])
  })

  it('survives junk in the array instead of throwing', () => {
    const rows = rowsFromPayload([null, undefined, 'nonsense', KUNITARO_26252])
    expect(rows).toHaveLength(1)
  })

  it('returns nothing for an empty payload', () => {
    expect(rowsFromPayload([])).toEqual([])
  })
})

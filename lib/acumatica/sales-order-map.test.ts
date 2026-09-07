import { describe, it, expect } from 'vitest'
import {
  mapLine, rowsFromPayload, customerNameMap,
  salesOrderSelect, SELECT_HEADER, SELECT_LINE,
} from './sales-order-map'

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
  // No CustomerName — the live header does not have one. Resolved via the map.
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

/** Stands in for the separate Customer fetch the sync performs. */
const NAMES = new Map([['KUNITARO', 'Kunitaro'], ['LUPICIA', 'Lupicia']])

describe('mapLine', () => {
  const [row] = rowsFromPayload(KUNITARO_26252, NAMES)

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
    const rows = rowsFromPayload({ OrderNbr: v('26253'), CustomerID: v('LUPICIA') }, NAMES)
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


/**
 * The REAL payload, captured from Default/24.200.001 on 2026-09-07.
 *
 * Trimmed to the fields the mapper reads plus the ones that caught it out. This
 * is the fixture that matters: everything above was written from a guess at the
 * schema, and two of those guesses were wrong.
 */
const LIVE_BLANKET_ORDER = {
  OrderType:     v('BL'),
  OrderNbr:      v('BH-BSO0000002'),
  Status:        v('Completed'),
  CustomerID:    v('C-KUN001'),
  // NOTE: there is NO CustomerName on the header. That was the bug.
  CustomerOrder: v('2025 Contract Remainder'),
  ExternalRef:   v('2025 Contract Remainder'),
  Date:          v('2026-01-06T00:00:00+00:00'),
  RequestedOn:   v('2026-01-06T00:00:00+00:00'),
  Description:   v('2025 Contract Remainder'),
  OrderedQty:    v(4480),
  Details: [
    {
      LineNbr: v(1), InventoryID: v('30FPSFC-001A-O'),
      LineDescription: v('Organic - Super Fine Cut'),
      OrderQty: v(480), OpenQty: v(0), Completed: v(true),
      UOM: v('BV18KG'), WarehouseID: v('BHW'),
      ShipOn: v('2026-01-06T00:00:00+00:00'),
    },
    {
      LineNbr: v(5), InventoryID: v('30FPSFC-KUN25-C'),
      LineDescription: v('Super Fine Cut'),
      OrderQty: v(3000), OpenQty: v(0), Completed: v(true),
      UOM: v('BV18KG'), WarehouseID: v('BHW'),
      ShipOn: v('2026-01-06T00:00:00+00:00'),
    },
  ],
}

describe('the live payload', () => {
  it('has NO CustomerName — the header only carries an id', () => {
    // Pinning the absence, because the first mapper read order.CustomerName and
    // silently produced null for every row.
    expect('CustomerName' in LIVE_BLANKET_ORDER).toBe(false)
  })

  it('resolves the customer name from a separate Customer fetch', () => {
    const names = customerNameMap([
      { CustomerID: v('C-KUN001'), CustomerName: v('Kunitaro') },
      { CustomerID: v('C-LIP001'), CustomerName: v('Lipton and Infusion') },
    ])
    const [row] = rowsFromPayload(LIVE_BLANKET_ORDER, names)
    expect(row.customer_id).toBe('C-KUN001')
    expect(row.customer_name).toBe('Kunitaro')
  })

  it('leaves the name null rather than failing when the lookup is unavailable', () => {
    // The Customer fetch is best-effort; an order with no display name beats no
    // order at all.
    const [row] = rowsFromPayload(LIVE_BLANKET_ORDER)
    expect(row.customer_name).toBeNull()
    expect(row.customer_id).toBe('C-KUN001')
  })

  it('keeps the order type, because the number format depends on it', () => {
    // BH-BSO0000002 is a BL (blanket). Job card 26252 is presumably an SO, so
    // the number alone does not identify an order.
    const [row] = rowsFromPayload(LIVE_BLANKET_ORDER)
    expect(row.order_type).toBe('BL')
    expect(row.order_nbr).toBe('BH-BSO0000002')
  })

  it('keeps qty in the LINE UOM and never pretends it is kilograms', () => {
    // UOM BV18KG is an 18kg bulk vessel: 3000 is 3000 BAGS = 54 000 kg.
    const rows = rowsFromPayload(LIVE_BLANKET_ORDER)
    const line = rows.find(r => r.inventory_id === '30FPSFC-KUN25-C')!
    expect(line.order_qty).toBe(3000)
    expect(line.uom).toBe('BV18KG')
  })

  it('reads per-line completion, not the order status', () => {
    const rows = rowsFromPayload(LIVE_BLANKET_ORDER)
    expect(rows.every(r => r.completed)).toBe(true)
    expect(rows.every(r => r.open_qty === 0)).toBe(true)
  })

  it('expands both lines under one order number, keeping Acumatica LineNbr', () => {
    // LineNbr is 1 and 5 — not contiguous. Using the array index would collide
    // them with a re-synced order whose lines were renumbered.
    const rows = rowsFromPayload(LIVE_BLANKET_ORDER)
    expect(rows.map(r => r.line_nbr)).toEqual([1, 5])
  })

  it('does not shift the date, even on a +00:00 payload', () => {
    const [row] = rowsFromPayload(LIVE_BLANKET_ORDER)
    expect(row.order_date).toBe('2026-01-06')
    expect(row.ship_on).toBe('2026-01-06')
  })
})

describe('customerNameMap', () => {
  it('skips entries missing either side', () => {
    const m = customerNameMap([
      { CustomerID: v('A'), CustomerName: v('Alpha') },
      { CustomerID: v('B') },
      { CustomerName: v('Orphan') },
      null,
    ])
    expect([...m.entries()]).toEqual([['A', 'Alpha']])
  })
})


describe('salesOrderSelect', () => {
  /**
   * The $select and the mapper must not drift. A field read by mapLine but
   * missing from the select comes back undefined from Acumatica and the column
   * goes null forever — silently, exactly like CustomerName did.
   */
  it('asks for every header field the mapper reads', () => {
    for (const f of ['OrderType', 'OrderNbr', 'Status', 'CustomerID',
                     'CustomerOrder', 'Date', 'RequestedOn', 'ExternalRef']) {
      expect(SELECT_HEADER, `${f} is mapped but not selected`).toContain(f)
    }
  })

  it('asks for every line field the mapper reads', () => {
    for (const f of ['LineNbr', 'InventoryID', 'LineDescription', 'OrderQty',
                     'OpenQty', 'Completed', 'UOM', 'WarehouseID']) {
      expect(SELECT_LINE, `${f} is mapped but not selected`).toContain(f)
    }
  })

  it('does NOT ask for CustomerName — it is not on the entity', () => {
    expect(SELECT_HEADER).not.toContain('CustomerName')
  })

  it('prefixes line fields with Details/, which is how Acumatica scopes them', () => {
    const sel = salesOrderSelect()
    expect(sel).toContain('Details/InventoryID')
    expect(sel).toContain('OrderNbr')
    expect(sel).not.toContain('Details/OrderNbr')
  })

  it('stays far smaller than the ~105 fields an unselected record returns', () => {
    // The unbounded, unselected query is what produced the 504.
    expect(SELECT_HEADER.length + SELECT_LINE.length).toBeLessThan(30)
  })
})


describe('the three ways Acumatica represents a field', () => {
  /**
   * The live sync wrote the literal string "[object Object]" into ship_via and
   * external_ref on all 147 rows, because an EMPTY Acumatica field is `{}` — an
   * object with no `value` key — and the mapper stringified it.
   *
   * Not a crash, not a blank: plausible-looking nonsense in a column, which is
   * the kind of thing that survives review and reaches a job card.
   */
  it('reads a wrapped scalar', () => {
    expect(mapLine({ OrderNbr: v('1'), ShipVia: v('ROAD') }, {}, 0)?.ship_via).toBe('ROAD')
  })

  it('reads a bare scalar', () => {
    expect(mapLine({ OrderNbr: '1', ShipVia: 'ROAD' }, {}, 0)?.ship_via).toBe('ROAD')
  })

  it('treats {} as EMPTY, not as "[object Object]"', () => {
    const r = mapLine({ OrderNbr: v('1'), ShipVia: {}, ExternalRef: {} }, {}, 0)
    expect(r?.ship_via).toBeNull()
    expect(r?.external_ref).toBeNull()
  })

  it('never stringifies a nested object', () => {
    const r = mapLine({ OrderNbr: v('1'), ShipVia: { value: { deep: 1 } } }, {}, 0)
    expect(r?.ship_via).toBeNull()
  })

  it('does the same for numbers', () => {
    const r = mapLine({ OrderNbr: v('1') }, { OrderQty: {}, OpenQty: {} }, 0)
    expect(r?.order_qty).toBeNull()
    expect(r?.open_qty).toBeNull()
  })

  it('and for dates', () => {
    expect(mapLine({ OrderNbr: v('1'), Date: {} }, {}, 0)?.order_date).toBeNull()
  })

  it('no mapped string field can ever be "[object Object]"', () => {
    // The invariant, over a record where every optional field is empty.
    const empty: Record<string, unknown> = {}
    for (const f of [...SELECT_HEADER]) empty[f] = {}
    empty.OrderNbr = v('1')
    const line: Record<string, unknown> = {}
    for (const f of [...SELECT_LINE]) line[f] = {}
    const r = mapLine(empty, line, 0)!
    for (const [k, value] of Object.entries(r)) {
      if (k === 'raw') continue
      expect(String(value), `${k} stringified an object`).not.toContain('[object Object]')
    }
  })
})

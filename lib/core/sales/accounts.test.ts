import { describe, it, expect } from 'vitest'
import {
  summariseOrders, ordersByCustomerId, buildAccountRows, filterAccounts,
  JOB_CARD_ORDER_TYPE, emptySummary,
  type OrderLine, type SalesAccount,
} from './accounts'

const ALYSSA = 'b72f70cb-a721-4652-9c63-05f6b3ac1e7e'
const SHAUN  = '11111111-2222-3333-4444-555555555555'

let seq = 0
const line = (p: Partial<OrderLine> = {}): OrderLine => ({
  order_type: 'SO',
  order_nbr: `BH-SO000038${seq++}`,
  line_nbr: 1,
  status: 'Open',
  customer_id: 'C-KUN001',
  customer_name: 'Kunitaro Co.  Ltd',
  customer_order: 'KTR 1020',
  inventory_id: '30FPSFC-KUN25-C',
  line_desc: 'Rooibos Super Fine Cut',
  order_qty: 1000,
  uom: 'KG',
  requested_on: '2026-09-20',
  order_date: '2026-09-01',
  ...p,
})

const acct = (p: Partial<SalesAccount> & { name: string }): SalesAccount => ({
  salesRepEmployeeId: null, salesRepName: null, acumaticaCustomerId: null, ...p,
})

describe('summariseOrders', () => {
  it('counts Open and Back Order as live work', () => {
    const s = summariseOrders([
      line({ status: 'Open', order_qty: 100 }),
      line({ status: 'Back Order', order_qty: 50 }),
    ])
    expect(s.liveLines).toBe(2)
    expect(s.liveQty).toBe(150)
  })

  it('keeps On Hold separate — real demand, not releasable', () => {
    const s = summariseOrders([line({ status: 'On Hold', order_qty: 700 })])
    expect(s.liveLines).toBe(0)
    expect(s.onHoldLines).toBe(1)
    expect(s.onHoldQty).toBe(700)
  })

  it('never counts a blanket order as production', () => {
    // BH-BSO0000014: 30 000 units contracted. Counting it as work to do would
    // put 540 tonnes on a dashboard against an 18 000 kg job card.
    const s = summariseOrders([
      line({ order_type: 'BL', status: 'Open', order_qty: 30000 }),
      line({ order_type: 'SO', status: 'Open', order_qty: 1000 }),
    ])
    expect(s.blanketLines).toBe(1)
    expect(s.blanketQty).toBe(30000)
    expect(s.liveLines).toBe(1)
    expect(s.liveQty).toBe(1000)
  })

  it('a job card can only be raised against an SO', () => {
    expect(JOB_CARD_ORDER_TYPE).toBe('SO')
  })

  it('buckets order types it was not written for rather than dropping them', () => {
    // RM and TR are both present in the tenant. A summary that ignored them
    // would read as complete while under-reporting the book.
    const s = summariseOrders([line({ order_type: 'RM' }), line({ order_type: 'TR' })])
    expect(s.otherLines).toBe(2)
    expect(s.liveLines + s.onHoldLines + s.blanketLines).toBe(0)
  })

  it('takes the EARLIEST requested date, and a null never beats a real one', () => {
    const s = summariseOrders([
      line({ requested_on: '2026-10-01' }),
      line({ requested_on: null }),
      line({ requested_on: '2026-09-15' }),
    ])
    expect(s.nextRequestedOn).toBe('2026-09-15')
  })

  it('ignores the requested date of a line that is not live', () => {
    const s = summariseOrders([
      line({ status: 'On Hold', requested_on: '2026-08-01' }),
      line({ status: 'Open',    requested_on: '2026-12-01' }),
    ])
    expect(s.nextRequestedOn).toBe('2026-12-01')
  })

  it('counts distinct order numbers, not lines', () => {
    const s = summariseOrders([
      line({ order_nbr: 'BH-SO0000387', line_nbr: 1 }),
      line({ order_nbr: 'BH-SO0000387', line_nbr: 2 }),
      line({ order_nbr: 'BH-SO0000390', line_nbr: 1 }),
    ])
    expect(s.liveLines).toBe(3)
    expect(s.liveOrderNbrs).toEqual(['BH-SO0000390', 'BH-SO0000387'])
  })

  it('treats a missing or non-numeric quantity as zero, not NaN', () => {
    const s = summariseOrders([line({ order_qty: null }), line({ order_qty: 100 })])
    expect(s.liveQty).toBe(100)
  })
})

describe('ordersByCustomerId', () => {
  it('drops lines with no customer id rather than guessing', () => {
    const m = ordersByCustomerId([
      line({ customer_id: 'C-KUN001' }),
      line({ customer_id: null }),
      line({ customer_id: '  ' }),
    ])
    expect([...m.keys()]).toEqual(['C-KUN001'])
    expect(m.get('C-KUN001')).toHaveLength(1)
  })
})

describe('buildAccountRows', () => {
  const accounts = [
    acct({ name: 'Tanganda', salesRepEmployeeId: SHAUN, salesRepName: 'Shaun De Beer', acumaticaCustomerId: 'C-TAN001' }),
    acct({ name: 'Kunitaro', salesRepEmployeeId: ALYSSA, salesRepName: 'Alyssa Krishna', acumaticaCustomerId: 'C-KUN001' }),
    acct({ name: 'Alveus' }),
    acct({ name: 'Afri Tea and Coffee’s', salesRepEmployeeId: ALYSSA, salesRepName: 'Alyssa Krishna', acumaticaCustomerId: 'C-AFR001' }),
  ]
  const orders = ordersByCustomerId([
    line({ customer_id: 'C-KUN001', order_qty: 1000 }),
    line({ customer_id: 'C-TAN001', order_qty: 200 }),
  ])

  it('puts my accounts first, each half alphabetical', () => {
    const rows = buildAccountRows(accounts, orders, ALYSSA)
    expect(rows.map(r => r.name)).toEqual([
      'Afri Tea and Coffee’s', 'Kunitaro',   // mine, A then K
      'Alveus', 'Tanganda',                        // rest, A then T
    ])
  })

  it('marks an account with no Acumatica link as unlinked, not as having no orders', () => {
    // Those read identically on screen unless the difference is carried here.
    const alveus = buildAccountRows(accounts, orders, ALYSSA).find(r => r.name === 'Alveus')!
    expect(alveus.linked).toBe(false)
    expect(alveus.orders).toEqual(emptySummary())
  })

  it('an account linked to Acumatica with genuinely no orders is linked and empty', () => {
    const rows = buildAccountRows([acct({ name: 'Lupicia', acumaticaCustomerId: 'C-LUP001' })], orders, ALYSSA)
    expect(rows[0].linked).toBe(true)
    expect(rows[0].orders.liveLines).toBe(0)
  })

  it('owns nothing when the viewer has no Staff Directory link', () => {
    const rows = buildAccountRows(accounts, orders, null)
    expect(rows.some(r => r.mine)).toBe(false)
    expect(rows.map(r => r.name)).toEqual(['Afri Tea and Coffee’s', 'Alveus', 'Kunitaro', 'Tanganda'])
  })

  it('never loses an account', () => {
    expect(buildAccountRows(accounts, orders, ALYSSA)).toHaveLength(accounts.length)
  })
})

describe('filterAccounts', () => {
  const rows = buildAccountRows([
    acct({ name: 'Kunitaro', salesRepEmployeeId: ALYSSA, salesRepName: 'Alyssa Krishna', acumaticaCustomerId: 'C-KUN001' }),
    acct({ name: 'Tanganda', salesRepEmployeeId: SHAUN, salesRepName: 'Shaun De Beer' }),
    acct({ name: 'Alveus' }),
  ], new Map(), ALYSSA)

  it('mine shows only my accounts', () => {
    expect(filterAccounts(rows, 'mine', '').map(r => r.name)).toEqual(['Kunitaro'])
  })

  it('unassigned means nobody owns it, not "not mine"', () => {
    expect(filterAccounts(rows, 'unassigned', '').map(r => r.name)).toEqual(['Alveus'])
  })

  it('searches the rep name as well as the customer', () => {
    expect(filterAccounts(rows, 'all', 'shaun').map(r => r.name)).toEqual(['Tanganda'])
  })

  it('searches the Acumatica id, so a code off an order finds its account', () => {
    expect(filterAccounts(rows, 'all', 'c-kun').map(r => r.name)).toEqual(['Kunitaro'])
  })

  it('combines filter and search', () => {
    expect(filterAccounts(rows, 'mine', 'tanganda')).toEqual([])
  })
})

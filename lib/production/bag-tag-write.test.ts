import { describe, it, expect } from 'vitest'
import {
  registerBagTag, appendScanEvent,
  type BagTagWritable, type BagTagWrite,
} from './bag-tag-write'

/** A client that records what it was asked to write. */
function spy(behaviour: { error?: { message: string } | null; throws?: Error } = {}) {
  const calls: { table: string; op: 'upsert' | 'insert'; values: unknown; opts?: unknown }[] = []
  const db: BagTagWritable = {
    schema: () => ({
      from: (table: string) => ({
        upsert: (values: unknown, opts: { onConflict: string }) => {
          calls.push({ table, op: 'upsert', values, opts })
          if (behaviour.throws) return Promise.reject(behaviour.throws)
          return Promise.resolve({ error: behaviour.error ?? null })
        },
        insert: (values: unknown) => {
          calls.push({ table, op: 'insert', values })
          if (behaviour.throws) return Promise.reject(behaviour.throws)
          return Promise.resolve({ error: behaviour.error ?? null })
        },
      }),
    }),
  }
  return { db, calls }
}

const tag: BagTagWrite = {
  serial_number: 'PS-11092026-001',
  section_id: 'pasteuriser',
  product_type: 'Rooibos Super Fine Cut',
  weight_kg: 18000,
  lot_number: '26252-CON-SFC',
}

describe('registerBagTag', () => {
  it('upserts on the serial, never delete-then-insert', async () => {
    const { db, calls } = spy()
    expect(await registerBagTag(db, tag)).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('bag_tags')
    expect(calls[0].op).toBe('upsert')
    expect(calls[0].opts).toEqual({ onConflict: 'serial_number' })
  })

  it('passes the payload through unchanged — no field invented, none dropped', async () => {
    const { db, calls } = spy()
    await registerBagTag(db, tag)
    expect(calls[0].values).toEqual(tag)
  })

  it('RETURNS the failure rather than swallowing it, because the caller must show it', async () => {
    const { db } = spy({ error: { message: 'network down' } })
    expect(await registerBagTag(db, tag)).toBe('network down')
  })

  it('turns a thrown client error into the same reportable string', async () => {
    const { db } = spy({ throws: new Error('offline') })
    expect(await registerBagTag(db, tag)).toBe('offline')
  })
})

describe('appendScanEvent', () => {
  it('appends to the ledger', async () => {
    const { db, calls } = spy()
    await appendScanEvent(db, {
      serial_number: tag.serial_number, action: 'bagging_out',
      section_id: 'pasteuriser', weight_kg: 18000,
    })
    expect(calls[0].table).toBe('scan_events')
    expect(calls[0].op).toBe('insert')
  })

  it('is best-effort: a failure does not throw, because the bag is already saved', async () => {
    const { db } = spy({ throws: new Error('offline') })
    await expect(appendScanEvent(db, {
      serial_number: tag.serial_number, action: 'bagging_out', section_id: 'pasteuriser',
    })).resolves.toBeUndefined()
  })
})

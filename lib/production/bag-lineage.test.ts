import { describe, it, expect } from 'vitest'
import {
  lineageForSession, recordBagLineage,
  type BagLineageWritable, type BagLineageWrite,
} from './bag-lineage'

// ── A stand-in for the Supabase client ───────────────────────────────────────
// Structural, so no module mocking — same approach as bag-tag-write.test.ts.
function fakeDb(opts: {
  held?: { child_serial: string; parent_serial: string; relation: string }[]
  readError?: string
  insertError?: string
  throwOn?: 'read' | 'insert'
} = {}) {
  const inserted: any[][] = []
  const db: BagLineageWritable = {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: async () => {
              if (opts.throwOn === 'read') throw new Error('offline')
              return {
                data: opts.held ?? [],
                error: opts.readError ? { message: opts.readError } : null,
              }
            },
          }),
        }),
        insert: async (values: unknown) => {
          if (opts.throwOn === 'insert') throw new Error('offline')
          inserted.push(values as any[])
          return { error: opts.insertError ? { message: opts.insertError } : null }
        },
      }),
    }),
  } as BagLineageWritable
  return { db, inserted }
}

const link = (child: string, parent: string): BagLineageWrite => ({
  childSerial: child, parentSerial: parent,
  sectionId: 'refining1', sessionId: 'sess-1', relation: 'consumed_into',
})

describe('lineageForSession', () => {
  it('links every output bag to every input bag', () => {
    // Session granularity is the honest granularity: on a continuous line you
    // cannot say which input became which output. Two inputs and three outputs
    // is six "contributed to" links, not a guess at a pairing.
    const rows = lineageForSession({
      sectionId: 'refining1', sessionId: 'sess-1',
      parentSerials: ['STFL-01092026-001', 'STFL-01092026-002'],
      childSerials: ['R1WD-01092026-001', 'R1WD-01092026-002', 'R1PD-01092026-001'],
    })
    expect(rows).toHaveLength(6)
    expect(rows.every(r => r.relation === 'consumed_into')).toBe(true)
    expect(rows.every(r => r.sessionId === 'sess-1')).toBe(true)
    expect(rows.filter(r => r.childSerial === 'R1WD-01092026-001')).toHaveLength(2)
  })

  it('ignores blanks, whitespace and duplicates on both sides', () => {
    const rows = lineageForSession({
      sectionId: 'granule', sessionId: 's',
      parentSerials: ['  A  ', 'A', '', null, undefined, '   '],
      childSerials: ['B', 'B'],
    })
    expect(rows).toEqual([expect.objectContaining({ childSerial: 'B', parentSerial: 'A' })])
  })

  it('never makes a bag its own parent', () => {
    // A rebag captured on one screen has the same serial on both sides. The
    // CHECK constraint rejects such a row, and a rejected row takes the whole
    // insert with it — so it is dropped here, before it can do that.
    const rows = lineageForSession({
      sectionId: 'blender', sessionId: 's',
      parentSerials: ['X', 'Y'], childSerials: ['X'],
    })
    expect(rows).toEqual([expect.objectContaining({ childSerial: 'X', parentSerial: 'Y' })])
  })

  it('produces nothing when either side is empty', () => {
    const noParents = lineageForSession({ sectionId: 's', sessionId: 's', parentSerials: [], childSerials: ['B'] })
    const noChildren = lineageForSession({ sectionId: 's', sessionId: 's', parentSerials: ['A'], childSerials: [] })
    expect(noParents).toEqual([])
    expect(noChildren).toEqual([])
  })
})

describe('recordBagLineage', () => {
  it('inserts only the links not already held for the session', async () => {
    // The save path runs on every explicit save, the 30s autosave and submit.
    // Re-asserting the same parentage must be a no-op, without a delete and
    // without an ON CONFLICT arbiter — see the function header.
    const { db, inserted } = fakeDb({
      held: [{ child_serial: 'C1', parent_serial: 'P1', relation: 'consumed_into' }],
    })
    const err = await recordBagLineage(db, 'sess-1', [link('C1', 'P1'), link('C1', 'P2')])
    expect(err).toBeNull()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toHaveLength(1)
    expect(inserted[0][0]).toMatchObject({ child_serial: 'C1', parent_serial: 'P2', relation: 'consumed_into' })
  })

  it('writes nothing at all when every link is already held', async () => {
    const { db, inserted } = fakeDb({
      held: [{ child_serial: 'C1', parent_serial: 'P1', relation: 'consumed_into' }],
    })
    expect(await recordBagLineage(db, 'sess-1', [link('C1', 'P1')])).toBeNull()
    expect(inserted).toHaveLength(0)
  })

  it('treats the same pair under a different relation as a separate fact', async () => {
    // A bag drawn from another bag AND consumed into a session are two
    // different claims about the same two serials. Collapsing them would lose
    // the distinction between an exact transfer and line consumption.
    const { db, inserted } = fakeDb({
      held: [{ child_serial: 'C1', parent_serial: 'P1', relation: 'consumed_into' }],
    })
    await recordBagLineage(db, 'sess-1', [
      { ...link('C1', 'P1'), relation: 'transferred_from', parentKg: 12.5 },
    ])
    expect(inserted[0][0]).toMatchObject({ relation: 'transferred_from', parent_kg: 12.5 })
  })

  it('drops self-links before they can reject the batch', async () => {
    const { db, inserted } = fakeDb()
    await recordBagLineage(db, 'sess-1', [link('X', 'X'), link('X', 'Y')])
    expect(inserted[0]).toHaveLength(1)
    expect(inserted[0][0]).toMatchObject({ child_serial: 'X', parent_serial: 'Y' })
  })

  it('short-circuits with no query at all when given nothing to write', async () => {
    const { db, inserted } = fakeDb({ readError: 'should not be reached' })
    expect(await recordBagLineage(db, 'sess-1', [])).toBeNull()
    expect(inserted).toHaveLength(0)
  })

  it('returns the read error rather than inserting blind', async () => {
    // Inserting without knowing what is held would duplicate every link on
    // every autosave.
    const { db, inserted } = fakeDb({ readError: 'permission denied' })
    expect(await recordBagLineage(db, 'sess-1', [link('C1', 'P1')])).toBe('permission denied')
    expect(inserted).toHaveLength(0)
  })

  it('returns the insert error as a message, never throwing', async () => {
    const { db } = fakeDb({ insertError: 'duplicate key' })
    expect(await recordBagLineage(db, 'sess-1', [link('C1', 'P1')])).toBe('duplicate key')
  })

  it('catches a thrown client error — the caller must not lose the save', async () => {
    const { db } = fakeDb({ throwOn: 'read' })
    expect(await recordBagLineage(db, 'sess-1', [link('C1', 'P1')])).toBe('offline')
  })

  it('carries operator and kg through to the row', async () => {
    const { db, inserted } = fakeDb()
    await recordBagLineage(db, null as any, [{
      childSerial: 'C', parentSerial: 'P', sectionId: 'blender',
      sessionId: null, relation: 'transferred_from', parentKg: 40, operatorId: 'op-1',
    }])
    expect(inserted[0][0]).toMatchObject({
      child_serial: 'C', parent_serial: 'P', section_id: 'blender',
      session_id: null, relation: 'transferred_from', parent_kg: 40, operator_id: 'op-1',
    })
  })
})

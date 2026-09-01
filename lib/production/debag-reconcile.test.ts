import { describe, it, expect } from 'vitest'
import { debagRowKey, missingDebagRows } from './debag-reconcile'

// A prod_debagging row as the self-heal reads it back.
const row = (bagNo: string, lot: string, nett: number) => ({ notes: bagNo, lot_number: lot, kg_nett: nett })
const keyOf = (r: ReturnType<typeof row>) => debagRowKey(r.notes, r.lot_number, r.kg_nett)
const held = (rows: ReturnType<typeof row>[]) => rows.map(keyOf)

describe('debagRowKey', () => {
  it('collapses the same bag written by either side to one key', () => {
    // Stored numeric vs the operator's typed decimal comma — one bag, not two.
    expect(debagRowKey('E-744', 'GS-0314', 350)).toBe(debagRowKey('E-744', 'GS-0314', '350,0'))
    expect(debagRowKey(' E-744 ', 'GS-0314', 350)).toBe(debagRowKey('E-744', ' GS-0314', 350))
  })

  it('keeps genuinely different bags apart', () => {
    const base = debagRowKey('E-744', 'GS-0314', 350)
    expect(debagRowKey('E-745', 'GS-0314', 350)).not.toBe(base)
    expect(debagRowKey('E-744', 'GS-0315', 350)).not.toBe(base)
    expect(debagRowKey('E-744', 'GS-0314', 351)).not.toBe(base)
  })

  it('survives the nulls prod_debagging actually stores', () => {
    // A farm bag has no serial, and notes/lot/delivery_date are all nullable.
    expect(debagRowKey(null, null, null)).toBe('||0')
    expect(debagRowKey(undefined, 'GS-0314', '')).toBe('|GS-0314|0')
  })
})

describe('missingDebagRows', () => {
  it('restores rows the batch lost', () => {
    const ledger = [row('E-744', 'GS-0314', 350), row('E-745', 'GS-0314', 350), row('E-746', 'GS-0314', 350)]
    const missing = missingDebagRows(ledger, keyOf, held([ledger[0]]))
    expect(missing.map(r => r.notes)).toEqual(['E-745', 'E-746'])
  })

  it('restores nothing when the batch is already whole', () => {
    const ledger = [row('E-744', 'GS-0314', 350), row('E-745', 'GS-0314', 350)]
    expect(missingDebagRows(ledger, keyOf, held(ledger))).toEqual([])
  })

  // The reason this counts instead of using a Set. Ten bags off one farm pallet
  // are byte-identical, so set membership would call all ten "known" as soon as
  // the batch held one — and quietly recover none of the nine that were lost.
  it('recovers identical rows by count, not by set membership', () => {
    const pallet = Array.from({ length: 10 }, () => row('E-744', 'GS-0314', 350))
    expect(missingDebagRows(pallet, keyOf, held(pallet.slice(0, 3)))).toHaveLength(7)
    expect(missingDebagRows(pallet, keyOf, held(pallet))).toHaveLength(0)
    expect(missingDebagRows(pallet, keyOf, [])).toHaveLength(10)
  })

  it('never restores a row another batch of the session is holding', () => {
    // The changeover case: prod_debagging is session-scoped, so it hands back
    // batch 1's rows too. Those are not lost and must not be copied in here.
    const ledger = [row('E-744', 'GS-0314', 350), row('E-745', 'GS-0314', 350)]
    const thisBatch: ReturnType<typeof row>[] = []          // fresh, post-changeover
    const otherBatches = held([ledger[0], ledger[1]])       // batch 1 holds both
    const missing = missingDebagRows(ledger, keyOf, [...held(thisBatch), ...otherBatches])
    expect(missing).toEqual([])
  })

  // Guards the actual production incident (sieving / 2026-09-01 / morning).
  // Five changeovers, each mounting an empty batch that restored the whole
  // session into itself: 8 farm bags became 8+16+32+64+128 and Total Input read
  // 90 336 kg against 4 260 kg out. With the other batches' rows excluded, every
  // changeover after the first must restore nothing at all.
  it('does not double a session across repeated changeovers', () => {
    const captured = Array.from({ length: 8 }, () => row('E-744', 'GS-0314', 350))
    let ledger = [...captured]     // what prod_debagging holds
    const batches = [captured]     // draft_data.productions

    for (let changeover = 0; changeover < 5; changeover++) {
      const fresh: ReturnType<typeof row>[] = []
      const otherKeys = batches.flatMap(held)
      fresh.push(...missingDebagRows(ledger, keyOf, [...held(fresh), ...otherKeys]))
      batches.push(fresh)
      ledger = batches.flat()      // persist() rewrites the table from draft_data
    }

    expect(batches.slice(1).flat()).toEqual([])       // every new batch stayed empty
    expect(ledger).toHaveLength(8)                    // not 258
    const kg = ledger.reduce((t, r) => t + r.kg_nett, 0)
    expect(kg).toBe(2800)                             // not 90 300
  })

  it('still self-heals a batch mid-changeover when rows really did vanish', () => {
    // The fix must not disable the recovery it is guarding. Batch 1 lost two of
    // its four rows from draft_data; the ledger still has all four.
    const ledger = ['E-744', 'E-745', 'E-746', 'E-747'].map(b => row(b, 'GS-0314', 350))
    const batch1 = [ledger[0], ledger[3]]
    const batch2: ReturnType<typeof row>[] = []
    const missing = missingDebagRows(ledger, keyOf, [...held(batch1), ...held(batch2)])
    expect(missing.map(r => r.notes)).toEqual(['E-745', 'E-746'])
  })
})

import { describe, it, expect } from 'vitest'
import {
  workCentreFor, ddmmyyyy, typeCodeFor, TYPE_CODES,
  serialScope, formatBagSerial, parseBagSerial, serialOrderKey,
  type WorkCentre,
} from './serials'

// The scheme in ARCHITECTURE.md §5. Each section is pinned separately and on
// purpose: the formats differ deliberately, and a test that asserted them all
// through one helper would pass just as happily if they were "harmonised".

describe('work centre', () => {
  it('comes from the section id, keeping the two Refining lines apart', () => {
    expect(workCentreFor('refining1')).toBe('R1')
    expect(workCentreFor('refining2')).toBe('R2')
    expect(workCentreFor('sieving')).toBe('ST')
    expect(workCentreFor('granule')).toBe('GL')
    expect(workCentreFor('blender')).toBe('BL')
  })
  it('has no answer for the Pasteuriser, which is out of scheme for now', () => {
    expect(workCentreFor('pasteuriser')).toBeNull()
  })

  // Shares SectionKind 'blender' but is a different physical line. Mapping it
  // onto BL would interleave two lines' bags in one sequence.
  it('gives the Small Blender its own work centre, not the Blender\'s', () => {
    expect(workCentreFor('smallblender')).toBe('SB')
    expect(workCentreFor('smallblender')).not.toBe(workCentreFor('blender'))
  })
})

describe('Small Blender', () => {
  const base = { workCentre: 'SB' as WorkCentre, qualifier: 'SFCKUN25/C', date: '2026-09-01', runNo: 1 }

  it('formats and round-trips like the Blender, under its own prefix', () => {
    const s = formatBagSerial({ ...base, seq: 2 })
    expect(s).toBe('SB-SFCKUN25/C-01092026/1-002')
    const p = parseBagSerial(s)!
    expect(p.workCentre).toBe('SB')
    expect(p.qualifier).toBe('SFCKUN25/C')
    expect(p.runNo).toBe(1)
    expect(p.seq).toBe(2)
  })

  it('counts separately from the Blender for the same blend and run', () => {
    expect(serialScope(base)).not.toBe(serialScope({ ...base, workCentre: 'BL' }))
  })

  it('needs a blend code too', () => {
    expect(() => formatBagSerial({ workCentre: 'SB', date: '2026-09-01', runNo: 1, seq: 1 }))
      .toThrow(/blend code/)
  })
})

describe('date stem', () => {
  it('is DDMMYYYY, four-digit year', () => {
    expect(ddmmyyyy('2026-09-01')).toBe('01092026')
  })
  it('returns the zero stem for non-dates instead of garbage', () => {
    expect(ddmmyyyy('not-a-date')).toBe('00000000')   // ddmmyy() yields 'dateat'
    expect(ddmmyyyy('')).toBe('00000000')
  })
})

describe('type codes', () => {
  it('maps floor names per work centre', () => {
    expect(typeCodeFor('ST', 'Fine Leaf')).toBe('FL')
    expect(typeCodeFor('ST', 'Coarse Leaf')).toBe('CL')
    expect(typeCodeFor('R1', 'White Dust')).toBe('WD')
    expect(typeCodeFor('GL', 'Fine Granules')).toBe('SF')
  })

  // One material, four names, two work centres.
  it('folds every spelling of Heavy Sticks onto HS', () => {
    for (const name of ['Heavy Sticks', 'Rolsiev Sticks', 'Sticks', 'RS']) {
      expect(typeCodeFor('ST', name), name).toBe('HS')
      expect(typeCodeFor('R2', name), name).toBe('HS')
    }
  })

  it('does not fold Indent Sticks into Heavy Sticks', () => {
    expect(typeCodeFor('ST', 'Indent Sticks')).toBe('IS')
  })

  it('returns null for an unknown product rather than inventing a code', () => {
    // SievingCapture used the first two letters, which is indistinguishable
    // from a real code once it is printed on a bag.
    expect(typeCodeFor('ST', 'Something Nobody Configured')).toBeNull()
  })

  it('passes an already-correct code straight through', () => {
    expect(typeCodeFor('R2', 'CHSF')).toBe('CHSF')
    expect(typeCodeFor('GL', 'EXP')).toBe('EXP')
  })

  it('keeps each work centre to its own codes', () => {
    expect(TYPE_CODES.R1).not.toContain('CHSF')
    expect(TYPE_CODES.BL).toHaveLength(0)
  })
})

describe('formats, one per section', () => {
  const date = '2026-09-01'

  it('Sieving: ST{TT}-{DDMMYYYY}-{NNN}', () => {
    expect(formatBagSerial({ workCentre: 'ST', typeCode: 'RB', date, seq: 1 }))
      .toBe('STRB-01092026-001')
  })

  it('Refining 1: R1{TT}-{DDMMYYYY}-{NNN}', () => {
    expect(formatBagSerial({ workCentre: 'R1', typeCode: 'WD', date, seq: 1 }))
      .toBe('R1WD-01092026-001')
  })

  it('Refining 2 carries a four-letter type without special-casing', () => {
    expect(formatBagSerial({ workCentre: 'R2', typeCode: 'CHSF', date, seq: 12 }))
      .toBe('R2CHSF-01092026-012')
  })

  it('Granule: lot BEFORE the date', () => {
    expect(formatBagSerial({ workCentre: 'GL', typeCode: 'SG', qualifier: 'RSGG-05626', date, seq: 1 }))
      .toBe('GLSG-RSGG-05626-01092026-001')
  })

  it('Blender: no type code, blend and run instead', () => {
    expect(formatBagSerial({ workCentre: 'BL', qualifier: 'SFCKUN25/C', date, runNo: 1, seq: 1 }))
      .toBe('BL-SFCKUN25/C-01092026/1-001')
  })
})

describe('counting scope', () => {
  it('restarts per production day everywhere except Granule', () => {
    const mon = { workCentre: 'ST' as WorkCentre, typeCode: 'FL', date: '2026-09-01' }
    const tue = { ...mon, date: '2026-09-02' }
    expect(serialScope(mon)).not.toBe(serialScope(tue))
  })

  // The Granule exception, and the reason it exists: one lot runs across days
  // and has to read as one continuous sequence.
  it('is the LOT on the Granule Line, so it survives midnight and the run end', () => {
    const mon = { workCentre: 'GL' as WorkCentre, typeCode: 'SG', qualifier: 'RSGG-05626', date: '2026-09-01' }
    const tue = { ...mon, date: '2026-09-02' }
    expect(serialScope(mon)).toBe(serialScope(tue))
    expect(serialScope(mon)).toBe('GLSG-RSGG-05626')
    // ...while the serials still say which day each bag was made.
    expect(formatBagSerial({ ...mon, seq: 7 })).toContain('01092026')
    expect(formatBagSerial({ ...tue, seq: 8 })).toContain('02092026')
  })

  it('keeps SG and SF on separate counters within one lot', () => {
    const base = { qualifier: 'RSGG-05626', date: '2026-09-01' }
    expect(serialScope({ workCentre: 'GL', typeCode: 'SG', ...base }))
      .not.toBe(serialScope({ workCentre: 'GL', typeCode: 'SF', ...base }))
  })

  it('separates Blender runs within one production day', () => {
    const base = { workCentre: 'BL' as WorkCentre, qualifier: 'SFCKUN25/C', date: '2026-09-01' }
    expect(serialScope({ ...base, runNo: 1 })).not.toBe(serialScope({ ...base, runNo: 2 }))
  })

  it('is a true prefix of the serial, Granule included', () => {
    for (const p of [
      { workCentre: 'ST' as WorkCentre, typeCode: 'FL', date: '2026-09-01', seq: 3 },
      { workCentre: 'R2' as WorkCentre, typeCode: 'CHSC', date: '2026-09-01', seq: 3 },
      { workCentre: 'BL' as WorkCentre, qualifier: 'X/C', date: '2026-09-01', runNo: 2, seq: 3 },
      { workCentre: 'GL' as WorkCentre, typeCode: 'SG', qualifier: 'L-1', date: '2026-09-01', seq: 3 },
    ]) {
      expect(formatBagSerial(p).startsWith(serialScope(p)), formatBagSerial(p)).toBe(true)
    }
  })
})

describe('parsing, anchored from both ends', () => {
  it('round-trips every section', () => {
    const cases = [
      { workCentre: 'ST' as WorkCentre, typeCode: 'RB', date: '2026-09-01', seq: 1 },
      { workCentre: 'R1' as WorkCentre, typeCode: 'ID', date: '2026-09-01', seq: 42 },
      { workCentre: 'R2' as WorkCentre, typeCode: 'CHSF', date: '2026-12-31', seq: 7 },
      { workCentre: 'GL' as WorkCentre, typeCode: 'EXP', qualifier: 'RSGG-05626', date: '2026-09-01', seq: 9 },
      { workCentre: 'BL' as WorkCentre, qualifier: 'SFCKUN25/C', date: '2026-09-01', runNo: 3, seq: 5 },
    ]
    for (const c of cases) {
      const s = formatBagSerial(c)
      const p = parseBagSerial(s)
      expect(p, s).not.toBeNull()
      expect(p!.workCentre, s).toBe(c.workCentre)
      expect(p!.typeCode, s).toBe((c as { typeCode?: string }).typeCode ?? '')
      expect(p!.seq, s).toBe(c.seq)
      expect(p!.date, s).toBe(c.date)
      const q = (c as { qualifier?: string }).qualifier
      if (q) expect(p!.qualifier, s).toBe(q)
      const r = (c as { runNo?: number }).runNo
      if (r) expect(p!.runNo, s).toBe(r)
    }
  })

  // The trap this whole parser exists for.
  it('reads a hyphenated Granule lot correctly, where split("-") does not', () => {
    const s = 'GLSG-RSGG-05626-01092026-001'
    const p = parseBagSerial(s)!
    expect(p.qualifier).toBe('RSGG-05626')
    expect(p.date).toBe('2026-09-01')
    expect(p.seq).toBe(1)
    // What the naive version would have said — both halves plausible, both wrong.
    const naive = s.split('-')
    expect(naive[1]).toBe('RSGG')
    expect(naive[2]).toBe('05626')
  })

  it('reads a blend code containing both a slash and a hyphen', () => {
    const p = parseBagSerial('BL-SF-CKUN25/C-01092026/2-014')!
    expect(p.qualifier).toBe('SF-CKUN25/C')
    expect(p.runNo).toBe(2)
    expect(p.date).toBe('2026-09-01')
    expect(p.seq).toBe(14)
  })

  it('accepts a legacy six-digit date and says so', () => {
    const p = parseBagSerial('STRB-010926-001')!
    expect(p.date).toBe('2026-09-01')
    expect(p.legacy).toBe(true)
    expect(parseBagSerial('STRB-01092026-001')!.legacy).toBe(false)
  })

  it('still reads a historic RS serial off a bag in the warehouse', () => {
    const p = parseBagSerial('STRS-010926-004')!
    expect(p.typeCode).toBe('RS')   // not rewritten to HS: that bag says RS
    expect(p.seq).toBe(4)
  })

  it('returns null rather than guessing at anything else', () => {
    for (const s of ['', 'nonsense', 'ZZFL-01092026-001', 'RSGG-05626-001', 'STRB-01092026']) {
      expect(parseBagSerial(s), s).toBeNull()
    }
  })

  it('rejects a Granule serial with no lot rather than reading the date as one', () => {
    // Not a serial this app can mint (see the qualifier guard) and not one in
    // the wild either. Reading it as "lot = empty" would be worse than
    // refusing: the bag would look tagged while belonging to no counter.
    expect(parseBagSerial('GLSG-01092026-001')).toBeNull()
  })
})

describe('the qualifier guard', () => {
  it('refuses to mint a Granule serial without a lot', () => {
    expect(() => formatBagSerial({ workCentre: 'GL', typeCode: 'SG', date: '2026-09-01', seq: 1 }))
      .toThrow(/lot number/)
    // ...and the malformed thing it used to produce.
    expect(() => formatBagSerial({ workCentre: 'GL', typeCode: 'SG', qualifier: '  ', date: '2026-09-01', seq: 1 }))
      .toThrow()
  })

  it('refuses to mint a Blender serial without a blend code', () => {
    expect(() => formatBagSerial({ workCentre: 'BL', date: '2026-09-01', runNo: 1, seq: 1 }))
      .toThrow(/blend code/)
  })

  it('leaves the date-scoped sections alone', () => {
    expect(() => formatBagSerial({ workCentre: 'ST', typeCode: 'FL', date: '2026-09-01', seq: 1 }))
      .not.toThrow()
  })
})

// The Quality Sieving page orders pending bags by this to remind a QC that an
// earlier bag has not been sampled yet. Its own copy of this required a
// six-digit date, so every current-format bag returned null and the reminder
// silently stopped firing.
describe('order key (Quality QC ordering)', () => {
  it('sorts current-format bags within a day', () => {
    const a = serialOrderKey('STFL-01092026-001')!
    const b = serialOrderKey('STFL-01092026-002')!
    expect(a < b).toBe(true)
  })

  it('sorts across month and year boundaries', () => {
    const dec = serialOrderKey('STFL-31122026-099')!
    const jan = serialOrderKey('STFL-01012027-001')!
    expect(dec < jan).toBe(true)
  })

  it('orders legacy and current formats against each other on a changeover day', () => {
    // The whole point: both formats coexist the day the wiring lands, and a
    // reminder that splits them into two runs is worse than none.
    const legacy  = serialOrderKey('STFL-010926-004')!
    const current = serialOrderKey('STFL-01092026-005')!
    expect(legacy).not.toBeNull()
    expect(current).not.toBeNull()
    expect(legacy < current).toBe(true)
  })

  it('returns null for a hand-typed serial rather than placing it wrongly', () => {
    expect(serialOrderKey('13.08.05')).toBeNull()
    expect(serialOrderKey('')).toBeNull()
    expect(serialOrderKey(null)).toBeNull()
  })
})

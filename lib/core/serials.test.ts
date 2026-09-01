import { describe, it, expect } from 'vitest'
import {
  ddmmyy, pad3, seqOf, maxSeq, makeSerial,
  sievingSerial, sievingSerialPrefix,
  granuleStem, granuleSerial, blendSerial, pasteuriserSerial,
  parseSerial,
} from './serials'

/**
 * CHARACTERISATION TESTS — see num.test.ts for why these exist.
 *
 * Serials are the identity of a physical bag. A change here does not just alter
 * a displayed number: it can orphan a printed label from its database row, or
 * collide two real bags onto one serial. These tests are the contract.
 */

describe('ddmmyy', () => {
  it('reorders a yyyy-mm-dd session date into the serial date stem', () => {
    expect(ddmmyy('2026-09-01')).toBe('010926')
    expect(ddmmyy('2026-12-25')).toBe('251226')
    expect(ddmmyy('2026-01-05')).toBe('050126')
  })

  it('falls back to 000000 rather than throwing on a malformed date', () => {
    // The Sieving and capture-config copies did this. The Granule copy
    // destructured positionally and would have thrown a TypeError instead —
    // the defensive behaviour is the one kept, deliberately.
    expect(ddmmyy('')).toBe('000000')
    expect(ddmmyy('2026-09')).toBe('000000')
    expect(() => ddmmyy('')).not.toThrow()
  })

  it('LIMITATION: a three-part non-date yields a garbage stem, not 000000', () => {
    // The guard counts hyphen-separated parts without checking they are numeric,
    // so 'not-a-date' passes it. Inherited from the original and pinned here so
    // nobody starts feeding operator-entered text through this function.
    expect(ddmmyy('not-a-date')).toBe('dateat')
  })
})

describe('pad3', () => {
  it('pads to three digits and does not truncate beyond', () => {
    expect(pad3(1)).toBe('001')
    expect(pad3(42)).toBe('042')
    expect(pad3(999)).toBe('999')
    expect(pad3(1000)).toBe('1000')
  })
})

describe('seqOf', () => {
  it('reads the trailing sequence off each real serial shape', () => {
    expect(seqOf('STFC-010926-007')).toBe(7)
    expect(seqOf('26244-CON-SFC-001')).toBe(1)
    expect(seqOf('GL-010926-123')).toBe(123)
  })

  it('returns 0 when there is no trailing number', () => {
    expect(seqOf('STFC-010926-')).toBe(0)
    expect(seqOf('NOSEQ')).toBe(0)
    expect(seqOf('')).toBe(0)
  })

  it('reads up to four trailing digits', () => {
    expect(seqOf('X-9999')).toBe(9999)
  })

  it('LATENT BUG: a five-digit sequence returns 0, not the number', () => {
    // The regex needs the hyphen followed by AT MOST four digits before end of
    // string, so 'X-12345' does not match at all.
    expect(seqOf('X-12345')).toBe(0)
  })

  it('LATENT BUG: that makes a 10000th bag invisible to sequence seeding', () => {
    // maxSeq is built on seqOf, so a stem that reached five digits would seed
    // the next number from 0 and mint 001 — colliding with an existing bag
    // instead of continuing past it. Unreachable today (a stem is one lot or one
    // section-day, and the seeding scan is capped at limit(4000)); reachable the
    // moment a stem's scope widens. Database-side allocation removes this class
    // of bug entirely — ARCHITECTURE.md §5.
    expect(maxSeq(['X-10000', 'X-10001'])).toBe(0)
    expect(pad3(maxSeq(['X-10000']) + 1)).toBe('001')
  })
})

describe('maxSeq', () => {
  it('finds the highest sequence in a set', () => {
    expect(maxSeq(['STFC-010926-001', 'STFC-010926-007', 'STFC-010926-003'])).toBe(7)
  })

  it('is 0 for an empty set, so the first bag becomes 001', () => {
    expect(maxSeq([])).toBe(0)
    expect(pad3(maxSeq([]) + 1)).toBe('001')
  })

  it('ignores serials with no trailing sequence', () => {
    expect(maxSeq(['NOSEQ', 'STFC-010926-004'])).toBe(4)
  })
})

describe('makeSerial', () => {
  it('builds {CODE}-{DDMMYY}-{NNN}', () => {
    expect(makeSerial('ST', '2026-09-01', 1)).toBe('ST-010926-001')
    expect(makeSerial('RF1', '2026-12-25', 42)).toBe('RF1-251226-042')
  })

  it('matches the original capture-config implementation exactly', () => {
    const original = (sectionCode: string, dateStr: string, seq: number) => {
      const d = dateStr.split('-')
      const stem = d.length === 3 ? `${d[2]}${d[1]}${d[0].slice(2)}` : '000000'
      return `${sectionCode}-${stem}-${String(seq).padStart(3, '0')}`
    }
    for (const [code, date, seq] of [
      ['ST', '2026-09-01', 1], ['GR', '2026-02-28', 999], ['BL', '2026-11-11', 12],
    ] as Array<[string, string, number]>) {
      expect(makeSerial(code, date, seq)).toBe(original(code, date, seq))
    }
  })
})

describe('sievingSerial', () => {
  it('builds ST{abbr}-{DDMMYY}-{NNN}', () => {
    expect(sievingSerial('FC', '2026-09-01', 7)).toBe('STFC-010926-007')
    expect(sievingSerialPrefix('FC', '2026-09-01')).toBe('STFC-010926-')
  })

  it('round-trips through seqOf, which is how the next number is seeded', () => {
    const s = sievingSerial('SFC', '2026-09-01', 12)
    expect(seqOf(s)).toBe(12)
    expect(s.startsWith(sievingSerialPrefix('SFC', '2026-09-01'))).toBe(true)
  })
})

describe('granuleSerial', () => {
  it('uses the lot number as the stem when there is one', () => {
    expect(granuleStem('26244-CON', '2026-09-01')).toBe('26244-CON')
    expect(granuleSerial('26244-CON', '2026-09-01', 3)).toBe('26244-CON-003')
  })

  it('falls back to GL-{DDMMYY} when there is no lot', () => {
    expect(granuleStem('', '2026-09-01')).toBe('GL-010926')
    expect(granuleSerial('', '2026-09-01', 3)).toBe('GL-010926-003')
  })

  it('treats a whitespace-only lot as no lot', () => {
    expect(granuleStem('   ', '2026-09-01')).toBe('GL-010926')
  })

  it('trims surrounding whitespace off a real lot', () => {
    expect(granuleStem('  26244-CON  ', '2026-09-01')).toBe('26244-CON')
  })
})

describe('blendSerial and pasteuriserSerial', () => {
  it('builds {BLEND}-{RUN}-{BAG}', () => {
    expect(blendSerial('25BLSE-40F', 1, 5)).toBe('25BLSE-40F-1-5')
  })

  it('builds pasteuriser {LOT}-{NNN} from an expanded range', () => {
    expect(pasteuriserSerial('26244-CON-SFC', 1)).toBe('26244-CON-SFC-001')
    expect(pasteuriserSerial('26244-CON-SFC', 24)).toBe('26244-CON-SFC-024')
  })
})

describe('parseSerial', () => {
  it('splits a serial into stem and sequence', () => {
    expect(parseSerial('STFC-010926-007')).toEqual({ stem: 'STFC-010926', seq: 7, hasSeq: true })
    expect(parseSerial('26244-CON-SFC-001')).toEqual({ stem: '26244-CON-SFC', seq: 1, hasSeq: true })
  })

  it('flags an unnumbered serial rather than pretending it is bag 0', () => {
    expect(parseSerial('NOSEQ')).toEqual({ stem: 'NOSEQ', seq: 0, hasSeq: false })
    expect(parseSerial('NOSEQ').hasSeq).toBe(false)
  })

  it('round-trips the sieving and granule builders', () => {
    const a = sievingSerial('FC', '2026-09-01', 7)
    expect(parseSerial(a)).toEqual({ stem: 'STFC-010926', seq: 7, hasSeq: true })

    const b = granuleSerial('26244-CON', '2026-09-01', 3)
    const pb = parseSerial(b)
    expect(pb.seq).toBe(3)
    expect(granuleSerial('26244-CON', '2026-09-01', pb.seq)).toBe(b)
  })
})

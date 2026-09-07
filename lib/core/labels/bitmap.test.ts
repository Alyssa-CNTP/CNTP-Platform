import { describe, it, expect } from 'vitest'
import {
  bitmapToRows, markToPplb, markStripToPplb, INVERT_BITS,
  type MarkBitmap,
} from './bitmap'

/**
 * The EMITTER, on synthetic bitmaps.
 *
 * The real artwork is tested next door in features/pasteuriser-labels, because
 * lib/core may not import from features and the generated bitmaps live there.
 * That split is not an inconvenience — it is the reason core can be lifted to
 * another branch without dragging a feature's assets behind it.
 */

/** Build a bitmap by hand so the expected bytes are obvious by inspection. */
function make(rows: string[], key = 'test'): MarkBitmap {
  const h = rows.length
  const w = rows[0].length
  const wb = Math.ceil(w / 8)
  const bytes = new Uint8Array(wb * h)
  for (let y = 0; y < h; y++) {
    for (let b = 0; b < wb; b++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit
        const black = x < w && rows[y][x] === '#'
        if (!black) byte |= 0x80 >> bit          // 1 = white, pad white
      }
      bytes[y * wb + b] = byte
    }
  }
  let bin = ''
  for (const v of bytes) bin += String.fromCharCode(v)
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64')
  return { key, source: 'synthetic', widthDots: w, heightDots: h, widthBytes: wb, dataBase64: b64 }
}

describe('bitmapToRows', () => {
  it('round-trips a hand-built bitmap', () => {
    const bm = make(['#...#...', '.#.#.#.#'])
    expect(bitmapToRows(bm)).toEqual([
      [true, false, false, false, true, false, false, false],
      [false, true, false, true, false, true, false, true],
    ])
  })

  it('treats a 0 bit as a burned dot, which is the EPL2 convention', () => {
    expect(INVERT_BITS).toBe(true)
    // One black dot top-left: byte is 0111_1111 = 0x7F, not 0x80.
    const bm = make(['#.......'])
    const raw = typeof atob === 'function'
      ? atob(bm.dataBase64).charCodeAt(0)
      : Buffer.from(bm.dataBase64, 'base64')[0]
    expect(raw).toBe(0x7f)
  })

  it('pads a partial row with WHITE, so no mark grows a black edge', () => {
    // 9 dots wide -> 2 bytes, 7 bits of padding. All must read as blank.
    const rows = bitmapToRows(make(['#########']))
    expect(rows[0]).toHaveLength(9)
    expect(rows[0].every(Boolean)).toBe(true)
    const bytes = typeof atob === 'function'
      ? Uint8Array.from(atob(make(['#########']).dataBase64), c => c.charCodeAt(0))
      : Buffer.from(make(['#########']).dataBase64, 'base64')
    // Second byte: bit 0 is the 9th dot (black -> 0), remaining 7 pad white.
    expect(bytes[1]).toBe(0x7f)
  })

  it('refuses a payload that does not match its own dimensions', () => {
    const bm = make(['####'])
    expect(() => bitmapToRows({ ...bm, heightDots: 99 })).toThrow(/expected/)
  })
})

describe('markToPplb', () => {
  const bm = make(['#...#...', '.#.#.#.#'], 'm')

  it('emits GW with the width in BYTES and the height in DOTS', () => {
    const out = markToPplb(bm, { x: 100, y: 40 })
    expect(out.startsWith('GW100,40,1,2,')).toBe(true)
    expect(out.endsWith('\r\n')).toBe(true)
  })

  it('carries exactly widthBytes * heightDots payload bytes', () => {
    const out = markToPplb(bm, { x: 0, y: 0 })
    const payload = out.slice(out.indexOf(`,${bm.heightDots},`) + 3, -2)
    expect(payload).toHaveLength(bm.widthBytes * bm.heightDots)
  })

  it('keeps every payload byte inside latin1, so the stride survives encoding', () => {
    // A byte above 0xFF here would mean the string is not a byte string, and
    // writing it as UTF-8 would shear the image.
    const out = markToPplb(bm, { x: 0, y: 0 })
    for (const ch of out) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0xff)
  })

  it('rejects a negative or fractional placement rather than printing off-label', () => {
    expect(() => markToPplb(bm, { x: -1, y: 0 })).toThrow(/non-negative/)
    expect(() => markToPplb(bm, { x: 1.5, y: 0 })).toThrow(/non-negative/)
  })
})

describe('markStripToPplb', () => {
  const a = make(['##......', '##......'], 'a')   // 8 dots wide

  it('is empty for no marks, rather than emitting a stray command', () => {
    expect(markStripToPplb([], { centreX: 400, y: 300 })).toBe('')
  })

  it('centres one mark on the given x', () => {
    const out = markStripToPplb([a], { centreX: 400, y: 300 })
    expect(out.startsWith('GW396,300,')).toBe(true)   // 400 - 8/2
  })

  it('centres a row and steps by width + gap', () => {
    const out = markStripToPplb([a, a, a], { centreX: 400, y: 300, gapDots: 8 })
    // total = 3*8 + 2*8 = 40, so first x = 400 - 20 = 380
    const xs = [...out.matchAll(/GW(\d+),300,/g)].map(m => Number(m[1]))
    expect(xs).toEqual([380, 396, 412])
  })

  it('clamps to the left edge instead of emitting a negative origin', () => {
    const out = markStripToPplb([a, a, a], { centreX: 4, y: 0 })
    expect(out.startsWith('GW0,0,')).toBe(true)
  })
})

/**
 * Bag serial numbers — the single owner of every serial format.
 *
 * Serialization is core (ARCHITECTURE.md §5). Before this module the formats
 * were written out in four places with the primitives duplicated between them:
 *   - capture-config.ts        makeSerial          {CODE}-{DDMMYY}-{NNN}
 *   - SievingCapture.tsx       nextSievingSerial   ST{abbr}-{DDMMYY}-{NNN}
 *   - GranuleCapture.tsx       nextGranuleSerial   {LOT}-{NNN} or GL-{DDMMYY}-{NNN}
 *   - BlenderCapture.tsx       genBlendSerial      {BLEND}-{RUN}-{BAG}
 * The `ddmmyy` derivation appeared three times and `seqOf` was byte-identical
 * in two. There was no parser at all — nothing could read a serial back.
 *
 * This module is PURE: formats only, no database. Sequence *allocation* is a
 * separate concern and deliberately not here — see the note under maxSeq().
 */

/**
 * `yyyy-mm-dd` → `ddmmyy`, the date stem used in most serial formats.
 *
 * Returns '000000' for anything that isn't a three-part date. The Sieving and
 * capture-config copies did exactly this; the Granule copy destructured
 * positionally and would have thrown a TypeError on a malformed date instead.
 * The defensive behaviour is kept, because a serial with a visibly wrong date
 * is recoverable and a crash mid-capture is not.
 *
 * LIMITATION, inherited: the guard only counts hyphen-separated parts, it does
 * not check they are numeric. A three-part non-date such as 'not-a-date' yields
 * a garbage stem ('dateat') rather than '000000'. Harmless today because the
 * date always comes from the session record, never from operator input — but do
 * not start passing user-entered text here without tightening this first.
 *
 * Note the date passed in is the SESSION date, never the device clock: an
 * afternoon/night shift runs past midnight (07h00–01h00) and using the live
 * date would roll the stem over mid-shift and restart the sequence inside one
 * continuous run.
 */
export function ddmmyy(dateStr: string): string {
  const d = String(dateStr).split('-')
  if (d.length !== 3 || !d[0] || !d[1] || !d[2]) return '000000'
  return `${d[2]}${d[1]}${d[0].slice(2)}`
}

/** Zero-pad a sequence number to the conventional three digits. */
export function pad3(seq: number): string {
  return String(seq).padStart(3, '0')
}

/**
 * Read the trailing sequence number off a serial, or 0 if it has none.
 *
 * Matches one to four trailing digits after a hyphen, which is what both
 * historic copies did.
 *
 * LATENT BUG, inherited and pinned by test: a FIVE-digit sequence does not
 * match at all and returns 0 — the regex requires the hyphen to be followed by
 * at most four digits before end-of-string. Because maxSeq() is built on this,
 * a stem that ever reached 10000 bags would go invisible to the seeding scan
 * and the next bag would be numbered 001, colliding with an existing bag rather
 * than continuing past it.
 *
 * Not reachable today: a stem is one lot or one section-day, and the app-side
 * seeding scan is capped at `limit(4000)` anyway. It becomes reachable the
 * moment a stem's scope is widened. The real fix is database-side allocation
 * (ARCHITECTURE.md §5), which removes the dependence on parsing a max back out
 * of existing serials entirely.
 */
export function seqOf(serial: string): number {
  const m = String(serial).match(/-(\d{1,4})$/)
  return m ? parseInt(m[1], 10) : 0
}

/**
 * Highest sequence number across a set of serials. Pure — callers pass in
 * whatever they have (local session bags, rows fetched from bag_tags).
 *
 * IMPORTANT: seeding the next number from a max is what the capture components
 * do today and it is NOT concurrency-safe — two operators adding a bag in the
 * same moment both read the same max and both mint max+1, producing a duplicate
 * serial. The fix is to allocate from the database (`next_bag_serial`, mirroring
 * the existing `next_job_card_no` RPC), not to compute it here. This function
 * exists to support the current call sites during the transition and as the
 * offline fallback; it is not the intended long-term path. See ARCHITECTURE.md §5.
 */
export function maxSeq(serials: readonly string[]): number {
  return serials.reduce<number>((mx, s) => Math.max(mx, seqOf(s)), 0)
}

/**
 * The general section format: `{CODE}-{DDMMYY}-{NNN}`.
 * Moved verbatim from capture-config.ts, which re-exports it during transition.
 */
export function makeSerial(sectionCode: string, dateStr: string, seq: number): string {
  return `${sectionCode}-${ddmmyy(dateStr)}-${pad3(seq)}`
}

/** Sieving: `ST{abbr}-{DDMMYY}-{NNN}`, sequenced per product type per day. */
export function sievingSerialPrefix(productTypeAbbr: string, dateStr: string): string {
  return `ST${productTypeAbbr}-${ddmmyy(dateStr)}-`
}

export function sievingSerial(productTypeAbbr: string, dateStr: string, seq: number): string {
  return `${sievingSerialPrefix(productTypeAbbr, dateStr)}${pad3(seq)}`
}

/**
 * Granule stem: the lot number when there is one, otherwise `GL-{DDMMYY}`.
 *
 * With a lot the sequence continues per lot (so it lines up with historic rows
 * matched on lot_number); without one it continues per section-day.
 */
export function granuleStem(lot: string, dateStr: string): string {
  const lotStem = String(lot ?? '').trim()
  return lotStem || `GL-${ddmmyy(dateStr)}`
}

export function granuleSerial(lot: string, dateStr: string, seq: number): string {
  return `${granuleStem(lot, dateStr)}-${pad3(seq)}`
}

/** Blender: `{BLEND}-{RUN}-{BAG}`. Run number resets to 1 each production day. */
export function blendSerial(blendCode: string, runNo: number, bagNo: number): string {
  return `${blendCode}-${runNo}-${bagNo}`
}

/** Pasteuriser output, expanded from a bag-count range: `{LOT}-{NNN}`. */
export function pasteuriserSerial(lot: string, bagNo: number): string {
  return `${String(lot).trim()}-${pad3(bagNo)}`
}

/**
 * Decompose a serial into its stem and trailing sequence.
 *
 * There was no parser before this. Anything without a trailing `-NNNN` comes
 * back with the whole string as the stem and seq 0, so a caller can always tell
 * "unnumbered" from "number zero" by checking `hasSeq`.
 */
export function parseSerial(serial: string): { stem: string; seq: number; hasSeq: boolean } {
  const raw = String(serial)
  const m = raw.match(/^(.*)-(\d{1,4})$/)
  if (!m) return { stem: raw, seq: 0, hasSeq: false }
  return { stem: m[1], seq: parseInt(m[2], 10), hasSeq: true }
}

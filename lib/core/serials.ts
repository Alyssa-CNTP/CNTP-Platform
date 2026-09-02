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

// ═════════════════════════════════════════════════════════════════════════════
// THE CURRENT SCHEME  (ARCHITECTURE.md §5)
// ═════════════════════════════════════════════════════════════════════════════
//
// Everything above this line is the FOUR historic formats, kept because bags
// carrying them are in the warehouse right now and a serial already printed on
// a bag is that bag's identity. They are read, never written, once the wiring
// below is live.
//
//   {WC}{TYPE}-{DDMMYYYY}-{QUALIFIER}-{NNN}
//
// The two rules that break naive code, both learned the hard way:
//
//   1. NEVER `split('-')`. Granule lots contain hyphens ('RSGG-05626'), so a
//      split mis-reads every Granule serial and silently produces a plausible
//      wrong answer rather than an error. Parse anchored from both ends.
//   2. The work centre comes from the SECTION ID, not the section kind.
//      Refining 1 and Refining 2 share kind 'refining' but are different work
//      centres with different type codes, and conflating them puts R2's
//      bought-in material under R1's counter.

/** The five work centres that mint serials. Pasteuriser is deliberately absent. */
export type WorkCentre = 'ST' | 'R1' | 'R2' | 'GL' | 'BL' | 'SB'

/**
 * Section id → work centre. Keyed on the SECTION ID (`refining1`/`refining2`),
 * never on SectionKind, which collapses both Refining lines into 'refining'.
 *
 * The Pasteuriser is absent on purpose: its final product carries its own
 * serial and label conventions and is sequenced last, once the upstream
 * sections are released. workCentreFor() returning null for it is the correct
 * answer, not a gap to fill in.
 */
const WORK_CENTRE_BY_SECTION: Readonly<Record<string, WorkCentre>> = {
  sieving:   'ST',
  refining1: 'R1',
  refining2: 'R2',
  granule:      'GL',
  blender:      'BL',
  // The Small Blender is its own work centre, not an alias of the Blender. It
  // shares SectionKind 'blender' (same capture shape) but is a different
  // physical line with its own bags, so it needs its own counter — mapping it
  // onto BL would interleave two lines' bags in one sequence.
  smallblender: 'SB',
}

export function workCentreFor(sectionId: string): WorkCentre | null {
  return WORK_CENTRE_BY_SECTION[String(sectionId)] ?? null
}

/**
 * `yyyy-mm-dd` → `ddmmyyyy`, the date stem of the current scheme.
 *
 * Four-digit year, unlike the historic ddmmyy() above. Six digits saved two
 * characters and cost the century; these serials are an audit record that
 * outlives the decade they were printed in.
 *
 * Returns '00000000' for anything that isn't a numeric three-part date — a
 * serial with a visibly wrong date is recoverable, a crash mid-capture is not.
 * Unlike ddmmyy() this DOES check the parts are numeric, so 'not-a-date' gives
 * the zero stem rather than the garbage one.
 *
 * The date passed in is the SESSION date, never the device clock. The
 * afternoon shift runs 16h00–01h00, so wall-clock time would roll the stem
 * over to tomorrow mid-run and restart the sequence inside one continuous
 * production day. See "The production run day" in §5.
 */
export function ddmmyyyy(dateStr: string): string {
  const p = String(dateStr).split('-')
  if (p.length !== 3) return '00000000'
  const [y, m, d] = p
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return '00000000'
  return `${d}${m}${y}`
}

// ── Product type codes ───────────────────────────────────────────────────────
//
// The serial-code layer of the three product-naming layers (§5). It is NOT the
// floor name and NOT the Acumatica item; all three exist and none substitutes
// for another. Acumatica codes stay in lib/production/acumatica-codes.ts.

/** Every type code a work centre may mint, in floor order. */
export const TYPE_CODES: Readonly<Record<WorkCentre, readonly string[]>> = {
  ST: ['FL', 'CL', 'RB', 'BD', 'PD', 'IS', 'HS', 'BE'],
  R1: ['ID', 'WD', 'PD'],
  R2: ['CHSF', 'CHSC', 'WD', 'PD', 'HS'],
  GL: ['SG', 'SF', 'EXP', 'SGD', 'SFD', 'BD', 'WD', 'ID', 'LD', 'AD', 'DE'],
  BL: [],   // the Blender carries no type code — see formatBagSerial()
  SB: [],   // ...nor the Small Blender
}

/**
 * Floor name → type code, per work centre. First match wins, so order matters:
 * 'Coarse Leaf' must not be caught by a looser /leaf/ rule above it.
 *
 * HEAVY STICKS is one material that has been called four things — 'Heavy
 * Sticks' (the floor name, and what the picker and the printed tag now say),
 * 'Rolsiev Sticks' and 'Sticks' (what the platform said before, what rows in
 * the database still say, and what Acumatica calls item 15IGST), and 'RS' (the
 * code its historic serials carry). All four map to HS, on Refining 2 as well
 * as Sieving. Accept every spelling on input, write the canonical one going
 * forward, rewrite no history. The name itself is folded by
 * lib/core/product-names.ts; this layer only decides the two letters that go in
 * the serial, and HS abbreviates the floor name exactly.
 */
const TYPE_MATCHERS: Readonly<Record<WorkCentre, ReadonlyArray<readonly [RegExp, string]>>> = {
  ST: [
    [/fine leaf/i,                              'FL'],
    [/coarse leaf/i,                            'CL'],
    [/indent stick/i,                           'IS'],
    [/heavy stick|rolsiev|rol siev|\bstick/i,   'HS'],
    [/rb block|\bblock/i,                       'RB'],
    [/brown dust/i,                             'BD'],
    [/powder dust/i,                            'PD'],
    // A real Sieving output, though not one of the named products: material
    // recovered from the bucket elevator. It bags and it needs a code.
    [/bucket elevator|spillage/i,               'BE'],
  ],
  R1: [
    [/indent/i,      'ID'],
    [/white dust/i,  'WD'],
    [/powder dust/i, 'PD'],
  ],
  R2: [
    [/heavy stick|rolsiev|rol siev|\bstick/i, 'HS'],
    [/fine.*chal|chal.*fine|\bchsf\b/i,       'CHSF'],
    [/coarse.*chal|chal.*coarse|\bchsc\b/i,   'CHSC'],
    [/white dust/i,                           'WD'],
    [/powder dust/i,                          'PD'],
  ],
  GL: [
    // DUST FIRST, and this order is load-bearing. The Granule Line bags dust
    // as well as granules, under the same lot. 'SG Dust' contains the token
    // that identifies SG granules, so matched the other way round it would
    // take the granule code — putting dust and product on one counter under
    // one indistinguishable serial. SGD/SFD rather than SG/SF for the same
    // reason.
    [/sg dust/i,                         'SGD'],
    [/sf dust/i,                         'SFD'],
    [/brown dust|cp dust/i,              'BD'],
    [/white dust/i,                      'WD'],
    [/indent dust/i,                     'ID'],
    [/leaf dust/i,                       'LD'],
    [/alt dust/i,                        'AD'],
    [/dust extraction/i,                 'DE'],
    // ...then the granules themselves.
    [/export|\bexp\b/i,                  'EXP'],
    [/\bsf\b|fine granule/i,             'SF'],
    [/\bsg\b|standard granule|granule/i, 'SG'],
  ],
  BL: [],
  SB: [],
}

/**
 * Floor product name → the type code for this work centre.
 *
 * Returns null for anything unrecognised rather than inventing a code from the
 * first two letters, which is what SievingCapture did. A guessed code looks
 * exactly like a real one on a printed bag and there is no way to tell later
 * which bags carry a real code and which carry a guess — so an unknown product
 * has to be added to TYPE_MATCHERS deliberately, taking its naming from the
 * Acumatica master inventory.
 */
export function typeCodeFor(wc: WorkCentre, productType: string): string | null {
  const s = String(productType ?? '').trim()
  if (!s) return null
  // An exact code already ('HS', 'CHSF') passes straight through.
  const upper = s.toUpperCase()
  if ((TYPE_CODES[wc] as readonly string[]).includes(upper)) return upper
  // 'RS' is Heavy Sticks' historic code and still arrives from older rows.
  if (upper === 'RS' && (wc === 'ST' || wc === 'R2')) return 'HS'
  for (const [re, code] of TYPE_MATCHERS[wc]) if (re.test(s)) return code
  return null
}

// ── Building a serial ────────────────────────────────────────────────────────

/** Everything a serial is made of. `seq` is allocated, never guessed. */
export interface BagSerialParts {
  workCentre: WorkCentre
  /** Type code. Empty on the Blender, which has none. */
  typeCode?: string
  /** Session date, `yyyy-mm-dd`. Converted to DDMMYYYY here, once. */
  date: string
  /** Granule: the lot number. Blender: the blend code. Unused elsewhere. */
  qualifier?: string
  /** Blender only: which numbered run of the production day this is. */
  runNo?: number
  seq: number
}

/**
 * The counting scope — the key the sequence is allocated against, and the
 * thing `next_bag_serial` locks on. Everything sharing a scope shares one
 * counter.
 *
 * This is NOT always a prefix of the serial. On the Granule Line the scope is
 * `GL{TYPE}-{LOT}` while the serial interpolates the date after the lot, so
 * one lot running Monday and Tuesday keeps one continuous sequence across two
 * different serials. That is the whole point of the Granule exception (§5) and
 * it is why scope and format are separate functions rather than one string
 * with a number stuck on the end.
 */
export function serialScope(parts: Omit<BagSerialParts, 'seq'>): string {
  const { workCentre: wc, typeCode = '', date, qualifier = '', runNo } = parts
  requireQualifier(wc, qualifier)
  switch (wc) {
    case 'ST':
    case 'R1':
    case 'R2':
      // Date is the counting scope: the sequence restarts each production day.
      return `${wc}${typeCode}-${ddmmyyyy(date)}`
    case 'GL':
      // LOT is the counting scope. Deliberately no date — the same lot runs
      // across several days and must read as one continuous sequence.
      return `GL${typeCode}-${String(qualifier).trim()}`
    case 'BL':
    case 'SB':
      // Blend + which run of the day. No type code: the blend type and number
      // are what the Pasteuriser consumes and what the order is raised against.
      //
      // The run separator is '-', NOT '/'. A serial goes into a URL path at
      // /api/production/live/bag/[serial] and in the Bag Tracking deep links,
      // and a '/' splits the route param — the Blender's previous format chose
      // '-' for exactly this reason and said so. ARCHITECTURE.md §5 originally
      // wrote this as '{DDMMYYYY}/{run}'; the slash was wrong.
      return `${wc}-${String(qualifier).trim()}-${ddmmyyyy(date)}-${runNo ?? 1}`
    default:
      return assertNeverWorkCentre(wc)
  }
}

/** Render a complete serial. The only place a serial string is ever built. */
export function formatBagSerial(parts: BagSerialParts): string {
  const { workCentre: wc, typeCode = '', date, qualifier = '', seq } = parts
  requireQualifier(wc, qualifier)
  switch (wc) {
    case 'ST':
    case 'R1':
    case 'R2':
    case 'BL':
    case 'SB':
      // Scope is a true prefix for these.
      return `${serialScope(parts)}-${pad3(seq)}`
    case 'GL':
      // Date sits BETWEEN the lot and the sequence, so the serial still says
      // which day the bag was made even though the count ignores the day.
      return `GL${typeCode}-${String(qualifier).trim()}-${ddmmyyyy(date)}-${pad3(seq)}`
    default:
      return assertNeverWorkCentre(wc)
  }
}

function assertNeverWorkCentre(wc: never): never {
  throw new Error(`Unhandled work centre: ${String(wc)}`)
}

/**
 * Granule and Blender serials are meaningless without their qualifier, and
 * this throws rather than emitting one.
 *
 * On the Granule Line the LOT is the counting scope, so a bag with no lot has
 * no sequence to belong to; on the Blender the blend code is the whole
 * identity, since there is no type code to fall back on. Left unchecked, an
 * empty qualifier produced 'GLSG--01092026-001' — a double hyphen that reads
 * back as a real serial with an empty lot, so the bag would look tagged while
 * belonging to no counter at all.
 *
 * This is a programming error, not operator error: the capture screen must not
 * offer to tag a bag before the lot or blend is known. Callers gate on that,
 * exactly as the floor does — you cannot label a granule bag before you know
 * which lot it came from.
 */
function requireQualifier(wc: WorkCentre, qualifier: string): void {
  if (wc !== 'GL' && wc !== 'BL' && wc !== 'SB') return
  if (String(qualifier).trim()) return
  const what = wc === 'GL' ? 'a lot number' : 'a blend code'
  throw new Error(`${wc} serials need ${what}: the sequence is counted per ${wc === 'GL' ? 'lot' : 'blend run'}, so there is nothing to count against without one.`)
}

// ── Reading a serial back ────────────────────────────────────────────────────

export interface ParsedBagSerial {
  workCentre: WorkCentre
  typeCode: string
  /** `DDMMYYYY`, or `DDMMYY` on a legacy serial. Empty when the format has none. */
  dateDigits: string
  /** `yyyy-mm-dd`, or null when the digits can't be a real date. */
  date: string | null
  qualifier: string
  runNo: number | null
  seq: number
  /** True when the date stem is the historic six-digit form. */
  legacy: boolean
}

/** `DDMMYYYY` or `DDMMYY` → `yyyy-mm-dd`. Null if it isn't a plausible date. */
function dateFromDigits(digits: string): string | null {
  const m = digits.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/)
  if (!m) return null
  const [, dd, mm, yr] = m
  // A two-digit year is 20xx: these serials start in 2025 and the format is
  // being retired, so there is no century ambiguity to agonise over.
  const yyyy = yr.length === 4 ? yr : `20${yr}`
  const d = Number(dd), mo = Number(mm)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Decompose a serial of the current scheme. Null if it isn't one — including
 * every historic format, which parseSerial() above still reads.
 *
 * ANCHORED FROM BOTH ENDS, never split on '-'. The sequence is peeled off the
 * end, the work centre and type off the front, the date off whichever end the
 * section's format puts it, and whatever survives in the middle is the
 * qualifier — which may itself contain hyphens and slashes. Granule lots like
 * 'RSGG-05626' are exactly why: `'GLSG-RSGG-05626-01092026-001'.split('-')`
 * reads the lot as 'RSGG' and the date as '05626', and both look plausible.
 */
export function parseBagSerial(serial: string): ParsedBagSerial | null {
  const raw = String(serial ?? '').trim().toUpperCase()
  if (!raw) return null

  // 1. Peel the sequence off the end.
  const tail = raw.match(/^(.*)-(\d{1,4})$/)
  if (!tail) return null
  const body = tail[1]
  const seq = parseInt(tail[2], 10)

  // 2. Work centre off the front — always exactly two characters.
  const wc = body.slice(0, 2) as WorkCentre
  if (!(wc in TYPE_CODES)) return null

  const mk = (typeCode: string, dateDigits: string, qualifier: string, runNo: number | null): ParsedBagSerial => ({
    workCentre: wc, typeCode, dateDigits,
    date: dateFromDigits(dateDigits), qualifier, runNo, seq,
    legacy: dateDigits.length === 6,
  })

  if (wc === 'BL' || wc === 'SB') {
    // {WC}-{BLEND}-{DDMMYYYY}-{run}. The blend code itself may contain '-',
    // so the date and run are taken off the END, not by splitting. The greedy
    // (.*) anchors to the LAST date-then-run, which is what makes that safe.
    const m = body.match(/^(?:BL|SB)-(.*)-(\d{6}|\d{8})-(\d+)$/)
    if (!m) return null
    return mk('', m[2], m[1], parseInt(m[3], 10))
  }

  // 3. Type code: the letters between the work centre and the first hyphen.
  //    Length is 2-4 and varies ('EXP', 'CHSF'); it is the anchoring that
  //    makes this unambiguous, not the length.
  const head = body.slice(2).match(/^([A-Z]{2,4})-(.*)$/)
  if (!head) return null
  const typeCode = head[1]
  const rest = head[2]

  if (wc === 'GL') {
    // GL{TYPE}-{LOT}-{DDMMYYYY}. Date off the end; everything before it is the
    // lot, hyphens and all.
    const m = rest.match(/^(.*)-(\d{6}|\d{8})$/)
    if (!m) return null
    return mk(typeCode, m[2], m[1], null)
  }

  // ST/R1/R2: {TYPE}-{DDMMYYYY}, nothing in between.
  if (!/^(\d{6}|\d{8})$/.test(rest)) return null
  return mk(typeCode, rest, '', null)
}

/**
 * A chronologically sortable "when was this bag made" key, or null.
 *
 * Used to order bags of ONE product against each other — never across
 * products, since each product's sequence counts independently and bag 007 of
 * Fine Leaf has nothing to do with bag 007 of Coarse Leaf.
 *
 * Returns null for anything unparseable rather than guessing, so hand-typed
 * legacy serials ('13.08.05') are excluded from an ordering they cannot be
 * placed in. A six-digit legacy serial DOES sort, alongside eight-digit ones:
 * the date is normalised to yyyy-mm-dd first, so a changeover day mixing both
 * formats still orders correctly instead of splitting into two runs.
 */
export function serialOrderKey(serial: string | null | undefined): string | null {
  const p = parseBagSerial(String(serial ?? ''))
  if (!p || !p.date) return null
  return `${p.date}-${String(p.seq).padStart(6, '0')}`
}

export interface ResolvedTypeCode {
  code: string
  /** False when the code was derived rather than looked up. */
  configured: boolean
}

/**
 * typeCodeFor(), but it always returns a code — for the one caller that cannot
 * fail: the capture screen, mid-shift, with a bag on the scale.
 *
 * Products can reach a capture screen from the Acumatica master inventory
 * without anyone having added them to TYPE_MATCHERS, so an unmapped product is
 * a routine event, not a broken install. Refusing to bag it would stop the
 * line over a naming gap; the old SievingCapture behaviour — first two letters
 * — keeps it moving.
 *
 * What is new is that the caller is TOLD. `configured: false` means the code
 * was guessed, and a guessed code is indistinguishable from a real one once it
 * is printed on a bag, so the screen surfaces it and someone maps the product
 * properly. Sequence allocation is unaffected either way: the scope contains
 * whatever code came back, so the count stays correct for that product.
 *
 * typeCodeFor() keeps returning null, because callers deciding whether a
 * product is known must not be handed a guess.
 */
export function resolveTypeCode(wc: WorkCentre, productType: string): ResolvedTypeCode {
  const known = typeCodeFor(wc, productType)
  if (known) return { code: known, configured: true }
  const letters = String(productType ?? '').replace(/[^A-Za-z]/g, '').toUpperCase()
  return { code: letters.slice(0, 2) || 'XX', configured: false }
}

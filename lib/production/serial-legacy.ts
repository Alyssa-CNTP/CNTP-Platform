/**
 * The historic serial generators, kept as the rollout fallback.
 *
 * These are the four per-section generators exactly as they behaved before the
 * current scheme (ARCHITECTURE.md §5): the old date stem, the old type
 * abbreviations, and the app-side `max + 1` scan of bag_tags.
 *
 * They are NOT good code. The max+1 scan is the documented cause of bags going
 * missing (§1B) and the `limit(4000)` reads a wrong max past 4000 rows. They
 * exist for one reason: `usesDbSerials(sectionId)` rolls the new scheme out one
 * section at a time, and a rollout without a way back is not a rollout.
 * Serials get printed onto physical bags, so "revert the code" does not undo a
 * bad format — only "stop minting it" does, and that has to be one line in the
 * environment.
 *
 * Gathered here rather than left in the four capture components so the old
 * behaviour has ONE owner while it lives, and so deleting it later is deleting
 * a file rather than hunting four copies. Delete this module once every section
 * is in NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION and has stayed there.
 */

import { getDb } from '@/lib/supabase/db'
import { ddmmyy, pad3, seqOf, makeSerial } from '@/lib/core/serials'

/** The pre-scheme Sieving abbreviations. Note RS, not HS — this is history. */
const SIEVING_TYPE_ABBR: Array<[RegExp, string]> = [
  [/fine leaf/i,               'FL'],
  [/coarse leaf/i,             'CL'],
  [/rolsiev|rol siev/i,        'RS'],
  [/indent stick/i,            'IS'],
  [/rb block|\bblock/i,        'RB'],
  [/brown dust/i,              'BD'],
  [/powder dust/i,             'PD'],
  [/white dust/i,              'WD'],
  [/bucket elevator|spillage/i,'BE'],
]

function sievingAbbr(productType: string): string {
  for (const [re, code] of SIEVING_TYPE_ABBR) if (re.test(productType || '')) return code
  const letters = (productType || '').replace(/[^A-Za-z]/g, '').toUpperCase()
  return letters.slice(0, 2) || 'XX'
}

/** Highest sequence already used under a serial prefix, local rows + bag_tags. */
async function maxUnderPrefix(prefix: string, localSerials: readonly string[]): Promise<number> {
  let max = localSerials.filter(s => String(s).startsWith(prefix)).reduce((mx, s) => Math.max(mx, seqOf(s)), 0)
  try {
    const { data } = await getDb().schema('production').from('bag_tags')
      .select('serial_number').ilike('serial_number', `${prefix}%`).limit(4000)
    ;(data ?? []).forEach((r: { serial_number: string }) => { max = Math.max(max, seqOf(r.serial_number)) })
  } catch { /* offline — fall back to the local max */ }
  return max
}

/** `ST{abbr}-{DDMMYY}-{NNN}`, sequenced per product type per day. */
export async function legacySievingSerial(
  productType: string, localSerials: readonly string[], date: string,
): Promise<string> {
  const prefix = `ST${sievingAbbr(productType)}-${ddmmyy(date)}-`
  return `${prefix}${pad3(await maxUnderPrefix(prefix, localSerials) + 1)}`
}

/**
 * `{LOT}-{NNN}` when there is a lot, otherwise `GL-{DDMMYY}-{NNN}`.
 *
 * With a lot the sequence continued per lot, read off bag_tags.lot_number
 * rather than a serial prefix — and it counted granules and dust together,
 * which is one of the things the current scheme fixes.
 */
export async function legacyGranuleSerial(
  lot: string, localSerials: readonly string[], date: string,
): Promise<string> {
  const lotStem = String(lot ?? '').trim()
  const stem = lotStem || `GL-${ddmmyy(date)}`
  let max = localSerials.reduce((mx, s) => Math.max(mx, seqOf(s)), 0)
  try {
    const { data } = lotStem
      ? await getDb().schema('production').from('bag_tags')
          .select('serial_number').eq('lot_number', lotStem).limit(4000)
      : await getDb().schema('production').from('bag_tags')
          .select('serial_number').ilike('serial_number', `${stem}-%`).limit(4000)
    ;(data ?? []).forEach((r: { serial_number: string }) => { max = Math.max(max, seqOf(r.serial_number)) })
  } catch { /* offline — fall back to the local max */ }
  return `${stem}-${pad3(max + 1)}`
}

/**
 * `{SECTIONCODE}-{DDMMYY}-{NNN}` — Refining's old serial.
 *
 * One counter for the WHOLE section, which is why Indent and White Dust shared
 * a sequence and neither number counted its own product.
 */
export async function legacyRefiningSerial(
  sectionCode: string, localSerials: readonly string[], date: string,
): Promise<string> {
  const prefix = `${sectionCode}-${ddmmyy(date)}-`
  return makeSerial(sectionCode, date, await maxUnderPrefix(prefix, localSerials) + 1)
}

/** `{BLEND}-{run}-{bag}`, bag padded to two digits. */
export async function legacyBlendSerial(
  blendCode: string, runNo: number, localSerials: readonly string[], dayStart: string, dayEnd: string,
): Promise<string> {
  const escaped = blendCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bagPattern = new RegExp(`^${escaped}-${runNo}-(\\d+)$`)
  let max = localSerials.reduce((mx, s) => {
    const m = String(s).match(bagPattern); return m ? Math.max(mx, parseInt(m[1], 10)) : mx
  }, 0)
  try {
    const { data } = await getDb().schema('production').from('bag_tags')
      .select('serial_number').ilike('serial_number', `${blendCode}-%`)
      .gte('created_at', dayStart).lt('created_at', dayEnd)
    ;(data ?? []).forEach((r: { serial_number: string }) => {
      const m = String(r.serial_number).match(bagPattern)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    })
  } catch { /* offline — fall back to the local max */ }
  return `${blendCode}-${runNo}-${String(max + 1).padStart(2, '0')}`
}

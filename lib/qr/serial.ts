/**
 * CNTP Serial Number System
 *
 * Confirmed format from actual operator reports, 04–05 May 2026.
 *
 * ── All section outputs (Sieving Tower, Refining 1/2, Granule Line): ─────────
 *   Format:  DD-MM-NN
 *   Example: 04-05-01  (4 May, bag 1 of that output type that day)
 *            04-05-13  (4 May, bag 13)
 *
 *   DD = day (01–31)
 *   MM = month (01–12)
 *   NN = running sequence for that output type within the calendar day.
 *        Continuous across all shifts — morning Fine Leaf ends at 13,
 *        afternoon starts at 14. Resets to 01 at midnight.
 *        Each output type (Fine Leaf, Coarse Leaf, IS, RS, Dust etc.)
 *        has its own independent counter.
 *
 * ── Blended Material (Blender + Pasteuriser output): ─────────────────────────
 *   Format:  DD-MM-YY/BlendNo-BagNo
 *   Example: 04-05-26/1-01  (4 May 2026, blend run 1, bag 1)
 *            04-05-26/2-11  (4 May 2026, blend run 2, bag 11)
 *
 *   Confirmed from papers:
 *     Blend 1 morning  → 04-05-26/1-01 … 04-05-26/1-20 (20 bags × 350 kg)
 *     Blend 2 afternoon → 04-05-26/2-01 … 04-05-26/2-11 (11 bags)
 *
 *   Sequence resets per blend run (not per day).
 *   BlendNo is extracted from the lot number field in the Blender form.
 *
 * The serial is the ONLY thing encoded in the barcode label.
 * All metadata lives in Supabase production.bag_tags keyed by serial_number.
 */

/**
 * Generate a DD-MM-NN serial for any section output bag.
 * @param date  Session date (defaults to today)
 * @param seq   Sequence number for this output type this day (1-based)
 */
export function generateSerial(date: Date = new Date(), seq: number = 1): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const nn = String(seq).padStart(2, '0')
  return `${dd}-${mm}-${nn}`
}

/**
 * Get the next serial for a given output type on a given day.
 * Reads all existing serials for that type and increments from the highest.
 * @param date            Session date
 * @param existingSerials All serials already used for this output type today
 */
export function nextSerial(date: Date = new Date(), existingSerials: string[]): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const pattern = new RegExp(`^${dd}-${mm}-(\\d{2})$`)

  const maxSeq = existingSerials.reduce((max, s) => {
    const m = s.match(pattern)
    return m ? Math.max(max, parseInt(m[1])) : max
  }, 0)

  return generateSerial(date, maxSeq + 1)
}

/**
 * Generate a Blended Material serial (Blender or Pasteuriser output).
 * Keeps the existing physical tag format exactly as used on the floor.
 * @param date       Session date
 * @param blendRunNo Blend run number — extracted from lot field e.g. "1" from "04-05-26/1"
 * @param bagSeq     Bag sequence within this blend run (1-based)
 */
export function generateBlendSerial(
  date: Date = new Date(),
  blendRunNo: string | number,
  bagSeq: number = 1
): string {
  const dd  = String(date.getDate()).padStart(2, '0')
  const mm  = String(date.getMonth() + 1).padStart(2, '0')
  const yy  = String(date.getFullYear()).slice(-2)
  const seq = String(bagSeq).padStart(2, '0')
  return `${dd}-${mm}-${yy}/${blendRunNo}-${seq}`
}

/**
 * Get the next Blended Material serial for a given blend run.
 * @param lotNo           Lot number field from Blender form e.g. "04-05-26/1"
 * @param date            Session date
 * @param existingSerials All serials already used for this blend run
 */
export function nextBlendSerial(
  lotNo: string,
  date: Date = new Date(),
  existingSerials: string[]
): string {
  const runMatch = lotNo.match(/\/(\S+)$/)
  const blendRunNo = runMatch ? runMatch[1] : '1'

  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)

  const escaped = blendRunNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${dd}-${mm}-${yy}\\/${escaped}-(\\d{2})$`)

  const maxSeq = existingSerials.reduce((max, s) => {
    const m = s.match(pattern)
    return m ? Math.max(max, parseInt(m[1])) : max
  }, 0)

  return generateBlendSerial(date, blendRunNo, maxSeq + 1)
}

/**
 * Parse any CNTP serial back into its components.
 * Returns null if unrecognised format.
 */
export function parseSerial(serial: string): {
  type: 'section' | 'blend'
  dd: string
  mm: string
  seq: number
  blendRun?: string
  display: string
} | null {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  // Section format: DD-MM-NN
  const sec = serial.match(/^(\d{2})-(\d{2})-(\d{2})$/)
  if (sec) {
    const [, dd, mm, nn] = sec
    const monthName = months[parseInt(mm) - 1] ?? mm
    return {
      type: 'section',
      dd, mm,
      seq: parseInt(nn),
      display: `${dd} ${monthName} · bag ${parseInt(nn)}`,
    }
  }

  // Blend format: DD-MM-YY/BlendNo-BagNo
  const blend = serial.match(/^(\d{2})-(\d{2})-\d{2}\/(.+)-(\d{2})$/)
  if (blend) {
    const [, dd, mm, blendRun, bagNo] = blend
    const monthName = months[parseInt(mm) - 1] ?? mm
    return {
      type: 'blend',
      dd, mm,
      seq: parseInt(bagNo),
      blendRun,
      display: `${dd} ${monthName} · blend ${blendRun} · bag ${parseInt(bagNo)}`,
    }
  }

  return null
}
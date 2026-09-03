/**
 * Absolute plausibility bounds for a typed QC measurement.
 *
 * Why this exists alongside lib/utils/outliers.ts: that check is STATISTICAL —
 * it flags a value that sits far from the other samples in the run, and only
 * once the run already has real spread (`std > stdFloor`). Both conditions
 * failed for the values that actually got into production:
 *
 *   • granule samples 754 / 755 — bulk density 2200 (a 220 with a stray zero).
 *     Every other sample in that run read exactly 220, so std was 0, the
 *     outlier check returned null, and nothing was flagged.
 *   • granule sample 117 — moisture 121 and dryer temp 1215, one row where the
 *     decimal point was dropped throughout (12.1 % and 121.5 °C).
 *   • four more granule rows and four pasteuriser rows with 0 or 95 % moisture.
 *
 * A statistical check can never catch the first sample of a run, or a run where
 * everyone typed the same wrong thing. These bounds are absolute and need no
 * history at all.
 *
 * Two levels, deliberately:
 *   • `block`   — physically impossible, or an obvious decimal slip. Refused.
 *   • `confirm` — unusual but genuinely producible (a real dryer fault does make
 *                 11 % moisture). Warned, and saveable once confirmed.
 *
 * The soft band is set from the observed p01–p99 of ~650 real samples, widened
 * outward. It is intentionally NOT a spec: a spec says whether product is
 * acceptable, this says whether the NUMBER was typed correctly.
 */

export type PlausibilityLevel = 'ok' | 'confirm' | 'block'

export type PlausibilityVerdict = {
  level: PlausibilityLevel
  message?: string
  /** Most likely intended value when the reading looks like a decimal slip. */
  suggestion?: number
}

/** The measurements this module knows how to sanity-check. */
export type MeasurementKey =
  | 'moisture'
  | 'bulk_density_cc'   // cc/100g — every line except Rosehips
  | 'bulk_density_ml'   // ml/5g   — Rosehips is volumetric (see pastBdUnit)
  | 'dryer_temp'
  | 'sieve_pct'

type Bounds = {
  label: string
  unit: string
  hardMin: number; hardMax: number
  softMin: number; softMax: number
}

export const MEASUREMENT_BOUNDS: Record<MeasurementKey, Bounds> = {
  // Observed 3.2-11.34 % over 652 samples (p01 6.4, p99 10.6). Dried tea cannot
  // be 0 % and cannot be 95 % — both appear in the data as typing errors.
  moisture:        { label: 'Moisture',      unit: '%',        hardMin: 1,  hardMax: 25,  softMin: 4,   softMax: 11 },
  // Observed 170-320 cc/100g over 641 sound samples (p01 190, p99 266).
  bulk_density_cc: { label: 'Bulk density',  unit: ' cc/100g', hardMin: 80, hardMax: 450, softMin: 160, softMax: 330 },
  // Rosehips is reported as "<10 ml/5g", so its numbers live in a completely
  // different range. Using the cc/100g bounds here would block every valid
  // Rosehips reading.
  bulk_density_ml: { label: 'Bulk density',  unit: ' ml/5g',   hardMin: 1,  hardMax: 50,  softMin: 2,   softMax: 20 },
  // Observed p01 115, p99 133 °C. 1215 and 1 both appear as errors.
  dryer_temp:      { label: 'Dryer temp',    unit: '°C',       hardMin: 20, hardMax: 200, softMin: 100, softMax: 145 },
  // A fraction of a sieve analysis. Only the impossible is refused.
  sieve_pct:       { label: 'Sieve fraction', unit: '%',       hardMin: 0,  hardMax: 100, softMin: 0,   softMax: 100 },
}

/**
 * If shifting the decimal point one or two places lands the value inside the
 * plausible band, that is almost certainly what was meant — 2200 -> 220,
 * 1215 -> 121.5, 121 -> 12.1. Offered as a suggestion only; it is never
 * applied automatically, because silently rewriting a QC's reading is worse
 * than refusing it.
 */
function decimalSlipSuggestion(value: number, b: Bounds): number | undefined {
  const shifts = [value / 10, value / 100, value * 10, value * 100]
  // Prefer a shift that lands in the USUAL band; fall back to one that is
  // merely possible. Moisture 121 -> 12.1 is the case that needs the fallback:
  // 12.1 % is above the usual ceiling of 11 but well inside the possible range,
  // and it is obviously what was meant.
  return shifts.find(v => v >= b.softMin && v <= b.softMax)
      ?? shifts.find(v => v >= b.hardMin && v <= b.hardMax)
}

/** Round a suggestion to at most 2dp without trailing float noise. */
function tidy(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Judge one typed value. A blank or unparseable entry is `ok` — "required" is a
 * separate question from "plausible", and conflating them would block a QC
 * halfway through typing.
 */
export function checkPlausibility(
  key: MeasurementKey,
  raw: unknown,
): PlausibilityVerdict {
  const b = MEASUREMENT_BOUNDS[key]
  if (raw === null || raw === undefined || String(raw).trim() === '') return { level: 'ok' }
  const v = Number(String(raw).trim())
  if (!Number.isFinite(v)) return { level: 'ok' }

  if (v < b.hardMin || v > b.hardMax) {
    const s = decimalSlipSuggestion(v, b)
    const suggestion = s === undefined ? undefined : tidy(s)
    return {
      level: 'block',
      message: `${b.label} ${v}${b.unit} is outside the possible range ${b.hardMin}–${b.hardMax}${b.unit}.`
        + (suggestion !== undefined ? ` Did you mean ${suggestion}${b.unit}?` : ''),
      suggestion,
    }
  }
  if (v < b.softMin || v > b.softMax) {
    return {
      level: 'confirm',
      message: `${b.label} ${v}${b.unit} is outside the usual ${b.softMin}–${b.softMax}${b.unit} — confirm this is a genuine reading.`,
    }
  }
  return { level: 'ok' }
}

/** Which BD bounds apply to a product family. Rosehips is volumetric. */
export function bdMeasurementFor(productFamily: string | null | undefined): MeasurementKey {
  return String(productFamily ?? '').trim().toLowerCase() === 'rosehips'
    ? 'bulk_density_ml'
    : 'bulk_density_cc'
}

export type FieldCheck = { key: MeasurementKey; value: unknown; label?: string }

/**
 * Judge several fields at once. Returns the blocking messages and the
 * confirmable ones separately, because they drive different UI: a block
 * disables save, a confirm goes in the existing confirm-to-save list.
 */
export function checkAllPlausibility(fields: FieldCheck[]): { blocks: string[]; confirms: string[] } {
  const blocks: string[] = []
  const confirms: string[] = []
  for (const f of fields) {
    const r = checkPlausibility(f.key, f.value)
    if (!r.message) continue
    // A caller-supplied label names the specific field ("Dryer 2 moisture")
    // where the generic one would be ambiguous on a form with two of them.
    const msg = f.label
      ? r.message.replace(MEASUREMENT_BOUNDS[f.key].label, f.label)
      : r.message
    if (r.level === 'block') blocks.push(msg)
    else if (r.level === 'confirm') confirms.push(msg)
  }
  return { blocks, confirms }
}

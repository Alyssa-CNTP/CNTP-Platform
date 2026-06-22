/**
 * Spec resolution for machine checks — one source of truth.
 *
 * Machine-parameter ranges (VSD, scale tolerance, screen speed/angle) come from
 * production.check_specs (supervisor-editable, seeded per section). Product /
 * sieve-quality ranges are resolved live from qms.customer_specs so production
 * checks and QC read identical numbers.
 */
import { getDb } from '@/lib/supabase/db'

export interface CheckSpec {
  min:    number | null
  max:    number | null
  target: number | null   // e.g. scale tolerance (± kg)
  unit:   string | null
  note:   string | null
}

/** Load every machine-parameter spec for a section, keyed by check_key. */
export async function loadCheckSpecs(sectionId: string): Promise<Record<string, CheckSpec>> {
  const { data } = await getDb().schema('production').from('check_specs')
    .select('*').eq('section_id', sectionId).eq('active', true)
  const map: Record<string, CheckSpec> = {}
  ;(data ?? []).forEach((r: any) => {
    map[r.check_key] = { min: r.min, max: r.max, target: r.target, unit: r.unit, note: r.note }
  })
  return map
}

/** Rule-based out-of-range test (instant, non-blocking soft flag). */
export function outOfRange(value: number, spec?: CheckSpec | null): boolean {
  if (!spec) return false
  if (spec.min != null && value < spec.min) return true
  if (spec.max != null && value > spec.max) return true
  return false
}

/** Scale verification: actual is OK when within ± target kg of the standard. */
export function scaleOutOfTolerance(std: number, actual: number, spec?: CheckSpec | null): boolean {
  const tol = spec?.target ?? 0.1
  return Math.abs(actual - std) > tol
}

/**
 * Best-effort quality guidance for the "Sieving configuration" check — pulls the
 * QC sieve spec for the active variant from qms.customer_specs so the operator
 * sees the same target ranges quality enforces. Returns a short hint or null.
 */
export async function loadQualitySieveHint(variant: string): Promise<string | null> {
  if (!variant) return null
  const { data } = await getDb().schema('qms').from('customer_specs')
    .select('product_family, grade, gt12_min, gt12_max, gt16_min, gt16_max, gt20_min, gt20_max, dust_max')
    .eq('variant', variant).limit(1).maybeSingle()
  if (!data) return null
  const r: any = data
  const parts: string[] = []
  const range = (lbl: string, lo: any, hi: any) => {
    if (lo == null && hi == null) return
    parts.push(`${lbl} ${lo ?? 0}–${hi ?? '∞'}%`)
  }
  range('>12', r.gt12_min, r.gt12_max)
  range('>16', r.gt16_min, r.gt16_max)
  range('>20', r.gt20_min, r.gt20_max)
  if (r.dust_max != null) parts.push(`dust ≤${r.dust_max}%`)
  if (!parts.length) return null
  return `QC target (${r.product_family ?? variant}): ${parts.join(' · ')}`
}

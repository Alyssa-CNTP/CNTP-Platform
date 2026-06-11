/**
 * Manual production capture (Phase 1) — shared configuration.
 *
 * Phase 1: operators type/confirm bag details on a tablet; the system
 * generates a barcode per output bag. Phase 2 flips `mode` to 'scan' and
 * the same data model is driven by the barcode reader instead.
 *
 * Section output types + colours come from live-types SECTION_CONFIG so the
 * manual flow and the scanning flow never drift apart.
 */
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { Variant as DbVariant } from '@/lib/supabase/database.types'

export type CaptureMode = 'manual' | 'scan'

// Which section currently runs in which mode. Sieving is the proven slice.
export const SECTION_MODE: Record<string, CaptureMode> = {
  sieving:     'manual',
  refining1:   'manual',
  refining2:   'manual',
  granule:     'manual',
  blender:     'manual',
  pasteuriser: 'manual',
}

// Sections that need a lot/batch number set at assignment time.
export const NEEDS_LOT = new Set(['blender', 'granule', 'pasteuriser'])
// Sections that need a variant set at assignment time.
export const NEEDS_VARIANT = new Set(['sieving', 'refining1', 'refining2', 'granule', 'blender', 'pasteuriser'])

export const SECTION_ORDER = ['sieving', 'refining1', 'refining2', 'granule', 'blender', 'pasteuriser'] as const

export interface SectionMeta {
  id: string
  name: string
  code: string
  colorHex: string
  outputTypes: string[]
  built: boolean   // is the manual capture screen implemented yet?
}

export function sectionMeta(id: string): SectionMeta {
  const cfg = SECTION_CONFIG[id]
  return {
    id,
    name:        cfg?.name ?? id,
    code:        cfg?.code ?? '??',
    colorHex:    cfg?.colorHex ?? '#1A3A0E',
    outputTypes: cfg?.outputTypes ?? [],
    built:       id === 'sieving',   // expands as we replicate the pattern
  }
}

// ── Variant options (full Acumatica words — match the DB CHECK constraint) ────
export const VARIANT_OPTIONS: { value: DbVariant; short: string; label: string }[] = [
  { value: 'Conventional',    short: 'CON',    label: 'Conventional' },
  { value: 'Organic',         short: 'ORG',    label: 'Organic' },
  { value: 'RA-Conventional', short: 'RA CON', label: 'RA Conventional' },
  { value: 'RA-Organic',      short: 'RA ORG', label: 'RA Organic' },
  { value: 'FT-ORG',          short: 'FT ORG', label: 'Fairtrade Organic' },
]

// Full Acumatica variant word → live-types short code used by getAcumaticaCode().
export function variantToShort(v: DbVariant | null | undefined): string {
  const map: Record<string, string> = {
    'Conventional': 'CON', 'Organic': 'ORG',
    'RA-Conventional': 'RA CON', 'RA-Organic': 'RA ORG', 'FT-ORG': 'ORG',
  }
  return v ? (map[v] ?? 'CON') : 'CON'
}

// Output destination (operator's choice per leaf bag) → Acumatica grade letter.
export const DESTINATION_OPTIONS = [
  { value: 'A', label: 'Export' },
  { value: 'B', label: 'Export Blend' },
  { value: 'C', label: 'Domestic / Local' },
] as const

// ── Serial generation ─────────────────────────────────────────────────────────
// Phase 1 human-typed-friendly format: {CODE}-{DDMMYY}-{NNN}.
// `seq` is seeded from the count of bags already created for this section+date
// so numbers continue rather than collide. Upgrade path: DB sequence.
export function makeSerial(sectionCode: string, dateStr: string, seq: number): string {
  const d = dateStr.split('-')            // yyyy-mm-dd
  const ddmmyy = d.length === 3 ? `${d[2]}${d[1]}${d[0].slice(2)}` : '000000'
  return `${sectionCode}-${ddmmyy}-${String(seq).padStart(3, '0')}`
}

export const MASS_BALANCE_TOLERANCE_KG = 15

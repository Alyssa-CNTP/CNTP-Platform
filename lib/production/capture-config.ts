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
  sieving:      'manual',
  refining1:    'manual',
  refining2:    'manual',
  granule:      'manual',
  blender:      'manual',
  smallblender: 'manual',
  pasteuriser:  'manual',
}

// Sections that need a lot/batch number set at assignment time.
export const NEEDS_LOT = new Set(['blender', 'smallblender', 'granule', 'pasteuriser'])
// Sections that need a variant set at assignment time.
export const NEEDS_VARIANT = new Set(['sieving', 'refining1', 'refining2', 'granule', 'blender', 'smallblender', 'pasteuriser'])

export const SECTION_ORDER = ['sieving', 'refining1', 'refining2', 'granule', 'blender', 'smallblender', 'pasteuriser'] as const

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
    built:       ['sieving', 'refining1', 'refining2', 'granule', 'blender', 'smallblender', 'pasteuriser'].includes(id),
  }
}

// ── Variant options (full Acumatica words — match the DB CHECK constraint) ────
export const VARIANT_OPTIONS: { value: DbVariant; short: string; label: string }[] = [
  { value: 'Conventional',    short: 'CON',    label: 'Conventional' },
  { value: 'Organic',         short: 'ORG',    label: 'Organic' },
  { value: 'RA-Conventional', short: 'RA CON', label: 'RA Conventional' },
  { value: 'RA-Organic',      short: 'RA ORG', label: 'RA Organic' },
  { value: 'FT-ORG',          short: 'FT ORG', label: 'Fairtrade Organic' },
  { value: 'FT-CON',          short: 'FT CON', label: 'Fairtrade Conventional' },
]

// Full Acumatica variant word → live-types short code used by getAcumaticaCode().
export function variantToShort(v: DbVariant | null | undefined): string {
  const map: Record<string, string> = {
    'Conventional': 'CON', 'Organic': 'ORG',
    'RA-Conventional': 'RA CON', 'RA-Organic': 'RA ORG', 'FT-ORG': 'ORG', 'FT-CON': 'CON',
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

// Refining 2's process naturally carries a wider swing before a mass-balance
// variance is actually worth flagging — every screen that flags a variance
// (Capture footer, Overview, dashboards/KPIs) should agree on this, so it's
// centralised here rather than each screen guessing its own threshold.
export function massBalanceToleranceFor(sectionId: string): number {
  return sectionId === 'refining2' ? 100 : MASS_BALANCE_TOLERANCE_KG
}

// Label printing is not available on the floor yet (no printer). While this is
// false, capture does NOT depend on a printer: the output picker reads
// "Complete bag" (no print round-trip) and each bag shows its serial prominently
// so it can be hand-written. Flip to true the day a printer is wired up.
export const LABEL_PRINTING_ENABLED = false

// ── Label printers ─────────────────────────────────────────────────────────
// Label command language per printer. Zebra = ZPL, Argox CP = PPLB. The app
// generates the right command string per printer, so one deployment drives
// mixed hardware.
export type PrinterLang = 'zpl' | 'pplb'

export interface PrinterConfig {
  ip: string
  lang: PrinterLang
  port?: number   // defaults to 9100 (raw print) when omitted
}

// Known physical printers on the factory network — the pick-list shown on the
// Printers admin page. Sections choose from here (and several sections may share
// one printer). Add a printer once here and it becomes selectable everywhere.
export interface KnownPrinter {
  id: string          // stable id / device serial
  label: string       // shown in the dropdown
  ip: string
  lang: PrinterLang
}

// Labels are the device serials for now — no friendly names assigned yet.
export const KNOWN_PRINTERS: KnownPrinter[] = [
  { id: 'D5J261603773', label: 'D5J261603773 (Zebra)', ip: '192.168.0.115', lang: 'zpl' },
  { id: 'D5J261605257', label: 'D5J261605257 (Zebra)', ip: '192.168.0.124', lang: 'zpl' },
  { id: 'D5J261603949', label: 'D5J261603949 (Zebra)', ip: '192.168.0.126', lang: 'zpl' },
  { id: 'argox-cp2140', label: 'Argox CP-2140EX (Pasteuriser)', ip: '192.168.0.55', lang: 'pplb' },
  { id: 'spare',        label: 'Spare — not wired yet (Refining 1 & 2)', ip: '', lang: 'zpl' },
]

// Section → printer. Each section points at a printer + language; several sections
// may share one printer. These are the fallback/seed defaults used until the
// Printers module saves rows to production.printers. The server running Next.js
// must have network line-of-sight to these IPs on the raw-print port.
//   Sieving / Blender / Granule → own dedicated Zebra each
//   Pasteuriser → Argox CP-2140EX
//   Refining 1 & 2 → the spare Zebra (share it) — IP set once it's wired up
export const SECTION_PRINTER: Record<string, PrinterConfig> = {
  sieving:     { ip: '192.168.0.115', lang: 'zpl' },  // Zebra D5J261603773
  blender:     { ip: '192.168.0.124', lang: 'zpl' },  // Zebra D5J261605257
  granule:     { ip: '192.168.0.126', lang: 'zpl' },  // Zebra D5J261603949
  pasteuriser: { ip: '192.168.0.55',  lang: 'pplb' }, // Argox CP-2140EX
  refining1:   { ip: '', lang: 'zpl' },               // spare — to be wired
  refining2:   { ip: '', lang: 'zpl' },               // shares the spare with Refining 1
}

// Which master-inventory product groups a section bags as outputs. The picker
// shows only items in these groups, matching the production's variant (and, for
// Leaf, the chosen destination) — so codes/names come straight from the master.
export const SECTION_OUTPUT_GROUPS: Record<string, string[]> = {
  sieving:     ['Leaf', 'Dust', 'Sticks'],
  refining1:   ['Dust', 'Sticks'],
  refining2:   ['Dust', 'Sticks'],
  granule:     ['Granules', 'Dust'],
  blender:     [],
  smallblender: [],
  pasteuriser: [],
}

// Destination letter → leaf code family (Export / Export Blend / Domestic).
export function leafFamily(grade: string): string {
  return grade === 'B' ? 'BL' : grade === 'C' ? 'D' : 'E'
}

// Production orders are created against specific Acumatica items per section —
// the phantom/production-order target items, NOT the generic outputs. These are
// inventory_id prefixes; the assign screen lists the matching items by variant.
//   Sieving     → S10LG* phantom leaf items (Export / Blend / Domestic)
//   Refining 1  → indent + white dust
//   Refining 2  → cut heavy stick (coarse/fine) + white/powder dust
//   Granule     → final granule items (SG/Fine/Export -001)
export const PRODUCTION_ORDER_PREFIXES: Record<string, string[]> = {
  sieving:     ['S10LG'],
  refining1:   ['15IGDIS', '15IGDW'],
  refining2:   ['20BGCHS-C-', '20BGCHS-F-', '15IGDW', '15IGDPOWDR'],
  granule:     ['20BGGSG-001', '20BGGF-001', '20BGGE-001'],
  blender:     [],
  smallblender: [],
  pasteuriser: [],
}

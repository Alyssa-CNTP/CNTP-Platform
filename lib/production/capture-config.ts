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

// Sieving Tower physical mesh screen stack, per variant family. This is a
// standing machine setup (changed only when screens are physically swapped),
// not a per-session captured value. Updated 2026-08-05: Organic was
// 10# → 18# → 40# (set up years ago to boost leaf output), which shifted more
// material into the coarse-leaf fraction and produced visual inconsistency
// between Organic and Conventional grades. Realigned to match Conventional.
export const SIEVING_MESH_CONFIG: Record<'conventional' | 'organic', string[]> = {
  conventional: ['12#', '18#', '40#'],
  organic:      ['12#', '18#', '40#'],
}
export const SIEVING_MESH_CONFIG_PREVIOUS: Record<'conventional' | 'organic', string[]> = {
  conventional: ['12#', '18#', '40#'],
  organic:      ['10#', '18#', '40#'],
}

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

// Organic variants (incl. Fairtrade Organic, which doesn't contain the word
// "Organic") must never have their mass balance combined with a different
// batch's — segregation is a certification requirement, not a preference.
const ORGANIC_VARIANTS = new Set<DbVariant>(['Organic', 'RA-Organic', 'FT-ORG'])
export function isOrganicVariant(v: string | null | undefined): boolean {
  return !!v && ORGANIC_VARIANTS.has(v as DbVariant)
}

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

// Real printers are now wired up for every bagging section (see
// SECTION_PRINTER below) — capture depends on a printer being reachable.
// While this was false, the output picker read "Complete bag" (no print
// round-trip) with the serial shown for hand-writing; that fallback path is
// still exercised automatically if a section's printer is unreachable (see
// printLabelAuto in lib/production/label-print.ts).
export const LABEL_PRINTING_ENABLED = true

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

// Standardised on Argox CP-2140EX (PPLB) across all sections — the Zebra units
// were returned (they never bound a network port). Add each new Argox here as it
// gets a static IP, or add it from the Printers admin page. Confirm any printer
// with `Test-NetConnection <ip> -Port 9100` (= True) from a same-subnet machine
// before relying on it.
export const KNOWN_PRINTERS: KnownPrinter[] = [
  { id: '26E55064', label: 'Argox CP-2140EX PRO — 26E55064 (Sieving / Refining 2)', ip: '192.168.0.115', lang: 'pplb' },
  { id: 'argox-pasteuriser', label: 'Argox CP-2140EX — Pasteuriser', ip: '192.168.0.55', lang: 'pplb' },
  { id: '26E55087', label: 'Argox CP-2140EX — 26E55087 (Prod 2 — Refining 1 / Blender)', ip: '192.168.0.124', lang: 'pplb' },
  { id: '26E55088', label: 'Argox CP-2140EX — 26E55088 (Prod 3 — Granule)', ip: '192.168.0.126', lang: 'pplb' },
]

// Section → printer. Each section points at a printer + language. These are the
// fallback/seed defaults used until the Printers module saves rows to
// production.printers. All Argox/PPLB, all confirmed — several sections
// deliberately share one physical printer.
export const SECTION_PRINTER: Record<string, PrinterConfig> = {
  pasteuriser: { ip: '192.168.0.55', lang: 'pplb' },  // Argox CP-2140EX
  sieving:     { ip: '192.168.0.115', lang: 'pplb' }, // Argox CP-2140EX PRO — 26E55064
  refining2:   { ip: '192.168.0.115', lang: 'pplb' }, // shares Sieving's printer — 26E55064
  refining1:   { ip: '192.168.0.124', lang: 'pplb' }, // Prod 2 — 26E55087, shares with Blender
  blender:     { ip: '192.168.0.124', lang: 'pplb' }, // Prod 2 — 26E55087, shares with Refining 1
  granule:     { ip: '192.168.0.126', lang: 'pplb' }, // Prod 3 — 26E55088
  // Not a production bagging section — the Sieving Final QC lab's own label
  // printer, keyed separately from `sieving` above (which is the tower's bag
  // tag printer, a different physical unit). Configured for ZSim (Zebra ZPL
  // emulation) on its front panel — it also supports IPL/ESim/DPL, but ZPL
  // lets this reuse the same builder/registry/socket path as every other
  // printer here instead of a one-off command language.
  quality_lab: { ip: '192.168.0.26', lang: 'zpl' }, // Intermec PD series — SN 175C1950042
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

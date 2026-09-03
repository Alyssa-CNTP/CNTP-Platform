/**
 * lib/constants/manufacturing.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for every code value used across the manufacturing
 * system. Import from here — never hardcode strings in components.
 *
 * IMPORTANT — VARIANT CODES:
 *   Acumatica uses FULL WORDS: 'Conventional', 'Organic', 'RA-Conventional', 'RA-Organic'
 *   The inventory ID suffix (-C, -O, -RC, -RO) is a SEPARATE encoding.
 *   The database bag_tags.variant column stores FULL WORDS.
 *   Always call normaliseVariant() before writing to bag_tags.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  normaliseVariant as coreNormaliseVariant,
  variantSuffix as coreVariantSuffix,
} from '@/lib/core/variants'

// ── VARIANT CODES ─────────────────────────────────────────────────────────────
// These EXACTLY match the Acumatica Variant field values and the
// bag_tags.variant check constraint in migration 001.

export const VARIANTS = {
  CONVENTIONAL:    'Conventional',
  ORGANIC:         'Organic',
  RA_CONVENTIONAL: 'RA-Conventional',
  RA_ORGANIC:      'RA-Organic',
  FT_ORG:          'FT-ORG',
  // FT-CON was missing here while database.types.ts, capture-config.ts and the
  // bag_tags CHECK constraint all had it, which is how 'FC' came to be mapped
  // onto FT-ORG below — there was no FT-CON to map it to.
  FT_CON:          'FT-CON',
} as const

export type Variant = typeof VARIANTS[keyof typeof VARIANTS]

export const VARIANT_OPTIONS: { value: Variant; label: string; suffix: string }[] = [
  { value: 'Conventional',    label: 'Conventional',    suffix: 'C'  },
  { value: 'Organic',         label: 'Organic',         suffix: 'O'  },
  { value: 'RA-Conventional', label: 'RA Conventional', suffix: 'RC' },
  { value: 'RA-Organic',      label: 'RA Organic',      suffix: 'RO' },
  { value: 'FT-ORG',          label: 'Fairtrade Organic', suffix: 'FO' },
]

// The short codes used in UI dropdowns (CON, ORG etc) and the ID suffix (-C, -O etc)
// both map to the canonical full-word Acumatica variant.
// This mirrors production.normalise_variant() in SQL.
//
// The table itself now lives in lib/core/variants.ts — there were four copies of
// variant identity across the app and they disagreed on the app's own short
// codes. These two functions stay as thin delegates so existing imports keep
// working; add new spellings to core, not here.
export function normaliseVariant(v: string | null | undefined): Variant | null {
  return coreNormaliseVariant(v)
}

// Derive Acumatica inventory ID suffix from variant.
// The 'C' fallback is pre-existing behaviour and only reachable for a null or
// unrecognised variant; every value of the Variant union resolves.
export function variantSuffix(v: Variant | null | undefined): string {
  return coreVariantSuffix(v) ?? 'C'
}

// ── BAG TAG STATUS ─────────────────────────────────────────────────────────────
export const BAG_STATUS = {
  IN_STOCK:   'in_stock',
  IN_PROCESS: 'in_process',
  CONSUMED:   'consumed',
  DISPATCHED: 'dispatched',
  ON_HOLD:    'on_hold',
  REJECTED:   'rejected',
} as const

export type BagStatus = typeof BAG_STATUS[keyof typeof BAG_STATUS]

export const BAG_STATUS_LABELS: Record<BagStatus, string> = {
  in_stock:   'In Stock',
  in_process: 'In Process',
  consumed:   'Consumed',
  dispatched: 'Dispatched',
  on_hold:    'On Hold',
  rejected:   'Rejected',
}

export const BAG_STATUS_COLORS: Record<BagStatus, string> = {
  in_stock:   'bg-ok/10 text-ok border-ok/30',
  in_process: 'bg-info/10 text-info border-info/30',
  consumed:   'bg-stone-100 text-stone-500 border-stone-200',
  dispatched: 'bg-purple-100 text-purple-700 border-purple-200',
  on_hold:    'bg-warn/10 text-warn border-warn/30',
  rejected:   'bg-err/10 text-err border-err/30',
}

// ── SCAN EVENT ACTIONS ────────────────────────────────────────────────────────
export const SCAN_ACTIONS = {
  DEBAGGING_IN:     'debagging_in',
  BAGGING_OUT:      'bagging_out',
  MORNING_COUNT:    'morning_count',
  DISPATCH_OUT:     'dispatch_out',
  DISPATCH_CONFIRM: 'dispatch_confirm',
  STOCK_COUNT:      'stock_count',
  STOCK_ADJUST:     'stock_adjust',
  TRANSFER:         'transfer',
} as const

export type ScanAction = typeof SCAN_ACTIONS[keyof typeof SCAN_ACTIONS]

// ── LOCATION IDs ──────────────────────────────────────────────────────────────
export const LOCATIONS = {
  WAREHOUSE:           'warehouse',
  SIEVING_STAGING:     'sieving_staging',
  REFINING_STAGING:    'refining_staging',
  BLENDER_STAGING:     'blender_staging',
  PASTEURISER_STAGING: 'pasteuriser_staging',
  GRANULE_STAGING:     'granule_staging',
  DISPATCH_BAY:        'dispatch_bay',
  IN_TRANSIT:          'in_transit',
  QC_HOLD:             'qc_hold',
} as const

export type LocationId = typeof LOCATIONS[keyof typeof LOCATIONS]

export const LOCATION_LABELS: Record<LocationId, string> = {
  warehouse:           'Warehouse',
  sieving_staging:     'Sieving Tower — Staging',
  refining_staging:    'Refining — Staging',
  blender_staging:     'Blender — Staging',
  pasteuriser_staging: 'Pasteuriser — Staging',
  granule_staging:     'Granule Line — Staging',
  dispatch_bay:        'Dispatch Bay',
  in_transit:          'In Transit',
  qc_hold:             'QC Hold',
}

export const SECTION_DEFAULT_LOCATION: Record<string, LocationId> = {
  sieving:     'sieving_staging',
  refining1:   'refining_staging',
  refining2:   'refining_staging',
  blender:     'blender_staging',
  pasteuriser: 'pasteuriser_staging',
  granule:     'granule_staging',
}

// ── DISPATCH STATUS ───────────────────────────────────────────────────────────
export const DISPATCH_STATUS = {
  PREPARING:  'preparing',
  READY:      'ready',
  LOADED:     'loaded',
  DISPATCHED: 'dispatched',
  INVOICED:   'invoiced',
  CANCELLED:  'cancelled',
} as const

export type DispatchStatus = typeof DISPATCH_STATUS[keyof typeof DISPATCH_STATUS]

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  preparing:  'Preparing',
  ready:      'Ready to Load',
  loaded:     'Loaded',
  dispatched: 'Dispatched',
  invoiced:   'Invoiced',
  cancelled:  'Cancelled',
}

export const DISPATCH_STATUS_COLORS: Record<DispatchStatus, string> = {
  preparing:  'bg-info/10 text-info',
  ready:      'bg-warn/10 text-warn',
  loaded:     'bg-purple-100 text-purple-700',
  dispatched: 'bg-ok/10 text-ok',
  invoiced:   'bg-stone-100 text-stone-600',
  cancelled:  'bg-err/10 text-err',
}

export const DISPATCH_STATUS_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  preparing:  ['ready', 'cancelled'],
  ready:      ['loaded', 'preparing', 'cancelled'],
  loaded:     ['dispatched', 'ready'],
  dispatched: ['invoiced'],
  invoiced:   [],
  cancelled:  [],
}

export function canTransitionDispatch(from: DispatchStatus, to: DispatchStatus): boolean {
  return DISPATCH_STATUS_TRANSITIONS[from].includes(to)
}

// ── SECTION METADATA ──────────────────────────────────────────────────────────
export const SECTIONS = {
  sieving:     { id: 'sieving',     name: 'Sieving Tower', code: 'ST', color: 'bg-blue-500'   },
  refining1:   { id: 'refining1',   name: 'Refining 1',    code: 'R1', color: 'bg-emerald-600' },
  refining2:   { id: 'refining2',   name: 'Refining 2',    code: 'R2', color: 'bg-emerald-500' },
  granule:     { id: 'granule',     name: 'Granule Line',  code: 'GL', color: 'bg-amber-500'   },
  blender:     { id: 'blender',     name: 'Blender',       code: 'BL', color: 'bg-purple-500'  },
  pasteuriser: { id: 'pasteuriser', name: 'Pasteuriser',   code: 'PR', color: 'bg-red-500'     },
} as const

export type SectionId = keyof typeof SECTIONS

// ── ACUMATICA INVENTORY ID PATTERNS ─────────────────────────────
// DEAD CODE, and a trap. Nothing imports ACUMATICA_IDS — the comment below is
// stale, bag_tags.acumatica_id is built by lib/production/acumatica-codes.ts.
// This is a SECOND hard-coded copy of the same ID templates, so the two can
// drift silently and the next person to reach for one has a 50% chance of
// picking the wrong one. Both are being replaced by resolution against the
// synced master inventory (features/acumatica-items); delete this const then,
// or sooner — it has no consumers to break.

export const ACUMATICA_IDS = {
  // Sieving Tower outputs (phantom items — production order targets)
  sieving_fine_leaf_export_blend: (variant: Variant) => `S10LGBL-${variantSuffix(variant)}`,
  sieving_fine_leaf_export:       (variant: Variant) => `S10LGE-${variantSuffix(variant)}`,
  sieving_fine_leaf_domestic:     (variant: Variant) => `S10LGD-${variantSuffix(variant)}`,
  // Internal leaf items (held stock)
  coarse_leaf_export_blend:       (variant: Variant) => `10LGBLC-${variantSuffix(variant)}`,
  fine_leaf_export_blend:         (variant: Variant) => `10LGBLF-${variantSuffix(variant)}`,
  coarse_leaf_export:             (variant: Variant) => `10LGEC-${variantSuffix(variant)}`,
  fine_leaf_export:               (variant: Variant) => `10LGEF-${variantSuffix(variant)}`,
  // Sticks
  indent_sticks:                  (variant: Variant) => `15IGIS-${variantSuffix(variant)}`,
  heavy_sticks:                   (variant: Variant) => `15IGST-${variantSuffix(variant)}`,
  blocks_clean:                   (variant: Variant) => `15IGBL-C-${variantSuffix(variant)}`,
  // Dusts
  brown_dust:                     (variant: Variant) => `15IGDB-${variantSuffix(variant)}`,
  indent_dust:                    (variant: Variant) => `15IGDIS-${variantSuffix(variant)}`,
  white_dust:                     (variant: Variant) => `15IGDW-${variantSuffix(variant)}`,
  powder_dust:                    (variant: Variant) => `15IGDPOWDR-${variantSuffix(variant)}`,
  sg_dust:                        (variant: Variant) => `15IGDSG-${variantSuffix(variant)}`,
  sf_dust:                        (variant: Variant) => `15IGDSF-${variantSuffix(variant)}`,
  // Refining 2 outputs
  cut_heavy_stick_fine:           (variant: Variant) => `20BGCHS-F-${variantSuffix(variant)}`,
  cut_heavy_stick_coarse:         (variant: Variant) => `20BGCHS-C-${variantSuffix(variant)}`,
  // Granules
  granules_sg:                    (variant: Variant) => `20BGGSG-001-${variantSuffix(variant)}`,
  granules_fine:                  (variant: Variant) => `20BGGF-001-${variantSuffix(variant)}`,
  granules_export:                (variant: Variant) => `20BGGE-001-${variantSuffix(variant)}`,
} as const

// ── SERIAL NUMBER VALIDATION ──────────────────────────────────────────────────
export const SERIAL_PATTERNS = {
  SECTION_BAG: /^\d{2}-\d{2}-\d{2,3}$/,
  BLEND_BAG:   /^\d{2}-\d{2}-\d{2}\/\d+-\d+$/,
} as const

export function isValidSerial(serial: string): boolean {
  return SERIAL_PATTERNS.SECTION_BAG.test(serial) ||
         SERIAL_PATTERNS.BLEND_BAG.test(serial)
}

// ── MASS BALANCE ──────────────────────────────────────────────────────────────
// A SECOND copy of the tolerance lived here, unused, while every screen
// imported the one in capture-config. Re-exported from the single core source
// so the two can never drift apart again; the tolerance is +/-1% of Total
// Input, so it takes the input, not a section id.
export {
  massBalanceToleranceKg,
  withinMassBalanceTolerance as isWithinTolerance,
} from '@/lib/core/mass-balance/tolerance'

// ── SCAN UX TIMING ────────────────────────────────────────────────────────────
export const SCAN_UX = {
  SCANNER_SPEED_THRESHOLD_MS:  200,   // faster than this = USB scanner, not human
  SERIAL_LOOKUP_DEBOUNCE_MS:   150,   // wait after complete serial before querying DB
  FEEDBACK_FLASH_DURATION_MS:  800,   // how long scan result flash shows
  ADVANCE_FOCUS_DELAY_MS:       80,   // delay before moving to next serial field
  SCAN_BUFFER_RESET_MS:         500,  // reset buffer if no key for this long
} as const

// ── LOCAL/EXPORT OPTIONS ──────────────────────────────────────────────────────
export const LOCAL_EXPORT_OPTIONS = ['Export', 'Export Blend', 'Domestic/Local'] as const
export type LocalExport = typeof LOCAL_EXPORT_OPTIONS[number]
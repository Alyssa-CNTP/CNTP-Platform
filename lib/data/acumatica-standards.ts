// ══════════════════════════════════════════════════════════════════════════════
// lib/data/acumatica-standards.ts
//
// Single source of truth for mapping bag tag checkboxes to Acumatica terminology.
// Used by: TagCapture component, OCR route, bag_tags table, production forms.
//
// Confirmed from: Stock_Item.xlsx (IN-StockItem sheet, QCGrade + Variant columns)
// ══════════════════════════════════════════════════════════════════════════════

// ── Grade ─────────────────────────────────────────────────────────────────────
// The Grade checkbox on a bag tag (A / B / C) maps to the Acumatica QCGrade field.
// This determines which market/quality tier the product is destined for.

export type TagGrade         = 'A' | 'B' | 'C'
export type AcumaticaQCGrade = 'Export' | 'Export Blend' | 'Domestic'

export const GRADE_TO_ACUMATICA: Record<TagGrade, AcumaticaQCGrade> = {
  'A': 'Export',        // A-grade: Export (best quality, foreign markets)
  'B': 'Export Blend',  // B-grade: Export Blend (blended for export)
  'C': 'Domestic',      // C-grade: Domestic OR 3rd Party (local market / 3rd party)
}

export const ACUMATICA_TO_GRADE: Record<AcumaticaQCGrade, TagGrade> = {
  'Export':       'A',
  'Export Blend': 'B',
  'Domestic':     'C',
}

export const GRADE_LABELS: Record<TagGrade, string> = {
  'A': 'A — Export',
  'B': 'B — Export Blend',
  'C': 'C — Domestic / 3rd Party',
}

// ── Variant ───────────────────────────────────────────────────────────────────
// The variant checkboxes on a bag tag (CON / ORG / RA) map to the Acumatica
// Variant field AND determine the inventory ID suffix.
//
// The RA checkbox is a MODIFIER — it combines with CON or ORG:
//   CON ticked alone       → Conventional    → suffix -C
//   ORG ticked alone       → Organic         → suffix -O
//   CON + RA both ticked   → RA-Conventional → suffix -RC
//   ORG + RA both ticked   → RA-Organic      → suffix -RO
//
// Note: The old code stored 'C','O','RC','RO' (inventory suffixes) as the variant.
// The correct Acumatica Variant field values are the full strings below.

export type AcumaticaVariant =
  | 'Conventional'
  | 'Organic'
  | 'RA-Conventional'
  | 'RA-Organic'
  | 'FT-Conventional'   // Fair Trade — less common, included for completeness
  | 'FT-Organic'

// What appears in the dropdown / is stored in the database
export const VARIANT_OPTIONS: { value: AcumaticaVariant; label: string; suffix: string }[] = [
  { value: 'Conventional',    label: 'CON — Conventional',         suffix: '-C'  },
  { value: 'Organic',         label: 'ORG — Organic',              suffix: '-O'  },
  { value: 'RA-Conventional', label: 'RA CON — RA Conventional',   suffix: '-RC' },
  { value: 'RA-Organic',      label: 'RA ORG — RA Organic',        suffix: '-RO' },
  { value: 'FT-Conventional', label: 'FT CON — FT Conventional',   suffix: '-FC' },
  { value: 'FT-Organic',      label: 'FT ORG — FT Organic',        suffix: '-FO' },
]

// Maps inventory suffix → Acumatica Variant (for backward compat with old data)
export const SUFFIX_TO_VARIANT: Record<string, AcumaticaVariant> = {
  'C':  'Conventional',
  'O':  'Organic',
  'RC': 'RA-Conventional',
  'RO': 'RA-Organic',
  'FC': 'FT-Conventional',
  'FO': 'FT-Organic',
}

// Maps Acumatica Variant → inventory suffix
export const VARIANT_TO_SUFFIX: Record<AcumaticaVariant, string> = {
  'Conventional':    'C',
  'Organic':         'O',
  'RA-Conventional': 'RC',
  'RA-Organic':      'RO',
  'FT-Conventional': 'FC',
  'FT-Organic':      'FO',
}

// ── OCR checkbox parsing ──────────────────────────────────────────────────────
// When Gemini reads a tag, it reports which checkboxes are ticked.
// This function resolves the ticked boxes to the standard Acumatica Variant string.

export function resolveVariantFromCheckboxes(
  con: boolean,
  org: boolean,
  ra: boolean,
): AcumaticaVariant | null {
  if (con && ra)  return 'RA-Conventional'
  if (org && ra)  return 'RA-Organic'
  if (con)        return 'Conventional'
  if (org)        return 'Organic'
  return null
}

// Resolve grade checkbox tick to Acumatica QCGrade
export function resolveGradeFromCheckbox(
  a: boolean,
  b: boolean,
  c: boolean,
): AcumaticaQCGrade | null {
  if (a) return 'Export'
  if (b) return 'Export Blend'
  if (c) return 'Domestic'
  return null
}

// ── QR payload builder ────────────────────────────────────────────────────────
// Compact pipe-delimited string stored in bag_tags.qr_payload.
// Format: CNTP|{section_id}|{lot_number}|{serial_number}|{weight_kg}|{variant_suffix}|{qc_grade_code}|{tag_date}
// Example: CNTP|sieving|GS-0272|07-04-17|300|C|EX|2025-04-14
//
// Grade codes in QR (short): EX=Export, BL=Export Blend, DO=Domestic

export const QR_GRADE_CODE: Record<AcumaticaQCGrade, string> = {
  'Export':       'EX',
  'Export Blend': 'BL',
  'Domestic':     'DO',
}

export function buildQrPayload(params: {
  sectionId:    string
  lotNumber:    string
  serialNumber: string
  weightKg:     string | number
  variant:      AcumaticaVariant | null
  qcGrade:      AcumaticaQCGrade | null
  tagDate:      string
}): string {
  const variantSuffix = params.variant ? VARIANT_TO_SUFFIX[params.variant] : ''
  const gradeCode     = params.qcGrade ? QR_GRADE_CODE[params.qcGrade]    : ''
  return [
    'CNTP',
    params.sectionId,
    params.lotNumber,
    params.serialNumber,
    String(params.weightKg),
    variantSuffix,
    gradeCode,
    params.tagDate,
  ].join('|')
}

// ── Migration helper ──────────────────────────────────────────────────────────
// Converts old-style suffix strings ('C','O','RC','RO') stored in existing
// bag_tags rows to the proper Acumatica Variant string.
// Run as a one-time Supabase SQL update — see migration below.

export function migrateOldVariant(old: string | null): AcumaticaVariant | null {
  if (!old) return null
  return SUFFIX_TO_VARIANT[old.toUpperCase()] ?? null
}
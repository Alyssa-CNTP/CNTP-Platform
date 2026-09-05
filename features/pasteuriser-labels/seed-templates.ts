/**
 * The existing label set, transcribed from the BarTender templates in use.
 *
 * Source: Documents/Labels/*.btw — the thirteen files the print room works
 * from today. These are seeds for the in-app library, NOT approvals: every one
 * lands as `draft` and has to go round the proof-and-approve loop before it can
 * be printed, because what Control Union approved was a BarTender file, and the
 * whole point of the workflow is that approval attaches to the artefact that
 * actually prints.
 *
 * Transcribed verbatim, including wording that looks like a typo. "PROCES:
 * FBOC: W1120" appears exactly so on all thirteen; it is a facility registration
 * and it is not this module's place to correct it on labels a certifier has
 * already seen. If it is wrong, it should be fixed once, deliberately, as a new
 * version that goes back for approval.
 */

import type { LabelLine, LabelTemplate } from '@/lib/core/labels'

type SeedTemplate = Omit<LabelTemplate, 'id' | 'version' | 'status'>

let n = 0
const id = () => `l${++n}`

/** The manufacturer block, identical on every template in the set. */
function manufacturer(prefix = 'Manufacturer'): LabelLine[] {
  return [
    { kind: 'fixed', id: id(), text: `${prefix}: Cape Natural Tea Products` },
    { kind: 'fixed', id: id(), text: '27 Range Road, Blackheath, 7580', indent: true },
    { kind: 'fixed', id: id(), text: 'Cape Town, South Africa', indent: true },
  ]
}

const PROCES: LabelLine = { kind: 'fixed', id: id(), text: 'PROCES: FBOC: W1120' }
const ORIGIN: LabelLine = { kind: 'fixed', id: id(), text: 'Product of South Africa' }

const CU_ORGANIC = {
  mark: 'control_union' as const,
  registrationNo: 'ZA-BIO-149',
  operatorNo: '892408',
}

/** The four traceability lines every template carries, in their usual order. */
function traceLines(captions: { batch: string; serial: string } = { batch: 'Batch Number', serial: 'Serial Number' }): LabelLine[] {
  return [
    { kind: 'field', id: id(), caption: 'Grade',            field: 'grade' },
    { kind: 'field', id: id(), caption: captions.batch,     field: 'batch_no' },
    { kind: 'field', id: id(), caption: captions.serial,    field: 'serial_no', emphasis: true },
    { kind: 'field', id: id(), caption: 'Production Date',  field: 'production_date' },
  ]
}

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  // ── 5. Rooibos — Local ────────────────────────────────────────────────────
  {
    code: 'LOCAL',
    name: 'Rooibos — Local',
    market: 'local',
    organic: false,
    size: '100x50',
    markPosition: 'right',
    certifications: [],
    lines: [
      { kind: 'fixed', id: id(), text: 'Product: Rooibos' },
      ...traceLines(),
      { kind: 'field', id: id(), caption: 'Net Mass', field: 'net_mass' },
      ...manufacturer(),
      PROCES,
      ORIGIN,
    ],
  },

  // ── 6. Rooibos — Export ───────────────────────────────────────────────────
  {
    code: 'EXPORT',
    name: 'Rooibos — Export',
    market: 'export',
    organic: false,
    size: '100x50',
    markPosition: 'right',
    certifications: [],
    lines: [
      { kind: 'fixed', id: id(), text: 'Product: Rooibos' },
      { kind: 'field', id: id(), caption: 'Grade',            field: 'grade' },
      { kind: 'field', id: id(), caption: 'PO Number',        field: 'po_number' },
      { kind: 'field', id: id(), caption: 'Batch Number',     field: 'batch_no' },
      { kind: 'field', id: id(), caption: 'Serial Number',    field: 'serial_no', emphasis: true },
      { kind: 'field', id: id(), caption: 'Production Date',  field: 'production_date' },
      { kind: 'field', id: id(), caption: 'Best Before Date', field: 'best_before_date' },
      { kind: 'field', id: id(), caption: 'Net Mass',         field: 'net_mass' },
      { kind: 'field', id: id(), caption: 'Gross Mass',       field: 'gross_mass' },
      PROCES,
      ...manufacturer(),
      { kind: 'field', id: id(), caption: 'Importer', field: 'importer' },
      ORIGIN,
    ],
  },

  // ── 7. Retail Product Outer Carton ────────────────────────────────────────
  // The only template in the set with no serial: it labels a carton of retail
  // pouches, not a bulk bag. It therefore FAILS the traceability compliance
  // check by design, and is seeded so the gap is visible and decided on rather
  // than discovered at approval time.
  {
    code: 'RETAIL-CARTON',
    name: 'Retail Product Outer Carton',
    market: 'local',
    organic: false,
    size: '100x50',
    markPosition: 'right',
    certifications: [],
    proofNote:
      'Outer carton for retail pouches. Carries no serial number — confirm with Quality ' +
      'whether carton-level traceability is required before this is approved.',
    lines: [
      { kind: 'field', id: id(), caption: 'Product',      field: 'product' },
      { kind: 'field', id: id(), caption: 'Grade',        field: 'grade' },
      { kind: 'field', id: id(), caption: 'Batch Number', field: 'batch_no' },
      { kind: 'fixed', id: id(), text: 'Production/Best Before Date: (optional)' },
      { kind: 'fixed', id: id(), text: 'Net Mass: 100 x 50 g pouches' },
      // The carton template is the one place the legal entity is spelled out
      // in full ("PTY Ltd"), so it does not use the shared manufacturer block.
      { kind: 'fixed', id: id(), text: 'Manufacturer: Cape Natural Tea Products PTY Ltd' },
      { kind: 'fixed', id: id(), text: '27 Range Road, Blackheath, 7580,', indent: true },
      { kind: 'fixed', id: id(), text: 'Cape Town, South Africa', indent: true },
      ORIGIN,
    ],
  },

  // ── 9. EU Organic ─────────────────────────────────────────────────────────
  {
    code: 'EU-ORG',
    name: 'EU Organic Rooibos',
    market: 'eu',
    organic: true,
    size: '100x100',
    markPosition: 'right',
    certifications: [CU_ORGANIC],
    lines: [
      { kind: 'fixed', id: id(), text: 'Description: Organic Rooibos' },
      { kind: 'field', id: id(), caption: 'Grade',            field: 'grade' },
      { kind: 'field', id: id(), caption: 'Batch Number',     field: 'batch_no' },
      { kind: 'field', id: id(), caption: 'Serial Number',    field: 'serial_no', emphasis: true },
      { kind: 'field', id: id(), caption: 'Production Date',  field: 'production_date' },
      { kind: 'field', id: id(), caption: 'Best Before Date', field: 'best_before_date' },
      { kind: 'fixed', id: id(), text: 'Net Mass: 18 kg' },
      { kind: 'fixed', id: id(), text: 'Gross Mass: 18.3 kg' },
      { kind: 'fixed', id: id(), text: 'Certified Organic by Control Union ZA-BIO-149' },
      { kind: 'fixed', id: id(), text: '(CU 892408)', indent: true },
      ...manufacturer(),
      PROCES,
      ORIGIN,
    ],
  },

  // ── 10. NOP (USA) Organic ─────────────────────────────────────────────────
  {
    code: 'NOP-USA',
    name: 'NOP (USA) Organic Rooibos',
    market: 'usa',
    organic: true,
    size: '100x100',
    markPosition: 'right',
    certifications: [CU_ORGANIC],
    lines: [
      ...manufacturer(),
      { kind: 'fixed', id: id(), text: 'Description: 100% Organic Rooibos' },
      { kind: 'field', id: id(), caption: 'Grade',            field: 'grade' },
      { kind: 'field', id: id(), caption: 'PO Number',        field: 'po_number' },
      { kind: 'field', id: id(), caption: 'Item Number',      field: 'item_number' },
      { kind: 'field', id: id(), caption: 'Lot Number',       field: 'lot_number' },
      { kind: 'field', id: id(), caption: 'Serial Number',    field: 'serial_no', emphasis: true },
      { kind: 'field', id: id(), caption: 'Batch Number',     field: 'batch_no' },
      { kind: 'field', id: id(), caption: 'Production Date',  field: 'production_date' },
      { kind: 'field', id: id(), caption: 'Best Before Date', field: 'best_before_date' },
      { kind: 'fixed', id: id(), text: 'Net Mass: 18kg' },
      { kind: 'fixed', id: id(), text: 'Gross Mass: 18.3kg' },
      { kind: 'fixed', id: id(), text: 'Certified Organic by Control Union' },
      PROCES,
      ORIGIN,
    ],
  },

  // ── 11. NOP + EU Organic ──────────────────────────────────────────────────
  {
    code: 'NOP-EU-ORG',
    name: 'NOP / EU Organic Rooibos',
    market: 'usa',
    organic: true,
    size: '100x100',
    markPosition: 'right',
    certifications: [CU_ORGANIC],
    lines: [
      { kind: 'fixed', id: id(), text: 'Description: Organic Rooibos' },
      ...traceLines(),
      { kind: 'field', id: id(), caption: 'Best Before Date', field: 'best_before_date' },
      { kind: 'fixed', id: id(), text: 'Net Mass: 18 kg' },
      { kind: 'fixed', id: id(), text: 'Gross Mass: 18.3 kg' },
      { kind: 'fixed', id: id(), text: 'Certified Organic by Control Union ZA-BIO-149' },
      { kind: 'fixed', id: id(), text: '(CU 892408)', indent: true },
      ...manufacturer(),
      PROCES,
      ORIGIN,
    ],
  },

  // ── 8. JAS Organic (Japan) ────────────────────────────────────────────────
  // The JAS mark is the leaf inside two circles, set over "CONTROL UNION
  // CERTIFICATIONS / CU892408". Without it this consignment cannot be sold as
  // organic in Japan — compliance.ts refuses to issue a proof without it.
  {
    code: 'JAS',
    name: 'JAS Organic Rooibos (Japan)',
    market: 'japan',
    organic: true,
    size: '100x100',
    markPosition: 'bottom',
    certifications: [CU_ORGANIC, { mark: 'jas', operatorNo: '892408' }],
    lines: [
      { kind: 'fixed', id: id(), text: 'Description: Organic Rooibos' },
      ...traceLines(),
      { kind: 'field', id: id(), caption: 'Best Before Date', field: 'best_before_date' },
      { kind: 'field', id: id(), caption: 'Net Mass',         field: 'net_mass' },
      { kind: 'field', id: id(), caption: 'Gross Mass',       field: 'gross_mass' },
      { kind: 'fixed', id: id(), text: 'Storage Condition: Store in a cool, dry place.' },
      { kind: 'fixed', id: id(), text: 'Certified Organic by Control Union ZA-BIO-149' },
      ...manufacturer(),
      PROCES,
      ORIGIN,
    ],
  },

  // ── 12. Fairtrade Organic ─────────────────────────────────────────────────
  {
    code: 'FT-ORG',
    name: 'Fairtrade Organic Rooibos',
    market: 'export',
    organic: true,
    size: '100x100',
    markPosition: 'right',
    certifications: [CU_ORGANIC, { mark: 'fairtrade', floId: '5500' }, { mark: 'cape_natural' }],
    lines: [
      { kind: 'fixed', id: id(), text: 'Cape Natural Tea Products', emphasis: true },
      { kind: 'fixed', id: id(), text: '27 Range Road, Blackheath, 7580,' },
      { kind: 'fixed', id: id(), text: 'Cape Town, South Africa.' },
      PROCES,
      { kind: 'spacer', id: id() },
      { kind: 'fixed', id: id(), text: 'Product: Organic Rooibos' },
      { kind: 'field', id: id(), caption: 'Grade',            field: 'grade' },
      { kind: 'field', id: id(), caption: 'Batch No.',        field: 'batch_no' },
      { kind: 'field', id: id(), caption: 'Serial No.',       field: 'serial_no', emphasis: true },
      { kind: 'field', id: id(), caption: 'Production Date',  field: 'production_date' },
      { kind: 'field', id: id(), caption: 'Best Before Date', field: 'best_before_date' },
      { kind: 'fixed', id: id(), text: 'Net Mass: 18 kg' },
      { kind: 'fixed', id: id(), text: 'Gross Mass: 18.3 kg' },
      ORIGIN,
      { kind: 'fixed', id: id(), text: 'Certified Organic by Control Union' },
      { kind: 'fixed', id: id(), text: 'ZA-BIO-149 (CU892408)' },
      { kind: 'field', id: id(), caption: 'Importer', field: 'importer' },
    ],
  },

  // ── 13. EU / NOP / RA Organic ─────────────────────────────────────────────
  {
    code: 'EU-NOP-RA-ORG',
    name: 'EU / NOP / RA Organic Rooibos',
    market: 'eu',
    organic: true,
    size: '100x100',
    markPosition: 'right',
    certifications: [CU_ORGANIC, { mark: 'rainforest_alliance' }],
    lines: [
      { kind: 'fixed', id: id(), text: 'Description: Organic Rooibos' },
      ...traceLines(),
      { kind: 'field', id: id(), caption: 'Best Before Date', field: 'best_before_date' },
      { kind: 'fixed', id: id(), text: 'Net Mass: 18 kg' },
      { kind: 'fixed', id: id(), text: 'Gross Mass: 18.3 kg' },
      { kind: 'fixed', id: id(), text: 'Certified Organic by Control Union ZA-BIO-149' },
      { kind: 'fixed', id: id(), text: '(CU 892408)', indent: true },
      ...manufacturer(),
      PROCES,
      ORIGIN,
    ],
  },

  // ── 1. Kunitaro RA Approved ───────────────────────────────────────────────
  // Customer-specific. Carries the customer's own PO reference on the label,
  // which is why po_number is bound here and not on the generic export template.
  {
    code: 'KUNITARO-RA',
    name: 'Kunitaro RA Approved',
    market: 'japan',
    organic: false,
    size: '100x50',
    markPosition: 'right',
    certifications: [{ mark: 'rainforest_alliance' }],
    lines: [
      { kind: 'fixed', id: id(), text: 'Product: Rooibos' },
      { kind: 'field', id: id(), caption: 'Grade',              field: 'grade' },
      { kind: 'field', id: id(), caption: 'Customer PO Number', field: 'po_number' },
      { kind: 'field', id: id(), caption: 'Serial No',          field: 'serial_no', emphasis: true },
      { kind: 'field', id: id(), caption: 'Batch No',           field: 'batch_no' },
      { kind: 'field', id: id(), caption: 'Net mass',           field: 'net_mass' },
      { kind: 'field', id: id(), caption: 'Production Date',    field: 'production_date' },
      { kind: 'field', id: id(), caption: 'Best Before',        field: 'best_before_date' },
      { kind: 'fixed', id: id(), text: 'Storage Condition: Ambient' },
      ...manufacturer(),
      PROCES,
      ORIGIN,
    ],
  },
]

/** Seeds keyed by code, for the "add from library" picker in the editor. */
export const SEED_BY_CODE: Readonly<Record<string, SeedTemplate>> =
  Object.fromEntries(SEED_TEMPLATES.map(t => [t.code, t]))

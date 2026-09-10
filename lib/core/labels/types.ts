/**
 * Finished-product label templates — the data model.
 *
 * A label has three lifetimes and they must not be confused:
 *
 *   1. TEMPLATE   authored once, approved by Control Union and the customer,
 *                 then frozen. Carries fixed wording, certification marks, and
 *                 PLACEHOLDERS for the variable data. Has a version.
 *   2. BINDING    the variable data, known only once a production manager has
 *                 assigned a job card — batch number, production date, grade.
 *   3. INSTANCE   one printed bag's label: template + binding + serial number.
 *
 * The approval is against the TEMPLATE. That is the whole point of the
 * workflow: Control Union approves wording and marks, not a day's batch number.
 * So a template is immutable once approved — an edit mints a new version that
 * has to be approved again (see `LabelTemplateStatus`).
 *
 * This module is PURE (ARCHITECTURE.md §2): no React, no I/O, no HTML. It
 * describes what a label *says*. Turning that into HTML for the browser, PPLB
 * for the Argox, or a PDF proof for the approval pack is a rendering concern
 * and lives in features/pasteuriser-labels.
 *
 * Modelled directly on the thirteen BarTender templates currently in use
 * (EU Organic, NOP USA, NOP EU, JAS, Fairtrade, EU/NOP/RA, Kunitaro RA, Local,
 * Export, Retail Outer Carton, and the per-customer variants). Every one of
 * them is an ordered list of lines — some fixed wording, some `Caption: value`
 * — plus a block of certification marks. Nothing in the set needs free x/y
 * placement, so the model deliberately does not offer it: a structured line
 * list renders identically to the thermal printer and to PDF, and a free canvas
 * does not.
 */

/**
 * A variable field — the data that is NOT known at approval time and only
 * arrives when a job card is assigned and a bag is bagged.
 *
 * This union is the vocabulary the template editor offers. It is closed on
 * purpose: a template that could bind an arbitrary string would be a template
 * whose placeholders nothing guarantees can be filled, and the operator would
 * find out at the printer. Adding a field here forces every resolver to handle
 * it (see `LABEL_FIELD_SOURCE` and its drift test).
 */
export type LabelFieldKey =
  | 'product'             // "Rooibos" / "Organic Rooibos"
  | 'grade'               // "Choice Grade", "RA Conventional Super Fine Cut - SG"
  | 'batch_no'            // "26166-CON-CH"
  | 'serial_no'           // "20-08-01"          — per bag
  | 'po_number'           // customer PO, e.g. "KTR 4417"
  | 'item_number'         // Acumatica inventory item
  | 'lot_number'
  | 'production_date'
  | 'best_before_date'
  | 'net_mass'            // "18 kg"
  | 'gross_mass'          // "18.3 kg"
  | 'customer'
  | 'importer'
  | 'job_card_no'
  | 'pallet_no'

/**
 * Where each field's value comes from, and therefore WHEN it can be known.
 *
 * This is what makes the workflow enforceable rather than merely documented.
 * A template can be approved with `job_card` and `bag` fields unresolved —
 * that is expected, they are placeholders. It can NOT be printed with them
 * unresolved. `resolveLabel()` reports exactly which are missing.
 *
 *   'template' — authored on the template itself (product, net mass on a
 *                fixed-weight line). Known at approval time.
 *   'order'    — bound when sales assigns the PO (po_number, customer, importer).
 *   'job_card' — bound when the production manager assigns the job card
 *                (batch_no, production_date, grade, item_number, lot_number).
 *   'bag'      — bound per printed bag (serial_no, pallet_no, gross_mass).
 */
export type LabelFieldSource = 'template' | 'order' | 'job_card' | 'bag'

export const LABEL_FIELD_SOURCE: Readonly<Record<LabelFieldKey, LabelFieldSource>> = {
  product:          'template',
  net_mass:         'template',
  customer:         'order',
  importer:         'order',
  po_number:        'order',
  item_number:      'job_card',
  batch_no:         'job_card',
  grade:            'job_card',
  lot_number:       'job_card',
  job_card_no:      'job_card',
  production_date:  'job_card',
  best_before_date: 'job_card',
  serial_no:        'bag',
  pallet_no:        'bag',
  gross_mass:       'bag',
}

/** Floor-facing name for each field, as it appears in the template editor. */
export const LABEL_FIELD_LABEL: Readonly<Record<LabelFieldKey, string>> = {
  product:          'Product',
  grade:            'Grade',
  batch_no:         'Batch Number',
  serial_no:        'Serial Number',
  po_number:        'PO Number',
  item_number:      'Item Number',
  lot_number:       'Lot Number',
  production_date:  'Production Date',
  best_before_date: 'Best Before Date',
  net_mass:         'Net Mass',
  gross_mass:       'Gross Mass',
  customer:         'Customer',
  importer:         'Importer',
  job_card_no:      'Job Card No.',
  pallet_no:        'Pallet No.',
}

export const LABEL_FIELD_KEYS = Object.keys(LABEL_FIELD_SOURCE) as LabelFieldKey[]

/**
 * One line of the label.
 *
 * Tagged, never duck-typed — the same rule as the section union (ARCHITECTURE
 * §4). Every consumer dispatches on `kind` and ends in `assertNever`, so adding
 * a line kind without handling it everywhere fails the build.
 *
 *   fixed   — wording approved verbatim. "Product of South Africa",
 *             "Certified Organic by Control Union ZA-BIO-149 (CU 892408)".
 *   field   — `caption: {{value}}`. The caption is part of the approved wording
 *             (customers do ask for "Batch No.:" rather than "Batch Number:"),
 *             so it is authored, not derived from LABEL_FIELD_LABEL.
 *   spacer  — deliberate vertical gap (the Fairtrade template has one under the
 *             manufacturer block). Not decoration: removing it changes an
 *             approved layout.
 *
 * `indent` renders the line hanging under the one above it — how every template
 * lays out the manufacturer's address ("27 Range Road, Blackheath, 7580").
 */
export type LabelLine =
  | { kind: 'fixed';  id: string; text: string; indent?: boolean; emphasis?: boolean }
  | { kind: 'field';  id: string; caption: string; field: LabelFieldKey; indent?: boolean; emphasis?: boolean }
  | { kind: 'spacer'; id: string }

/**
 * The certification marks a label may carry.
 *
 * `jas` is the Japanese organic mark — the leaf inside two circles, printed
 * over "CONTROL UNION CERTIFICATIONS / CU<number>". Product destined for Japan
 * is not compliant without it, which is why market and marks are checked
 * together in compliance.ts rather than left to the author to remember.
 */
export type LabelMarkKey =
  | 'cape_natural'
  | 'control_union'
  | 'rainforest_alliance'
  | 'fairtrade'
  | 'jas'
  | 'eu_organic'
  | 'usda_organic'

/**
 * A certification the label asserts, with its registration numbers.
 *
 * Numbers are held as data rather than baked into a fixed line so compliance
 * can actually check them. A template that says "Certified Organic by Control
 * Union" in prose with no `operatorNo` is the failure this catches: it looks
 * right to a reader and carries no CU number.
 */
export interface LabelCertification {
  mark: LabelMarkKey
  /** Control Union's organic registration, e.g. 'ZA-BIO-149'. */
  registrationNo?: string
  /** The operator/client number, e.g. '892408' — printed as "CU 892408". */
  operatorNo?: string
  /** Fairtrade licence, e.g. '5500' — printed as "FLO ID 5500". */
  floId?: string
}

/** Where the certification marks sit relative to the text block. */
export type LabelMarkPosition = 'right' | 'bottom' | 'header'

/**
 * The destination market. Drives compliance, not layout.
 *
 * Closed union ending in assertNever at every dispatch, so adding a market
 * without deciding its rules fails the build rather than silently inheriting
 * 'export'.
 */
export type LabelMarket =
  | 'local'     // South Africa
  | 'export'    // generic export, no scheme-specific marks required
  | 'eu'
  | 'usa'       // NOP
  | 'japan'     // JAS
  | 'uk'

/** Physical label stock. Presets match the dies already in the print room. */
export interface LabelSize { widthMm: number; heightMm: number }

export const LABEL_SIZES = {
  /** The bag-label die already in use on the Argox CP-2140EX. */
  '100x50':  { widthMm: 100, heightMm: 50 },
  /** The square stock the organic/certification templates are set on. */
  '100x100': { widthMm: 100, heightMm: 100 },
  'A6':      { widthMm: 148, heightMm: 105 },
} as const satisfies Record<string, LabelSize>

export type LabelSizeKey = keyof typeof LABEL_SIZES

/**
 * A template's position in the approval workflow.
 *
 *   draft            — being authored. Editable. Cannot be assigned or printed.
 *   pending_approval — proof issued to Control Union / the customer. Frozen.
 *   approved         — signed off by sales on the strength of that reply.
 *                      The ONLY state that may be assigned to a PO or printed.
 *   rejected         — came back with changes. Frozen; author supersedes it.
 *   superseded       — a later version was approved. Kept, never deleted:
 *                      bags already in the warehouse were printed from it.
 *
 * There is no path from `approved` back to `draft`. Editing an approved
 * template mints a new version at `draft` and leaves the approved one standing
 * until the new one is approved — otherwise an edit would silently invalidate
 * the approval the customer actually gave.
 */
export type LabelTemplateStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'superseded'

/**
 * The approved artefact.
 *
 * `version` increments per `code`; `code` is the stable family identifier
 * ('EU-ORG', 'JAS', 'KUNITARO-RA') that a PO is assigned against. Sales assigns
 * a PO to a *template version*, not to a family, so it is unambiguous which
 * wording that order's bags were printed from.
 */
export interface LabelTemplate {
  id: string
  /** Stable family code, e.g. 'EU-ORG'. Shared across versions. */
  code: string
  /** Human name, e.g. 'EU Organic Rooibos'. */
  name: string
  version: number
  status: LabelTemplateStatus
  market: LabelMarket
  organic: boolean
  size: LabelSizeKey
  lines: readonly LabelLine[]
  certifications: readonly LabelCertification[]
  markPosition: LabelMarkPosition
  /** Free note to Control Union / the customer, on the proof but not the label. */
  proofNote?: string
}

/** Values for the variable fields. Absent means not yet known. */
export type LabelBinding = Partial<Record<LabelFieldKey, string>>

/** One line of a label with its placeholders filled in. */
export type ResolvedLine =
  | { kind: 'fixed';  text: string; indent: boolean; emphasis: boolean }
  | { kind: 'field';  caption: string; value: string; field: LabelFieldKey; indent: boolean; emphasis: boolean }
  | { kind: 'spacer' }

/**
 * A template plus a binding, ready to render.
 *
 * `missing` is the point of this type. A label with an unresolved placeholder
 * must never reach a printer — an empty "Batch Number:" on a bag in a container
 * bound for the EU is a traceability failure, and it is invisible on a thermal
 * print until someone in Rotterdam looks at it.
 */
export interface ResolvedLabel {
  template: LabelTemplate
  lines: readonly ResolvedLine[]
  certifications: readonly LabelCertification[]
  markPosition: LabelMarkPosition
  size: LabelSize
  /** Fields the template binds that the binding did not supply. */
  missing: readonly LabelFieldKey[]
}

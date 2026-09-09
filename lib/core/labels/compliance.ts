/**
 * What a label must carry to be legal in its market.
 *
 * These are the rules that today live in someone's head and in the fact that
 * the BarTender file for Japan happens to have the JAS mark already placed on
 * it. Once templates are authored in-app the rules have to be enforced by the
 * app, because the failure mode is silent: a template missing its CU number
 * looks completely normal, prints completely normally, and is only caught by
 * the certifier or the port.
 *
 * Enforced at the point of REQUESTING APPROVAL, not at print. A draft is
 * allowed to be incomplete — that is what a draft is. But a proof must not go
 * out to Control Union with a missing mark, because their approval of it would
 * then be an approval of a non-compliant label.
 *
 * PURE (ARCHITECTURE.md §2). Every rule below is a statement about the template
 * alone; none of them need the database.
 */

import { assertNever } from '../types/capture'
import {
  type LabelCertification,
  type LabelMarkKey,
  type LabelMarket,
  type LabelTemplate,
} from './types'
import { boundFields } from './resolve'

export type ComplianceSeverity = 'error' | 'warning'

export interface ComplianceIssue {
  severity: ComplianceSeverity
  /** Stable id so the editor can point at the offending control. */
  code: string
  message: string
}

/**
 * Traceability fields every finished-product label must bind, in every market.
 *
 * Batch and serial are the two that make a bag findable from a customer
 * complaint back to a shift. A label without them is not a label CNTP can
 * defend under FSSC 22000, regardless of where it is going.
 */
const REQUIRED_EVERYWHERE = ['batch_no', 'serial_no', 'production_date'] as const

function hasMark(template: LabelTemplate, mark: LabelMarkKey): boolean {
  return template.certifications.some(c => c.mark === mark)
}

function certFor(template: LabelTemplate, mark: LabelMarkKey): LabelCertification | undefined {
  return template.certifications.find(c => c.mark === mark)
}

/**
 * Marks required by the destination market, given whether the product is organic.
 *
 * Ends in `assertNever`, so adding a market to `LabelMarket` without deciding
 * its certification rules fails the build rather than quietly inheriting the
 * laxest set. That is the same guarantee SECTION_KIND gives the capture screens
 * (ARCHITECTURE.md §4).
 */
export function requiredMarks(market: LabelMarket, organic: boolean): LabelMarkKey[] {
  switch (market) {
    case 'local':
      return []
    case 'export':
      // Generic export carries no scheme mark of its own; organic still must
      // show who certified it.
      return organic ? ['control_union'] : []
    case 'eu':
      return organic ? ['control_union'] : []
    case 'usa':
      // NOP. Control Union is the certifier of record on CNTP's NOP labels.
      return organic ? ['control_union'] : []
    case 'uk':
      return organic ? ['control_union'] : []
    case 'japan':
      // JAS: the leaf-in-two-circles mark is mandatory on organic product sold
      // as organic in Japan, printed over the certifier's name and CU number.
      // Without it the consignment cannot be sold as organic there.
      return organic ? ['control_union', 'jas'] : []
    default:
      return assertNever(market, 'LabelMarket')
  }
}

/** Floor-facing name of a mark, for error messages and the editor. */
export const MARK_LABEL: Readonly<Record<LabelMarkKey, string>> = {
  cape_natural:        'Cape Natural Tea Products',
  control_union:       'Control Union',
  rainforest_alliance: 'Rainforest Alliance',
  fairtrade:           'Fairtrade (FLO)',
  jas:                 'JAS (Japan organic)',
  eu_organic:          'EU Organic leaf',
  usda_organic:        'USDA Organic',
}

/**
 * Every compliance problem with a template.
 *
 * Errors block a proof going out for approval. Warnings do not — they are
 * things a human may legitimately have decided (a template with no net mass
 * because the line is hand-written on the bag, say).
 */
export function checkCompliance(template: LabelTemplate): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  const bound = boundFields(template)

  // ── Traceability ──────────────────────────────────────────────────────────
  for (const field of REQUIRED_EVERYWHERE) {
    if (!bound.includes(field)) {
      issues.push({
        severity: 'error',
        code: `missing_field.${field}`,
        message:
          `The label must show ${field.replace(/_/g, ' ')}. Every finished-product label ` +
          `has to be traceable from the bag back to the shift that made it.`,
      })
    }
  }

  // ── Market-mandated certification marks ───────────────────────────────────
  for (const mark of requiredMarks(template.market, template.organic)) {
    if (!hasMark(template, mark)) {
      issues.push({
        severity: 'error',
        code: `missing_mark.${mark}`,
        message:
          `${MARK_LABEL[mark]} is required for ${template.market.toUpperCase()}` +
          `${template.organic ? ' organic' : ''} product and is not on this label.`,
      })
    }
  }

  // ── Organic: the CU number, not just the words ────────────────────────────
  // A template can say "Certified Organic by Control Union" in prose and carry
  // no number at all. It reads as correct and is not. The registration and
  // operator numbers are held as data precisely so this can be checked.
  if (template.organic) {
    const cu = certFor(template, 'control_union')
    if (cu && !cu.operatorNo) {
      issues.push({
        severity: 'error',
        code: 'control_union.operator_no',
        message:
          'Organic labels must carry the Control Union operator number (printed as "CU 892408"). ' +
          'Add it to the Control Union certification.',
      })
    }
    if (cu && !cu.registrationNo) {
      issues.push({
        severity: 'error',
        code: 'control_union.registration_no',
        message:
          'Organic labels must carry the Control Union organic registration (e.g. ZA-BIO-149).',
      })
    }
  }

  // ── Fairtrade: the FLO ID is the licence, and is printed beside the mark ──
  const ft = certFor(template, 'fairtrade')
  if (ft && !ft.floId) {
    issues.push({
      severity: 'error',
      code: 'fairtrade.flo_id',
      message: 'A Fairtrade mark must be accompanied by the FLO ID (e.g. FLO ID 5500).',
    })
  }

  // ── A mark asserted on non-organic product ────────────────────────────────
  // Not an error: RA and Fairtrade are legitimately carried by conventional
  // product. JAS is not — it is an organic mark.
  if (hasMark(template, 'jas') && !template.organic) {
    issues.push({
      severity: 'error',
      code: 'jas.not_organic',
      message: 'The JAS mark may only appear on organic product.',
    })
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (!bound.includes('net_mass') && !template.lines.some(l => l.kind === 'fixed' && /net\s*mass/i.test(l.text))) {
    issues.push({
      severity: 'warning',
      code: 'no_net_mass',
      message: 'This label shows no net mass, neither as a fixed line nor a bound field.',
    })
  }
  if (template.lines.length === 0) {
    issues.push({ severity: 'error', code: 'empty', message: 'The label has no lines.' })
  }

  return issues
}

/** True when nothing blocks this template going out for approval. */
export function canRequestApproval(template: LabelTemplate): boolean {
  return !checkCompliance(template).some(i => i.severity === 'error')
}

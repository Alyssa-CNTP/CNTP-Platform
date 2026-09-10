/**
 * Filling a label template's placeholders — pure, and the only place it happens.
 *
 * Every path that shows a label goes through `resolveLabel()`: the template
 * editor's live preview, the PDF proof sent to Control Union, the operator's
 * on-screen preview, and the PPLB stream to the Argox. That is deliberate. When
 * the preview and the printer resolve placeholders separately they disagree,
 * and the disagreement is only visible once the label is on a bag — the same
 * class of failure as the capture screen and the persisted mass-balance row
 * computing different totals (ARCHITECTURE.md §5).
 *
 * PURE: no I/O, no HTML. Rendering lives in features/pasteuriser-labels.
 */

import { assertNever } from '../types/capture'
import {
  LABEL_FIELD_SOURCE,
  LABEL_SIZES,
  type LabelBinding,
  type LabelFieldKey,
  type LabelTemplate,
  type ResolvedLabel,
  type ResolvedLine,
} from './types'

/** Placeholder shown wherever a value is not yet known. Never printed — a label
 *  with any `missing` field is refused at the print boundary. */
const UNRESOLVED = '—'

/**
 * Every field this template actually binds, in first-appearance order.
 *
 * Order matters for the editor's "what still needs filling" list: an operator
 * reads it against the label in front of them, so it must run top to bottom.
 */
export function boundFields(template: LabelTemplate): LabelFieldKey[] {
  const seen = new Set<LabelFieldKey>()
  const out: LabelFieldKey[] = []
  for (const line of template.lines) {
    if (line.kind === 'field' && !seen.has(line.field)) {
      seen.add(line.field)
      out.push(line.field)
    }
  }
  return out
}

/**
 * Fields this template binds whose value cannot be known until the given stage.
 *
 * Used to answer "is this template ready to approve?" (only `template`- and
 * `order`-sourced fields need values on a proof) versus "is this label ready to
 * print?" (everything does).
 */
export function pendingFields(
  template: LabelTemplate,
  binding: LabelBinding,
): LabelFieldKey[] {
  return boundFields(template).filter(f => !isFilled(binding[f]))
}

function isFilled(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Template + binding → the label as it will read.
 *
 * Does NOT throw on a missing value: the editor and the proof both legitimately
 * render a template with placeholders unfilled. It reports them in `missing`
 * instead, and the print boundary (`assertPrintable`) is what refuses.
 */
export function resolveLabel(
  template: LabelTemplate,
  binding: LabelBinding = {},
): ResolvedLabel {
  const missing: LabelFieldKey[] = []

  const lines: ResolvedLine[] = template.lines.map((line): ResolvedLine => {
    switch (line.kind) {
      case 'fixed':
        return {
          kind: 'fixed',
          text: line.text,
          indent: !!line.indent,
          emphasis: !!line.emphasis,
        }
      case 'field': {
        const raw = binding[line.field]
        if (!isFilled(raw)) {
          if (!missing.includes(line.field)) missing.push(line.field)
        }
        return {
          kind: 'field',
          caption: line.caption,
          value: isFilled(raw) ? (raw as string).trim() : UNRESOLVED,
          field: line.field,
          indent: !!line.indent,
          emphasis: !!line.emphasis,
        }
      }
      case 'spacer':
        return { kind: 'spacer' }
      default:
        return assertNever(line, 'LabelLine')
    }
  })

  return {
    template,
    lines,
    certifications: template.certifications,
    markPosition: template.markPosition,
    size: LABEL_SIZES[template.size],
    missing,
  }
}

/** Why a resolved label may not be printed. Empty array means it may. */
export function printBlockers(resolved: ResolvedLabel): string[] {
  const out: string[] = []
  if (resolved.template.status !== 'approved') {
    out.push(
      `Template ${resolved.template.code} v${resolved.template.version} is ${resolved.template.status}, not approved. ` +
      `Only an approved template may be printed.`,
    )
  }
  for (const f of resolved.missing) {
    out.push(`${f} has no value (supplied by: ${LABEL_FIELD_SOURCE[f]}).`)
  }
  return out
}

/**
 * The print boundary. Throws rather than returning a flag, because every caller
 * of this is about to put ink on a bag and there is no sensible partial result.
 *
 * Checked here in core so the browser preview, the direct PPLB path and the API
 * route cannot each apply their own version of the rule — which is how one path
 * ends up laxer than the others.
 */
export function assertPrintable(resolved: ResolvedLabel): void {
  const blockers = printBlockers(resolved)
  if (blockers.length > 0) {
    throw new Error(`Label is not printable:\n  - ${blockers.join('\n  - ')}`)
  }
}

/**
 * Pasteuriser finished-product labels.
 *
 * THE ONLY public surface of this feature (ARCHITECTURE.md §3.1). Nothing
 * outside `features/pasteuriser-labels/` may reach past this file — importing
 * a component or a renderer by its path is how a feature stops being
 * self-contained.
 *
 * The label MODEL, placeholder resolution and compliance rules are core
 * (`lib/core/labels`), not here. This feature is the parts that touch React,
 * the database and the printer: rendering, the editor, and the workflow UI.
 */

export { MARK_ART, MARK_KEYS, type MarkArt } from './marks'

export {
  buildLabelBody,
  buildLabelDocument,
  openAndPrintLabel,
  type RenderMode,
  type RenderOptions,
} from './render-html'

export {
  buildLabelPplb,
  pplbFidelity,
  pplbTextLines,
  type PplbFidelity,
} from './render-pplb'

export { SEED_TEMPLATES, SEED_BY_CODE } from './seed-templates'

export {
  publicDb,
  errMessage,
  fetchTemplates,
  fetchTemplate,
  fetchTemplateEvents,
  fetchAssignments,
  fetchPrints,
  liveSerials,
  saveDraft,
  toTemplate,
  type LabelTemplateRow,
  type LabelPoAssignmentRow,
  type LabelPrintRow,
  type TemplateEventRow,
} from './db'

export { LabelPreview } from './components/LabelPreview'
export { TemplateEditor } from './components/TemplateEditor'

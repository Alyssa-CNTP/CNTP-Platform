// lib/core/takein/grading.ts
//
// The raw-material take-in grading rules. Pure — no React, no I/O, no Supabase
// — so the screens, the documents and the settlement all read one answer
// (ARCHITECTURE.md §2). Everything here was decoded from the Acumatica
// customisation (AS2FamerTakeIn.dll) or proved against signed documents; the
// provenance is on each rule because it is what makes them arguable.

// ════════════════════════════════════════════════════════════════════════════
// MONEY & ROUNDING
// ════════════════════════════════════════════════════════════════════════════
/**
 * Half away from zero — NOT Math.round (wrong for negatives) and NOT banker's
 * rounding (the .NET / Python default).
 *
 * Proved against ten signed Afleweringsbewyse, both depots, March–May 2026:
 *
 *   half-up, rounding each row then summing    10 / 10
 *   float + Math.round                          7 / 10
 *   half-up, rounding the exact sum once        4 / 10
 *   banker's, rounding each row then summing    3 / 10
 *
 * The `toFixed(9)` kills binary drift before the cut. Without it 0.18 × 7.25 is
 * 1.30499999999999994 rather than exactly 1.305, and MAT-0295 prints 1.31 where
 * the float lands on 1.30 — a cent light on the total.
 */
export function roundHalfUp(value: number, dp = 0): number {
  const f = 10 ** dp
  const x = Number((value * f).toFixed(9))
  return (x < 0 ? -Math.round(-x) : Math.round(x)) / f
}

// ════════════════════════════════════════════════════════════════════════════
// LEAF SHADE
// ════════════════════════════════════════════════════════════════════════════
/**
 * MapLeafScore, read off the IL of the Acumatica assembly.
 *
 * A bell curve peaking at shades 7–8: a mid-brown leaf is what the buyer wants,
 * and both a pale and a very dark one score lower. Scores run 1–5.
 *
 * SHADE 1 RETURNS null, NOT 0. The method initialises its result to
 * `default(decimal?)` and the `arg == 1` branch leaves it there. A zero would
 * quietly fail every threshold and still look like a graded result; null has to
 * be handled, and it sends the batch to the panel instead.
 *
 * Every shade appearing in the ten signed notes matches: 4→3, 5→4, 6→4, 7→5, 8→5.
 */
export const LEAF_SHADE_SCORE: Record<number, number | null> = {
  1: null, 2: 1, 3: 2, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5, 9: 4, 10: 3, 11: 2,
}

export function shadeScore(shade: number | null | undefined): number | null {
  if (shade == null) return null
  const v = LEAF_SHADE_SCORE[Math.round(shade)]
  return v == null ? null : v
}

// ════════════════════════════════════════════════════════════════════════════
// THE SIEVING TABLE
// ════════════════════════════════════════════════════════════════════════════
export interface SieveRow {
  key: string; label: string; grams: number; pct: number; factor: number; contrib: number
}

export interface SieveTable {
  rows:      SieveRow[]
  totalGrams: number
  pctTotal:  number
  /** The figure the documents print. Sum of the ROUNDED rows — see roundHalfUp. */
  contribTotal: number
  /** What rounding the exact sum once would have given. Shown only to explain a gap. */
  contribOnce:  number
  complete:  boolean          // 400 g sample, ±1 g
}

const FRACTIONS = [
  { key: '>10', label: 'Sieving > 10', factor: 0.18 },
  { key: '>12', label: 'Sieving > 12', factor: 0.22 },
  { key: '>18', label: 'Sieving > 18', factor: 0.90 },
  { key: '>20', label: 'Sieving > 20', factor: 1.00 },
  { key: '>40', label: 'Sieving > 40', factor: 1.00 },
  { key: '<40', label: 'Dust < 40',    factor: 0.25 },
]

export function sieveTable(grams: Record<string, number> | null | undefined): SieveTable {
  const g = grams ?? {}
  const totalGrams = FRACTIONS.reduce((a, f) => a + (Number(g[f.key]) || 0), 0)
  const denom = totalGrams || 1
  const rows: SieveRow[] = FRACTIONS.map(f => {
    const grams = Number(g[f.key]) || 0
    const pct = (grams / denom) * 100
    return { key: f.key, label: f.label, grams, pct, factor: f.factor,
             contrib: roundHalfUp(pct * f.factor, 2) }
  })
  const exact = rows.reduce((a, r) => a + r.pct * r.factor, 0)
  return {
    rows, totalGrams,
    pctTotal:     rows.reduce((a, r) => a + r.pct, 0),
    contribTotal: roundHalfUp(rows.reduce((a, r) => a + r.contrib, 0), 2),
    contribOnce:  roundHalfUp(exact, 2),
    complete:     totalGrams >= 399 && totalGrams <= 401,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WEIGHTS
// ════════════════════════════════════════════════════════════════════════════
/**
 * The truck is weighed LOADED on arrival and again after offloading, so the
 * begin reading is always the higher of the two. A pair the other way round is
 * a typing error, not a negative delivery.
 */
export function grossKg(beginKg: number | null, endKg: number | null): number {
  return Math.max(0, (beginKg ?? 0) - (endKg ?? 0))
}
export function weighbridgeReversed(beginKg: number | null, endKg: number | null): boolean {
  return !!beginKg && !!endKg && beginKg <= endKg
}
export const BAG_TARE_KG = 2
export function nettKg(beginKg: number | null, endKg: number | null, bags: number): number {
  return Math.max(0, grossKg(beginKg, endKg) - bags * BAG_TARE_KG)
}

// ════════════════════════════════════════════════════════════════════════════
// LAB AGREEMENT
// ════════════════════════════════════════════════════════════════════════════
export interface LabReading {
  shade: number | null; aroma: number | null; colour: number | null; taste: number | null
}
export interface LabComparison {
  diffs:     { key: string; label: string; depot: number; internal: number; delta: number }[]
  worst:     number
  identical: boolean
  within:    boolean
}

const SCORE_KEYS: [keyof LabReading, string][] = [
  ['shade', 'Leaf Shade'], ['aroma', 'Cup Aroma'],
  ['colour', 'Cup Colour'], ['taste', 'Cup Taste'],
]

/**
 * Whether Blackheath's reading AGREES with the depot's is a COMPARISON, never
 * an assumption. A screen that prints "agrees with the mini lab" next to two
 * different numbers is worse than no check at all.
 *
 * A reading inside the tolerance is a recorded variance and the batch carries
 * on with Blackheath's figures; outside it the two labs genuinely disagree and
 * the panel decides.
 */
export function compareLabs(mini: LabReading, internal: LabReading, tolerance = 1): LabComparison {
  const diffs = SCORE_KEYS
    .map(([k, label]) => ({
      key: String(k), label,
      depot: Number(mini[k] ?? 0), internal: Number(internal[k] ?? 0),
      delta: Math.abs(Number(internal[k] ?? 0) - Number(mini[k] ?? 0)),
    }))
    .filter(d => d.delta > 0)
  const worst = diffs.reduce((a, d) => Math.max(a, d.delta), 0)
  return { diffs, worst, identical: diffs.length === 0, within: worst <= tolerance }
}

export function describeDiffs(c: LabComparison): string {
  return c.diffs.map(d => `${d.label} ${d.depot.toFixed(2)} → ${d.internal.toFixed(2)}`).join(', ')
}

// ════════════════════════════════════════════════════════════════════════════
// THE PANEL
// ════════════════════════════════════════════════════════════════════════════
export type TriggerWhen = 'mini' | 'internal' | 'external'
export type TriggerKind = 'sensorial' | 'verification' | 'residue'

export interface PanelTrigger {
  term:    string          // matches takein.contract_panel_terms.term_key
  when:    TriggerWhen     // the EARLIEST point it can be known
  kind:    TriggerKind
  why:     string
  binding: boolean         // does the CONTRACT make this a Verpligte Paneel Besluit?
  clause:  string | null
}

export interface GradeThresholds {
  exportGrade: { leaf: number; colour: number; taste: number; aroma: number; density: number }
  blendGrade:  { leaf: number; colour: number; taste: number; aroma: number; density: number }
  maxDensity:  number
  minScore:    number
  tolerance:   number
}

export const DEFAULT_THRESHOLDS: GradeThresholds = {
  exportGrade: { leaf: 4, colour: 3, taste: 3, aroma: 3, density: 360 },
  blendGrade:  { leaf: 3, colour: 2, taste: 2, aroma: 2, density: 370 },
  maxDensity: 400, minScore: 1, tolerance: 1,
}

export interface GradingInput {
  mini:      LabResultLike | null
  internal:  LabResultLike | null
  external:  ExternalLike  | null
  organic:   boolean
  binding:   Partial<Record<string, boolean>>   // contract panel terms
  clauses?:  Partial<Record<string, string>>
  returned?: boolean
  panel?:    { outcome: 'accept' | 'downgrade' | 'reject'; grade: string | null
               reason: string; covered: string[] } | null
  thresholds?: GradeThresholds
}

export interface LabResultLike {
  sieve_json: Record<string, number> | null
  moisture: number | null; density: number | null
  shade: number | null; aroma: number | null; colour: number | null; taste: number | null
  agrees?: boolean | null; variance_note?: string | null; dispute_note?: string | null
}
export interface ExternalLike {
  residue_group: string | null; pa_group: string | null; residue_name?: string | null
}

/**
 * Everything that can send a batch to the panel, with the EARLIEST point each
 * can be known. One list, because three screens ask the same question at three
 * different moments and they must not answer it differently.
 *
 * Sensorial triggers mirror Acumatica's RequiresSensorialReview (density ≥ 400
 * OR any score ≤ 1), which does not wait on residue — so the mini lab can tell
 * an operator a panel is coming, weeks before the third-party result lands.
 */
export function panelTriggers(i: GradingInput): PanelTrigger[] {
  const t: PanelTrigger[] = []
  const th = i.thresholds ?? DEFAULT_THRESHOLDS
  if (!i.mini) return t

  const add = (term: string, when: TriggerWhen, kind: TriggerKind, why: string) =>
    t.push({ term, when, kind, why,
             binding: !!i.binding[term], clause: i.clauses?.[term] ?? null })

  if ((i.mini.density ?? 0) >= th.maxDensity)
    add('density', 'mini', 'sensorial',
        `Mass density ${Number(i.mini.density).toFixed(2)} — at or above the ${th.maxDensity} line`)

  const src = i.internal ?? i.mini
  const leaf = shadeScore(src.shade)
  const when: TriggerWhen = i.internal ? 'internal' : 'mini'

  if (leaf == null && src.shade != null)
    add('sensory', when, 'sensorial',
        `Leaf shade ${src.shade} carries no score — it falls outside the scoring curve`)

  const scores = [leaf, src.colour, src.taste, src.aroma]
  if (scores.some(s => s != null && Number(s) <= th.minScore))
    add('sensory', when, 'sensorial', `A sensory score of ${th.minScore} or less`)

  if (i.internal && i.internal.agrees === false)
    add('lab_variance', 'internal', 'verification',
        i.internal.dispute_note
          ? `Blackheath disputes the sample — "${i.internal.dispute_note}"`
          : `Blackheath and the mini lab differ by more than ${th.tolerance}`
            + (i.internal.variance_note ? ` (${i.internal.variance_note})` : ''))

  const e = i.external
  if (e) {
    if (i.organic && e.residue_group && e.residue_group !== 'R-0')
      add('organic_residue', 'external', 'residue',
          `Organic load with ${e.residue_group}. The contract allows a downgrade to conventional; the panel decides.`)
    if (e.pa_group === 'P4') add('pa4', 'external', 'residue', 'PA result P4')
    if (i.organic && (e.pa_group === 'P2' || e.pa_group === 'P3'))
      add('organic_pa23', 'external', 'residue', `Organic load at PA ${e.pa_group}`)
  }
  return t
}

/** Only a CONTRACT-BOUND trigger reaches the producer's documents. */
export const bindingTriggers  = (i: GradingInput) => panelTriggers(i).filter(t => t.binding)
export const inhouseTriggers  = (i: GradingInput) => panelTriggers(i).filter(t => !t.binding)

/**
 * What the Afleweringsbewys prints in "Verpligte Paneel Besluit". That document
 * is made out before Blackheath has read anything, so it can only answer on
 * mini-lab evidence.
 */
export const prelimPanel = (i: GradingInput) =>
  bindingTriggers(i).some(t => t.when === 'mini')

/** What the COA prints in "Paneel Betrokke". */
export const panelBinding = (i: GradingInput) => bindingTriggers(i).length > 0

// ════════════════════════════════════════════════════════════════════════════
// THE STAGE MACHINE
// ════════════════════════════════════════════════════════════════════════════
export type Stage =
  | 'awaiting_mini' | 'awaiting_internal' | 'awaiting_external'
  | 'panel' | 'approved' | 'rejected' | 'returned'

export interface StageResult {
  stage:    Stage
  label:    string
  grade?:   'A' | 'B' | 'C' | null
  downgraded?: boolean
  reopened?: boolean
  reasons:  string[]
}

export function stageOf(i: GradingInput): StageResult {
  const th = i.thresholds ?? DEFAULT_THRESHOLDS

  if (i.returned) return { stage: 'returned', label: 'Returned to producer', reasons: [] }
  if (!i.mini) return { stage: 'awaiting_mini', label: 'Awaiting mini lab', reasons: [] }

  const s = sieveTable(i.mini.sieve_json)
  if (!s.complete)
    return { stage: 'awaiting_mini', label: 'Mini lab incomplete',
             reasons: [`Sieve sample totals ${s.totalGrams} g — must be 399–401 g`] }

  // Two HARD rejections. Both sit above the panel decision on purpose: they are
  // facts about the material, and no panel resolution outranks them. A banned
  // residue that lands after the panel has approved still rejects.
  if ((i.mini.moisture ?? 0) >= 10)
    return { stage: 'rejected', label: 'Rejected', reasons: ['Moisture ≥ 10 % — immediate rejection'] }
  if (i.external?.residue_group === 'R-Banned')
    return { stage: 'rejected', label: 'Rejected', reasons: ['Banned residue detected'] }

  const trig = panelTriggers(i)

  if (i.panel) {
    // The panel decided on what it could see. A trigger that appeared afterwards
    // — typically a residue or PA result two weeks later — is new evidence, and
    // the decision does not cover it.
    const covered = i.panel.covered ?? []
    const fresh = trig.filter(t => !covered.includes(t.why))
    if (fresh.length)
      return { stage: 'panel', label: 'Panel — new findings since the decision',
               reopened: true, reasons: fresh.map(t => t.why) }
    if (i.panel.outcome === 'reject')
      return { stage: 'rejected', label: 'Rejected by panel', reasons: [i.panel.reason] }
    if (i.panel.outcome === 'downgrade')
      return { stage: 'approved', label: 'Approved — downgraded', downgraded: true,
               grade: (i.panel.grade as 'A'|'B'|'C') ?? 'C', reasons: [i.panel.reason] }
    return { stage: 'approved', label: 'Approved by panel',
             grade: (i.panel.grade as 'A'|'B'|'C') ?? 'C', reasons: [i.panel.reason] }
  }

  if (!i.internal) return { stage: 'awaiting_internal', label: 'Awaiting Blackheath', reasons: [] }

  // A verification dispute BLOCKS: there is no agreed sensory reading to grade
  // on, so waiting for residue would be waiting for the wrong thing.
  const dispute = trig.filter(t => t.kind === 'verification')
  if (dispute.length)
    return { stage: 'panel', label: 'Panel — verification disputed',
             reasons: dispute.map(t => t.why) }

  if (!i.external) return { stage: 'awaiting_external', label: 'Awaiting external lab', reasons: [] }
  if (trig.length)
    return { stage: 'panel', label: 'Panel decision required', reasons: trig.map(t => t.why) }

  const src = i.internal ?? i.mini
  const leaf = shadeScore(src.shade)
  const density = i.mini.density ?? 0
  const resOk = ['R-0', 'R-1', 'R-2'].includes(i.external.residue_group ?? '')
  const meets = (t: GradeThresholds['exportGrade']) =>
    leaf != null && leaf >= t.leaf
    && Number(src.colour ?? 0) >= t.colour && Number(src.taste ?? 0) >= t.taste
    && Number(src.aroma ?? 0) >= t.aroma && density < t.density

  if (resOk && meets(th.exportGrade)) return { stage: 'approved', label: 'Approved', grade: 'A', reasons: [] }
  if (resOk && meets(th.blendGrade))  return { stage: 'approved', label: 'Approved', grade: 'B', reasons: [] }
  if (density < th.maxDensity)
    return { stage: 'approved', label: 'Approved', grade: 'C',
             reasons: resOk ? [] : [`Residue ${i.external.residue_group} — domestic only`] }
  return { stage: 'panel', label: 'Panel decision required', reasons: ['No grade matched'] }
}

/** The preliminary raw-material group the Afleweringsbewys prints. */
export function prelimGroup(i: GradingInput): string {
  const th = i.thresholds ?? DEFAULT_THRESHOLDS
  if (!i.mini) return '—'
  const src = i.internal ?? i.mini
  const leaf = shadeScore(src.shade)
  const density = i.mini.density ?? 0
  const meets = (t: GradeThresholds['exportGrade']) =>
    leaf != null && leaf >= t.leaf
    && Number(src.colour ?? 0) >= t.colour && Number(src.taste ?? 0) >= t.taste
    && Number(src.aroma ?? 0) >= t.aroma && density < t.density
  if (meets(th.exportGrade)) return 'Export'
  if (meets(th.blendGrade))  return 'Export Blend'
  return density < th.maxDensity ? 'Domestic' : 'Paneel'
}

/**
 * A batch is FINALISED when nothing is left for anyone to do. At ~500
 * deliveries a season the working screens cannot also be the archive.
 */
export function isFinalised(stage: Stage, hasCoa: boolean): boolean {
  return stage === 'returned' || stage === 'rejected' || (stage === 'approved' && hasCoa)
}

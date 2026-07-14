/**
 * Training / LMS module — shared configuration.
 * Mirrors the shape of competency-config.ts so patterns stay consistent.
 *
 * Grading lives here as a pure function so the API route (the only caller
 * with access to is_correct/match_key) and the manage/authoring UI (which is
 * also gated server-side) share one definition of "correct". Never call
 * gradeQuestion with data that has been sent to an ungated client — the
 * learner-facing question payload must have is_correct/match_key stripped
 * before it ever reaches the browser.
 */

export type QuestionKind =
  | 'single_choice'
  | 'multi_choice'
  | 'true_false'
  | 'numeric'
  | 'matching'
  | 'short_text'

export interface QuestionKindMeta {
  kind:  QuestionKind
  label: string
  hint:  string
}

export const QUESTION_KINDS: QuestionKindMeta[] = [
  { kind: 'single_choice', label: 'Single choice',  hint: 'Pick one correct option' },
  { kind: 'multi_choice',  label: 'Multiple choice', hint: 'Pick all options that apply' },
  { kind: 'true_false',    label: 'True / False',    hint: 'Two options: True and False' },
  { kind: 'numeric',       label: 'Numeric',         hint: 'A number, with an optional tolerance' },
  { kind: 'matching',      label: 'Matching',        hint: 'Match each option to the correct label' },
  { kind: 'short_text',    label: 'Short text',      hint: 'Free text — auto-graded against accepted answers, or sent for manual review' },
]

export function questionKindMeta(kind: string): QuestionKindMeta {
  return QUESTION_KINDS.find(k => k.kind === kind) ?? QUESTION_KINDS[0]
}

export type CourseStatus = 'draft' | 'active' | 'archived'
export type AssignmentStatus = 'assigned' | 'in_progress' | 'completed'

// ── Types shared between the API route and the UI ──────────────────────────

export interface TrainingOption {
  id:         string
  question_id: string
  label:      string
  is_correct?: boolean   // present only in authoring/grading payloads — NEVER in learner payloads
  match_key?:  string | null // present only in authoring/grading payloads
  sort_order: number
}

export interface TrainingQuestion {
  id:                string
  course_id:         string
  sort_order:        number
  prompt:            string
  kind:              QuestionKind
  points:            number
  explanation?:      string | null
  image_url?:        string | null
  numeric_answer?:   number | null   // authoring/grading only
  numeric_tolerance?: number | null  // authoring/grading only
  manual_review:     boolean
  options?:          TrainingOption[]
}

// ── Answer submission shapes (what the learner submits, keyed by question_id) ─
// single_choice/true_false: string (option id)
// multi_choice:             string[] (option ids)
// numeric:                  number
// matching:                 Record<optionId, string>  (submitted match_key per option)
// short_text:                string

export type SubmittedAnswer = string | string[] | number | Record<string, string> | null

export interface GradeResult {
  correct: boolean
  earned:  number
  skippedManualReview: boolean
}

/**
 * Grades a single question against a submitted answer. Requires the FULL
 * question (with is_correct/match_key on its options) — server-side only.
 * manual_review questions are never auto-graded: earned=0 here, and the
 * caller must flag the attempt needs_review so a training officer sets the
 * final score later.
 */
export function gradeQuestion(question: TrainingQuestion, submitted: SubmittedAnswer): GradeResult {
  const points = question.points ?? 1

  if (question.manual_review) {
    return { correct: false, earned: 0, skippedManualReview: true }
  }

  const options = question.options ?? []

  switch (question.kind) {
    case 'single_choice':
    case 'true_false': {
      const correctOpt = options.find(o => o.is_correct)
      const correct = !!correctOpt && submitted === correctOpt.id
      return { correct, earned: correct ? points : 0, skippedManualReview: false }
    }

    case 'multi_choice': {
      const correctIds = new Set(options.filter(o => o.is_correct).map(o => o.id))
      const submittedIds = new Set(Array.isArray(submitted) ? submitted : [])
      const correct = correctIds.size === submittedIds.size &&
        [...correctIds].every(id => submittedIds.has(id))
      return { correct, earned: correct ? points : 0, skippedManualReview: false }
    }

    case 'numeric': {
      const target = question.numeric_answer
      const tolerance = question.numeric_tolerance ?? 0
      const value = typeof submitted === 'number' ? submitted : parseFloat(String(submitted ?? '').replace(',', '.'))
      const correct = target != null && !isNaN(value) && Math.abs(value - target) <= tolerance
      return { correct, earned: correct ? points : 0, skippedManualReview: false }
    }

    case 'matching': {
      const answerMap = (submitted && typeof submitted === 'object' && !Array.isArray(submitted)) ? submitted as Record<string, string> : {}
      const relevant = options.filter(o => o.match_key)
      const correct = relevant.length > 0 && relevant.every(o =>
        (answerMap[o.id] ?? '').trim().toLowerCase() === (o.match_key ?? '').trim().toLowerCase()
      )
      return { correct, earned: correct ? points : 0, skippedManualReview: false }
    }

    case 'short_text': {
      const accepted = options.map(o => o.label.trim().toLowerCase())
      const value = String(submitted ?? '').trim().toLowerCase()
      const correct = accepted.length > 0 && accepted.includes(value)
      return { correct, earned: correct ? points : 0, skippedManualReview: false }
    }

    default:
      return { correct: false, earned: 0, skippedManualReview: false }
  }
}

/**
 * Grades a full attempt. Returns the auto-scored total (0–1), whether any
 * question needs manual review, and the per-question breakdown.
 */
export function gradeAttempt(questions: TrainingQuestion[], answers: Record<string, SubmittedAnswer>) {
  let earned = 0
  let total = 0
  let needsReview = false
  const breakdown: Record<string, GradeResult> = {}

  for (const q of questions) {
    total += q.points ?? 1
    const result = gradeQuestion(q, answers[q.id] ?? null)
    breakdown[q.id] = result
    if (result.skippedManualReview) { needsReview = true; continue }
    earned += result.earned
  }

  const autoScore = total > 0 ? earned / total : 0
  return { autoScore, needsReview, breakdown, earned, total }
}

// ── Strip sensitive fields before a question payload reaches a learner ─────

export function toLearnerQuestion(q: TrainingQuestion): TrainingQuestion {
  return {
    ...q,
    numeric_answer: undefined,
    numeric_tolerance: undefined,
    options: (q.options ?? []).map(o => ({
      id: o.id, question_id: o.question_id, label: o.label, sort_order: o.sort_order,
    })),
  }
}

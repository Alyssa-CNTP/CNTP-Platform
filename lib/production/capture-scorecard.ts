/**
 * Reading one operator's own capture ratings.
 *
 * The I/O half of lib/core/production/scorecard.ts. Scoped to a single
 * `operator_id` and, when given, a single section — this answers "how am I
 * doing on this line", never "how does everyone compare". The supervisor's
 * weekly board is a different query behind `can_view_capture_ratings`.
 *
 * Returns an empty summary rather than throwing. A scorecard is the least
 * important thing on the History / Planning page: the record of what ran on
 * the line is what an operator came for, and a ratings query that fails must
 * not take that away from them.
 */

import { getDb } from '@/lib/supabase/db'
import {
  summariseScorecard, type Scorecard, type ScorecardRow,
} from '@/lib/core/production/scorecard'

interface RatingRow {
  performance: number | null
  accuracy: number | null
  system_accuracy_pct: number | null
}

const EMPTY: Scorecard = {
  ratedShifts: 0, unratedShifts: 0,
  avgPerformance: null, avgAccuracy: null, avgSystemAccuracyPct: null,
}

export async function loadMyScorecard(
  operatorId: string | null | undefined,
  fromDate: string,
  toDate: string,
  sectionId?: string,
): Promise<Scorecard> {
  if (!operatorId) return EMPTY
  try {
    let q = getDb().schema('production').from('capture_ratings')
      .select('performance,accuracy,system_accuracy_pct')
      .eq('operator_id', operatorId)
      .gte('date', fromDate)
      .lte('date', toDate)
    // Only narrow when a specific line is being looked at. On "All sections"
    // the card is their whole record, which is the honest reading of the
    // filter above it.
    if (sectionId) q = q.eq('section_id', sectionId)

    const { data, error } = await q
    if (error) throw error

    const rows: ScorecardRow[] = ((data as RatingRow[] | null) ?? []).map(r => ({
      performance:       r.performance,
      accuracy:          r.accuracy,
      systemAccuracyPct: r.system_accuracy_pct,
    }))
    return summariseScorecard(rows)
  } catch {
    return EMPTY
  }
}

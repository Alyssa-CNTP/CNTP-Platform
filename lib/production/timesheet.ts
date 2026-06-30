// Operator timesheet auto-derive.
//
// Timesheets are reconstructed from the `capture_activity` heartbeat the capture
// page writes during a shift. The rule (from the onboarding doc):
//   first action  = shift start
//   5–30 min gap  = tea break
//   >30 min gap   = lunch
//   last action   = shift end
// The operator confirms (with light edits) at sign-off; the result is stored in
// `prod_timesheets`.

import { getDb } from '@/lib/supabase/db'

export const TEA_MIN_MINUTES = 5
export const TEA_MAX_MINUTES = 30

export type BreakType = 'tea' | 'lunch' | 'changeover' | 'maintenance' | 'other'
export interface TimesheetBreak {
  type:  BreakType
  start: string  // ISO
  end:   string  // ISO
  notes?: string
}
export interface DerivedTimesheet {
  shiftStart:    string | null  // ISO
  shiftEnd:      string | null  // ISO
  breaks:        TimesheetBreak[]
  workedMinutes: number
}

const MS_PER_MIN = 60_000

/**
 * Derive a timesheet from a list of activity timestamps (ISO strings).
 * Pure — no I/O — so it's easy to unit-test against crafted inputs.
 */
export function deriveTimesheet(timestamps: string[]): DerivedTimesheet {
  const sorted = timestamps
    .map(t => new Date(t).getTime())
    .filter(t => !Number.isNaN(t))
    .sort((a, b) => a - b)

  if (sorted.length === 0) {
    return { shiftStart: null, shiftEnd: null, breaks: [], workedMinutes: 0 }
  }

  const start = sorted[0]
  const end   = sorted[sorted.length - 1]
  const breaks: TimesheetBreak[] = []

  for (let i = 1; i < sorted.length; i++) {
    const gapMin = (sorted[i] - sorted[i - 1]) / MS_PER_MIN
    if (gapMin >= TEA_MIN_MINUTES) {
      breaks.push({
        type:  gapMin > TEA_MAX_MINUTES ? 'lunch' : 'tea',
        start: new Date(sorted[i - 1]).toISOString(),
        end:   new Date(sorted[i]).toISOString(),
      })
    }
  }

  return {
    shiftStart: new Date(start).toISOString(),
    shiftEnd:   new Date(end).toISOString(),
    breaks,
    workedMinutes: workedMinutes(new Date(start).toISOString(), new Date(end).toISOString(), breaks),
  }
}

/** Worked minutes = total span minus the sum of all break durations. Never negative. */
export function workedMinutes(
  shiftStart: string | null,
  shiftEnd: string | null,
  breaks: TimesheetBreak[],
): number {
  if (!shiftStart || !shiftEnd) return 0
  const span = (new Date(shiftEnd).getTime() - new Date(shiftStart).getTime()) / MS_PER_MIN
  const breakMin = breaks.reduce((sum, b) => {
    const d = (new Date(b.end).getTime() - new Date(b.start).getTime()) / MS_PER_MIN
    return sum + (Number.isFinite(d) && d > 0 ? d : 0)
  }, 0)
  return Math.max(0, Math.round(span - breakMin))
}

/** Read the ordered activity timestamps for a session. */
export async function loadActivity(sessionId: string): Promise<string[]> {
  const { data } = await getDb().schema('production').from('capture_activity')
    .select('occurred_at').eq('session_id', sessionId).order('occurred_at', { ascending: true })
  return (data ?? []).map((r: any) => r.occurred_at as string)
}

export interface StoredTimesheet {
  shift_start:    string | null
  shift_end:      string | null
  breaks:         TimesheetBreak[]
  worked_minutes: number | null
  confirmed:      boolean
  confirmed_by:   string | null
  confirmed_at:   string | null
}

/** Load an existing (possibly confirmed) timesheet row for a session + operator. */
export async function loadTimesheet(
  sessionId: string,
  operatorName: string,
): Promise<StoredTimesheet | null> {
  const { data } = await getDb().schema('production').from('prod_timesheets')
    .select('shift_start,shift_end,breaks,worked_minutes,confirmed,confirmed_by,confirmed_at')
    .eq('session_id', sessionId).eq('operator_name', operatorName).maybeSingle()
  return (data as StoredTimesheet) ?? null
}

export interface SaveTimesheetArgs {
  sessionId:    string
  operatorId:   string | null
  operatorName: string
  sectionId:    string
  date:         string
  shift:        string
  shiftStart:   string | null
  shiftEnd:     string | null
  breaks:       TimesheetBreak[]
  derived:      DerivedTimesheet  // raw auto-derived snapshot, kept for audit
}

/** Upsert the confirmed timesheet (keyed on session_id + operator_name). */
export async function saveTimesheet(args: SaveTimesheetArgs): Promise<void> {
  const worked = workedMinutes(args.shiftStart, args.shiftEnd, args.breaks)
  await getDb().schema('production').from('prod_timesheets').upsert({
    session_id:     args.sessionId,
    operator_id:    args.operatorId,
    operator_name:  args.operatorName,
    section_id:     args.sectionId,
    date:           args.date,
    shift:          args.shift,
    shift_start:    args.shiftStart,
    shift_end:      args.shiftEnd,
    breaks:         args.breaks,
    worked_minutes: worked,
    derived_data:   args.derived,
    confirmed:      true,
    confirmed_by:   args.operatorName,
    confirmed_at:   new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  } as any, { onConflict: 'session_id,operator_name' })
}

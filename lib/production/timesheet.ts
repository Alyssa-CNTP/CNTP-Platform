// Operator timesheet auto-derive.
//
// Timesheets are anchored to real clock events, NOT to gaps in capture activity:
//   shift start = the operator's first activity stamp = login / page-open (fixed)
//   shift end   = when they submit or log out (passed in explicitly), else the
//                 last activity stamp as a fallback
//   breaks      = the standard tea/lunch schedule for the shift, clipped to the
//                 worked window; the operator can add explicit stoppages at
//                 sign-off. Inactivity gaps are NOT treated as breaks.
//   worked      = (end − start) − break time overlapping the window
//
// Why not infer breaks from inactivity gaps? Operators spend long stretches doing
// physical floor work without touching the tablet, so a normal shift produced one
// giant "lunch" gap and worked-time collapsed to a few minutes. Anchoring to
// login/submit and applying the fixed break schedule is what the shift actually is.
// The operator confirms (start is read-only) at sign-off; the result is stored in
// `prod_timesheets`.

import { getDb } from '@/lib/supabase/db'

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

// Standard break schedule per shift — always applied (then clipped to the worked
// window), since breaks are no longer inferred from inactivity gaps.
// Times are local (SAST) on the session date; ISO conversion happens in the browser.
const STANDARD_BREAKS: Record<string, { type: BreakType; localTime: string; durationMin: number }[]> = {
  morning: [
    { type: 'tea',   localTime: '10:30', durationMin: 30 },
    { type: 'lunch', localTime: '13:00', durationMin: 30 },
  ],
  // Night shift 16:00–01:00: tea at 19:00, meal at 21:00
  afternoon: [
    { type: 'tea',   localTime: '19:00', durationMin: 15 },
    { type: 'lunch', localTime: '21:00', durationMin: 60 },
  ],
  night: [
    { type: 'tea',   localTime: '19:00', durationMin: 15 },
    { type: 'lunch', localTime: '21:00', durationMin: 60 },
  ],
}

/** The standard tea/lunch breaks for a shift on a date, as concrete ISO windows. */
export function standardBreaks(shift: string | undefined, date: string | undefined): TimesheetBreak[] {
  if (!shift || !date) return []
  return (STANDARD_BREAKS[shift] ?? []).map(({ type, localTime, durationMin }) => {
    const startMs = new Date(`${date}T${localTime}:00`).getTime()
    return {
      type,
      start: new Date(startMs).toISOString(),
      end:   new Date(startMs + durationMin * MS_PER_MIN).toISOString(),
    }
  })
}

/**
 * Derive a timesheet from a list of activity timestamps (ISO strings).
 * Pure — no I/O — so it's easy to unit-test against crafted inputs.
 *
 * Start is anchored to the FIRST stamp (login / page-open) and is fixed.
 * End is the explicit `endIso` (submit / logout) when given, else the LAST stamp.
 * Breaks are the shift's standard schedule (clipped to the worked window at the
 * `workedMinutes` step) — never inferred from gaps between stamps.
 */
export function deriveTimesheet(
  timestamps: string[],
  opts?: { shift?: string; date?: string; endIso?: string | null },
): DerivedTimesheet {
  const sorted = timestamps
    .map(t => new Date(t).getTime())
    .filter(t => !Number.isNaN(t))
    .sort((a, b) => a - b)

  if (sorted.length === 0) {
    return { shiftStart: null, shiftEnd: null, breaks: [], workedMinutes: 0 }
  }

  const startIso = new Date(sorted[0]).toISOString()
  // Prefer the explicit submit/logout end; fall back to the last stamp. Guard
  // against an end that predates the last stamp (clock skew) by taking the later.
  const lastStampMs = sorted[sorted.length - 1]
  const endMsCandidate = opts?.endIso ? new Date(opts.endIso).getTime() : NaN
  const endMs = Number.isFinite(endMsCandidate) ? Math.max(endMsCandidate, lastStampMs) : lastStampMs
  const endIso = new Date(endMs).toISOString()

  const breaks = standardBreaks(opts?.shift, opts?.date)

  return {
    shiftStart: startIso,
    shiftEnd:   endIso,
    breaks,
    workedMinutes: workedMinutes(startIso, endIso, breaks),
  }
}

/** How much of a break overlaps the [shiftStart, shiftEnd] window, in minutes. */
function breakOverlapMinutes(b: TimesheetBreak, startMs: number, endMs: number): number {
  const bs = new Date(b.start).getTime()
  const be = new Date(b.end).getTime()
  if (!Number.isFinite(bs) || !Number.isFinite(be)) return 0
  const overlap = Math.min(be, endMs) - Math.max(bs, startMs)
  return overlap > 0 ? overlap / MS_PER_MIN : 0
}

/**
 * Worked minutes = shift span minus the break time that falls INSIDE the shift
 * window. Clipping to the window means a standard lunch at 13:00 can't subtract
 * from someone who left at 12:30, and never goes negative.
 */
export function workedMinutes(
  shiftStart: string | null,
  shiftEnd: string | null,
  breaks: TimesheetBreak[],
): number {
  if (!shiftStart || !shiftEnd) return 0
  const startMs = new Date(shiftStart).getTime()
  const endMs   = new Date(shiftEnd).getTime()
  const span = (endMs - startMs) / MS_PER_MIN
  if (!(span > 0)) return 0
  const breakMin = (breaks ?? []).reduce((sum, b) => sum + breakOverlapMinutes(b, startMs, endMs), 0)
  return Math.max(0, Math.round(span - breakMin))
}

/**
 * Read the ordered activity timestamps for a session, scoped to one operator
 * when a session has more than one working it (each heartbeat row already
 * carries the operator who was verified when it was written) — otherwise two
 * operators sharing a shift/session get their heartbeats merged into a single
 * stream, which both erases each operator's real breaks (masked by whichever
 * of them is still active) and gives both of them the same derived shift
 * times when they each confirm their own timesheet.
 * Falls back to every heartbeat on the session if the operator-scoped query
 * comes back empty — heartbeats logged before an operator was verified, or a
 * genuinely single-operator session, still have something to derive from.
 */
export async function loadActivity(sessionId: string, operatorId?: string | null): Promise<string[]> {
  const all = () => getDb().schema('production').from('capture_activity')
    .select('occurred_at').eq('session_id', sessionId).order('occurred_at', { ascending: true })

  if (operatorId) {
    const { data } = await getDb().schema('production').from('capture_activity')
      .select('occurred_at').eq('session_id', sessionId).eq('operator_id', operatorId)
      .order('occurred_at', { ascending: true })
    if (data && data.length > 0) return data.map((r: any) => r.occurred_at as string)
  }
  const { data } = await all()
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

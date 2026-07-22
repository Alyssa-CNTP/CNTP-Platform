// lib/production/roster-rotate.ts
//
// Shared shift-roster rotation logic, used by BOTH:
//   • the client "Generate next week" button (app/(app)/production/roster/page.tsx)
//   • the unattended cron endpoint (app/api/production/roster/cron/route.ts)
//
// Rotation rule: every entry swaps day ↔ night, and the Shift A/B labels swap
// with the people (so "Shift A" that was on days is on nights next period).
// The cadence is one constant — flip ROSTER_PERIOD_DAYS to 30-ish for monthly.
//
// Client-agnostic: `db` is any Supabase query builder already scoped to the
// `production` schema (getDb().schema('production') or the service-role admin
// client). Both expose the same PostgREST chain.

import { addDays, format, parseISO, getISOWeek } from 'date-fns'

export const ROSTER_PERIOD_DAYS = 7  // weekly cadence

export interface RotatePeriod {
  id: string; name: string; start_date: string; end_date: string
  day_label: string; night_label: string
}
export interface RotateEntry {
  role_key: string; shift: 'day' | 'night'
  employee_id?: string | null; operator_id?: string | null
  person_name: string; tags: string[]; sort_order: number
}

/** Dates + label for the period that follows `source`. */
export function nextPeriodConfig(source: RotatePeriod, periodDays = ROSTER_PERIOD_DAYS) {
  const start = addDays(parseISO(source.start_date + 'T12:00:00'), periodDays)
  const end   = addDays(parseISO(source.end_date   + 'T12:00:00'), periodDays)
  return {
    // One consistent naming scheme: the ISO week number of the year, e.g. "Week 31".
    name:       `Week ${getISOWeek(start)}`,
    start:      format(start, 'yyyy-MM-dd'),
    end:        format(end,   'yyyy-MM-dd'),
    // The day/night columns are fixed clock ranges (07h00–16h00 / 16h00–01h00),
    // so they carry through unchanged. Only the PEOPLE rotate — their entries
    // flip day↔night in rotateEntries(); the column headers stay put.
    dayLabel:   source.day_label   || '07h00 till 16h00',
    nightLabel: source.night_label || '16h00 till 01h00',
  }
}

/** Every entry, with its shift flipped, ready to insert against `newPeriodId`. */
export function rotateEntries(entries: RotateEntry[], newPeriodId: string) {
  return entries.map(e => ({
    period_id:   newPeriodId,
    role_key:    e.role_key,
    shift:       e.shift === 'day' ? 'night' : 'day',
    employee_id: e.employee_id ?? null,
    operator_id: e.operator_id ?? null,
    person_name: e.person_name,
    tags:        e.tags,
    sort_order:  e.sort_order,
  }))
}

/**
 * Create the next rotated period from `source` + its `entries`, using the
 * given production-scoped client. Returns the new period id (or null on failure).
 * `createdBy` is the auth user id, or null for the cron.
 */
export async function createRotatedPeriod(
  db: any,
  source: RotatePeriod,
  entries: RotateEntry[],
  createdBy: string | null,
  periodDays = ROSTER_PERIOD_DAYS,
): Promise<{ periodId: string; config: ReturnType<typeof nextPeriodConfig> } | null> {
  const config = nextPeriodConfig(source, periodDays)
  const { data: created, error } = await db.from('roster_periods').insert({
    name: config.name, start_date: config.start, end_date: config.end,
    day_label: config.dayLabel, night_label: config.nightLabel,
    created_by: createdBy,
  }).select('id').single()
  if (error || !created) return null

  const newId = (created as any).id as string
  const rotated = rotateEntries(entries, newId)
  if (rotated.length > 0) {
    const { error: insErr } = await db.from('roster_entries').insert(rotated)
    if (insErr) return null
  }
  return { periodId: newId, config }
}

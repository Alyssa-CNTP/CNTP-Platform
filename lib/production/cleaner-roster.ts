/**
 * Cleaners on duty for a given capture date + shift — sourced from the
 * whole-site Shift Roster (production.roster_entries / roster_periods), NOT
 * the per-section operator assignment. A cleaner isn't rostered to one
 * section — they can sign in on any section's Cleaning tab for their tasks.
 *
 * roster_entries.operator_id (backfilled by
 * 20260701_001_roster_entries_backfill_operator_id.sql) already links a
 * roster row to production.operators, which holds the PIN — so cleaner
 * sign-in reuses the exact same PIN-match trust model as PinGate.tsx, no new
 * auth table needed.
 *
 * Known limitation: only 'week' (Mon–Fri) roster periods are consulted —
 * Saturday-specific periods aren't looked up here.
 */
import { getDb } from '@/lib/supabase/db'

const CLEANING_ROLE_KEYS = ['cleaner_operator', 'cleaner']

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function weekdayKey(date: string): string {
  // date is 'yyyy-MM-dd' (SAST-local, already how the capture page passes dates).
  const d = new Date(date + 'T12:00:00')
  return WEEKDAY_KEYS[d.getDay()]
}

export async function cleanersOnDuty(
  date: string,
  shift: string,
): Promise<{ id: string; name: string; pin: string }[]> {
  try {
    const db = getDb()
    const rosterShift = shift === 'morning' ? 'day' : 'night'

    const { data: period } = await db.schema('production').from('roster_periods')
      .select('id').eq('kind', 'week').lte('start_date', date).gte('end_date', date)
      .maybeSingle()
    if (!period) return []

    const { data: entries } = await db.schema('production').from('roster_entries')
      .select('operator_id, days')
      .eq('period_id', (period as any).id)
      .eq('shift', rosterShift)
      .in('role_key', CLEANING_ROLE_KEYS)
    const today = weekdayKey(date)
    const onDuty = ((entries as any[]) ?? []).filter(e =>
      !!e.operator_id && (!e.days || e.days.length === 0 || e.days.includes(today)))
    if (!onDuty.length) return []

    const operatorIds = Array.from(new Set(onDuty.map(e => e.operator_id)))
    const { data: ops } = await db.schema('production').from('operators')
      .select('id, name, display_name, pin').in('id', operatorIds)
    return ((ops as any[]) ?? [])
      .filter(o => !!o.pin)
      .map(o => ({ id: o.id, name: o.display_name || o.name, pin: o.pin }))
  } catch {
    return []   // roster lookup is best-effort — an error here shouldn't block cleaner sign-in from failing loudly
  }
}

/**
 * "Which line am I on today?" — the I/O half of lib/core/roster/section-roles.
 *
 * Core owns the rule (which roster role means which capture section, and how
 * to choose when someone is on two). This fetches what the rule needs.
 *
 * The identity chain is four hops and every one of them is a real join, not a
 * name match:
 *
 *   auth.users.id                  the signed-in user
 *     -> production.operators.user_id / .id
 *     -> production.roster_entries.operator_id
 *     -> .role_key                 'sieving_tower'
 *     -> sectionForRoleKey()       'sieving'
 *
 * It deliberately does NOT go through `prod_sessions.operator_names`, which is
 * an array of DISPLAY NAMES with no ids. Matching on those means a rename or a
 * spelling variant silently drops someone off their own line.
 *
 * Nor does it use `production.operators.section_ids`. That column is the
 * static list of sections an operator is allowed on; the roster is where
 * "today" lives, and today is the question being asked.
 *
 * ── Failing soft, on purpose ────────────────────────────────────────────────
 *
 * Every failure returns null, which the page reads as "no pin" and shows the
 * full section picker. Not being rostered is ordinary — a supervisor, someone
 * on leave, a new starter not yet on a period, or simply a week nobody
 * published. None of those should produce an error on a page whose whole job
 * is to let an operator look something up without asking anyone.
 */

import { getDb } from '@/lib/supabase/db'
import {
  ALL_SECTION_ROLE_KEYS, pinnedSectionFor, type RosterAssignment,
} from '@/lib/core/roster/section-roles'

interface OperatorIdRow { id: string }
interface PeriodIdRow { id: string }
interface EntryRow { role_key: string; shift: string }

/** `production.operators.id` for a signed-in auth user, or null. */
export async function operatorIdForUser(authUserId: string | null | undefined): Promise<string | null> {
  if (!authUserId) return null
  try {
    const { data } = await getDb().schema('production').from('operators')
      .select('id').eq('user_id', authUserId).maybeSingle()
    return (data as OperatorIdRow | null)?.id ?? null
  } catch {
    return null
  }
}

/**
 * The capture section this operator is rostered to on `date`, or null.
 *
 * `captureShift` is 'morning' | 'afternoon' as the capture screens spell it;
 * core translates to the roster's 'day' | 'night'. A roster period is a week,
 * so the date is matched against its range rather than to a single day.
 */
export async function pinnedSectionForUser(
  authUserId: string | null | undefined,
  date: string,
  captureShift: string,
): Promise<string | null> {
  const operatorId = await operatorIdForUser(authUserId)
  if (!operatorId) return null

  try {
    const { data: periods } = await getDb().schema('production').from('roster_periods')
      .select('id').lte('start_date', date).gte('end_date', date)
    const periodIds = ((periods as PeriodIdRow[] | null) ?? []).map(p => p.id)
    if (periodIds.length === 0) return null

    const { data: entries } = await getDb().schema('production').from('roster_entries')
      .select('role_key,shift')
      .eq('operator_id', operatorId)
      .in('period_id', periodIds)
      .in('role_key', [...ALL_SECTION_ROLE_KEYS])

    const rows: RosterAssignment[] = ((entries as EntryRow[] | null) ?? [])
      .map(e => ({ roleKey: e.role_key, shift: e.shift }))
    return pinnedSectionFor(rows, captureShift)
  } catch {
    return null
  }
}

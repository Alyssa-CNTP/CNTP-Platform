// lib/maintenance/roster.ts
// Resolve which technician is on the duty roster at a given moment. Used to
// auto-route urgent breakdowns to whoever is on shift right now.
//
// SINGLE SOURCE OF TRUTH: the Operations "Shift Roster" (production.roster_*).
// The on-duty maintenance technician is read from the maintenance-role entries
// for today's period and the current shift (Day 07:00–16:00 / Night 16:00–01:00,
// SAST). The legacy maintenance.duty_roster is only used as a fallback when the
// Operations roster has no maintenance entries for the current shift.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OnDutyTech {
  userId: string | null   // technician_user_id (null for name-only roster rows)
  name:   string
}

// Maintenance-category role keys in the Operations roster (see roster-config.ts).
// Only technician/assistant roles — manager is never auto-assigned a breakdown.
const MAINT_ROLE_KEYS = ['maintenance_tech', 'maintenance_asst']

// Current shift + SAST calendar date for `at`. SAST is UTC+2 (no DST).
function shiftAndDate(at: Date): { shift: 'day' | 'night'; today: string } {
  const sast = new Date(at.getTime() + 2 * 3600_000)
  const hour = sast.getUTCHours()
  return { shift: hour >= 7 && hour < 16 ? 'day' : 'night', today: sast.toISOString().slice(0, 10) }
}

// On-duty maintenance technicians from the Operations roster (the single source).
async function opsOnDuty(db: SupabaseClient, at: Date): Promise<OnDutyTech[]> {
  const { shift, today } = shiftAndDate(at)
  try {
    const { data: periods } = await db
      .schema('production' as any).from('roster_periods')
      .select('id').lte('start_date', today).gte('end_date', today)
    if (!periods?.length) return []
    const { data: entries } = await db
      .schema('production' as any).from('roster_entries')
      .select('person_name, role_key, shift, period_id')
      .in('period_id', (periods as any[]).map(p => p.id))
      .in('role_key', MAINT_ROLE_KEYS)
      .eq('shift', shift)
    const names = Array.from(new Set(
      (entries as any[] ?? []).map(e => (e.person_name ?? '').trim()).filter(Boolean)
    ))
    return names.map(name => ({ userId: null, name }))
  } catch {
    return []
  }
}

// Legacy fallback — the maintenance.duty_roster time windows (name-only).
async function legacyOnDuty(db: SupabaseClient, at: Date): Promise<OnDutyTech[]> {
  const iso = at.toISOString()
  const { data, error } = await db
    .schema('maintenance' as any).from('duty_roster')
    .select('technician, technician_user_id, start_at, end_at')
    .lte('start_at', iso).gte('end_at', iso)
    .order('start_at', { ascending: false })
  if (error || !data) return []
  return (data as any[]).map(r => ({ userId: r.technician_user_id ?? null, name: r.technician }))
}

/**
 * All technicians on duty at `at` (default now). Operations roster first; the
 * legacy maintenance duty roster only if Operations has no maintenance entries.
 */
export async function listOnDutyTechnicians(db: SupabaseClient, at: Date = new Date()): Promise<OnDutyTech[]> {
  const ops = await opsOnDuty(db, at)
  if (ops.length) return ops
  return legacyOnDuty(db, at)
}

/**
 * The single on-duty technician covering `at` (default now) — the first of the
 * on-duty list. Used to auto-route urgent breakdowns.
 */
export async function resolveOnDutyTechnician(db: SupabaseClient, at: Date = new Date()): Promise<OnDutyTech | null> {
  const list = await listOnDutyTechnicians(db, at)
  return list[0] ?? null
}

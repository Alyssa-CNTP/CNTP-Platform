// lib/maintenance/roster.ts
// Resolve which technician is on the duty roster at a given moment. Used to
// auto-route urgent breakdowns to whoever is on shift right now.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OnDutyTech {
  userId: string | null   // technician_user_id (null for legacy name-only rows)
  name:   string
}

/**
 * The duty-roster slot covering `at` (default now). Most recently started shift
 * wins if two overlap. `db` must be a Supabase client; we scope it to the
 * `maintenance` schema here.
 */
export async function resolveOnDutyTechnician(
  db: SupabaseClient,
  at: Date = new Date()
): Promise<OnDutyTech | null> {
  const iso = at.toISOString()
  const { data, error } = await db
    .schema('maintenance' as any)
    .from('duty_roster')
    .select('technician, technician_user_id, start_at, end_at')
    .lte('start_at', iso)
    .gte('end_at', iso)
    .order('start_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return { userId: (data as any).technician_user_id ?? null, name: (data as any).technician }
}

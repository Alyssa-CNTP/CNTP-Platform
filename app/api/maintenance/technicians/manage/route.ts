// app/api/maintenance/technicians/manage/route.ts
// Manager-only: returns all maintenance techs sourced from the shift roster
// (roster_entries where role_key is a maintenance role), enriched with
// has_pin (tech_auth row exists) and on_shift (current period + current shift).
// Name-matches to shared.app_roles to surface the Supabase user_id needed for PIN ops.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

const MAINT_ROLE_KEYS = ['maintenance_tech', 'maintenance_asst']

function currentShift() {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'day' : 'night'
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function normName(n: string) {
  return (n ?? '').trim().toLowerCase()
}

export async function GET() {
  try {
    const caller = await getCallerPermissions()
    const ok =
      (caller as any).can?.('can_manage_users') ||
      (caller as any).role === 'maintenance_manager' ||
      (caller as any).department === 'IT' ||
      (caller as any).isFullAdmin ||
      (caller as any).isIT
    if (!ok) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const admin = getAdminClient()
    const today = todayISO()
    const shift = currentShift()

    // 1. All unique person_names from the roster with a maintenance role.
    //    Pull from ALL periods (not just current) so the manage page always shows
    //    every tech who has ever appeared on the roster.
    const { data: rosterRows, error: rosterErr } = await admin
      .schema('production' as any)
      .from('roster_entries')
      .select('person_name')
      .in('role_key', MAINT_ROLE_KEYS)
    if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })

    // Deduplicate by normalised name.
    const nameMap = new Map<string, string>() // normName → display name
    for (const r of rosterRows ?? []) {
      if (r.person_name) nameMap.set(normName(r.person_name), r.person_name)
    }
    if (!nameMap.size) return NextResponse.json([])

    // 2. All maintenance users in shared.app_roles — match by name.
    const { data: roleRows } = await admin
      .schema('shared' as any)
      .from('app_roles')
      .select('user_id, full_name, role, is_active')
      .eq('department', 'Maintenance')
    const roleByName = new Map<string, any>()
    for (const r of roleRows ?? []) {
      roleByName.set(normName(r.full_name), r)
    }

    // 3. tech_auth rows — presence = has_pin.
    const userIds = [...roleByName.values()].map((r: any) => r.user_id).filter(Boolean)
    const authByUserId = new Map<string, boolean>()
    if (userIds.length) {
      const { data: authRows } = await admin
        .schema('maintenance' as any)
        .from('tech_auth')
        .select('user_id')
        .in('user_id', userIds)
      for (const r of authRows ?? []) authByUserId.set(r.user_id, true)
    }

    // 4. roster_entries for today's shift — person_names on shift right now.
    const { data: onShiftRows } = await admin
      .schema('production' as any)
      .from('roster_entries')
      .select('person_name, roster_periods!inner(start_date, end_date)')
      .in('role_key', MAINT_ROLE_KEYS)
      .eq('shift', shift)
      .lte('roster_periods.start_date', today)
      .gte('roster_periods.end_date',   today)
    const onShiftNames = new Set(
      (onShiftRows ?? []).map((r: any) => normName(r.person_name)).filter(Boolean)
    )

    // 5. Assemble result — one entry per unique roster name.
    const techs = [...nameMap.entries()].map(([norm, display]) => {
      const roleRow = roleByName.get(norm)
      return {
        user_id:      roleRow?.user_id ?? null,
        full_name:    display,
        role:         roleRow?.role ?? 'maintenance_tech',
        is_active:    roleRow?.is_active ?? true,
        has_pin:      roleRow?.user_id ? (authByUserId.get(roleRow.user_id) ?? false) : false,
        on_shift:     onShiftNames.has(norm),
        unlinked:     !roleRow,   // on roster but not yet in app_roles
      }
    }).sort((a, b) => {
      // on-shift first, then alphabetical
      if (a.on_shift !== b.on_shift) return a.on_shift ? -1 : 1
      return a.full_name.localeCompare(b.full_name)
    })

    return NextResponse.json(techs)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

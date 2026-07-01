// app/api/maintenance/technicians/manage/route.ts
// Manager-only: returns all maintenance techs from shared.app_roles enriched with
// has_pin (tech_auth row exists) and on_shift (roster_entries for today's shift).
// Used exclusively by the Technician PINs management page.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

function currentShift() {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'day' : 'night'
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
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

    // 1. All maintenance staff from app_roles.
    const { data: roleRows, error: roleErr } = await admin
      .schema('shared' as any)
      .from('app_roles')
      .select('user_id, full_name, role, is_active')
      .eq('department', 'Maintenance')
      .in('role', ['maintenance_technician', 'maintenance_tech', 'tech', 'maintenance_manager', 'maintenance_asst'])
      .order('full_name')
    if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 })

    const userIds = (roleRows ?? []).map((r: any) => r.user_id).filter(Boolean)
    if (!userIds.length) return NextResponse.json([])

    // 2. tech_auth rows — presence = has_pin.
    const { data: authRows } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('user_id')
      .in('user_id', userIds)
    const hasPinSet = new Set((authRows ?? []).map((r: any) => r.user_id))

    // 3. Roster entries for today's shift.
    const { data: rosterRows } = await admin
      .schema('production' as any)
      .from('roster_entries')
      .select('operator_id, roster_periods!inner(start_date, end_date)')
      .eq('shift', shift)
      .in('role_key', ['maintenance_tech', 'maintenance_asst'])
      .lte('roster_periods.start_date', today)
      .gte('roster_periods.end_date',   today)
    const onShiftSet = new Set((rosterRows ?? []).map((r: any) => r.operator_id).filter(Boolean))

    const techs = (roleRows ?? []).map((r: any) => ({
      user_id:   r.user_id,
      full_name: r.full_name,
      role:      r.role,
      is_active: r.is_active,
      has_pin:   hasPinSet.has(r.user_id),
      on_shift:  onShiftSet.has(r.user_id),
    }))

    return NextResponse.json(techs)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

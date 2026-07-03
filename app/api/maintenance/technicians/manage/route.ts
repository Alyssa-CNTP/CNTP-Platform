// app/api/maintenance/technicians/manage/route.ts
// Manager-only: all maintenance techs from the shift roster, enriched with
// has_pin (tech_auth row exists) and on_shift (today's roster + current shift).
// No app_roles lookup needed — tech_auth stores person_name directly.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

const MAINT_ROLE_KEYS = ['maintenance_tech', 'maintenance_asst']

function currentShift() {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'day' : 'night'
}

function todayISO() { return new Date().toISOString().slice(0, 10) }
function normName(n: string) { return (n ?? '').trim().toLowerCase() }

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

    // 1. All unique person_names from roster with a maintenance role (all periods).
    const { data: rosterRows, error: rosterErr } = await admin
      .schema('production' as any)
      .from('roster_entries')
      .select('person_name, role_key')
      .in('role_key', MAINT_ROLE_KEYS)
    if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })

    // Deduplicate by normalised name; keep the display name + role.
    const nameMap = new Map<string, { display: string; role: string }>()
    for (const r of rosterRows ?? []) {
      if (r.person_name && !nameMap.has(normName(r.person_name))) {
        nameMap.set(normName(r.person_name), { display: r.person_name, role: r.role_key })
      }
    }
    if (!nameMap.size) return NextResponse.json([])

    // 2. tech_auth rows — presence = has_pin. Keyed by person_name.
    const { data: authRows } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('user_id, person_name, pin, active')
    const authByName = new Map<string, any>()
    for (const r of authRows ?? []) {
      if (r.person_name) authByName.set(normName(r.person_name), r)
    }

    // 3. On-shift names for today's shift.
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

    // 4. Assemble.
    const techs = [...nameMap.entries()].map(([norm, { display, role }]) => {
      const authRow = authByName.get(norm)
      return {
        full_name: display,
        role,
        has_pin:   !!authRow,
        pin:       authRow?.pin ?? null,
        is_active: authRow?.active ?? true,
        on_shift:  onShiftNames.has(norm),
        user_id:   authRow?.user_id ?? null,
      }
    }).sort((a, b) => {
      if (a.on_shift !== b.on_shift) return a.on_shift ? -1 : 1
      return a.full_name.localeCompare(b.full_name)
    })

    return NextResponse.json(techs)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

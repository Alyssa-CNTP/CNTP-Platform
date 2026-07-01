// app/api/maintenance/technicians/route.ts
// Three endpoints:
//   GET    — list active maintenance techs (for the unauthenticated PIN login page)
//   POST   — provision a new Supabase auth account for a tech + set their PIN
//   PATCH  — update an existing tech's PIN or active status

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { newMaintEmail, deriveMaintPassword, MAINT_TECH_PERMISSIONS } from '@/lib/maintenance/tech-auth'

function canManage(caller: { can: (k: any) => boolean; role?: string | null; department?: string | null }) {
  return (
    caller.can('can_manage_users') ||
    (caller as any).role === 'maintenance_manager' ||
    (caller as any).department === 'IT'
  )
}

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

// ─── GET — public list for the login page ────────────────────────────────────
// Sources names from the shift roster (all periods) so the list matches exactly
// who's on the roster. On-shift resolution is server-side (admin bypasses RLS).
// Only returns techs who have a tech_auth row (i.e. a PIN has been set).
export async function GET() {
  try {
    const admin = getAdminClient()
    const today = todayISO()
    const shift = currentShift()

    // 1. All unique person_names from roster with a maintenance role (all periods).
    const { data: rosterAll, error: rosterErr } = await admin
      .schema('production' as any)
      .from('roster_entries')
      .select('person_name')
      .in('role_key', MAINT_ROLE_KEYS)
    if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })

    const nameMap = new Map<string, string>()
    for (const r of rosterAll ?? []) {
      if (r.person_name) nameMap.set(normName(r.person_name), r.person_name)
    }
    if (!nameMap.size) return NextResponse.json([])

    // 2. Match roster names to app_roles to get user_ids.
    const { data: roleRows } = await admin
      .schema('shared' as any)
      .from('app_roles')
      .select('user_id, full_name')
      .eq('department', 'Maintenance')
      .eq('is_active', true)
    const roleByName = new Map<string, any>()
    for (const r of roleRows ?? []) roleByName.set(normName(r.full_name), r)

    // 3. tech_auth rows — only techs with a PIN can log in.
    const linkedUserIds = [...nameMap.keys()]
      .map(n => roleByName.get(n)?.user_id)
      .filter(Boolean)

    const { data: authRows, error: authErr } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('user_id, auth_email')
      .in('user_id', linkedUserIds)
      .eq('active', true)
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

    const emailMap = new Map((authRows ?? []).map((r: any) => [r.user_id, r.auth_email]))

    // 4. On-shift names for today (server-side, bypasses RLS).
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

    // 5. Assemble — only techs with a PIN set (emailMap has their auth_email).
    const techs = [...nameMap.entries()]
      .map(([norm, display]) => {
        const roleRow = roleByName.get(norm)
        if (!roleRow) return null
        const email = emailMap.get(roleRow.user_id)
        if (!email) return null
        return {
          user_id:      roleRow.user_id,
          display_name: display,
          email,
          on_shift:     onShiftNames.has(norm),
        }
      })
      .filter(Boolean)

    return NextResponse.json(techs)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── POST — provision a new Supabase auth account for a tech ─────────────────
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    if (!body?.user_id) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    if (!/^\d{4}$/.test(body?.pin ?? '')) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })

    const admin   = getAdminClient()
    const session = await getSessionClient()

    // Look up the tech in shared.app_roles to get their display name.
    const { data: roleRow, error: roleErr } = await admin
      .schema('shared' as any)
      .from('app_roles')
      .select('full_name, role')
      .eq('user_id', body.user_id)
      .maybeSingle()
    if (roleErr || !roleRow) return NextResponse.json({ error: 'Technician not found in app_roles' }, { status: 404 })

    // Check if they already have a tech_auth row.
    const { data: existing } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('auth_email')
      .eq('user_id', body.user_id)
      .maybeSingle()

    if (existing) {
      // Already provisioned — just update the password.
      const { error: pwErr } = await admin.auth.admin.updateUserById(body.user_id, {
        password: deriveMaintPassword(body.pin, (existing as any).auth_email),
        user_metadata: { full_name: (roleRow as any).full_name, maintenance_tech: true },
      })
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
      return NextResponse.json({ success: true, updated: true })
    }

    // First-time provision: create Supabase auth account + tech_auth row.
    const email = newMaintEmail()
    const { error: createErr } = await admin.auth.admin.updateUserById(body.user_id, {
      password:      deriveMaintPassword(body.pin, email),
      email_confirm: true,
      user_metadata: { full_name: (roleRow as any).full_name, maintenance_tech: true },
    })
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })

    const { error: insertErr } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .insert({ user_id: body.user_id, auth_email: email, active: true })
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    // Ensure app_roles has the right role + permissions for job-card access.
    const { error: arErr } = await session
      .schema('shared' as any)
      .from('app_roles')
      .update({
        role:        'maintenance_technician',
        permissions: { ...(MAINT_TECH_PERMISSIONS as Record<string, boolean>) },
      })
      .eq('user_id', body.user_id)
    if (arErr) return NextResponse.json({ error: arErr.message }, { status: 500 })

    return NextResponse.json({ success: true, updated: false })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── PATCH — reset PIN or toggle active ──────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    if (!body?.user_id) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })

    const admin = getAdminClient()

    const { data: authRow, error: authErr } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('auth_email')
      .eq('user_id', body.user_id)
      .maybeSingle()
    if (authErr || !authRow) return NextResponse.json({ error: 'Tech auth record not found — provision first' }, { status: 404 })

    // PIN reset
    if (body.pin !== undefined) {
      if (!/^\d{4}$/.test(body.pin)) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
      const { error: pwErr } = await admin.auth.admin.updateUserById(body.user_id, {
        password: deriveMaintPassword(body.pin, (authRow as any).auth_email),
      })
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
    }

    // Active toggle
    if (body.active !== undefined) {
      await admin
        .schema('maintenance' as any)
        .from('tech_auth')
        .update({ active: body.active })
        .eq('user_id', body.user_id)
      await admin
        .schema('shared' as any)
        .from('app_roles')
        .update({ is_active: body.active })
        .eq('user_id', body.user_id)
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

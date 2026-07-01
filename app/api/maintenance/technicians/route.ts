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

// ─── GET — public list for the login page ────────────────────────────────────
// Returns only id, display_name, auth_email — never the PIN.
export async function GET() {
  try {
    const admin = getAdminClient()

    // Join shared.app_roles (source of truth for active techs) with maintenance.tech_auth
    // (source of the synthetic email needed for PIN login).
    const { data, error } = await admin
      .schema('shared' as any)
      .from('app_roles')
      .select('user_id, full_name, is_active')
      .eq('department', 'Maintenance')
      .in('role', ['maintenance_technician', 'maintenance_tech', 'tech', 'maintenance_manager', 'maintenance_asst'])
      .eq('is_active', true)
      .order('full_name')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const userIds = (data ?? []).map((r: any) => r.user_id).filter(Boolean)
    if (!userIds.length) return NextResponse.json([])

    // Pull auth emails for these users.
    const { data: authRows, error: authErr } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('user_id, auth_email')
      .in('user_id', userIds)
      .eq('active', true)

    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

    const emailMap = new Map((authRows ?? []).map((r: any) => [r.user_id, r.auth_email]))

    const techs = (data ?? [])
      .filter((r: any) => emailMap.has(r.user_id))
      .map((r: any) => ({
        user_id:      r.user_id,
        display_name: r.full_name,
        email:        emailMap.get(r.user_id),
      }))

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

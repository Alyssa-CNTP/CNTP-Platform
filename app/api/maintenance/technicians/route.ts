// app/api/maintenance/technicians/route.ts
// GET  — public list for the unauthenticated PIN login page
// POST  — provision a new Supabase auth account + tech_auth row (first PIN set)
// PATCH — reset PIN or toggle active status

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { newMaintEmail, deriveMaintPassword, MAINT_TECH_PERMISSIONS } from '@/lib/maintenance/tech-auth'

function canManage(caller: any) {
  return caller.can?.('can_manage_users') || caller.role === 'maintenance_manager' || caller.department === 'IT' || caller.isFullAdmin || caller.isIT
}

const MAINT_ROLE_KEYS = ['maintenance_tech', 'maintenance_asst']

function currentShift() {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'day' : 'night'
}

function todayISO() { return new Date().toISOString().slice(0, 10) }
function normName(n: string) { return (n ?? '').trim().toLowerCase() }

// ─── GET — public list for login page ────────────────────────────────────────
// Reads directly from maintenance.tech_auth (active rows with person_name + auth_email).
// Resolves on_shift via roster (server-side admin client bypasses RLS).
export async function GET() {
  try {
    const admin = getAdminClient()
    const today = todayISO()
    const shift = currentShift()

    // 1. Active techs with a PIN set (auth_email present).
    const { data: techRows, error: techErr } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('user_id, auth_email, person_name')
      .eq('active', true)
      .not('auth_email', 'is', null)
      .not('person_name', 'is', null)
    if (techErr) return NextResponse.json({ error: techErr.message }, { status: 500 })
    if (!techRows?.length) return NextResponse.json([])

    // 2. On-shift names for today's shift.
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

    const techs = (techRows ?? []).map((t: any) => ({
      user_id:      t.user_id,
      display_name: t.person_name,
      email:        t.auth_email,
      on_shift:     onShiftNames.has(normName(t.person_name)),
    }))

    return NextResponse.json(techs)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── POST — provision new auth account + set first PIN ───────────────────────
// Mirrors app/api/production/operators POST.
// Body: { person_name: string, pin: string }
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    if (!body?.person_name?.trim()) return NextResponse.json({ error: 'person_name is required' }, { status: 400 })
    if (!/^\d{4}$/.test(body?.pin ?? '')) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })

    const admin   = getAdminClient()
    const session = await getSessionClient()
    const name    = body.person_name.trim()

    // Guard: already provisioned?
    const { data: existing } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('user_id, auth_email')
      .eq('person_name', name)
      .maybeSingle()

    if (existing) {
      // Already has an account — update password and stored PIN.
      const { error: pwErr } = await admin.auth.admin.updateUserById((existing as any).user_id, {
        password: deriveMaintPassword(body.pin, (existing as any).auth_email),
      })
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
      await admin
        .schema('maintenance' as any)
        .from('tech_auth')
        .update({ pin: body.pin, updated_at: new Date().toISOString() })
        .eq('person_name', name)
      return NextResponse.json({ success: true, updated: true })
    }

    // First time: create a fresh Supabase auth user.
    const email = newMaintEmail()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password:      deriveMaintPassword(body.pin, email),
      email_confirm: true,
      user_metadata: { full_name: name, maintenance_tech: true },
    })
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    const userId = created.user.id

    // Insert tech_auth row.
    const { error: insertErr } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .insert({ user_id: userId, auth_email: email, person_name: name, pin: body.pin, active: true })
    if (insertErr) {
      await admin.auth.admin.deleteUser(userId).catch(() => {})
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Upsert app_roles so the tech has correct permissions after login.
    const { error: roleErr } = await session
      .schema('shared' as any)
      .from('app_roles')
      .upsert({
        user_id:     userId,
        full_name:   name,
        department:  'Maintenance',
        role:        'maintenance_technician',
        permissions: { ...(MAINT_TECH_PERMISSIONS as Record<string, boolean>) },
        is_active:   true,
      }, { onConflict: 'user_id' })
    if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 })

    return NextResponse.json({ success: true, updated: false })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── PATCH — reset PIN or toggle active ──────────────────────────────────────
// Body: { person_name: string, pin?: string, active?: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    if (!body?.person_name?.trim()) return NextResponse.json({ error: 'person_name is required' }, { status: 400 })

    const admin = getAdminClient()

    const { data: authRow, error: authErr } = await admin
      .schema('maintenance' as any)
      .from('tech_auth')
      .select('user_id, auth_email')
      .eq('person_name', body.person_name.trim())
      .maybeSingle()
    if (authErr || !authRow) return NextResponse.json({ error: 'Tech not found — set a PIN first' }, { status: 404 })

    const userId   = (authRow as any).user_id
    const authEmail = (authRow as any).auth_email

    if (body.pin !== undefined) {
      if (!/^\d{4}$/.test(body.pin)) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
        password: deriveMaintPassword(body.pin, authEmail),
      })
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
      await admin
        .schema('maintenance' as any)
        .from('tech_auth')
        .update({ pin: body.pin, updated_at: new Date().toISOString() })
        .eq('person_name', body.person_name.trim())
    }

    if (body.active !== undefined) {
      await admin
        .schema('maintenance' as any)
        .from('tech_auth')
        .update({ active: body.active })
        .eq('person_name', body.person_name.trim())
      await admin
        .schema('shared' as any)
        .from('app_roles')
        .update({ is_active: body.active })
        .eq('user_id', userId)
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

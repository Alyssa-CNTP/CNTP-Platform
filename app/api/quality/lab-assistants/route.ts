// app/api/quality/lab-assistants/route.ts
// GET  — public list for the unauthenticated PIN login page (never returns PIN)
// POST  — provision a new Supabase auth account + lab_auth row (first PIN set)
// PATCH — reset PIN or toggle active status

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { newLabEmail, deriveLabPassword, LAB_ASSISTANT_PERMISSIONS } from '@/lib/quality/lab-auth'

function canManage(caller: any) {
  return (
    caller.can?.('can_manage_users') ||
    caller.role === 'quality_manager' ||
    caller.role === 'lab_manager' ||
    caller.department === 'IT' ||
    caller.isFullAdmin ||
    caller.isIT
  )
}

// ─── GET — public list for login page ────────────────────────────────────────
export async function GET() {
  try {
    const admin = getAdminClient()

    const { data: rows, error } = await admin
      .schema('qms' as any)
      .from('lab_auth')
      .select('user_id, auth_email, full_name')
      .eq('active', true)
      .not('auth_email', 'is', null)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!rows?.length) return NextResponse.json([])

    const assistants = rows.map((r: any) => ({
      user_id:      r.user_id,
      display_name: r.full_name,
      email:        r.auth_email,
    }))

    return NextResponse.json(assistants)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── POST — provision new auth account + set first PIN ───────────────────────
// Body: { full_name: string, pin: string }
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    if (!body?.full_name?.trim()) return NextResponse.json({ error: 'full_name is required' }, { status: 400 })
    if (!/^\d{4}$/.test(body?.pin ?? '')) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
    const sectionIds: string[] = Array.isArray(body?.section_ids) ? body.section_ids : []

    const admin   = getAdminClient()
    const session = await getSessionClient()
    const name    = body.full_name.trim()
    const pin     = body.pin

    // Guard: already provisioned?
    const { data: existing } = await admin
      .schema('qms' as any)
      .from('lab_auth')
      .select('user_id, auth_email')
      .eq('full_name', name)
      .maybeSingle()

    if (existing) {
      // Already has an account — update password and stored PIN.
      const { error: pwErr } = await admin.auth.admin.updateUserById((existing as any).user_id, {
        password: deriveLabPassword(pin, (existing as any).auth_email),
      })
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
      await admin
        .schema('qms' as any)
        .from('lab_auth')
        .update({ pin, section_ids: sectionIds, updated_at: new Date().toISOString() })
        .eq('full_name', name)
      return NextResponse.json({ success: true, updated: true })
    }

    // First time: create a fresh Supabase auth user.
    const email = newLabEmail()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password:      deriveLabPassword(pin, email),
      email_confirm: true,
      user_metadata: { full_name: name, quality_lab_assistant: true },
    })
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    const userId = created.user.id

    // Insert lab_auth row.
    const { error: insertErr } = await admin
      .schema('qms' as any)
      .from('lab_auth')
      .insert({ user_id: userId, auth_email: email, full_name: name, pin, section_ids: sectionIds, active: true })
    if (insertErr) {
      await admin.auth.admin.deleteUser(userId).catch(() => {})
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Upsert app_roles so the assistant has correct permissions after login.
    const { error: roleErr } = await session
      .schema('shared' as any)
      .from('app_roles')
      .upsert({
        user_id:     userId,
        full_name:   name,
        department:  'Quality',
        role:        'quality_lab_assistant',
        permissions: { ...(LAB_ASSISTANT_PERMISSIONS as Record<string, boolean>) },
        is_active:   true,
      }, { onConflict: 'user_id' })
    if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 })

    return NextResponse.json({ success: true, updated: false })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── PATCH — reset PIN or toggle active ──────────────────────────────────────
// Body: { full_name: string, pin?: string, active?: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    if (!body?.full_name?.trim()) return NextResponse.json({ error: 'full_name is required' }, { status: 400 })

    const admin = getAdminClient()

    const { data: authRow, error: authErr } = await admin
      .schema('qms' as any)
      .from('lab_auth')
      .select('user_id, auth_email')
      .eq('full_name', body.full_name.trim())
      .maybeSingle()
    if (authErr || !authRow) return NextResponse.json({ error: 'Lab assistant not found — set a PIN first' }, { status: 404 })

    const userId   = (authRow as any).user_id
    const authEmail = (authRow as any).auth_email

    if (body.pin !== undefined) {
      if (!/^\d{4}$/.test(body.pin)) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
        password: deriveLabPassword(body.pin, authEmail),
      })
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
      const pinUpdate: any = { pin: body.pin, updated_at: new Date().toISOString() }
      if (Array.isArray(body.section_ids)) pinUpdate.section_ids = body.section_ids
      await admin
        .schema('qms' as any)
        .from('lab_auth')
        .update(pinUpdate)
        .eq('full_name', body.full_name.trim())
    } else if (Array.isArray(body.section_ids)) {
      await admin
        .schema('qms' as any)
        .from('lab_auth')
        .update({ section_ids: body.section_ids, updated_at: new Date().toISOString() })
        .eq('full_name', body.full_name.trim())
    }

    if (body.active !== undefined) {
      await admin
        .schema('qms' as any)
        .from('lab_auth')
        .update({ active: body.active })
        .eq('full_name', body.full_name.trim())
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

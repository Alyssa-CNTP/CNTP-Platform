// app/api/admin/users/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

// ─── PATCH — update role, permissions, name, password, confirm email ──────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  const body   = await req.json()

  // Use session client for app_roles queries — service_role lacks schema access
  // to 'shared' via PostgREST (Exposed schemas only grants anon/authenticated).
  const sessionClient = await getSessionClient()
  const admin         = getAdminClient()  // auth API calls only

  // Fetch the target user's department to enforce manager-scoped editing
  const { data: targetRow } = await sessionClient
    .schema('shared' as any)
    .from('app_roles')
    .select('department, role')
    .eq('user_id', id)
    .maybeSingle()

  const targetDept = (targetRow as any)?.department

  // If this user has no app_roles entry and we have enough info, create one
  if (!targetRow && body.department && body.role) {
    if (!caller.can('can_manage_users')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }
    const { error: insertErr } = await sessionClient
      .schema('shared' as any)
      .from('app_roles')
      .upsert({
        user_id:     id,
        full_name:   body.full_name || body.fullName || '—',
        department:  body.department,
        role:        (body.role as string).trim().toLowerCase().replace(/\s+/g, '_'),
        section_id:  body.sectionId ?? null,
        permissions: body.permissions ?? {},
        is_active:   true,
      }, { onConflict: 'user_id' })
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // Managers can only edit users in their own department
  const canEditThisUser =
    caller.can('can_manage_users') ||
    (caller.can('can_edit_permissions') && targetDept === caller.department)

  if (!canEditThisUser)
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  // ── Update department + role ─────────────────────────────────────────────────
  if (body.department !== undefined || body.role !== undefined) {
    if (!caller.can('can_change_roles'))
      return NextResponse.json({ error: 'Permission denied — cannot change roles' }, { status: 403 })

    if (body.department !== undefined && caller.department !== 'IT')
      return NextResponse.json({ error: 'Only IT can change a user\'s department' }, { status: 403 })

    const updates: any = {}
    if (body.department !== undefined) updates.department = body.department
    if (body.role       !== undefined) updates.role       = body.role
    if (body.sectionId  !== undefined) updates.section_id = body.sectionId ?? null

    const { error } = await sessionClient
      .schema('shared' as any)
      .from('app_roles')
      .update(updates)
      .eq('user_id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Update display name in app_roles ────────────────────────────────────────
  if (body.full_name !== undefined) {
    if (!caller.can('can_manage_users'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { error } = await sessionClient
      .schema('shared' as any)
      .from('app_roles')
      .update({ full_name: body.full_name })
      .eq('user_id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Update permission overrides ──────────────────────────────────────────────
  if (body.permissions !== undefined) {
    if (!caller.can('can_edit_permissions'))
      return NextResponse.json({ error: 'Permission denied — cannot edit permissions' }, { status: 403 })

    const { error } = await sessionClient
      .schema('shared' as any)
      .from('app_roles')
      .update({ permissions: body.permissions })
      .eq('user_id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Update display name in auth.users metadata ───────────────────────────────
  if (body.fullName !== undefined) {
    if (!caller.can('can_manage_users'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { error } = await admin.auth.admin.updateUserById(id, {
      user_metadata: { full_name: body.fullName, display_name: body.fullName },
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Reset password (admin sets directly) ────────────────────────────────────
  if (body.password !== undefined) {
    if (!caller.can('can_reset_passwords'))
      return NextResponse.json({ error: 'Permission denied — cannot reset passwords' }, { status: 403 })
    if (!body.password || body.password.length < 8)
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Send password reset email ────────────────────────────────────────────────
  if (body.sendPasswordReset) {
    if (!caller.can('can_reset_passwords'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { data: { user }, error: getErr } = await admin.auth.admin.getUserById(id)
    if (getErr || !user?.email) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { error } = await admin.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Confirm email manually ───────────────────────────────────────────────────
  if (body.confirmEmail) {
    if (!caller.can('can_confirm_emails'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// ─── DELETE — remove a user ───────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.can('can_manage_users'))
    return NextResponse.json({ error: 'Permission denied — only IT can delete users' }, { status: 403 })
  if (id === caller.userId)
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })

  const sessionClient = await getSessionClient()
  const admin         = getAdminClient()

  await sessionClient.schema('shared' as any).from('app_roles').delete().eq('user_id', id)
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

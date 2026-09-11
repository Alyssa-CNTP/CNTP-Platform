// app/api/maintenance/staff/route.ts
//
// Maintenance staff directory + onboarding.
//
// GET  — list every Maintenance-department user (technicians, QC, manager) with
//        their email + phone, so the UI can replace the hardcoded TECHS array,
//        drive @mention autocomplete, and resolve assignment notification targets.
// POST — onboard a new maintenance user. A maintenance manager can add their own
//        technicians without needing full can_manage_users. Mirrors the
//        provisioning flow in app/api/admin/users/route.ts but hardcodes the
//        Maintenance department.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

const MAINT_ROLES = ['maintenance_default', 'maintenance_manager', 'maintenance_technician', 'maintenance_qc']

// ─── GET — list maintenance staff ──────────────────────────────────────────────

export async function GET() {
  try {
    const caller = await getCallerPermissions()
    // Anyone who can allocate jobs, QC, verify, or manage users can read the directory.
    if (!caller.can('can_allocate_jobs') && !caller.can('can_qc_jobs') &&
        !caller.can('can_verify_jobs') && !caller.can('can_manage_users'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    // Read the directory with the ADMIN client, NOT the caller's session.
    //
    // `shared.app_roles` is RLS'd down to the caller's OWN row unless they are
    // admin / IT / can_manage_users. A maintenance_manager holds none of those
    // (can_allocate_jobs + can_verify_jobs, see lib/auth/permissions.ts), so the
    // session read returned exactly one row: himself. That is why the allocation
    // screen would only ever offer the manager as the technician, showed nobody
    // under "assign someone else (off duty)", and had an empty second-technician
    // list — the picker was not broken, the directory behind it was one row long.
    //
    // The permission gate above is what authorises this call; the query is the
    // server answering "who works in Maintenance", not a peek at the caller's
    // own visibility. The department filter keeps it to exactly that.
    const admin = getAdminClient()
    const { data: roleRows, error: rolesErr } = await admin
      .schema('shared' as any)
      .from('app_roles')
      .select('user_id, full_name, department, role, phone, is_active')
      .eq('department', 'Maintenance')
      .order('full_name', { ascending: true })

    if (rolesErr) {
      console.error('[api/maintenance/staff GET] app_roles query error:', rolesErr)
      return NextResponse.json({ error: rolesErr.message }, { status: 500 })
    }

    // Join emails from auth.users (admin API; no schema access needed).
    const listResult = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (listResult.error) {
      console.error('[api/maintenance/staff GET] listUsers error:', listResult.error)
      return NextResponse.json({ error: listResult.error.message }, { status: 500 })
    }
    const authMap = new Map((listResult.data?.users ?? []).map(u => [u.id, u]))

    const staff = (roleRows ?? [])
      .filter((r: any) => r.is_active !== false)
      .map((r: any) => {
        const au = authMap.get(r.user_id)
        const name = r.full_name || au?.user_metadata?.full_name || au?.email?.split('@')[0] || '—'
        return {
          id:       r.user_id,
          name,
          initials: name.split(/[\s_-]/).map((n: string) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?',
          email:    au?.email ?? null,
          phone:    r.phone ?? null,
          role:     r.role,
        }
      })

    return NextResponse.json(staff)
  } catch (err: any) {
    console.error('[api/maintenance/staff GET] unhandled exception:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── POST — onboard a maintenance user ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_allocate_jobs') && !caller.can('can_manage_users'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    const { email, full_name, phone, send_invite } = body
    const role = (body.role || 'maintenance_technician').trim().toLowerCase().replace(/\s+/g, '_')

    if (!email?.trim())     return NextResponse.json({ error: 'Email is required' },     { status: 400 })
    if (!full_name?.trim()) return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
    if (!MAINT_ROLES.includes(role))
      return NextResponse.json({ error: `Role must be one of: ${MAINT_ROLES.join(', ')}` }, { status: 400 })

    const admin = getAdminClient()
    let userId: string

    if (send_invite !== false) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(
        email.trim().toLowerCase(),
        {
          data:       { full_name: full_name.trim() },
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
        }
      )
      if (error) {
        console.error('[api/maintenance/staff POST] inviteUserByEmail error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      userId = data.user.id
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email:         email.trim().toLowerCase(),
        password:      body.password || crypto.randomUUID().slice(0, 16),
        email_confirm: true,
        user_metadata: { full_name: full_name.trim() },
      })
      if (error) {
        console.error('[api/maintenance/staff POST] createUser error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      userId = data.user.id
    }

    // Same reason as the GET: writes to shared.app_roles are IT-only under RLS
    // (`it_manage_all_roles`), so a manager's session could invite the auth user
    // and then fail to give them a role — an account that exists and belongs
    // nowhere. The can_allocate_jobs gate above is the authorisation.
    const { error: roleErr } = await admin
      .schema('shared' as any)
      .from('app_roles')
      .upsert({
        user_id:     userId,
        full_name:   full_name.trim(),
        department:  'Maintenance',
        role,
        phone:       phone?.trim() || null,
        permissions: {},
        is_active:   true,
      }, { onConflict: 'user_id' })

    if (roleErr) {
      console.error('[api/maintenance/staff POST] insert app_roles error:', roleErr)
      return NextResponse.json({ error: roleErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, userId })
  } catch (err: any) {
    console.error('[api/maintenance/staff POST] unhandled exception:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

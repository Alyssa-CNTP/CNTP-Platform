// app/api/admin/users/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'

// ─── GET — list all users ─────────────────────────────────────────────────────

export async function GET() {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_manage_users') && !caller.can('can_edit_permissions'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    // Use the session client (authenticated role) to query shared.app_roles.
    // The admin (service_role) client cannot access the shared schema via PostgREST
    // because Supabase's "Exposed schemas" setting only grants anon/authenticated,
    // not service_role. The session client runs as the caller's authenticated role
    // and the caller has already been verified to have can_manage_users above.
    const sessionClient = await getSessionClient()
    const { data: roleRows, error: rolesErr } = await sessionClient
      .schema('shared' as any)
      .from('app_roles')
      .select('id, user_id, full_name, department, role, section_id, permissions, is_active, created_at, employee_id')
      .order('created_at', { ascending: true })

    if (rolesErr) {
      console.error('[api/admin/users GET] app_roles query error:', rolesErr)
      return NextResponse.json({ error: rolesErr.message }, { status: 500 })
    }

    // Admin client is only needed for auth.admin.listUsers (no schema access required)
    const admin = getAdminClient()
    const listResult = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (listResult.error) {
      console.error('[api/admin/users GET] listUsers error:', listResult.error)
      return NextResponse.json({ error: listResult.error.message }, { status: 500 })
    }
    const authUsers = listResult.data?.users ?? []

    const authMap = new Map(authUsers.map(u => [u.id, u]))

    // Resolve linked Staff Directory names in one batch (admin client — production is exposed to service_role)
    const employeeIds = [...new Set((roleRows ?? []).map((r: any) => r.employee_id).filter(Boolean))]
    let employeeById = new Map<string, { name: string; display_name: string | null }>()
    if (employeeIds.length) {
      const { data: employees } = await admin.schema('production' as any).from('employees').select('id,name,display_name').in('id', employeeIds)
      employeeById = new Map((employees ?? []).map((e: any) => [e.id, e]))
    }

    const result = (roleRows ?? []).map((r: any) => {
      const au = authMap.get(r.user_id)
      const employee = r.employee_id ? employeeById.get(r.employee_id) : null
      return {
        id:              r.user_id,
        display_name:    r.full_name || au?.user_metadata?.full_name || au?.email?.split('@')[0] || '—',
        email:           au?.email ?? '—',
        email_confirmed: !!au?.email_confirmed_at,
        department:      r.department,
        role:            r.role,
        section_id:      r.section_id,
        permissions:     r.permissions ?? {},
        is_active:       r.is_active ?? true,
        created_at:      r.created_at,
        last_sign_in:    au?.last_sign_in_at ?? null,
        employee_id:     r.employee_id ?? null,
        employee_name:   employee ? (employee.display_name || employee.name) : null,
      }
    })

    const roleUserIds = new Set((roleRows ?? []).map((r: any) => r.user_id))
    const orphanAuthUsers = authUsers.filter(au => !roleUserIds.has(au.id))

    // Best-guess Staff Directory match for brand-new SSO sign-ins with no role
    // yet — matched by exact email (case-insensitive). A suggestion only;
    // linking still requires the admin to confirm it in the New User modal.
    let suggestionByAuthEmail = new Map<string, { id: string; name: string }>()
    if (orphanAuthUsers.length) {
      const { data: emailedEmployees } = await admin.schema('production' as any)
        .from('employees').select('id,name,display_name,email').not('email', 'is', null)
      suggestionByAuthEmail = new Map(
        (emailedEmployees ?? [])
          .filter((e: any) => e.email)
          .map((e: any) => [String(e.email).trim().toLowerCase(), { id: e.id, name: e.display_name || e.name }])
      )
    }

    const orphans = orphanAuthUsers.map(au => {
      const suggestion = au.email ? suggestionByAuthEmail.get(au.email.trim().toLowerCase()) : null
      return {
        id:              au.id,
        display_name:    au.user_metadata?.full_name || au.email?.split('@')[0] || '—',
        email:           au.email ?? '—',
        email_confirmed: !!au.email_confirmed_at,
        department:      null,
        role:            null,
        section_id:      null,
        permissions:     {},
        is_active:       true,
        created_at:      au.created_at,
        last_sign_in:    au.last_sign_in_at ?? null,
        no_role:         true,
        employee_id:     null,
        employee_name:   null,
        suggested_employee: suggestion ?? null,
      }
    })

    return NextResponse.json([...result, ...orphans])
  } catch (err: any) {
    console.error('[api/admin/users GET] unhandled exception:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── POST — create a new user ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_manage_users'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    const { email, full_name, department, role, section_id, send_invite, employee_id } = body

    if (!email?.trim())      return NextResponse.json({ error: 'Email is required' },      { status: 400 })
    if (!full_name?.trim())  return NextResponse.json({ error: 'Full name is required' },  { status: 400 })
    if (!department?.trim()) return NextResponse.json({ error: 'Department is required' }, { status: 400 })
    if (!role?.trim())       return NextResponse.json({ error: 'Role is required' },       { status: 400 })

    const admin         = getAdminClient()
    const sessionClient = await getSessionClient()
    let userId: string

    if (send_invite) {
      // Send invite email — user sets their own password via the link
      const { data, error } = await admin.auth.admin.inviteUserByEmail(
        email.trim().toLowerCase(),
        {
          data:       { full_name: full_name.trim() },
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
        }
      )
      if (error) {
        console.error('[api/admin/users POST] inviteUserByEmail error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      userId = data.user.id
    } else {
      // Create account directly — supervisor manages the password
      const { data, error } = await admin.auth.admin.createUser({
        email:         email.trim().toLowerCase(),
        password:      body.password || crypto.randomUUID().slice(0, 16),
        email_confirm: true,
        user_metadata: { full_name: full_name.trim() },
      })
      if (error) {
        console.error('[api/admin/users POST] createUser error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      userId = data.user.id
    }

    // Insert role row into shared.app_roles.
    // Must use sessionClient (authenticated role) — service_role lacks PostgREST
    // access to the 'shared' schema (not in Supabase's Exposed schemas list).
    // Upsert — safe whether or not the DB trigger already created a pending row
    const { error: roleErr } = await sessionClient
      .schema('shared' as any)
      .from('app_roles')
      .upsert({
        user_id:     userId,
        full_name:   full_name.trim(),
        department:  department.trim(),
        role:        role.trim().toLowerCase().replace(/\s+/g, '_'),
        section_id:  section_id?.trim() || null,
        permissions: body.permissions ?? {},
        is_active:   true,
        employee_id: employee_id || null,
      }, { onConflict: 'user_id' })

    if (roleErr) {
      console.error('[api/admin/users POST] insert app_roles error:', roleErr)
      return NextResponse.json({ error: roleErr.message }, { status: 500 })
    }

    await writeAudit({
      actorId: caller.userId, action: 'create',
      schema: 'shared', table: 'app_roles', recordId: userId,
      after: { email: email.trim().toLowerCase(), full_name: full_name.trim(), department, role, section_id, employee_id: employee_id || null },
    })

    return NextResponse.json({ success: true, userId })
  } catch (err: any) {
    console.error('[api/admin/users POST] unhandled exception:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

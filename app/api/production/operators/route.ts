// app/api/production/operators/route.ts
// Provision floor-operator login accounts. Mirrors app/api/admin/users:
// service-role admin client creates the auth user; session client writes
// shared.app_roles (service_role can't reach the 'shared' schema).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'
import { newFloorEmail, deriveAuthPassword, FLOOR_OPERATOR_PERMISSIONS } from '@/lib/production/operator-auth'

function canManage(caller: { can: (k: any) => boolean }) {
  return caller.can('can_reset_operator_pin') || caller.can('can_manage_users')
}

function validate(body: any): string | null {
  if (!body?.name?.trim())            return 'Name is required'
  if (!/^\d{4}$/.test(body?.pin ?? '')) return 'PIN must be exactly 4 digits'
  if (!Array.isArray(body?.section_ids) || body.section_ids.length === 0) return 'Assign at least one section'
  return null
}

// ─── POST — create a new operator + hidden auth account ───────────────────────
export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    const bad = validate(body)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })

    const admin   = getAdminClient()
    const session = await getSessionClient()
    const email   = newFloorEmail()
    const display = (body.display_name?.trim() || body.name.trim())

    // 1. Auth user (service role)
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password:      deriveAuthPassword(body.pin, email),
      email_confirm: true,
      user_metadata: { full_name: display, floor_operator: true },
    })
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })
    const userId = created.user.id

    // 2. Operator record (production schema — admin bypasses RLS)
    const { data: opRow, error: opErr } = await admin.schema('production').from('operators').insert({
      user_id:       userId,
      auth_email:    email,
      name:          body.name.trim(),
      display_name:  display,
      operator_code: body.operator_code?.trim() || null,
      role:          body.role === 'production_supervisor' ? 'production_supervisor' : 'floor_operator',
      section_ids:   body.section_ids,
      pin:           body.pin,
      active:        body.active !== false,
    } as any).select('id').single()
    if (opErr) {
      await admin.auth.admin.deleteUser(userId).catch(() => {})
      return NextResponse.json({ error: opErr.message }, { status: 500 })
    }

    // 3. app_roles (session client — caller already verified)
    const { error: roleErr } = await session.schema('shared' as any).from('app_roles').upsert({
      user_id:     userId,
      full_name:   display,
      department:  'Production',
      role:        'floor_operator',
      section_id:  body.section_ids[0] ?? null,
      permissions: FLOOR_OPERATOR_PERMISSIONS,
      is_active:   body.active !== false,
    }, { onConflict: 'user_id' })
    if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 })

    return NextResponse.json({ success: true, id: (opRow as any).id, userId })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// ─── PATCH — update an existing operator (incl. PIN change) ───────────────────
export async function PATCH(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!canManage(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const body = await req.json()
    if (!body?.id) return NextResponse.json({ error: 'Operator id is required' }, { status: 400 })
    const bad = validate(body)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })

    const admin   = getAdminClient()
    const session = await getSessionClient()
    const display = (body.display_name?.trim() || body.name.trim())

    const { data: existing } = await admin.schema('production').from('operators')
      .select('user_id, auth_email').eq('id', body.id).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Operator not found' }, { status: 404 })

    let userId    = (existing as any).user_id as string | null
    let authEmail = (existing as any).auth_email as string | null

    // Legacy operator (seeded by SQL) with no auth account yet — create one now.
    if (!userId) {
      authEmail = newFloorEmail()
      const { data: created, error: authErr } = await admin.auth.admin.createUser({
        email: authEmail, password: deriveAuthPassword(body.pin, authEmail),
        email_confirm: true, user_metadata: { full_name: display, floor_operator: true },
      })
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })
      userId = created.user.id
    } else {
      // Update password to match the (possibly new) PIN
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
        password: deriveAuthPassword(body.pin, authEmail!),
        user_metadata: { full_name: display, floor_operator: true },
      })
      if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
    }

    const { error: opErr } = await admin.schema('production').from('operators').update({
      user_id:       userId,
      auth_email:    authEmail,
      name:          body.name.trim(),
      display_name:  display,
      operator_code: body.operator_code?.trim() || null,
      role:          body.role === 'production_supervisor' ? 'production_supervisor' : 'floor_operator',
      section_ids:   body.section_ids,
      pin:           body.pin,
      active:        body.active !== false,
    } as any).eq('id', body.id)
    if (opErr) return NextResponse.json({ error: opErr.message }, { status: 500 })

    const { error: roleErr } = await session.schema('shared' as any).from('app_roles').upsert({
      user_id:     userId,
      full_name:   display,
      department:  'Production',
      role:        'floor_operator',
      section_id:  body.section_ids[0] ?? null,
      permissions: FLOOR_OPERATOR_PERMISSIONS,
      is_active:   body.active !== false,
    }, { onConflict: 'user_id' })
    if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 })

    return NextResponse.json({ success: true, userId })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

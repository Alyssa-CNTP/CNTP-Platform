// app/api/staff/identities/route.ts
// GET — bulk identities lookup for the Staff Directory LIST view (one call for
// every person instead of N+1 against app/api/staff/[id]/identities).
//
// Same visibility rule as the per-employee route: login email/role is only
// returned to IT / can_manage_users. Everyone else who can see the list gets
// a has_login flag only.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

function isMissingColumnError(error: { code?: string } | null | undefined) {
  return error?.code === '42703'
}

// True only for genuine Microsoft SSO accounts (Azure AD). Supabase
// email/password accounts — including the PIN-based lab/floor logins that use a
// synthetic email — are NOT SSO and must not get the Microsoft badge.
export function isMicrosoftSSO(user: any): boolean {
  const provider  = user?.app_metadata?.provider
  const providers = user?.app_metadata?.providers
  const identities = user?.identities
  return provider === 'azure'
    || (Array.isArray(providers) && providers.includes('azure'))
    || (Array.isArray(identities) && identities.some((i: any) => i?.provider === 'azure'))
}

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId)
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const canSeePeopleOps =
    caller.can('can_view_staff') || caller.can('can_edit_staff_profiles') ||
    caller.can('can_reset_operator_pin') || caller.can('can_manage_users')
  if (!canSeePeopleOps)
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const admin = getAdminClient()
  const isIT  = caller.department === 'IT' || caller.can('can_manage_users')

  const { data: ops, error: opErr } = await (admin as any)
    .schema('production').from('operators')
    .select('employee_id,operator_code,active')
    .not('employee_id', 'is', null)
  const operators: Record<string, { operator_code: string | null; active: boolean }> = {}
  if (!isMissingColumnError(opErr)) {
    for (const o of ops ?? []) operators[o.employee_id] = { operator_code: o.operator_code, active: o.active }
  }

  // Lab/QC PIN sign-ins linked to a person (qms.lab_auth.employee_id) — surfaced
  // as a PIN on the directory so a lab PIN reads as one identity on the profile.
  const { data: labRows, error: labErr } = await (admin as any)
    .schema('qms').from('lab_auth')
    .select('employee_id, active')
    .not('employee_id', 'is', null)
  const labPins: Record<string, { active: boolean }> = {}
  if (!isMissingColumnError(labErr)) {
    for (const l of labRows ?? []) labPins[l.employee_id] = { active: l.active !== false }
  }

  const { data: roles, error: roleErr } = await (admin as any)
    .schema('shared').from('app_roles')
    .select('employee_id,user_id,is_active,role')
    .not('employee_id', 'is', null)

  const logins: Record<string, { has_login: true; is_active: boolean; sso: boolean; email?: string | null; role?: string | null }> = {}
  if (!isMissingColumnError(roleErr) && (roles ?? []).length > 0) {
    // We need the auth provider for every linked login (to tell genuine
    // Microsoft SSO from supabase password/PIN accounts), so always list users
    // here — email is still only surfaced to IT.
    const { data: listResult } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const emailByUserId = new Map((listResult?.users ?? []).map(u => [u.id, u.email ?? null]))
    const ssoByUserId   = new Map((listResult?.users ?? []).map(u => [u.id, isMicrosoftSSO(u)]))
    for (const r of roles as any[]) {
      logins[r.employee_id] = {
        has_login: true,
        is_active: r.is_active,
        sso: ssoByUserId.get(r.user_id) ?? false,
        ...(isIT ? { email: emailByUserId.get(r.user_id) ?? null, role: r.role } : {}),
      }
    }
  }

  return NextResponse.json({
    operators, labPins, logins,
    linksAvailable: !isMissingColumnError(opErr) && !isMissingColumnError(roleErr),
  })
}

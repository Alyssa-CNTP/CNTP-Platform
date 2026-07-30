// app/api/staff/[id]/link-login/route.ts
// Manually link (or unlink) an existing login account to a Staff Directory
// person — IT / can_manage_users only. Nothing auto-links; the GET just
// SUGGESTS the likely name match for a one-click confirm.
//
//   GET  → unlinked, active login accounts (app_roles.employee_id IS NULL),
//          each flagged `suggested` when its name matches this person.
//   POST { user_id }           → set app_roles.employee_id = this person
//   POST { user_id, unlink:true } → clear the link

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { isMicrosoftSSO } from '@/app/api/staff/identities/route'

function canLink(caller: any): boolean {
  return caller.department === 'IT' || caller.can?.('can_manage_users') || caller.role === 'senior_developer'
}
const norm = (n: string | null | undefined) => (n ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!canLink(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const admin = getAdminClient()
  const { data: emp } = await (admin as any).schema('production').from('employees')
    .select('name, display_name').eq('id', id).maybeSingle()
  const empNames = [emp?.name, emp?.display_name].filter(Boolean).map(norm)

  const { data: roles } = await (admin as any).schema('shared').from('app_roles')
    .select('user_id, full_name, role, department, is_active, employee_id')
    .is('employee_id', null)
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailBy = new Map((list?.users ?? []).map(u => [u.id, u.email ?? null]))
  const ssoBy   = new Map((list?.users ?? []).map(u => [u.id, isMicrosoftSSO(u)]))

  const candidates = (roles ?? [])
    .filter((r: any) => r.is_active !== false)
    .map((r: any) => ({
      user_id:   r.user_id,
      full_name: r.full_name || null,
      role:      r.role || null,
      department:r.department || null,
      email:     emailBy.get(r.user_id) ?? null,
      sso:       ssoBy.get(r.user_id) ?? false,
      suggested: !!r.full_name && empNames.includes(norm(r.full_name)),
    }))
    .sort((a: any, b: any) =>
      (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0) ||
      (a.full_name || 'zzz').localeCompare(b.full_name || 'zzz'))

  return NextResponse.json({ candidates })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!canLink(caller)) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const userId = String(body?.user_id ?? '')
  const unlink = !!body?.unlink
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const admin = getAdminClient()
  const { error } = await (admin as any).schema('shared').from('app_roles')
    .update({ employee_id: unlink ? null : id })
    .eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

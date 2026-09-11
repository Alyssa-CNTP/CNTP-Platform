// lib/notifications/recipients.ts
// Resolve a set of user ids → { userId, name, email, phone } for notify().
// Email comes from auth.users (admin API); name + phone from shared.app_roles.
//
// EVERY read here uses the ADMIN client, and that is load-bearing rather than
// convenience. `shared.app_roles` has RLS that shows a normal user exactly ONE
// row — their own (`own_role_read: auth.uid() = user_id`); the whole table is
// only visible to admin / IT / `can_manage_users`. These helpers answer "who
// should be told about this", which is a decision the SERVER makes on the
// caller's behalf — it is not a query into what the caller may see.
//
// Read through a session client, they silently returned an EMPTY list for
// exactly the people who trigger the notifications: a technician finishing work
// could not see the Quality department, so `getQualityUserIds()` came back
// empty and the lab was never told a job card was waiting for QC sign-off. It
// failed silently because "no recipients" is indistinguishable from "nobody to
// tell". Evidence: not one qc_check notification existed in shared.notifications
// while four cards sat in the qc_check queue.
//
// service_role holds BYPASSRLS and `shared` is exposed to PostgREST (notify()
// already writes shared.notifications through the same client), so this reads
// the full directory. An earlier comment here claimed service_role had no
// PostgREST access to `shared` — that was wrong, and it is what pushed these
// reads onto the session client in the first place.

import { getAdminClient } from '@/lib/auth/server-helpers'
import type { Recipient } from './index'
import { resolvePermission, rosterPerm, type RosterSectionKey, type Permissions } from '@/lib/auth/permissions'

export async function resolveRecipients(userIds: string[]): Promise<Recipient[]> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (ids.length === 0) return []

  const admin = getAdminClient()

  const [{ data: roles }, list] = await Promise.all([
    admin.schema('shared' as any).from('app_roles')
      .select('user_id, full_name, phone').in('user_id', ids),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const roleMap = new Map((roles ?? []).map((r: any) => [r.user_id, r]))
  const authMap = new Map((list.data?.users ?? []).map(u => [u.id, u]))

  return ids.map(id => {
    const r  = roleMap.get(id)
    const au = authMap.get(id)
    return {
      userId: id,
      name:   r?.full_name || au?.user_metadata?.full_name || au?.email?.split('@')[0] || null,
      email:  au?.email ?? null,
      phone:  r?.phone ?? null,
    }
  })
}

/** User ids of the maintenance manager(s) — informed of new/breakdown cards. */
export async function getMaintenanceManagerIds(): Promise<string[]> {
  const admin = getAdminClient()
  const { data } = await admin.schema('shared' as any).from('app_roles')
    .select('user_id').eq('department', 'Maintenance').eq('role', 'maintenance_manager')
  return (data ?? []).map((r: any) => r.user_id).filter(Boolean)
}

/** User ids of production supervisors — informed of operator line messages so
 *  they're aware when reviewing a production order. 'supervisor' is the
 *  legacy value for 'production_supervisor' (pre-rename accounts), same
 *  alias `isProductionSupervisor()` in lib/auth/context.tsx accepts. */
export async function getProductionSupervisorIds(): Promise<string[]> {
  const admin = getAdminClient()
  const { data } = await admin.schema('shared' as any).from('app_roles')
    .select('user_id, is_active').in('role', ['production_supervisor', 'supervisor'])
  return (data ?? []).filter((r: any) => r.is_active !== false).map((r: any) => r.user_id).filter(Boolean)
}

/** User ids of production managers — decide a supervisor's "reopen this PO"
 *  request from the Supervisor Hub. */
export async function getProductionManagerIds(): Promise<string[]> {
  const admin = getAdminClient()
  const { data } = await admin.schema('shared' as any).from('app_roles')
    .select('user_id, is_active').eq('role', 'production_manager')
  return (data ?? []).filter((r: any) => r.is_active !== false).map((r: any) => r.user_id).filter(Boolean)
}

/** User ids of active IT staff — the other approver of a reopen request
 *  alongside the production manager. */
export async function getITUserIds(): Promise<string[]> {
  const admin = getAdminClient()
  const { data } = await admin.schema('shared' as any).from('app_roles')
    .select('user_id, is_active').eq('department', 'IT')
  return (data ?? []).filter((r: any) => r.is_active !== false).map((r: any) => r.user_id).filter(Boolean)
}

/** User ids of Quality staff — notified to run a post-maintenance QC check.
 *  Used by the maintenance → quality QC hand-off (the Quality dashboard surfaces it). */
export async function getQualityUserIds(): Promise<string[]> {
  const admin = getAdminClient()
  const { data } = await admin.schema('shared' as any).from('app_roles')
    .select('user_id, is_active').eq('department', 'Quality')
  return (data ?? []).filter((r: any) => r.is_active !== false).map((r: any) => r.user_id).filter(Boolean)
}

/** User ids eligible to manage AXIS tickets — IT department, or anyone holding
 *  can_assign_tickets (role default or explicit override). Replaces the old
 *  hardcoded 'Alyssa'/'Jan'/'Gustav' name lookups so this stays correct as
 *  roles/staff change. Used to notify on new unassigned tickets. */
export async function getTicketManagerIds(): Promise<string[]> {
  const admin = getAdminClient()
  const { data } = await admin.schema('shared' as any).from('app_roles')
    .select('user_id, department, role, permissions, is_active')
  return (data ?? [])
    .filter((r: any) => r.is_active !== false)
    .filter((r: any) =>
      r.department === 'IT' ||
      resolvePermission((r.role ?? null) as string | null, (r.permissions ?? {}) as Permissions, 'can_assign_tickets')
    )
    .map((r: any) => r.user_id)
    .filter(Boolean)
}

/**
 * User ids who may SUBMIT the given roster section — i.e. hold
 * can_submit_roster_<section>, resolved from role defaults + per-user overrides.
 * This is the "not hardcoded" recipient list for the Wednesday reminder: it is
 * derived entirely from the permission toggles set on the Users & Roles page.
 *
 * Reads via the public.roster_submitter_candidates() SECURITY DEFINER function,
 * which resolves role defaults + per-user overrides in one place. It works for
 * authenticated callers and for the unattended cron alike.
 */
export async function getRosterSubmitterIds(section: RosterSectionKey): Promise<string[]> {
  const admin = getAdminClient()
  const { data, error } = await (admin as any).rpc('roster_submitter_candidates')
  if (error) { console.error('[recipients] roster_submitter_candidates rpc failed:', error.message); return [] }
  const key = rosterPerm('submit', section)
  return (data ?? [])
    .filter((r: any) => r.is_active !== false)
    .filter((r: any) => resolvePermission((r.role ?? null) as string | null, (r.permissions ?? {}) as Permissions, key))
    .map((r: any) => r.user_id)
    .filter(Boolean)
}

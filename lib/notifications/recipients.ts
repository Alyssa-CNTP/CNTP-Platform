// lib/notifications/recipients.ts
// Resolve a set of user ids → { userId, name, email, phone } for notify().
// Email comes from auth.users (admin API); name + phone from shared.app_roles
// (session client — service_role has no PostgREST access to `shared`).

import { getSessionClient, getAdminClient } from '@/lib/auth/server-helpers'
import type { Recipient } from './index'

export async function resolveRecipients(userIds: string[]): Promise<Recipient[]> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (ids.length === 0) return []

  const session = await getSessionClient()
  const admin   = getAdminClient()

  const [{ data: roles }, list] = await Promise.all([
    session.schema('shared' as any).from('app_roles')
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
  const session = await getSessionClient()
  const { data } = await session.schema('shared' as any).from('app_roles')
    .select('user_id').eq('department', 'Maintenance').eq('role', 'maintenance_manager')
  return (data ?? []).map((r: any) => r.user_id).filter(Boolean)
}

/** User ids of Quality staff — notified to run a post-maintenance QC check.
 *  Used by the maintenance → quality QC hand-off (the Quality dashboard surfaces it). */
export async function getQualityUserIds(): Promise<string[]> {
  const session = await getSessionClient()
  const { data } = await session.schema('shared' as any).from('app_roles')
    .select('user_id, is_active').eq('department', 'Quality')
  return (data ?? []).filter((r: any) => r.is_active !== false).map((r: any) => r.user_id).filter(Boolean)
}

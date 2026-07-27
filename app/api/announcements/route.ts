import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

// Publish a management announcement AND fan it out into the unified feed
// (shared.notifications) so it lands in every targeted user's bell. Publishing
// must be server-side: shared.notifications RLS only lets a user write their
// OWN rows, so fan-out to others goes through notify() (service_role).
export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const canCompose = caller.role === 'senior_developer' || caller.department === 'Management' || caller.department === 'IT'
  if (!canCompose) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const title = String(body?.title ?? '').trim()
  const text  = String(body?.body ?? '').trim()
  const fromName = String(body?.fromName ?? '').trim() || null
  const targetDepartments: string[] = Array.isArray(body?.targetDepartments) ? body.targetDepartments : []
  const pinned = !!body?.pinned
  if (!title) return NextResponse.json({ error: 'A title is required' }, { status: 400 })

  const admin = getAdminClient() as any

  // 1) Keep the Management board record (the durable archive, read-tracked there).
  const { data: ann, error: aErr } = await admin.from('management_announcements').insert({
    title, body: text, from_user_id: caller.userId, from_name: fromName,
    target_departments: targetDepartments, pinned,
  }).select('id').single()
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  // 2) Fan out into the unified feed. Target the chosen departments, or everyone
  //    when no department is specified. Best-effort — the board record is saved
  //    either way.
  try {
    const session = await getSessionClient()
    const { data: roles } = await session.schema('shared' as any).from('app_roles')
      .select('user_id, department, is_active')
    const ids = (roles ?? [])
      .filter((r: any) => r.is_active !== false)
      .filter((r: any) => targetDepartments.length === 0 || targetDepartments.includes(r.department))
      .map((r: any) => r.user_id)
      .filter((id: string) => id && id !== caller.userId)   // don't notify the author
    if (ids.length) {
      const recipients = await resolveRecipients(ids)
      await notify({
        recipients, source: 'announcement', kind: 'announcement',
        title, body: text || title, fromName, url: '/management',
        channels: ['inApp'],
      })
    }
  } catch (e: any) {
    console.error('[api/announcements] fan-out failed:', e?.message)
  }

  return NextResponse.json({ ok: true, id: ann.id })
}

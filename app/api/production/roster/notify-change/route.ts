import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients, getRosterSubmitterIds } from '@/lib/notifications/recipients'

// A supervisor saved a change to the Production roster section. Notify whoever
// signs it off (holds can_submit_roster_production — the production manager) so
// they can review and approve via the existing "Submit Production". Lands in the
// unified feed (shared.notifications) → realtime pop-up. The editor is filtered
// out, so a manager editing their own section doesn't ping themselves.
export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const periodId   = String(body?.periodId ?? '').trim()
  const periodName = body?.periodName ? String(body.periodName) : null
  const section    = String(body?.section ?? 'production')
  // Signed-in user (server-verified), not a client-supplied name.
  const actorName  = caller.name || (body?.actorName ? String(body.actorName) : 'A supervisor')
  const changes: string[] = Array.isArray(body?.changes) ? body.changes.map((c: any) => String(c)) : []
  if (!periodId || changes.length === 0) return NextResponse.json({ ok: true, skipped: 'nothing to notify' })

  const submitterIds = (await getRosterSubmitterIds(section as any)).filter(id => id !== caller.userId)
  if (submitterIds.length === 0) return NextResponse.json({ ok: true, recipients: 0 })

  const shown = changes.slice(0, 8)
  const extra = changes.length - shown.length
  const bodyText =
    `${actorName} changed the Production roster${periodName ? ` (${periodName})` : ''}:\n` +
    shown.join('\n') + (extra > 0 ? `\n+${extra} more` : '') +
    `\n\nReview and Submit Production to approve.`

  const recipients = await resolveRecipients(submitterIds)
  const res = await notify({
    recipients, source: 'roster', kind: 'roster_change',
    title: 'Production roster changed — needs sign-off',
    body: bodyText, url: '/production/roster',
    rosterPeriodId: periodId, rosterSection: section,
    channels: ['inApp'],
  })
  return NextResponse.json({ ok: true, recipients: recipients.length, inApp: res.inApp })
}

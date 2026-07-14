// lib/notifications/index.ts
// One server-side entry point for sending a notification across channels.
// Each channel is best-effort and isolated — one failing never throws to the
// caller or blocks the others. Server-only (uses the service-role client).

import { getAdminClient } from '@/lib/auth/server-helpers'
import { sendEmail, ctaEmail } from './email'
import { sendUrgent } from './urgent'

export type NotificationChannel = 'inApp' | 'email' | 'urgent'

export interface Recipient {
  userId: string
  name?:  string | null
  email?: string | null
  phone?: string | null
}

export interface NotifyInput {
  recipients: Recipient[]
  kind:       string            // assignment | breakdown | mention | qc_bounce | verify_bounce
  title:      string            // short headline
  body:       string            // plain-text detail
  cardId?:    number | null
  url?:       string            // deep link, e.g. /maintenance/job-cards/123
  urgent?:    boolean
  channels?:  NotificationChannel[]   // default ['inApp']
  // Roster-reminder linkage: lets a DB trigger auto-dismiss the in-app
  // notification once this (period, section) is submitted. See
  // production.dismiss_roster_reminders() in the roster migrations.
  rosterPeriodId?: string | null
  rosterSection?:  string | null
}

// Per-user channel opt-outs from shared.user_preferences.notifications.
// A channel is delivered unless the user has explicitly set it to false.
// In-app is never muted here — it is the canonical feed.
async function getChannelOptOuts(userIds: string[]): Promise<Map<string, { email?: boolean; urgent?: boolean }>> {
  const map = new Map<string, { email?: boolean; urgent?: boolean }>()
  if (userIds.length === 0) return map
  try {
    const admin = getAdminClient()
    const { data } = await (admin as any)
      .schema('shared')
      .from('user_preferences')
      .select('user_id, notifications')
      .in('user_id', userIds)
    for (const row of (data ?? [])) {
      map.set(row.user_id, (row.notifications ?? {}) as { email?: boolean; urgent?: boolean })
    }
  } catch (e: any) {
    // Best-effort: if prefs can't be read, default to delivering (fail open).
    console.error('[notifications] prefs read failed:', e?.message)
  }
  return map
}

export async function notify(input: NotifyInput): Promise<{ inApp: number; email: number; urgent: number }> {
  const channels = input.channels ?? ['inApp']
  const recipients = input.recipients.filter(r => r?.userId)
  const result = { inApp: 0, email: 0, urgent: 0 }
  if (recipients.length === 0) return result

  // Resolve channel opt-outs once, only if a mutable channel is in play.
  const needsPrefs = channels.includes('email') || channels.includes('urgent')
  const optOuts = needsPrefs ? await getChannelOptOuts(recipients.map(r => r.userId)) : new Map()
  const wants = (userId: string, channel: 'email' | 'urgent') => optOuts.get(userId)?.[channel] !== false

  // ── In-app feed (service_role bypasses RLS to write for other users) ──
  if (channels.includes('inApp')) {
    try {
      const admin = getAdminClient()
      const rows = recipients.map(r => ({
        user_id: r.userId,
        kind:    input.kind,
        title:   input.title,
        body:    input.body,
        card_id: input.cardId ?? null,
        url:     input.url ?? null,
        urgent:  !!input.urgent,
        roster_period_id: input.rosterPeriodId ?? null,
        roster_section:   input.rosterSection ?? null,
      }))
      const { error } = await admin.schema('maintenance' as any).from('notifications').insert(rows)
      if (error) console.error('[notifications] in-app insert failed:', error.message)
      else result.inApp = rows.length
    } catch (e: any) {
      console.error('[notifications] in-app exception:', e?.message)
    }
  }

  // ── Email ──
  if (channels.includes('email')) {
    const html = ctaEmail({
      heading:  input.title,
      intro:    input.body,
      ctaLabel: 'Open the app',
      ctaPath:  input.url ?? '/maintenance',
      footnote: 'Sign in to the CNTP Platform to view the details.',
    })
    await Promise.all(
      recipients.filter(r => r.email && wants(r.userId, 'email')).map(async r => {
        const res = await sendEmail({ to: r.email!, subject: input.title, html })
        if (res.ok && !res.skipped) result.email++
      })
    )
  }

  // ── Urgent WhatsApp / SMS ──
  if (channels.includes('urgent')) {
    const text = `${input.title}\n${input.body}`
    await Promise.all(
      recipients.filter(r => r.phone && wants(r.userId, 'urgent')).map(async r => {
        const res = await sendUrgent({ to: r.phone!, body: text })
        if (res.ok && !res.skipped) result.urgent++
      })
    )
  }

  return result
}

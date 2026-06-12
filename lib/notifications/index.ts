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
}

export async function notify(input: NotifyInput): Promise<{ inApp: number; email: number; urgent: number }> {
  const channels = input.channels ?? ['inApp']
  const recipients = input.recipients.filter(r => r?.userId)
  const result = { inApp: 0, email: 0, urgent: 0 }
  if (recipients.length === 0) return result

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
      recipients.filter(r => r.email).map(async r => {
        const res = await sendEmail({ to: r.email!, subject: input.title, html })
        if (res.ok && !res.skipped) result.email++
      })
    )
  }

  // ── Urgent WhatsApp / SMS ──
  if (channels.includes('urgent')) {
    const text = `${input.title}\n${input.body}`
    await Promise.all(
      recipients.filter(r => r.phone).map(async r => {
        const res = await sendUrgent({ to: r.phone!, body: text })
        if (res.ok && !res.skipped) result.urgent++
      })
    )
  }

  return result
}

// app/api/production/roster/notify-test/route.ts
//
// Admin-only self-test for the roster reminder notification pipeline. Sends a
// real test notification (in-app + email + WhatsApp) to the CALLING admin's
// own resolved contact info, and reports exactly what happened per channel —
// not just "sent", but whether a channel is configured at all, and the raw
// provider error if a send was attempted but failed. This is what answers
// "does this actually work right now" without waiting for the Mon/Wed cron
// or touching real roster data.
//
// Auth: full admin only (role === 'senior_developer').

import { NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { resolveRecipients } from '@/lib/notifications/recipients'
import { notify } from '@/lib/notifications'
import { sendEmail, ctaEmail } from '@/lib/notifications/email'
import { sendUrgent } from '@/lib/notifications/urgent'

export async function POST() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.role !== 'senior_developer')
    return NextResponse.json({ error: 'Access restricted to full admins' }, { status: 403 })

  const [me] = await resolveRecipients([caller.userId])
  if (!me) return NextResponse.json({ error: 'Could not resolve your own contact info' }, { status: 500 })

  const now = new Date().toISOString()
  const title = 'CNTP Platform — test notification'
  const body  = `This is a manual test of the roster reminder pipeline, triggered by you at ${now}. If this arrived, that channel is working.`

  // In-app — reuse notify() since there's nothing to diagnose beyond ok/fail.
  const inAppResult = await notify({ recipients: [me], kind: 'roster_reminder_test', title, body, channels: ['inApp'] })

  // Email + WhatsApp — call the senders directly (bypassing notify()'s count-only
  // aggregation) so the real skipped/ok/error detail reaches the response.
  const smtpConfigured     = !!process.env.SMTP_USER && !!process.env.SMTP_PASS
  const whatsappProvider   = (process.env.WHATSAPP_PROVIDER ?? '').toLowerCase() || null
  const whatsappConfigured = whatsappProvider === 'meta'
    ? !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID
    : whatsappProvider === 'twilio'
    ? !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_WHATSAPP_FROM
    : false

  const emailResult = me.email
    ? await sendEmail({ to: me.email, subject: title, html: ctaEmail({ heading: title, intro: body, ctaLabel: 'Open the app', ctaPath: '/production/roster' }) })
    : { ok: false, skipped: true, error: 'No email on file for you' }

  const whatsappResult = me.phone
    ? await sendUrgent({ to: me.phone, body: `${title}\n${body}` })
    : { ok: false, skipped: true, error: 'No phone number on file for you (shared.app_roles.phone) — add one to test WhatsApp' }

  return NextResponse.json({
    recipient: { name: me.name, email: me.email, phone: me.phone },
    config: { smtpConfigured, whatsappProvider, whatsappConfigured },
    inApp:    { ok: inAppResult.inApp > 0 },
    email:    emailResult,
    whatsapp: whatsappResult,
  })
}

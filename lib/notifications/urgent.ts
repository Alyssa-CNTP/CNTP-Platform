// lib/notifications/urgent.ts
// Urgent reach for breakdowns: WhatsApp / SMS. Provider-agnostic.
//
// Degrades gracefully exactly like email: if no provider is configured it logs
// + skips (never throws), so the rest of the maintenance flow ships without the
// WhatsApp/SMS decision being made. Configure via env:
//
//   WHATSAPP_PROVIDER = 'meta' | 'twilio'        (unset → skipped)
//   Meta WhatsApp Cloud API:
//     WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE (optional, default 'breakdown_alert')
//   Twilio:
//     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (e.g. 'whatsapp:+14155238886')
//
// NOTE: business-initiated WhatsApp messages require an approved template; the
// free-text `body` below is used as the template body parameter / SMS text.

export interface UrgentMessage {
  to:   string          // recipient phone in E.164, e.g. +27821234567
  body: string
}

type UrgentResult = { ok: boolean; skipped?: boolean; error?: string }

export async function sendUrgent(msg: UrgentMessage): Promise<UrgentResult> {
  const provider = (process.env.WHATSAPP_PROVIDER ?? '').toLowerCase()
  const to = msg.to?.trim()
  if (!provider) {
    console.warn('[notifications/urgent] WHATSAPP_PROVIDER not set — skipping urgent message')
    return { ok: true, skipped: true }
  }
  if (!to) return { ok: true, skipped: true }

  try {
    if (provider === 'meta')   return await sendMeta(to, msg.body)
    if (provider === 'twilio') return await sendTwilio(to, msg.body)
    console.warn(`[notifications/urgent] unknown WHATSAPP_PROVIDER "${provider}" — skipping`)
    return { ok: true, skipped: true }
  } catch (err: any) {
    console.error('[notifications/urgent] send failed:', err?.message)
    return { ok: false, error: err?.message }
  }
}

async function sendMeta(to: string, body: string): Promise<UrgentResult> {
  const token   = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) {
    console.warn('[notifications/urgent] Meta WHATSAPP_TOKEN / WHATSAPP_PHONE_ID not set — skipping')
    return { ok: true, skipped: true }
  }
  const template = process.env.WHATSAPP_TEMPLATE || 'breakdown_alert'
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: body.slice(0, 1000) }] }],
      },
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message ?? `Meta WhatsApp error ${res.status}`)
  }
  return { ok: true }
}

async function sendTwilio(to: string, body: string): Promise<UrgentResult> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_WHATSAPP_FROM
  if (!sid || !token || !from) {
    console.warn('[notifications/urgent] Twilio creds not set — skipping')
    return { ok: true, skipped: true }
  }
  const form = new URLSearchParams({
    To:   from.startsWith('whatsapp:') ? `whatsapp:${to}` : to,
    From: from,
    Body: body.slice(0, 1500),
  })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method:  'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.message ?? `Twilio error ${res.status}`)
  }
  return { ok: true }
}

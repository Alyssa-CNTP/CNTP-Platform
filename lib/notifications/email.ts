// lib/notifications/email.ts
// Shared SMTP sender (Office365 via nodemailer). Lifted from
// app/api/auth/notify-new-user/route.ts so every feature can reuse one transport.
// Degrades gracefully: if SMTP_USER / SMTP_PASS are unset it logs + skips rather
// than throwing, so callers never break when email isn't configured.

import nodemailer from 'nodemailer'

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cntpplatform-staging.rooibostea.co.za'

export interface EmailMessage {
  to:       string | string[]
  subject:  string
  html:     string
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS
  if (!smtpUser || !smtpPass) {
    console.warn('[notifications/email] SMTP_USER / SMTP_PASS not set — skipping email')
    return { ok: true, skipped: true }
  }
  const recipients = (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => e.trim()).filter(Boolean)
  if (recipients.length === 0) return { ok: true, skipped: true }

  try {
    const transport = nodemailer.createTransport({
      host:   process.env.SMTP_HOST ?? 'smtp.office365.com',
      port:   Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth:   { user: smtpUser, pass: smtpPass },
      tls:    { ciphers: 'SSLv3' },
    })
    await transport.sendMail({
      from:    `"CNTP Platform" <${smtpUser}>`,
      to:      recipients.join(', '),
      subject: msg.subject,
      html:    msg.html,
    })
    return { ok: true }
  } catch (err: any) {
    console.error('[notifications/email] send failed:', err?.message)
    return { ok: false, error: err?.message }
  }
}

/** Brand-wrapped HTML body with a single call-to-action button. */
export function ctaEmail(opts: { heading: string; intro: string; ctaLabel: string; ctaPath: string; footnote?: string }): string {
  const url = `${APP_URL}${opts.ctaPath}`
  return `
    <div style="font-family: Inter, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1A2415;">
      <div style="margin-bottom: 24px;">
        <img src="${APP_URL}/logo.png" width="56" height="56" alt="Cape Natural" style="border-radius: 8px;" />
      </div>
      <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 700;">${opts.heading}</h2>
      <p style="margin: 0 0 24px; font-size: 15px; color: #4B5563; line-height: 1.6;">${opts.intro}</p>
      <a href="${url}" style="display: inline-block; padding: 12px 24px; background: #1A3A0E; color: #fff; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none;">
        ${opts.ctaLabel} &rarr;
      </a>
      ${opts.footnote ? `<p style="margin: 24px 0 0; font-size: 13px; color: #6B7280; line-height: 1.6;">${opts.footnote}</p>` : ''}
      <p style="margin: 32px 0 0; font-size: 12px; color: #9CA3AF;">Cape Natural Tea Products · CNTP Operations Platform</p>
    </div>`
}

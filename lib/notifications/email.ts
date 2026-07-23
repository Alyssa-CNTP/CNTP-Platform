// lib/notifications/email.ts
// Shared transactional email sender. Two transports, chosen at runtime:
//
//   1. Microsoft Graph (preferred) — app-only client-credentials flow, sends via
//      POST /users/{sender}/sendMail. This is Microsoft's supported path for
//      Microsoft 365 and does NOT depend on basic SMTP AUTH (which M365 disables
//      by default). Configure with GRAPH_TENANT_ID, GRAPH_CLIENT_ID,
//      GRAPH_CLIENT_SECRET, GRAPH_SENDER.
//   2. SMTP (fallback) — Office365 basic auth via nodemailer. Used only if Graph
//      isn't configured but SMTP_USER/SMTP_PASS are.
//
// Degrades gracefully: if neither is configured it logs + skips (returns
// { ok:true, skipped:true }) rather than throwing, so callers never break when
// email isn't set up. See docs/email-graph-setup.md for the Graph runbook.

import nodemailer from 'nodemailer'

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cntpplatform-staging.rooibostea.co.za'

export interface EmailMessage {
  to:       string | string[]
  subject:  string
  html:     string
}

export type EmailResult = { ok: boolean; skipped?: boolean; error?: string; transport?: EmailTransport }
export type EmailTransport = 'graph' | 'smtp' | 'none'

// ── Which transport is configured (also surfaced by the admin self-test) ──────
export function graphConfigured(): boolean {
  return !!process.env.GRAPH_TENANT_ID && !!process.env.GRAPH_CLIENT_ID
    && !!process.env.GRAPH_CLIENT_SECRET && !!graphSender()
}
export function smtpConfigured(): boolean {
  return !!process.env.SMTP_USER && !!process.env.SMTP_PASS
}
export function activeEmailTransport(): EmailTransport {
  if (graphConfigured()) return 'graph'
  if (smtpConfigured())  return 'smtp'
  return 'none'
}

// Sender mailbox for Graph — its own var, falling back to SMTP_USER so a single
// address can drive both transports during a migration.
function graphSender(): string | undefined {
  return process.env.GRAPH_SENDER || process.env.SMTP_USER || undefined
}

// ── Graph client-credentials token (cached in-module until ~1 min before expiry) ─
let cachedToken: { value: string; expiresAt: number } | null = null

async function graphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  const tenant = process.env.GRAPH_TENANT_ID!
  const body = new URLSearchParams({
    client_id:     process.env.GRAPH_CLIENT_ID!,
    client_secret: process.env.GRAPH_CLIENT_SECRET!,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  })
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error_description || json?.error || `token endpoint ${res.status}`)
  const expiresInMs = (Number(json.expires_in) || 3600) * 1000
  cachedToken = { value: json.access_token, expiresAt: Date.now() + expiresInMs - 60_000 }
  return cachedToken.value
}

async function sendViaGraph(recipients: string[], subject: string, html: string): Promise<EmailResult> {
  const sender = graphSender()!
  const token = await graphToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: recipients.map(address => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  })
  if (res.status !== 202) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message ?? `Graph sendMail error ${res.status}`)
  }
  return { ok: true, transport: 'graph' }
}

async function sendViaSmtp(recipients: string[], subject: string, html: string): Promise<EmailResult> {
  const smtpUser = process.env.SMTP_USER!
  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? 'smtp.office365.com',
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth:   { user: smtpUser, pass: process.env.SMTP_PASS! },
    tls:    { ciphers: 'SSLv3' },
  })
  await transport.sendMail({
    from:    `"CNTP Platform" <${smtpUser}>`,
    to:      recipients.join(', '),
    subject,
    html,
  })
  return { ok: true, transport: 'smtp' }
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const recipients = (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => e.trim()).filter(Boolean)
  if (recipients.length === 0) return { ok: true, skipped: true, transport: 'none' }

  const transport = activeEmailTransport()
  if (transport === 'none') {
    console.warn('[notifications/email] no transport configured (Graph or SMTP) — skipping email')
    return { ok: true, skipped: true, transport: 'none' }
  }

  try {
    return transport === 'graph'
      ? await sendViaGraph(recipients, msg.subject, msg.html)
      : await sendViaSmtp(recipients, msg.subject, msg.html)
  } catch (err: any) {
    console.error(`[notifications/email] send failed (${transport}):`, err?.message)
    return { ok: false, error: err?.message, transport }
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

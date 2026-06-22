// app/api/auth/notify-new-user/route.ts
// Called from /auth/callback when a brand-new user signs in via Microsoft OAuth.
// Sends an email to all NOTIFICATION_EMAILS so admins can assign department/role.

import { NextRequest, NextResponse } from 'next/server'
import nodemailer                    from 'nodemailer'
import { createClient }              from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  // Verify the caller is an authenticated Supabase user (not an anonymous hit)
  const authHeader = req.headers.get('authorization') ?? ''
  const token      = authHeader.replace('Bearer ', '').trim()
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user }, error: authErr } = await sb.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, name } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const recipients = (process.env.NOTIFICATION_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
  if (recipients.length === 0) return NextResponse.json({ ok: true, skipped: true })

  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS

  if (!smtpUser || !smtpPass) {
    console.warn('[notify-new-user] SMTP_USER or SMTP_PASS not set — skipping email')
    return NextResponse.json({ ok: true, skipped: true })
  }

  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? 'smtp.office365.com',
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth:   { user: smtpUser, pass: smtpPass },
    tls:    { ciphers: 'SSLv3' },
  })

  const displayName = name || email.split('@')[0]
  const appUrl      = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cntpplatform-staging.rooibostea.co.za'

  const html = `
    <div style="font-family: Inter, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111827;">
      <div style="margin-bottom: 24px;">
        <img src="${appUrl}/logo.png" width="56" height="56" alt="Cape Natural" style="border-radius: 8px;" />
      </div>
      <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #111827;">New user signed in</h2>
      <p style="margin: 0 0 20px; font-size: 15px; color: #4B5563; line-height: 1.6;">
        <strong>${displayName}</strong> (<a href="mailto:${email}" style="color: #16A34A;">${email}</a>)
        just signed in to the CNTP Platform for the first time via Microsoft.
      </p>
      <p style="margin: 0 0 24px; font-size: 14px; color: #6B7280; line-height: 1.6;">
        They don't have a department or role assigned yet. Please log in and assign their access level
        so they can use the platform.
      </p>
      <a href="${appUrl}/users"
        style="display: inline-block; padding: 12px 24px; background: #16A34A; color: #fff; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none;">
        Assign department &amp; role →
      </a>
      <p style="margin: 32px 0 0; font-size: 12px; color: #9CA3AF;">
        Cape Natural Tea Products · CNTP Operations Platform
      </p>
    </div>
  `

  try {
    await transport.sendMail({
      from:    `"CNTP Platform" <${smtpUser}>`,
      to:      recipients.join(', '),
      subject: `New user: ${displayName} needs department assignment`,
      html,
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[notify-new-user] Email send failed:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

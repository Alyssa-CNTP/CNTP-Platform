// app/api/esign/sign/[token]/route.ts
// Public route (no session) — the only two operations an external signer
// (driver/customer, no app account) can perform. Added to PUBLIC_ROUTES in
// app/middleware.ts. GET returns just enough to render app/sign/[token]/page.tsx;
// POST captures the signature. Everything else about the subject stays hidden.

import { NextRequest, NextResponse } from 'next/server'
import { getRequestByToken } from '@/lib/esign/request'
import { submitSignatureByToken } from '@/lib/esign/capture'

function clientIp(req: NextRequest): string | null {
  // nginx's proxy_add_x_forwarded_for appends the real client IP first;
  // take the leftmost entry, fall back to x-real-ip.
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || null
  return req.headers.get('x-real-ip')
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await getRequestByToken(token)

  switch (result.state) {
    case 'not_found': return NextResponse.json({ state: 'not_found' }, { status: 404 })
    case 'expired':   return NextResponse.json({ state: 'expired' }, { status: 410 })
    case 'signed':    return NextResponse.json({ state: 'signed', title: result.title, signerName: result.signerName, signedAt: result.signedAt })
    case 'pending':   return NextResponse.json({ state: 'pending', title: result.title })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const signatureImage: string = body?.signatureImage
  const signerName: string = body?.signerName
  if (!signatureImage || !signerName) {
    return NextResponse.json({ error: 'signatureImage and signerName are required' }, { status: 400 })
  }

  const result = await submitSignatureByToken(token, {
    signatureImage,
    signerName,
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  })

  if (result.ok) return NextResponse.json({ ok: true })

  const statusByCode = { not_found: 404, expired: 410, already_signed: 409, error: 500 } as const
  return NextResponse.json({ error: result.message }, { status: statusByCode[result.code] })
}

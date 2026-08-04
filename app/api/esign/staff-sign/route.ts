// app/api/esign/staff-sign/route.ts
// POST — a logged-in staff member signs a pending request in-app. No image is
// accepted from the client: the signature is always the one already on file
// (production.employee_signatures), resolved server-side — same "Verify &
// Sign" trust model as app/api/production/job-cards/[id]/quality-sign.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { submitStaffSignature } from '@/lib/esign/capture'

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const requestId: string = body?.requestId
  if (!requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 })

  const result = await submitStaffSignature(requestId, caller.userId)
  if (result.ok) return NextResponse.json({ ok: true })

  const statusByCode = { not_found: 404, expired: 410, already_signed: 409, error: 400 } as const
  return NextResponse.json({ error: result.message }, { status: statusByCode[result.code] })
}

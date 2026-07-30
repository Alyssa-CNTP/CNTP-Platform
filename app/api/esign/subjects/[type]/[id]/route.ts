// app/api/esign/subjects/[type]/[id]/route.ts
// GET — full signing history (including voided requests) for one subject.
// Session-gated only (any authenticated user can read — matches esign's RLS:
// SELECT is open to `authenticated`, all real gating happens on writes).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { listRequestsFor } from '@/lib/esign/request'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { type, id } = await params
  const history = await listRequestsFor(type, id)
  return NextResponse.json({ history })
}

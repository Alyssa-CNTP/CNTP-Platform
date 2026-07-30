// app/api/esign/requests/route.ts
// POST — create a signature request (internal or external) against any
// registered subject (see lib/esign/subjects.ts). Session-gated: the caller
// must hold that subject's requestPermission (senior_developer bypasses,
// same convention as getCallerPermissions().can()).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { getSubject } from '@/lib/esign/subjects'
import { createSignatureRequest, type SignerKind } from '@/lib/esign/request'

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const subjectType: string = body?.subjectType
  const subjectId: string = body?.subjectId
  const title: string = body?.title
  const signerKind: SignerKind = body?.signerKind

  if (!subjectType || !subjectId || !title) {
    return NextResponse.json({ error: 'subjectType, subjectId and title are required' }, { status: 400 })
  }
  if (signerKind !== 'internal' && signerKind !== 'external') {
    return NextResponse.json({ error: 'signerKind must be "internal" or "external"' }, { status: 400 })
  }

  const subject = getSubject(subjectType)
  if (!subject) return NextResponse.json({ error: `Unknown subjectType "${subjectType}"` }, { status: 400 })

  const requiredPermission = signerKind === 'external' ? subject.externalPermission : subject.internalPermission
  if (!caller.can(requiredPermission)) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  if (signerKind === 'external' && !body?.signerName) {
    return NextResponse.json({ error: 'signerName is required for an external signer' }, { status: 400 })
  }

  try {
    const created = await createSignatureRequest({
      subjectType, subjectId, title, signerKind,
      createdBy: caller.userId,
      signerUserId: signerKind === 'internal' ? caller.userId : null,
      signerName: body?.signerName ?? null,
      signerContact: body?.signerContact ?? null,
    })
    return NextResponse.json({ ok: true, ...created })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not create signature request' }, { status: 500 })
  }
}

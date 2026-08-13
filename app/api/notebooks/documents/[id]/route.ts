// app/api/notebooks/documents/[id]/route.ts
// GET   — one note with its lines and the signing state of both blocks.
// PATCH — edit a note that is still a draft.
//
// An issued note is closed to edits: it has been printed, handed over and very
// likely signed, so changing it after the fact would make the paper copy and
// the record disagree. The correction path is void + rewrite.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { getDocument, updateDocument, type LineInput } from '@/lib/notebooks/server'
import { listRequestsFor } from '@/lib/esign/request'
import { ESIGN_SUBJECT, SIGN_BLOCKS, esignSubjectId, type SignBlock } from '@/lib/notebooks/types'

async function signingState(docId: string) {
  const entries = await Promise.all(SIGN_BLOCKS.map(async (block) => {
    const history = await listRequestsFor(ESIGN_SUBJECT, esignSubjectId(docId, block))
    return [block, history] as const
  }))
  return Object.fromEntries(entries) as Record<SignBlock, Awaited<ReturnType<typeof listRequestsFor>>>
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_access_notebooks')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { id } = await params
  try {
    const document = await getDocument(id)
    if (!document) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    return NextResponse.json({ document, signing: await signingState(id) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not load the note' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_create_notebook_doc')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { id } = await params

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  try {
    const existing = await getDocument(id)
    if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: `${existing.doc_no} has already been issued — void it and write a new note instead.` },
        { status: 409 },
      )
    }

    const lines: LineInput[] | null = Array.isArray(body?.lines) ? body.lines : null
    const document = await updateDocument(id, body?.header ?? {}, lines)
    return NextResponse.json({ ok: true, document })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not save the note' }, { status: 500 })
  }
}

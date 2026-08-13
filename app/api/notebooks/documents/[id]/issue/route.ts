// app/api/notebooks/documents/[id]/issue/route.ts
// POST — close the page: the note stops being editable and becomes the record
// that gets printed, handed over and signed.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { getDocument, issueDocument } from '@/lib/notebooks/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_create_notebook_doc')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { id } = await params
  try {
    const existing = await getDocument(id)
    if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    if (existing.status === 'void') {
      return NextResponse.json({ error: `${existing.doc_no} is voided.` }, { status: 409 })
    }
    if (existing.status === 'issued') {
      return NextResponse.json({ ok: true, document: existing })
    }
    if (existing.lines.length === 0) {
      return NextResponse.json({ error: 'Add at least one line before issuing the note.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, document: await issueDocument(id, caller.userId) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not issue the note' }, { status: 500 })
  }
}

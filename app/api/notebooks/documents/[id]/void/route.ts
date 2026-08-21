// app/api/notebooks/documents/[id]/void/route.ts
// POST — cross the page out. The note keeps its number for good: the gap in
// the sequence is exactly how a physical book records a spoiled page, and
// re-using the number would break the chronology the book exists to prove.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { getDocument, voidDocument } from '@/lib/notebooks/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_void_notebook_doc')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { id } = await params

  let body: any = {}
  try { body = await req.json() } catch { /* reason is optional */ }
  const reason: string = (body?.reason ?? '').toString().trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required to void a note.' }, { status: 400 })

  try {
    const existing = await getDocument(id)
    if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    if (existing.status === 'void') return NextResponse.json({ ok: true, document: existing })

    return NextResponse.json({ ok: true, document: await voidDocument(id, caller.userId, reason) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not void the note' }, { status: 500 })
  }
}

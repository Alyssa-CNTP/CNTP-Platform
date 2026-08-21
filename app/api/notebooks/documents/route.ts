// app/api/notebooks/documents/route.ts
// GET  — filtered list of notes across the books (site, type, status, dates, search).
// POST — open a new page in a book: takes the next number and writes the note.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { listDocuments, createDocument, type LineInput } from '@/lib/notebooks/server'
import { DOC_TYPES, type DocType } from '@/lib/notebooks/types'

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_access_notebooks')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const docType = sp.get('docType')
  if (docType && !DOC_TYPES.includes(docType as DocType)) {
    return NextResponse.json({ error: 'docType must be GRN or DN' }, { status: 400 })
  }

  try {
    const result = await listDocuments({
      locationCode: sp.get('location'),
      docType:      (docType as DocType | null) ?? null,
      status:       sp.get('status'),
      search:       sp.get('q'),
      from:         sp.get('from'),
      to:           sp.get('to'),
      limit:        sp.get('limit')  ? Number(sp.get('limit'))  : undefined,
      offset:       sp.get('offset') ? Number(sp.get('offset')) : undefined,
    })
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not load notes' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_create_notebook_doc')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const locationCode: string = body?.locationCode
  const docType: DocType     = body?.docType
  if (!locationCode) return NextResponse.json({ error: 'locationCode is required' }, { status: 400 })
  if (!DOC_TYPES.includes(docType)) return NextResponse.json({ error: 'docType must be GRN or DN' }, { status: 400 })

  const lines: LineInput[] = Array.isArray(body?.lines) ? body.lines : []

  try {
    const doc = await createDocument({
      locationCode,
      docType,
      header:        body?.header ?? {},
      lines,
      createdBy:     caller.userId,
      createdByName: caller.name,
    })
    return NextResponse.json({ ok: true, document: doc })
  } catch (e: any) {
    const status = e?.message?.startsWith('Missing required fields:') ? 400 : 500
    return NextResponse.json({ error: e?.message ?? 'Could not write the note' }, { status })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

// A lightweight, append-only note log on a production order — distinct from
// prod_sessions.comments (the single "Handover & operator notes" field an
// operator writes during capture and the next save overwrites). Anyone
// signed in can add one, from the orders list or the order detail page;
// author and timestamp are always server-derived, never client-supplied.

// GET — notes for one session (order row). The order detail page instead
// reads the whole day's notes via loadOrderDay (union across shifts).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = getAdminClient() as any
  const { data, error } = await admin.schema('production').from('po_notes')
    .select('*').eq('session_id', sessionId).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
}

// POST — add a note to a session (order row).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const note = String(body?.note ?? '').trim()
  if (!note) return NextResponse.json({ error: 'A note is required' }, { status: 400 })

  const admin = getAdminClient() as any
  const { data: session, error: sErr } = await admin.schema('production')
    .from('prod_sessions').select('id,section_id,date,shift').eq('id', sessionId).maybeSingle()
  if (sErr)     return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Author is the signed-in user (server-verified), not a client-supplied name.
  const { data: created, error: iErr } = await admin.schema('production').from('po_notes').insert({
    session_id: sessionId, section_id: session.section_id, date: session.date, shift: session.shift,
    note, created_by: caller.userId, created_by_name: caller.name || null,
  } as any).select('*').single()
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, record: created })
}

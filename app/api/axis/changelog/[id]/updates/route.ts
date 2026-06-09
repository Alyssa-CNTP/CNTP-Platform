// app/api/axis/changelog/[id]/updates/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { data, error } = await (getAdminClient() as any)
    .schema('axis')
    .from('change_log_updates')
    .select('id, note, author_id, created_at')
    .eq('log_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[axis/changelog/[id]/updates GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { note } = await req.json()
  if (!note?.trim())
    return NextResponse.json({ error: 'Note is required' }, { status: 400 })

  const { error } = await (getAdminClient() as any)
    .schema('axis')
    .from('change_log_updates')
    .insert({ log_id: id, note: note.trim(), author_id: caller.userId })

  if (error) {
    console.error('[axis/changelog/[id]/updates POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

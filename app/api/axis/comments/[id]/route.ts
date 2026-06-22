// app/api/axis/comments/[id]/route.ts
// Edit + soft-delete a single comment. Author-only.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMentions(body: string, users: { id: string; name: string }[]): string[] {
  const matches: string[] = []
  const re = /@([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,3})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) matches.push(m[1])

  const byName = new Map(users.map(u => [u.name.toLowerCase(), u.id]))
  const ids = new Set<string>()
  for (const raw of matches.sort((a, b) => b.length - a.length)) {
    const direct = byName.get(raw.toLowerCase())
    if (direct) { ids.add(direct); continue }
    const first = raw.split(/\s+/)[0].toLowerCase()
    const candidates = users.filter(u => u.name.toLowerCase().split(/\s+/)[0] === first)
    if (candidates.length === 1) ids.add(candidates[0].id)
  }
  return Array.from(ids)
}

// ─── PATCH ─ edit own comment ─────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { body } = await req.json()
  if (!body?.trim())
    return NextResponse.json({ error: 'Body is required' }, { status: 400 })

  const axis = (getAdminClient() as any).schema('axis')

  // Verify author
  const { data: existing, error: lookupErr } = await axis
    .from('comments').select('id, author_id, deleted_at').eq('id', id).single()
  if (lookupErr || !existing)
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  if (existing.author_id !== caller.userId)
    return NextResponse.json({ error: 'You can only edit your own comments' }, { status: 403 })
  if (existing.deleted_at)
    return NextResponse.json({ error: 'Cannot edit a deleted comment' }, { status: 400 })

  // Re-parse mentions against the updated body
  const session = await getSessionClient()
  const { data: roles } = await (session as any)
    .schema('shared')
    .from('app_roles')
    .select('user_id, full_name')
    .eq('is_active', true)
  const users = (roles ?? [])
    .filter((r: any) => r.user_id && r.full_name)
    .map((r: any) => ({ id: r.user_id, name: r.full_name }))

  const mentionIds = parseMentions(body, users).filter((uid: string) => uid !== caller.userId)

  const { error: updErr } = await axis
    .from('comments')
    .update({
      body:      body.trim(),
      mentions:  mentionIds,
      edited_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updErr) {
    console.error('[api/axis/comments/[id] PATCH]', updErr)
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// ─── DELETE ─ soft-delete own comment ─────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const axis = (getAdminClient() as any).schema('axis')

  const { data: existing, error: lookupErr } = await axis
    .from('comments').select('id, author_id, deleted_at').eq('id', id).single()
  if (lookupErr || !existing)
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  if (existing.author_id !== caller.userId)
    return NextResponse.json({ error: 'You can only delete your own comments' }, { status: 403 })
  if (existing.deleted_at)
    return NextResponse.json({ ok: true })  // idempotent

  const { error: delErr } = await axis
    .from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (delErr) {
    console.error('[api/axis/comments/[id] DELETE]', delErr)
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

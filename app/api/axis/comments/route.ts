// app/api/axis/comments/route.ts
// Comment thread CRUD for AXIS entities (project | change_log | project_request).
// Supports: threading (parent_id), edit, soft-delete, @-mention notifications.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, getSessionClient } from '@/lib/auth/server-helpers'

const VALID_ENTITY_TYPES = new Set(['project', 'change_log', 'project_request'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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

async function hydrateAuthors(rows: any[]) {
  const userIds = Array.from(new Set([
    ...rows.map((c: any) => c.author_id),
    ...rows.flatMap((c: any) => c.mentions ?? []),
  ]))
  const userMap = new Map<string, { name: string; initials: string; department: string | null }>()
  if (userIds.length > 0) {
    const session = await getSessionClient()
    const { data: roles } = await (session as any)
      .schema('shared')
      .from('app_roles')
      .select('user_id, full_name, department')
      .in('user_id', userIds)
    for (const r of (roles ?? [])) {
      const name = r.full_name ?? '—'
      userMap.set(r.user_id, { name, initials: initialsFor(name), department: r.department ?? null })
    }
  }
  return userMap
}

// ─── GET ─ list comments for an entity (threaded) ─────────────────────────────

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const url = new URL(req.url)
  const entity_type = url.searchParams.get('entity_type') ?? ''
  const entity_id   = url.searchParams.get('entity_id') ?? ''
  if (!VALID_ENTITY_TYPES.has(entity_type))
    return NextResponse.json({ error: 'Invalid entity_type' }, { status: 400 })
  if (!entity_id)
    return NextResponse.json({ error: 'entity_id is required' }, { status: 400 })

  const axis = (getAdminClient() as any).schema('axis')
  const { data, error } = await axis
    .from('comments')
    .select('id, entity_type, entity_id, parent_id, author_id, body, mentions, created_at, edited_at, deleted_at')
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[api/axis/comments GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const userMap = await hydrateAuthors(data ?? [])

  // Hydrate each row with author + mention info, scrubbing soft-deleted bodies.
  const hydrated = (data ?? []).map((c: any) => {
    const author = userMap.get(c.author_id)
    const isDeleted = !!c.deleted_at
    return {
      id:                c.id,
      parent_id:         c.parent_id,
      entity_type:       c.entity_type,
      entity_id:         c.entity_id,
      author_id:         c.author_id,
      body:              isDeleted ? '' : c.body,
      mentions:          c.mentions ?? [],
      created_at:        c.created_at,
      edited_at:         c.edited_at,
      deleted_at:        c.deleted_at,
      is_deleted:        isDeleted,
      is_own:            c.author_id === caller.userId,
      author_name:       author?.name ?? '—',
      author_initials:   author?.initials ?? '?',
      author_department: author?.department ?? null,
      mention_users:     (c.mentions ?? []).map((uid: string) => {
        const u = userMap.get(uid)
        return { id: uid, name: u?.name ?? '—', initials: u?.initials ?? '?' }
      }),
    }
  })

  // Build a parent → children tree. Top-level = parent_id IS NULL.
  // Return as a flat list with `replies` nested under each root.
  const byId = new Map<string, any>()
  hydrated.forEach((c: any) => { c.replies = []; byId.set(c.id, c) })
  const roots: any[] = []
  for (const c of hydrated) {
    if (c.parent_id && byId.has(c.parent_id)) {
      byId.get(c.parent_id).replies.push(c)
    } else {
      roots.push(c)
    }
  }

  return NextResponse.json(roots)
}

// ─── POST ─ create a comment (top-level or reply) ─────────────────────────────

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { entity_type, entity_id, body, parent_id } = await req.json()
  if (!VALID_ENTITY_TYPES.has(entity_type))
    return NextResponse.json({ error: 'Invalid entity_type' }, { status: 400 })
  if (!entity_id)
    return NextResponse.json({ error: 'entity_id is required' }, { status: 400 })
  if (!body?.trim())
    return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })

  const axis = (getAdminClient() as any).schema('axis')

  // If this is a reply, verify the parent exists, is on the same entity, and isn't a reply itself.
  if (parent_id) {
    const { data: parent, error: parentErr } = await axis
      .from('comments').select('id, entity_type, entity_id, parent_id').eq('id', parent_id).single()
    if (parentErr || !parent) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 400 })
    }
    if (parent.entity_type !== entity_type || parent.entity_id !== entity_id) {
      return NextResponse.json({ error: 'Parent comment belongs to a different entity' }, { status: 400 })
    }
    if (parent.parent_id) {
      // Flatten: replies-to-replies attach to the same root (single-level threading)
      // to keep the UI sane.
      return NextResponse.json({ error: 'Replies can only target top-level comments' }, { status: 400 })
    }
  }

  // Resolve mentions
  const session = await getSessionClient()
  const { data: roles } = await (session as any)
    .schema('shared')
    .from('app_roles')
    .select('user_id, full_name')
    .eq('is_active', true)
  const users = (roles ?? [])
    .filter((r: any) => r.user_id && r.full_name)
    .map((r: any) => ({ id: r.user_id, name: r.full_name }))

  const mentionIds = parseMentions(body, users).filter(uid => uid !== caller.userId)

  const { data: inserted, error: insErr } = await axis
    .from('comments')
    .insert({
      entity_type,
      entity_id,
      parent_id: parent_id || null,
      author_id: caller.userId,
      body:      body.trim(),
      mentions:  mentionIds,
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    console.error('[api/axis/comments POST]', insErr)
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  if (mentionIds.length > 0) {
    const authorName = users.find((u: { id: string; name: string }) => u.id === caller.userId)?.name ?? 'Someone'
    const preview = body.trim().length > 140 ? body.trim().slice(0, 137) + '…' : body.trim()
    const refTable =
      entity_type === 'project'         ? 'projects' :
      entity_type === 'change_log'      ? 'change_logs' :
      entity_type === 'project_request' ? 'project_requests' : entity_type
    const rows = mentionIds.map(uid => ({
      recipient_id:    uid,
      type:            'comment_mention',
      title:           `${authorName} mentioned you`,
      body:            preview,
      reference_id:    entity_id,
      reference_table: refTable,
    }))
    const { error: notifErr } = await axis.from('notifications').insert(rows)
    if (notifErr) console.error('[api/axis/comments] notification fan-out:', notifErr)
  }

  return NextResponse.json({ ok: true, id: inserted.id, mentions: mentionIds })
}

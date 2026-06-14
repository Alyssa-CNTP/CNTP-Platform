// Supervisor-hub line messaging. A "channel" is a production section; the
// special key 'general' maps to section_id = NULL (all-lines). Text-only v1.

import { getDb } from '@/lib/supabase/db'

export const GENERAL = 'general'

export interface LineMessage {
  id:          string
  section_id:  string | null
  author_id:   string | null
  author_name: string
  author_role: string | null
  body:        string
  created_at:  string
}

const tbl = () => getDb().schema('production').from('line_messages')
const sectionFilter = (q: any, channel: string) =>
  channel === GENERAL ? q.is('section_id', null) : q.eq('section_id', channel)

/** Full (non-deleted) thread for a channel, oldest first. */
export async function loadThread(channel: string): Promise<LineMessage[]> {
  const q = sectionFilter(
    tbl().select('id,section_id,author_id,author_name,author_role,body,created_at').is('deleted_at', null),
    channel,
  ).order('created_at', { ascending: true }).limit(300)
  const { data } = await q
  return (data as LineMessage[]) ?? []
}

export interface ChannelLatest { created_at: string; body: string; author_name: string }

/** Most-recent message per channel, for the sidebar previews + unread dots. */
export async function loadLatestPerChannel(): Promise<Map<string, ChannelLatest>> {
  const { data } = await tbl()
    .select('section_id,body,author_name,created_at').is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(300)
  const map = new Map<string, ChannelLatest>()
  ;((data as any[]) ?? []).forEach(m => {
    const key = m.section_id ?? GENERAL
    if (!map.has(key)) map.set(key, { created_at: m.created_at, body: m.body, author_name: m.author_name })
  })
  return map
}

export async function sendMessage(args: {
  channel: string; body: string; authorId: string | null; authorName: string; authorRole: string | null
}): Promise<LineMessage | null> {
  const { data } = await tbl().insert({
    section_id:  args.channel === GENERAL ? null : args.channel,
    author_id:   args.authorId,
    author_name: args.authorName,
    author_role: args.authorRole,
    body:        args.body,
  } as any).select('id,section_id,author_id,author_name,author_role,body,created_at').maybeSingle()
  return (data as LineMessage) ?? null
}

export async function deleteMessage(id: string): Promise<void> {
  await tbl().update({ deleted_at: new Date().toISOString() } as any).eq('id', id)
}

// ── localStorage last-seen (unread dots, no read-receipt schema) ──────────────
const seenKey = (channel: string) => `linemsg_seen_${channel}`

export function getSeen(channel: string): string {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(seenKey(channel)) ?? '' } catch { return '' }
}
export function markSeen(channel: string, iso: string): void {
  if (typeof window === 'undefined' || !iso) return
  try { window.localStorage.setItem(seenKey(channel), iso) } catch { /* ignore */ }
}

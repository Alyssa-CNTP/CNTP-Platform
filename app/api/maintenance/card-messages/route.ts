// app/api/maintenance/card-messages/route.ts
// Job-card chat thread. GET returns messages with freshly-signed photo URLs.
// POST appends a message and fires in-app notifications for any @mentions.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient, getAdminClient } from '@/lib/auth/server-helpers'
import { notify } from '@/lib/notifications'
import { resolveRecipients } from '@/lib/notifications/recipients'

const BUCKET = 'maintenance-card-photos'

export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const cardId = Number(new URL(req.url).searchParams.get('card_id'))
    if (!cardId) return NextResponse.json({ error: 'card_id required' }, { status: 400 })

    const db = await getSessionClient()
    const { data: msgs, error } = await db.schema('maintenance' as any).from('card_messages')
      .select('*').eq('card_id', cardId).is('deleted_at', null).order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Sign attachment URLs (private bucket).
    const admin = getAdminClient()
    const messages = await Promise.all((msgs ?? []).map(async (m: any) => {
      const attachments = await Promise.all((m.attachments ?? []).map(async (a: any) => {
        if (!a?.path) return a
        const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(a.path, 3600)
        return { ...a, url: signed?.signedUrl ?? null }
      }))
      return { ...m, attachments }
    }))
    return NextResponse.json({ messages })
  } catch (err: any) {
    console.error('[api/maintenance/card-messages GET]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const b = await req.json()
    const cardId = Number(b.card_id)
    if (!cardId) return NextResponse.json({ error: 'card_id required' }, { status: 400 })

    const mentions: string[] = Array.isArray(b.mentions) ? b.mentions.filter(Boolean) : []
    const attachments = Array.isArray(b.attachments) ? b.attachments : []
    if (!b.body?.trim() && attachments.length === 0)
      return NextResponse.json({ error: 'Message or photo required' }, { status: 400 })

    const db = await getSessionClient()
    const { data: msg, error } = await db.schema('maintenance' as any).from('card_messages').insert({
      card_id: cardId, author_id: caller.userId, author_name: b.author_name ?? 'Unknown',
      body: b.body ?? '', mentions, attachments,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Notify mentioned users (in-app).
    const targets = mentions.filter(uid => uid !== caller.userId)
    if (targets.length) {
      const { data: card } = await db.schema('maintenance' as any).from('job_cards').select('card_no').eq('id', cardId).single()
      const recipients = await resolveRecipients(targets)
      await notify({ recipients, kind: 'mention', cardId, url: `/maintenance/job-cards/${cardId}`,
        title: `${b.author_name ?? 'Someone'} mentioned you on ${card?.card_no ?? 'a job card'}`,
        body: (b.body ?? '').slice(0, 140) || 'Shared a photo.', channels: ['inApp'] })
    }

    return NextResponse.json({ message: msg })
  } catch (err: any) {
    console.error('[api/maintenance/card-messages POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

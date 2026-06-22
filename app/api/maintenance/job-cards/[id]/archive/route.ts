// app/api/maintenance/job-cards/[id]/archive/route.ts
// Optional: archive a job card's chat photos to SharePoint/OneDrive for audit.
// Manager-gated. Uses the caller's delegated Microsoft provider_token (so it
// only works for Microsoft-OAuth users) and degrades gracefully otherwise.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient, getAdminClient } from '@/lib/auth/server-helpers'
import { ensureFolder, uploadFile } from '@/lib/integrations/sharepoint'

export const runtime = 'nodejs'

const BUCKET = 'maintenance-card-photos'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_allocate_jobs')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const { id } = await params
    const cardId = Number(id)
    const db = await getSessionClient()

    const { data: { session } } = await db.auth.getSession()
    const token = session?.provider_token
    if (!token)
      return NextResponse.json({ error: 'Archiving to SharePoint requires signing in with Microsoft.' }, { status: 400 })

    const { data: card } = await db.schema('maintenance' as any).from('job_cards').select('card_no').eq('id', cardId).single()
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 })

    const { data: msgs } = await db.schema('maintenance' as any).from('card_messages')
      .select('attachments').eq('card_id', cardId).is('deleted_at', null)
    const paths: { path: string; name: string }[] = []
    for (const m of msgs ?? []) for (const a of ((m as any).attachments ?? [])) if (a?.path) paths.push(a)
    if (paths.length === 0) return NextResponse.json({ ok: true, archived: 0, message: 'No photos to archive.' })

    const folder = `Maintenance Job Cards/${card.card_no}`
    await ensureFolder(token, folder)

    const admin = getAdminClient()
    let archived = 0
    for (const a of paths) {
      const { data: blob, error } = await admin.storage.from(BUCKET).download(a.path)
      if (error || !blob) continue
      const buf = Buffer.from(await blob.arrayBuffer())
      const file = new File([buf], a.name || a.path.split('/').pop() || 'photo.jpg', { type: blob.type || 'image/jpeg' })
      try { await uploadFile(token, folder, file); archived++ } catch (e: any) { console.warn('[archive] upload failed:', e?.message) }
    }

    return NextResponse.json({ ok: true, archived })
  } catch (err: any) {
    console.error('[api/maintenance/job-cards/[id]/archive POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

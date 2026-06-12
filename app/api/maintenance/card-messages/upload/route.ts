// app/api/maintenance/card-messages/upload/route.ts
// Upload a chat photo to the private maintenance-card-photos bucket and return
// the object path (the message POST references it in `attachments`).

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export const runtime = 'nodejs'

const BUCKET = 'maintenance-card-photos'
const MAX_BYTES = 8 * 1024 * 1024
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await req.formData()
    const file = form.get('file') as File | null
    const cardId = Number(form.get('card_id'))
    if (!file)   return NextResponse.json({ error: 'file required' }, { status: 400 })
    if (!cardId) return NextResponse.json({ error: 'card_id required' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 8MB)' }, { status: 400 })
    if (file.type && !OK_TYPES.includes(file.type))
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 })

    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `card/${cardId}/${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const admin = getAdminClient()
    const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type || 'image/jpeg', upsert: false,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600)
    return NextResponse.json({ path, name: file.name, size: file.size, mime: file.type, url: signed?.signedUrl ?? null })
  } catch (err: any) {
    console.error('[api/maintenance/card-messages/upload POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

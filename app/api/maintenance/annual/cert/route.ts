// app/api/maintenance/annual/cert/route.ts
// Calibration-certificate proof for the annual / calibration register.
//   POST  (formData: file, id)  — upload a certificate (image or PDF) to the
//         private maintenance-card-photos bucket under cert/annual/<id>/, stamp
//         the annual_items row with the path + who + when, and return a signed
//         URL. The file lives in storage (not the DB) to avoid bloat.
//   GET   (?path=…)             — mint a fresh signed URL to view a certificate.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export const runtime = 'nodejs'

const BUCKET = 'maintenance-card-photos'
const MAX_BYTES = 15 * 1024 * 1024
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

export async function POST(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await req.formData()
    const file = form.get('file') as File | null
    const id = Number(form.get('id'))
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
    if (!id)   return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 15MB)' }, { status: 400 })
    if (file.type && !OK_TYPES.includes(file.type))
      return NextResponse.json({ error: 'Only image or PDF files are allowed' }, { status: 400 })

    const ext  = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `cert/annual/${id}/${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const admin = getAdminClient()
    const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type || 'application/octet-stream', upsert: false,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { error: upErr } = await admin.schema('maintenance').from('annual_items').update({
      cert_path: path,
      cert_name: file.name,
      cert_uploaded_at: new Date().toISOString(),
      cert_uploaded_by: caller.name || 'Unknown',
    }).eq('id', id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600)
    return NextResponse.json({ path, name: file.name, url: signed?.signedUrl ?? null })
  } catch (err: any) {
    console.error('[api/maintenance/annual/cert POST]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const path = req.nextUrl.searchParams.get('path')
    if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

    const admin = getAdminClient()
    const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ url: signed?.signedUrl ?? null })
  } catch (err: any) {
    console.error('[api/maintenance/annual/cert GET]', err)
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

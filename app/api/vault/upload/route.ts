// app/api/vault/upload/route.ts
// POST /api/vault/upload
// Auth: admin and management roles only.
// Validates file type and size (max 50MB), writes to /vault folder.
// Writing to /vault triggers watcher.py to ingest into ChromaDB.
// Returns: { success, filename, category_detected, estimated_chunks }

import { NextResponse }       from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies }            from 'next/headers'
import { writeFile, mkdir }   from 'fs/promises'
import { join, extname }      from 'path'
import crypto                  from 'crypto'

export const maxDuration = 30

const VAULT_DIR        = join(process.cwd(), 'vault')
const MAX_SIZE_MB      = 50
const MAX_BYTES        = MAX_SIZE_MB * 1024 * 1024
const DAILY_UPLOAD_MAX = 20   // per user, resets at midnight

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.pptx', '.xlsx', '.docx', '.csv', '.txt'])

// MIME types accepted per extension — must match BOTH extension AND MIME
const EXTENSION_MIME: Record<string, string[]> = {
  '.pdf':  ['application/pdf'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/octet-stream'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
  '.csv':  ['text/csv', 'text/plain', 'application/octet-stream'],
  '.txt':  ['text/plain'],
}

// Departments that can upload vault documents
const UPLOAD_DEPARTMENTS = ['IT', 'Management']

function detectCategory(filename: string): string {
  const f = filename.toLowerCase()
  if (f.includes('trip') || f.includes('travel') || f.includes('visit')) return 'trip_report'
  if (f.includes('price') || f.includes('pricing') || f.includes('rate')) return 'pricing_history'
  if (f.includes('contract') || f.includes('agreement') || f.includes('nda')) return 'contract'
  if (f.includes('client') || f.includes('customer') || f.includes('buyer')) return 'client_profile'
  if (f.includes('competitor') || f.includes('competition')) return 'competitor_intel'
  if (f.includes('market') || f.includes('study') || f.includes('research')) return 'market_study'
  if (f.includes('spec') || f.includes('product') || f.includes('grade')) return 'product_spec'
  return 'sales_report'
}

function sanitiseFilename(original: string): string {
  return original
    .replace(/[^a-zA-Z0-9._\-\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 200)
}

export async function POST(req: Request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const supabase    = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appRole } = await supabase
    .schema('shared' as any)
    .from('app_roles')
    .select('department, permissions')
    .eq('user_id', user.id)
    .single()

  const dept      = (appRole as any)?.department as string | null
  const overrides = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
  const canUpload = UPLOAD_DEPARTMENTS.includes(dept ?? '')
                    || overrides['can_upload_vault'] === true

  if (!canUpload) {
    return NextResponse.json(
      { error: 'Vault uploads require IT or Management access' },
      { status: 403 }
    )
  }

  // ── Per-user daily rate limit ────────────────────────────────────────────
  try {
    const today = new Date().toISOString().split('T')[0]
    const { count } = await supabase
      .schema('sales' as any)
      .from('vault_query_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', `${today}T00:00:00`)

    if ((count ?? 0) >= DAILY_UPLOAD_MAX) {
      return NextResponse.json(
        { error: `Daily upload limit (${DAILY_UPLOAD_MAX} files) reached. Try again tomorrow.` },
        { status: 429 }
      )
    }
  } catch {
    // vault_query_log may not exist yet — allow the upload to proceed
  }

  // ── Parse form data ───────────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // ── Validate ──────────────────────────────────────────────────────────────
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_SIZE_MB}MB.` },
      { status: 413 }
    )
  }

  const ext = extname(file.name).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `File type not supported. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
      { status: 415 }
    )
  }

  // Cross-check MIME type against the extension — prevents renaming attacks
  const allowedMimes = EXTENSION_MIME[ext] ?? []
  const mimeOk = allowedMimes.length === 0 || allowedMimes.includes(file.type)
  if (!mimeOk) {
    return NextResponse.json(
      { error: `MIME type "${file.type}" is not valid for a ${ext} file` },
      { status: 415 }
    )
  }

  // ── Write to vault ────────────────────────────────────────────────────────
  const safeFilename  = sanitiseFilename(file.name)
  const categoryName  = detectCategory(safeFilename)

  try {
    await mkdir(VAULT_DIR, { recursive: true })
    const bytes    = await file.arrayBuffer()
    const destPath = join(VAULT_DIR, safeFilename)
    await writeFile(destPath, Buffer.from(bytes))
  } catch (err: any) {
    console.error('[vault/upload] Write error:', err.message)
    return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
  }

  // Record metadata in Supabase
  try {
    await supabase
      .schema('qms' as any)
      .from('vault_files')
      .insert({
        user_id:         user.id,
        filename:        safeFilename,
        original_name:   file.name,
        category:        categoryName,
        file_size_bytes: file.size,
        mime_type:       file.type || null,
      })
  } catch (err: any) {
    console.warn('[vault/upload] Metadata insert failed:', err.message)
  }

  // Rough chunk estimate (watcher.py handles actual extraction)
  const estimatedChunks = Math.ceil(file.size / 2000)

  return NextResponse.json({
    success:           true,
    filename:          safeFilename,
    category_detected: categoryName,
    estimated_chunks:  estimatedChunks,
    message:           'File saved to vault. Watcher will index it within 5 seconds.',
  }, { status: 201 })
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

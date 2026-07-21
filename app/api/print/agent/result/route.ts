import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabase/admin'

// The relay agent reports the outcome of a print job.
// Body: { id: string, ok: boolean, error?: string }
export async function POST(req: NextRequest) {
  const secret = process.env.PRINT_AGENT_SECRET
  if (!secret || req.headers.get('x-print-agent-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { id?: string; ok?: boolean; error?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // attempts is bumped so a job that keeps failing is visible/limitable later.
  const db = supabaseAdmin.schema('production')
  const { data: cur } = await db.from('print_jobs').select('attempts').eq('id', body.id).maybeSingle()
  const attempts = ((cur as any)?.attempts ?? 0) + 1

  const { error } = await db.from('print_jobs').update({
    status: body.ok ? 'done' : 'error',
    error: body.ok ? null : (body.error ?? 'print failed'),
    attempts,
    printed_at: new Date().toISOString(),
  } as any).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabase/admin'

// Claims and returns up to 10 pending print jobs for the relay agent.
// Auth: shared secret in the x-print-agent-secret header (matches PRINT_AGENT_SECRET).
export async function POST(req: NextRequest) {
  const secret = process.env.PRINT_AGENT_SECRET
  if (!secret || req.headers.get('x-print-agent-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin.schema('production')

  // Grab the oldest pending jobs, then claim them (pending → printing).
  const { data: pending, error } = await db
    .from('print_jobs')
    .select('id, section_id, printer_ip, printer_port, lang, payload')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobs = pending ?? []
  if (jobs.length) {
    const ids = jobs.map((j: any) => j.id)
    await db.from('print_jobs')
      .update({ status: 'printing', claimed_at: new Date().toISOString() } as any)
      .in('id', ids)
      .eq('status', 'pending')
  }

  return NextResponse.json({ jobs })
}

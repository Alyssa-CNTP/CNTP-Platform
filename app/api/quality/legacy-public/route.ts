import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import supabaseAdmin from '@/lib/supabase/admin'

const ALLOWED = new Set([
  'customer_specs','quality_records','lab_results',
  'granule_runs','granule_samples','granule_tastings','granule_specs',
  'sieving_sessions','sieving_samples','sd_runs','pasteuriser_records',
])

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const table      = searchParams.get('table')
  const workcenter = searchParams.get('workcenter')
  const workflow   = searchParams.get('workflow')
  const limit      = parseInt(searchParams.get('limit') ?? '500')
  if (!table || !ALLOWED.has(table))
    return NextResponse.json({ error: 'Invalid table' }, { status: 400 })
  let query = (supabaseAdmin.schema('public') as any)
    .from(table).select('*').order('created_at', { ascending: false }).limit(limit)
  if (workcenter) query = query.eq('workcenter', workcenter)
  if (workflow)   query = query.eq('workflow', workflow)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

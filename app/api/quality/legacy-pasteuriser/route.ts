import { NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabase/admin'

export async function GET() {
  const [{ data: runs }, { data: allPast }] = await Promise.all([
    supabaseAdmin.schema('public').from('quality_records').select('*')
      .eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run')
      .order('created_at', { ascending: false }),
    supabaseAdmin.schema('public').from('quality_records').select('*')
      .eq('workcenter', 'pasteuriser')
      .order('created_at', { ascending: false }).limit(300),
  ])
  return NextResponse.json({
    pasteuriser_runs: runs ?? [],
    quality_records:  allPast ?? [],
  })
}

import { NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabase/admin'

// Probes every likely pasteuriser/raw_material table name variation
export async function GET() {
  const candidates = [
    // pasteuriser variations
    'pasteuriser_run_dashboard', 'pasteuriser__run_dashboard',
    'pasteuriser_runs', 'pasteuriser__runs',
    'pasteuriser_run_records', 'pasteuriser__run_records',
    'pasteuriser_microbiology', 'pasteuriser__microbiology',
    'pasteuriser_microbiology_records', 'pasteuriser__microbiology_records',
    'pasteuriser_residue', 'pasteuriser__residue',
    'pasteuriser_residue_records', 'pasteuriser__residue_records',
    'pasteuriser_glyphosate', 'pasteuriser__glyphosate',
    'pasteuriser_glyphosate_records', 'pasteuriser__glyphosate_records',
    'pasteuriser_pyrometer', 'pasteuriser__pyrometer',
    'pasteuriser_pyrometer_records', 'pasteuriser__pyrometer_records',
    'pasteuriser_pyro', 'pasteuriser__pyro',
    'pasteuriser_pyro_records', 'pasteuriser__pyro_records',
    'pasteuriser_pa', 'pasteuriser__pa',
    'pasteuriser_pa_records', 'pasteuriser__pa_records',
    'pasteuriser_heavy_metals', 'pasteuriser__heavy_metals',
    'pasteuriser_eto', 'pasteuriser__eto',
    'pasteuriser_aflatoxins', 'pasteuriser__aflatoxins',
    'pasteuriser_mosh_moah', 'pasteuriser__mosh_moah',
    // raw_material variations
    'raw_material_pa', 'raw_material__pa',
    'raw_material_pa_records', 'raw_material__pa_records',
    'raw_material_residue', 'raw_material__residue',
    'raw_material_residue_records', 'raw_material__residue_records',
    'raw_material_glyphosate', 'raw_material__glyphosate',
    'raw_material_glyphosate_records', 'raw_material__glyphosate_records',
    // known tables for confirmation
    'pasteuriser_records', 'quality_records', 'lab_results',
  ]

  const found: Record<string, number> = {}
  const missing: string[] = []

  await Promise.all(candidates.map(async (table) => {
    const { count, error } = await supabaseAdmin
      .schema('public')
      .from(table)
      .select('*', { count: 'exact', head: true })
    if (!error) {
      found[table] = count ?? 0
    } else {
      missing.push(table)
    }
  }))

  return NextResponse.json({
    found,        // tables that exist — with row counts
    missing_count: missing.length,
  })
}

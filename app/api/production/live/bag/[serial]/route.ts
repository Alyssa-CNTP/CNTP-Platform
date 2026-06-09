import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/production/live/bag/[serial]
// Looks up a bag tag by serial number.
// Returns { found: true, bag: {...} } or { found: false }
export async function GET(
  _request: NextRequest,
  { params }: { params: { serial: string } }
) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const serial = decodeURIComponent(params.serial).trim()
    const { data, error } = await supabase
      .schema('production')
      .from('bag_tags')
      .select('serial_number, product_type, variant, qc_grade, weight_kg, lot_number, section_id, acumatica_id, status, consumed_at_session, consumed_at_section')
      .eq('serial_number', serial)
      .maybeSingle()

    if (error || !data) {
      return NextResponse.json({ found: false, error: error?.message }, { status: 200 })
    }
    return NextResponse.json({ found: true, bag: data }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ found: false, error: e.message }, { status: 200 })
  }
}

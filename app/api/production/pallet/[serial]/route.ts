import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sanitizeSerial } from '@/lib/production/scan-utils'

/**
 * GET /api/production/pallet/[serial]
 *
 * Scanning ONE pallet barcode and getting the detail of every box or paper bag
 * stacked on it — the read side of the pasteuriser pallet tag.
 *
 * Returns the pallet's own record (what it was declared to hold) alongside the
 * boxes actually linked to it. Both, deliberately: a pallet whose declared
 * box_count is 45 but which only has 43 boxes linked is a real discrepancy the
 * floor needs to see, and collapsing the two into one number would hide it.
 *
 * Responds 200 with { found: false } rather than 404 for an unknown serial —
 * matching /api/production/live/bag/[serial], so the scan UI has one shape to
 * handle whichever kind of tag was scanned.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serial: string }> },
) {
  try {
    const { serial: raw } = await params
    const serial = sanitizeSerial(decodeURIComponent(raw)).toUpperCase()
    if (!serial) return NextResponse.json({ found: false }, { status: 200 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    // v_pallet_contents carries the aggregates (actual box count, actual total
    // kg, how many are already consumed) computed in the database, so this
    // route and the capture screen can never disagree about what is on a pallet.
    const { data: pallet, error } = await supabase
      .schema('production')
      .from('v_pallet_contents')
      .select('*')
      .eq('pallet_serial', serial)
      .maybeSingle()

    if (error) return NextResponse.json({ found: false, error: error.message }, { status: 200 })
    if (!pallet) return NextResponse.json({ found: false }, { status: 200 })

    const { data: boxes } = await supabase
      .schema('production')
      .from('bag_tags')
      .select('serial_number, bag_number, product_type, variant, weight_kg, lot_number, status, consumed, consumed_at_section, tag_method, acumatica_id')
      .eq('pallet_id', (pallet as any).pallet_id)
      .order('bag_number', { ascending: true })

    return NextResponse.json({ found: true, pallet, boxes: boxes ?? [] }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ found: false, error: e?.message ?? String(e) }, { status: 200 })
  }
}

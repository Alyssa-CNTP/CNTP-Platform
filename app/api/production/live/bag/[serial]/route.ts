import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { sanitizeSerial } from '@/lib/production/scan-utils'

// GET /api/production/live/bag/[serial]
// Looks up a bag tag by serial number.
// Returns { found: true, bag: {...} } or { found: false }
//
// Two things were wrong here and both failed silently, which is why this
// endpoint answered `found: false` for every bag that exists:
//
//   · it selected `qc_grade`, a column production.bag_tags does not have.
//     PostgREST rejects the whole select with 42703, the handler maps any
//     error to `found: false`, and nothing surfaces the column name.
//   · `params` is a Promise in this version of Next (see AGENTS.md — the
//     framework docs in node_modules/next/dist/docs are the reference, not
//     older conventions). Destructuring it synchronously left `serial`
//     undefined, and was one of the repo's standing type errors.
//
// The grade a bag carries is `destination`; `qc_initials`/`qc_signed_at` are
// the QC stamp. Per-bag quality values (bulk density, leaf shade) are NOT on
// this table — they live in qms.v_bag_qc_status, keyed on bag_serial_no.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { serial: rawSerial } = await params
    const serial = sanitizeSerial(decodeURIComponent(rawSerial))
    const { data, error } = await supabase
      .schema('production')
      .from('bag_tags')
      .select('serial_number, product_type, variant, destination, qc_initials, qc_signed_at, weight_kg, lot_number, section_id, acumatica_id, status, is_open, consumed_at_session, consumed_at_section')
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

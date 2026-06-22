import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/production/live/session
// Upserts a production session (create or update).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const ts = new Date().toISOString()
    const { error } = await supabase
      .schema('production')
      .from('prod_sessions')
      .upsert({
        id:                 body.sessionId,
        section_id:         body.sectionId,
        section_name:       body.sectionName,
        date:               body.date,
        shift:              body.shift,
        status:             body.status ?? 'draft',
        operator_name_text: body.operatorText || null,
        lot_number:         body.lotNumber    || null,
        notes:              body.notes ? JSON.stringify(body.notes) : null,
        updated_at:         ts,
        created_at:         ts,
      }, { onConflict: 'id' })

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// app/api/production/reconciliation/route.ts
// Read/write the manual sides of the three-way production-order accuracy check
// (paperwork · system snapshot · Acumatica) stored in
// production.order_reconciliation. See 20260721_004_order_reconciliation.sql.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { normalizeBatch } from '@/lib/production/batch-key'

export const runtime = 'nodejs'

// GET /api/production/reconciliation?batch=<key> — saved reconciliation lines.
export async function GET(req: NextRequest) {
  try {
    const key = normalizeBatch(new URL(req.url).searchParams.get('batch'))
    if (!key) return NextResponse.json({ error: 'Missing batch' }, { status: 400 })
    const db = await createServerSupabaseClient()
    const { data, error } = await db.schema('production').from('order_reconciliation')
      .select('line_key,line_label,unit,paperwork_value,system_value,acumatica_value,acumatica_source,note,production_order,updated_at')
      .eq('batch_key', key)
    if (error) throw error
    return NextResponse.json({ batchKey: key, lines: data || [] })
  } catch (err: any) {
    console.error('[reconciliation:GET]', err)
    return NextResponse.json({ error: err.message ?? 'Unknown' }, { status: 500 })
  }
}

// PUT /api/production/reconciliation — upsert reconciliation lines for a batch.
// Body: { batchKey, productionOrder?, lines: [{ lineKey, lineLabel?, unit?,
//         paperworkValue?, systemValue?, acumaticaValue?, note? }] }
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const key = normalizeBatch(body?.batchKey)
    if (!key) return NextResponse.json({ error: 'Missing batchKey' }, { status: 400 })
    const lines = Array.isArray(body?.lines) ? body.lines : []
    if (!lines.length) return NextResponse.json({ error: 'No lines' }, { status: 400 })

    const db = await createServerSupabaseClient()

    // Resolve batch_id (best-effort — batch_key is stored regardless).
    const { data: batch } = await db.schema('production').from('batches')
      .select('id').eq('batch_key', key).maybeSingle()
    const { data: auth } = await db.auth.getUser()
    const uid = auth?.user?.id ?? null

    const num = (v: any) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))
    const rows = lines.map((l: any) => ({
      batch_id: batch?.id ?? null,
      batch_key: key,
      production_order: body?.productionOrder ?? null,
      line_key: String(l.lineKey),
      line_label: l.lineLabel ?? null,
      unit: l.unit ?? 'kg',
      paperwork_value: num(l.paperworkValue),
      system_value: num(l.systemValue),
      acumatica_value: num(l.acumaticaValue),
      note: l.note ?? null,
      reconciled_by: uid,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await db.schema('production').from('order_reconciliation')
      .upsert(rows as any, { onConflict: 'batch_key,line_key' })
    if (error) throw error
    return NextResponse.json({ ok: true, saved: rows.length })
  } catch (err: any) {
    console.error('[reconciliation:PUT]', err)
    return NextResponse.json({ error: err.message ?? 'Unknown' }, { status: 500 })
  }
}

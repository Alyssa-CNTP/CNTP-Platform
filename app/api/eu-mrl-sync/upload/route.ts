// app/api/eu-mrl-sync/upload/route.ts
//
// Ingests an official EU Pesticides Database MRL export
// (Export_Pesticide_residue_CurrentMRL.xlsx, one product e.g. Rooibos 0632020)
// that an admin has downloaded from the EU site and uploaded here, and upserts
// the limits into qms.eu_mrl.
//
// This is the primary "refresh" mechanism: the EU export is a session-based
// download with no stable public URL, so refreshing = re-exporting from the EU
// site and uploading the file. The commodity is read from the file itself.

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, getCallerPermissions } from '@/lib/auth/server-helpers'
import { parseEuMrlWorkbook, toEuMrlPayload, ROOIBOS_COMMODITY } from '@/lib/quality/eu-mrl'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.can('can_save_records'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  let buf: ArrayBuffer
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    buf = await file.arrayBuffer()
  } catch {
    return NextResponse.json({ error: 'Could not read uploaded file' }, { status: 400 })
  }

  const db = getAdminClient()
  const triggeredBy = caller.userId ?? 'user'

  let logId: number | null = null
  try {
    const { data } = await db.schema('qms' as any).from('eu_mrl_sync_log')
      .insert({ status: 'running', triggered_by: triggeredBy, message: 'file upload' })
      .select('id').single()
    logId = (data as any)?.id ?? null
  } catch { /* best effort */ }

  const finish = async (status: string, message: string, rows?: number, commodity?: string) => {
    if (logId == null) return
    try {
      await db.schema('qms' as any).from('eu_mrl_sync_log')
        .update({ status, message, rows_upserted: rows ?? null, commodity: commodity ?? null,
                  finished_at: new Date().toISOString() })
        .eq('id', logId)
    } catch { /* ignore */ }
  }

  try {
    const parsed = parseEuMrlWorkbook(buf)
    if (!parsed.rows.length) {
      const msg = 'No MRL rows found — is this the EU "Current MRL" export? Expected columns: Pesticide residue, Maximum residue level (mg/kg).'
      await finish('error', msg)
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    const { code, name, payload } = toEuMrlPayload(parsed, ROOIBOS_COMMODITY, new Date().toISOString())

    // Replace this commodity's set so removed substances don't linger.
    await db.schema('qms' as any).from('eu_mrl').delete().eq('commodity_code', code)

    let upserted = 0
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500)
      const { error } = await db.schema('qms' as any).from('eu_mrl')
        .upsert(chunk, { onConflict: 'pesticide_norm,commodity_code' })
      if (error) { await finish('error', error.message, upserted, name); return NextResponse.json({ error: error.message, upserted }, { status: 500 }) }
      upserted += chunk.length
    }

    await finish('success', `Imported ${upserted} MRLs for ${name} (${code}) from upload.`, upserted, name)
    return NextResponse.json({
      success: true,
      message: `Imported ${upserted} EU MRLs for ${name} (${code})`,
      updated: upserted,
      commodity: name,
      commodity_code: code,
    })
  } catch (e: any) {
    const msg = e?.message ?? 'Unexpected error parsing upload'
    await finish('error', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

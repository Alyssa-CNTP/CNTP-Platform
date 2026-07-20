// app/api/eu-mrl-sync/run/route.ts
//
// Syncs EU Maximum Residue Levels from the official EU Pesticides Database bulk
// export into qms.eu_mrl. Powers:
//   • the "🌍 EU MRL Sync" admin button (authenticated caller), and
//   • the weekly GitHub Actions cron (.github/workflows/eu-mrl-sync.yml), which
//     presents  Authorization: Bearer <CRON_SECRET>.
//
// The EU database has no stable JSON API, so we download its official bulk MRL
// export (an .xlsx/.csv file) and parse it. The exact export URL is set via the
// EU_MRL_DOWNLOAD_URL env var so it can be pointed at the correct per-commodity
// export (e.g. Rooibos, product code 0632020) without a code change.
//
// Required env:
//   EU_MRL_DOWNLOAD_URL      — URL of the EU MRL export to download
//   SUPABASE_SERVICE_ROLE_KEY
//   CRON_SECRET              — only needed for the unattended cron path
// Optional env:
//   EU_MRL_COMMODITY_CODE    — EU product code (default 0632020 = Rooibos)
//   EU_MRL_COMMODITY_NAME    — human label (default 'Rooibos')

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getAdminClient, getCallerPermissions } from '@/lib/auth/server-helpers'
import { normPesticide, parseMrlValue, ROOIBOS_COMMODITY } from '@/lib/quality/eu-mrl'

export const maxDuration = 60

// Heuristic column detection — the EU export headers vary between views.
const isPesticideHeader = (h: string) =>
  /pesticide|substance|residue definition|active/i.test(h) && !/level|mrl|value/i.test(h)
const isMrlHeader = (h: string) =>
  /\bmrl\b|residue level|maximum residue|mg\/kg|value/i.test(h)

function rowsFromWorkbook(buf: ArrayBuffer): Record<string, any>[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })
}

export async function POST(req: NextRequest) {
  // ── Auth: cron secret OR an authenticated user who can save records ──
  const authz = req.headers.get('authorization') || ''
  const isCron =
    !!process.env.CRON_SECRET && authz === `Bearer ${process.env.CRON_SECRET}`
  let triggeredBy = 'cron'
  if (!isCron) {
    const caller = await getCallerPermissions()
    if (!caller.can('can_save_records'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    triggeredBy = caller.userId ?? 'user'
  }

  const commodityCode = process.env.EU_MRL_COMMODITY_CODE || ROOIBOS_COMMODITY.code
  const commodityName = process.env.EU_MRL_COMMODITY_NAME || ROOIBOS_COMMODITY.name
  const downloadUrl = process.env.EU_MRL_DOWNLOAD_URL

  const db = getAdminClient()

  // Open a sync-log row so the run is visible even if it fails midway.
  let logId: number | null = null
  try {
    const { data: logRow } = await db
      .schema('qms' as any)
      .from('eu_mrl_sync_log')
      .insert({ status: 'running', commodity: commodityName, triggered_by: triggeredBy })
      .select('id')
      .single()
    logId = (logRow as any)?.id ?? null
  } catch { /* logging is best-effort */ }

  const finish = async (status: string, message: string, rows?: number) => {
    if (logId != null) {
      try {
        await db.schema('qms' as any).from('eu_mrl_sync_log')
          .update({ status, message, rows_upserted: rows ?? null, finished_at: new Date().toISOString() })
          .eq('id', logId)
      } catch { /* ignore */ }
    }
  }

  if (!downloadUrl) {
    const msg = 'EU_MRL_DOWNLOAD_URL is not configured on the server.'
    await finish('error', msg)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  try {
    // ── Download the EU export ──
    const res = await fetch(downloadUrl, { headers: { Accept: '*/*' } })
    if (!res.ok) {
      const msg = `EU download failed: HTTP ${res.status}`
      await finish('error', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    const buf = await res.arrayBuffer()

    // ── Parse (xlsx handles both .xlsx and .csv) ──
    const rows = rowsFromWorkbook(buf)
    if (!rows.length) {
      const msg = 'EU export parsed to zero rows — check EU_MRL_DOWNLOAD_URL / format.'
      await finish('error', msg)
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    const headers = Object.keys(rows[0])
    const pestCol = headers.find(isPesticideHeader) ?? headers[0]
    const mrlCol = headers.find(isMrlHeader)
    if (!mrlCol) {
      const msg = `Could not find an MRL column in EU export. Headers: ${headers.join(', ')}`
      await finish('error', msg)
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    // ── Build upsert payload (last value wins per pesticide) ──
    const byPest = new Map<string, any>()
    for (const r of rows) {
      const pesticide = String(r[pestCol] ?? '').trim()
      if (!pesticide) continue
      const norm = normPesticide(pesticide)
      if (!norm) continue
      byPest.set(norm, {
        pesticide,
        pesticide_norm: norm,
        commodity_code: commodityCode,
        commodity: commodityName,
        mrl_mg_kg: parseMrlValue(r[mrlCol]),
        mrl_raw: String(r[mrlCol] ?? ''),
        source: 'eu_pesticides_db',
        synced_at: new Date().toISOString(),
      })
    }
    const payload = [...byPest.values()]

    // ── Upsert in chunks on the unique (pesticide_norm, commodity_code) key ──
    let upserted = 0
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500)
      const { error } = await db
        .schema('qms' as any)
        .from('eu_mrl')
        .upsert(chunk, { onConflict: 'pesticide_norm,commodity_code' })
      if (error) {
        await finish('error', error.message, upserted)
        return NextResponse.json({ error: error.message, upserted }, { status: 500 })
      }
      upserted += chunk.length
    }

    await finish('success', `Synced ${upserted} MRLs for ${commodityName}.`, upserted)
    return NextResponse.json({
      success: true,
      message: `Synced ${upserted} EU MRLs for ${commodityName}`,
      updated: upserted,
      commodity: commodityName,
    })
  } catch (e: any) {
    const msg = e?.message ?? 'Unexpected error during EU MRL sync'
    await finish('error', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

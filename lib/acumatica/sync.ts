// ══════════════════════════════════════════════════════════════════════════════
// lib/acumatica/sync.ts
//
// Incremental, read-only sync of an Acumatica Generic Inquiry into Supabase.
//
// THE ALGORITHM (high-water-mark incremental sync)
// ────────────────────────────────────────────────
//   1. Read the watermark — the newest LastModifiedOn we pulled last time.
//   2. Ask Acumatica for ONLY rows changed since then ($filter ... gt watermark),
//      oldest-first so we can advance the watermark safely.
//   3. Upsert those rows into acumatica.sync_rows (insert new / overwrite
//      changed), keyed on (inquiry, row_key).
//   4. Advance the watermark to the newest row we just saw.
//
// First run (no watermark) pulls everything; later runs pull only deltas.
// This NEVER writes to Acumatica — it only GETs from it and writes to Supabase.
//
// DB access goes through two SECURITY DEFINER functions in the `public` schema
// (acumatica_get_watermark / acumatica_apply_sync). They write into `acumatica`
// internally, so we don't depend on the `acumatica` schema being exposed to the
// Data API. See migration 20260615_002.
// ══════════════════════════════════════════════════════════════════════════════

import supabaseAdmin from '@/lib/supabase/admin'
import { getAcumaticaConfig, fetchInquiry } from './odata'

export interface SyncSummary {
  ok: boolean
  inquiry: string
  pulled: number              // rows Acumatica returned this run
  upserted: number            // rows written to Supabase
  previousWatermark: string | null
  newWatermark: string | null
  message: string
}

export async function syncInquiry(
  inquiry: string,
  keyField = 'Name',              // which field is the row's natural key
  modifiedField = 'LastModifiedOn', // which field drives the incremental filter
): Promise<SyncSummary> {
  const base = { inquiry, pulled: 0, upserted: 0, previousWatermark: null, newWatermark: null }

  const cfg = getAcumaticaConfig()
  if (!cfg) return { ...base, ok: false, message: 'Acumatica not configured (.env.local).' }

  // 1. Read the watermark via the public RPC (null on first ever run).
  const { data: wm, error: wmError } = await supabaseAdmin
    .rpc('acumatica_get_watermark', { p_inquiry: inquiry })
  if (wmError) {
    return { ...base, ok: false, message: `Could not read watermark: ${wmError.message}` }
  }
  const previousWatermark: string | null = (wm as string | null) ?? null

  // 2. Build read options: only rows changed since the watermark, oldest first.
  const opts = new URLSearchParams()
  if (previousWatermark) opts.set('$filter', `${modifiedField} gt ${previousWatermark}`)
  opts.set('$orderby', `${modifiedField} asc`)

  // 3. Fetch from Acumatica (read-only GET).
  const result = await fetchInquiry(cfg, inquiry, opts)
  if (!result.ok) {
    return { ...base, ok: false, previousWatermark, newWatermark: previousWatermark, message: result.message }
  }

  // 4. Shape rows for the RPC: [{ row_key, last_modified, data }, ...]
  const rows = result.rows
    .map((r) => ({
      row_key:       String((r as Record<string, unknown>)[keyField] ?? '').trim(),
      last_modified: ((r as Record<string, unknown>)[modifiedField] as string) ?? null,
      data:          r,
    }))
    .filter((r) => r.row_key)  // skip rows with no usable key

  // 5. Advance the watermark to the newest row we saw (compare as real dates).
  let newWatermark = previousWatermark
  for (const r of rows) {
    if (r.last_modified && (!newWatermark || new Date(r.last_modified) > new Date(newWatermark))) {
      newWatermark = r.last_modified
    }
  }

  // 6. Apply the run (upsert rows + advance watermark) via the public RPC.
  const { error: applyError } = await supabaseAdmin.rpc('acumatica_apply_sync', {
    p_inquiry:       inquiry,
    p_rows:          rows,
    p_new_watermark: newWatermark,
    p_row_count:     rows.length,
  })
  if (applyError) {
    return { ...base, ok: false, pulled: result.count ?? 0, previousWatermark, newWatermark: previousWatermark,
             message: `Fetched ${result.count} rows but DB write failed: ${applyError.message}` }
  }

  return {
    ok: true, inquiry,
    pulled: result.count ?? 0,
    upserted: rows.length,
    previousWatermark, newWatermark,
    message: rows.length ? `Synced ${rows.length} row(s).` : 'Up to date — no changes since last run.',
  }
}

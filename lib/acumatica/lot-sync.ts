// ══════════════════════════════════════════════════════════════════════════════
// lib/acumatica/lot-sync.ts
//
// Pull Lot Details (stock on hand by lot × item × warehouse) from Acumatica's
// contract-based REST endpoint and REPLACE the typed table acumatica.lot_details.
// Scoped to the BHW warehouse for now. Reads from Acumatica, writes only to
// Supabase — NEVER writes to Acumatica.
//
// Feeds: live stock-on-hand + ageing (via HarvestYear) + the grade-balance metric
// (SOH per grade via ItemClass/ProductGroup). Same full-replace + empty-fetch
// guard as sales-sync.ts; DB write goes through the SECURITY DEFINER RPC
// acumatica_replace_lot_details (migration 20260902_002).
// ══════════════════════════════════════════════════════════════════════════════

import supabaseAdmin from '@/lib/supabase/admin'
import { getAcumaticaRestConfig, acumaticaRest } from './rest'

const WAREHOUSE = 'BHW'

// Contract-REST fields arrive as { value: X } (or {} when empty). Unwrap safely.
function val(f: unknown): string | null {
  const v = (f as { value?: unknown } | null | undefined)?.value
  if (v === null || v === undefined || v === '') return null
  return String(v)
}
function num(f: unknown): number | null {
  const v = (f as { value?: unknown } | null | undefined)?.value
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function syncLotDetails(): Promise<{ ok: boolean; count: number; message: string }> {
  const cfg = getAcumaticaRestConfig()
  if (!cfg) return { ok: false, count: 0, message: 'Acumatica REST not configured (ACUMATICA_CLIENT_ID / ACUMATICA_CLIENT_SECRET).' }

  let data: unknown
  try {
    // PUT-with-filter is the endpoint's retrieval pattern (per the dev's spec).
    data = await acumaticaRest(cfg, 'PUT', 'LotDetail?$expand=LotDetailDetails', { Warehouse: { value: WAREHOUSE } })
  } catch (e) {
    return { ok: false, count: 0, message: e instanceof Error ? e.message : 'Acumatica REST call failed.' }
  }

  // Response is one or more LotDetail records, each carrying a LotDetailDetails[] array.
  const records = Array.isArray(data) ? data : [data]
  const details = records.flatMap((r) => (r as { LotDetailDetails?: unknown[] })?.LotDetailDetails ?? [])

  // Safety guard: never wipe the table on an empty/suspect fetch (mirrors sales-sync).
  if (details.length === 0) {
    return { ok: false, count: 0, message: 'Fetch returned 0 lot rows — skipped replace to protect existing data.' }
  }

  const rows = (details as Record<string, unknown>[]).map((d) => ({
    inventory_id:        val(d.InventoryID),
    description:         val(d.Description),
    item_category:       val(d.ItemCategory),
    item_class:          val(d.ItemClass),
    product_group:       val(d.ProductGroup),
    variant:             val(d.Variant),
    lot_serial_nbr:      val(d.LotSerialNbr),
    supplier_lot_number: val(d.SupplierLotNumber),
    harvest_year:        val(d.HarvestYear),
    warehouse_id:        val(d.WarehouseID),
    location_id:         val(d.LocationID),
    qty_on_hand:         num(d.QtyOnHand),
    qty_available:       num(d.QtyAvailable),
    tea_court:           val(d.TeaCourt),
    land_name:           val(d.LandName),
  }))

  const { data: cnt, error } = await supabaseAdmin.rpc('acumatica_replace_lot_details', { p_rows: rows })
  if (error) {
    return { ok: false, count: 0, message: `Fetched ${rows.length} lots but DB write failed: ${error.message}` }
  }

  const count = typeof cnt === 'number' ? cnt : rows.length
  return { ok: true, count, message: `Replaced lot_details with ${count} row(s) for ${WAREHOUSE}.` }
}

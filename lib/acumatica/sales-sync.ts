// ══════════════════════════════════════════════════════════════════════════════
// lib/acumatica/sales-sync.ts
//
// Pull the full CNTPSALESREPORT line set from Acumatica (read-only OData) and
// REPLACE the typed landing table acumatica.sales_lines in Supabase. The EXCO
// sales dashboard then reads from Supabase (history + consistent KPIs) instead
// of hitting Acumatica live on every load — see lib/acumatica/sales-actuals.ts.
//
// Full-replace (DELETE + INSERT) is fine for the ~700-row dataset and keeps the
// table an exact mirror of the GI. NEVER writes to Acumatica.
//
// DB write goes through the public SECURITY DEFINER RPC acumatica_replace_sales_lines
// (migration 20260615_004), so we don't depend on the `acumatica` schema being
// exposed to the Data API.
// ══════════════════════════════════════════════════════════════════════════════

import supabaseAdmin from '@/lib/supabase/admin'
import { getAcumaticaConfig, fetchInquiry } from './odata'

const INQUIRY = 'CNTPSALESREPORT'
// Same $select list as sales-actuals.ts so the table mirrors the live aggregation.
const SELECT = 'CustomerName,CountryName,Market,Currency,Date,InventoryID,Description,Quantity,BaseQty,ARTran_extPrice,ARTran_unitCost'

// Safe Number() coercion (null/blank/garbage → null so numeric columns stay clean).
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s === '' ? null : s
}

export async function syncSalesLines(): Promise<{ ok: boolean; count: number; message: string }> {
  const cfg = getAcumaticaConfig()
  if (!cfg) return { ok: false, count: 0, message: 'Acumatica not configured (.env.local).' }

  const opts = new URLSearchParams()
  opts.set('$top', '10000')
  opts.set('$select', SELECT)

  const res = await fetchInquiry(cfg, INQUIRY, opts)
  if (!res.ok) return { ok: false, count: 0, message: res.message }

  // Safety guard: never wipe the table on an empty/suspect fetch. A successful
  // pull of the sales report should always have rows; 0 means a hiccup, so we
  // skip the full-replace and leave the existing mirror intact.
  if (res.rows.length === 0) {
    return { ok: false, count: 0, message: 'Fetch returned 0 rows — skipped replace to protect existing data.' }
  }

  const rows = (res.rows as Record<string, unknown>[]).map((r) => ({
    customer_name: str(r.CustomerName),
    country_name:  str(r.CountryName),
    market:        str(r.Market),
    currency:      str(r.Currency),
    txn_date:      str(r.Date),               // raw Acumatica date string; cast to timestamptz in the RPC
    inventory_id:  str(r.InventoryID),
    description:   str(r.Description),
    quantity:      num(r.Quantity),
    base_qty:      num(r.BaseQty),
    ext_price:     num(r.ARTran_extPrice),
    unit_cost:     num(r.ARTran_unitCost),
  }))

  const { data, error } = await supabaseAdmin.rpc('acumatica_replace_sales_lines', { p_rows: rows })
  if (error) {
    return { ok: false, count: 0, message: `Fetched ${rows.length} rows but DB write failed: ${error.message}` }
  }

  const count = typeof data === 'number' ? data : rows.length
  return { ok: true, count, message: `Replaced sales_lines with ${count} row(s) from ${INQUIRY}.` }
}

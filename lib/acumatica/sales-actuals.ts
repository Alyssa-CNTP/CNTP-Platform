// ══════════════════════════════════════════════════════════════════════════════
// lib/acumatica/sales-actuals.ts
//
// Sales ACTUALS for the EXCO dashboard, aggregated from the Acumatica
// CNTPSALESREPORT Generic Inquiry (line-level invoiced AR transactions).
//
// DATA SOURCE: reads from Supabase (acumatica.sales_lines, populated by the sync
// in lib/acumatica/sales-sync.ts) so KPIs are consistent and we keep history. If
// Supabase errors OR has no rows for the year, it FALLS BACK to live Acumatica
// OData. The aggregation logic is identical for both paths — only the source of
// the normalized lines differs. meta.source tells you which path served the data.
//
// CURRENCY: the GI carries both base (ZAR) and document-currency fields. The
// dashboard is all-ZAR, so we use the BASE-currency columns:
//   revenue (ZAR) = ARTran_extPrice / ext_price       (already extended)
//   cost    (ZAR) = ARTran_unitCost / unit_cost * Quantity
//   volume  (kg)  = BaseQty / base_qty
//
// SCOPE: the raw GI includes freight, other income, asset sales, contract
// processing, etc. — broader than the curated EXCO "tea sales" view. We classify
// each line into a category and let the caller choose which to include, so the
// dashboard scope is filterable rather than hardcoded.
//
// Read-only. Targets/OKRs/customer-classifications are NOT here (forecast layer).
// ══════════════════════════════════════════════════════════════════════════════

import supabaseAdmin from '@/lib/supabase/admin'
import { getAcumaticaConfig, fetchInquiry } from './odata'

const INQUIRY = 'CNTPSALESREPORT'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export type SalesCategory = 'product' | 'contract' | 'freight' | 'other'
export const SALES_CATEGORIES: SalesCategory[] = ['product', 'contract', 'freight', 'other']
export const DEFAULT_INCLUDE: SalesCategory[] = ['product']  // matches the curated EXCO tea-sales view

// A single sales line, normalized to camelCase regardless of source (Supabase
// snake_case row or live Acumatica OData row). All aggregation reads these fields.
interface SalesLine {
  customerName: string
  countryName: string
  market: string
  currency: string
  date: string
  inventoryId: string
  description: string
  quantity: number
  baseQty: number
  extPrice: number
  unitCost: number
}

// Classify a line by its item. Description-based; falls back to InventoryID.
function classify(description: string, inventoryId: string): SalesCategory {
  const d = `${description} ${inventoryId}`.toLowerCase()
  if (/freight/.test(d)) return 'freight'
  if (/^contract processing/.test(d.trim())) return 'contract'
  if (/other income|sale of asset|^income:|pallet|^bag:|\bmetal\b|finished product shell/.test(d)) return 'other'
  return 'product'
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return String(v ?? '')
}

// Normalize a live Acumatica OData row → SalesLine.
function normalizeLive(r: Record<string, unknown>): SalesLine {
  return {
    customerName: str(r.CustomerName),
    countryName:  str(r.CountryName),
    market:       str(r.Market),
    currency:     str(r.Currency),
    date:         str(r.Date),
    inventoryId:  str(r.InventoryID),
    description:  str(r.Description),
    quantity:     num(r.Quantity),
    baseQty:      num(r.BaseQty),
    extPrice:     num(r.ARTran_extPrice),
    unitCost:     num(r.ARTran_unitCost),
  }
}

// Normalize a Supabase acumatica.sales_lines row (snake_case) → SalesLine.
function normalizeSupabase(r: Record<string, unknown>): SalesLine {
  return {
    customerName: str(r.customer_name),
    countryName:  str(r.country_name),
    market:       str(r.market),
    currency:     str(r.currency),
    date:         str(r.txn_date),
    inventoryId:  str(r.inventory_id),
    description:  str(r.description),
    quantity:     num(r.quantity),
    baseQty:      num(r.base_qty),
    extPrice:     num(r.ext_price),
    unitCost:     num(r.unit_cost),
  }
}

export interface SalesActuals {
  kpi: {
    totalRevenue: number; totalCost: number; grossMargin: number; marginPct: number
    volumeKg: number; avgRevPerKg: number
    exportRevenue: number; localRevenue: number
    activeSkus: number; activeCustomers: number
  }
  monthly: { month: string; actualRev: number; actualVol: number; gp: number }[]
  customers: {
    name: string; region: string; market: string
    ytdRev: number; ytdCost: number; ytdVol: number; ytdGP: number | null
  }[]
  products: { sku: string; monthly: Record<string, number>; ytd: number; pct: number }[]
  // Per-category breakdown across ALL rows (not just included) — drives the toggle UI.
  categories: { category: SalesCategory; revenue: number; volume: number; rows: number }[]
  meta: { inquiry: string; year: number; rows: number; include: SalesCategory[]; source: 'supabase' | 'live'; generatedAt: string }
}

// ── Aggregation ────────────────────────────────────────────────────────────────
// All KPI/monthly/customers/products/categories logic lives here, reading the
// normalized SalesLine fields. Source-agnostic — formulas unchanged from the
// original live-only implementation.
function aggregate(lines: SalesLine[], year: number, include: SalesCategory[], source: 'supabase' | 'live'): SalesActuals {
  const yearRows = lines.filter((l) => l.date.startsWith(String(year)))

  // Category breakdown across ALL year rows (for the toggle UI).
  const catAgg = new Map<SalesCategory, { revenue: number; volume: number; rows: number }>()
  for (const l of yearRows) {
    const cat = classify(l.description, l.inventoryId)
    const a = catAgg.get(cat) ?? { revenue: 0, volume: 0, rows: 0 }
    a.revenue += l.extPrice; a.volume += l.baseQty; a.rows += 1
    catAgg.set(cat, a)
  }
  const categories = SALES_CATEGORIES.map((category) => ({
    category, ...(catAgg.get(category) ?? { revenue: 0, volume: 0, rows: 0 }),
  }))

  // Aggregate only the INCLUDED categories.
  const incl = new Set(include)
  const rows = yearRows.filter((l) => incl.has(classify(l.description, l.inventoryId)))

  let totalRevenue = 0, totalCost = 0, volumeKg = 0, exportRevenue = 0, localRevenue = 0
  const monthly = MONTHS.map((m) => ({ month: m, actualRev: 0, actualVol: 0, gp: 0 }))
  const custMap = new Map<string, { name: string; region: string; market: string; ytdRev: number; ytdCost: number; ytdVol: number }>()
  const prodMap = new Map<string, { sku: string; monthly: Record<string, number>; ytd: number }>()
  const skus = new Set<string>()

  for (const l of rows) {
    const revenue = l.extPrice
    const cost    = l.unitCost * l.quantity
    const vol     = l.baseQty
    const monthIx = new Date(l.date).getUTCMonth()
    const market  = l.market.trim()
    const custName = l.customerName.trim() || '(unknown)'
    const sku     = (l.description || l.inventoryId).trim() || '(unknown)'

    totalRevenue += revenue; totalCost += cost; volumeKg += vol
    if (/export/i.test(market)) exportRevenue += revenue
    else if (/local/i.test(market)) localRevenue += revenue

    if (monthIx >= 0 && monthIx < 12) {
      monthly[monthIx].actualRev += revenue
      monthly[monthIx].actualVol += vol
      monthly[monthIx].gp        += revenue - cost
    }

    const c = custMap.get(custName) ?? { name: custName, region: l.countryName.trim(), market, ytdRev: 0, ytdCost: 0, ytdVol: 0 }
    c.ytdRev += revenue; c.ytdCost += cost; c.ytdVol += vol
    custMap.set(custName, c)

    const p = prodMap.get(sku) ?? { sku, monthly: {}, ytd: 0 }
    if (monthIx >= 0 && monthIx < 12) p.monthly[MONTHS[monthIx]] = (p.monthly[MONTHS[monthIx]] ?? 0) + vol
    p.ytd += vol
    prodMap.set(sku, p)

    if (l.inventoryId) skus.add(l.inventoryId)
  }

  const grossMargin = totalRevenue - totalCost
  const customers = [...custMap.values()]
    .map((c) => ({ ...c, ytdGP: c.ytdRev > 0 ? (c.ytdRev - c.ytdCost) / c.ytdRev : null }))
    .sort((a, b) => b.ytdRev - a.ytdRev)
  const products = [...prodMap.values()]
    .map((p) => ({ ...p, pct: volumeKg > 0 ? p.ytd / volumeKg : 0 }))
    .sort((a, b) => b.ytd - a.ytd)

  return {
    kpi: {
      totalRevenue, totalCost, grossMargin,
      marginPct:   totalRevenue > 0 ? grossMargin / totalRevenue : 0,
      volumeKg,    avgRevPerKg: volumeKg > 0 ? totalRevenue / volumeKg : 0,
      exportRevenue, localRevenue,
      activeSkus: skus.size, activeCustomers: customers.length,
    },
    monthly, customers, products, categories,
    meta: { inquiry: INQUIRY, year, rows: rows.length, include, source, generatedAt: new Date().toISOString() },
  }
}

export async function getSalesActuals(
  year: number,
  include: SalesCategory[] = DEFAULT_INCLUDE,
): Promise<{ ok: boolean; data?: SalesActuals; message: string }> {
  // ── Primary: read from Supabase (acumatica.sales_lines via public RPC). ───────
  const { data: sbRows, error: sbError } = await supabaseAdmin
    .rpc('acumatica_get_sales_lines', { p_year: year })

  if (!sbError && Array.isArray(sbRows) && sbRows.length > 0) {
    const lines = (sbRows as Record<string, unknown>[]).map(normalizeSupabase)
    const data = aggregate(lines, year, include, 'supabase')
    return {
      ok: true,
      message: `Aggregated ${data.meta.rows}/${lines.length} rows for ${year} from Supabase (include: ${include.join(', ')}).`,
      data,
    }
  }

  // ── Fallback: live Acumatica OData (Supabase errored or had no rows). ─────────
  const cfg = getAcumaticaConfig()
  if (!cfg) {
    const hint = sbError ? ` (Supabase: ${sbError.message})` : ' (Supabase returned 0 rows)'
    return { ok: false, message: `Acumatica not configured (.env.local) and no Supabase data${hint}.` }
  }

  const opts = new URLSearchParams()
  opts.set('$top', '10000')
  opts.set('$select', 'CustomerName,CountryName,Market,Currency,Date,InventoryID,Description,Quantity,BaseQty,ARTran_extPrice,ARTran_unitCost')

  const res = await fetchInquiry(cfg, INQUIRY, opts)
  if (!res.ok) return { ok: false, message: res.message }

  const lines = (res.rows as Record<string, unknown>[]).map(normalizeLive)
  const data = aggregate(lines, year, include, 'live')
  return {
    ok: true,
    message: `Aggregated ${data.meta.rows}/${lines.filter((l) => l.date.startsWith(String(year))).length} rows for ${year} from live OData (include: ${include.join(', ')}).`,
    data,
  }
}

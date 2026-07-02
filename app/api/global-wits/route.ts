// app/api/global-wits/route.ts
// Receives pre-parsed trade rows from the client → bulk upserts in 3 DB calls

import { NextResponse }      from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient }       from '@supabase/supabase-js'
import { cookies }            from 'next/headers'

export const maxDuration = 60

const ALLOWED = ['IT', 'Sales', 'Management', 'Marketing']

const salesDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'sales' } }
)

interface NormalisedRow {
  purchaser: string; supplier: string; country: string; product: string
  value_usd: number; weight_kg: number; date: string; datasource: string; hs_code: string
}

interface CompanyData {
  name: string; country: string; supplier: string; total_usd: number; shipments: NormalisedRow[]
}

function groupByCompany(rows: NormalisedRow[]): CompanyData[] {
  const map = new Map<string, CompanyData>()
  for (const r of rows) {
    const key = r.purchaser.toLowerCase()
    if (!map.has(key)) map.set(key, { name: r.purchaser, country: r.country, supplier: r.supplier, total_usd: 0, shipments: [] })
    const c = map.get(key)!
    c.total_usd += r.value_usd
    c.shipments.push(r)
    if (!c.country && r.country) c.country = r.country
  }
  return Array.from(map.values())
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appRole } = await supabase
    .schema('shared' as any).from('app_roles')
    .select('department, permissions').eq('user_id', user.id).single()

  const dept      = (appRole as any)?.department as string | null
  const overrides = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
  if (!ALLOWED.includes(dept ?? '') && !overrides['can_access_sales']) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.rows || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'rows array required' }, { status: 400 })
  }

  const rows: NormalisedRow[]  = body.rows
  const filename: string       = body.filename ?? 'unknown.xlsx'
  const companies              = groupByCompany(rows)

  if (!companies.length) {
    return NextResponse.json({ error: 'No purchaser/consignee data found' }, { status: 400 })
  }

  // ── 1. Bulk upsert company_profiles (1 call) ─────────────────────────────
  const profileRows = companies.map(co => ({
    company_name:  co.name,
    country:       co.country,
    sector:        'tea/beverage',
    pitch_angle:   co.supplier
      ? `Currently buying from ${co.supplier} — pitch CNTP rooibos as a premium alternative.`
      : `Active buyer in ${co.country || 'this market'} — introduce CNTP rooibos range.`,
    panjiva_data:  {
      shipments:        co.shipments.map(s => ({ date: s.date, datasource: s.datasource, supplier: s.supplier, hs_code: s.hs_code, product: s.product, value_usd: s.value_usd, weight_kg: s.weight_kg })),
      total_value_usd:  co.total_usd,
      shipment_count:   co.shipments.length,
      current_supplier: co.supplier,
    },
    last_enriched: new Date().toISOString(),
  }))

  await salesDb.from('company_profiles')
    .upsert(profileRows, { onConflict: 'company_name', ignoreDuplicates: false })

  // ── 2. Bulk upsert accounts (1 call) ─────────────────────────────────────
  const accountRows = companies.map(co => ({
    name:         co.name,
    country:      co.country,
    account_type: 'prospect',
    stage:        'lead',
    tags:         ['trade-data'],
    sales_angle:  co.supplier
      ? `Currently buying from ${co.supplier} — pitch CNTP rooibos as a premium alternative.`
      : `Active buyer in ${co.country || 'this market'} — introduce CNTP rooibos range.`,
    notes:        `Imported from Global Wits: ${filename}`,
  }))

  await salesDb.from('accounts')
    .upsert(accountRows, { onConflict: 'name', ignoreDuplicates: false })

  // ── 3. Bulk upsert signals (1 call) ──────────────────────────────────────
  const signalRows = companies.map(co => ({
    source_type:     'trade',
    source_url:      `gwits://${co.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title:           `Trade buyer: ${co.name} (${co.country})`,
    summary_en:      `${co.name} in ${co.country} has ${co.shipments.length} recorded shipment(s)${co.supplier ? ` from ${co.supplier}` : ''}. Total value: $${co.total_usd.toLocaleString()}.`,
    classification:  'opportunity',
    relevance_score: co.total_usd > 10000 ? 8 : co.total_usd > 1000 ? 6 : 5,
    region:          co.country,
    keyword_group:   'trade',
    sales_angle:     co.supplier
      ? `Currently buying from ${co.supplier} — pitch CNTP rooibos as a premium alternative.`
      : `Active buyer in ${co.country || 'this market'} — introduce CNTP rooibos range.`,
    urgency:         'medium',
    intel:           {},
  }))

  await salesDb.from('signals')
    .upsert(signalRows, { onConflict: 'source_url', ignoreDuplicates: true })

  // ── 4. Log vault document ────────────────────────────────────────────────
  await salesDb.from('vault_documents').insert({
    uploaded_by: user.id, filename, source: 'global_wits',
    row_count: rows.length, company_count: companies.length,
    notes: `Trade file — ${companies.length} companies, ${rows.length} shipment rows`,
  })

  // ── 5. Build overview analytics ─────────────────────────────────────────
  const countryMap = new Map<string, { count: number; value_usd: number }>()
  for (const co of companies) {
    const c = co.country || 'Unknown'
    const e = countryMap.get(c) ?? { count: 0, value_usd: 0 }
    e.count++; e.value_usd += co.total_usd
    countryMap.set(c, e)
  }
  const top_countries = Array.from(countryMap.entries())
    .map(([country, v]) => ({ country, ...v }))
    .sort((a, b) => b.count - a.count).slice(0, 8)

  const top_buyers = companies
    .sort((a, b) => b.total_usd - a.total_usd)
    .slice(0, 8)
    .map(co => ({ name: co.name, country: co.country, value_usd: co.total_usd, shipments: co.shipments.length }))

  const dsMap = new Map<string, number>()
  for (const r of rows) { dsMap.set(r.datasource || 'Unknown', (dsMap.get(r.datasource || 'Unknown') ?? 0) + 1) }
  const datasources = Array.from(dsMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)

  return NextResponse.json({
    ok: true, rows_parsed: rows.length, companies: companies.length,
    created: companies.length, updated: 0, filename,
    top_countries, top_buyers, datasources,
  })
}

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const companyName = url.searchParams.get('company')

  // ── Company drill-down ────────────────────────────────────────────────────
  if (companyName) {
    const { data } = await salesDb
      .from('company_profiles')
      .select('company_name, country, panjiva_data, pitch_angle, last_enriched')
      .eq('company_name', companyName)
      .single()
    return NextResponse.json({ profile: data ?? null })
  }

  // ── Overview: import history + live DB aggregates ─────────────────────────
  const [{ data: docs }, { data: profiles }] = await Promise.all([
    salesDb.from('vault_documents')
      .select('id, filename, row_count, company_count, notes, created_at')
      .eq('source', 'global_wits').order('created_at', { ascending: false }).limit(20),
    salesDb.from('company_profiles')
      .select('company_name, country, panjiva_data')
      .not('panjiva_data', 'is', null)
      .limit(2000),
  ])

  const countryMap = new Map<string, { count: number; value_usd: number }>()
  let totalValue = 0; let totalShipments = 0
  for (const p of profiles ?? []) {
    const pd = (p.panjiva_data ?? {}) as any
    const v = pd.total_value_usd ?? 0; const s = pd.shipment_count ?? 0
    totalValue += v; totalShipments += s
    const c = p.country || 'Unknown'
    const e = countryMap.get(c) ?? { count: 0, value_usd: 0 }
    e.count++; e.value_usd += v; countryMap.set(c, e)
  }
  const top_countries = Array.from(countryMap.entries())
    .map(([country, v]) => ({ country, ...v }))
    .sort((a, b) => b.count - a.count).slice(0, 10)

  const top_buyers = (profiles ?? [])
    .map(p => ({
      name:      p.company_name,
      country:   p.country,
      value_usd: (p.panjiva_data as any)?.total_value_usd ?? 0,
      shipments: (p.panjiva_data as any)?.shipment_count  ?? 0,
    }))
    .sort((a, b) => b.value_usd - a.value_usd).slice(0, 10)

  return NextResponse.json({
    imports: docs ?? [],
    stats: {
      total_companies: profiles?.length ?? 0,
      total_value_usd: totalValue,
      total_shipments: totalShipments,
    },
    top_countries,
    top_buyers,
  })
}

// app/api/global-wits/route.ts
// Receives pre-parsed trade rows from the client → upserts company_profiles, accounts, signals

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
  purchaser:  string
  supplier:   string
  country:    string
  product:    string
  value_usd:  number
  weight_kg:  number
  date:       string
  datasource: string
  hs_code:    string
}

interface CompanyData {
  name:      string
  country:   string
  supplier:  string
  total_usd: number
  shipments: NormalisedRow[]
}

function groupByCompany(rows: NormalisedRow[]): CompanyData[] {
  const map = new Map<string, CompanyData>()
  for (const r of rows) {
    const key = r.purchaser.toLowerCase()
    if (!map.has(key)) {
      map.set(key, { name: r.purchaser, country: r.country, supplier: r.supplier, total_usd: 0, shipments: [] })
    }
    const c = map.get(key)!
    c.total_usd += r.value_usd
    c.shipments.push(r)
    if (!c.country && r.country) c.country = r.country
  }
  return Array.from(map.values())
}

// ── POST: receive parsed rows + filename, write to DB ─────────────────────────

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
    .schema('shared' as any)
    .from('app_roles')
    .select('department, permissions')
    .eq('user_id', user.id)
    .single()

  const dept      = (appRole as any)?.department as string | null
  const overrides = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
  const canAccess = ALLOWED.includes(dept ?? '') || overrides['can_access_sales'] === true
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.rows || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'rows array required' }, { status: 400 })
  }

  const rows: NormalisedRow[] = body.rows
  const filename: string = body.filename ?? 'unknown.xlsx'
  const companies = groupByCompany(rows)

  if (companies.length === 0) {
    return NextResponse.json({ error: 'No purchaser/consignee data found in file' }, { status: 400 })
  }

  // ── Log vault document ─────────────────────────────────────────────────────
  await salesDb.from('vault_documents').insert({
    uploaded_by:   user.id,
    filename,
    source:        'global_wits',
    row_count:     rows.length,
    company_count: companies.length,
    notes:         `Trade file — ${companies.length} companies, ${rows.length} shipment rows`,
  })

  // ── Upsert per company ─────────────────────────────────────────────────────
  let created = 0, updated = 0
  const signalInserts: any[] = []

  for (const co of companies) {
    const panjiva = {
      shipments:        co.shipments.map(s => ({
        date: s.date, datasource: s.datasource, supplier: s.supplier,
        hs_code: s.hs_code, product: s.product, value_usd: s.value_usd, weight_kg: s.weight_kg,
      })),
      total_value_usd:  co.total_usd,
      shipment_count:   co.shipments.length,
      current_supplier: co.supplier,
    }

    const salesAngle = co.supplier
      ? `Currently buying from ${co.supplier} — pitch CNTP rooibos as a premium, appellation-protected alternative.`
      : `Active buyer in ${co.country || 'this market'} — qualify product fit and introduce CNTP rooibos range.`

    const { data: profile } = await salesDb
      .from('company_profiles')
      .upsert(
        { company_name: co.name, country: co.country, sector: 'tea/beverage', panjiva_data: panjiva, pitch_angle: salesAngle, last_enriched: new Date().toISOString() },
        { onConflict: 'company_name', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (!profile) continue

    const { data: account, error: accountErr } = await salesDb
      .from('accounts')
      .upsert(
        { name: co.name, country: co.country, account_type: 'prospect', stage: 'lead', tags: ['trade-data'], sales_angle: salesAngle, notes: `Imported from Global Wits: ${filename}` },
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (accountErr || !account) { updated++; continue }

    created++
    signalInserts.push({
      source_type:     'trade',
      source_url:      `gwits://${co.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title:           `Trade buyer: ${co.name} (${co.country})`,
      summary_en:      `${co.name} in ${co.country} has ${co.shipments.length} recorded shipment(s) of tea products${co.supplier ? ` from ${co.supplier}` : ''}. Total value: $${co.total_usd.toLocaleString()}.`,
      classification:  'opportunity',
      relevance_score: co.total_usd > 10000 ? 8 : co.total_usd > 1000 ? 6 : 5,
      region:          co.country,
      keyword_group:   'trade',
      sales_angle:     salesAngle,
      urgency:         'medium',
      intel:           { account_id: (account as any).id, company_profile_id: (profile as any).id },
    })
  }

  if (signalInserts.length > 0) {
    await salesDb.from('signals').upsert(signalInserts, { onConflict: 'source_url', ignoreDuplicates: true })
  }

  return NextResponse.json({ ok: true, rows_parsed: rows.length, companies: companies.length, created, updated, filename })
}

// ── GET: list previous imports ─────────────────────────────────────────────────

export async function GET() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await salesDb
    .from('vault_documents')
    .select('id, filename, row_count, company_count, notes, created_at')
    .eq('source', 'global_wits')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ imports: data ?? [] })
}

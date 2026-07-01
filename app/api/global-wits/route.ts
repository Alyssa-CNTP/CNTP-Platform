// app/api/global-wits/route.ts
// Parse Global Wits trade .xlsx files → company_profiles + accounts + trade signals

import { NextResponse }      from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient }       from '@supabase/supabase-js'
import { cookies }            from 'next/headers'
import * as XLSX              from 'xlsx'

export const maxDuration = 60

const ALLOWED = ['IT', 'Sales', 'Management', 'Marketing']

const salesDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'sales' } }
)

// ─── Sheet normalisers ─────────────────────────────────────────────────────────

interface NormalisedRow {
  purchaser:    string
  supplier:     string
  country:      string
  product:      string
  value_usd:    number
  weight_kg:    number
  date:         string
  datasource:   string
  hs_code:      string
}

function normHscode(rows: any[]): NormalisedRow[] {
  return rows
    .filter(r => r['PURCHASER'] && String(r['PURCHASER']).trim())
    .map(r => ({
      purchaser:  String(r['PURCHASER'] ?? '').trim(),
      supplier:   String(r['SUPPLIER']  ?? '').trim(),
      country:    String(r['PURCHASING COUNTRY'] ?? r['COUNTRY OF ORIGIN'] ?? '').trim(),
      product:    String(r['PRODUCT DESCRIPTION'] ?? '').trim().slice(0, 300),
      value_usd:  Number(r['TOTAL VALUE($)']  ?? 0),
      weight_kg:  Number(r['WEIGHT(KG)']       ?? 0),
      date:       r['DATES'] ? String(r['DATES']).slice(0, 10) : '',
      datasource: String(r['DATASOURCE'] ?? '').trim(),
      hs_code:    String(r['HS CODE']    ?? '').trim(),
    }))
}

function normUs(rows: any[]): NormalisedRow[] {
  return rows
    .filter(r => r['CONSIGNEE'] && String(r['CONSIGNEE']).trim() && String(r['CONSIGNEE']).trim().toUpperCase() !== 'NONE')
    .map(r => ({
      purchaser:  String(r['CONSIGNEE'] ?? '').trim(),
      supplier:   String(r['SHIPPER']   ?? '').trim(),
      country:    'UNITED STATES',
      product:    String(r['PRODUCT DESCRIPTION'] ?? '').trim().slice(0, 300),
      value_usd:  Number(r['KILO WEIGHT PER PRODUCT'] ?? 0),
      weight_kg:  Number(r['KILO WEIGHT PER PRODUCT'] ?? 0),
      date:       r['ACT ARRIVAL DATE '] ? String(r['ACT ARRIVAL DATE ']).slice(0, 10) : '',
      datasource: 'US Customs',
      hs_code:    '',
    }))
}

function normGlobal(rows: any[]): NormalisedRow[] {
  return rows
    .filter(r => r['CONSIGNEE'] && String(r['CONSIGNEE']).trim())
    .map(r => ({
      purchaser:  String(r['CONSIGNEE'] ?? '').trim(),
      supplier:   String(r['SHIPPER']   ?? '').trim(),
      country:    String(r['DESTINATION COUNTRY'] ?? '').trim(),
      product:    String(r['PRODUCT DESCRIPTION'] ?? '').trim().slice(0, 300),
      value_usd:  Number(r['GROSS WEIGHT'] ?? 0),
      weight_kg:  Number(r['GROSS WEIGHT'] ?? 0),
      date:       r['MONTHS'] ? String(r['MONTHS']) : '',
      datasource: 'Global Shipping',
      hs_code:    '',
    }))
}

function parseWorkbook(buffer: Buffer): NormalisedRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const rows: NormalisedRow[] = []

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const data  = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    const lower = name.toLowerCase()

    if (lower.includes('hscode') || lower.includes('rooibos')) {
      rows.push(...normHscode(data))
    } else if (lower.includes('us')) {
      rows.push(...normUs(data))
    } else if (lower.includes('global') || lower.includes('shipping')) {
      rows.push(...normGlobal(data))
    }
  }

  return rows
}

// ─── Group rows by purchaser ───────────────────────────────────────────────────

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

// ─── Handler ───────────────────────────────────────────────────────────────────

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

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'No form data' }, { status: 400 })

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'xlsx' && ext !== 'xls') {
    return NextResponse.json({ error: 'Only .xlsx files are supported' }, { status: 400 })
  }

  const buffer  = Buffer.from(await file.arrayBuffer())
  const rows    = parseWorkbook(buffer)
  const companies = groupByCompany(rows)

  if (companies.length === 0) {
    return NextResponse.json({ error: 'No purchaser/consignee data found in file' }, { status: 400 })
  }

  // ── Store vault document ───────────────────────────────────────────────────
  await salesDb.from('vault_documents').insert({
    uploaded_by:  user.id,
    filename:     file.name,
    source:       'global_wits',
    row_count:    rows.length,
    company_count: companies.length,
    notes:        `Trade file — ${companies.length} companies, ${rows.length} shipment rows`,
  }).select('id').single()

  // ── Upsert company_profiles + accounts + signals ───────────────────────────
  let created = 0, updated = 0
  const signalInserts: any[] = []

  for (const co of companies) {
    const panjiva = {
      shipments:    co.shipments.map(s => ({
        date:        s.date,
        datasource:  s.datasource,
        supplier:    s.supplier,
        hs_code:     s.hs_code,
        product:     s.product,
        value_usd:   s.value_usd,
        weight_kg:   s.weight_kg,
      })),
      total_value_usd:  co.total_usd,
      shipment_count:   co.shipments.length,
      current_supplier: co.supplier,
    }

    const salesAngle = co.supplier
      ? `Currently buying from ${co.supplier} — pitch CNTP rooibos as a premium, appellation-protected alternative.`
      : `Active buyer in ${co.country || 'this market'} — qualify product fit and introduce CNTP rooibos range.`

    // Upsert company_profile
    const { data: profile, error: profileErr } = await salesDb
      .from('company_profiles')
      .upsert(
        { company_name: co.name, country: co.country, sector: 'tea/beverage', panjiva_data: panjiva, pitch_angle: salesAngle, last_enriched: new Date().toISOString() },
        { onConflict: 'company_name', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (profileErr) continue

    // Upsert account
    const { data: account, error: accountErr } = await salesDb
      .from('accounts')
      .upsert(
        { name: co.name, country: co.country, account_type: 'prospect', stage: 'lead', tags: ['trade-data'], sales_angle: salesAngle, notes: `Imported from Global Wits trade file: ${file.name}` },
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (!accountErr && account) {
      // Link profile → account
      await salesDb.from('company_profiles').update({ account_id: (profile as any).id }).eq('id', (profile as any).id)
      created++

      // Queue trade signal
      signalInserts.push({
        source_type:     'trade',
        source_url:      `gwits://${co.name.toLowerCase().replace(/\s+/g, '-')}`,
        title:           `Trade buyer: ${co.name} (${co.country})`,
        summary_en:      `${co.name} in ${co.country} has imported ${co.shipments.length} shipment(s) of tea/bubble tea products${co.supplier ? ` from ${co.supplier}` : ''}. Total recorded value: $${co.total_usd.toLocaleString()}.`,
        classification:  'opportunity',
        relevance_score: co.total_usd > 10000 ? 8 : co.total_usd > 1000 ? 6 : 5,
        region:          co.country,
        keyword_group:   'trade',
        sales_angle:     salesAngle,
        urgency:         'medium',
        intel:           { account_id: (account as any).id, company_profile_id: (profile as any).id },
      })
    } else {
      updated++
    }
  }

  // Bulk insert signals (ignore duplicate source_url)
  if (signalInserts.length > 0) {
    await salesDb.from('signals').upsert(signalInserts, { onConflict: 'source_url', ignoreDuplicates: true })
  }

  return NextResponse.json({
    ok:           true,
    rows_parsed:  rows.length,
    companies:    companies.length,
    created,
    updated,
    filename:     file.name,
  })
}

// ── List previous imports ──────────────────────────────────────────────────────

export async function GET(req: Request) {
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

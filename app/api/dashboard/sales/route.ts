// app/api/dashboard/sales/route.ts
// GET /api/dashboard/sales?year=2026
//
// Live sales ACTUALS for the EXCO dashboard, aggregated from Acumatica
// (CNTPSALESREPORT). Read-only. Gated to Sales/Management/IT/Marketing (same
// access rule as /api/sales). Results cached in-memory for 5 min so repeated
// dashboard loads don't re-hit Acumatica each time.

import { NextResponse }               from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getSalesActuals, SALES_CATEGORIES, DEFAULT_INCLUDE, type SalesActuals, type SalesCategory } from '@/lib/acumatica/sales-actuals'

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; data: SalesActuals }>()

export async function GET(req: Request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Access: Sales / Management / IT / Marketing, or explicit permission ────
  const { data: appRole } = await supabase
    .schema('shared' as any)
    .from('app_roles')
    .select('department, permissions')
    .eq('user_id', user.id)
    .single()
  const dept      = (appRole as any)?.department as string | null
  const overrides = ((appRole as any)?.permissions ?? {}) as Record<string, boolean>
  const canAccess = ['IT', 'Sales', 'Management', 'Marketing'].includes(dept ?? '')
                    || overrides['can_access_sales'] === true
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── Inputs ─────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') ?? '', 10) || new Date().getFullYear()
  const fresh = searchParams.get('fresh') === '1'

  // include=product,contract,freight,other — defaults to the curated tea-sales view.
  const raw = (searchParams.get('include') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const include = (raw.filter((c): c is SalesCategory => (SALES_CATEGORIES as string[]).includes(c)))
  const scope = include.length ? include : DEFAULT_INCLUDE

  // ── Cache (keyed by year + scope) ──────────────────────────────────────────
  const key = `${year}|${[...scope].sort().join(',')}`
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.data, meta: { ...hit.data.meta, cached: true } })
  }

  const result = await getSalesActuals(year, scope)
  if (!result.ok || !result.data) {
    return NextResponse.json({ error: result.message }, { status: 502 })
  }

  cache.set(key, { at: Date.now(), data: result.data })
  return NextResponse.json(result.data)
}

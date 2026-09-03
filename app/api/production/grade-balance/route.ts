// app/api/production/grade-balance/route.ts
// GET /api/production/grade-balance
//
// Acumatica stock-on-hand aggregated for the production dashboard's Balance tab:
// SOH by grade family (product_group), stock ageing by harvest year, and totals.
// Reads acumatica.lot_details (BHW) via the SECURITY DEFINER RPC. Read-only.
//
// Feeds the "grade flow & balance" reconciliation: raw → produced (floor) → stock
// (this) → sold. The floor-output side comes from /api/production/yield-analytics.

import { NextResponse }               from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import supabaseAdmin                  from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const WAREHOUSE = 'BHW'

interface LotRow {
  product_group: string | null
  item_class: string | null
  qty_on_hand: number | null
  harvest_year: string | null
  synced_at: string | null
}

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin.rpc('acumatica_get_lot_details', { p_warehouse: WAREHOUSE })
  if (error) return NextResponse.json({ error: error.message }, { status: 502 })

  const lots = (data ?? []) as LotRow[]
  const thisYear = new Date().getFullYear()

  const byGrade = new Map<string, { group: string; sohKg: number; lots: number; years: Set<number> }>()
  const byYear  = new Map<string, number>()
  let totalSoh = 0
  let agedKg   = 0   // stock whose harvest year is older than last year (locked-capital signal)

  for (const l of lots) {
    const kg = Number(l.qty_on_hand) || 0
    const group = (l.product_group || l.item_class || 'Unclassified').trim()
    totalSoh += kg

    const g = byGrade.get(group) ?? { group, sohKg: 0, lots: 0, years: new Set<number>() }
    g.sohKg += kg
    g.lots  += 1
    const yr = Number(l.harvest_year)
    if (Number.isFinite(yr)) g.years.add(yr)
    byGrade.set(group, g)

    const yearKey = /^\d{4}$/.test(String(l.harvest_year)) ? String(l.harvest_year) : 'Unknown'
    byYear.set(yearKey, (byYear.get(yearKey) ?? 0) + kg)

    if (Number.isFinite(yr) && yr < thisYear - 1) agedKg += kg
  }

  const grades = [...byGrade.values()]
    .map((g) => ({
      group:      g.group,
      sohKg:      g.sohKg,
      lots:       g.lots,
      sharePct:   totalSoh ? g.sohKg / totalSoh : 0,
      oldestYear: g.years.size ? Math.min(...g.years) : null,
    }))
    .sort((a, b) => b.sohKg - a.sohKg)

  const ageing = [...byYear.entries()]
    .map(([year, kg]) => ({ year, kg }))
    .sort((a, b) => a.year.localeCompare(b.year))

  return NextResponse.json({
    warehouse: WAREHOUSE,
    totalSoh,
    agedKg,
    agedPct:   totalSoh ? agedKg / totalSoh : 0,
    grades,
    ageing,
    lotCount:  lots.length,
    syncedAt:  lots[0]?.synced_at ?? null,
  })
}

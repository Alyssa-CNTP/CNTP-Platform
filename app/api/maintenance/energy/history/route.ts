// app/api/maintenance/energy/history/route.ts
// Daily energy-usage history from maintenance.energy_daily (Supabase).
// Rows are captured by /api/maintenance/energy (upsert per SAST day).
//
// Query: ?days=30  (1–365, default 30) — how many days back to return.
//   …or ?from=YYYY-MM-DD&to=YYYY-MM-DD for an explicit custom date range.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getSessionClient } from '@/lib/auth/server-helpers'

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export async function GET(req: NextRequest) {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const sp = new URL(req.url).searchParams
    const from = sp.get('from'), to = sp.get('to')

    const db = await getSessionClient()
    let q = db
      .schema('maintenance' as any)
      .from('energy_daily')
      .select('day, solar_kwh, grid_import_kwh, grid_export_kwh, generator_kwh, battery_charge_kwh, battery_discharge_kwh, total_kwh, unit')

    if (isDate(from) || isDate(to)) {
      // Explicit custom range (either bound optional).
      if (isDate(from)) q = q.gte('day', from)
      if (isDate(to)) q = q.lte('day', to)
    } else {
      const raw  = parseInt(sp.get('days') ?? '30', 10)
      const days = Math.min(Math.max(Number.isFinite(raw) ? raw : 30, 1), 365)
      q = q.gte('day', new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10))
    }

    const { data, error } = await q.order('day', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, days: data ?? [] })
  } catch (err: any) {
    console.error('[api/maintenance/energy/history]', err)
    return NextResponse.json({ error: err?.message ?? 'Failed to load energy history' }, { status: 500 })
  }
}

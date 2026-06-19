// app/api/maintenance/energy/capture/route.ts
// Unattended daily capture of the energy snapshot into maintenance.energy_daily,
// so usage is recorded even on days nobody opens the dashboard. Intended to be
// hit by a scheduler (see .github/workflows/energy-capture.yml) near the end of
// the SAST day.
//
// Auth: there is no user session — the caller must present
//   Authorization: Bearer <CRON_SECRET>
// Writes use the service-role client (bypasses RLS).
//
// Required env:  CRON_SECRET, HOMEASSISTANT_TOKEN

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/auth/server-helpers'
import { getDailyEnergyTotals, upsertEnergyDaily } from '@/lib/maintenance/energy'

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Capture not configured — CRON_SECRET env var is missing.' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.HOMEASSISTANT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'HOMEASSISTANT_TOKEN env var is missing.' }, { status: 503 })
  }

  try {
    const totals = await getDailyEnergyTotals(token)
    const { error } = await upsertEnergyDaily(getAdminClient(), totals)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, captured: totals })
  } catch (err: any) {
    console.error('[api/maintenance/energy/capture]', err)
    return NextResponse.json({ error: err?.message ?? 'Capture failed' }, { status: 500 })
  }
}

// Accept POST (preferred) and GET so a simple scheduled curl works either way.
export const POST = handle
export const GET  = handle

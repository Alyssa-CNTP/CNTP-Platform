// app/api/maintenance/energy/route.ts
// Fetches today's energy summary + hourly chart data from Home Assistant.
// HA base URL: https://capenaturalteaproducts.invertermon.com
//
// Required env var:  HOMEASSISTANT_TOKEN  (Long-lived access token)
// Optional overrides (entity IDs default to CNTP HA config):
//   HA_ENTITY_SOLAR_KWH, HA_ENTITY_GRID_KWH, HA_ENTITY_TOTAL_KWH
//   HA_ENTITY_GRID_EXPORT, HA_ENTITY_GENERATOR
//   HA_ENTITY_SOLAR_POWER, HA_ENTITY_GRID_POWER, HA_ENTITY_LOAD_POWER

import { NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'

const HA_URL = 'https://capenaturalteaproducts.invertermon.com'

async function fetchState(token: string, entityId: string) {
  const res = await fetch(`${HA_URL}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`HA ${entityId} → ${res.status}: ${t.slice(0, 120)}`)
  }
  return res.json()
}

async function fetchHistory(
  token: string,
  entityId: string,
  startIso: string,
  endIso: string,
): Promise<Array<{ state: string; last_changed: string }>> {
  const url =
    `${HA_URL}/api/history/period/${startIso}` +
    `?filter_entity_id=${entityId}&end_time=${endIso}&minimal_response=true`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) return []
  const data = await res.json().catch(() => [])
  return data?.[0] ?? []
}

// Convert a stream of power-state changes into per-hour kWh buckets.
function toHourlyKwh(
  states: Array<{ state: string; last_changed: string }>,
  dayStartMs: number,
): number[] {
  const hours = Array(24).fill(0) as number[]
  const nowMs = Date.now()
  for (let i = 0; i < states.length; i++) {
    const power = parseFloat(states[i].state)
    if (!isFinite(power) || power < 0) continue
    const fromMs = Math.max(new Date(states[i].last_changed).getTime(), dayStartMs)
    const toMs   = i + 1 < states.length
      ? new Date(states[i + 1].last_changed).getTime()
      : nowMs
    const durationH = Math.max(0, toMs - fromMs) / 3_600_000
    const hourIdx   = Math.floor((fromMs - dayStartMs) / 3_600_000)
    if (hourIdx >= 0 && hourIdx < 24) hours[hourIdx] += power * durationH
  }
  return hours.map(v => +v.toFixed(1))
}

export async function GET() {
  try {
    const caller = await getCallerPermissions()
    if (!caller.userId) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const token = process.env.HOMEASSISTANT_TOKEN
    if (!token) {
      return NextResponse.json(
        { error: 'Energy monitoring not configured — HOMEASSISTANT_TOKEN env var is missing.' },
        { status: 503 },
      )
    }

    // Daily-total entity IDs (reset at midnight SAST)
    const E = {
      solar:      process.env.HA_ENTITY_SOLAR_KWH    || 'sensor.pv_energy',
      grid:       process.env.HA_ENTITY_GRID_KWH     || 'sensor.grid_import_energy',
      total:      process.env.HA_ENTITY_TOTAL_KWH    || 'sensor.consumption_energy',
      export:     process.env.HA_ENTITY_GRID_EXPORT  || 'sensor.daily_grid_feedback',
      generator:  process.env.HA_ENTITY_GENERATOR    || 'sensor.generator_import_energy',
      batCharge:  'sensor.battery_charge_energy',
      batDischarge: 'sensor.battery_discharge_energy',
      // Power sensors for hourly chart history
      solarPower: process.env.HA_ENTITY_SOLAR_POWER  || 'sensor.combined_pv_power',
      gridPower:  process.env.HA_ENTITY_GRID_POWER   || 'sensor.grid_meter_active_power_import',
      loadPower:  process.env.HA_ENTITY_LOAD_POWER   || 'sensor.combined_load_power',
    }

    // Today's window in SAST (UTC+2)
    const nowMs      = Date.now()
    const SAST_OFFSET = 2 * 3_600_000
    const dayStartMs  = Math.floor((nowMs + SAST_OFFSET) / 86_400_000) * 86_400_000 - SAST_OFFSET
    const startIso    = new Date(dayStartMs).toISOString()
    const endIso      = new Date(nowMs).toISOString()

    // Fetch daily totals (required) and history + battery (best-effort)
    const [solarS, gridS, totalS] = await Promise.all([
      fetchState(token, E.solar),
      fetchState(token, E.grid),
      fetchState(token, E.total),
    ])

    const [exportKwh, generatorKwh, batChargeKwh, batDischargeKwh] = await Promise.all([
      fetchState(token, E.export).then(s => parseFloat(s.state) || 0).catch(() => 0),
      fetchState(token, E.generator).then(s => parseFloat(s.state) || 0).catch(() => 0),
      fetchState(token, E.batCharge).then(s => parseFloat(s.state) || 0).catch(() => 0),
      fetchState(token, E.batDischarge).then(s => parseFloat(s.state) || 0).catch(() => 0),
    ])

    // Hourly chart history (best-effort — empty arrays on failure)
    const [solarHist, gridHist, loadHist] = await Promise.all([
      fetchHistory(token, E.solarPower, startIso, endIso),
      fetchHistory(token, E.gridPower,  startIso, endIso),
      fetchHistory(token, E.loadPower,  startIso, endIso),
    ])

    const solarHourly = toHourlyKwh(solarHist, dayStartMs)
    const gridHourly  = toHourlyKwh(gridHist,  dayStartMs)
    const loadHourly  = toHourlyKwh(loadHist,  dayStartMs)

    const unit = solarS.attributes?.unit_of_measurement ?? 'kWh'
    const solarKwh = parseFloat(solarS.state) || 0
    const gridKwh  = parseFloat(gridS.state)  || 0
    const totalKwh = parseFloat(totalS.state) || 0

    return NextResponse.json({
      ok: true,
      // Daily totals (sources table)
      solar_kwh:        +solarKwh.toFixed(2),
      grid_kwh:         +gridKwh.toFixed(2),
      total_kwh:        +totalKwh.toFixed(2),
      grid_export_kwh:  +exportKwh.toFixed(2),
      generator_kwh:    +generatorKwh.toFixed(2),
      bat_charge_kwh:   +batChargeKwh.toFixed(2),
      bat_discharge_kwh: +batDischargeKwh.toFixed(2),
      unit,
      // Hourly chart data (24 buckets, index 0 = midnight SAST)
      hourly: { solar: solarHourly, grid: gridHourly, load: loadHourly },
      last_updated: solarS.last_updated ?? new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[api/maintenance/energy]', err)
    return NextResponse.json({ error: err?.message ?? 'Failed to fetch energy data' }, { status: 500 })
  }
}

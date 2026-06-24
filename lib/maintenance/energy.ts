// lib/maintenance/energy.ts
// Shared Home Assistant energy helpers: fetch the day's running totals and
// persist them to maintenance.energy_daily. Used by both the live energy route
// (upsert-on-read) and the scheduled capture route (unattended, end-of-day).
//
// Required env:  HOMEASSISTANT_TOKEN
// Optional entity-ID overrides: HA_ENTITY_SOLAR_KWH, HA_ENTITY_GRID_KWH,
//   HA_ENTITY_TOTAL_KWH, HA_ENTITY_GRID_EXPORT, HA_ENTITY_GENERATOR

const HA_URL = 'https://capenaturalteaproducts.invertermon.com'
const SAST_OFFSET = 2 * 3_600_000 // UTC+2

export interface EnergyDailyRow {
  day:                   string
  solar_kwh:             number
  grid_import_kwh:       number
  grid_export_kwh:       number
  generator_kwh:         number
  battery_charge_kwh:    number
  battery_discharge_kwh: number
  total_kwh:             number
  unit:                  string
}

// SAST (UTC+2) calendar day for a given instant, e.g. "2026-06-19".
export function sastDayString(nowMs: number = Date.now()): string {
  const dayStartMs = Math.floor((nowMs + SAST_OFFSET) / 86_400_000) * 86_400_000 - SAST_OFFSET
  return new Date(dayStartMs + SAST_OFFSET).toISOString().slice(0, 10)
}

async function fetchStateRaw(token: string, entityId: string) {
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

const stateValue = (token: string, entityId: string) =>
  fetchStateRaw(token, entityId).then(s => parseFloat(s.state) || 0)

// Fetch the day's running energy totals from Home Assistant (the same daily
// sensors the live widget reads — these reset at midnight SAST).
export async function getDailyEnergyTotals(token: string): Promise<EnergyDailyRow> {
  const E = {
    solar:        process.env.HA_ENTITY_SOLAR_KWH   || 'sensor.pv_energy',
    grid:         process.env.HA_ENTITY_GRID_KWH    || 'sensor.grid_import_energy',
    total:        process.env.HA_ENTITY_TOTAL_KWH   || 'sensor.consumption_energy',
    export:       process.env.HA_ENTITY_GRID_EXPORT || 'sensor.daily_grid_feedback',
    generator:    process.env.HA_ENTITY_GENERATOR   || 'sensor.generator_import_energy',
    batCharge:    'sensor.battery_charge_energy',
    batDischarge: 'sensor.battery_discharge_energy',
  }

  // Solar fetched raw so we can read its unit_of_measurement; the rest are
  // best-effort numeric (missing sensors → 0, never throw).
  const solarS = await fetchStateRaw(token, E.solar)
  const [gridKwh, totalKwh, exportKwh, generatorKwh, batChargeKwh, batDischargeKwh] = await Promise.all([
    stateValue(token, E.grid),
    stateValue(token, E.total),
    stateValue(token, E.export).catch(() => 0),
    stateValue(token, E.generator).catch(() => 0),
    stateValue(token, E.batCharge).catch(() => 0),
    stateValue(token, E.batDischarge).catch(() => 0),
  ])

  return {
    day:                   sastDayString(),
    solar_kwh:             +(parseFloat(solarS.state) || 0).toFixed(2),
    grid_import_kwh:       +gridKwh.toFixed(2),
    grid_export_kwh:       +exportKwh.toFixed(2),
    generator_kwh:         +generatorKwh.toFixed(2),
    battery_charge_kwh:    +batChargeKwh.toFixed(2),
    battery_discharge_kwh: +batDischargeKwh.toFixed(2),
    total_kwh:             +totalKwh.toFixed(2),
    unit:                  solarS.attributes?.unit_of_measurement ?? 'kWh',
  }
}

// Upsert a daily snapshot into maintenance.energy_daily (keyed by `day`).
// `db` is any Supabase client (session or admin).
export async function upsertEnergyDaily(db: any, row: EnergyDailyRow) {
  return db
    .schema('maintenance' as any)
    .from('energy_daily')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'day' })
}

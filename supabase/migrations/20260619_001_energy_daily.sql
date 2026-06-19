-- ============================================================
-- CNTP Maintenance — daily energy usage history (solar / grid / battery)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: maintenance schema
-- Re-runnable (IF NOT EXISTS / idempotent).
-- ============================================================
--
-- One row per SAST calendar day, capturing the day's energy totals pulled from
-- Home Assistant by /api/maintenance/energy. The row is upserted on each read
-- (keyed by `day`), so it fills in through the day and finalises at the last
-- read. Powers the "History" view on the Energy widget — tracking electricity
-- (grid) usage and solar usage over time.
--
-- RLS is enabled with a permissive authenticated policy, matching the newer
-- maintenance.spare_requests / maintenance.notifications tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance.energy_daily (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day                   date NOT NULL UNIQUE,          -- SAST calendar day
  solar_kwh             numeric NOT NULL DEFAULT 0,    -- PV produced
  grid_import_kwh       numeric NOT NULL DEFAULT 0,    -- electricity drawn from grid
  grid_export_kwh       numeric NOT NULL DEFAULT 0,    -- fed back to grid
  generator_kwh         numeric NOT NULL DEFAULT 0,
  battery_charge_kwh    numeric NOT NULL DEFAULT 0,
  battery_discharge_kwh numeric NOT NULL DEFAULT 0,
  total_kwh             numeric NOT NULL DEFAULT 0,    -- total consumption
  unit                  text NOT NULL DEFAULT 'kWh',
  captured_at           timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS energy_daily_day_idx
  ON maintenance.energy_daily(day DESC);

GRANT USAGE ON SCHEMA maintenance TO authenticated, service_role;
GRANT ALL ON maintenance.energy_daily TO authenticated, service_role;

ALTER TABLE maintenance.energy_daily ENABLE ROW LEVEL SECURITY;
-- Anyone signed in may read + upsert daily snapshots (the app writes them from
-- the authenticated energy route). Mirrors the spare_requests policy.
DROP POLICY IF EXISTS energy_daily_all ON maintenance.energy_daily;
CREATE POLICY energy_daily_all ON maintenance.energy_daily
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

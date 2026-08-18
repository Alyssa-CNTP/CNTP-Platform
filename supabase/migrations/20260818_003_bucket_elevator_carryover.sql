-- ============================================================
-- CNTP — Sieving Tower bucket-elevator carry-over ledger
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Depends on: 20260611_001_production_capture.sql (production.prod_sessions)
-- ============================================================
--
-- The bucket elevator holds work-in-progress that carries across the
-- production day: the afternoon shift leaves material in the elevator for
-- tomorrow (an OUTPUT), and the following morning shift consumes it (an
-- INPUT). Today that figure is just a free-typed kg on each shift's own
-- capture screen with no link between them — the morning and afternoon
-- entries for the SAME calendar day were even being summed together on the
-- Overview screen as if they were one figure, when they're actually two
-- different physical quantities a day apart.
--
-- Mirrors production.dust_carryover_log (20260804_002) — same append-only
-- shape, so there's an audit trail of every carry-over generated and every
-- carry-over consumed, and it generalises without a schema change.
--
-- variant_family (not the exact variant) is the ledger key: RA-Conventional
-- bucket elevator can be consumed by a Conventional shift and vice versa,
-- same for RA-Organic/Organic — the floor treats those as one physical pool
-- per family, never mixing conventional and organic. See isOrganicVariant()
-- in lib/production/capture-config.ts for the same conventional/organic
-- split already used for mass-balance segregation elsewhere.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.bucket_elevator_log (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id     text        NOT NULL,
  variant_family text        NOT NULL CHECK (variant_family IN ('conventional','organic')),
  kind           text        NOT NULL CHECK (kind IN ('generated','consumed')),
  kg             numeric     NOT NULL CHECK (kg > 0),
  date           date        NOT NULL,
  shift          text        NOT NULL,
  session_id     uuid        REFERENCES production.prod_sessions(id) ON DELETE SET NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Outstanding balance per (section_id, variant_family) =
--   SUM(kg WHERE kind = 'generated') - SUM(kg WHERE kind = 'consumed')

CREATE INDEX IF NOT EXISTS bucket_elevator_log_section_family_idx
  ON production.bucket_elevator_log(section_id, variant_family);

GRANT ALL ON production.bucket_elevator_log TO authenticated, service_role;

ALTER TABLE production.bucket_elevator_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_bucket_elevator_log" ON production.bucket_elevator_log;
CREATE POLICY "auth_all_bucket_elevator_log" ON production.bucket_elevator_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

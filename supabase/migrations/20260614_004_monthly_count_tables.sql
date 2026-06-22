-- ============================================================
-- Monthly Stock Count — create the backing tables
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: migration 001 (production schema + set_updated_at)
-- ============================================================
--
-- The Monthly Count UI (Stock Count → Monthly Count) queries
-- production.mc_sessions / mc_entries / mc_reviews, but those tables were
-- never created — so the monthly feature (Comparison · Reconciliation ·
-- Batch Ledger · Variances) has been non-functional. This creates them to
-- match exactly what the app reads/writes. Mirrors the daily count tables
-- (sc_sessions / sc_entries) and the count's own 'supervisor'/'admin'
-- domain roles (labelled Warehouse Supervisor / Stock in the UI).
-- ============================================================

-- ── mc_sessions ───────────────────────────────────────────────
-- One monthly count per (month, warehouse, product). Two independent counts
-- (warehouse 'supervisor' + 'admin'/stock) reconcile into a match rate.
CREATE TABLE production.mc_sessions (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  count_month       date        NOT NULL,                 -- first of month
  warehouse_id      text        NOT NULL DEFAULT 'BHW',
  product_type      text        NOT NULL,                 -- 'r' | 'h'
  sup_name          text,
  adm_name          text,
  sup_confirmed_at  timestamptz,
  adm_confirmed_at  timestamptz,
  sup_total_kg      numeric,
  adm_total_kg      numeric,
  match_rate_pct    numeric,
  signed_off_by     text,                                 -- auth user id (string)
  signed_off_at     timestamptz,
  sign_off_notes    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_month, warehouse_id, product_type)
);

-- ── mc_entries ────────────────────────────────────────────────
-- One row per counted item/batch per counter role. Re-inserted on each submit
-- (delete-by-role then insert), so a role's latest count fully replaces prior.
CREATE TABLE production.mc_entries (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      uuid        NOT NULL
                    REFERENCES production.mc_sessions(id) ON DELETE CASCADE,
  role            text        NOT NULL,                   -- 'supervisor' | 'admin'
  section_id      text,
  section_name    text,
  inventory_code  text,
  item_name       text,
  batch_number    text,
  kg              numeric     NOT NULL DEFAULT 0,
  bags_qty        numeric     NOT NULL DEFAULT 0,
  is_no_stock     boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── mc_reviews ────────────────────────────────────────────────
-- Variance review notes (the Variances sub-tab). Append-only.
CREATE TABLE production.mc_reviews (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      uuid        NOT NULL
                    REFERENCES production.mc_sessions(id) ON DELETE CASCADE,
  inventory_code  text,
  batch_number    text,
  section_id      text,
  notes           text        NOT NULL,
  reviewed_by     text,                                   -- auth user id (string)
  reviewed_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX mc_sessions_month_idx  ON production.mc_sessions(count_month, warehouse_id, product_type);
CREATE INDEX mc_entries_session_idx ON production.mc_entries(session_id);
CREATE INDEX mc_entries_batch_idx   ON production.mc_entries(batch_number) WHERE batch_number IS NOT NULL;
CREATE INDEX mc_reviews_session_idx ON production.mc_reviews(session_id);

-- ── updated_at trigger (reuses production.set_updated_at from 001) ──
CREATE TRIGGER mc_sessions_updated_at
  BEFORE UPDATE ON production.mc_sessions
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE production.mc_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.mc_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.mc_reviews  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_mc_sessions"
  ON production.mc_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_mc_entries"
  ON production.mc_entries  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_mc_reviews"
  ON production.mc_reviews  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Grants (table-level GRANTs are not covered by RLS) ────────
GRANT ALL ON production.mc_sessions TO authenticated, service_role;
GRANT ALL ON production.mc_entries  TO authenticated, service_role;
GRANT ALL ON production.mc_reviews  TO authenticated, service_role;

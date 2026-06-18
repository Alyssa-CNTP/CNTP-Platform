-- ============================================================
-- CNTP Maintenance — spare-part reorder / request register
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: maintenance.spare_parts, maintenance.job_cards
-- Re-runnable (IF NOT EXISTS / idempotent).
-- ============================================================
--
-- When a part is low/out of stock — or a technician needs a part that isn't in
-- the register — a reorder REQUEST is raised to the maintenance manager
-- (purchasing). The manager tracks it open → ordered → received; marking it
-- received adds the qty back into the spare-parts register. Mirrors the grants /
-- RLS pattern of the maintenance.notifications + spare_parts migrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance.spare_requests (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  part_id              bigint REFERENCES maintenance.spare_parts(id) ON DELETE SET NULL,
  part_no              text,
  description          text NOT NULL,
  qty                  integer NOT NULL DEFAULT 1,
  reason               text,                       -- low_stock | out_of_stock | job_card | other
  card_id              bigint REFERENCES maintenance.job_cards(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'open', -- open | ordered | received | cancelled
  note                 text,
  requested_by         text,
  requested_by_user_id uuid,
  ordered_at           timestamptz,
  received_at          timestamptz,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spare_requests_status_idx
  ON maintenance.spare_requests(status);
CREATE INDEX IF NOT EXISTS spare_requests_part_idx
  ON maintenance.spare_requests(part_id);

GRANT USAGE ON SCHEMA maintenance TO authenticated, service_role;
GRANT ALL ON maintenance.spare_requests TO authenticated, service_role;

ALTER TABLE maintenance.spare_requests ENABLE ROW LEVEL SECURITY;
-- Anyone signed in may read + manage requests (the app gates the manager-only
-- actions in the UI). Mirrors the inventory/spare_parts policy.
DROP POLICY IF EXISTS spare_requests_all ON maintenance.spare_requests;
CREATE POLICY spare_requests_all ON maintenance.spare_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

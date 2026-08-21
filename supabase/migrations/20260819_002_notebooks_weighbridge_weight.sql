-- ============================================================
-- Note Books — weighbridge weight on the header
-- Run in: Supabase SQL Editor — STAGING ONLY (qjqkpockmujecjgmdple)
-- Depends on: 20260819_001_notebooks_grn_dn.sql
-- ============================================================
--
-- The GRN capture flow now starts from the weighbridge reading, not from the
-- goods description — a driver arrives, crosses the weighbridge, and THAT
-- weight is what the note is built around; the per-line weight_kg values
-- (already on notebooks.document_lines) are how that total gets split across
-- more than one description on the same load, not where the authoritative
-- figure comes from.
--
-- This is a plain numeric column, not a link to a weighbridge_slips table:
-- there is no weighbridge system integration yet (the paper slip in the
-- reference scans has its own "Weighing No." on a different piece of
-- equipment entirely — see WEIGHBRIDGE SLIP examples). weighbridge_no already
-- on notebooks.documents is that slip's number; this column is the number
-- that came off it. When a real weighbridge feed exists, wire it to PATCH
-- notebooks.documents.weighbridge_weight_kg (+ weighbridge_no) rather than
-- adding a new table — nothing about this column assumes manual entry.
-- ============================================================

ALTER TABLE notebooks.documents
  ADD COLUMN IF NOT EXISTS weighbridge_weight_kg numeric(12,2);

COMMENT ON COLUMN notebooks.documents.weighbridge_weight_kg IS
  'The nett weight off the weighbridge slip for this load — the authoritative total the note is built around. Manual entry today; the column is where a future weighbridge feed would write.';

-- `public.notebook_documents` was defined as `SELECT * FROM notebooks.documents`
-- in 20260819_001 — Postgres freezes a view's column list at CREATE time, so
-- `SELECT *` does NOT pick up a column added to the base table afterwards.
-- Any future ALTER TABLE on notebooks.documents needs this same
-- CREATE OR REPLACE VIEW alongside it, or PostgREST keeps serving the old shape.
CREATE OR REPLACE VIEW public.notebook_documents
  WITH (security_invoker = true) AS
  SELECT * FROM notebooks.documents;

GRANT SELECT ON public.notebook_documents TO authenticated;
GRANT ALL    ON public.notebook_documents TO service_role;

NOTIFY pgrst, 'reload schema';

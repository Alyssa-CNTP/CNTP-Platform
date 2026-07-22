-- ============================================================
-- SOP Catalogue — supersession (old revision -> new revision)
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260702_001_competency_matrix.sql (production.sops)
--
-- Lets the catalogue show "current" vs "superseded" SOPs explicitly: a new
-- revision points the OLD row's superseded_by at the NEW row's id (set via
-- the SOP editor's "Supersedes" picker — see app/(app)/training/sops).
-- The old row's status is set to 'obsolete' at the same time, so "prevent
-- use of an obsolete version" is enforced by both a hard link and the
-- existing status flag, not the status flag alone.
-- ============================================================

ALTER TABLE production.sops
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES production.sops(id);

CREATE INDEX IF NOT EXISTS sops_superseded_by_idx ON production.sops(superseded_by) WHERE superseded_by IS NOT NULL;

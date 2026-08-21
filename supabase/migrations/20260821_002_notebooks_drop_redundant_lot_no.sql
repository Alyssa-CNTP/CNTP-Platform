-- ============================================================
-- Note Books — drop the redundant lot_no column
-- Run in: Supabase SQL Editor — STAGING ONLY (qjqkpockmujecjgmdple)
-- Depends on: 20260819_001_notebooks_grn_dn.sql
-- ============================================================
--
-- Batch no. and lot no. were captured as two separate fields (header and per
-- line) but mean the same thing in how these books are actually used — no
-- note has ever needed both, and having two boxes for one answer was just an
-- extra thing to fill in (or leave inconsistently blank). batch_no is the one
-- field going forward; lot_no is dropped rather than left as dead, unfilled
-- columns nothing writes to any more. Nothing has shipped to production yet,
-- and the module's own test rows were deleted after the last round of
-- verification, so there is no data to migrate.
--
-- The two public.notebook_* views are `SELECT *` — Postgres freezes a view's
-- column list at CREATE time (same lesson as 20260819_002), so dropping a
-- base-table column the view still references fails with a dependency error
-- unless the view is recreated. Simplest correct order: drop the views,
-- drop the columns, recreate the views, re-grant (a DROP VIEW drops its
-- grants too).

DROP VIEW IF EXISTS public.notebook_documents;
DROP VIEW IF EXISTS public.notebook_document_lines;

ALTER TABLE notebooks.documents      DROP COLUMN IF EXISTS lot_no;
ALTER TABLE notebooks.document_lines DROP COLUMN IF EXISTS lot_no;

CREATE VIEW public.notebook_documents
  WITH (security_invoker = true) AS
  SELECT * FROM notebooks.documents;

CREATE VIEW public.notebook_document_lines
  WITH (security_invoker = true) AS
  SELECT * FROM notebooks.document_lines;

GRANT SELECT ON public.notebook_documents, public.notebook_document_lines TO authenticated;
GRANT ALL    ON public.notebook_documents, public.notebook_document_lines TO service_role;

NOTIFY pgrst, 'reload schema';

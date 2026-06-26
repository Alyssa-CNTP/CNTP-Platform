-- ============================================================
-- AXIS — project_requests: submission types + Code Contribution Protocol
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: axis.project_requests (already exists in both DBs)
-- ============================================================
--
-- The AXIS request feature shipped in app code (submission types, department-
-- routed suggestions, the Code Contribution Protocol) but the matching columns
-- were never added to axis.project_requests in either database. As a result
-- PostgREST rejects every insert/select with:
--   "Could not find the 'submission_type' column of 'project_requests'
--    in the schema cache"  (SQLSTATE 42703)
-- so no department can submit a request, suggestion, or code contribution.
--
-- This migration is purely ADDITIVE and idempotent:
--   • every column is NULLABLE (or has a safe default) — no data is overwritten
--   • ADD COLUMN IF NOT EXISTS — safe to re-run, safe on both DBs
--   • existing rows backfill submission_type = 'feature_request' (the app's
--     default classification), so they keep appearing under the Project Request
--     tab and the consideration board exactly as before.
-- ============================================================

-- Submission classification: feature_request | suggestion | code_contribution
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS submission_type text NOT NULL DEFAULT 'feature_request';

-- Suggestion routing — which department a suggestion is sent to
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS target_department text;

-- Code Contribution Protocol fields (only populated when
-- submission_type = 'code_contribution')
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS onedrive_url text;
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS schema_proposal jsonb;
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS code_source text;
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS ai_tool_used text;
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS code_author text;
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS preflight_checklist jsonb;

-- IT audit sign-off, written when a Code Contribution is approved
ALTER TABLE axis.project_requests
  ADD COLUMN IF NOT EXISTS it_audit_checklist jsonb;

-- Tell PostgREST to reload its schema cache immediately so the new
-- columns are visible to the API without waiting for the next reload.
NOTIFY pgrst, 'reload schema';

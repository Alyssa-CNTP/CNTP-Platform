-- AXIS — axis.projects: add the missing `project_code` column
-- ---------------------------------------------------------------------------
-- Fixes: "Could not find the 'project_code' column of 'projects' in the schema
-- cache" (PostgREST PGRST204) — seen on the Consideration board when approving a
-- request. The app generates a PRJ-NNN code on approval and reads/orders by it
-- (app/api/axis/requests/[id]/approve/route.ts, projects/[id] page + brief route),
-- but the column was never added to axis.projects in either database.
--
-- Run in the Supabase SQL editor on STAGING and PRODUCTION (`sxzjjcyuzyfneesnsjna`).
-- Additive + idempotent. The NOTIFY reloads PostgREST's schema cache immediately.
-- Same pattern as 20260623_004_axis_project_requests_submission.sql.

ALTER TABLE axis.projects ADD COLUMN IF NOT EXISTS project_code text;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- AXIS — project_requests: business_justification nullable
-- Run in: Supabase SQL Editor (staging first, then production).
-- ============================================================
-- The redesigned Suggestions tab (submission_type='suggestion') has no
-- business-justification field by design — suggestions are a short
-- category + free-text idea, not a formal proposal. app/api/axis/requests/route.ts
-- already inserts null for this column on suggestions, but the column was
-- created NOT NULL, so every anonymous suggestion submission fails with:
--   "null value in column business_justification ... violates not-null constraint"
-- Relaxing the constraint — the app already treats this column as optional
-- for one submission type, the DB should allow that.
-- ============================================================

ALTER TABLE axis.project_requests ALTER COLUMN business_justification DROP NOT NULL;

-- Same category of issue, pre-emptively fixed here rather than in a second
-- round-trip: an anonymous suggestion's linked ticket also inserts
-- created_by=null (app/api/axis/requests/route.ts), which predates the
-- anonymity feature and was originally always set to the real submitter.
ALTER TABLE axis.tickets ALTER COLUMN created_by DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

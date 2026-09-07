-- ============================================================
-- Who approved a label, when, and their signature.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- ============================================================
--
-- label_template_events records `actor_id` and `created_at`, which answers
-- "some user id did this at this time". Under FSSC that is not enough: an
-- approval of a customer's label is documented information and has to name the
-- person, and the app already renders signatures for job-card sign-offs from
-- production.employee_signatures.
--
-- ── Why the name and signature are SNAPSHOT, not joined ─────────────────────
--
-- The obvious design is to keep `actor_id` and join to the Staff Directory when
-- rendering. That is wrong here, and the reason is the whole point of the
-- approval model: an approved template is FROZEN because it records what was
-- agreed at a moment in time.
--
-- Join live and the record changes underneath itself. Someone corrects their
-- display name, or re-signs with a new signature, or is offboarded — and an
-- approval from six months ago now shows a different name, a different
-- signature, or none at all. The certifier's question is "who signed this, at
-- the time" and a live join cannot answer it.
--
-- So both are copied in at write time. `actor_id` stays, because it is the link
-- back to the live person for anything that legitimately needs the current
-- record.
--
-- ── Why the signature is text ───────────────────────────────────────────────
--
-- production.employee_signatures.signature is already a data-URI string (the
-- SignaturePad writes a PNG data URI), and the granule job-card decide route
-- already reads it that way. Same column type, same shape, no conversion — one
-- representation of a signature in the app, not two.
-- ============================================================

ALTER TABLE public.label_template_events
  ADD COLUMN IF NOT EXISTS actor_name      text,
  ADD COLUMN IF NOT EXISTS actor_signature text;

COMMENT ON COLUMN public.label_template_events.actor_name IS
  'The actor''s name AS AT the moment of the event. Snapshot, not a join: an '
  'approval must keep showing who signed it even if they are later renamed or '
  'offboarded.';

COMMENT ON COLUMN public.label_template_events.actor_signature IS
  'Signature data URI copied from production.employee_signatures at the moment '
  'of the event, for the same reason. NULL where the actor has no signature on '
  'file — which is legitimate and must render as "no signature on file" rather '
  'than as a blank space that reads like a missing record.';

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='label_template_events'
--     AND column_name IN ('actor_name','actor_signature');
--
-- Expected: two rows, both text.
--
-- Existing events keep NULL for both. They are historical and cannot be
-- back-filled honestly — nobody recorded who they were at the time, and
-- inventing it from the current directory is exactly the retroactive rewrite
-- this column exists to prevent. The UI shows them as "recorded before
-- signatures were captured".
--
-- ⚠ AFTER RUNNING, RELOAD THE SCHEMA CACHE:
--
--   NOTIFY pgrst, 'reload schema';
--
-- Without it PostgREST answers 404/PGRST205 for the new columns even though
-- they exist. That is exactly what produced the "Unexpected token '<'" errors
-- on 2026-09-07: job_cards_pasteuriser, job_card_settings_templates and
-- next_job_card_no all existed and all returned 404 from a stale cache.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE public.label_template_events
--     DROP COLUMN IF EXISTS actor_name,
--     DROP COLUMN IF EXISTS actor_signature;

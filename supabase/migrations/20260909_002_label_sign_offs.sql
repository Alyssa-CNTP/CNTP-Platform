-- ============================================================
-- public.label_sign_offs — who signed a label, and for which gate.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Then:   NOTIFY pgrst, 'reload schema';
--
-- Storage for the rules in lib/core/labels/approval.ts. Read that file first;
-- this table holds what it reasons over and nothing more.
-- ============================================================
--
-- ── Why not more columns on label_template_events ───────────────────────────
--
-- An EVENT is a state transition: proof_issued, approved, rejected. A SIGN-OFF
-- is one named role putting their name to a version. Four sign-offs happen and
-- THEN the template becomes approved — so folding them into a stream where
-- `approved` already means "the whole thing is approved" would make the same
-- word mean two things at two scales.
--
-- The events table stays exactly as it is: the transition history. This table
-- is the signature register. They answer different questions and both are
-- append-only.
--
-- ── Two scopes, one table ───────────────────────────────────────────────────
--
--   'template'  the artwork chain — Sales, Quality, Customer, Certifier.
--               Once per template VERSION. Opens the job-card gate.
--   'print'     the pre-print check on one job card — Sales lead and Quality
--               supervisor, two different people. Opens the print gate.
--
-- One table because every column is shared and core already treats them as one
-- `SignOff` shape; two tables would duplicate that shape and force a UNION on
-- every read. The `scope` column is a real discriminant with a CHECK behind it,
-- not a field consumers duck-type on (ARCHITECTURE.md §4).
--
-- ── Append-only, and the latest wins ────────────────────────────────────────
--
-- Never UPDATE or DELETE. A re-sign after a rejection is a NEW ROW, and
-- `signOffState()` in core takes the most recent per role. That keeps the
-- record of who signed what and when, which is the point of a signature
-- (ARCHITECTURE.md §6).
--
-- ── The two-different-people rule is NOT a trigger, deliberately ────────────
--
-- `printGate()` in core already refuses a print where the sales lead and the
-- quality supervisor are the same person, and the API route decides from a
-- fresh read — the same shape §6 requires of adjustment tiers: refused by the
-- route handler, never by a disabled button.
--
-- A trigger repeating that rule would be a SECOND implementation of it, which
-- is precisely the duplication ARCHITECTURE.md §1A exists to stop. One rule,
-- one place, tested. Please do not "helpfully" add one here.
--
-- What the database DOES hold below is what it can hold honestly without
-- duplicating logic: shape, coherence and referential truth.
-- ============================================================

-- A print sign-off names both a template version and a job card. Those two must
-- agree, or somebody signs the Kunitaro test label against a Lipton card. A
-- composite foreign key makes that impossible; checking it in application code
-- would be another rule in another place.
DO $$
BEGIN
  ALTER TABLE public.job_cards_pasteuriser
    ADD CONSTRAINT job_cards_pasteuriser_id_assignment_uniq
    UNIQUE (id, label_assignment_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;   -- already added by a previous run
  WHEN duplicate_object THEN NULL;
END $$;

-- And the assignment must belong to the template being signed, or a print
-- sign-off could name Kunitaro's artwork against Lipton's purchase order. Same
-- technique, second pairing.
DO $$
BEGIN
  ALTER TABLE public.label_po_assignments
    ADD CONSTRAINT label_po_assignments_id_template_uniq
    UNIQUE (id, template_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.label_sign_offs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Which gate ────────────────────────────────────────────────────────────
  scope             text NOT NULL CHECK (scope IN ('template','print')),

  -- ── What is being signed ──────────────────────────────────────────────────
  template_id       uuid NOT NULL REFERENCES public.label_templates(id) ON DELETE CASCADE,

  -- The version AS AT SIGNING. Not derivable later: the template's current
  -- version moves when the artwork is edited, and core discards sign-offs from
  -- earlier versions precisely so a v1 signature cannot vouch for v2. Deriving
  -- this at read time would silently promote every old approval.
  template_version  integer NOT NULL CHECK (template_version >= 1),

  -- Only for scope='print' — the run whose test label was checked.
  job_card_id       uuid REFERENCES public.job_cards_pasteuriser(id) ON DELETE CASCADE,
  -- Carried alongside so the composite FK below can hold job card and template
  -- together. Redundant with the job card's own column, and that is the point.
  assignment_id     uuid REFERENCES public.label_po_assignments(id) ON DELETE CASCADE,

  -- ── Who ───────────────────────────────────────────────────────────────────
  role              text NOT NULL CHECK (role IN
                      ('sales','quality','customer','certifier',
                       'sales_lead','quality_supervisor')),

  -- As it should read on the record. NOT NULL: an unsigned name is not a
  -- signature, and "someone in Quality approved it" is not traceability.
  actor_name        text NOT NULL CHECK (btrim(actor_name) <> ''),

  -- production.employees.id where the signer is staff. NULL for the customer
  -- and the certifier, who are not in the Staff Directory — that is a real
  -- distinction, not missing data. ON DELETE SET NULL: offboarding someone must
  -- never erase a signature they gave.
  actor_employee_id uuid REFERENCES production.employees(id) ON DELETE SET NULL,

  -- Base64 PNG of the drawn signature, where one was captured.
  actor_signature   text,

  -- Whatever the customer or the certifier sent back, so an external approval
  -- is evidenced rather than asserted — same intent as
  -- label_template_events.external_ref.
  external_ref      text,
  note              text,

  signed_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- ── Scope coherence ───────────────────────────────────────────────────────
  --
  -- A template sign-off has no job card; a print sign-off must have one. And
  -- the roles do not cross: 'customer' cannot sign a test label, 'sales_lead'
  -- cannot sign the artwork chain. Without this the scope column would be a
  -- label rather than a discriminant.
  CONSTRAINT label_sign_offs_scope_shape CHECK (
    (scope = 'template'
       AND job_card_id   IS NULL
       AND assignment_id IS NULL
       AND role IN ('sales','quality','customer','certifier'))
    OR
    (scope = 'print'
       -- BOTH not-null, and not merely for tidiness: the composite foreign key
       -- below is MATCH SIMPLE, so a NULL in either column makes Postgres skip
       -- the check entirely. Allowing a print sign-off with no assignment would
       -- leave the job-card/template pairing unverified — the one thing that FK
       -- is there to hold.
       AND job_card_id   IS NOT NULL
       AND assignment_id IS NOT NULL
       AND role IN ('sales_lead','quality_supervisor'))
  ),

  -- The job card and the assignment must be the same pair the job card itself
  -- records. See the UNIQUE added above.
  CONSTRAINT label_sign_offs_job_card_assignment_fk
    FOREIGN KEY (job_card_id, assignment_id)
    REFERENCES public.job_cards_pasteuriser (id, label_assignment_id)
    ON DELETE CASCADE,

  -- ...and that assignment must be for THIS template. Between the two composite
  -- keys, a print sign-off cannot name a job card, an order and a piece of
  -- artwork that do not all belong together.
  CONSTRAINT label_sign_offs_assignment_template_fk
    FOREIGN KEY (assignment_id, template_id)
    REFERENCES public.label_po_assignments (id, template_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.label_sign_offs IS
  'Signature register for label approval. Append-only: a re-sign is a new row '
  'and lib/core/labels/approval.ts takes the latest per role. scope=template is '
  'the artwork chain (Sales, Quality, Customer, Certifier) per template '
  'version; scope=print is the two-name pre-print check on one job card.';

COMMENT ON COLUMN public.label_sign_offs.template_version IS
  'The version as at signing. Core discards sign-offs from earlier versions, so '
  'this must be recorded, never derived from the template''s current version.';

-- Core reads every sign-off for one template version, then filters by role.
CREATE INDEX IF NOT EXISTS label_sign_offs_template_idx
  ON public.label_sign_offs (template_id, template_version, role, signed_at DESC);

-- The print gate reads one job card's two rows.
CREATE INDEX IF NOT EXISTS label_sign_offs_job_card_idx
  ON public.label_sign_offs (job_card_id, role, signed_at DESC)
  WHERE job_card_id IS NOT NULL;

-- "What is waiting on me" — a rep or a QC opening their queue.
CREATE INDEX IF NOT EXISTS label_sign_offs_actor_idx
  ON public.label_sign_offs (actor_employee_id, signed_at DESC)
  WHERE actor_employee_id IS NOT NULL;

ALTER TABLE public.label_sign_offs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_label_sign_offs ON public.label_sign_offs;
CREATE POLICY authenticated_read_label_sign_offs ON public.label_sign_offs
  FOR SELECT TO authenticated USING (true);

-- Writes go through the API route, which decides from a fresh read. Granting
-- INSERT to authenticated as well would let a disabled button be the only thing
-- standing between a client and an unearned signature.
DROP POLICY IF EXISTS service_write_label_sign_offs ON public.label_sign_offs;
CREATE POLICY service_write_label_sign_offs ON public.label_sign_offs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.label_sign_offs TO authenticated;
GRANT ALL    ON public.label_sign_offs TO service_role;

-- ── Backfill: what we already know, and only that ───────────────────────────
--
-- Every template approved before today carries one `approved` event, recorded
-- by a holder of can_approve_labels — which is the SALES approval key. So we
-- know a sales approval happened, at a known time, by a known person where
-- 20260907_003 captured the name.
--
-- We know nothing about Quality, the customer or the certifier for those
-- templates. They are left outstanding, which is not a gap in the migration —
-- it is the true state, and it is exactly the gap this work exists to close.
--
-- CONSEQUENCE, so it is not a surprise: every currently-approved label will
-- read as NOT ready for a job card until Quality, the customer and the
-- certifier are recorded against it. That is correct. If it blocks testing,
-- record the three sign-offs through the app rather than widening this insert.
INSERT INTO public.label_sign_offs
  (scope, template_id, template_version, role, actor_name, actor_signature, signed_at, note)
SELECT
  'template',
  e.template_id,
  t.version,
  'sales',
  COALESCE(NULLIF(btrim(e.actor_name), ''), 'Recorded before signatures were captured'),
  e.actor_signature,
  e.created_at,
  'Backfilled from the label_template_events approval of ' || to_char(e.created_at, 'YYYY-MM-DD') || '.'
FROM public.label_template_events e
JOIN public.label_templates t ON t.id = e.template_id
WHERE e.event = 'approved'
  AND t.status = 'approved'
  -- Only the most recent approval per template, and only if nothing is there.
  AND e.created_at = (
    SELECT max(e2.created_at) FROM public.label_template_events e2
    WHERE e2.template_id = e.template_id AND e2.event = 'approved'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.label_sign_offs s
    WHERE s.template_id = e.template_id
      AND s.template_version = t.version
      AND s.role = 'sales'
  );

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT scope, role, count(*) FROM public.label_sign_offs GROUP BY 1,2 ORDER BY 1,2;
--
--   -- what each approved template is still waiting on:
--   SELECT t.code, t.version,
--          ARRAY(SELECT r FROM unnest(ARRAY['sales','quality','customer','certifier']) r
--                WHERE r NOT IN (SELECT role FROM public.label_sign_offs s
--                                WHERE s.template_id = t.id AND s.template_version = t.version)) AS outstanding
--   FROM public.label_templates t
--   WHERE t.status = 'approved' ORDER BY t.code;
--
--   -- the shape constraint holds (both of these must ERROR):
--   INSERT INTO public.label_sign_offs (scope, template_id, template_version, role, actor_name)
--     SELECT 'template', id, version, 'sales_lead', 'x' FROM public.label_templates LIMIT 1;
--   INSERT INTO public.label_sign_offs (scope, template_id, template_version, role, actor_name)
--     SELECT 'print', id, version, 'quality_supervisor', 'x' FROM public.label_templates LIMIT 1;
--
-- ⚠ THEN RELOAD THE CACHE, or the app gets 404/PGRST205 on a table that exists:
--
--   NOTIFY pgrst, 'reload schema';
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--
--   DROP TABLE IF EXISTS public.label_sign_offs;
--   ALTER TABLE public.job_cards_pasteuriser
--     DROP CONSTRAINT IF EXISTS job_cards_pasteuriser_id_assignment_uniq;
--   ALTER TABLE public.label_po_assignments
--     DROP CONSTRAINT IF EXISTS label_po_assignments_id_template_uniq;

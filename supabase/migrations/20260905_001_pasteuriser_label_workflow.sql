-- ============================================================
-- Pasteuriser finished-product LABEL WORKFLOW
--   design -> proof -> customer/Control Union approval -> PO -> job card -> print
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260729_002_job_cards_pasteuriser_workflow.sql
--             20260902_001_bag_serial_allocation.sql  (next_bag_seq)
-- ============================================================
--
-- Replaces a manual loop: label artwork lives in thirteen BarTender .btw files
-- on one workstation, proofs are emailed as attachments, approvals come back in
-- an inbox, and the link from "Control Union approved this wording" to "these
-- bags were printed from it" exists only in someone's memory. Under FSSC that
-- link is documented information; today it is not documented anywhere.
--
-- FOUR TABLES, and the split matters:
--
--   label_templates        the artefact that gets approved. One row PER VERSION.
--   label_template_events  append-only history of what happened to it.
--   label_po_assignments   sales binding an approved version to a customer PO.
--   label_prints           append-only ledger of every label actually printed.
--
-- The template is versioned rather than edited in place because approval is
-- against WORDING. Editing an approved template would silently invalidate the
-- approval the customer gave while leaving the row looking approved. So an edit
-- mints v+1 at 'draft' and leaves the approved version standing until the new
-- one is approved in its own right; the old one then goes 'superseded' and is
-- kept forever, because bags printed from it are in the warehouse and in
-- containers, and a traceability query has to be able to reconstruct exactly
-- what was on them.
--
-- APPEND-ONLY, per ARCHITECTURE.md §6. label_prints is a ledger: a label
-- printed in error is VOIDED by appending a void row, never by deleting the
-- original, because the original is on a bag somewhere until someone physically
-- removes it. Same reasoning as production.scan_events.
-- ============================================================


-- ── 1. Templates ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.label_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable family identifier shared across versions ('EU-ORG', 'JAS',
  -- 'KUNITARO-RA'). A PO is assigned to a specific VERSION, never to the
  -- family, so it is never ambiguous which wording an order's bags carried.
  code            text NOT NULL,
  name            text NOT NULL,
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),

  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','pending_approval','approved','rejected','superseded')),

  -- Destination market and organic flag drive the compliance rules in
  -- lib/core/labels/compliance.ts (Japan organic must carry the JAS mark;
  -- organic must carry the Control Union registration + operator number).
  -- Mirrored here so the DB and the app agree on the vocabulary.
  market          text NOT NULL DEFAULT 'export'
                    CHECK (market IN ('local','export','eu','usa','japan','uk')),
  organic         boolean NOT NULL DEFAULT false,
  size            text NOT NULL DEFAULT '100x100'
                    CHECK (size IN ('100x50','100x100','A6')),

  -- The label body. JSONB rather than a child table: a line list is only ever
  -- read and written whole (the editor replaces the array; the renderer walks
  -- it in order), it has no independent identity, and nothing queries across
  -- lines. Same call as job_cards_pasteuriser.blend_ratio_lines.
  -- Shape is lib/core/labels/types.ts LabelLine[] — the discriminated union,
  -- so a consumer dispatches on `kind` and never duck-types.
  lines           jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- LabelCertification[] — { mark, registrationNo, operatorNo, floId }.
  -- Numbers are held as DATA, not baked into a fixed line, so compliance can
  -- actually check them. A template that says "Certified Organic by Control
  -- Union" in prose and carries no number reads as correct and is not.
  certifications  jsonb NOT NULL DEFAULT '[]'::jsonb,
  mark_position   text NOT NULL DEFAULT 'right'
                    CHECK (mark_position IN ('right','bottom','header')),

  proof_note      text,

  -- The version this one replaces. Null on a first version.
  supersedes_id   uuid REFERENCES public.label_templates(id) ON DELETE SET NULL,

  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Approval outcome, denormalised onto the row so the common query
  -- ("which templates may I print from?") is a single index scan. The
  -- authoritative history is label_template_events.
  proof_issued_at timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  rejected_reason text,

  -- External sign-off references — the Control Union letter/email and the
  -- customer's own approval. Free text: they are other organisations' formats
  -- and we do not get to constrain them.
  cu_approval_ref       text,
  customer_approval_ref text,

  UNIQUE (code, version)
);

COMMENT ON TABLE public.label_templates IS
  'One row per label template VERSION. Approval is against wording, so an approved row is frozen: an edit mints version+1 at draft and the approved one stays valid until the new one is approved. Superseded rows are never deleted — bags printed from them are still in the warehouse.';

CREATE INDEX IF NOT EXISTS label_templates_code_version_idx ON public.label_templates (code, version DESC);
CREATE INDEX IF NOT EXISTS label_templates_status_idx       ON public.label_templates (status);

-- Only ONE version of a family may be approved at a time. Without this an
-- older approved version stays selectable after a newer one is approved, and
-- two live orders quietly print different wording under the same label name.
CREATE UNIQUE INDEX IF NOT EXISTS label_templates_one_approved_per_code
  ON public.label_templates (code) WHERE status = 'approved';


-- ── 2. Template history (append-only) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.label_template_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES public.label_templates(id) ON DELETE CASCADE,
  event         text NOT NULL
                  CHECK (event IN ('created','proof_issued','approved','rejected','superseded','reopened')),
  actor_id      uuid,
  note          text,
  -- Whatever the certifier/customer sent back, so the approval is evidenced
  -- rather than asserted.
  external_ref  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.label_template_events IS
  'Append-only history of a template. Never UPDATE or DELETE a row here — to undo, append the reversing event (ARCHITECTURE.md §6).';

CREATE INDEX IF NOT EXISTS label_template_events_template_idx
  ON public.label_template_events (template_id, created_at DESC);


-- ── 3. PO assignment ─────────────────────────────────────────────────────────
--
-- Sales binds an APPROVED template version to a customer purchase order. This
-- is the handover point: once a row exists here and is 'open', the production
-- manager can pick it on the job cards page.
--
-- planned_batch_no and planned_date are NULLABLE ON PURPOSE. The supply chain
-- analyst fills them in when they know; the production manager is NOT blocked
-- waiting for that and may assign a job card on the day regardless. Making
-- them NOT NULL would encode the dependency the workflow exists to remove.

CREATE TABLE IF NOT EXISTS public.label_po_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A specific VERSION, not a family — see label_templates.code.
  template_id       uuid NOT NULL REFERENCES public.label_templates(id) ON DELETE RESTRICT,

  customer          text NOT NULL,
  po_number         text NOT NULL,

  -- Order-time values that end up bound into the label's placeholders.
  item_number       text,
  product           text,
  net_mass          text,
  gross_mass        text,
  importer          text,
  ordered_bags      integer CHECK (ordered_bags IS NULL OR ordered_bags > 0),

  -- Supply-chain hints. Advisory only.
  planned_batch_no  text,
  planned_date      date,

  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_production','closed','cancelled')),
  notes             text,

  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (template_id, po_number)
);

COMMENT ON COLUMN public.label_po_assignments.planned_batch_no IS
  'Advisory. Supplied by the supply chain analyst when known. The production manager may assign a job card without it — the workflow must not depend on the analyst.';

CREATE INDEX IF NOT EXISTS label_po_assignments_status_idx   ON public.label_po_assignments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS label_po_assignments_template_idx ON public.label_po_assignments (template_id);


-- ── 4. Job card link ─────────────────────────────────────────────────────────
--
-- The production manager picks an open assignment; the job card carries it
-- forward to the supervisor and the capture screen. Nullable: job cards that
-- predate this, and job cards for product with no customer label, are normal.

ALTER TABLE public.job_cards_pasteuriser
  ADD COLUMN IF NOT EXISTS label_assignment_id uuid
    REFERENCES public.label_po_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_cards_pasteuriser_label_assignment_idx
  ON public.job_cards_pasteuriser (label_assignment_id);


-- ── 5. Print ledger (append-only) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.label_prints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  job_card_id    uuid REFERENCES public.job_cards_pasteuriser(id) ON DELETE SET NULL,
  assignment_id  uuid REFERENCES public.label_po_assignments(id)  ON DELETE SET NULL,
  -- RESTRICT, not SET NULL: the template is the wording that was on the bag.
  -- Losing it would make the printed label unreconstructable.
  template_id    uuid NOT NULL REFERENCES public.label_templates(id) ON DELETE RESTRICT,

  serial_no      text NOT NULL,

  -- The FULLY RESOLVED values as printed, snapshotted. Not a join at read time:
  -- a job card's batch number can be corrected afterwards, and this must keep
  -- saying what the bag in the warehouse actually says. Same reasoning as
  -- event-sourced reporting in ARCHITECTURE.md §6 — never re-derive a past
  -- fact from current state.
  binding        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 'browser' or 'pplb'; which path put ink on the bag.
  print_path     text NOT NULL DEFAULT 'pplb' CHECK (print_path IN ('pplb','browser','pdf')),

  -- Reprint of the SAME bag (damaged label) — carries the same serial and
  -- points at the original row. A reprint is not a new bag and must not be
  -- counted as one.
  reprint_of     uuid REFERENCES public.label_prints(id) ON DELETE SET NULL,

  -- Voiding appends rather than deletes: the original label may still be on a
  -- bag. void_of points at the row being reversed.
  void_of        uuid REFERENCES public.label_prints(id) ON DELETE SET NULL,
  void_reason    text,

  printed_by     uuid,
  printed_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.label_prints IS
  'Append-only ledger of every label printed. Never DELETE: a printed label is physically on a bag. To reverse one, append a row with void_of set. Count distinct non-voided serial_no for a true bag count — reprint rows repeat a serial by design.';

CREATE INDEX IF NOT EXISTS label_prints_job_card_idx ON public.label_prints (job_card_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS label_prints_serial_idx   ON public.label_prints (serial_no);

-- One ORIGINAL print per serial. Reprints and voids are exempt — they
-- legitimately repeat the serial — which is what the WHERE clause encodes.
CREATE UNIQUE INDEX IF NOT EXISTS label_prints_one_original_per_serial
  ON public.label_prints (job_card_id, serial_no)
  WHERE reprint_of IS NULL AND void_of IS NULL;


-- ── 6. Serial allocation ─────────────────────────────────────────────────────
--
-- Reuses production.next_bag_seq(scope) from 20260902_001 rather than adding a
-- second counter table (ARCHITECTURE.md §7 — check the reuse index first). That
-- function is already the atomic INSERT .. ON CONFLICT DO UPDATE .. RETURNING
-- that makes two concurrent supervisors get 7 and 8 instead of 7 and 7.
--
-- The scope is the JOB CARD, because a Pasteuriser serial (DD-MM-NN) counts
-- bags of one customer's order, not bags of a day: two job cards running on the
-- same date each start at 01. The 'PSLBL:' prefix keeps this namespace clear of
-- the capture sections' scopes, which are product/date/lot stems.
--
-- The serial STRING is built by lib/core/serials.ts pasteuriserLabelSerial();
-- this returns a number and never formats one, exactly as next_bag_seq does.

CREATE OR REPLACE FUNCTION public.next_pasteuriser_label_seq(p_job_card_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = production, public
AS $$
  SELECT production.next_bag_seq('PSLBL:' || p_job_card_id::text);
$$;

COMMENT ON FUNCTION public.next_pasteuriser_label_seq(uuid) IS
  'Atomically allocate the next label sequence number for a Pasteuriser job card. Returns a number; the serial string is built by lib/core/serials.ts. Gaps are expected and fine — a voided label is never renumbered, because renumbering would change a serial already printed on a bag.';

GRANT EXECUTE ON FUNCTION public.next_pasteuriser_label_seq(uuid) TO authenticated, service_role;


-- ── 7. RLS + grants ──────────────────────────────────────────────────────────
--
-- Same posture as job_cards_pasteuriser: authenticated users reach these
-- through the app, and WHO may do WHAT is enforced by the route guards and the
-- permission registry (ARCHITECTURE.md §7), not by per-table policies. Stated
-- explicitly because it is a deliberate choice, not an oversight — tightening
-- it here without also moving the permission model would lock out the API
-- routes that legitimately act on a user's behalf.

ALTER TABLE public.label_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_template_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_po_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_prints          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_all_label_templates ON public.label_templates;
CREATE POLICY authenticated_all_label_templates
  ON public.label_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all_label_template_events ON public.label_template_events;
CREATE POLICY authenticated_all_label_template_events
  ON public.label_template_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all_label_po_assignments ON public.label_po_assignments;
CREATE POLICY authenticated_all_label_po_assignments
  ON public.label_po_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS authenticated_all_label_prints ON public.label_prints;
CREATE POLICY authenticated_all_label_prints
  ON public.label_prints FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.label_templates       TO authenticated, service_role;
GRANT ALL ON public.label_template_events TO authenticated, service_role;
GRANT ALL ON public.label_po_assignments  TO authenticated, service_role;
GRANT ALL ON public.label_prints          TO authenticated, service_role;

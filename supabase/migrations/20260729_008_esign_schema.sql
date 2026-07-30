-- ============================================================
-- CNTP internal e-signature platform (esign schema)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: production.employee_signatures (20260729_007_employee_signatures.sql)
-- ============================================================
--
-- A single, polymorphic place to request and capture a signature against ANY
-- record in the app (subject_type/subject_id), with a real audit trail — who,
-- what, when, from where — and true immutability: a captured signature can
-- never be edited, only voided (and re-requested as a brand new row). First
-- consumer is logistics.dispatch_documents (its signed_by/signed_at columns
-- are currently dead — nothing writes them); this schema does NOT hard-FK
-- into dispatch_documents since that table was never captured in a migration
-- and its live column types are unverified — subject_id stays a plain text
-- reference, matched by application code.
--
-- Two signer kinds:
--   internal — a logged-in staff member; the signature image is loaded from
--              production.employee_signatures (never drawn ad hoc — matches
--              the "Verify & Sign" pattern already shipped on job cards).
--   external — a driver/customer with no app account, signing via a one-time
--              link (esign.signature_requests.token_hash), scoped to exactly
--              one subject and expiring after a fixed window.
--
-- All mutations go through a server route using the service-role client
-- (getAdminClient()) — there is no existing per-row/token RLS pattern in this
-- codebase to build on safely, so `authenticated` gets SELECT only here and
-- external writes never touch RLS/anon at all.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS esign;

CREATE TABLE IF NOT EXISTS esign.signature_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type       text NOT NULL,
  subject_id         text NOT NULL,
  title              text NOT NULL,
  signer_kind        text NOT NULL CHECK (signer_kind IN ('internal','external')),
  signer_user_id     uuid,
  signer_name        text,
  signer_contact     text,
  token_hash         text UNIQUE,
  token_expires_at   timestamptz,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','voided','expired')),
  signature_id       uuid,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  voided_at          timestamptz,
  voided_by          uuid,
  void_reason        text
);

CREATE INDEX IF NOT EXISTS signature_requests_subject_idx
  ON esign.signature_requests (subject_type, subject_id);

-- One live pending request per subject — a new request auto-voids the prior
-- one (application-enforced "last request wins"); this index is the backstop.
CREATE UNIQUE INDEX IF NOT EXISTS signature_requests_one_pending_per_subject
  ON esign.signature_requests (subject_type, subject_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS esign.signatures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL,
  subject_type     text NOT NULL,
  subject_id       text NOT NULL,
  signer_kind      text NOT NULL CHECK (signer_kind IN ('internal','external')),
  signer_user_id   uuid,
  signer_name      text NOT NULL,
  signature_image  text NOT NULL,
  signature_hash   text NOT NULL,
  signed_at        timestamptz NOT NULL DEFAULT now(),
  ip_address       inet,
  user_agent       text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text
);

ALTER TABLE esign.signature_requests
  ADD CONSTRAINT signature_requests_signature_id_fkey
  FOREIGN KEY (signature_id) REFERENCES esign.signatures(id);

ALTER TABLE esign.signatures
  ADD CONSTRAINT signatures_request_id_fkey
  FOREIGN KEY (request_id) REFERENCES esign.signature_requests(id);

CREATE INDEX IF NOT EXISTS signatures_subject_idx ON esign.signatures (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS signatures_request_idx ON esign.signatures (request_id);

-- ── Immutability: a signed row can only ever transition active -> voided.
-- No field on a signature is ever editable, and rows are never deletable —
-- a correction is a void on this row plus a brand new signature_requests row.
CREATE OR REPLACE FUNCTION esign.protect_signature_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'esign.signatures rows cannot be deleted — void instead';
  END IF;

  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'esign.signatures row % is already voided and cannot be modified', OLD.id;
  END IF;

  IF NEW.status = 'active' AND (
    NEW.signature_image IS DISTINCT FROM OLD.signature_image OR
    NEW.signature_hash  IS DISTINCT FROM OLD.signature_hash  OR
    NEW.signed_at       IS DISTINCT FROM OLD.signed_at       OR
    NEW.signer_user_id  IS DISTINCT FROM OLD.signer_user_id  OR
    NEW.signer_name     IS DISTINCT FROM OLD.signer_name     OR
    NEW.ip_address      IS DISTINCT FROM OLD.ip_address      OR
    NEW.subject_type    IS DISTINCT FROM OLD.subject_type    OR
    NEW.subject_id      IS DISTINCT FROM OLD.subject_id
  ) THEN
    RAISE EXCEPTION 'esign.signatures core fields cannot be edited — void and create a new signature instead';
  END IF;

  IF NEW.status = 'voided' AND (NEW.voided_at IS NULL OR NEW.voided_by IS NULL) THEN
    RAISE EXCEPTION 'voiding a signature requires voided_at and voided_by';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signatures_immutability ON esign.signatures;
CREATE TRIGGER signatures_immutability
  BEFORE UPDATE OR DELETE ON esign.signatures
  FOR EACH ROW EXECUTE FUNCTION esign.protect_signature_immutability();

ALTER TABLE esign.signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign.signatures         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_signature_requests" ON esign.signature_requests;
CREATE POLICY "authenticated_read_signature_requests"
  ON esign.signature_requests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_signatures" ON esign.signatures;
CREATE POLICY "authenticated_read_signatures"
  ON esign.signatures FOR SELECT TO authenticated USING (true);

GRANT USAGE ON SCHEMA esign TO authenticated, service_role;
GRANT SELECT ON esign.signature_requests, esign.signatures TO authenticated;
GRANT ALL ON esign.signature_requests, esign.signatures TO service_role;

NOTIFY pgrst, 'reload schema';

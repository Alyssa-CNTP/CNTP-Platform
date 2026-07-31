-- Persisted COA sign-offs so the lab manager and quality manager can sign the
-- same COA from their own logins at different times. One row per batch; each
-- slot records who signed, the signature applied (their own, captured at sign
-- time), and when. `status` drives the lab → QA hand-off.
CREATE TABLE IF NOT EXISTS qms.coa_signoffs (
  batch_no       text primary key,
  customer       text,
  grade          text,
  lab_name       text,
  lab_signed_by  text,
  lab_signature  text,
  lab_signed_at  timestamptz,
  qa_name        text,
  qa_signed_by   text,
  qa_signature   text,
  qa_signed_at   timestamptz,
  status         text not null default 'draft',   -- draft | lab_signed | sent_to_qa | complete
  sent_to_qa_at  timestamptz,
  updated_at     timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS coa_signoffs_status_idx ON qms.coa_signoffs (status);

GRANT SELECT ON qms.coa_signoffs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON qms.coa_signoffs TO authenticated, service_role;

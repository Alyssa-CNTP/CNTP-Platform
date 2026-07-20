-- 20260717_006_coa_signatories.sql
-- COA signatory blocks — editable title/name and a drawable signature image
-- (PNG data URL), shared across all generated COAs. Seeded with the two current
-- signatories (Laboratory Supervisor, Quality Assurance Manager).

CREATE TABLE IF NOT EXISTS qms.coa_signatories (
  slot        int primary key,
  title       text,
  name        text,
  signature   text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

GRANT SELECT ON qms.coa_signatories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON qms.coa_signatories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON qms.coa_signatories TO service_role;

INSERT INTO qms.coa_signatories (slot, title, name) VALUES
  (1, 'Laboratory Supervisor', 'Monique Gordon'),
  (2, 'Quality Assurance Manager', 'Michelle Brown')
ON CONFLICT (slot) DO NOTHING;

COMMENT ON TABLE qms.coa_signatories IS 'COA signatory blocks — editable title/name and a drawable signature image, shared across all generated COAs.';

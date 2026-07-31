-- COA signatures now come from each signer's Staff Directory record
-- (production.employee_signatures) and are applied only by the person logged in
-- as that signatory. The per-signatory stored signature image is no longer used,
-- so drop it. The slot/title/name/email designation is kept.
ALTER TABLE qms.coa_signatories DROP COLUMN IF EXISTS signature;

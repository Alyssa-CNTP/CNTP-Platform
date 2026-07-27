-- COA signatories: (1) add a login email per signatory so the COA sign-off can
-- be restricted to the person logged in as that signatory, and (2) point the two
-- standing signatories at their signature image files (served from /public).

ALTER TABLE qms.coa_signatories ADD COLUMN IF NOT EXISTS email text;

UPDATE qms.coa_signatories SET signature = '/signatures/monique-gordon.png' WHERE slot = 1;  -- Monique Gordon, Laboratory Supervisor
UPDATE qms.coa_signatories SET signature = '/signatures/michelle-brown.png' WHERE slot = 2;  -- Michelle Brown, Quality Assurance Manager

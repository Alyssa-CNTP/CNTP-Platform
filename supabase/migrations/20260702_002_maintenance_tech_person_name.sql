-- Add person_name to maintenance.tech_auth so it can be the primary
-- lookup key (mirrors how production.operators stores the tech's name).
-- person_name matches roster_entries.person_name (normalised comparison).

ALTER TABLE maintenance.tech_auth
  ADD COLUMN IF NOT EXISTS person_name text;

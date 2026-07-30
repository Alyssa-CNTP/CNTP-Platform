-- ============================================================
-- CNTP — link lab/PIN sign-in accounts to the Staff Directory by ID
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- Depends on: qms.lab_auth, production.employees
-- ============================================================
--
-- Lab/PIN accounts were created keyed by NAME with no link to the person's
-- Staff Directory profile. Add employee_id so a PIN is one identity tied to the
-- profile by ID, and back-fill it by an UNAMBIGUOUS name match (skip anything
-- with zero or multiple matches — those get linked by hand). Verified on prod:
-- all 12 existing accounts match exactly one person.
-- ============================================================

ALTER TABLE qms.lab_auth ADD COLUMN IF NOT EXISTS employee_id uuid;

CREATE INDEX IF NOT EXISTS lab_auth_employee_idx ON qms.lab_auth(employee_id);

-- One-time back-fill: link only where exactly one active-or-any employee matches
-- the account's full_name (on name OR display_name, case/space-insensitive).
WITH m AS (
  SELECT la.user_id,
         MIN(e.id::text)        AS emp_id,
         COUNT(DISTINCT e.id)   AS n
  FROM   qms.lab_auth la
  JOIN   production.employees e
    ON   lower(btrim(la.full_name)) IN (lower(btrim(e.name)), lower(btrim(coalesce(e.display_name, ''))))
  WHERE  la.employee_id IS NULL
  GROUP  BY la.user_id
)
UPDATE qms.lab_auth la
SET    employee_id = m.emp_id::uuid
FROM   m
WHERE  la.user_id = m.user_id
  AND  m.n = 1;

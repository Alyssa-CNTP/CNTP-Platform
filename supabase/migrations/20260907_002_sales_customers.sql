-- ============================================================
-- sales.customers — the customer master that did not exist.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- ============================================================
--
-- Three places in the app already read a customers table and none of them
-- found one (checked 2026-09-07): app/(app)/logistics/dispatch/new reads
-- logistics.customers, and public./sales.customers were both absent. The only
-- populated customer data is qms.customer_specs.customer — a TEXT name on 45
-- quality spec rows, across 10 real customers.
--
-- So customer identity has been implied by a string in the quality module.
-- That is why label_templates.customer had to be text (20260907_001) and why
-- there is nowhere to record who owns an account.
--
-- ── What this is for ────────────────────────────────────────────────────────
--
--   1. A canonical, UNIQUE customer name. qms.customer_specs.customer is not
--      unique by design (one customer holds many spec rows), so it can never
--      be the key. This table can.
--   2. Somewhere to record the SALES REP who owns the account, so the label
--      library can group by sales lead and a rep sees their own customers
--      first.
--
-- ── The name is the natural key, and stays that way ─────────────────────────
--
-- `name` is UNIQUE, so label_templates.customer (text) can point at it without
-- being rewritten to a uuid. That is deliberate: a surrogate-key migration
-- across a live label library, mid-testing, buys referential integrity at the
-- cost of touching approved records. The uuid `id` exists for future rows that
-- want it; nothing is forced onto it now.
--
-- NOT adding a FOREIGN KEY from public.label_templates.customer to name yet.
-- It is the obvious next step and ON UPDATE CASCADE would make renames free —
-- but a label already carrying a customer value that is not in this table
-- would fail the constraint, and finding that out mid-test is worse than
-- waiting one migration. Add it once the library is assigned and quiet.
--
-- ── Why the rep is an employee id and not a role ────────────────────────────
--
-- `sales_rep_employee_id` follows the Staff Directory identity chain the rest
-- of the app uses — auth.users.id -> shared.app_roles.user_id ->
-- app_roles.employee_id -> production.employees.id (ARCHITECTURE.md, and the
-- same link job-card sign-offs rely on). Not a role name, because "the sales
-- rep" is a person, and roles are held by many people.
--
-- ON DELETE SET NULL, not CASCADE: offboarding a rep must orphan the
-- assignment, never delete the customer. Employees are soft-deleted here
-- anyway, so this is belt and braces.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales.customers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical spelling. Matches qms.customer_specs.customer, and is the value
  -- label_templates.customer stores.
  name                  text NOT NULL UNIQUE,

  -- Inactive keeps history readable without offering the customer in pickers.
  active                boolean NOT NULL DEFAULT true,

  -- Who owns the account. NULL = unassigned, which is the honest state for
  -- every row until someone is given it.
  sales_rep_employee_id uuid REFERENCES production.employees(id) ON DELETE SET NULL,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sales.customers IS
  'Customer master. `name` is the canonical spelling and the natural key that '
  'public.label_templates.customer stores; qms.customer_specs.customer uses the '
  'same vocabulary but is not unique. sales_rep_employee_id is the Staff '
  'Directory person who owns the account (production.employees.id).';

-- The label library groups by rep, and a rep opens "my customers" on every load.
CREATE INDEX IF NOT EXISTS customers_sales_rep_idx
  ON sales.customers (sales_rep_employee_id) WHERE sales_rep_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_active_name_idx
  ON sales.customers (active, name);

ALTER TABLE sales.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_all_customers ON sales.customers;
CREATE POLICY authenticated_all_customers ON sales.customers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON sales.customers TO authenticated, service_role;

-- ── Seed from the customers quality already knows ───────────────────────────
--
-- Idempotent: re-running adds only names that appeared since. It does NOT
-- rename or deactivate anything, because a spelling in customer_specs is not
-- authority to overwrite a spelling someone has since corrected here.
INSERT INTO sales.customers (name)
SELECT DISTINCT btrim(cs.customer)
FROM qms.customer_specs cs
WHERE cs.customer IS NOT NULL
  AND btrim(cs.customer) <> ''
ON CONFLICT (name) DO NOTHING;

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT name, active, sales_rep_employee_id FROM sales.customers ORDER BY name;
--
-- Expected on staging: 10 rows — Afri Tea and Coffee's, Alveus, East West Tea
-- Company (EWTC), Edelweiss, Entyce, Kunitaro, Lipton and Infusion, Lupicia,
-- OTG, Tanganda. All with sales_rep_employee_id NULL.

-- ── Assign a rep — DATA, run deliberately, not part of the schema ───────────
--
-- Alyssa asked to be assigned so the approve -> PO -> job card -> capture chain
-- can be walked end to end. Kept as a separate statement rather than folded
-- into the seed above, because who owns an account is an operational decision
-- and a migration is the wrong place to make it permanent for production.
--
-- Alyssa Krishna = production.employees.id b72f70cb-a721-4652-9c63-05f6b3ac1e7e
-- (via shared.app_roles.employee_id on the senior_developer row).
--
-- Assigns the two customers named in the label discussion. Change the IN list,
-- or drop the WHERE for all ten.

UPDATE sales.customers
SET    sales_rep_employee_id = 'b72f70cb-a721-4652-9c63-05f6b3ac1e7e',
       updated_at            = now()
WHERE  name IN ('Kunitaro', 'Lipton and Infusion');

-- ── Rollback ────────────────────────────────────────────────────────────────
--
--   DROP TABLE IF EXISTS sales.customers;
--
-- Safe: nothing references it yet. label_templates.customer holds a name, not
-- a key, so dropping this does not orphan a label.

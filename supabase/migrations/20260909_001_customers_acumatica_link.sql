-- ============================================================
-- sales.customers.acumatica_customer_id — link an account to the ERP.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Then:   NOTIFY pgrst, 'reload schema';
-- ============================================================
--
-- The Sales customer dashboard shows one account's open Acumatica sales
-- orders. To do that it has to know which Acumatica customer an account IS,
-- and the names cannot answer that. Measured against the 149 rows synced into
-- acumatica.sales_orders on 2026-09-09:
--
--   sales.customers.name            acumatica.sales_orders.customer_name
--   ------------------------------  --------------------------------------------
--   Kunitaro                        Kunitaro Co.  Ltd
--   Lipton and Infusion             Lipton Teas and Infusions Manufacturing SA
--   Afri Tea and Coffee's           Afri Tea and Coffee Blenders (1963) Ltd
--   East West Tea Company (EWTC)    East West Tea Company, LLC
--   Edelweiss                       Edelweiss Laboratories (Pty) Ltd
--   Tanganda                        Tanganda Tea Company Ltd
--   OTG                             Ostfriesische Tee Gesellschaft GmbH & Co KG
--
-- The first six could be coaxed into matching with enough normalisation and
-- prefix trickery. The last one cannot: "OTG" shares no token with
-- "Ostfriesische Tee Gesellschaft" — it is an initialism. Neither can Entyce,
-- which trades under National Brands Limited in Acumatica and shares nothing
-- with it at all.
--
-- Any matcher good enough for those two is loose enough to produce a wrong
-- match somewhere else, and a wrong match here shows one customer's orders on
-- another customer's page. So: no matching. An explicit key.
--
-- ── Why the customer ID and not another alias table ─────────────────────────
--
-- qms.customer_aliases (20260903_002) already exists and is the right tool for
-- what it does — absorbing the many spellings of a customer name that get
-- TYPED on a production run, resolving them to the spelling customer_specs
-- uses. It is keyed on names because names are what runs carry.
--
-- Acumatica gives us something better: `C-KUN001`. It is assigned by the ERP,
-- it is stable across a legal-entity rename, and it is already on every synced
-- order row. Aliasing names when a durable key is sitting in the same table
-- would be choosing the weaker join.
--
-- ── Nullable, and unique only when set ──────────────────────────────────────
--
-- Alveus and Lupicia have no order in the synced window at all, so they have no
-- ID to record yet. NULL is the honest state and the dashboard says "not linked
-- to Acumatica" rather than silently showing an empty order list, which would
-- read identically to a customer who simply has no open orders.
-- ============================================================

ALTER TABLE sales.customers
  ADD COLUMN IF NOT EXISTS acumatica_customer_id text;

COMMENT ON COLUMN sales.customers.acumatica_customer_id IS
  'Acumatica CustomerID (e.g. C-KUN001) — the join key to '
  'acumatica.sales_orders.customer_id. Names cannot be matched: OTG is an '
  'initialism of Ostfriesische Tee Gesellschaft and Entyce trades as National '
  'Brands Limited. NULL = not yet linked, which the dashboard states rather '
  'than showing as "no orders".';

-- One account per ERP customer. Two accounts pointing at C-KUN001 would double
-- every Kunitaro order across two dashboards and neither would be wrong on its
-- own terms, which is the hardest kind of reporting bug to notice.
CREATE UNIQUE INDEX IF NOT EXISTS customers_acumatica_id_uniq
  ON sales.customers (acumatica_customer_id)
  WHERE acumatica_customer_id IS NOT NULL;

-- ── Seed the seven that are unambiguous ─────────────────────────────────────
--
-- Each of these was read off the synced order data, not inferred. Idempotent
-- and non-destructive: only fills a NULL, so a link corrected by hand in the
-- app is never overwritten by re-running this.
UPDATE sales.customers SET acumatica_customer_id = v.acu
FROM (VALUES
  ('Kunitaro',                     'C-KUN001'),
  ('Lipton and Infusion',          'C-LTI001'),
  ('Afri Tea and Coffee''s',       'C-AFR001'),
  ('East West Tea Company (EWTC)', 'C-EWT001'),
  ('Edelweiss',                    'C-EDE001'),
  ('Tanganda',                     'C-TAN001'),
  ('OTG',                          'C-OTG001')
) AS v(nm, acu)
WHERE sales.customers.name = v.nm
  AND sales.customers.acumatica_customer_id IS NULL;

-- ── Deliberately NOT seeded ─────────────────────────────────────────────────
--
--   Entyce   -> C-NAT001 "National Brands Limited" is very probably right —
--               Entyce Beverages is National Brands' beverage division — but
--               "very probably" is not a basis for attributing 16 orders to an
--               account. Link it in the app once someone confirms it.
--   Alveus   -> no order in the synced window. Nothing to link to yet.
--   Lupicia  -> same.
--
-- Link them from /sales/customers/<name>, which writes this column and records
-- who did it.

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT name, acumatica_customer_id FROM sales.customers ORDER BY name;
--   -- expect 7 populated, 3 NULL (Alveus, Entyce, Lupicia)
--
--   -- orders now reachable per account:
--   SELECT c.name, count(*) AS lines
--   FROM sales.customers c
--   JOIN acumatica.sales_orders o ON o.customer_id = c.acumatica_customer_id
--   GROUP BY c.name ORDER BY 2 DESC;
--
-- ⚠ THEN RELOAD THE CACHE, or the app gets 404/PGRST205 on a column that exists:
--
--   NOTIFY pgrst, 'reload schema';
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--
--   DROP INDEX IF EXISTS sales.customers_acumatica_id_uniq;
--   ALTER TABLE sales.customers DROP COLUMN IF EXISTS acumatica_customer_id;

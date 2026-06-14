-- ============================================================
-- DEMO DATA — Monthly Stock Count (Rooibos · BHW)
-- Run in: Supabase SQL Editor (staging)
-- ============================================================
-- Seeds two monthly count sessions so the Monthly Count sub-tabs
-- (Comparison · Reconciliation · Batch Ledger · Variances) populate
-- with realistic data you can click through:
--   • Feb 2026  — opening stock (so Reconciliation has a previous month)
--   • Mar 2026  — the showcase month (both counts submitted, mix of
--                 matches and variances)
-- Counters are labelled Warehouse Supervisor (role 'supervisor') and
-- Stock (role 'admin'). Open Stock Count → Monthly Count, navigate to
-- MARCH 2026, product Rooibos.
--
-- 100% SAFE + DELETABLE. Re-running replaces the demo. To remove it,
-- run the DELETE block at the bottom.
--
-- PREREQUISITE: run migration 20260614_004_monthly_count_tables.sql FIRST
-- (it creates production.mc_sessions / mc_entries / mc_reviews).
-- ============================================================

-- ── Clean any prior demo (idempotent) ───────────────────────
DELETE FROM production.mc_entries WHERE session_id IN (
  SELECT id FROM production.mc_sessions
  WHERE warehouse_id = 'BHW' AND product_type = 'r'
    AND count_month IN ('2026-02-01','2026-03-01')
);
DELETE FROM production.mc_sessions
  WHERE warehouse_id = 'BHW' AND product_type = 'r'
    AND count_month IN ('2026-02-01','2026-03-01');

-- ── February 2026 — opening stock ───────────────────────────
WITH s AS (
  INSERT INTO production.mc_sessions
    (count_month, warehouse_id, product_type, sup_name, adm_name,
     sup_confirmed_at, adm_confirmed_at, sup_total_kg, adm_total_kg, match_rate_pct)
  VALUES
    ('2026-02-01','BHW','r','Demo Warehouse Supervisor','Demo Stock Controller',
     '2026-02-02T07:30:00Z','2026-02-02T08:05:00Z',11830.0,11830.0,100)
  RETURNING id
)
INSERT INTO production.mc_entries
  (session_id, section_id, section_name, inventory_code, item_name, batch_number, role, kg, bags_qty, is_no_stock)
SELECT s.id, e.section_id, e.section_name, e.inventory_code, e.item_name, e.batch_number, e.role, e.kg, e.bags_qty, e.is_no_stock
FROM s, (VALUES
  ('sieve','Sieving Tower','OPEN-SIEVE','Sieving Tower — opening stock','FEB-OPEN','supervisor',3150.0,63,false),
  ('sieve','Sieving Tower','OPEN-SIEVE','Sieving Tower — opening stock','FEB-OPEN','admin',3150.0,63,false),
  ('ref1','Refining 1','OPEN-REF1','Refining 1 — opening stock','FEB-OPEN','supervisor',2100.0,42,false),
  ('ref1','Refining 1','OPEN-REF1','Refining 1 — opening stock','FEB-OPEN','admin',2100.0,42,false),
  ('ref2','Refining 2','OPEN-REF2','Refining 2 — opening stock','FEB-OPEN','supervisor',1480.0,30,false),
  ('ref2','Refining 2','OPEN-REF2','Refining 2 — opening stock','FEB-OPEN','admin',1480.0,30,false),
  ('gran','Granule Line','OPEN-GRAN','Granule Line — opening stock','FEB-OPEN','supervisor',700.0,14,false),
  ('gran','Granule Line','OPEN-GRAN','Granule Line — opening stock','FEB-OPEN','admin',700.0,14,false),
  ('fp','Final Product','OPEN-FP','Final Product — opening stock','FEB-OPEN','supervisor',4400.0,88,false),
  ('fp','Final Product','OPEN-FP','Final Product — opening stock','FEB-OPEN','admin',4400.0,88,false)
) AS e(section_id, section_name, inventory_code, item_name, batch_number, role, kg, bags_qty, is_no_stock);

-- ── March 2026 — showcase month (both counts submitted) ─────
WITH s AS (
  INSERT INTO production.mc_sessions
    (count_month, warehouse_id, product_type, sup_name, adm_name,
     sup_confirmed_at, adm_confirmed_at, sup_total_kg, adm_total_kg, match_rate_pct)
  VALUES
    ('2026-03-01','BHW','r','Demo Warehouse Supervisor','Demo Stock Controller',
     '2026-03-02T07:25:00Z','2026-03-02T08:15:00Z',12170.5,12030.0,60)
  RETURNING id
)
INSERT INTO production.mc_entries
  (session_id, section_id, section_name, inventory_code, item_name, batch_number, role, kg, bags_qty, is_no_stock)
SELECT s.id, e.section_id, e.section_name, e.inventory_code, e.item_name, e.batch_number, e.role, e.kg, e.bags_qty, e.is_no_stock
FROM s, (VALUES
  ('sieve','Sieving Tower','10LGEF','Fine Leaf: Export','R2603-EF','supervisor',1240.5,25,false),
  ('sieve','Sieving Tower','10LGEF','Fine Leaf: Export','R2603-EF','admin',1238.0,25,false),
  ('sieve','Sieving Tower','15IGDB','Dust: Brown','R2603-DB','supervisor',880.0,18,false),
  ('sieve','Sieving Tower','15IGDB','Dust: Brown','R2603-DB','admin',905.0,18,false),
  ('sieve','Sieving Tower','15IGST','Sticks (RS)','R2603-ST','supervisor',430.0,9,false),
  ('sieve','Sieving Tower','15IGST','Sticks (RS)','R2603-ST','admin',430.0,9,false),
  ('sieve','Sieving Tower','10LGEC','Coarse Leaf: Export','R2603-EC','supervisor',640.0,13,false),
  ('sieve','Sieving Tower','10LGEC','Coarse Leaf: Export','R2603-EC','admin',639.0,13,false),
  ('ref1','Refining 1','15IGDIS','Refined Dust','R2603-RD','supervisor',2100.0,42,false),
  ('ref1','Refining 1','15IGDIS','Refined Dust','R2603-RD','admin',1869.0,37,false),
  ('ref1','Refining 1','15IGST','Sticks (RS)','R2603-RS','supervisor',320.0,6,false),
  ('ref1','Refining 1','15IGST','Sticks (RS)','R2603-RS','admin',322.0,6,false),
  ('ref2','Refining 2','20BGCHS','Choice Grade','R2603-CG','supervisor',1500.0,30,false),
  ('ref2','Refining 2','20BGCHS','Choice Grade','R2603-CG','admin',1500.0,30,false),
  ('gran','Granule Line','25GRAN','Granule: Export','R2603-GR','supervisor',760.0,15,false),
  ('gran','Granule Line','25GRAN','Granule: Export','R2603-GR','admin',742.0,15,false),
  ('fp','Final Product','FP-EXP','Final Product: Export','R2603-FP','supervisor',3200.0,64,false),
  ('fp','Final Product','FP-EXP','Final Product: Export','R2603-FP','admin',3205.0,64,false),
  ('fp','Final Product','FP-BLD','Final Product: Blend','R2603-FB','supervisor',1100.0,22,false),
  ('fp','Final Product','FP-BLD','Final Product: Blend','R2603-FB','admin',1180.0,24,false)
) AS e(section_id, section_name, inventory_code, item_name, batch_number, role, kg, bags_qty, is_no_stock);

-- ── March bag tags + a production session ───────────────────
-- Lights up the Batch Ledger (count vs physical bag tags) and the
-- Reconciliation "Produced" + "Consumed / Dispatched" columns for Sieving.
DELETE FROM production.bag_tags WHERE serial_number LIKE 'DEMO-MC-%';
DELETE FROM production.prod_sessions WHERE comments = 'DEMO-MONTHLY-SEED';  -- cascades prod_mass_balance

-- A March production session for Sieving → 500 kg produced
WITH ps AS (
  INSERT INTO production.prod_sessions (section_id, date, shift, status, variant, comments)
  VALUES ('sieving','2026-03-15','morning','approved','Conventional','DEMO-MONTHLY-SEED')
  RETURNING id
)
INSERT INTO production.prod_mass_balance (session_id, total_input_kg, total_output_b_kg, total_output_c_kg, total_output_d_kg)
SELECT id, 1200, 500, 0, 0 FROM ps;

-- Bag tags for March (lot_number = monthly-count batches)
INSERT INTO production.bag_tags
  (serial_number, product_type, weight_kg, section_id, lot_number, status, created_at, consumed, consumed_at_section, consumed_weight_kg)
VALUES
  -- R2603-EF: physical bags ≈ counted (1239 kg) → Reconciled in Batch Ledger
  ('DEMO-MC-001','Leaf', 420,'sieving','R2603-EF','in_stock', '2026-03-12T09:00:00Z', false, NULL,   NULL),
  ('DEMO-MC-002','Leaf', 410,'sieving','R2603-EF','in_stock', '2026-03-13T09:00:00Z', false, NULL,   NULL),
  ('DEMO-MC-003','Leaf', 408,'sieving','R2603-EF','in_stock', '2026-03-14T09:00:00Z', false, NULL,   NULL),
  -- R2603-DB: physical bags below counted (892 kg) → Variance in Batch Ledger
  ('DEMO-MC-004','Dust', 350,'sieving','R2603-DB','in_stock', '2026-03-12T09:00:00Z', false, NULL,   NULL),
  ('DEMO-MC-005','Dust', 360,'sieving','R2603-DB','in_stock', '2026-03-13T09:00:00Z', false, NULL,   NULL),
  -- Consumed at Sieving → Reconciliation "Consumed / Dispatched" = 330 kg
  ('DEMO-MC-006','Leaf', 180,'sieving','R2603-EC','consumed', '2026-03-16T09:00:00Z', true,  'sieving', 180),
  ('DEMO-MC-007','Leaf', 150,'sieving','R2603-EC','consumed', '2026-03-17T09:00:00Z', true,  'sieving', 150);

-- ── TO REMOVE THE DEMO (run this block) ─────────────────────
-- DELETE FROM production.mc_entries WHERE session_id IN (
--   SELECT id FROM production.mc_sessions
--   WHERE warehouse_id='BHW' AND product_type='r' AND count_month IN ('2026-02-01','2026-03-01'));
-- DELETE FROM production.mc_sessions
--   WHERE warehouse_id='BHW' AND product_type='r' AND count_month IN ('2026-02-01','2026-03-01');
-- DELETE FROM production.bag_tags WHERE serial_number LIKE 'DEMO-MC-%';
-- DELETE FROM production.prod_sessions WHERE comments = 'DEMO-MONTHLY-SEED';

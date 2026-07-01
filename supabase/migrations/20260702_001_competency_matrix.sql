-- ============================================================
-- CNTP Staff Profiles + Skills/Competency Matrix
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260623_001_staff_directory.sql (production.employees,
--             production.set_updated_at),
--             20260622_001_roster.sql (production.roster_roles)
-- ============================================================
--
-- Adds the SOP/Work-Instruction catalogue, per-person competency records,
-- an append-only competency history (FSSC audit trail), and a table that
-- maps roster roles / floor sections to their required SOPs (Phase-2
-- allocation validation). Also adds profile columns to production.employees.
--
-- Status legend (mirrors the SOP_Matrix_Final.xlsx progress scale):
--   not_started  0.00  Not Trained / raw 0
--   sop_created  0.25  SOP exists, person not trained yet
--   training_done 0.50 Training conducted, not assessed
--   assessed      0.75 Assessment complete, not signed off
--   competent     1.00 COMP or CT (confirmed = score 1 in Training Information sheet)
--   not_competent 0.00 NC — assessed and failed (distinct from not_started)
--   tba           NULL TBA — planned / to be assessed
-- ============================================================

-- ── 1. Extend production.employees ───────────────────────────────────────────
-- Additive only — existing rows and behaviour are unchanged.

ALTER TABLE production.employees
  ADD COLUMN IF NOT EXISTS employee_code   text,
  ADD COLUMN IF NOT EXISTS position        text,        -- 'Snr Operator', 'Jnr Cleaner'
  ADD COLUMN IF NOT EXISTS position_code   text,        -- 'SPO', 'JC', 'GENWRK'
  ADD COLUMN IF NOT EXISTS department_code text,        -- raw sheet code: PRD, QUA, PRG
  ADD COLUMN IF NOT EXISTS start_date      date,
  ADD COLUMN IF NOT EXISTS years_of_service numeric(4,1),  -- fallback if only years known
  ADD COLUMN IF NOT EXISTS email           text,
  ADD COLUMN IF NOT EXISTS photo_url       text;

CREATE UNIQUE INDEX IF NOT EXISTS employees_code_idx
  ON production.employees(lower(employee_code)) WHERE employee_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS employees_position_code_idx
  ON production.employees(position_code) WHERE position_code IS NOT NULL;

-- ── 2. production.sops — the SOP / Work-Instruction catalogue ────────────────

CREATE TABLE IF NOT EXISTS production.sops (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_no       text        NOT NULL,                     -- 'PROD-WI-001', 'LAB-WI-003'
  title        text        NOT NULL,
  area         text        NOT NULL DEFAULT 'production'
                 CHECK (area IN ('production','rosehip','stores','quality','laboratory',
                                 'hygiene','maintenance','food_safety','other')),
  doc_type     text        NOT NULL DEFAULT 'wi'
                 CHECK (doc_type IN ('wi','sop','training','policy')),
  revision     text,
  status       text        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('draft','active','under_review','obsolete')),
  -- Set only for the ~6 equipment SOPs that map 1:1 to a floor capture section.
  -- NULL for multi-section or non-floor SOPs (training, food-safety, lab).
  section_id   text,
  planned_date date,
  actual_date  date,
  sort_order   integer     NOT NULL DEFAULT 0,
  active       boolean     NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sops_doc_no_lower_idx  ON production.sops(lower(doc_no));
CREATE INDEX IF NOT EXISTS sops_area_idx                 ON production.sops(area) WHERE active;
CREATE INDEX IF NOT EXISTS sops_section_idx              ON production.sops(section_id) WHERE section_id IS NOT NULL;

DROP TRIGGER IF EXISTS sops_updated_at ON production.sops;
CREATE TRIGGER sops_updated_at
  BEFORE UPDATE ON production.sops
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE production.sops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_sops" ON production.sops;
CREATE POLICY "authenticated_all_sops"
  ON production.sops FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. production.employee_competencies — the matrix (current state) ─────────

CREATE TABLE IF NOT EXISTS production.employee_competencies (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id         uuid        NOT NULL REFERENCES production.employees(id) ON DELETE CASCADE,
  sop_id              uuid        NOT NULL REFERENCES production.sops(id)      ON DELETE CASCADE,
  status              text        NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started','sop_created','training_done',
                                          'assessed','competent','not_competent','tba')),
  raw_code            text,            -- exact value from spreadsheet, preserved for traceability
  score               numeric(3,2) CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  training_completed  boolean     NOT NULL DEFAULT false,
  date_completed      date,
  assessed_by         uuid        REFERENCES production.employees(id) ON DELETE SET NULL,
  assessed_at         date,
  next_review         date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, sop_id)
);

CREATE INDEX IF NOT EXISTS emp_comp_employee_idx ON production.employee_competencies(employee_id);
CREATE INDEX IF NOT EXISTS emp_comp_sop_idx      ON production.employee_competencies(sop_id);
CREATE INDEX IF NOT EXISTS emp_comp_status_idx   ON production.employee_competencies(status);
-- Phase-3 training reminders: drive off next_review / planned_date
CREATE INDEX IF NOT EXISTS emp_comp_review_idx
  ON production.employee_competencies(next_review) WHERE next_review IS NOT NULL;

DROP TRIGGER IF EXISTS employee_competencies_updated_at ON production.employee_competencies;
CREATE TRIGGER employee_competencies_updated_at
  BEFORE UPDATE ON production.employee_competencies
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE production.employee_competencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_employee_competencies" ON production.employee_competencies;
CREATE POLICY "authenticated_all_employee_competencies"
  ON production.employee_competencies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 4. production.competency_history — append-only FSSC audit trail ──────────

CREATE TABLE IF NOT EXISTS production.competency_history (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- References the current competency row; survives deletes via SET NULL.
  competency_id    uuid        REFERENCES production.employee_competencies(id) ON DELETE SET NULL,
  -- Denormalised: self-describing forever even if the competency row is deleted.
  employee_id      uuid        NOT NULL,
  sop_id           uuid        NOT NULL,
  action           text        NOT NULL
                     CHECK (action IN ('created','status_change','assessed',
                                       'reviewed','deleted','imported')),
  from_status      text,
  to_status        text,
  from_score       numeric(3,2),
  to_score         numeric(3,2),
  changed_by       uuid,            -- auth.users id; NULL for import / system actions
  changed_by_name  text,            -- denormalised for cheap display
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comp_hist_competency_idx ON production.competency_history(competency_id);
CREATE INDEX IF NOT EXISTS comp_hist_employee_idx   ON production.competency_history(employee_id);
CREATE INDEX IF NOT EXISTS comp_hist_created_idx    ON production.competency_history(created_at DESC);

ALTER TABLE production.competency_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_competency_history" ON production.competency_history;
CREATE POLICY "authenticated_all_competency_history"
  ON production.competency_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 5. production.role_required_sops — Phase-2 allocation validation ─────────
-- Each row says: this roster role (or floor section) requires this SOP
-- at this minimum status. Powers the competency-gap warning on allocation.

CREATE TABLE IF NOT EXISTS production.role_required_sops (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  -- One or both of role_key / section_id must be set.
  role_key     text        REFERENCES production.roster_roles(key) ON DELETE CASCADE,
  section_id   text,        -- one of the 6 floor sections from capture-config
  sop_id       uuid        NOT NULL REFERENCES production.sops(id) ON DELETE CASCADE,
  requirement  text        NOT NULL DEFAULT 'required'
                 CHECK (requirement IN ('required','recommended')),
  min_status   text        NOT NULL DEFAULT 'competent'
                 CHECK (min_status IN ('training_done','assessed','competent')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_or_section_required CHECK (role_key IS NOT NULL OR section_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS role_req_sop_role_idx
  ON production.role_required_sops(role_key, sop_id) WHERE role_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS role_req_sop_section_idx
  ON production.role_required_sops(section_id, sop_id) WHERE section_id IS NOT NULL;

ALTER TABLE production.role_required_sops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_role_required_sops" ON production.role_required_sops;
CREATE POLICY "authenticated_all_role_required_sops"
  ON production.role_required_sops FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 6. Grants (mirror 20260622_001_roster.sql) ───────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON production.sops                 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON production.employee_competencies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON production.competency_history    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON production.role_required_sops    TO authenticated;

-- ── 7. Seed: SOP / Work-Instruction catalogue ─────────────────────────────────
-- Source: SOP_Matrix_Final.xlsx (Schedual + Training Information sheets).
-- doc_no is the natural key — upsert anchors on lower(doc_no).
-- section_id set only where there is a direct 1:1 mapping to a floor section.
-- Idempotent: INSERT ... ON CONFLICT DO UPDATE.

INSERT INTO production.sops (doc_no, title, area, doc_type, revision, status, section_id, sort_order)
VALUES
  -- Production — core machine SOPs
  ('PROD-WI-001', 'Factory Generator',                           'production',   'wi',  '0',  'active', NULL,         10),
  ('PROD-WI-002', 'Refining 1 (Rooibos)',                        'production',   'wi',  '1',  'active', 'refining1',  20),
  ('PROD-WI-003', 'Pasteuriser',                                 'production',   'wi',  '11', 'active', 'pasteuriser',30),
  ('PROD-WI-004', 'Sieving Tower (Rooibos)',                     'production',   'wi',  '7',  'active', 'sieving',    40),
  ('PROD-WI-005', 'Granulation (Rooibos)',                       'production',   'wi',  '1',  'active', 'granule',    50),
  ('PROD-WI-006', 'Blender (Rooibos)',                           'production',   'wi',  '0',  'active', 'blender',    60),
  ('PROD-WI-007', 'Refining 2 (Rooibos)',                        'production',   'wi',  '6',  'active', 'refining2',  70),
  ('PROD-WI-008', 'X-Ray scanning (Rooibos)',                    'production',   'wi',  '0',  'active', NULL,         80),
  ('PWI-010',     'Boiler Operating Procedure - Start Up & Shutdown', 'production','wi','0',  'active', NULL,         90),
  ('PWI-011',     'Operating Procedure for Boiler Blowdowns',    'production',   'wi',  '0',  'active', NULL,        100),
  ('PWI-014',     'Vacuum Packing',                              'production',   'wi',  '0',  'active', NULL,        110),
  ('PWI-01',      'Raw Material and Storage',                    'production',   'wi',  '10', 'active', NULL,        120),
  ('PWI-02',      'Debagging',                                   'production',   'wi',  '6',  'active', NULL,        130),
  ('PWI-05',      'Post Sieve',                                  'production',   'wi',  '7',  'active', NULL,        140),
  ('PWI-06',      'Bagging and Storage of Finished Product',     'production',   'wi',  '10', 'active', NULL,        150),
  ('PWI-013',     'Stitching Machine Procedure',                 'production',   'wi',  '0',  'active', NULL,        160),
  ('PWI-012',     'Operating Procedure for Boiler De-Gassing',   'production',   'wi',  '0',  'active', NULL,        170),

  -- Rosehip line
  ('PROD-WI-009', 'Crushing',                                    'rosehip',      'wi',  '0',  'active', NULL,        200),
  ('PROD-WI-010', 'Cutting',                                     'rosehip',      'wi',  '0',  'active', NULL,        210),
  ('PROD-WI-011', 'Hammermill',                                  'rosehip',      'wi',  '0',  'active', NULL,        220),
  ('PROD-WI-012', 'Pelletiser',                                  'rosehip',      'wi',  '0',  'active', NULL,        230),
  ('PROD-WI-013', 'Blending (Rosehip)',                          'rosehip',      'wi',  '0',  'active', NULL,        240),
  ('PROD-WI-014', 'Bagging (Rosehip)',                           'rosehip',      'wi',  '0',  'active', NULL,        250),

  -- Maintenance
  ('MWI-01',      'Maintenance Procedure',                       'maintenance',  'wi',  '2',  'active', NULL,        300),
  ('MWI-02',      'Scale Verification Procedure',                'maintenance',  'wi',  '1',  'active', NULL,        310),
  ('MWI-03',      'Decanting of Lubricants, Greases & Related Liquids', 'maintenance','wi','0','active',NULL,        320),
  ('MWI-04',      'Breakdown, Planned Maintenance & Repair Procedure',  'maintenance','wi','2','active',NULL,        330),
  ('MWI-05',      'Magnets for Metal Fragment Control and Food Safety',  'maintenance','wi','0','active',NULL,        340),
  ('MWI-06',      'Electrical Lockout and Tagout',               'maintenance',  'wi',  '0',  'active', NULL,        350),
  ('PWI-AC1',     'Changing of Rollers on HKJ 35',               'maintenance',  'wi',  '0',  'active', NULL,        360),
  ('PWI-AC2',     'Changing of the Ring on HKJ 35',              'maintenance',  'wi',  '0',  'active', NULL,        370),
  ('PWI-AC3',     'Setting the Rollers on HKJ 35',               'maintenance',  'wi',  '0',  'active', NULL,        380),

  -- Stores / Warehousing
  ('WL-WI-001',   'Receiving Raw Material and Storage',          'stores',       'wi',  '10', 'active', NULL,        400),
  ('WL-WI-002',   'Finished Goods Dispatch Procedure',           'stores',       'wi',  '9',  'active', NULL,        410),
  ('WL-WI-003',   'Returned Bulk Bag Inspection Procedure',      'stores',       'wi',  '0',  'active', NULL,        420),
  ('WL-WI-004',   'Forklift Safety',                             'stores',       'wi',  '0',  'active', NULL,        430),
  ('WL-WI-005',   'Good Storage Practices',                      'stores',       'wi',  '0',  'active', NULL,        440),
  ('WL-WI-006',   'Issuing, Isolation and On-Hold Material',     'stores',       'wi',  '0',  'active', NULL,        450),
  ('WL-WI-007',   'Handling of Packaging',                       'stores',       'wi',  '0',  'active', NULL,        460),

  -- Laboratory (Quality)
  ('LBM-01',      'Sampling',                                    'laboratory',   'wi',  '-',  'active', NULL,        500),
  ('LBM-02',      'Bulk Density',                                'laboratory',   'wi',  '-',  'active', NULL,        510),
  ('LBM-03',      'Taste, Colour & Aroma Evaluation',            'laboratory',   'wi',  '-',  'active', NULL,        520),
  ('LBM-04',      'Raw Clean Yield Determination',               'laboratory',   'wi',  '-',  'active', NULL,        530),
  ('LBM-05',      'Moisture Determination',                      'laboratory',   'wi',  '-',  'active', NULL,        540),
  ('LBM-06',      'Needle Count Test',                           'laboratory',   'wi',  '-',  'active', NULL,        550),
  ('LBM-07',      'Sieving Analysis of Rooibos Finished Product','laboratory',   'wi',  '-',  'active', NULL,        560),
  ('LBM-08',      'Sieving Analysis of Rosehip Finished Product','laboratory',   'wi',  '-',  'active', NULL,        570),
  ('LBM-09',      'External Lab Testing Schedule',               'laboratory',   'wi',  '-',  'active', NULL,        580),
  ('LBM-010',     'Instrument Verification Procedure',           'laboratory',   'wi',  '-',  'active', NULL,        590),
  ('LBM-011',     'Pesticide Residue Testing of Surfaces',       'laboratory',   'wi',  '-',  'active', NULL,        600),
  ('LBM-012',     'Flowability of Tea',                          'laboratory',   'wi',  '-',  'active', NULL,        610),
  ('LBM-013',     'Applying for an Export Certificate',          'laboratory',   'wi',  '-',  'active', NULL,        620),
  ('LBM-015',     'Determination of Moisture and Volatile Content - Rosehips', 'laboratory','wi','-','active',NULL,  630),
  ('LBM-016',     'Quality Assessment - Vacuum Packed Products', 'laboratory',   'wi',  '-',  'active', NULL,        640),
  ('LBM-017',     'pH Determination',                            'laboratory',   'wi',  '-',  'active', NULL,        650),
  ('LBM-018',     'TDS Determination',                           'laboratory',   'wi',  '-',  'active', NULL,        660),
  ('LBM-019',     'Positive Release Procedure',                  'laboratory',   'wi',  '-',  'active', NULL,        670),

  -- Hygiene
  ('HH-WI-001',   'Cleaning Instructions - Diamond Blender',                'hygiene', 'wi', '-', 'active', NULL,  700),
  ('HH-WI-002',   'Cleaning Instructions - Granule Mixing Tank',            'hygiene', 'wi', '-', 'active', NULL,  710),
  ('HH-WI-003',   'Cleaning Instructions - Production & Warehousing Floor', 'hygiene', 'wi', '-', 'active', NULL,  720),
  ('HH-WI-004',   'Cleaning Instructions - Magnets',                        'hygiene', 'wi', '-', 'active', NULL,  730),
  ('HH-WI-005',   'Cleaning Instructions - Cleaning of Fan',                'hygiene', 'wi', '-', 'active', NULL,  740),
  ('HH-WI-006',   'Cleaning Instructions - Strip Curtains',                 'hygiene', 'wi', '-', 'active', NULL,  750),

  -- Food Safety (training SOPs — no doc_no in source, use internal IDs)
  ('FS-001',      'Induction Training',                          'food_safety',  'training', NULL, 'active', NULL,  800),
  ('FS-002',      'Person in Charge (R638)',                     'food_safety',  'training', NULL, 'active', NULL,  810),
  ('FS-003',      'PRPs (Prerequisite Programmes)',              'food_safety',  'training', NULL, 'active', NULL,  820),
  ('FS-004',      'HACCP',                                       'food_safety',  'training', NULL, 'active', NULL,  830),
  ('FS-005',      'FSSC 22000',                                  'food_safety',  'training', NULL, 'active', NULL,  840),
  ('FS-006',      'FSSC 22000 V6',                               'food_safety',  'training', NULL, 'active', NULL,  850),
  ('FS-007',      'GMP Inspections',                             'food_safety',  'training', NULL, 'active', NULL,  860),
  ('FS-008',      'Pest Control',                                'food_safety',  'training', NULL, 'active', NULL,  870),
  ('FS-009',      'Food Safety for Maintenance',                 'food_safety',  'training', NULL, 'active', NULL,  880),
  ('FS-010',      'Labelling Regulations',                       'food_safety',  'training', NULL, 'active', NULL,  890),
  ('FS-011',      'Basic Food Safety Practices',                 'food_safety',  'training', NULL, 'active', NULL,  900)
ON CONFLICT (lower(doc_no)) DO UPDATE SET
  title        = EXCLUDED.title,
  area         = EXCLUDED.area,
  doc_type     = EXCLUDED.doc_type,
  revision     = EXCLUDED.revision,
  section_id   = EXCLUDED.section_id,
  sort_order   = EXCLUDED.sort_order,
  updated_at   = now();

-- ── 8. Seed: role_required_sops — starter set (editable in-app later) ─────────
-- Wires the 6 floor sections to their primary machine SOPs.
-- Use INSERT ... WHERE NOT EXISTS so re-runs don't duplicate.

INSERT INTO production.role_required_sops (section_id, sop_id, requirement, min_status)
SELECT s.section_id, sops.id, 'required', 'competent'
FROM (VALUES
  ('sieving',     'PROD-WI-004'),
  ('refining1',   'PROD-WI-002'),
  ('refining2',   'PROD-WI-007'),
  ('granule',     'PROD-WI-005'),
  ('blender',     'PROD-WI-006'),
  ('pasteuriser', 'PROD-WI-003')
) AS s(section_id, doc_no)
JOIN production.sops sops ON lower(sops.doc_no) = lower(s.doc_no)
WHERE NOT EXISTS (
  SELECT 1 FROM production.role_required_sops r
  WHERE r.section_id = s.section_id AND r.sop_id = sops.id
);

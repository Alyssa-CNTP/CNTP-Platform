-- ============================================================
-- CNTP Production Capture — Clean Schema
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================

-- ── Drop existing capture tables ─────────────────────────────
DROP TABLE IF EXISTS production.scan_events          CASCADE;
DROP TABLE IF EXISTS production.session_signatures   CASCADE;
DROP TABLE IF EXISTS production.prod_mass_balance    CASCADE;
DROP TABLE IF EXISTS production.prod_bagging         CASCADE;
DROP TABLE IF EXISTS production.prod_debagging       CASCADE;
DROP TABLE IF EXISTS production.bag_tags             CASCADE;
DROP TABLE IF EXISTS production.prod_sessions        CASCADE;

-- ── prod_sessions ─────────────────────────────────────────────
-- One row per shift per section.
-- Header fields autofill from operator assignment; operator only captures data rows.
CREATE TABLE production.prod_sessions (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id            text        NOT NULL
                          CHECK (section_id IN (
                            'sieving','refining1','refining2',
                            'granule','blender','pasteuriser'
                          )),
  date                  date        NOT NULL,
  shift                 text        NOT NULL
                          CHECK (shift IN ('morning','afternoon','night')),
  status                text        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','submitted','approved')),

  -- Header (autofilled from assignment)
  operator_names        text[],
  supervisor_name       text,
  lot_number            text,
  variant               text
                          CHECK (variant IN (
                            'Conventional','Organic',
                            'RA-Conventional','RA-Organic','FT-ORG'
                          )),
  production_orders     text[],

  -- Section-specific machine config stored as JSON
  -- Sieving: { sieve_config, screen_speed, top_indent, screen_angle }
  -- Pasteuriser: { production_type }
  -- Others: {}
  section_config        jsonb       NOT NULL DEFAULT '{}',

  -- Scale verification (stored per session, not blocking)
  scale_std_kg          numeric,
  scale_actual_kg       numeric,

  -- Operator sign-off
  op_signed             boolean     NOT NULL DEFAULT false,
  op_name_signoff       text,
  op_signed_at          timestamptz,

  -- Supervisor sign-off
  sup_signed            boolean     NOT NULL DEFAULT false,
  sup_name_signoff      text,
  sup_signed_at         timestamptz,

  comments              text,
  submitted_at          timestamptz,

  -- Scratch-pad for form state restoration (tablet draft resume).
  -- Structured rows in prod_debagging/prod_bagging are the source of truth.
  draft_data            jsonb       NOT NULL DEFAULT '{}',

  created_by            uuid        REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── bag_tags ──────────────────────────────────────────────────
-- Master registry of every bag in the system.
-- Created on bagging (output); consumed on debagging at the next station.
-- Phase 1: record created when operator saves output row, serial typed manually.
-- Phase 2: serial scanned in via barcode reader.
CREATE TABLE production.bag_tags (
  serial_number         text        PRIMARY KEY,
  product_type          text        NOT NULL,
  acumatica_id          text,
  variant               text
                          CHECK (variant IN (
                            'Conventional','Organic',
                            'RA-Conventional','RA-Organic','FT-ORG'
                          )),
  weight_kg             numeric     NOT NULL CHECK (weight_kg > 0),
  lot_number            text,

  -- Where this bag was created
  section_id            text        NOT NULL,
  session_id            uuid        REFERENCES production.prod_sessions(id),

  -- Lifecycle
  status                text        NOT NULL DEFAULT 'in_stock'
                          CHECK (status IN (
                            'in_stock','in_process','consumed',
                            'dispatched','on_hold','rejected'
                          )),
  location              text,
  location_updated_at   timestamptz,
  destination           text,

  -- QC
  qc_initials           text,
  qc_signed_at          timestamptz,
  printed_at            timestamptz,

  -- Consumption
  consumed              boolean     NOT NULL DEFAULT false,
  consumed_at           timestamptz,
  consumed_at_session   uuid        REFERENCES production.prod_sessions(id),
  consumed_at_section   text,
  consumed_weight_kg    numeric,

  created_by            uuid        REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ── prod_debagging ────────────────────────────────────────────
-- One row per input bag per session.
CREATE TABLE production.prod_debagging (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            uuid        NOT NULL
                          REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  bag_no                integer     NOT NULL,

  -- Serial links to bag_tags; NULL = legacy bag not yet in system (Phase 1 bootstrap)
  bag_serial_no         text        REFERENCES production.bag_tags(serial_number),
  lot_number            text,
  product_type          text,
  acumatica_id          text,
  variant               text
                          CHECK (variant IN (
                            'Conventional','Organic',
                            'RA-Conventional','RA-Organic','FT-ORG'
                          )),
  kg_gross              numeric,
  kg_nett               numeric     NOT NULL CHECK (kg_nett > 0),
  delivery_date         date,
  local_or_export       text
                          CHECK (local_or_export IN ('Export','Export Blend','Domestic/Local')),
  org_or_conv           text
                          CHECK (org_or_conv IN ('CON','ORG')),

  -- Sieving Tower: rows 1-2 are always bucket elevator / machine spillage
  -- These are excluded from total A in mass balance
  is_spillage           boolean     NOT NULL DEFAULT false,
  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ── prod_bagging ──────────────────────────────────────────────
-- One row per output bag per session.
CREATE TABLE production.prod_bagging (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            uuid        NOT NULL
                          REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  bag_no                integer     NOT NULL,

  -- output_group: Refining uses B/C/D for independent output streams.
  -- All other stations leave this NULL.
  output_group          text
                          CHECK (output_group IN ('B','C','D')),

  -- Serial created here; upserted to bag_tags on save
  bag_serial_no         text,
  lot_number            text,
  product_type          text,
  acumatica_id          text,
  variant               text
                          CHECK (variant IN (
                            'Conventional','Organic',
                            'RA-Conventional','RA-Organic','FT-ORG'
                          )),
  kg                    numeric     NOT NULL CHECK (kg > 0),
  bagging_time          time,

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ── prod_mass_balance ─────────────────────────────────────────
-- One row per session; upserted on every save.
-- balance_kg is a computed column — never set manually.
CREATE TABLE production.prod_mass_balance (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            uuid        NOT NULL UNIQUE
                          REFERENCES production.prod_sessions(id) ON DELETE CASCADE,

  total_input_kg        numeric     NOT NULL DEFAULT 0,  -- A (excl. spillage rows)
  total_output_b_kg     numeric     NOT NULL DEFAULT 0,  -- B
  total_output_c_kg     numeric     NOT NULL DEFAULT 0,  -- C
  total_output_d_kg     numeric     NOT NULL DEFAULT 0,  -- D

  -- Computed: A - B - C - D. Never insert/update this directly.
  balance_kg            numeric     GENERATED ALWAYS AS (
                          total_input_kg
                          - total_output_b_kg
                          - total_output_c_kg
                          - total_output_d_kg
                        ) STORED,

  tolerance_kg          numeric     NOT NULL DEFAULT 15,

  -- Granule-specific (C* reference = total from bagging summary, pulled automatically)
  water_kg              numeric     NOT NULL DEFAULT 0,
  dust_extraction_kg    numeric     NOT NULL DEFAULT 0,
  floor_waste_kg        numeric     NOT NULL DEFAULT 0,

  calculated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── session_signatures ────────────────────────────────────────
-- Persistent audit trail for every sign-off action.
-- One row per signature event (operator sign, supervisor sign, QC sign).
CREATE TABLE production.session_signatures (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            uuid        NOT NULL
                          REFERENCES production.prod_sessions(id) ON DELETE CASCADE,
  signer_role           text        NOT NULL
                          CHECK (signer_role IN ('operator','supervisor','qc')),
  signer_name           text        NOT NULL,
  signer_user_id        uuid        REFERENCES auth.users(id),
  signature_b64         text        NOT NULL,  -- base64 PNG from canvas
  signed_at             timestamptz NOT NULL DEFAULT now()
);

-- ── scan_events ───────────────────────────────────────────────
-- Audit trail for every bag scan. Table is ready now; Phase 2 activates scanning.
CREATE TABLE production.scan_events (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  serial_number         text        NOT NULL
                          REFERENCES production.bag_tags(serial_number) ON DELETE CASCADE,
  action                text        NOT NULL
                          CHECK (action IN (
                            'debagging_in','bagging_out',
                            'stock_count','dispatch','reprint'
                          )),
  section_id            text,
  session_id            uuid        REFERENCES production.prod_sessions(id),
  operator_id           uuid        REFERENCES auth.users(id),
  weight_kg             numeric,
  notes                 text,
  scanned_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX prod_sessions_section_date_idx  ON production.prod_sessions(section_id, date);
CREATE INDEX prod_sessions_status_idx        ON production.prod_sessions(status);
CREATE INDEX prod_sessions_date_idx          ON production.prod_sessions(date DESC);

CREATE INDEX prod_debagging_session_idx      ON production.prod_debagging(session_id);
CREATE INDEX prod_debagging_serial_idx       ON production.prod_debagging(bag_serial_no)
  WHERE bag_serial_no IS NOT NULL;

CREATE INDEX prod_bagging_session_idx        ON production.prod_bagging(session_id);
CREATE INDEX prod_bagging_serial_idx         ON production.prod_bagging(bag_serial_no)
  WHERE bag_serial_no IS NOT NULL;

CREATE INDEX bag_tags_status_idx             ON production.bag_tags(status);
CREATE INDEX bag_tags_section_idx            ON production.bag_tags(section_id);
CREATE INDEX bag_tags_acumatica_idx          ON production.bag_tags(acumatica_id);
CREATE INDEX bag_tags_session_idx            ON production.bag_tags(session_id);
CREATE INDEX bag_tags_consumed_idx           ON production.bag_tags(consumed)
  WHERE consumed = false;

CREATE INDEX scan_events_serial_idx          ON production.scan_events(serial_number);
CREATE INDEX scan_events_session_idx         ON production.scan_events(session_id);

CREATE INDEX session_sigs_session_idx        ON production.session_signatures(session_id);

-- ── updated_at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION production.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER prod_sessions_updated_at
  BEFORE UPDATE ON production.prod_sessions
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE production.prod_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.prod_debagging       ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.prod_bagging         ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.prod_mass_balance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.bag_tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.scan_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE production.session_signatures   ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read and write production capture tables.
-- More granular role-based policies can be layered on top later.
CREATE POLICY "authenticated_all_prod_sessions"
  ON production.prod_sessions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all_prod_debagging"
  ON production.prod_debagging FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all_prod_bagging"
  ON production.prod_bagging FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all_prod_mass_balance"
  ON production.prod_mass_balance FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all_bag_tags"
  ON production.bag_tags FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all_scan_events"
  ON production.scan_events FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all_session_signatures"
  ON production.session_signatures FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

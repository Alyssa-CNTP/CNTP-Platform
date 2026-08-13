-- ============================================================
-- CNTP Note Books — Goods Received Notes (GRN) + Delivery Notes (DN)
-- Run in: Supabase SQL Editor — STAGING ONLY for now (qjqkpockmujecjgmdple)
-- Depends on: 20260729_008_esign_schema.sql (signatures are captured there)
-- ============================================================
--
-- The digital version of the physical GRN/DN books that sit at each site. A
-- book is identified by its site prefix and its type, and every note carries a
-- number that runs chronologically inside that book:
--
--   Blackheath                 BH-GRN-0000001 .. BH-GRN-9999999   (and BH-DN-…)
--   Graafwater Depot           GD-GRN-0000001 .. GD-GRN-9999999   (and GD-DN-…)
--   Graafwater Teeverwerkers   GT-GRN-0000001 .. GT-GRN-9999999   (and GT-DN-…)
--   Vanrhynsdorp Depot         VD-GRN-0000001 .. VD-GRN-9999999   (and VD-DN-…)
--   Vanrhynsdorp Teeverwerkers VT-GRN-0000001 .. VT-GRN-9999999   (and VT-DN-…)
--
-- NOTE ON THE VD/VT PREFIX: the spec listed BOTH Vanrhynsdorp sites as "VD".
-- Two books cannot share a prefix — VD-GRN-0000001 would then be ambiguous
-- between the depot and the teeverwerkers, which defeats the whole point of the
-- number. Vanrhynsdorp Teeverwerkers is therefore seeded as "VT", mirroring the
-- Graafwater pair (GD depot / GT teeverwerkers). Prefixes live in a table, not
-- in code, so this is one UPDATE to change — but change it BEFORE any VT note
-- is written, since issued numbers are immutable.
--
-- WHY public.* VIEWS OVER notebooks.* TABLES:
-- The app reaches Postgres through PostgREST, which only serves schemas listed
-- in the project's "Exposed schemas" setting — a dashboard change nobody can
-- make from a deploy. So the tables live in their own `notebooks` schema (the
-- real source of truth, RLS on) and the API layer talks to thin, auto-updatable
-- `public.notebook_*` views with security_invoker = true, so RLS on the base
-- table still decides what a caller sees. Nothing needs to be exposed by hand.
--
-- Numbering is allocated at CREATE time (the note gets its number the moment
-- the book page is opened, exactly like tearing off the next paper leaf), via
-- an atomic upsert on notebooks.counters. A voided note keeps its number — the
-- gap IS the audit trail, same as a crossed-out page in the physical book.
--
-- Signatures are NOT stored here. A note's "Received by" and "Transporter"
-- blocks are esign subjects (subject_type = 'notebook_document', subject_id =
-- '<uuid>:received' / '<uuid>:transporter'), so the immutability + audit trail
-- already built in 20260729_008 applies unchanged.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS notebooks;

-- ── Sites (one book pair — GRN + DN — per site) ──────────────────────────────
CREATE TABLE IF NOT EXISTS notebooks.locations (
  code        text PRIMARY KEY,                       -- 'BH','GD','GT','VD','VT' — the number prefix
  name        text NOT NULL,
  short_name  text,
  address     text,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO notebooks.locations (code, name, short_name, sort_order) VALUES
  ('BH', 'Blackheath',                 'Blackheath',        10),
  ('GD', 'Graafwater Depot',           'GFW Depot',         20),
  ('GT', 'Graafwater Teeverwerkers',   'GFW Teeverwerkers', 30),
  ('VD', 'Vanrhynsdorp Depot',         'VRD Depot',         40),
  ('VT', 'Vanrhynsdorp Teeverwerkers', 'VRD Teeverwerkers', 50)
ON CONFLICT (code) DO NOTHING;

-- ── One counter per (site, doc type) — the book's page number ────────────────
CREATE TABLE IF NOT EXISTS notebooks.counters (
  location_code text NOT NULL REFERENCES notebooks.locations(code),
  doc_type      text NOT NULL CHECK (doc_type IN ('GRN','DN')),
  last_seq      integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0 AND last_seq <= 9999999),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_code, doc_type)
);

-- ── The note itself ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notebooks.documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no             text NOT NULL UNIQUE,            -- 'BH-GRN-0000001'
  doc_type           text NOT NULL CHECK (doc_type IN ('GRN','DN')),
  location_code      text NOT NULL REFERENCES notebooks.locations(code),
  seq                integer NOT NULL CHECK (seq >= 1 AND seq <= 9999999),
  doc_date           date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Johannesburg')::date,

  -- Header block. On a GRN party_name is the SUPPLIER; on a DN it is who the
  -- goods are being DELIVERED TO. One column, because it is the same line on
  -- the same page of the same book — the label flips with doc_type.
  party_name          text,
  party_address       text,
  delivered_at_store  text,                           -- "NAME OF STORE GOODS DELIVERED AT" (e.g. 'CNTP GFW')
  purchase_order_no   text,                           -- "OUR PURCHASE ORDER NO." (e.g. 'GS-0397')
  weighbridge_no      text,                           -- links to the weighbridge slip (e.g. '103117')

  -- Traceability. Free text for now: lots/batches arrive from Acumatica and
  -- from the producer's own numbering, and a hard FK would block capture at
  -- the gate when the code is not in the system yet. Header-level values are
  -- the default for every line; a line may override them.
  lot_no             text,
  batch_no           text,
  producer_lot_no    text,
  season_year        integer,
  farmer_name        text,

  -- Transport
  vehicle_reg          text,
  transporter_company  text,
  driver_name          text,

  -- Certification stamp — the ticked box on the paper note. Discrete columns
  -- (not jsonb) so "every organic note received at GFW this season" is a plain
  -- indexed query, which is the whole reason the stamp gets captured at all.
  cert_organic_nop         boolean NOT NULL DEFAULT false,
  cert_organic_jas         boolean NOT NULL DEFAULT false,
  cert_organic_eu          boolean NOT NULL DEFAULT false,
  cert_rainforest_alliance boolean NOT NULL DEFAULT false,
  cert_fairtrade           boolean NOT NULL DEFAULT false,
  cert_control_union_no    text,                      -- e.g. 'CU 89240B'
  cert_eu_org_code         text,                      -- e.g. 'ZA-BIO-149'

  -- The two acknowledgement blocks. The typed names are what gets printed on
  -- an unsigned copy; the binding signature lives in esign.signatures.
  received_by_name     text,
  received_at          timestamptz,
  transporter_name     text,
  transporter_at       timestamptz,

  notes              text,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','issued','void')),
  issued_at          timestamptz,
  issued_by          uuid,
  voided_at          timestamptz,
  voided_by          uuid,
  void_reason        text,
  created_by         uuid,
  created_by_name    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (location_code, doc_type, seq)
);

CREATE INDEX IF NOT EXISTS documents_book_idx    ON notebooks.documents (location_code, doc_type, seq DESC);
CREATE INDEX IF NOT EXISTS documents_date_idx    ON notebooks.documents (doc_date DESC);
CREATE INDEX IF NOT EXISTS documents_status_idx  ON notebooks.documents (status);
CREATE INDEX IF NOT EXISTS documents_wb_idx      ON notebooks.documents (weighbridge_no) WHERE weighbridge_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_po_idx      ON notebooks.documents (purchase_order_no) WHERE purchase_order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_lot_idx     ON notebooks.documents (lot_no) WHERE lot_no IS NOT NULL;

-- ── QTY / WEIGHT / DESCRIPTION — the ruled table in the middle of the page ──
CREATE TABLE IF NOT EXISTS notebooks.document_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES notebooks.documents(id) ON DELETE CASCADE,
  line_no      integer NOT NULL CHECK (line_no >= 1),
  qty          numeric(12,2),                         -- number of bags/units
  weight_kg    numeric(12,2),                         -- total kg for the line
  description  text,                                  -- 'Conv. bulk bags' / 'Org. bulk bags'
  variant      text,                                  -- 'Conventional' | 'Organic' | …
  lot_no       text,                                  -- overrides the header lot when set
  batch_no     text,
  farmer_name  text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, line_no)
);

CREATE INDEX IF NOT EXISTS document_lines_doc_idx   ON notebooks.document_lines (document_id, line_no);
CREATE INDEX IF NOT EXISTS document_lines_lot_idx   ON notebooks.document_lines (lot_no)   WHERE lot_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_lines_batch_idx ON notebooks.document_lines (batch_no) WHERE batch_no IS NOT NULL;

-- ── updated_at ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notebooks.set_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = notebooks, pg_catalog AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS documents_updated_at ON notebooks.documents;
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON notebooks.documents
  FOR EACH ROW EXECUTE FUNCTION notebooks.set_updated_at();

-- ── An issued number is permanent ────────────────────────────────────────────
-- Re-pointing a note at a different book (or renumbering it inside one) would
-- silently break the chronology the book exists to prove. Correcting a note is
-- a void plus a new note, never an edit of its identity.
CREATE OR REPLACE FUNCTION notebooks.protect_doc_identity()
RETURNS trigger LANGUAGE plpgsql
SET search_path = notebooks, pg_catalog AS $$
BEGIN
  IF NEW.doc_no        IS DISTINCT FROM OLD.doc_no
  OR NEW.doc_type      IS DISTINCT FROM OLD.doc_type
  OR NEW.location_code IS DISTINCT FROM OLD.location_code
  OR NEW.seq           IS DISTINCT FROM OLD.seq THEN
    RAISE EXCEPTION 'The number on note % cannot be changed — void it and create a new note instead', OLD.doc_no;
  END IF;

  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'Note % is voided and cannot be reopened', OLD.doc_no;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_identity_guard ON notebooks.documents;
CREATE TRIGGER documents_identity_guard
  BEFORE UPDATE ON notebooks.documents
  FOR EACH ROW EXECUTE FUNCTION notebooks.protect_doc_identity();

-- ── Next number in a book ────────────────────────────────────────────────────
-- Atomic: the INSERT … ON CONFLICT DO UPDATE takes a row lock on the counter,
-- so two people opening a page at the same moment can never land on the same
-- number. Format is <PREFIX>-<GRN|DN>-<7 digits>.
CREATE OR REPLACE FUNCTION notebooks.next_doc_no(p_location_code text, p_doc_type text)
RETURNS TABLE (doc_no text, seq integer)
LANGUAGE plpgsql
SET search_path = notebooks, pg_catalog
AS $$
DECLARE
  v_seq integer;
BEGIN
  IF p_doc_type NOT IN ('GRN','DN') THEN
    RAISE EXCEPTION 'doc_type must be GRN or DN, got %', p_doc_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM notebooks.locations l WHERE l.code = p_location_code AND l.active) THEN
    RAISE EXCEPTION 'Unknown or inactive location %', p_location_code;
  END IF;

  INSERT INTO notebooks.counters AS c (location_code, doc_type, last_seq)
  VALUES (p_location_code, p_doc_type, 1)
  ON CONFLICT (location_code, doc_type)
  DO UPDATE SET last_seq = c.last_seq + 1, updated_at = now()
  RETURNING c.last_seq INTO v_seq;

  IF v_seq > 9999999 THEN
    RAISE EXCEPTION 'Book %-% is full (9999999 notes)', p_location_code, p_doc_type;
  END IF;

  RETURN QUERY SELECT p_location_code || '-' || p_doc_type || '-' || lpad(v_seq::text, 7, '0'), v_seq;
END;
$$;

-- ── PostgREST surface (see header) ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.notebook_locations
  WITH (security_invoker = true) AS
  SELECT code, name, short_name, address, sort_order, active, created_at
  FROM notebooks.locations;

CREATE OR REPLACE VIEW public.notebook_documents
  WITH (security_invoker = true) AS
  SELECT * FROM notebooks.documents;

CREATE OR REPLACE VIEW public.notebook_document_lines
  WITH (security_invoker = true) AS
  SELECT * FROM notebooks.document_lines;

-- Numbering wrapper. SECURITY DEFINER because the counter table is deliberately
-- not reachable any other way — a number may only ever be taken through here.
CREATE OR REPLACE FUNCTION public.notebook_next_doc_no(p_location_code text, p_doc_type text)
RETURNS TABLE (doc_no text, seq integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = notebooks, public
AS $$
  SELECT * FROM notebooks.next_doc_no(p_location_code, p_doc_type);
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Reads are open to any signed-in user (a GRN is an operational record the
-- whole site works off). Writes only ever happen server-side through the
-- service-role client in app/api/notebooks/*, which is where the permission
-- checks live — same split as esign.
ALTER TABLE notebooks.locations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebooks.counters       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebooks.documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebooks.document_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_locations" ON notebooks.locations;
CREATE POLICY "authenticated_read_locations"
  ON notebooks.locations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_documents" ON notebooks.documents;
CREATE POLICY "authenticated_read_documents"
  ON notebooks.documents FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_document_lines" ON notebooks.document_lines;
CREATE POLICY "authenticated_read_document_lines"
  ON notebooks.document_lines FOR SELECT TO authenticated USING (true);
-- notebooks.counters gets no policy at all: nothing but next_doc_no() may read
-- or move it, and that runs SECURITY DEFINER.

GRANT USAGE ON SCHEMA notebooks TO authenticated, service_role;
GRANT SELECT ON notebooks.locations, notebooks.documents, notebooks.document_lines TO authenticated;
GRANT ALL    ON notebooks.locations, notebooks.counters, notebooks.documents, notebooks.document_lines TO service_role;

GRANT SELECT ON public.notebook_locations, public.notebook_documents, public.notebook_document_lines TO authenticated;
GRANT ALL    ON public.notebook_locations, public.notebook_documents, public.notebook_document_lines TO service_role;

REVOKE ALL ON FUNCTION public.notebook_next_doc_no(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notebook_next_doc_no(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

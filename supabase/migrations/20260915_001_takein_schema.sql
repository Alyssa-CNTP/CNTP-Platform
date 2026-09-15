-- supabase/migrations/20260915_001_takein_schema.sql
--
-- RAW MATERIAL TAKE-IN — the farmer intake chain.
--
--   booking → batch → GRN → mini lab → Afleweringsbewys → Blackheath
--           → external lab → COA → settlement
--
-- WHAT THIS DOES NOT DO, deliberately:
--
--   * It does not create a second leaf-shade store. The classifier and its
--     records already live in qms.quality_records (workflow='leaf_shade') and
--     the take-in mini lab reads and writes THAT table, filtered by depot.
--     Blackheath's own leaf shade stays where it is, on Quality → Raw Material.
--
--   * It does not touch logistics.grns / grn_lines / units. Those belong to the
--     supplier-GRN + dispatch module. A farmer take-in GRN is a different
--     document with a different lifecycle, so it lives in its own table rather
--     than overloading one that already means something else.
--
--   * It does not invent a warehouse registry of its own. logistics.warehouses
--     is created here BECAUSE IT DOES NOT EXIST YET on staging (the schema is
--     empty and the logistics pages are commented out of the sidebar), and it
--     is created in the shape those pages already query so they start working
--     rather than conflicting. Take-in references it. When take-in later folds
--     into warehousing there is one depot registry, not two.

create schema if not exists takein;
grant usage on schema takein   to authenticated, service_role;
grant usage on schema logistics to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · DEPOTS — the shared warehouse registry
-- ════════════════════════════════════════════════════════════════════════════
-- Shape matches what app/(app)/logistics/warehouse + receiving already select.
create table if not exists logistics.warehouses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  type        text not null default 'raw' check (type in ('raw','finished','export','mixed')),
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists logistics.locations (
  id             uuid primary key default gen_random_uuid(),
  warehouse_id   uuid not null references logistics.warehouses(id) on delete cascade,
  code           text not null,
  aisle          text, bay text, level text,
  location_type  text not null default 'raw_storage',
  capacity_units integer,
  barcode        text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (warehouse_id, code)
);

-- ── batch numbering lives with the depot, because it IS a property of the depot
-- Graafwater mints GS-####, Vanrhynsdorp MAT-####. At cut-over these are set to
-- the last number written in the book, and the sequence continues from there.
alter table logistics.warehouses
  add column if not exists takes_farmer_delivery boolean not null default false,
  add column if not exists batch_prefix          text,
  add column if not exists batch_seq             integer not null default 0,
  add column if not exists grn_prefix            text,
  add column if not exists grn_seq               integer not null default 0,
  add column if not exists doc_prefix            text,
  add column if not exists doc_seq               integer not null default 0;

comment on column logistics.warehouses.batch_seq is
  'Last batch number ISSUED at this depot. Set to the last number in the paper '
  'book at cut-over; takein.next_batch_no() continues from here. Never computed '
  'from max(batch_no) in app code — see ARCHITECTURE.md §5.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · PRODUCERS & CONTRACTS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists takein.producers (
  id             uuid primary key default gen_random_uuid(),
  acumatica_code text not null unique,            -- V-AGG001
  name           text not null,
  contact_name   text, email text, phone text,
  address        text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists takein.contracts (
  id            uuid primary key default gen_random_uuid(),
  contract_no   text not null unique,             -- K26-001
  producer_id   uuid not null references takein.producers(id),
  season        integer not null,                 -- the contract IS the season
  variant       text   not null,                  -- Conventional / RA / Organic / …
  contracted_kg numeric(12,2) not null default 0,
  status        text not null default 'draft'
                check (status in ('draft','awaiting_release','released','closed')),
  approved_kg_by   uuid, approved_kg_at   timestamptz,
  released_by      uuid, released_at      timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid
);
create index if not exists contracts_producer_idx on takein.contracts(producer_id);
create index if not exists contracts_season_idx   on takein.contracts(season);

-- ── PRICING LIVES IN ITS OWN TABLE ──────────────────────────────────────────
-- Supabase RLS is row-level, not column-level: a policy cannot hide the price
-- column from a SELECT * on takein.contracts. Splitting the table is the only
-- way the contract list can be readable by a depot clerk while the rand values
-- are not. The clerk's query never names this table.
create table if not exists takein.contract_pricing (
  contract_id      uuid primary key references takein.contracts(id) on delete cascade,
  guaranteed_cents integer not null default 0,    -- money as integer cents
  first_pay_cents  integer not null default 0,
  set_by           uuid,
  set_at           timestamptz not null default now()
);

-- ── which findings a panel decision BINDS the producer to ───────────────────
-- A panel sitting on a batch is an in-house quality review. It reaches the
-- producer only where the contract makes that finding a "Verpligte Paneel
-- Besluit". Per contract, because it is negotiated per contract.
create table if not exists takein.contract_panel_terms (
  contract_id uuid not null references takein.contracts(id) on delete cascade,
  term_key    text not null,                      -- density | sensory | organic_residue | pa4 | organic_pa23 | lab_variance
  binding     boolean not null default true,
  clause_ref  text,
  primary key (contract_id, term_key)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · THE DELIVERY CALENDAR
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists takein.bookings (
  id            uuid primary key default gen_random_uuid(),
  warehouse_id  uuid not null references logistics.warehouses(id),
  contract_id   uuid references takein.contracts(id),
  booked_date   date not null,
  start_hour    smallint not null check (start_hour between 0 and 23),
  hours         smallint not null default 1 check (hours between 1 and 4),
  bags          integer not null default 0,
  expected_kg   numeric(12,2),
  land_name     text,
  note          text,
  kind          text not null default 'farmer' check (kind in ('farmer','shipping')),
  status        text not null default 'booked'   check (status in ('booked','cancelled','arrived')),
  alert         boolean not null default false,  -- over the manager-alert bag count
  override_reason text,                           -- booked through a rule
  batch_id      uuid,                             -- set when the load arrives
  created_by    uuid, created_at timestamptz not null default now()
);
create index if not exists bookings_week_idx on takein.bookings(warehouse_id, booked_date);

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · THE DELIVERY
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists takein.batches (
  id             uuid primary key default gen_random_uuid(),
  batch_no       text not null unique,            -- GS-0297 / MAT-0341
  warehouse_id   uuid not null references logistics.warehouses(id),
  contract_id    uuid not null references takein.contracts(id),
  booking_id     uuid references takein.bookings(id),
  delivered_on   date not null default current_date,

  -- weighbridge. The truck arrives LOADED, so begin is always the higher one.
  begin_kg       numeric(10,2),
  end_kg         numeric(10,2),
  bags           integer not null default 0,
  weighbridge_no text,
  driver         text, vehicle text,

  producer_lot   text,
  tea_court      text,
  harvest_year   integer,

  checks_json    jsonb not null default '[]'::jsonb,   -- QC receiving inspection
  check_notes    jsonb not null default '[]'::jsonb,
  qc_comment     text,

  returned_at     timestamptz, returned_by uuid,
  returned_stage  text, returned_category text, returned_reason text,

  panel_outcome  text check (panel_outcome in ('accept','downgrade','reject')),
  panel_grade    text, panel_reason text, panel_binding boolean,
  panel_covered  jsonb, panel_by uuid, panel_at timestamptz,

  ceiling_override_reason text, ceiling_override_by uuid, ceiling_override_at timestamptz,

  created_at     timestamptz not null default now(),
  created_by     uuid,

  constraint weighbridge_direction check (
    begin_kg is null or end_kg is null or begin_kg > end_kg)
);
create index if not exists batches_contract_idx  on takein.batches(contract_id);
create index if not exists batches_warehouse_idx on takein.batches(warehouse_id, delivered_on desc);

-- A load can come off several lands, and the same name can legitimately repeat
-- (GS-0300 arrived off four). Ordinal is the order the document prints them in.
create table if not exists takein.batch_lands (
  batch_id uuid not null references takein.batches(id) on delete cascade,
  ordinal  smallint not null,
  name     text not null,
  primary key (batch_id, ordinal)
);

-- …and every bag is tagged to one. This is what turns "Hetley,Joepie" into
-- "Hetley 5 bags, Joepie 3".
create table if not exists takein.batch_bags (
  batch_id     uuid not null references takein.batches(id) on delete cascade,
  bag_no       smallint not null,
  land_ordinal smallint,
  primary key (batch_id, bag_no)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · DOCUMENTS
-- ════════════════════════════════════════════════════════════════════════════
-- GRN, Afleweringsbewys and COA share one table because they share one
-- lifecycle: issued → maybe signed → maybe voided. A voided number is NEVER
-- reissued, which is why a void sets columns on the row instead of deleting it.
do $$ begin
  create type takein.doc_kind as enum ('grn','afleweringsbewys','coa');
exception when duplicate_object then null; end $$;

create table if not exists takein.documents (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references takein.batches(id) on delete cascade,
  kind          takein.doc_kind not null,
  doc_no        text not null,
  issued_at     timestamptz not null default now(),
  issued_by     uuid,
  issued_by_name text,

  -- GRN only: the deliverer signs on the platform before leaving
  signed_by     text, signed_at timestamptz,
  transporter   text, delivery_note_no text,

  -- Afleweringsbewys only: payment is built from this snapshot, not from the
  -- live batch, so a later correction cannot silently move what was paid.
  frozen        jsonb,

  voided_at     timestamptz, voided_by uuid, voided_by_name text,
  void_category text, void_reason text,

  unique (kind, doc_no)                            -- burnt, voided or not
);

-- at most one LIVE document of each kind per batch; voided ones accumulate
create unique index if not exists takein_one_live_doc
  on takein.documents (batch_id, kind) where voided_at is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · LAB RESULTS
-- ════════════════════════════════════════════════════════════════════════════
-- The leaf-shade PHOTO and its ML prediction stay in qms.quality_records —
-- this row carries the numbers the grading engine reads.
create table if not exists takein.lab_results (
  batch_id      uuid not null references takein.batches(id) on delete cascade,
  source        text not null check (source in ('mini','internal','external')),

  sieve_json    jsonb,                             -- grams per fraction, 400 g sample
  moisture      numeric(5,2),
  density       numeric(6,2),
  shade         smallint,                          -- 1–11 as read
  aroma         smallint, colour smallint, taste smallint,

  residue_name  text, residue_level numeric(10,4), residue_group text,
  pa_level      numeric(10,4), pa_group text,

  agrees        boolean,                           -- internal vs mini
  variance_note text, dispute_note text,

  -- the qms.quality_records row holding the classifier photo, if there is one
  quality_record_id integer,

  captured_by   uuid, captured_by_name text,
  captured_at   timestamptz not null default now(),
  primary key (batch_id, source)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7 · THE AUDIT TRAIL — append only
-- ════════════════════════════════════════════════════════════════════════════
-- An audit log anyone can edit is worse than none, because it looks
-- authoritative. UPDATE and DELETE are revoked, not merely discouraged.
create table if not exists takein.batch_events (
  id         bigserial primary key,
  batch_id   uuid not null references takein.batches(id) on delete cascade,
  at         timestamptz not null default now(),
  actor_id   uuid,
  actor_name text not null,                        -- denormalised: people leave
  action     text not null,                        -- grn_issued, grn_voided, …
  detail     text not null,
  payload    jsonb
);
create index if not exists batch_events_batch_idx on takein.batch_events(batch_id, at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 8 · NUMBER ALLOCATION — in the database, never in app code
-- ════════════════════════════════════════════════════════════════════════════
-- app-side max+1 is the documented cause of 44 % of Fine/Coarse Leaf bags lost
-- from prod_bagging (ARCHITECTURE.md §5). Two clerks opening a delivery in the
-- same second must not both mint GS-0297.

-- A returned load never becomes stock, so its number goes back in the pool and
-- is reissued before any new one — the sequence on the shelf stays unbroken.
create table if not exists takein.released_batch_nos (
  warehouse_id uuid not null references logistics.warehouses(id),
  seq          integer not null,
  released_at  timestamptz not null default now(),
  primary key (warehouse_id, seq)
);

create or replace function takein.next_batch_no(p_warehouse uuid)
returns text language plpgsql security definer set search_path = takein, logistics, pg_temp as $$
declare v_prefix text; v_seq integer;
begin
  select batch_prefix into v_prefix from logistics.warehouses where id = p_warehouse for update;
  if v_prefix is null then raise exception 'Depot % has no batch_prefix set', p_warehouse; end if;

  -- reissue a released number first
  delete from takein.released_batch_nos
   where warehouse_id = p_warehouse
     and seq = (select min(seq) from takein.released_batch_nos where warehouse_id = p_warehouse)
  returning seq into v_seq;

  if v_seq is null then
    update logistics.warehouses set batch_seq = batch_seq + 1
     where id = p_warehouse returning batch_seq into v_seq;
  end if;

  return v_prefix || lpad(v_seq::text, 4, '0');
end $$;

create or replace function takein.release_batch_no(p_warehouse uuid, p_batch_no text)
returns void language plpgsql security definer set search_path = takein, logistics, pg_temp as $$
declare v_seq integer; v_last integer;
begin
  v_seq := (regexp_replace(p_batch_no, '^.*?(\d+)$', '\1'))::integer;
  select batch_seq into v_last from logistics.warehouses where id = p_warehouse for update;
  if v_seq = v_last then
    update logistics.warehouses set batch_seq = batch_seq - 1 where id = p_warehouse;
  else
    insert into takein.released_batch_nos(warehouse_id, seq) values (p_warehouse, v_seq)
      on conflict do nothing;
  end if;
end $$;

-- GRN and Ontvangsnota numbers are NEVER recycled — they have been printed and
-- signed, and a second document carrying one could not be told from the first.
create or replace function takein.next_doc_no(p_warehouse uuid, p_kind text)
returns text language plpgsql security definer set search_path = takein, logistics, pg_temp as $$
declare v_prefix text; v_seq integer;
begin
  if p_kind = 'grn' then
    update logistics.warehouses set grn_seq = grn_seq + 1
     where id = p_warehouse returning grn_prefix, grn_seq into v_prefix, v_seq;
    return v_prefix || v_seq::text;
  else
    update logistics.warehouses set doc_seq = doc_seq + 1
     where id = p_warehouse returning doc_prefix, doc_seq into v_prefix, v_seq;
    return v_prefix || lpad(v_seq::text, 7, '0');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9 · SEARCH — one index over every number anyone might be holding
-- ════════════════════════════════════════════════════════════════════════════
-- ~500 deliveries a season. "What happened to GRN-GS-4531?" is asked about a
-- VOIDED document as often as a live one, so voided rows are in here too.
create or replace view takein.v_batch_search as
select b.id, b.batch_no, b.warehouse_id, b.delivered_on, b.contract_id,
       concat_ws(' ',
         b.batch_no, b.weighbridge_no, b.producer_lot, b.tea_court, b.driver, b.vehicle,
         p.name, p.acumatica_code, c.contract_no,
         (select string_agg(l.name, ' ' order by l.ordinal) from takein.batch_lands l where l.batch_id = b.id),
         (select string_agg(d.doc_no, ' ')                  from takein.documents  d where d.batch_id = b.id)
       ) as haystack
from takein.batches b
  join takein.contracts c on c.id = b.contract_id
  join takein.producers p on p.id = c.producer_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 10 · ACCESS
-- ════════════════════════════════════════════════════════════════════════════
-- Depot scoping: the people at a location get that location. Blackheath holds
-- every depot — farmers do not deliver there, it is the consolidation view.
-- Depot scoping goes on shared.app_roles, NOT public.users. app_roles is what
-- lib/auth/context.tsx actually resolves a signed-in user through (user_id,
-- permissions jsonb, is_active); public.users is a legacy shell with no rows,
-- so anything keyed on it denies everyone.
alter table shared.app_roles add column if not exists depot_codes text[] not null default '{}';
comment on column shared.app_roles.depot_codes is
  'Take-in depot codes this user may see. EMPTY = every depot — the safe default '
  'for Blackheath and Management, who need the consolidated view. A depot clerk '
  'is scoped when their account is made, on Users & Access.';

alter table logistics.warehouses   enable row level security;
alter table logistics.locations    enable row level security;
alter table takein.producers       enable row level security;
alter table takein.contracts       enable row level security;
alter table takein.contract_pricing        enable row level security;
alter table takein.contract_panel_terms    enable row level security;
alter table takein.bookings        enable row level security;
alter table takein.batches         enable row level security;
alter table takein.batch_lands     enable row level security;
alter table takein.batch_bags      enable row level security;
alter table takein.documents       enable row level security;
alter table takein.lab_results     enable row level security;
alter table takein.batch_events    enable row level security;
alter table takein.released_batch_nos      enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'logistics.warehouses','logistics.locations','takein.producers','takein.contracts',
    'takein.contract_panel_terms','takein.bookings','takein.batches','takein.batch_lands',
    'takein.batch_bags','takein.documents','takein.lab_results','takein.released_batch_nos'
  ] loop
    execute format('drop policy if exists takein_rw on %s', t);
    execute format('create policy takein_rw on %s for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %s to authenticated', t);
  end loop;
end $$;

-- ── the audit trail is append-only, enforced ────────────────────────────────
drop policy if exists batch_events_read   on takein.batch_events;
drop policy if exists batch_events_append on takein.batch_events;
create policy batch_events_read   on takein.batch_events for select to authenticated using (true);
create policy batch_events_append on takein.batch_events for insert to authenticated with check (true);
grant select, insert on takein.batch_events to authenticated;
revoke update, delete on takein.batch_events from authenticated;
grant usage, select on sequence takein.batch_events_id_seq to authenticated;

-- ── contract pricing: the row is only visible to the key holder ─────────────
-- This is the one place RLS does real work rather than deferring to the app.
--
-- It reads the STORED override jsonb and nothing else. The app resolves a
-- permission as override -> role default -> module grant (resolvePermission in
-- lib/auth/permissions.ts), but role defaults live in TypeScript and mirroring
-- them into SQL would be a second source of truth for who may see money. So the
-- rule here is deliberately stricter than the app's: pricing has to be ticked
-- against a person by name, and a role default alone does not open it.
--
-- The consequence is a user the APP allows and the DATABASE refuses. That is
-- intended, but it must never be silent: app/(app)/take-in/contracts/page.tsx
-- detects exactly this case and says so on screen rather than rendering an
-- empty pricing panel. Change one and change the other.
drop policy if exists contract_pricing_read  on takein.contract_pricing;
drop policy if exists contract_pricing_write on takein.contract_pricing;
create policy contract_pricing_read on takein.contract_pricing for select to authenticated
  using (exists (select 1 from shared.app_roles r
                  where r.user_id = auth.uid()
                    and coalesce(r.is_active, true)
                    and coalesce((r.permissions->>'can_view_contract_pricing')::boolean, false)));
create policy contract_pricing_write on takein.contract_pricing for all to authenticated
  using (exists (select 1 from shared.app_roles r
                  where r.user_id = auth.uid()
                    and coalesce(r.is_active, true)
                    and coalesce((r.permissions->>'can_set_contract_pricing')::boolean, false)))
  with check (exists (select 1 from shared.app_roles r
                  where r.user_id = auth.uid()
                    and coalesce(r.is_active, true)
                    and coalesce((r.permissions->>'can_set_contract_pricing')::boolean, false)));
grant select, insert, update, delete on takein.contract_pricing to authenticated;

grant select on takein.v_batch_search to authenticated;
grant execute on function takein.next_batch_no(uuid)          to authenticated;
grant execute on function takein.release_batch_no(uuid, text) to authenticated;
grant execute on function takein.next_doc_no(uuid, text)      to authenticated;
grant all on all tables    in schema takein to service_role;
grant all on all sequences in schema takein to service_role;
grant all on all tables    in schema logistics to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 11 · THE FIVE DEPOTS
-- ════════════════════════════════════════════════════════════════════════════
-- Three are known from the delivery notes. The other two are seeded inactive
-- with no prefix so nobody can take a delivery against a depot whose numbering
-- has not been agreed — they are named and switched on from Setup.
insert into logistics.warehouses (code, name, type, address, takes_farmer_delivery,
                                  batch_prefix, batch_seq, grn_prefix, grn_seq, doc_prefix, doc_seq, active)
values
  ('GS',  'Graafwater Depot',   'raw', 'Erf 1324 | Graafwater | 8120',            true,  'GS-',  0, 'GRN-GS-',  0, 'GD-FD', 0, true),
  ('MAT', 'Vanrhynsdorp Depot', 'raw', '121 Rivierkant Street | Vanrhynsdorp | 8170', true, 'MAT-', 0, 'GRN-MAT-', 0, 'VD-FD', 0, true),
  ('BH',  'Blackheath',         'mixed','27 Range Road | Blackheath | 7580',       false, null,   0, null,       0, null,    0, true),
  ('D4',  'Depot 4 — to be named','raw', null,                                     false, null,   0, null,       0, null,    0, false),
  ('D5',  'Depot 5 — to be named','raw', null,                                     false, null,   0, null,       0, null,    0, false)
on conflict (code) do nothing;

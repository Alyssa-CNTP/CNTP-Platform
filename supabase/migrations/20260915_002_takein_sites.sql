-- supabase/migrations/20260915_002_takein_sites.sql
--
-- Collapse the take-in site registry onto notebooks.locations.
--
-- 20260915_001 created logistics.warehouses as take-in's own site registry.
-- That was a duplicate: notebooks.locations already held the five receiving
-- sites (BH, GD, GT, VD, VT) and already drove the Warehousing tabs in the
-- sidebar. Two registries for one set of physical sites is exactly the coupling
-- ARCHITECTURE.md exists to prevent, and it had already drifted — the two sites
-- recorded there as "to be named" were the Teeverwerkers all along.
--
-- SITE CODE AND BATCH SERIES ARE DIFFERENT THINGS and both are real. The site
-- GD mints the GS- series; the site VD mints MAT-. That is what the signed
-- Afleweringsbewyse show (GS-0293, MAT-0271), so the series is a PROPERTY of
-- the site here, never a second identity for it.

create table if not exists takein.site_config (
  location_code          text primary key references notebooks.locations(code) on update cascade,
  takes_farmer_delivery  boolean not null default false,
  batch_prefix text, batch_seq integer not null default 0,
  grn_prefix   text, grn_seq   integer not null default 0,
  doc_prefix   text, doc_seq   integer not null default 0,
  -- true while the series is a placeholder rather than the paper book's own.
  -- A guessed series printed on a bag is indistinguishable from a real one, so
  -- the screens say so rather than letting it pass silently (ARCHITECTURE §5).
  series_provisional     boolean not null default false
);

comment on column takein.site_config.batch_seq is
  'Last batch number ISSUED at this site. Set to the last number in the paper '
  'book at cut-over; takein.next_batch_no() continues from here. Never computed '
  'from max(batch_no) in app code — see ARCHITECTURE.md §5.';

insert into takein.site_config
  (location_code, takes_farmer_delivery, batch_prefix, grn_prefix, doc_prefix, series_provisional)
values
  ('BH', false, null,   null,        null,     false),  -- consolidated view only
  ('GD', true,  'GS-',  'GRN-GS-',   'GD-FD',  false),  -- series from the signed notes
  ('VD', true,  'MAT-', 'GRN-MAT-',  'VD-FD',  false),
  ('GT', true,  'GT-',  'GRN-GT-',   'GT-FD',  true ),  -- PROVISIONAL
  ('VT', true,  'VT-',  'GRN-VT-',   'VT-FD',  true )   -- PROVISIONAL
on conflict (location_code) do nothing;

-- One site list for the app. security_invoker so the caller's RLS still applies
-- rather than the view owner's.
create or replace view takein.sites
with (security_invoker = true) as
select l.code, l.name, l.short_name, l.sort_order, l.active,
       coalesce(s.takes_farmer_delivery, false) as takes_farmer_delivery,
       s.batch_prefix, s.batch_seq, s.grn_prefix, s.grn_seq, s.doc_prefix, s.doc_seq,
       coalesce(s.series_provisional, false)    as series_provisional
from notebooks.locations l
left join takein.site_config s on s.location_code = l.code;

-- ── repoint the take-in tables at the site code ─────────────────────────────
alter table takein.batches  add column if not exists location_code text;
alter table takein.bookings add column if not exists location_code text;

update takein.batches b set location_code = m.code
  from (select w.id, case w.code when 'GS' then 'GD' when 'MAT' then 'VD' else w.code end as code
        from logistics.warehouses w) m
 where m.id = b.warehouse_id and b.location_code is null;

update takein.bookings bk set location_code = m.code
  from (select w.id, case w.code when 'GS' then 'GD' when 'MAT' then 'VD' else w.code end as code
        from logistics.warehouses w) m
 where m.id = bk.warehouse_id and bk.location_code is null;

alter table takein.batches  alter column location_code set not null;
alter table takein.bookings alter column location_code set not null;

alter table takein.batches
  add constraint batches_location_fk  foreign key (location_code) references notebooks.locations(code) on update cascade;
alter table takein.bookings
  add constraint bookings_location_fk foreign key (location_code) references notebooks.locations(code) on update cascade;

-- The search view names warehouse_id, so it is REBUILT on the new column rather
-- than dropped: History searches every number on every document through it.
drop view if exists takein.v_batch_search;

alter table takein.batches  drop column if exists warehouse_id;
alter table takein.bookings drop column if exists warehouse_id;

create view takein.v_batch_search
with (security_invoker = true) as
select b.id, b.batch_no, b.location_code, b.delivered_on, b.contract_id,
       concat_ws(' ', b.batch_no, b.weighbridge_no, b.producer_lot, b.tea_court,
                 b.driver, b.vehicle, p.name, p.acumatica_code, c.contract_no,
                 (select string_agg(l.name, ' ' order by l.ordinal)
                    from takein.batch_lands l where l.batch_id = b.id),
                 (select string_agg(d.doc_no, ' ')
                    from takein.documents d where d.batch_id = b.id)) as haystack
from takein.batches b
join takein.contracts c on c.id = b.contract_id
join takein.producers p on p.id = c.producer_id;
grant select on takein.v_batch_search to authenticated;

drop table if exists takein.released_batch_nos;
create table takein.released_batch_nos (
  location_code text not null references notebooks.locations(code) on update cascade,
  seq           integer not null,
  released_at   timestamptz not null default now(),
  primary key (location_code, seq)
);
alter table takein.released_batch_nos enable row level security;
drop policy if exists released_batch_nos_all on takein.released_batch_nos;
create policy released_batch_nos_all on takein.released_batch_nos
  for all to authenticated using (true) with check (true);
grant select, insert, delete on takein.released_batch_nos to authenticated;

create index if not exists batches_location_idx  on takein.batches(location_code);
create index if not exists bookings_location_idx on takein.bookings(location_code);

-- ── number allocation, now keyed on the site code ───────────────────────────
drop function if exists takein.next_batch_no(uuid);
drop function if exists takein.next_doc_no(uuid, text);
drop function if exists takein.release_batch_no(uuid, text);

create or replace function takein.next_batch_no(p_location text)
returns text language plpgsql security definer set search_path = takein, public as $fn$
declare v_prefix text; v_seq integer;
begin
  select batch_prefix into v_prefix from takein.site_config
   where location_code = p_location for update;
  if v_prefix is null then
    raise exception 'Site % has no batch series set', p_location;
  end if;

  -- A returned load puts its number back, so the sequential paper book has no
  -- hole. Take the lowest released number before touching the counter.
  delete from takein.released_batch_nos
   where location_code = p_location
     and seq = (select min(seq) from takein.released_batch_nos where location_code = p_location)
  returning seq into v_seq;

  if v_seq is null then
    update takein.site_config set batch_seq = batch_seq + 1
     where location_code = p_location returning batch_seq into v_seq;
  end if;

  return v_prefix || lpad(v_seq::text, 4, '0');
end $fn$;

create or replace function takein.release_batch_no(p_location text, p_batch_no text)
returns void language plpgsql security definer set search_path = takein, public as $fn$
declare v_seq integer;
begin
  v_seq := nullif(regexp_replace(p_batch_no, '^.*?(\d+)$', '\1'), '')::integer;
  if v_seq is null then return; end if;
  insert into takein.released_batch_nos(location_code, seq) values (p_location, v_seq)
  on conflict do nothing;
end $fn$;

create or replace function takein.next_doc_no(p_location text, p_kind text)
returns text language plpgsql security definer set search_path = takein, public as $fn$
declare v_prefix text; v_seq integer;
begin
  if p_kind = 'grn' then
    update takein.site_config set grn_seq = grn_seq + 1
     where location_code = p_location returning grn_prefix, grn_seq into v_prefix, v_seq;
  else
    update takein.site_config set doc_seq = doc_seq + 1
     where location_code = p_location returning doc_prefix, doc_seq into v_prefix, v_seq;
  end if;
  if v_prefix is null then
    raise exception 'Site % has no % series set', p_location, p_kind;
  end if;
  -- A document number is burnt once issued, voided or not: a document that was
  -- printed and handed over is evidence.
  return v_prefix || case when p_kind = 'grn' then v_seq::text
                          else lpad(v_seq::text, 7, '0') end;
end $fn$;

grant execute on function takein.next_batch_no(text)          to authenticated;
grant execute on function takein.release_batch_no(text, text) to authenticated;
grant execute on function takein.next_doc_no(text, text)      to authenticated;
grant select on takein.site_config to authenticated;
grant select on takein.sites       to authenticated;
alter table takein.site_config enable row level security;
drop policy if exists site_config_read on takein.site_config;
create policy site_config_read on takein.site_config for select to authenticated using (true);

-- ── the duplicate registry goes ─────────────────────────────────────────────
-- Created by 20260915_001 and used by nothing else: the logistics schema was
-- empty before it and its pages are commented out of the sidebar, so dropping
-- these returns the schema to the state it was in.
drop table if exists logistics.locations;
drop table if exists logistics.warehouses;

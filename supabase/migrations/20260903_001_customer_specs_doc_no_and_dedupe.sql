-- Customer specs: doc number, product description, version, and one row per key.
--
-- WHY -------------------------------------------------------------------------
-- qms.customer_specs identified a spec by (customer, product_family, grade,
-- variant) alone, and nothing enforced even that. Production therefore held:
--
--   * THREE Entyce rows for Rooibos / Super Grade / Conventional --
--     'Entyce ', 'ENTYCE ' and 'Entyce' -- with DIFFERENT bulk-density limits
--     (280-300 vs 280-320).
--   * TWO Edelweiss rows for Botanicals / Phytoblend / Conventional differing
--     on >10 min, >12 min and >16 min (one holding an impossible 5.6 min
--     against a 5 max).
--   * A row with product_family = 'Botanicals ' and grade = 'Phytoblend '
--     (trailing spaces), which no .ilike('Botanicals') lookup can reach.
--
-- Both Edelweiss rows match a case-insensitive lookup, so which limits a
-- pasteuriser run or a COA was judged against came down to Postgres row order.
--
-- The client spec sheet also shows the deeper cause: one customer legitimately
-- has several specs for the same family/grade/variant -- Entyce has SEVEN
-- documents, IPS-ENT-001..007, six of them under one key with different sieve
-- limits -- separated only by document number and product description, and this
-- table had a column for neither. So it could not represent the real data, and
-- every attempt to enter a second spec produced an indistinguishable duplicate.
--
-- WHAT ------------------------------------------------------------------------
--   1. doc_no, doc_version, product_description columns.
--   2. spec_revisions jsonb -- append-only trace of where a row's values came
--      from, so a consolidation is auditable rather than a silent overwrite.
--   3. Trim the identity columns on every row.
--   4. Consolidate Entyce -> one row on IPS-ENT-007 and Edelweiss -> one row on
--      IPS-EDE-002, per the lab's instruction to use the latest document.
--   5. A unique index on the NORMALISED identity including doc_no, so two specs
--      may coexist when they are genuinely different documents, and may not
--      when they differ only by whitespace or case.
--
-- Everything below keys on the NORMALISED identity, never on a row id: staging
-- carries the Entyce triple but not the Edelweiss pair, so the ids differ
-- between the two databases. Each consolidation block is also a no-op-safe
-- update of a single row, so it does the right thing whether the group holds
-- three rows, two, or one.
--
-- Applied to staging (qjqkpockmujecjgmdple) first. Production
-- (sxzjjcyuzyfneesnsjna) needs it once the code that reads these columns is
-- deployed there -- never before.

begin;

-- 1 ─── Columns ───────────────────────────────────────────────────────────────
alter table qms.customer_specs
  add column if not exists doc_no              text,
  add column if not exists doc_version         integer,
  add column if not exists product_description text,
  add column if not exists spec_revisions      jsonb not null default '[]'::jsonb;

comment on column qms.customer_specs.doc_no is
  'Controlled spec document this row''s values come from, e.g. IPS-ENT-007. Part of the row identity: one customer may hold several specs for one product, distinguished only by this.';
comment on column qms.customer_specs.doc_version is
  'Trailing number of doc_no (IPS-ENT-007 -> 7). Displayed as the spec version; the highest is the current one for that customer and product.';
comment on column qms.customer_specs.product_description is
  'The product as named on the spec document, e.g. "Conventional Rooibos Super Grade". Two docs under one grade are told apart by this.';
comment on column qms.customer_specs.spec_revisions is
  'Append-only. Each entry records where the row''s values came from: {at, by, doc_no, doc_version, note, previous:[...]}. Never rewritten.';

-- 2 ─── Trim the identity columns everywhere ──────────────────────────────────
-- Before the unique index, so trailing-space rows collide now and visibly
-- rather than at the next write. btrim only: internal whitespace is not
-- collapsed, because no production row has any and a regexp rewrite over a
-- quality table earns nothing for the extra risk.
update qms.customer_specs
   set product_family = btrim(product_family),
       grade          = btrim(grade),
       variant        = btrim(variant),
       customer       = btrim(coalesce(customer, ''))
 where product_family <> btrim(product_family)
    or grade          <> btrim(grade)
    or variant        <> btrim(variant)
    or customer is null
    or customer       <> btrim(customer);

-- 3 ─── Entyce: one row, on IPS-ENT-007 ──────────────────────────────────────
-- The lab's decision: the latest document wins. IPS-ENT-007's values, from the
-- client spec sheet, are moisture <9.2, BD 280-300, >10 max 5, >12 10-25,
-- >16 25-45, >20 10-25, >60 20-35.
--
-- Note >20 max is 25 where two of the rows carried 20, and BD max is 300 where
-- the third carried 320. NONE of the three rows matched IPS-ENT-007 exactly, so
-- this is a correction of the limits, not merely a de-duplication.
--
-- The most recently updated row survives; the rest are removed after their
-- values are recorded in spec_revisions.
with grp as (
  select id, updated_at from qms.customer_specs
   where lower(btrim(coalesce(customer, ''))) = 'entyce'
     and lower(btrim(product_family)) = 'rooibos'
     and lower(btrim(grade))          = 'super grade'
     and lower(btrim(variant))        = 'conventional'
), keep as (
  select id from grp order by updated_at desc nulls last, id desc limit 1
), prev as (
  select jsonb_agg(jsonb_build_object(
           'id', s.id, 'customer', s.customer,
           'bulk_density_min', s.bulk_density_min, 'bulk_density_max', s.bulk_density_max,
           'gt12_min', s.gt12_min, 'gt12_max', s.gt12_max,
           'gt16_min', s.gt16_min, 'gt16_max', s.gt16_max,
           'gt20_min', s.gt20_min, 'gt20_max', s.gt20_max,
           'gt60_min', s.gt60_min, 'gt60_max', s.gt60_max) order by s.id) as rows
    from qms.customer_specs s where s.id in (select id from grp)
)
update qms.customer_specs t
   set doc_no              = 'IPS-ENT-007',
       doc_version         = 7,
       product_description = 'Conventional Rooibos Super Grade',
       customer            = 'Entyce',
       moisture_max        = 9.2,
       bulk_density_min    = 280,
       bulk_density_max    = 300,
       gt10_min = null, gt10_max = 5,
       gt12_min = 10,   gt12_max = 25,
       gt16_min = 25,   gt16_max = 45,
       gt20_min = 10,   gt20_max = 25,
       gt60_min = 20,   gt60_max = 35,
       updated_at          = now(),
       spec_revisions      = t.spec_revisions || jsonb_build_object(
         'at', now(), 'by', 'migration 20260903_001',
         'doc_no', 'IPS-ENT-007', 'doc_version', 7,
         'note', 'Consolidated the Entyce rows for Rooibos / Super Grade / Conventional onto IPS-ENT-007, the latest document, and corrected the limits to that document (>20 max 20 -> 25; BD max 320 -> 300).',
         'previous', (select rows from prev))
 where t.id = (select id from keep);

delete from qms.customer_specs
 where lower(btrim(coalesce(customer, ''))) = 'entyce'
   and lower(btrim(product_family)) = 'rooibos'
   and lower(btrim(grade))          = 'super grade'
   and lower(btrim(variant))        = 'conventional'
   and doc_no is distinct from 'IPS-ENT-007';

-- 4 ─── Edelweiss: one row, on IPS-EDE-002 ───────────────────────────────────
-- IPS-EDE-002 ('Phyto Blend - Bulk Packed') is BD 260-300, >10 max 5,
-- >12 10-25, >16 20-40, >20 10-20, >60 25-35 -- which the 'EDELWEISS' row
-- already matches exactly, so no limit is changed here. The other row's
-- 5.6 / 14.3 / 26.5 minima match no document and read as measured results typed
-- into a spec, including a >10 min of 5.6 above its own max of 5.
--
-- Values are therefore set explicitly to IPS-EDE-002 rather than trusting
-- whichever row survives the ordering.
with grp as (
  select id, updated_at from qms.customer_specs
   where lower(btrim(coalesce(customer, ''))) = 'edelweiss'
     and lower(btrim(product_family)) = 'botanicals'
     and lower(btrim(grade))          = 'phytoblend'
     and lower(btrim(variant))        = 'conventional'
), keep as (
  select id from grp order by updated_at desc nulls last, id desc limit 1
), prev as (
  select jsonb_agg(jsonb_build_object(
           'id', s.id, 'customer', s.customer,
           'bulk_density_min', s.bulk_density_min, 'bulk_density_max', s.bulk_density_max,
           'gt10_min', s.gt10_min, 'gt10_max', s.gt10_max,
           'gt12_min', s.gt12_min, 'gt12_max', s.gt12_max,
           'gt16_min', s.gt16_min, 'gt16_max', s.gt16_max,
           'gt20_min', s.gt20_min, 'gt20_max', s.gt20_max,
           'gt60_min', s.gt60_min, 'gt60_max', s.gt60_max) order by s.id) as rows
    from qms.customer_specs s where s.id in (select id from grp)
)
update qms.customer_specs t
   set doc_no              = 'IPS-EDE-002',
       doc_version         = 2,
       product_description = 'Phyto Blend - Bulk Packed',
       customer            = 'Edelweiss',
       bulk_density_min    = 260,
       bulk_density_max    = 300,
       gt10_min = null, gt10_max = 5,
       gt12_min = 10,   gt12_max = 25,
       gt16_min = 20,   gt16_max = 40,
       gt20_min = 10,   gt20_max = 20,
       gt60_min = 25,   gt60_max = 35,
       updated_at          = now(),
       spec_revisions      = t.spec_revisions || jsonb_build_object(
         'at', now(), 'by', 'migration 20260903_001',
         'doc_no', 'IPS-EDE-002', 'doc_version', 2,
         'note', 'Consolidated the Edelweiss rows for Botanicals / Phytoblend / Conventional onto IPS-EDE-002, the latest document. The discarded row held an impossible >10 range (min 5.6 above max 5).',
         'previous', (select rows from prev))
 where t.id = (select id from keep);

delete from qms.customer_specs
 where lower(btrim(coalesce(customer, ''))) = 'edelweiss'
   and lower(btrim(product_family)) = 'botanicals'
   and lower(btrim(grade))          = 'phytoblend'
   and lower(btrim(variant))        = 'conventional'
   and doc_no is distinct from 'IPS-EDE-002';

-- 5 ─── One spec per normalised identity ──────────────────────────────────────
-- coalesce(doc_no,'') so the in-house rows that legitimately have no controlled
-- document still get exactly one row per customer and product. An expression
-- index on the normalised values, because that is what the application
-- compares -- a plain unique(customer, ...) would still let 'Entyce ' back in.
create unique index if not exists customer_specs_identity_uniq
  on qms.customer_specs (
    lower(btrim(coalesce(customer, ''))),
    lower(btrim(product_family)),
    lower(btrim(grade)),
    lower(btrim(variant)),
    upper(btrim(coalesce(doc_no, '')))
  );

commit;

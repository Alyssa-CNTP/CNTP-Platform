-- 20260728_002_logistics_production_link.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Closes the gap between production and logistics: today logistics.units is
-- created ONLY from a supplier GRN (receiveUnit() in lib/logistics/actions.ts),
-- so a finished production.bag_tags bag never re-enters the warehouse/dispatch
-- lifecycle — it just stops existing as far as logistics is concerned. That
-- means dispatch has nothing to mark, and a stock count built from
-- bag_tags.status alone would count shipped goods as "in stock" forever.
--
-- Fix: allow a logistics.units row to be created by SCANNING a
-- production.bag_tags.serial_number directly, using that same serial as the
-- unit's `barcode` — one physical bag, one barcode, across both schemas. This
-- is a value-based join (not a hard FK): production and logistics share one
-- Postgres database but are logically separate domains, and unlike
-- GRN-sourced units (whose barcode is internally generated and never appears
-- in bag_tags), a hard FK on `barcode` would be wrong for the majority of
-- existing rows. See lib/logistics/actions.ts receiveProductionUnit() for the
-- write path, and lib/production/scan-utils.ts markBagConsumed() for how the
-- source bag_tags row is retired at the same moment (consumed_at_section =
-- 'logistics') — this is what stops it double-counting as both "in stock on
-- the floor" and "active in the warehouse" at once.

-- Historically every unit came from a GRN; that's no longer always true.
alter table logistics.units alter column grn_id drop not null;

alter table logistics.units
  add column if not exists source text not null default 'grn'
    check (source in ('grn', 'production'));

-- Which production section the bag came from, for traceability display —
-- informational only; the real link is the shared barcode/serial value.
alter table logistics.units
  add column if not exists source_section_id text;

comment on column logistics.units.source is
  'grn = received from a supplier GRN. production = created by scanning a production.bag_tags serial into the warehouse (see receiveProductionUnit()).';
comment on column logistics.units.source_section_id is
  'For source=production units: the production.bag_tags.section_id the bag came from (sieving/refining1/refining2/granule/blender/smallblender/pasteuriser). Null for source=grn.';
comment on column logistics.units.barcode is
  'Unique key into this table. For source=production units this IS production.bag_tags.serial_number — the shared identity that links the two schemas.';

create index if not exists idx_logistics_units_barcode on logistics.units(barcode);

-- ─────────────────────────────────────────────────────────────────────────────
-- A genuinely trustworthy "how much do we have" figure. Before this migration
-- there was no way to answer that at all — bag_tags.status='in_stock' alone
-- overstates stock forever (dispatched goods never left that bucket). Now
-- that a bag is represented in exactly ONE of these two tables at any moment
-- (still on the floor, in bag_tags, OR already warehoused and not yet
-- dispatched, in logistics.units — never both), summing across both gives a
-- correct total. Grouped by product/variant, not by individual bag; the
-- production dashboard's stock UI (deferred this session) can query this
-- directly rather than reinventing the aggregation.
create or replace view production.v_stock_on_hand as
select
  'floor'::text as location_kind,
  product_type,
  variant,
  count(*)::int as bag_count,
  coalesce(sum(weight_kg), 0) as total_kg
from production.bag_tags
where status = 'in_stock'
group by product_type, variant

union all

select
  'warehouse'::text as location_kind,
  product_type,
  variant,
  count(*)::int as bag_count,
  coalesce(sum(weight_kg), 0) as total_kg
from logistics.units
where status = 'active'
group by product_type, variant;

comment on view production.v_stock_on_hand is
  'Current stock on hand: bags still on the production floor (bag_tags.status=in_stock) union bags already warehoused but not yet dispatched (logistics.units.status=active). Each physical bag appears in exactly one row-set at any time, so summing location_kind for a product/variant gives a trustworthy total.';

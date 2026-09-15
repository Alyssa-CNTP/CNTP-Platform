-- supabase/seeds/20260915_takein_demo_data.sql
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  STAGING ONLY — TEST DATA. NEVER RUN THIS AGAINST PRODUCTION.            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Template producers, contracts, pricing, panel terms and bookings so the whole
-- take-in flow can be walked end to end without inventing data at each step.
--
-- Everything it writes is tagged so it can be removed in one command: every
-- producer carries an `acumatica_code` starting 'V-DEMO', every contract a
-- `contract_no` starting 'D26-'. The teardown is
-- supabase/seeds/20260915_takein_demo_data_teardown.sql.
--
-- IT IS IDEMPOTENT. Re-running replaces the demo rows rather than doubling them.
--
-- THREE THINGS TO KNOW BEFORE YOU USE IT:
--
--   1. Producer emails are deliberately NULL. Nothing in this module emails a
--      farmer, and a demo row with a plausible address is how that stops being
--      true by accident.
--
--   2. Opening a delivery CONSUMES a batch number. After testing, reset each
--      depot's batch_seq / grn_seq / doc_seq to the last number in its paper
--      book before the first live take-in — see the teardown script.
--
--   3. The rand values are invented. They exist to prove the pricing RLS split
--      works, not to reflect what anyone is paid.
--
-- The four released contracts differ ON PURPOSE, because the thing most worth
-- testing is that a panel decision's effect is read from the CONTRACT and not
-- hardcoded (ARCHITECTURE §5 / the Verpligte Paneel Besluit rule):
--
--   D26-001  every trigger binding except lab_variance — the default shape
--   D26-002  organic, sensory NOT binding — panel sits, farmer unaffected
--   D26-003  RA, density AND sensory NOT binding — the in-house-only case
--   D26-004  lab_variance IS binding — the unusual one nobody has by default

begin;

-- ── clear any previous run ──────────────────────────────────────────────────
delete from takein.bookings
 where contract_id in (select id from takein.contracts where contract_no like 'D26-%');
delete from takein.contract_panel_terms
 where contract_id in (select id from takein.contracts where contract_no like 'D26-%');
delete from takein.contract_pricing
 where contract_id in (select id from takein.contracts where contract_no like 'D26-%');
delete from takein.contracts  where contract_no    like 'D26-%';
delete from takein.producers   where acumatica_code like 'V-DEMO%';

-- ── producers ───────────────────────────────────────────────────────────────
-- email left NULL on purpose; see the header.
insert into takein.producers (acumatica_code, name, contact_name, phone, address) values
  ('V-DEMO001', 'Kleinvlei Boerdery',   'Jan Kleinhans',  '027 482 0101', 'Clanwilliam'),
  ('V-DEMO002', 'Driehoek Rooibos',     'Marie du Toit',  '027 482 0102', 'Cederberg'),
  ('V-DEMO003', 'Langkloof Landgoed',   'Pieter Nel',     '027 482 0103', 'Graafwater'),
  ('V-DEMO004', 'Sandberg Boerdery',    'Hannes Maree',   '027 219 0104', 'Vanrhynsdorp'),
  ('V-DEMO005', 'Rietfontein Organics', 'Susan van Wyk',  '027 218 0105', 'Nieuwoudtville');

-- ── contracts ───────────────────────────────────────────────────────────────
-- Four released (bookable), one awaiting_release and one draft, so the two-step
-- approve → release can be walked without first having to create a contract.
insert into takein.contracts (contract_no, producer_id, season, variant, contracted_kg, status,
                              approved_kg_at, released_at)
select v.contract_no, p.id, 2026, v.variant, v.kg, v.status,
       case when v.status in ('awaiting_release','released') then now() end,
       case when v.status = 'released' then now() end
from (values
  ('D26-001', 'V-DEMO001', 'Conventional',    45000, 'released'),
  ('D26-002', 'V-DEMO002', 'Organic',         28000, 'released'),
  ('D26-003', 'V-DEMO003', 'RA-Conventional', 62000, 'released'),
  ('D26-004', 'V-DEMO004', 'Conventional',    38000, 'released'),
  ('D26-005', 'V-DEMO005', 'Organic',         15000, 'awaiting_release'),
  ('D26-006', 'V-DEMO001', 'Conventional',    12000, 'draft')
) as v(contract_no, producer_code, variant, kg, status)
join takein.producers p on p.acumatica_code = v.producer_code;

-- ── pricing (invented figures, cents per kg) ────────────────────────────────
-- Its own table because Supabase RLS is row-level, not column-level: this is
-- what lets a depot clerk read the contract list while the money stays out of
-- reach. Only a user with can_view_contract_pricing ticked EXPLICITLY on their
-- account can select these rows.
insert into takein.contract_pricing (contract_id, guaranteed_cents, first_pay_cents)
select c.id, v.guar, v.first
from (values
  ('D26-001', 3850, 2200), ('D26-002', 5240, 3100), ('D26-003', 4120, 2450),
  ('D26-004', 3795, 2150), ('D26-005', 5480, 3250), ('D26-006', 3850, 2200)
) as v(contract_no, guar, first)
join takein.contracts c on c.contract_no = v.contract_no;

-- ── panel terms — the point of the exercise ─────────────────────────────────
-- binding = true  → the finding reaches the producer (Verpligte Paneel Besluit)
-- binding = false → the panel still sits, but it is in-house only
insert into takein.contract_panel_terms (contract_id, term_key, binding, clause_ref)
select c.id, v.term_key, v.binding, v.clause
from (values
  -- D26-001 — the default shape
  ('D26-001', 'density',         true,  'Klousule 6.2 — Massadigtheid'),
  ('D26-001', 'sensory',         true,  'Klousule 6.3 — Sensoriese ondergrens'),
  ('D26-001', 'organic_residue', true,  'Addendum B — Organiese residu'),
  ('D26-001', 'pa4',             true,  'Addendum B — PA vlakke'),
  ('D26-001', 'organic_pa23',    true,  'Addendum B — PA vlakke'),
  ('D26-001', 'lab_variance',    false, null),
  -- D26-002 — organic; a weak cup is in-house only
  ('D26-002', 'density',         true,  'Klousule 6.2 — Massadigtheid'),
  ('D26-002', 'sensory',         false, null),
  ('D26-002', 'organic_residue', true,  'Addendum B — Organiese residu'),
  ('D26-002', 'pa4',             true,  'Addendum B — PA vlakke'),
  ('D26-002', 'organic_pa23',    true,  'Addendum B — PA vlakke'),
  ('D26-002', 'lab_variance',    false, null),
  -- D26-003 — RA; neither density nor sensory reaches the producer
  ('D26-003', 'density',         false, null),
  ('D26-003', 'sensory',         false, null),
  ('D26-003', 'organic_residue', true,  'Addendum B — Organiese residu'),
  ('D26-003', 'pa4',             true,  'Addendum B — PA vlakke'),
  ('D26-003', 'organic_pa23',    true,  'Addendum B — PA vlakke'),
  ('D26-003', 'lab_variance',    false, null),
  -- D26-004 — the unusual one: a lab disagreement IS binding here
  ('D26-004', 'density',         true,  'Klousule 6.2 — Massadigtheid'),
  ('D26-004', 'sensory',         true,  'Klousule 6.3 — Sensoriese ondergrens'),
  ('D26-004', 'organic_residue', true,  'Addendum B — Organiese residu'),
  ('D26-004', 'pa4',             true,  'Addendum B — PA vlakke'),
  ('D26-004', 'organic_pa23',    true,  'Addendum B — PA vlakke'),
  ('D26-004', 'lab_variance',    true,  'Klousule 7.1 — Laboratoriumverskil')
) as v(contract_no, term_key, binding, clause)
join takein.contracts c on c.contract_no = v.contract_no;

-- ── a few bookings, so Intake has something to open ─────────────────────────
-- Sized by the same rule the screen uses: <=30 bags one hour, <=80 two hours,
-- above that two hours with the manager alert raised.
insert into takein.bookings (warehouse_id, contract_id, booked_date, start_hour, hours,
                             bags, expected_kg, land_name, kind, status, alert)
select w.id, c.id, v.d::date, v.h, v.hrs, v.bags, v.kg, v.land, 'farmer', 'booked', v.alert
from (values
  ('GS',  'D26-001', current_date + 1, 10, 2, 48,  16800, 'Hetley',      false),
  ('GS',  'D26-003', current_date + 1, 13, 2, 95,  33250, 'Bo-Kraal',    true ),
  ('MAT', 'D26-004', current_date + 2, 10, 1, 24,   8400, 'Sandberg Wes',false),
  ('GS',  'D26-002', current_date + 2, 13, 2, 62,  21700, 'Driehoek Oos',false),
  ('MAT', 'D26-004', current_date + 7, 10, 2, 74,  25900, 'Sandberg Oos',false)
) as v(depot, contract_no, d, h, hrs, bags, kg, land, alert)
join logistics.warehouses w on w.code = v.depot
join takein.contracts     c on c.contract_no = v.contract_no;

commit;

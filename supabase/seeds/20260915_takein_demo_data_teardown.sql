-- supabase/seeds/20260915_takein_demo_data_teardown.sql
--
-- Removes everything 20260915_takein_demo_data.sql created, PLUS anything that
-- was captured against it during testing — batches, bags, documents, lab
-- results and the audit trail — and resets each depot's counters to 0.
--
-- RUN THIS BEFORE THE FIRST LIVE TAKE-IN, then set batch_seq / grn_seq /
-- doc_seq to the last number in each depot's paper book. Leaving demo batches
-- behind would put invented deliveries in Settlement and in the season KPIs.
--
-- takein.batch_events has UPDATE and DELETE revoked from `authenticated` on
-- purpose (it is the append-only audit ledger), so this script has to be run
-- with an owner/service role — not from the app.

begin;

create temporary table demo_batches on commit drop as
select b.id from takein.batches b
join takein.contracts c on c.id = b.contract_id
where c.contract_no like 'D26-%';

delete from takein.batch_events where batch_id in (select id from demo_batches);
delete from takein.lab_results  where batch_id in (select id from demo_batches);
delete from takein.documents    where batch_id in (select id from demo_batches);
delete from takein.batch_bags   where batch_id in (select id from demo_batches);
delete from takein.batch_lands  where batch_id in (select id from demo_batches);
delete from takein.batches      where id       in (select id from demo_batches);

delete from takein.bookings
 where contract_id in (select id from takein.contracts where contract_no like 'D26-%');
delete from takein.contract_panel_terms
 where contract_id in (select id from takein.contracts where contract_no like 'D26-%');
delete from takein.contract_pricing
 where contract_id in (select id from takein.contracts where contract_no like 'D26-%');
delete from takein.contracts  where contract_no    like 'D26-%';
delete from takein.producers   where acumatica_code like 'V-DEMO%';

delete from takein.released_batch_nos;
update logistics.warehouses set batch_seq = 0, grn_seq = 0, doc_seq = 0;

commit;

-- 20260914_001_coa_specs_client_bd_spec.sql
--
-- Some customers hold their OWN bulk density specification, measured with
-- their own equipment and in their own units, separate from CNTP's internal
-- one. Reported case: Ostfriesische Tee Gesellschaft (OTG) — CNTP's internal
-- spec is 280-340cc/100g (bulk-density cylinder method); OTG's own document
-- specifies "165 - 175/500ml (IMA Cylinder provided by OTG)", a different
-- instrument and a different unit entirely. There is no formula converting
-- one into the other, so this is stored as free text rather than a numeric
-- min/max the way bd_min/bd_max are — a customer's own spec sheet can phrase
-- it however it phrases it.
--
-- Blank means the customer has no separate client-side spec — the COA prints
-- only CNTP's own Bulk Density row, exactly as it always has. A value adds a
-- second row underneath it, for reference only: CNTP measures in its own
-- method and has no result to report against the client's own instrument.

alter table qms.coa_specs
  add column if not exists client_bd_spec text;

comment on column qms.coa_specs.client_bd_spec is
  'Free-text bulk-density specification as the customer states it in their OWN document/units/instrument (e.g. "165 - 175/500ml (IMA Cylinder provided by OTG)"), distinct from bd_min/bd_max which are CNTP''s internal cc/100g spec. Blank = customer has no separate client-side BD spec. When set, the COA prints a second Bulk Density row showing this spec with no result (CNTP does not measure with the customer''s own instrument).';

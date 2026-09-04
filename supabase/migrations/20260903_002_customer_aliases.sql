-- Customer name aliases: one customer, many spellings.
--
-- WHY -------------------------------------------------------------------------
-- A spec is resolved by matching a run's customer name against a spec row's
-- customer name. Normalisation (20260903_001 plus lib/quality/customer-spec-match)
-- made that match ignore case and whitespace, so 'ENTYCE', 'Entyce ' and
-- 'Entyce' all resolve. What it cannot do is match two genuinely DIFFERENT
-- strings, and production holds exactly that:
--
--   run says 'EWTC'                          spec says 'East West Tea Company (EWTC)'
--   run says 'Afri Tea and Coffee Blenders'  spec says 'Afri Tea and Coffee''s'
--   run says 'Lipton&Infusion (Ekaterra)'    spec says 'Lipton and Infusion'
--
-- Those runs resolve to the GENERIC spec instead of the customer's own -- a
-- different set of limits, with nothing on screen to say so. Four pasteuriser
-- runs are affected today.
--
-- Renaming the spec row is not the fix: both spellings are already in the data
-- and both will keep being typed, so any single name fixes some runs and breaks
-- others. An alias absorbs the variation instead of fighting it.
--
-- MODEL -----------------------------------------------------------------------
-- alias -> canonical_name. The canonical name is whatever the SPEC row carries,
-- so resolution is: normalise the run's name, look it up here, then match the
-- result against customer_specs exactly as before.
--
-- Deliberately NOT a foreign key to customer_specs.customer: a customer can be
-- aliased before its spec exists (that is the useful case -- the alias is what
-- tells the QC the spec is missing), and customer_specs has no unique key on
-- customer alone, since one customer legitimately holds many spec rows.

begin;

create table if not exists qms.customer_aliases (
  id            bigserial primary key,
  -- The spelling that gets typed on a run.
  alias         text not null,
  -- The spelling customer_specs.customer uses.
  canonical_name text not null,
  note          text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint customer_aliases_alias_not_blank     check (btrim(alias) <> ''),
  constraint customer_aliases_canonical_not_blank check (btrim(canonical_name) <> ''),
  -- An alias that equals its own canonical name is a no-op that only creates
  -- confusion. Compared normalised, because that is how it will be looked up.
  constraint customer_aliases_not_self
    check (lower(btrim(regexp_replace(alias, '\s+', ' ', 'g')))
        <> lower(btrim(regexp_replace(canonical_name, '\s+', ' ', 'g'))))
);

comment on table qms.customer_aliases is
  'alias -> canonical_name for customer names. Resolved before a spec lookup so a run recorded under a different spelling still finds its customer''s spec. See lib/quality/customer-spec-match.ts (resolveCustomerName).';

-- One canonical target per alias. Normalised, so 'ewtc' and 'EWTC ' cannot both
-- be added -- the same class of duplicate this whole exercise exists to remove.
create unique index if not exists customer_aliases_alias_uniq
  on qms.customer_aliases (lower(btrim(regexp_replace(alias, '\s+', ' ', 'g'))));

-- Lookups are always by alias; this index also serves the canonical-name
-- grouping the admin screen shows.
create index if not exists customer_aliases_canonical_idx
  on qms.customer_aliases (lower(btrim(regexp_replace(canonical_name, '\s+', ' ', 'g'))));

-- ── Seed: the three aliases already visible in production run data ──────────
-- Each one has real runs behind it that are currently resolving to the generic
-- spec. Nothing is guessed: every canonical_name below is the exact string an
-- existing customer_specs row carries.
insert into qms.customer_aliases (alias, canonical_name, note, created_by)
values
  ('EWTC', 'East West Tea Company (EWTC)',
   '2 pasteuriser runs recorded as the short form.', 'migration 20260903_002'),
  ('East West Tea Company', 'East West Tea Company (EWTC)',
   'The spelling used in the client spec sheet (IPS-EAS-*).', 'migration 20260903_002'),
  ('East West Tea Co.', 'East West Tea Company (EWTC)',
   'Third spelling in the client spec sheet.', 'migration 20260903_002'),
  ('Afri Tea and Coffee Blenders', 'Afri Tea and Coffee''s',
   '1 pasteuriser run, and the spelling used in the client spec sheet (IPS-AFR-001).', 'migration 20260903_002'),
  ('Lipton&Infusion (Ekaterra)', 'Lipton and Infusion',
   '1 pasteuriser run recorded with the Ekaterra group name.', 'migration 20260903_002'),
  ('Alveus GmbH', 'Alveus',
   'The spelling used in the client spec sheet (IPS-ALV-002/003).', 'migration 20260903_002')
on conflict do nothing;

-- RLS: read for any authenticated user (every capture screen resolves names),
-- write gated in the application by can_edit_customer_specs, consistent with
-- how customer_specs itself is handled.
alter table qms.customer_aliases enable row level security;

drop policy if exists customer_aliases_read on qms.customer_aliases;
create policy customer_aliases_read on qms.customer_aliases
  for select to authenticated using (true);

drop policy if exists customer_aliases_write on qms.customer_aliases;
create policy customer_aliases_write on qms.customer_aliases
  for all to authenticated using (true) with check (true);

commit;

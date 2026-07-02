-- 20260702_001_crm_campaigns_audiences.sql
-- CRM closed-loop, step 1: the two tables the AI generation had nowhere to land.
-- Everything else already exists: accounts (pipeline: stage/signal_ids/assigned_to/
-- sales_angle), company_profiles (dossiers + account_id), account_interactions
-- (timeline), ai_interactions (generation log + verdict), reports (briefings),
-- house_style (brand voice). This only adds campaigns + audiences and links them
-- back to signals / accounts.

-- Saved target segments (an "audience" = a reusable slice of company_profiles/accounts).
create table if not exists sales.audiences (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  criteria     jsonb not null default '{}'::jsonb,   -- region / sector / values / current_supplier / size_tier ...
  company_ids  uuid[] default '{}',                  -- -> company_profiles.id / accounts.id
  signal_ids   uuid[] default '{}',                  -- provenance -> signals.id
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- AI-generated marketing campaigns — a working record, not disposable text.
create table if not exists sales.campaigns (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  channel           text,                              -- linkedin | email | social | local | ...
  status            text not null default 'draft'
                      check (status in ('draft','active','sent','archived')),
  body              text,                              -- generated copy
  audience_id       uuid references sales.audiences(id) on delete set null,
  signal_ids        uuid[] default '{}',               -- provenance -> signals.id
  house_style_v     int,                               -- which house_style version generated it
  ai_interaction_id uuid,                              -- -> ai_interactions.id (feedback loop)
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  sent_at           timestamptz,
  metrics           jsonb not null default '{}'::jsonb -- reach / engagement / clicks ...
);

create index if not exists audiences_created_idx  on sales.audiences (created_at desc);
create index if not exists campaigns_status_idx    on sales.campaigns (status);
create index if not exists campaigns_created_idx    on sales.campaigns (created_at desc);

notify pgrst, 'reload schema';

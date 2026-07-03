-- Quality lab assistant PIN auth table.
-- Mirrors maintenance.tech_auth; stores the PIN in plaintext so managers
-- can view and share it with assistants.

create table if not exists qms.lab_auth (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        unique not null references auth.users(id) on delete cascade,
  auth_email  text        unique not null,
  full_name   text        not null,
  pin         text        not null,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Only quality managers, lab managers, and IT can read/write this table.
alter table qms.lab_auth enable row level security;

create policy "lab_auth_manage" on qms.lab_auth
  using (
    exists (
      select 1 from shared.app_roles ar
      where ar.user_id = auth.uid()
        and ar.is_active = true
        and ar.role in (
          'quality_manager',
          'lab_manager',
          'senior_developer',
          'co_developer',
          'it_admin'
        )
    )
  );

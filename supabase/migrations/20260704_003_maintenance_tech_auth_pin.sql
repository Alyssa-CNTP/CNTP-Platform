-- Add pin column to maintenance.tech_auth so managers can view the assigned PIN.
-- Nullable: existing rows stay intact; pin is populated when next set via the UI.

alter table maintenance.tech_auth
  add column if not exists pin text;

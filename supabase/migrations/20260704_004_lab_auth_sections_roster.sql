-- Add section_ids to qms.lab_auth so lab managers can assign production sections
-- to each lab assistant (mirrors production.operators.section_ids).

alter table qms.lab_auth
  add column if not exists section_ids text[] not null default '{}';

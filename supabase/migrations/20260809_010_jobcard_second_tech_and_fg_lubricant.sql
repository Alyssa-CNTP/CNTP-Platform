-- Second technician on a job card (a task needing two people) + food-grade
-- lubricant declaration on completion. All additive and nullable, so existing
-- rows and code paths are unaffected.
-- APPLIED TO STAGING. Production still needs this before the feature is promoted.
alter table maintenance.job_cards add column if not exists assigned_to_2 text;
alter table maintenance.job_cards add column if not exists assigned_user_id_2 uuid;
alter table maintenance.job_cards add column if not exists fg_lubricant boolean;
alter table maintenance.job_cards add column if not exists fg_lubricant_note text;

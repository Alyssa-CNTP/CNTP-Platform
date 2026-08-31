-- Retire the originator "satisfactory" step. QC and the maintenance manager are
-- now the two checkpoints: qc_check → mgr_verify → complete (or straight to
-- mgr_verify when QC is not required).
--
-- 'verify' is deliberately KEPT in the status CHECK so historical rows stay
-- valid; nothing routes into it any more. Applied to staging AND production.
alter table maintenance.job_cards drop constraint if exists job_cards_status_check;
alter table maintenance.job_cards add constraint job_cards_status_check
  check (status = any (array[
    'raised','clarify','assigned','in_progress','qc_check','verify','mgr_verify','complete','cancelled'
  ]::text[]));

-- Free any card stranded at the retired step so the manager can sign it off.
insert into maintenance.job_card_logs (card_id, kind, stage, author, body)
select id, 'event', 'mgr_verify', 'System',
       'Originator verification step retired — card moved to the maintenance manager for final sign-off.'
from maintenance.job_cards where status = 'verify';

update maintenance.job_cards set status = 'mgr_verify', updated_at = now() where status = 'verify';

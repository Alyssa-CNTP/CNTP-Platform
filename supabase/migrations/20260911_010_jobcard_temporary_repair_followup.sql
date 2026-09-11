-- Temporary repair, ticked by the technician at the time they make one, and the
-- permanent-repair job card it raises automatically when the card is signed off.
--
-- "Temporary Repair" already existed as a maintenance TYPE chosen when the card
-- is raised. That is a prediction made before anyone has looked at the machine.
-- This is the different, later fact: the technician got the line running again
-- but the real repair is still outstanding. Recording it as its own flag (rather
-- than editing maint_types after the fact) keeps the raiser's intent and the
-- technician's finding as two separate, auditable statements.

alter table maintenance.job_cards
  add column if not exists temp_repair       boolean     not null default false,
  add column if not exists temp_repair_note  text,
  add column if not exists temp_repair_at    timestamptz,
  add column if not exists temp_repair_by    text;

-- The permanent-repair card this one spawned, and the reverse link on that card.
-- Both nullable: most cards have neither. follow_up_card_id is what stops a
-- second card being raised if a sign-off is ever retried — it is the record that
-- the follow-up already exists, not just that one was wanted.
alter table maintenance.job_cards
  add column if not exists follow_up_card_id     bigint references maintenance.job_cards(id),
  add column if not exists follow_up_of_card_id  bigint references maintenance.job_cards(id);

-- Finding the outstanding temporary repairs is a routine question ("what is
-- still held together with cable ties?"), so index the open ones.
create index if not exists job_cards_temp_repair_open_idx
  on maintenance.job_cards (temp_repair, status)
  where temp_repair = true;

create index if not exists job_cards_follow_up_of_idx
  on maintenance.job_cards (follow_up_of_card_id)
  where follow_up_of_card_id is not null;

comment on column maintenance.job_cards.temp_repair is
  'Technician declared this a TEMPORARY repair — a permanent-repair card is raised automatically when this card is signed off.';
comment on column maintenance.job_cards.follow_up_card_id is
  'The permanent-repair card raised from this temporary repair. Present = the follow-up has already been created; never raise a second one.';

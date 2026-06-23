-- 20260622_003_signals_dedup.sql
-- Dedup for sales.signals.
--
-- NOTE: the table ALREADY enforces dedup via the existing unique constraint
-- `signals_source_url_unique` (one row per source_url). A re-fetched article is
-- rejected on insert and skipped (Save nodes run with onError=continue). The n8n
-- pipeline also dedups by normalised title within/across runs.
--
-- An earlier draft of this migration tried to add a UNIQUE index on a normalised
-- title (`signals_dedup_key_uniq`). That FAILS on real data — the table already
-- holds legitimately-distinct articles that share a title prefix
-- (e.g. the same press release re-published) — and it is redundant given the
-- source_url constraint. So we do NOT create it. If a stray copy was partially
-- created, drop it:

drop index if exists sales.signals_dedup_key_uniq;

-- No further DDL needed for dedup. Title dedup stays in n8n; URL dedup stays in
-- the existing signals_source_url_unique constraint.

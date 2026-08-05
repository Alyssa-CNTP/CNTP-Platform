-- ============================================================
-- CNTP Production Capture — link job cards into the canonical batch spine
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: 20260721_002_batch_spine.sql, 20260729_002_job_cards_pasteuriser_workflow.sql,
--             20260804_003_job_cards_granule_workflow.sql
-- ============================================================
--
-- job_cards_pasteuriser / job_cards_granule each carry a plain batch_number text
-- column, disconnected from production.batches — unlike prod_sessions, bag_tags,
-- prod_debagging, prod_bagging and production_runs, which already all carry a
-- batch_id FK into the spine (20260721_002_batch_spine.sql). This closes that gap
-- so job-card data (customer, blend, planned tonnage, date) can finally be found
-- by the same canonical batch identity everything else uses — the immediate
-- driver being Sales needing visibility into what was produced, for whom, when.
--
-- Only APPROVED cards get a batch number treated as real/final — a draft's batch
-- number can still change before approval, so wiring it into the spine early
-- would risk creating spurious production.batches rows for numbers that are
-- later revised or abandoned.
-- ============================================================

SET lock_timeout = '5s';

-- ── job_cards_pasteuriser ──────────────────────────────────────────────────
ALTER TABLE public.job_cards_pasteuriser
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production.batches(id);

INSERT INTO production.batches (batch_key, display_lot, first_section)
SELECT DISTINCT ON (bk) bk, batch_number, 'pasteuriser'
FROM (
  SELECT production.normalize_batch(batch_number) AS bk, batch_number, created_at
    FROM public.job_cards_pasteuriser
   WHERE status = 'approved' AND batch_number IS NOT NULL
) src
WHERE bk IS NOT NULL
ORDER BY bk, created_at ASC
ON CONFLICT (batch_key) DO NOTHING;

UPDATE public.job_cards_pasteuriser jc
   SET batch_id = b.id
  FROM production.batches b
 WHERE jc.batch_id IS NULL
   AND jc.status = 'approved'
   AND jc.batch_number IS NOT NULL
   AND b.batch_key = production.normalize_batch(jc.batch_number);

CREATE INDEX IF NOT EXISTS job_cards_pasteuriser_batch_idx ON public.job_cards_pasteuriser(batch_id);

-- ── job_cards_granule ───────────────────────────────────────────────────────
ALTER TABLE public.job_cards_granule
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES production.batches(id);

INSERT INTO production.batches (batch_key, display_lot, first_section)
SELECT DISTINCT ON (bk) bk, batch_number, 'granule'
FROM (
  SELECT production.normalize_batch(batch_number) AS bk, batch_number, created_at
    FROM public.job_cards_granule
   WHERE status = 'approved' AND batch_number IS NOT NULL
) src
WHERE bk IS NOT NULL
ORDER BY bk, created_at ASC
ON CONFLICT (batch_key) DO NOTHING;

UPDATE public.job_cards_granule jc
   SET batch_id = b.id
  FROM production.batches b
 WHERE jc.batch_id IS NULL
   AND jc.status = 'approved'
   AND jc.batch_number IS NOT NULL
   AND b.batch_key = production.normalize_batch(jc.batch_number);

CREATE INDEX IF NOT EXISTS job_cards_granule_batch_idx ON public.job_cards_granule(batch_id);

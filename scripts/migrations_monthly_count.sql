-- ─────────────────────────────────────────────────────────────────────────────
-- Monthly Stock Count — Migration
-- Run once in the Supabase SQL editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Monthly count sessions (one per month × warehouse × product type)
CREATE TABLE IF NOT EXISTS public.mc_sessions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  count_month       date        NOT NULL,          -- First day of month e.g. 2025-05-01
  warehouse_id      text        NOT NULL DEFAULT 'BHW',
  product_type      text        NOT NULL DEFAULT 'r',  -- 'r' Rooibos · 'h' Rosehips
  sup_name          text,
  adm_name          text,
  sup_confirmed_at  timestamptz,
  adm_confirmed_at  timestamptz,
  sup_total_kg      numeric,
  adm_total_kg      numeric,
  match_rate_pct    numeric,
  signed_off_by     uuid,
  signed_off_at     timestamptz,
  sign_off_notes    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_month, warehouse_id, product_type)
);

-- Monthly count entries (one row per item × batch × role)
CREATE TABLE IF NOT EXISTS public.mc_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES public.mc_sessions(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('supervisor','admin')),
  section_id      text        NOT NULL,
  section_name    text,
  inventory_code  text,
  item_name       text,
  batch_number    text,
  kg              numeric     NOT NULL DEFAULT 0,
  bags_qty        integer     NOT NULL DEFAULT 0,
  is_no_stock     boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Variance reviews / sign-offs by management
CREATE TABLE IF NOT EXISTS public.mc_reviews (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES public.mc_sessions(id) ON DELETE CASCADE,
  inventory_code  text        NOT NULL,
  batch_number    text,
  section_id      text,
  notes           text        NOT NULL,
  reviewed_by     uuid,
  reviewed_at     timestamptz NOT NULL DEFAULT now()
);

-- Autosave drafts (one per user × month × product × role)
CREATE TABLE IF NOT EXISTS public.mc_drafts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  count_month  date        NOT NULL,
  product_type text        NOT NULL DEFAULT 'r',
  role         text        NOT NULL CHECK (role IN ('supervisor','admin')),
  state        jsonb       NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, count_month, product_type, role)
);

-- RLS
ALTER TABLE public.mc_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mc_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mc_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mc_drafts   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mc_sessions_auth" ON public.mc_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "mc_entries_auth"  ON public.mc_entries  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "mc_reviews_auth"  ON public.mc_reviews  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "mc_drafts_auth"   ON public.mc_drafts   FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS mc_sessions_month_idx    ON public.mc_sessions (count_month, warehouse_id, product_type);
CREATE INDEX IF NOT EXISTS mc_entries_session_idx   ON public.mc_entries  (session_id, role);
CREATE INDEX IF NOT EXISTS mc_entries_batch_idx     ON public.mc_entries  (batch_number);
CREATE INDEX IF NOT EXISTS mc_reviews_session_idx   ON public.mc_reviews  (session_id);
CREATE INDEX IF NOT EXISTS mc_drafts_user_idx       ON public.mc_drafts   (user_id, count_month, product_type, role);

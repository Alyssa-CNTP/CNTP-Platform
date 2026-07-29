-- ============================================================
-- CNTP Production Capture — saved per-user signature (draw once, reuse)
-- Run in: Supabase SQL Editor (staging first, then production)
-- Depends on: none
-- ============================================================
--
-- The Pasteuriser job card previously asked whoever had the page open to
-- hand-draw all four sign-off signatures every single time. The real flow
-- is sequential (Production Manager signs when generating/sending → Supervisor
-- signs on approval → Quality Officer signs once the batch is approved), and
-- each person should only ever draw their own signature ONCE — it's then
-- remembered and reused automatically on every future job card they sign.
-- One row per user; the signature is a base64 PNG data URL (same format
-- components/ui/SignaturePad already produces).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_signatures (
  user_id     uuid PRIMARY KEY,
  signature   text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS user_signatures_updated_at ON public.user_signatures;
CREATE TRIGGER user_signatures_updated_at
  BEFORE UPDATE ON public.user_signatures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_user_signatures" ON public.user_signatures;
CREATE POLICY "authenticated_all_user_signatures"
  ON public.user_signatures FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.user_signatures TO authenticated, service_role;

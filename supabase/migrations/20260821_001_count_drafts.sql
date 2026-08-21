-- ============================================================
-- Stock Count — per-user draft state (public.count_drafts)
-- Run in: Supabase SQL Editor — STAGING (qjqkpockmujecjgmdple) AND
--         PRODUCTION (sxzjjcyuzyfneesnsjna).
-- Depends on: nothing (auth.users only)
-- ============================================================
--
-- `lib/store/countStore.ts` has persisted the count screen's in-progress state
-- to `public.count_drafts` since it was written — the table itself was never in
-- this repo, so it only ever existed where somebody created it by hand. On the
-- production database it doesn't exist at all: every count draft load/save
-- 404s (`/rest/v1/count_drafts?select=state_json&...`), which the store
-- swallows (`catch { return null }` / `console.warn`), so a counter's work
-- silently lives in browser memory only and is gone on reload or device swap.
--
-- Shape is taken from the three calls the store actually makes:
--   • select state_json  where user_id = <me> and date = <today>  (maybeSingle)
--   • upsert  { user_id, date, role, state_json, updated_at }
--             onConflict 'user_id,date,role'      → needs that key unique
--   • delete  where user_id = <me> and date = <today>
--
-- One draft per person per day per role: the same person counts as Stock and as
-- Warehouse Supervisor on the same date (see countRoleLabel), and those two
-- drafts must not overwrite each other.
--
-- `role` is deliberately plain text with no CHECK — UserRole covers custom
-- roles (lib/auth/permissions.ts), and this column is only a partition key for
-- the draft, never an authorisation decision.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.count_drafts (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  role        text        NOT NULL,

  state_json  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, date, role)
);

-- The store reads by (user_id, date) without the role, so that prefix of the
-- primary key is what actually serves the read — no extra index needed.

GRANT ALL ON public.count_drafts TO authenticated, service_role;

-- A count draft is personal working state, not a shared record: unlike the rest
-- of the app's `USING (true)` policies, this one is scoped to its owner. Nothing
-- reads another person's draft (the submitted count is a separate record), and
-- the store only ever writes rows keyed on the signed-in user's own id.
ALTER TABLE public.count_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_count_drafts" ON public.count_drafts;
CREATE POLICY "own_count_drafts"
  ON public.count_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

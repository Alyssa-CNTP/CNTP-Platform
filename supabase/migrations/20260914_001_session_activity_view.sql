-- ============================================================
-- production.v_session_activity — what happened at the machine, per record.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- Then:   NOTIFY pgrst, 'reload schema';
-- Safe: creates a VIEW only. No table is altered, nothing is written.
-- ============================================================
--
-- ── Why a view and not two selects ──────────────────────────────────────────
--
-- History / Planning summed bags in and out by pulling prod_debagging and
-- prod_bagging into the browser and adding them up there. Over a 30-day range
-- that is ~2 000 rows of each, and PostgREST caps a response at 1 000 — so the
-- page got the OLDEST thousand and every recent record showed "0 bags in".
-- Silently, because a truncated response is a successful one.
--
-- It was also the wrong shape regardless: a read-only history screen has no
-- business shipping four thousand rows to a tablet to produce forty numbers.
-- One row per session is ~200 rows for a month, and the aggregation happens
-- where the data already is.
--
-- ── What counts ─────────────────────────────────────────────────────────────
--
-- INPUT is prod_debagging.kg_nett. Machine spillage is loss off the machine
-- rather than a bag that went in, so it is excluded from the BAG COUNT but its
-- weight still counts as input — the same split the capture screen and the
-- order page already make. Counting it as a bag would tell an operator they
-- debagged one more bag than they carried.
--
-- OUTPUT is prod_bagging.kg, one row per bag.
--
-- Deliberately NOT read from prod_mass_balance. That snapshot is a stored
-- total, and a stored total that disagrees with the rows under it is how the
-- order page came to read 91 036 kg in against 4 704 kg out. Everything here
-- is summed from the rows themselves.
--
-- Deleted sessions are left out: prod_sessions.deleted_at is the soft-delete
-- every other reader already filters on.
-- ============================================================

CREATE OR REPLACE VIEW production.v_session_activity AS
SELECT
  s.id                                                       AS session_id,
  s.section_id,
  s.date,
  s.shift,
  COALESCE(d.bags_in,  0)::int                                AS bags_in,
  ROUND(COALESCE(d.kg_in,  0)::numeric, 1)                    AS kg_in,
  COALESCE(b.bags_out, 0)::int                                AS bags_out,
  ROUND(COALESCE(b.kg_out, 0)::numeric, 1)                    AS kg_out
FROM production.prod_sessions s
LEFT JOIN (
  SELECT
    session_id,
    -- Spillage is loss off the machine, not a bag carried in.
    COUNT(*) FILTER (WHERE COALESCE(is_spillage, false) = false) AS bags_in,
    SUM(COALESCE(kg_nett, 0))                                    AS kg_in
  FROM production.prod_debagging
  GROUP BY session_id
) d ON d.session_id = s.id
LEFT JOIN (
  SELECT
    session_id,
    COUNT(*)                  AS bags_out,
    SUM(COALESCE(kg, 0))      AS kg_out
  FROM production.prod_bagging
  GROUP BY session_id
) b ON b.session_id = s.id
WHERE s.deleted_at IS NULL;

COMMENT ON VIEW production.v_session_activity IS
  'Bags and kg in/out per capture session, summed from prod_debagging and prod_bagging. Read by History / Planning so a month of records is ~200 rows instead of ~4 000, and so the aggregate is not silently truncated by PostgREST''s 1000-row cap. Spillage counts toward kg_in but not bags_in.';

-- The view inherits the underlying tables' RLS, so no policy is added here.
-- Both prod_debagging and prod_bagging already carry
-- "authenticated_all_*" FOR ALL TO authenticated.
GRANT SELECT ON production.v_session_activity TO authenticated, service_role;


-- ── Verify ──────────────────────────────────────────────────────────────────
--
-- Expect refining1 on 2026-09-11 to report 5 bags in / 1260.0 kg and
-- 3 bags out / 1248.0 kg. Before this view the page showed 0 bags in.

-- SELECT section_id, date, shift, bags_in, kg_in, bags_out, kg_out
-- FROM production.v_session_activity
-- WHERE date = '2026-09-11'
-- ORDER BY section_id, shift;

-- ⚠ THEN:  NOTIFY pgrst, 'reload schema';

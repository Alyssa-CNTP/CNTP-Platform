-- ============================================================
-- Set the database default timezone to SAST (South Africa Standard Time)
-- Run in: Supabase SQL Editor (staging first, then production)
-- ============================================================
--
-- CNTP is a South African company, so all timestamps should render in SAST
-- (Africa/Johannesburg, UTC+2, no daylight saving) by default.
--
-- IMPORTANT: this does NOT change stored data. timestamptz columns remain
-- absolute instants (UTC under the hood); this only changes how they are
-- RENDERED as text — in the Table Editor, raw SQL, and the Data API output —
-- which now defaults to SAST instead of UTC.
--
-- Takes effect on NEW connections. Existing pooled connections keep the old
-- timezone until they recycle (usually within a minute or two).
-- ============================================================

ALTER DATABASE postgres SET timezone TO 'Africa/Johannesburg';

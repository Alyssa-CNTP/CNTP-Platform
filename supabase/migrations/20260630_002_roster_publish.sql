-- Add status + published_at to roster_periods so the UI can distinguish
-- draft (being built) from published (sent to staff) rosters.

ALTER TABLE production.roster_periods
  ADD COLUMN IF NOT EXISTS status       text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE INDEX IF NOT EXISTS roster_periods_status_idx ON production.roster_periods (status);

COMMENT ON COLUMN production.roster_periods.status IS 'draft = being built; published = finalised and sent to staff';
COMMENT ON COLUMN production.roster_periods.published_at IS 'When this roster period was published (SAST)';

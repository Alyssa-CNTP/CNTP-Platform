-- ============================================================
-- CNTP Staff Directory — leave / availability
-- Run in: Supabase SQL Editor (staging first, then production).
-- Depends on: 20260623_001_staff_directory.sql
-- ============================================================
--
-- Date-ranged leave per employee. Anything that schedules people (Shift Roster,
-- Capture section assignment, later Maintenance duty) can check this to flag or
-- skip someone who is off, so a stand-in can be allocated instead.
-- ============================================================

CREATE TABLE IF NOT EXISTS production.employee_leave (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid        NOT NULL REFERENCES production.employees(id) ON DELETE CASCADE,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  kind        text        NOT NULL DEFAULT 'leave'   -- leave|sick|training|other
                CHECK (kind IN ('leave','sick','training','other')),
  reason      text,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS employee_leave_employee_idx
  ON production.employee_leave(employee_id);
CREATE INDEX IF NOT EXISTS employee_leave_dates_idx
  ON production.employee_leave(start_date, end_date);

DROP TRIGGER IF EXISTS employee_leave_updated_at ON production.employee_leave;
CREATE TRIGGER employee_leave_updated_at
  BEFORE UPDATE ON production.employee_leave
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE production.employee_leave ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_employee_leave" ON production.employee_leave;
CREATE POLICY "authenticated_all_employee_leave"
  ON production.employee_leave FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Convenience: employees on leave on a given day, with their operator link.
-- (Used to flag people in the roster / capture-assign pickers.)
CREATE OR REPLACE VIEW production.employee_leave_active AS
  SELECT l.employee_id, e.operator_id, l.start_date, l.end_date, l.kind, l.reason
  FROM production.employee_leave l
  JOIN production.employees e ON e.id = l.employee_id;

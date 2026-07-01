-- maintenance.tech_auth
-- Stores the synthetic Supabase auth email for each maintenance technician,
-- enabling PIN-based login that mirrors the floor-operator system.
-- Each row links a shared.app_roles user (department='Maintenance') to a
-- synthetic email address used exclusively for PIN authentication.

CREATE TABLE IF NOT EXISTS maintenance.tech_auth (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_email text        NOT NULL UNIQUE,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tech_auth_user_id_idx ON maintenance.tech_auth(user_id);
CREATE INDEX IF NOT EXISTS tech_auth_active_idx  ON maintenance.tech_auth(active) WHERE active = true;

-- Reuse the shared updated_at trigger function from production migrations.
DROP TRIGGER IF EXISTS tech_auth_updated_at ON maintenance.tech_auth;
CREATE TRIGGER tech_auth_updated_at
  BEFORE UPDATE ON maintenance.tech_auth
  FOR EACH ROW EXECUTE FUNCTION production.set_updated_at();

ALTER TABLE maintenance.tech_auth ENABLE ROW LEVEL SECURITY;

-- Maintenance managers + IT admins can read and manage tech auth rows.
-- Techs themselves cannot read this table — their auth_email is internal only.
DROP POLICY IF EXISTS "maintainer_manage_tech_auth" ON maintenance.tech_auth;
CREATE POLICY "maintainer_manage_tech_auth"
  ON maintenance.tech_auth FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shared.app_roles ar
      WHERE ar.user_id = auth.uid()
        AND (
          ar.role IN ('maintenance_manager', 'it_admin', 'system_admin')
          OR ar.department = 'IT'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shared.app_roles ar
      WHERE ar.user_id = auth.uid()
        AND (
          ar.role IN ('maintenance_manager', 'it_admin', 'system_admin')
          OR ar.department = 'IT'
        )
    )
  );

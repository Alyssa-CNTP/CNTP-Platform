-- ============================================================
-- Bucket 2 — additive column promotion: STAGING -> PRODUCTION
-- Adds staging-only columns onto existing prod tables (production / axis / shared / workspace).
-- ALL columns NULLABLE; only safe constant/standard defaults retained.
-- No data is overwritten; existing prod rows keep their values (new cols = NULL/default).
-- Applied inside a single transaction alongside the missing-table CREATEs.
-- ============================================================

-- axis.audit_log
ALTER TABLE axis.audit_log ADD COLUMN IF NOT EXISTS event_type text DEFAULT 'change'::text;

-- axis.comments
ALTER TABLE axis.comments ADD COLUMN IF NOT EXISTS reference_id uuid;
ALTER TABLE axis.comments ADD COLUMN IF NOT EXISTS table_name text;

-- axis.change_log_edits
ALTER TABLE axis.change_log_edits ADD COLUMN IF NOT EXISTS log_id uuid;
ALTER TABLE axis.change_log_edits ADD COLUMN IF NOT EXISTS author_id uuid;
ALTER TABLE axis.change_log_edits ADD COLUMN IF NOT EXISTS before jsonb;
ALTER TABLE axis.change_log_edits ADD COLUMN IF NOT EXISTS after jsonb;
ALTER TABLE axis.change_log_edits ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

-- axis.github_events
ALTER TABLE axis.github_events ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE axis.github_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

-- axis.project_assignees
ALTER TABLE axis.project_assignees ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

-- axis.system_documents
ALTER TABLE axis.system_documents ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE axis.system_documents ADD COLUMN IF NOT EXISTS author_id uuid;
ALTER TABLE axis.system_documents ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- axis.tickets
ALTER TABLE axis.tickets ADD COLUMN IF NOT EXISTS submitted_by uuid;
ALTER TABLE axis.tickets ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE axis.tickets ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone;

-- production.bag_tags
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS qc_initials text;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS qc_signed_at timestamp with time zone;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS printed_at timestamp with time zone;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS consumed boolean DEFAULT false;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS consumed_at timestamp with time zone;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE production.bag_tags ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

-- production.inventory_items
ALTER TABLE production.inventory_items ADD COLUMN IF NOT EXISTS category_code text;
ALTER TABLE production.inventory_items ADD COLUMN IF NOT EXISTS grade text;
ALTER TABLE production.inventory_items ADD COLUMN IF NOT EXISTS qc_grade text;
ALTER TABLE production.inventory_items ADD COLUMN IF NOT EXISTS base_unit text;
ALTER TABLE production.inventory_items ADD COLUMN IF NOT EXISTS item_status text;
ALTER TABLE production.inventory_items ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

-- production.operators
ALTER TABLE production.operators ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE production.operators ADD COLUMN IF NOT EXISTS auth_email text;

-- production.prod_bagging
ALTER TABLE production.prod_bagging ADD COLUMN IF NOT EXISTS bag_no integer;
ALTER TABLE production.prod_bagging ADD COLUMN IF NOT EXISTS acumatica_id text;

-- production.prod_debagging
ALTER TABLE production.prod_debagging ADD COLUMN IF NOT EXISTS bag_no integer;
ALTER TABLE production.prod_debagging ADD COLUMN IF NOT EXISTS acumatica_id text;
ALTER TABLE production.prod_debagging ADD COLUMN IF NOT EXISTS local_or_export text;
ALTER TABLE production.prod_debagging ADD COLUMN IF NOT EXISTS org_or_conv text;
ALTER TABLE production.prod_debagging ADD COLUMN IF NOT EXISTS is_spillage boolean DEFAULT false;

-- production.prod_mass_balance
ALTER TABLE production.prod_mass_balance ADD COLUMN IF NOT EXISTS water_kg numeric DEFAULT 0;
ALTER TABLE production.prod_mass_balance ADD COLUMN IF NOT EXISTS dust_extraction_kg numeric DEFAULT 0;
ALTER TABLE production.prod_mass_balance ADD COLUMN IF NOT EXISTS floor_waste_kg numeric DEFAULT 0;

-- production.prod_sessions
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS variant text;
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS section_config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS scale_std_kg numeric;
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS scale_actual_kg numeric;
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS op_signed_at timestamp with time zone;
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS sup_signed_at timestamp with time zone;
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS draft_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE production.prod_sessions ADD COLUMN IF NOT EXISTS created_by uuid;

-- production.scan_events
ALTER TABLE production.scan_events ADD COLUMN IF NOT EXISTS notes text;

-- shared.app_roles
ALTER TABLE shared.app_roles ADD COLUMN IF NOT EXISTS view_departments text[] DEFAULT '{}'::text[];
ALTER TABLE shared.app_roles ADD COLUMN IF NOT EXISTS phone text;

-- workspace.pulse_notes
ALTER TABLE workspace.pulse_notes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

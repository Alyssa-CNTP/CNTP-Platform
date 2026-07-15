// lib/auth/permissions.ts
//
// Single source of truth for the entire CNTP platform permission system.
//
// STRUCTURE:
//   Department → Role → Permission defaults
//
// RULES:
//   1. Every user belongs to one department and has one role within it
//   2. The role sets the permission DEFAULTS (what they get out of the box)
//   3. The permissions column in app_roles stores OVERRIDES only (sparse object)
//   4. Empty {} permissions = pure role defaults apply
//   5. Only IT department users can create users
//   6. Managers (any dept) can edit permissions for users in their own department
//   7. New roles can be created on the fly — just add to DEPARTMENT_ROLES below

// ─── All permission keys ──────────────────────────────────────────────────────

export type PermissionKey =
  // Quality — Records
  | 'can_upload_pdfs'
  | 'can_save_records'
  | 'can_edit_records'
  | 'can_delete_records'
  | 'can_view_history'
  | 'can_export_csv'
  // Quality — Lab Results
  | 'can_save_lab_results'
  | 'can_delete_lab_results'
  | 'can_edit_lab_comments'
  // Quality — Specifications
  | 'can_edit_customer_specs'
  | 'can_delete_specs'
  | 'can_edit_sieve_specs'
  | 'can_edit_granule_specs'
  // Quality — Runs
  | 'can_create_runs'
  | 'can_edit_runs'
  | 'can_finalise_runs'
  | 'can_reopen_runs'
  | 'can_delete_runs'
  | 'can_add_samples'
  | 'can_edit_samples'
  | 'can_add_tastings'
  | 'can_edit_tastings'
  | 'can_approve_runs'
  | 'can_signoff_day'
  // Quality — Sieving
  | 'can_add_sieving_runs'
  | 'can_delete_sieving_runs'
  | 'can_edit_sieving_specs'
  // Production — Ops
  | 'can_submit_count'
  | 'can_edit_count'
  | 'can_view_all_sections'
  | 'can_view_ops_dashboard'
  // Production — Live Capture
  | 'can_start_live_session'
  | 'can_scan_inputs'
  | 'can_add_outputs'
  | 'can_reset_operator_pin'
  | 'can_view_live_history'
  | 'can_approve_session'
  | 'can_edit_session'
  | 'can_delete_session'
  | 'can_edit_bag_tag'
  | 'can_delete_bag_tag'
  // Production — Master Inventory & Blends (BOM)
  | 'can_view_inventory'
  | 'can_edit_inventory'
  | 'can_delete_inventory'
  | 'can_view_blends'
  | 'can_edit_blends'
  | 'can_delete_blends'
  // Sales & Marketing
  | 'can_access_sales'
  | 'can_access_marketing'
  | 'can_access_research'
  | 'can_access_intelligence'
  // Management & Reporting
  | 'can_view_management'
  | 'can_view_reports'
  | 'can_export_reports'
  // User Administration
  | 'can_manage_users'
  | 'can_reset_passwords'
  | 'can_change_roles'
  | 'can_edit_permissions'
  | 'can_invite_users'
  | 'can_confirm_emails'
  // System & Developer
  | 'can_view_audit_log'
  | 'can_run_migrations'
  | 'can_access_dev_tools'
  | 'can_manage_integrations'
  // Ticketing & Workspace
  | 'can_assign_tickets'
  | 'can_access_workspace'
  // Logistics
  | 'can_access_logistics'
  // Maintenance
  | 'can_access_maintenance'
  | 'can_raise_breakdown'
  | 'can_raise_planned'
  | 'can_allocate_jobs'
  | 'can_qc_jobs'
  | 'can_verify_jobs'
  // Staff & Competency
  | 'can_access_hr'            // gate for the whole HR section (Staff & Skills, SOP, Skills Matrix)
  | 'can_view_staff'           // directory + profiles + matrix (read-only)
  | 'can_edit_staff_profiles'  // edit profile fields, leave, skills
  | 'can_manage_competencies'  // record / assess employee × SOP competencies
  | 'can_manage_sop_catalog'   // add / edit / retire SOPs in the catalogue
  | 'can_allocate_staff'       // Phase 2 — allocate staff & override competency warnings
  | 'can_delete_staff'         // Delete staff records
  // Training — courses, lessons, assessments (feeds employee_competencies)
  | 'can_author_training'      // create/edit courses, lessons, assessments, SOP mapping
  | 'can_assign_training'      // assign courses to staff, set due dates
  | 'can_view_all_competency'  // cross-department competency dashboard (HR view)
  // Shift Roster — one global view + submit/edit/delete per roster section.
  // Section keys match ROSTER_CATEGORIES in lib/production/roster-config.ts.
  | 'can_view_roster'          // view ALL roster sections (read-only baseline)
  | 'can_edit_roster_production'   | 'can_submit_roster_production'   | 'can_delete_roster_production'
  | 'can_edit_roster_store'        | 'can_submit_roster_store'        | 'can_delete_roster_store'
  | 'can_edit_roster_qc'           | 'can_submit_roster_qc'           | 'can_delete_roster_qc'
  | 'can_edit_roster_cleaning'     | 'can_submit_roster_cleaning'     | 'can_delete_roster_cleaning'
  | 'can_edit_roster_maintenance'  | 'can_submit_roster_maintenance'  | 'can_delete_roster_maintenance'
  | 'can_edit_roster_hs'           | 'can_submit_roster_hs'           | 'can_delete_roster_hs'

export type Permissions = Partial<Record<PermissionKey, boolean>>

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  'can_upload_pdfs','can_save_records','can_edit_records','can_delete_records',
  'can_view_history','can_export_csv','can_save_lab_results','can_delete_lab_results',
  'can_edit_lab_comments','can_edit_customer_specs','can_delete_specs','can_edit_sieve_specs',
  'can_edit_granule_specs','can_create_runs','can_edit_runs','can_finalise_runs',
  'can_reopen_runs','can_delete_runs','can_add_samples','can_edit_samples',
  'can_add_tastings','can_edit_tastings','can_approve_runs','can_signoff_day',
  'can_add_sieving_runs','can_delete_sieving_runs',
  'can_edit_sieving_specs','can_submit_count','can_edit_count','can_view_all_sections',
  'can_view_ops_dashboard',
  'can_start_live_session','can_scan_inputs','can_add_outputs','can_reset_operator_pin',
  'can_view_live_history','can_approve_session',
  'can_edit_session','can_delete_session','can_edit_bag_tag','can_delete_bag_tag',
  'can_view_inventory','can_edit_inventory','can_delete_inventory',
  'can_view_blends','can_edit_blends','can_delete_blends',
  'can_access_sales','can_access_marketing','can_access_research','can_access_intelligence',
  'can_view_management','can_view_reports','can_export_reports','can_manage_users',
  'can_reset_passwords','can_change_roles','can_edit_permissions','can_invite_users',
  'can_confirm_emails','can_view_audit_log','can_run_migrations','can_access_dev_tools',
  'can_manage_integrations',
  'can_assign_tickets', 'can_access_workspace',
  'can_access_logistics',
  'can_access_maintenance',
  'can_raise_breakdown','can_raise_planned','can_allocate_jobs','can_qc_jobs','can_verify_jobs',
  'can_access_hr',
  'can_view_staff','can_edit_staff_profiles','can_manage_competencies',
  'can_manage_sop_catalog','can_allocate_staff','can_delete_staff',
  'can_author_training','can_assign_training','can_view_all_competency',
  'can_view_roster',
  'can_edit_roster_production','can_submit_roster_production','can_delete_roster_production',
  'can_edit_roster_store','can_submit_roster_store','can_delete_roster_store',
  'can_edit_roster_qc','can_submit_roster_qc','can_delete_roster_qc',
  'can_edit_roster_cleaning','can_submit_roster_cleaning','can_delete_roster_cleaning',
  'can_edit_roster_maintenance','can_submit_roster_maintenance','can_delete_roster_maintenance',
  'can_edit_roster_hs','can_submit_roster_hs','can_delete_roster_hs',
]

// Roster section keys (match ROSTER_CATEGORIES in lib/production/roster-config.ts).
// Kept here so the roster UI, cron and recipient resolver share one list.
export const ROSTER_SECTION_KEYS = ['production','store','qc','cleaning','maintenance','hs'] as const
export type RosterSectionKey = typeof ROSTER_SECTION_KEYS[number]

export const ROSTER_SECTION_LABEL: Record<RosterSectionKey, string> = {
  production: 'Production', store: 'Store', qc: 'Quality',
  cleaning: 'Cleaning', maintenance: 'Maintenance', hs: 'Health & Safety',
}

export const rosterPerm = (
  action: 'edit' | 'submit' | 'delete',
  section: RosterSectionKey,
): PermissionKey => `can_${action}_roster_${section}` as PermissionKey

// ─── Departments ──────────────────────────────────────────────────────────────

export type Department =
  | 'IT'
  | 'Quality'
  | 'Production'
  | 'Maintenance'
  | 'Management'
  | 'Sales'
  | 'Marketing'
  | 'Store'
  | 'Health & Safety'
  | 'HR'

export const ALL_DEPARTMENTS: Department[] = [
  'IT', 'Quality', 'Production', 'Maintenance', 'Management', 'Sales', 'Marketing', 'Store', 'Health & Safety', 'HR',
]

export const DEPARTMENT_META: Record<Department, { label: string; desc: string; color: string }> = {
  IT:                { label: 'IT',              desc: 'Technology, infrastructure & development', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  Quality:           { label: 'Quality',         desc: 'QMS, lab results, sieving, pasteuriser, granule', color: 'bg-ok/10 text-ok border-ok/20' },
  Production:        { label: 'Production',      desc: 'Operations, morning count, floor production', color: 'bg-warn/10 text-warn border-warn/20' },
  Maintenance:       { label: 'Maintenance',     desc: 'Job cards, breakdowns, scheduled maintenance & spares', color: 'bg-azure/10 text-azure border-azure/20' },
  Management:        { label: 'Management',      desc: 'Directors, analysts — read-only across platform', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  Sales:             { label: 'Sales',           desc: 'Sales module & research engine', color: 'bg-brand/10 text-brand border-brand/20' },
  Marketing:         { label: 'Marketing',       desc: 'Marketing module', color: 'bg-pink-50 text-pink-700 border-pink-200' },
  Store:             { label: 'Store',           desc: 'Warehouse, forklift, stock movement & dispatch', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  'Health & Safety': { label: 'Health & Safety', desc: 'H&S reps, incident response, fire & first aid', color: 'bg-red-50 text-red-700 border-red-200' },
  HR:                { label: 'HR',              desc: 'Training, competency & staff development across every department', color: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
}

// ─── Roles per department ─────────────────────────────────────────────────────
// These are the DEFAULT roles. New roles can be added in the database on the fly.
// Any role not listed here gets zero permissions by default (all toggles off).

export type ITRole         = 'senior_developer' | 'co_developer' | 'it_admin'
export type QualityRole    = string   // flexible — add roles as needed
export type ProductionRole = string   // flexible — add roles as needed
export type ManagementRole = string
export type SalesRole      = string
export type MarketingRole  = string

export type UserRole = ITRole | string   // string covers custom roles

export const DEPARTMENT_ROLES: Record<Department, { role: string; label: string; desc: string }[]> = {
  IT: [
    { role: 'senior_developer', label: 'Senior Developer', desc: 'Full access to everything — 45/45 permissions' },
    { role: 'co_developer',     label: 'Co-Developer',     desc: 'Full access except destructive ops & migrations' },
    { role: 'it_admin',         label: 'IT Admin',         desc: 'User management only — no data or dev access' },
  ],
  Quality: [
    { role: 'quality_default',       label: 'Quality (Default)',    desc: 'All permissions off — toggle on what they need' },
    { role: 'quality_lab_assistant', label: 'Lab Assistant',        desc: 'PIN-based tablet access — capture runs, samples, tastings, sieving' },
    { role: 'lab_manager',           label: 'Lab Manager',          desc: 'Approves runs and signs off daily overviews' },
    { role: 'quality_manager',       label: 'Quality Manager',      desc: 'Full quality access plus specs and deletes' },
  ],
  Production: [
    { role: 'production_default',    label: 'Production (Default)',     desc: 'All permissions off' },
    { role: 'floor_operator',        label: 'Floor Operator',           desc: 'PIN-based tablet access only — no system login' },
    { role: 'production_supervisor', label: 'Production Supervisor',    desc: 'Manages production floor, approves sessions, resets PINs' },
    { role: 'warehouse_supervisor',  label: 'Warehouse Supervisor',     desc: 'Stock counts (warehouse side) + live capture history' },
    { role: 'stock_controller',      label: 'Stock Controller',         desc: 'Stock counts (stock side)' },
  ],
  Maintenance: [
    { role: 'maintenance_default',    label: 'Maintenance (Default)',    desc: 'All permissions off — toggle on what they need' },
    { role: 'maintenance_manager',    label: 'Maintenance Manager',      desc: 'Allocates job cards, verifies completed work, raises planned & breakdown cards' },
    { role: 'maintenance_technician', label: 'Maintenance Technician',   desc: 'Receives & executes assigned job cards' },
    { role: 'maintenance_qc',         label: 'Maintenance QC',           desc: 'Performs post-maintenance QC checks' },
  ],
  Management: [
    { role: 'management_default', label: 'Management (Default)', desc: 'Read-only across all modules — view quality, production, maintenance, reports. Toggle write/delete on per person if needed.' },
  ],
  Sales: [
    { role: 'sales_default',    label: 'Sales (Default)',    desc: 'All permissions off — toggle on what they need' },
  ],
  Marketing: [
    { role: 'marketing_default',label: 'Marketing (Default)',desc: 'All permissions off — toggle on what they need' },
  ],
  Store: [
    { role: 'store_default',    label: 'Store (Default)',    desc: 'All permissions off — toggle on what they need' },
    { role: 'store_supervisor', label: 'Store Supervisor',   desc: 'Owns the Store roster section — edits & submits it' },
  ],
  'Health & Safety': [
    { role: 'hs_default',       label: 'H&S (Default)',      desc: 'All permissions off — toggle on what they need' },
    { role: 'hs_officer',       label: 'H&S Officer',        desc: 'Owns the H&S + Cleaning roster sections — edits & submits them' },
  ],
  HR: [
    { role: 'hr_default',       label: 'HR (Default)',       desc: 'All permissions off — toggle on what they need' },
    { role: 'training_officer', label: 'Training Officer',   desc: 'Authors courses & assessments, assigns training, reviews manual-graded attempts' },
    { role: 'hr_manager',       label: 'HR Manager',         desc: 'Training Officer + edits staff profiles + org-wide competency dashboard' },
  ],
}

// ─── Role permission defaults ─────────────────────────────────────────────────
// Permissions are explicit — roles only get what their job requires.
// Cross-department access is granted deliberately per person in the Users page.
// Blank-slate roles (_default) and floor_operator start at zero.
// When a role has no entry here, all permissions default to false.

const ALL_ON: Permissions = Object.fromEntries(
  ALL_PERMISSION_KEYS.map(k => [k, true])
) as Permissions

export const ROLE_PERMISSION_DEFAULTS: Record<string, Permissions> = {

  // ── IT — Senior Developer: everything ──────────────────────────────────────
  senior_developer: { ...ALL_ON },

  // ── Legacy role aliases (for existing Supabase users) ─────────────────────
  admin:            { ...ALL_ON },           // maps to senior_developer
  supervisor:       {                        // maps to production_supervisor
    can_submit_count: true, can_edit_count: true,
    can_view_all_sections: true, can_view_ops_dashboard: true,
    can_start_live_session: true, can_scan_inputs: true,
    can_add_outputs: true, can_reset_operator_pin: true,
    can_approve_session: true, can_export_csv: true,
    can_edit_session: true, can_delete_session: true,
    can_edit_bag_tag: true, can_delete_bag_tag: true,
  },
  operator:         {                        // maps to warehouse_supervisor
    can_submit_count: true, can_view_ops_dashboard: true,
    can_view_live_history: true,
  },
  section_operator: { can_submit_count: true, can_view_ops_dashboard: true },

  // ── Production roles ───────────────────────────────────────────────────────
  floor_operator: {},   // no system permissions — PIN only

  production_supervisor: {
    // Factory floor — runs production capture & sign-off. Does NOT do stock counts.
    can_view_all_sections: true, can_view_ops_dashboard: true,
    can_start_live_session: true, can_scan_inputs: true,
    can_add_outputs: true, can_reset_operator_pin: true,
    can_approve_session: true, can_export_csv: true,
    can_edit_session: true, can_delete_session: true,
    can_edit_bag_tag: true, can_delete_bag_tag: true,
    // Master Inventory & Blends (BOM) — supervisors keep these current
    can_view_inventory: true, can_edit_inventory: true,
    can_view_blends: true, can_edit_blends: true,
    // Staff & Competency
    can_access_hr: true, can_view_staff: true, can_edit_staff_profiles: true,
    can_manage_competencies: true, can_allocate_staff: true,
    can_delete_staff: true,
    // Training — can author/assign courses for their own floor sections
    can_author_training: true, can_assign_training: true,
    // Shift roster — owns Production + Maintenance sections
    can_view_roster: true,
    can_edit_roster_production: true, can_submit_roster_production: true, can_delete_roster_production: true,
    can_edit_roster_maintenance: true, can_submit_roster_maintenance: true,
  },

  // ── Store — owns the Store roster section ──────────────────────────────────
  store_supervisor: {
    can_view_roster: true,
    can_edit_roster_store: true, can_submit_roster_store: true, can_delete_roster_store: true,
  },

  // ── Health & Safety — owns H&S + Cleaning roster sections ──────────────────
  hs_officer: {
    can_view_roster: true,
    can_edit_roster_hs: true, can_submit_roster_hs: true, can_delete_roster_hs: true,
    can_edit_roster_cleaning: true, can_submit_roster_cleaning: true,
  },

  // ── HR — authors & assigns training, owns the org-wide competency view ─────
  training_officer: {
    can_access_hr: true, can_view_staff: true, can_manage_competencies: true,
    can_author_training: true, can_assign_training: true, can_view_all_competency: true,
  },
  hr_manager: {
    can_access_hr: true, can_view_staff: true, can_edit_staff_profiles: true, can_manage_competencies: true,
    can_author_training: true, can_assign_training: true, can_view_all_competency: true,
  },

  warehouse_supervisor: {
    // One of the two stock counters (the "Warehouse Supervisor" count side).
    can_submit_count: true, can_view_ops_dashboard: true,
    can_view_live_history: true,
  },

  stock_controller: {
    // The second stock counter (the "Stock" count side).
    can_submit_count: true, can_view_ops_dashboard: true,
    can_view_live_history: true,
  },

  // ── Maintenance roles ──────────────────────────────────────────────────────
  maintenance_manager: {
    can_allocate_jobs: true, can_verify_jobs: true,
    can_raise_planned: true, can_raise_breakdown: true,
    can_assign_tickets: true,
    // Staff & Competency (assesses maintenance WIs)
    can_access_hr: true, can_view_staff: true, can_manage_competencies: true,
  },
  maintenance_technician: {
    can_raise_planned: true,
  },
  maintenance_qc: {
    can_qc_jobs: true,
  },

  // ── IT — Co-Developer: everything except destructive system ops ────────────
  co_developer: Object.fromEntries(
    ALL_PERMISSION_KEYS
      .filter(k => !['can_run_migrations', 'can_manage_integrations', 'can_manage_users'].includes(k))
      .map(k => [k, true])
  ) as Permissions,

  // ── IT — IT Admin: user management only ────────────────────────────────────
  it_admin: {
    can_manage_users:   true,
    can_reset_passwords:true,
    can_change_roles:   true,
    can_edit_permissions:true,
    can_invite_users:   true,
    can_confirm_emails: true,
    can_view_audit_log: true,
  },

  // ── Quality — Lab Assistant: PIN-based capture only ───────────────────────
  quality_lab_assistant: {
    can_save_records:     true,
    can_create_runs:      true,
    can_add_samples:      true,
    can_add_tastings:     true,
    can_add_sieving_runs: true,
  },

  // ── Quality — Lab Manager: captures + approves runs and signs off days ─────
  lab_manager: {
    can_view_history: true, can_export_csv: true,
    can_create_runs: true, can_edit_runs: true, can_finalise_runs: true,
    can_reopen_runs: true, can_add_samples: true, can_edit_samples: true,
    can_add_tastings: true, can_edit_tastings: true,
    can_add_sieving_runs: true,
    can_approve_runs: true, can_signoff_day: true,
    // Staff & Competency (assesses lab staff against lab SOPs)
    can_access_hr: true, can_view_staff: true, can_manage_competencies: true,
  },

  // ── Quality — Quality Manager: Lab Manager + specs + deletes ───────────────
  quality_manager: {
    can_save_records: true, can_edit_records: true, can_delete_records: true,
    can_view_history: true, can_export_csv: true,
    can_edit_customer_specs: true, can_delete_specs: true,
    can_edit_sieve_specs: true, can_edit_granule_specs: true,
    can_create_runs: true, can_edit_runs: true, can_finalise_runs: true,
    can_reopen_runs: true, can_delete_runs: true,
    can_add_samples: true, can_edit_samples: true,
    can_add_tastings: true, can_edit_tastings: true,
    can_add_sieving_runs: true, can_delete_sieving_runs: true,
    can_approve_runs: true, can_signoff_day: true,
    // Staff & Competency (FSSC owner — manages SOP catalogue + assesses)
    can_access_hr: true, can_view_staff: true, can_edit_staff_profiles: true,
    can_manage_competencies: true, can_manage_sop_catalog: true,
    can_delete_staff: true,
    // Training (FSSC owner — also authors/assigns courses + sees org-wide competency)
    can_author_training: true, can_assign_training: true, can_view_all_competency: true,
  },

  // ── Management — read-only across platform ─────────────────────────────────
  // Directors and analysts get view access to every module by default.
  // Write, delete, and admin actions remain off — toggle those on per person.
  management_default: {
    // Quality (view + export, no write/delete)
    can_view_history: true,
    can_export_csv:   true,
    // Production (view only)
    can_view_ops_dashboard: true,
    can_view_all_sections:  true,
    can_view_live_history:  true,
    can_view_inventory: true, can_view_blends: true,
    // Maintenance (view module — no job-card actions)
    can_access_maintenance: true,
    // Management & Reporting
    can_view_management: true,
    can_view_reports:    true,
    can_export_reports:  true,
    // Staff directory (read-only)
    can_access_hr: true, can_view_staff: true,
    // Training — cross-department competency view (read-only)
    can_view_all_competency: true,
    // Shift roster (read-only, all sections)
    can_view_roster: true,
  },

  // ── All other roles: zero defaults — toggle on per person ──────────────────
  // Any role string not listed here resolves to all-false.
}

// ─── Core resolver ────────────────────────────────────────────────────────────

export function resolvePermission(
  role:        string | null,
  overrides:   Permissions,
  key:         PermissionKey
): boolean {
  // Explicit override always wins
  if (key in overrides) return overrides[key] === true
  // Role default
  if (!role) return false
  return ROLE_PERMISSION_DEFAULTS[role]?.[key] === true
}

export function resolveAllPermissions(
  role:      string | null,
  overrides: Permissions
): Record<PermissionKey, boolean> {
  return Object.fromEntries(
    ALL_PERMISSION_KEYS.map(k => [k, resolvePermission(role, overrides, k)])
  ) as Record<PermissionKey, boolean>
}

// ─── Permission groups (for the toggle UI) ────────────────────────────────────

export const PERMISSION_GROUPS: {
  group:       string
  department?: Department   // if set, only show this group when relevant dept is selected
  permissions: { key: PermissionKey; label: string }[]
}[] = [
  {
    group: 'Quality — Records',
    department: 'Quality',
    permissions: [
      { key: 'can_upload_pdfs',    label: 'Upload PDFs & trigger AI extraction' },
      { key: 'can_save_records',   label: 'Save quality records' },
      { key: 'can_edit_records',   label: 'Edit existing quality records' },
      { key: 'can_delete_records', label: 'Delete quality records' },
      { key: 'can_view_history',   label: 'View quality pages & records (required for cross-department access)' },
      { key: 'can_export_csv',     label: 'Export data to CSV' },
    ],
  },
  {
    group: 'Quality — Lab Results',
    department: 'Quality',
    permissions: [
      { key: 'can_save_lab_results',   label: 'Save lab results' },
      { key: 'can_delete_lab_results', label: 'Delete lab results' },
      { key: 'can_edit_lab_comments',  label: 'Edit comments on lab results' },
    ],
  },
  {
    group: 'Quality — Specifications',
    department: 'Quality',
    permissions: [
      { key: 'can_edit_customer_specs', label: 'Edit customer specifications' },
      { key: 'can_delete_specs',        label: 'Delete specification rows' },
      { key: 'can_edit_sieve_specs',    label: 'Edit sieving specs & overrides' },
      { key: 'can_edit_granule_specs',  label: 'Edit granule line specifications' },
    ],
  },
  {
    group: 'Quality — Runs',
    department: 'Quality',
    permissions: [
      { key: 'can_create_runs',   label: 'Create new runs' },
      { key: 'can_edit_runs',     label: 'Edit run details & batch numbers' },
      { key: 'can_finalise_runs', label: 'Finalise runs (Pass / Fail)' },
      { key: 'can_reopen_runs',   label: 'Re-open finalised runs' },
      { key: 'can_delete_runs',   label: 'Delete runs' },
      { key: 'can_add_samples',   label: 'Add samples to active runs' },
      { key: 'can_edit_samples',  label: 'Edit existing samples' },
      { key: 'can_add_tastings',  label: 'Record tasting sessions' },
      { key: 'can_edit_tastings', label: 'Edit tasting records' },
      { key: 'can_approve_runs',  label: 'Approve allocated runs (Lab Manager pass/fail)' },
      { key: 'can_signoff_day',   label: 'Sign off daily station overviews' },
    ],
  },
  {
    group: 'Quality — Sieving',
    department: 'Quality',
    permissions: [
      { key: 'can_add_sieving_runs',    label: 'Add new sieving runs' },
      { key: 'can_delete_sieving_runs', label: 'Delete sieving runs' },
      { key: 'can_edit_sieving_specs',  label: 'Edit sieving specs' },
    ],
  },
  {
    group: 'Production & Operations',
    department: 'Production',
    permissions: [
      { key: 'can_submit_count',       label: 'Submit morning production count' },
      { key: 'can_edit_count',         label: 'Edit a submitted count' },
      { key: 'can_view_all_sections',  label: 'View all sections (not just own)' },
      { key: 'can_view_ops_dashboard', label: 'View ops dashboard' },
    ],
  },
  {
    group: 'Production — Live Capture',
    department: 'Production',
    permissions: [
      { key: 'can_start_live_session',  label: 'Start a live capture session' },
      { key: 'can_scan_inputs',         label: 'Scan bags in' },
      { key: 'can_add_outputs',         label: 'Add output bags & print labels' },
      { key: 'can_reset_operator_pin',  label: 'Reset operator PIN (notifies Management)' },
      { key: 'can_view_live_history',   label: 'View live capture session history' },
      { key: 'can_approve_session',     label: 'Approve and lock a session' },
      { key: 'can_edit_session',        label: 'Edit production session records' },
      { key: 'can_delete_session',      label: 'Delete production session records' },
      { key: 'can_edit_bag_tag',        label: 'Edit bag tag records' },
      { key: 'can_delete_bag_tag',      label: 'Delete bag tag records' },
    ],
  },
  {
    group: 'Production — Master Inventory & Blends',
    department: 'Production',
    permissions: [
      { key: 'can_view_inventory',   label: 'View Master Inventory' },
      { key: 'can_edit_inventory',   label: 'Add & edit inventory items' },
      { key: 'can_delete_inventory', label: 'Deactivate inventory items' },
      { key: 'can_view_blends',      label: 'View Blends (BOM) page' },
      { key: 'can_edit_blends',      label: 'Add & edit blends and their components' },
      { key: 'can_delete_blends',    label: 'Delete blends and components' },
    ],
  },
  {
    group: 'Sales',
    department: 'Sales',
    permissions: [
      { key: 'can_access_sales',    label: 'Access sales module' },
      { key: 'can_access_research', label: 'Access research engine' },
      { key: 'can_export_csv',      label: 'Export data to CSV' },
    ],
  },
  {
    group: 'Marketing',
    department: 'Marketing',
    permissions: [
      { key: 'can_access_marketing', label: 'Access marketing module' },
      { key: 'can_access_sales',     label: 'View sales (read-only)' },
    ],
  },
  {
    group: 'Management & Reporting',
    department: 'Management',
    permissions: [
      { key: 'can_view_management', label: 'View management dashboard' },
      { key: 'can_view_reports',    label: 'View reports & analytics' },
      { key: 'can_export_reports',  label: 'Export management reports' },
      { key: 'can_view_history',    label: 'View historical data' },
      { key: 'can_export_csv',      label: 'Export data to CSV' },
    ],
  },
  {
    group: 'User Administration',
    // IT dept only in practice, but visible for all (grayed if not IT)
    permissions: [
      { key: 'can_manage_users',    label: 'Create & delete users' },
      { key: 'can_reset_passwords', label: 'Reset other users\' passwords' },
      { key: 'can_change_roles',    label: 'Change a user\'s role' },
      { key: 'can_edit_permissions',label: 'Edit user permission toggles' },
      { key: 'can_invite_users',    label: 'Send email invitations' },
      { key: 'can_confirm_emails',  label: 'Manually confirm user emails' },
    ],
  },
  {
    group: 'System & Developer',
    department: 'IT',
    permissions: [
      { key: 'can_view_audit_log',      label: 'View audit log' },
      { key: 'can_run_migrations',      label: 'Run data migrations' },
      { key: 'can_access_dev_tools',    label: 'Access developer tools' },
      { key: 'can_manage_integrations', label: 'Manage integrations' },
    ],
  },
  {
    group: 'Ticketing & Workspace',
    permissions: [
      { key: 'can_assign_tickets',   label: 'Assign tickets to users (manager role)' },
      { key: 'can_access_workspace', label: 'Access personal workspace board' },
    ],
  },
  {
    group: 'Logistics',
    // No single department — Production/Quality/Management get it by department;
    // this permission grants it to anyone else.
    permissions: [
      { key: 'can_access_logistics', label: 'Access the Logistics module (grant to other departments)' },
    ],
  },
  {
    group: 'Maintenance',
    department: 'Maintenance',
    permissions: [
      { key: 'can_access_maintenance', label: 'Access the Maintenance module (grant to other departments)' },
      { key: 'can_raise_breakdown', label: 'Raise urgent breakdown job cards' },
      { key: 'can_raise_planned',   label: 'Raise planned / scheduled job cards' },
      { key: 'can_allocate_jobs',   label: 'Allocate job cards to technicians' },
      { key: 'can_qc_jobs',         label: 'Perform post-maintenance QC checks' },
      { key: 'can_verify_jobs',     label: 'Verify completed work / bounce back' },
    ],
  },
  {
    group: 'Staff & Competency',
    // No single department — visible across all roles (grayed if not applicable)
    permissions: [
      { key: 'can_access_hr',           label: 'Access the HR section (Staff & Skills, SOP, Skills Matrix)' },
      { key: 'can_view_staff',          label: 'View staff directory, profiles & competency matrix' },
      { key: 'can_edit_staff_profiles', label: 'Edit staff profiles, leave & skills/certifications' },
      { key: 'can_manage_competencies', label: 'Record, update & assess staff competencies against SOPs' },
      { key: 'can_manage_sop_catalog',  label: 'Add, edit & retire SOPs in the catalogue' },
      { key: 'can_allocate_staff',      label: 'Allocate staff to floor sections & override competency warnings (Phase 2)' },
      { key: 'can_delete_staff',        label: 'Delete staff records' },
    ],
  },
  {
    group: 'Training',
    // No single department — HR owns authoring org-wide; Production/Quality can author their own courses
    permissions: [
      { key: 'can_author_training',     label: 'Author courses, lessons & assessments' },
      { key: 'can_assign_training',     label: 'Assign courses to staff & set due dates' },
      { key: 'can_view_all_competency', label: 'View the cross-department competency dashboard (HR)' },
    ],
  },
  {
    group: 'Shift Roster',
    // No single department — the roster spans every section. View is global;
    // Submit/Edit/Delete are granted per section so a person changes only their own.
    permissions: [
      { key: 'can_view_roster',                 label: 'View the whole roster (all sections, read-only)' },
      { key: 'can_edit_roster_production',      label: 'Production — edit & save people' },
      { key: 'can_submit_roster_production',    label: 'Production — submit / sign off (receives reminders)' },
      { key: 'can_delete_roster_production',    label: 'Production — delete entries' },
      { key: 'can_edit_roster_store',           label: 'Store — edit & save people' },
      { key: 'can_submit_roster_store',         label: 'Store — submit / sign off (receives reminders)' },
      { key: 'can_delete_roster_store',         label: 'Store — delete entries' },
      { key: 'can_edit_roster_qc',              label: 'Quality — edit & save people' },
      { key: 'can_submit_roster_qc',            label: 'Quality — submit / sign off (receives reminders)' },
      { key: 'can_delete_roster_qc',            label: 'Quality — delete entries' },
      { key: 'can_edit_roster_cleaning',        label: 'Cleaning — edit & save people' },
      { key: 'can_submit_roster_cleaning',      label: 'Cleaning — submit / sign off (receives reminders)' },
      { key: 'can_delete_roster_cleaning',      label: 'Cleaning — delete entries' },
      { key: 'can_edit_roster_maintenance',     label: 'Maintenance — edit & save people' },
      { key: 'can_submit_roster_maintenance',   label: 'Maintenance — submit / sign off (receives reminders)' },
      { key: 'can_delete_roster_maintenance',   label: 'Maintenance — delete entries' },
      { key: 'can_edit_roster_hs',              label: 'Health & Safety — edit & save people' },
      { key: 'can_submit_roster_hs',            label: 'Health & Safety — submit / sign off (receives reminders)' },
      { key: 'can_delete_roster_hs',            label: 'Health & Safety — delete entries' },
    ],
  },
]
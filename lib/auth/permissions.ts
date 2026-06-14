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
  // Sales & Marketing
  | 'can_access_sales'
  | 'can_access_marketing'
  | 'can_access_research'
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
  // Maintenance
  | 'can_raise_breakdown'
  | 'can_raise_planned'
  | 'can_allocate_jobs'
  | 'can_qc_jobs'
  | 'can_verify_jobs'

export type Permissions = Partial<Record<PermissionKey, boolean>>

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  'can_upload_pdfs','can_save_records','can_edit_records','can_delete_records',
  'can_view_history','can_export_csv','can_save_lab_results','can_delete_lab_results',
  'can_edit_lab_comments','can_edit_customer_specs','can_delete_specs','can_edit_sieve_specs',
  'can_edit_granule_specs','can_create_runs','can_edit_runs','can_finalise_runs',
  'can_reopen_runs','can_delete_runs','can_add_samples','can_edit_samples',
  'can_add_tastings','can_edit_tastings','can_add_sieving_runs','can_delete_sieving_runs',
  'can_edit_sieving_specs','can_submit_count','can_edit_count','can_view_all_sections',
  'can_view_ops_dashboard',
  'can_start_live_session','can_scan_inputs','can_add_outputs','can_reset_operator_pin',
  'can_view_live_history','can_approve_session',
  'can_access_sales','can_access_marketing','can_access_research',
  'can_view_management','can_view_reports','can_export_reports','can_manage_users',
  'can_reset_passwords','can_change_roles','can_edit_permissions','can_invite_users',
  'can_confirm_emails','can_view_audit_log','can_run_migrations','can_access_dev_tools',
  'can_manage_integrations',
  'can_assign_tickets', 'can_access_workspace',
  'can_raise_breakdown','can_raise_planned','can_allocate_jobs','can_qc_jobs','can_verify_jobs',
]

// ─── Departments ──────────────────────────────────────────────────────────────

export type Department =
  | 'IT'
  | 'Quality'
  | 'Production'
  | 'Maintenance'
  | 'Management'
  | 'Sales'
  | 'Marketing'

export const ALL_DEPARTMENTS: Department[] = [
  'IT', 'Quality', 'Production', 'Maintenance', 'Management', 'Sales', 'Marketing',
]

export const DEPARTMENT_META: Record<Department, { label: string; desc: string; color: string }> = {
  IT:         { label: 'IT',         desc: 'Technology, infrastructure & development', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  Quality:    { label: 'Quality',    desc: 'QMS, lab results, sieving, pasteuriser, granule', color: 'bg-ok/10 text-ok border-ok/20' },
  Production: { label: 'Production', desc: 'Operations, morning count, floor production', color: 'bg-warn/10 text-warn border-warn/20' },
  Maintenance:{ label: 'Maintenance',desc: 'Job cards, breakdowns, scheduled maintenance & spares', color: 'bg-azure/10 text-azure border-azure/20' },
  Management: { label: 'Management', desc: 'Directors, analysts — read-only across platform', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  Sales:      { label: 'Sales',      desc: 'Sales module & research engine', color: 'bg-brand/10 text-brand border-brand/20' },
  Marketing:  { label: 'Marketing',  desc: 'Marketing module', color: 'bg-pink-50 text-pink-700 border-pink-200' },
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
    { role: 'quality_default',  label: 'Quality (Default)', desc: 'All permissions off — toggle on what they need' },
  ],
  Production: [
    { role: 'production_default',    label: 'Production (Default)',     desc: 'All permissions off' },
    { role: 'floor_operator',        label: 'Floor Operator',           desc: 'PIN-based tablet access only — no system login' },
    { role: 'production_supervisor', label: 'Production Supervisor',    desc: 'Manages production floor, approves sessions, resets PINs' },
    { role: 'warehouse_supervisor',  label: 'Warehouse Supervisor',     desc: 'Stock counts (warehouse side) + live capture history' },
    { role: 'stock_controller',      label: 'Stock Controller',         desc: 'Stock counts (stock side) — second independent counter' },
  ],
  Maintenance: [
    { role: 'maintenance_default',    label: 'Maintenance (Default)',    desc: 'All permissions off — toggle on what they need' },
    { role: 'maintenance_manager',    label: 'Maintenance Manager',      desc: 'Allocates job cards, verifies completed work, raises planned & breakdown cards' },
    { role: 'maintenance_technician', label: 'Maintenance Technician',   desc: 'Receives & executes assigned job cards' },
    { role: 'maintenance_qc',         label: 'Maintenance QC',           desc: 'Performs post-maintenance QC checks' },
  ],
  Management: [
    { role: 'management_default', label: 'Management (Default)', desc: 'All permissions off — toggle on what they need' },
  ],
  Sales: [
    { role: 'sales_default',    label: 'Sales (Default)',    desc: 'All permissions off — toggle on what they need' },
  ],
  Marketing: [
    { role: 'marketing_default',label: 'Marketing (Default)',desc: 'All permissions off — toggle on what they need' },
  ],
}

// ─── Role permission defaults ─────────────────────────────────────────────────
// IT roles have meaningful defaults. All other roles start at zero.
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
      { key: 'can_view_history',   label: 'View historical (public schema) data' },
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
    group: 'Maintenance',
    department: 'Maintenance',
    permissions: [
      { key: 'can_raise_breakdown', label: 'Raise urgent breakdown job cards' },
      { key: 'can_raise_planned',   label: 'Raise planned / scheduled job cards' },
      { key: 'can_allocate_jobs',   label: 'Allocate job cards to technicians' },
      { key: 'can_qc_jobs',         label: 'Perform post-maintenance QC checks' },
      { key: 'can_verify_jobs',     label: 'Verify completed work / bounce back' },
    ],
  },
]
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
//   8. Read-only access is DERIVED, not listed — resolvePermission() reads the
//      `read` slots out of PERMISSION_MATRIX rather than keeping a second list
//      of "which keys are views" that would drift the moment a module ships.

// permission-registry only imports TYPES from this file (`import type`), which
// TypeScript erases, so this is not a runtime circular import.
import {
  READ_KEY_GRANTORS, WRITE_KEY_GRANTORS, DELETE_KEY_GRANTORS,
  MODULE_READ_KEYS, READ_KEY_IMPLIED_BY,
} from './permission-registry'

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
  // Quality's per-resource READ keys. Before these existed, VIEWING lab
  // results/specs/runs/sieving was governed ENTIRELY by can_view_history — one
  // key that opens the whole module — or by Quality department membership.
  // There was no way to hand someone read access to just one of these pages.
  // See app/(app)/layout.tsx's Quality ROUTE_GUARDS block for how each is
  // wired in (each accepts can_view_history too, so nobody who could already
  // see a page loses that).
  | 'can_view_lab_results'
  | 'can_view_specs'
  | 'can_view_runs'
  | 'can_view_sieving'
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
  // Quality — COA Generator. A dedicated key rather than the can_save_lab_results
  // / can_approve_runs the page's canUse borrowed until now — see coa/page.tsx.
  | 'can_generate_coa'
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
  | 'can_approve_reopen_request'  // decide a supervisor's "request to reopen this PO" (Supervisor Hub)
  | 'can_edit_bag_tag'
  | 'can_delete_bag_tag'
  // Production — Master Inventory & Blends (BOM) — both read-only, Acumatica
  // is the master and data arrives via import, not manual add/edit.
  | 'can_view_inventory'
  | 'can_view_blends'
  // Production — Pasteuriser job cards (BOM-driven generation + approval)
  | 'can_generate_job_cards'   // production manager: pick a BOM code, auto-fill ratios, send for approval
  | 'can_approve_job_cards'    // production supervisor: approve/reject a generated job card
  // Production — Granule job cards (separate line, separate people from Pasteuriser's)
  | 'can_generate_job_cards_granule'
  | 'can_approve_job_cards_granule'
  // Pasteuriser finished-product LABELS — design -> proof -> approval -> PO -> print.
  // Split five ways because five different people touch a label and the whole
  // point of the workflow is that they are separable: designing is not
  // approving, and approving on the strength of Control Union's reply is not
  // committing a customer PO to it.
  | 'can_view_labels'          // see the label library and print history
  | 'can_design_labels'        // author/edit a draft template, issue a proof
  | 'can_approve_labels'       // sales: record the CU/customer sign-off
  | 'can_assign_label_po'      // sales: bind an approved template to a customer PO
  | 'can_print_labels'         // supervisor: print finished-product labels on the line
  // Quality's own label authority. NOT folded into can_approve_labels: a label
  // now needs Sales AND Quality, and one key held by both would let Sales sign
  // for Quality, which is the whole thing the second signature prevents.
  | 'can_quality_sign_labels'  // quality: sign a template, and the pre-print test label
  // Production — Shift Report (the generated end-of-shift record)
  | 'can_view_shift_report'    // read a shift report (any date/shift)
  | 'can_edit_shift_report'    // regenerate, add supervisor notes, save the draft
  | 'can_submit_shift_report'  // send the report to the production manager
  | 'can_approve_shift_report' // production manager: sign the report off
  // Production — Capture ratings (performance + data accuracy per rostered person)
  | 'can_view_capture_ratings' // see the weekly capture scoreboard
  | 'can_rate_capture'         // score a rostered person's performance & accuracy
  | 'can_delete_capture_rating'
  // Sales & Marketing
  | 'can_access_sales'
  | 'can_access_marketing'
  | 'can_access_research'
  | 'can_access_intelligence'
  // View-only counterparts for the two Sales-group modules that actually WRITE:
  // Alara/Research can promote a signal into an account and upload to the vault,
  // and Global Wits imports a CSV. can_access_* still means "full use" and is
  // what those three actions check, so nobody who has it today loses anything —
  // these keys open the same screens with those actions withheld, which is what
  // lets the read-only grant cover the module honestly.
  | 'can_view_research'
  | 'can_view_intelligence'
  | 'can_view_marketing'      // same split — the Marketing hub saves reports and creates accounts
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
  // Bag Tracking
  | 'can_access_bag_tracking'
  // Logistics
  | 'can_access_logistics'
  | 'can_sign_dispatch_doc'            // sign a dispatch document in-app (own on-file signature)
  | 'can_request_external_signature'   // send a driver/customer an external signing link; void/resend
  | 'can_verify_dispatch_doc'          // mark a signed dispatch document verified
  // Note Books — the GRN / Delivery Note books, one pair per site
  | 'can_access_notebooks'             // open the module and read any site's book
  | 'can_create_notebook_doc'          // open a new page (takes the next number) + fill it in
  | 'can_sign_notebook_doc'            // sign a note in-app with your own on-file signature
  | 'can_void_notebook_doc'            // void an issued note (the number is kept, never reused)
  // Maintenance
  | 'can_access_maintenance'
  | 'can_raise_breakdown'
  | 'can_raise_planned'
  | 'can_allocate_jobs'
  | 'can_qc_jobs'
  | 'can_verify_jobs'
  // Staff & Competency
  | 'can_access_hr'            // gate for the Staff Directory (people + how they sign in)
  | 'can_view_staff'           // directory + profiles + Skills Matrix (read-only)
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
  // ── Read-only access ───────────────────────────────────────────────────────
  // One key per module in PERMISSION_MATRIX, plus a blanket key. Holding one
  // resolves every READ key that module declares in lib/auth/permission-registry.ts
  // to true — see resolvePermission() and READ_KEYS_BY_MODULE.
  //
  // These grant reads and nothing else. They never switch a write, delete or
  // manage key on, and they never switch anything OFF: someone who also holds a
  // write permission through their role keeps it. "Read-only" here describes
  // what the KEY hands out, not a cap on the person.
  //
  // The names must match `can_read_${slug}` for the slugs in the matrix — a
  // drift test in permissions.test.ts fails the build if the two disagree.
  | 'can_read_all_modules'     // every module below, including ones added later
  | 'can_read_quality'
  | 'can_read_production'
  | 'can_read_maintenance'
  | 'can_read_sales'
  | 'can_read_marketing'
  | 'can_read_bag_tracking'
  | 'can_read_logistics'
  | 'can_read_notebooks'
  | 'can_read_management'
  | 'can_read_workspace'
  | 'can_read_staff_directory'
  | 'can_read_training'
  | 'can_read_roster'
  // Write and delete, same scheme, one per module. There is no
  // can_write_all_modules or can_delete_all_modules and there should not be:
  // see the note above MODULE_GRANTS in permission-registry.ts.
  //
  // A module keeps all three keys even where it declares no write or delete
  // slot today (Sales, Marketing, Bag Tracking, Management, Workspace), so
  // the first resource that gains one is covered without a new key. The
  // Users page draws a switch only where the count is non-zero.
  | 'can_write_quality'
  | 'can_write_production'
  | 'can_write_maintenance'
  | 'can_write_sales'
  | 'can_write_marketing'
  | 'can_write_bag_tracking'
  | 'can_write_logistics'
  | 'can_write_notebooks'
  | 'can_write_management'
  | 'can_write_workspace'
  | 'can_write_staff_directory'
  | 'can_write_training'
  | 'can_write_roster'
  | 'can_delete_quality'
  | 'can_delete_production'
  | 'can_delete_maintenance'
  | 'can_delete_sales'
  | 'can_delete_marketing'
  | 'can_delete_bag_tracking'
  | 'can_delete_logistics'
  | 'can_delete_notebooks'
  | 'can_delete_management'
  | 'can_delete_workspace'
  | 'can_delete_staff_directory'
  | 'can_delete_training'
  | 'can_delete_roster'
  // Administration is deliberately absent: its resources are the audit log,
  // migrations, dev tools and user admin, none of which is a "read" anybody
  // should get from a view-everything toggle. It sets readGrant: false.

export type Permissions = Partial<Record<PermissionKey, boolean>>

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  'can_upload_pdfs','can_save_records','can_edit_records','can_delete_records',
  'can_view_history','can_export_csv','can_save_lab_results','can_delete_lab_results',
  'can_edit_lab_comments',
  'can_view_lab_results','can_view_specs','can_view_runs','can_view_sieving',
  'can_edit_customer_specs','can_delete_specs','can_edit_sieve_specs',
  'can_edit_granule_specs','can_create_runs','can_edit_runs','can_finalise_runs',
  'can_reopen_runs','can_delete_runs','can_add_samples','can_edit_samples',
  'can_add_tastings','can_edit_tastings','can_approve_runs','can_signoff_day',
  'can_add_sieving_runs','can_delete_sieving_runs',
  'can_edit_sieving_specs','can_generate_coa',
  'can_submit_count','can_edit_count','can_view_all_sections',
  'can_view_ops_dashboard',
  'can_start_live_session','can_scan_inputs','can_add_outputs','can_reset_operator_pin',
  'can_view_live_history','can_approve_session',
  'can_edit_session','can_delete_session','can_approve_reopen_request','can_edit_bag_tag','can_delete_bag_tag',
  'can_view_inventory',
  'can_view_blends',
  'can_generate_job_cards','can_approve_job_cards',
  'can_generate_job_cards_granule','can_approve_job_cards_granule',
  'can_view_labels','can_design_labels','can_approve_labels','can_assign_label_po','can_print_labels',
  'can_quality_sign_labels',
  'can_view_shift_report','can_edit_shift_report','can_submit_shift_report','can_approve_shift_report',
  'can_view_capture_ratings','can_rate_capture','can_delete_capture_rating',
  'can_access_sales','can_access_marketing','can_access_research','can_access_intelligence',
  'can_view_research','can_view_intelligence','can_view_marketing',
  'can_view_management','can_view_reports','can_export_reports','can_manage_users',
  'can_reset_passwords','can_change_roles','can_edit_permissions','can_invite_users',
  'can_confirm_emails','can_view_audit_log','can_run_migrations','can_access_dev_tools',
  'can_manage_integrations',
  'can_assign_tickets', 'can_access_workspace',
  'can_access_bag_tracking',
  'can_access_logistics','can_sign_dispatch_doc','can_request_external_signature','can_verify_dispatch_doc',
  'can_access_notebooks','can_create_notebook_doc','can_sign_notebook_doc','can_void_notebook_doc',
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
  // Module grants (see the union above). Order matches PERMISSION_MATRIX.
  'can_read_all_modules',
  'can_read_quality',    'can_write_quality',    'can_delete_quality',
  'can_read_production', 'can_write_production', 'can_delete_production',
  'can_read_maintenance','can_write_maintenance','can_delete_maintenance',
  'can_read_sales',      'can_write_sales',      'can_delete_sales',
  'can_read_marketing',  'can_write_marketing',  'can_delete_marketing',
  'can_read_bag_tracking','can_write_bag_tracking','can_delete_bag_tracking',
  'can_read_logistics',  'can_write_logistics',  'can_delete_logistics',
  'can_read_notebooks',  'can_write_notebooks',  'can_delete_notebooks',
  'can_read_management', 'can_write_management', 'can_delete_management',
  'can_read_workspace',  'can_write_workspace',  'can_delete_workspace',
  'can_read_staff_directory','can_write_staff_directory','can_delete_staff_directory',
  'can_read_training',   'can_write_training',   'can_delete_training',
  'can_read_roster',     'can_write_roster',     'can_delete_roster',
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
    // Real IT staff, added to ROLE_PERMISSION_DEFAULTS below for the first
    // time — until now these two role strings existed only in the database
    // (set outside this system, probably during onboarding before it existed)
    // and were never in this picker list or in ROLE_PERMISSION_DEFAULTS. With
    // no entry here, resolvePermission() falls through to false for every
    // key, and IT department membership alone grants nothing (deliberately —
    // see the "IT is NOT a blanket key" note above ROUTE_GUARDS), so anyone on
    // either role had ZERO permissions unless individually overridden — the
    // same gap `store_default` had. `it_management` is the production
    // spelling; `it-management` (hyphen) is how the same role is stored on
    // staging — both are wired below so the defaults apply regardless of
    // which environment the person is in.
    { role: 'bis_manager',      label: 'BIS Manager',      desc: 'Business information systems — can open the COA Generator' },
    { role: 'it_management',    label: 'IT Management',    desc: 'Can open the COA Generator' },
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
    { role: 'production_manager',    label: 'Production Manager',       desc: 'Submits the Production shift roster and decides supervisor reopen requests — the supervisor edits & saves, the manager signs it off' },
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
    { role: 'management_default', label: 'Management (Default)', desc: 'Read-only over a fixed list of modules — quality, production, maintenance, reports. Toggle write/delete on per person if needed.' },
    // The claim "read-only across all modules" belongs to this role, not to
    // management_default above, whose list is hand-maintained and predates
    // several modules. This one holds can_read_all_modules and follows the
    // matrix. Listed under Management as the natural home, but it is a role
    // string like any other — assign it from any department.
    { role: 'read_only_viewer',   label: 'Read-Only Viewer',    desc: 'View access to every module, including ones added later. No write, delete or admin rights anywhere.' },
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
    // Master Inventory & Blends (BOM) — read-only, Acumatica is the master
    can_view_inventory: true,
    can_view_blends: true,
    // Pasteuriser + Granule job cards — supervisor approves what the manager generates
    can_approve_job_cards: true, can_approve_job_cards_granule: true,
    // Shift report — the supervisor writes it and sends it up; the manager signs.
    can_view_shift_report: true, can_edit_shift_report: true, can_submit_shift_report: true,
    // Capture ratings — the supervisor scores their own rostered crew.
    can_view_capture_ratings: true, can_rate_capture: true,
    // Staff & Competency
    can_access_hr: true, can_view_staff: true, can_edit_staff_profiles: true,
    can_manage_competencies: true, can_allocate_staff: true,
    can_delete_staff: true,
    // Training — can author/assign courses for their own floor sections
    can_author_training: true, can_assign_training: true,
    // Shift roster — edits & saves the Production section (submit moved to
    // production_manager, below — the supervisor's draft is only official once
    // the manager signs it off); still owns Maintenance's submit.
    can_view_roster: true,
    can_edit_roster_production: true, can_delete_roster_production: true,
    can_edit_roster_maintenance: true, can_submit_roster_maintenance: true,
    // Note Books — supervises what the gate writes, so can also correct (void) it
    can_access_notebooks: true, can_create_notebook_doc: true,
    can_sign_notebook_doc: true, can_void_notebook_doc: true,
    // Labels — the supervisor prints finished product on the line. Read + print
    // only: they never author or approve wording.
    can_view_labels: true, can_print_labels: true,
  },

  // ── Production Manager — Supervisor Hub sign-off tier. Sees everything the
  // supervisor sees (read-only oversight) plus the two decisions that belong
  // above the floor: submitting the Production roster the supervisor drafted,
  // and deciding a supervisor's "reopen this PO" request. Does NOT edit
  // capture sessions or the roster directly — that stays with the supervisor.
  production_manager: {
    can_view_all_sections: true, can_view_ops_dashboard: true, can_view_live_history: true,
    can_export_csv: true,
    can_view_roster: true, can_submit_roster_production: true,
    can_approve_reopen_request: true,
    // Shift report — the manager is the signing tier, and can correct a report
    // before signing it rather than bouncing it back for a typo.
    can_view_shift_report: true, can_edit_shift_report: true, can_approve_shift_report: true,
    // Capture ratings — read the weekly board; scoring stays with the supervisor
    // who actually watched the shift.
    can_view_capture_ratings: true,
    // BOM catalogue (read) + Pasteuriser/Granule job cards — manager generates, supervisor approves
    can_view_blends: true, can_generate_job_cards: true, can_generate_job_cards_granule: true,
    // Labels — the manager SELECTS an approved label + PO when raising the job
    // card. Deliberately no design/approve rights: the wording is sales' and the
    // certifier's, and the manager must not be able to change what was approved.
    can_view_labels: true,
  },

  // ── Store — owns the Store roster section ──────────────────────────────────
  store_supervisor: {
    can_view_roster: true,
    can_edit_roster_store: true, can_submit_roster_store: true, can_delete_roster_store: true,
    // Note Books — the store is where goods are physically received and handed
    // over, so this is the role that actually writes the books.
    can_access_notebooks: true, can_create_notebook_doc: true,
    can_sign_notebook_doc: true, can_void_notebook_doc: true,
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
    // Note Books — writes and signs GRNs/DNs; voiding stays a supervisor call.
    can_access_notebooks: true, can_create_notebook_doc: true, can_sign_notebook_doc: true,
  },

  stock_controller: {
    // The second stock counter (the "Stock" count side).
    can_submit_count: true, can_view_ops_dashboard: true,
    can_view_live_history: true,
    can_access_notebooks: true, can_create_notebook_doc: true, can_sign_notebook_doc: true,
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

  // ── IT — BIS Manager / IT Management: previously undefined roles ───────────
  // These two hold real people (see DEPARTMENT_ROLES.IT above for the full
  // story) but had never been given any default. Wiring only what was
  // explicitly asked for — the ability to open and use the COA Generator —
  // rather than inventing a broader permission set nobody has specified.
  // `can_generate_coa` alone is enough: the dedicated /quality/coa route guard
  // accepts it without requiring can_view_history, so this does not open any
  // other part of Quality.
  bis_manager: {
    can_generate_coa: true,
  },
  it_management: {
    can_generate_coa: true,
  },
  // Same role, stored with a hyphen on staging (see the comment above).
  'it-management': {
    can_generate_coa: true,
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
    // Labels — Quality's signature on the artwork chain and on the pre-print
    // test label. Read, sign; never author or print.
    can_view_labels: true, can_quality_sign_labels: true,
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
    // Shift report + capture scoreboard (read-only — signing stays with production)
    can_view_shift_report: true, can_view_capture_ratings: true,
    // Maintenance (view module — no job-card actions)
    can_access_maintenance: true,
    // Note Books (read-only — writing a note is a floor/store action)
    can_access_notebooks: true,
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

  // ── Read-Only Viewer — the whole platform, view access, nothing else ───────
  // The hand-maintained list above is management_default's, and it drifted: it
  // predates Labels, Job Cards, Bag Tracking, Logistics and the Sales-group
  // modules, so a "read-only across the platform" role written that way is out
  // of date the next time a module ships. This role holds ONE key instead, and
  // that key is resolved against PERMISSION_MATRIX at call time — a module added
  // to the matrix is covered without touching this file.
  //
  // Deliberately NOT applied to management_default: that would widen what every
  // existing Management user can see, which is a decision for whoever owns those
  // accounts, not a side effect of adding the capability. Assign this role, or
  // tick the read keys per person, when you actually want it.
  read_only_viewer: {
    can_read_all_modules: true,
  },

  // ── All other roles: zero defaults — toggle on per person ──────────────────
  // Any role string not listed here resolves to all-false.
}

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Override, then role default. The direct answer for a key, with no read-only
 * grant applied — resolvePermission() uses it to ask "does this person hold
 * can_read_<module>?" without re-entering the grant branch below.
 */
function heldDirectly(
  role:      string | null,
  overrides: Permissions,
  key:       PermissionKey
): boolean {
  if (key in overrides) return overrides[key] === true
  if (!role) return false
  return ROLE_PERMISSION_DEFAULTS[role]?.[key] === true
}

export function resolvePermission(
  role:        string | null,
  overrides:   Permissions,
  key:         PermissionKey
): boolean {
  // Explicit override always wins
  if (key in overrides) return overrides[key] === true
  // Role default
  if (role && ROLE_PERMISSION_DEFAULTS[role]?.[key] === true) return true

  // ── Module grants, checked LAST so they can only ever ADD ─────────────────
  //
  // Ordering is the safety property here, not an implementation detail:
  //   - after the override check, so an explicit `false` on one key still wins
  //     (grant read-all, then deny one module's key, and the deny holds);
  //   - only for keys the matrix files under that exact axis. The three
  //     GRANTORS maps are built from `read`, `write` and `delete` slots
  //     separately, and a test asserts the four slot kinds are disjoint — so a
  //     write grant cannot reach a read key, and NOTHING reaches `manage`.
  //     A resource with no slot of that kind is simply never granted. Fails
  //     closed in every direction.

  // A read key: granted by its module's read, write OR delete grant. Write and
  // delete imply read because every route guard in the app is on a read key —
  // without the implication, "write on Quality" would hand someone save
  // permissions for pages the guard bounces them out of before they can use.
  const readGrantors = READ_KEY_GRANTORS.get(key)
  if (readGrantors) {
    if (heldDirectly(role, overrides, 'can_read_all_modules')) return true
    if (readGrantors.some(g =>
      heldDirectly(role, overrides, g) ||
      (READ_KEY_IMPLIED_BY.get(g) ?? []).some(k => heldDirectly(role, overrides, k))
    )) return true
  }

  // A write key: only its module's write grant. Deliberately not implied by
  // delete — being allowed to remove a record is not being allowed to author
  // one, and the reverse is the pairing the sign-off chains rely on.
  const writeGrantors = WRITE_KEY_GRANTORS.get(key)
  if (writeGrantors?.some(g => heldDirectly(role, overrides, g))) return true

  // A delete key: only its module's delete grant. No blanket key exists.
  const deleteGrantors = DELETE_KEY_GRANTORS.get(key)
  if (deleteGrantors?.some(g => heldDirectly(role, overrides, g))) return true

  // can_read_all_modules implies each per-module can_read_<slug>, and a
  // module's write/delete grant implies its read grant. Not cosmetic: five
  // route guards (/supervisor, /stock-control and three /production/* pages)
  // had no permission at all and now name can_read_production, so a holder of
  // the blanket key — or of write on Production — has to resolve THAT key
  // itself, not merely the keys it in turn grants. Tests assert both.
  if (MODULE_READ_KEYS.has(key)) {
    if (heldDirectly(role, overrides, 'can_read_all_modules')) return true
    if ((READ_KEY_IMPLIED_BY.get(key) ?? []).some(k => heldDirectly(role, overrides, k))) return true
  }

  return false
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
    // First, because it is the fastest way to set someone up. Three axes per
    // module — Read, Write, Delete — each derived from the slots the permission
    // matrix already declares, so a module gains coverage the day a resource is
    // added to it. Write and Delete imply Read for the same module (every route
    // guard is on a read key, so write-without-read reaches nothing).
    //
    // `manage` is absent on purpose: approve, finalise, sign off, allocate and
    // verify are authority rather than editing, and stay per-key in the groups
    // below. There is no blanket Write or Delete either — only Read has one.
    //
    // A module appears here with Write or Delete only if it actually declares a
    // slot of that kind. Sales, Marketing, Bag Tracking, Management and
    // Workspace are read-only surfaces today; their keys exist (so nothing
    // breaks when that changes) but drawing a switch for a grant that reaches
    // zero keys just invites someone to tick it and wonder why nothing happened.
    group: 'Module access — read / write / delete',
    permissions: [
      { key: 'can_read_all_modules', label: 'Read across ALL modules (covers modules added later)' },
      { key: 'can_read_quality',              label: 'Quality — Read' },
      { key: 'can_write_quality',             label: 'Quality — Write' },
      { key: 'can_delete_quality',            label: 'Quality — Delete' },
      { key: 'can_read_production',           label: 'Production — Read' },
      { key: 'can_write_production',          label: 'Production — Write' },
      { key: 'can_delete_production',         label: 'Production — Delete' },
      { key: 'can_read_maintenance',          label: 'Maintenance — Read' },
      { key: 'can_write_maintenance',         label: 'Maintenance — Write' },
      { key: 'can_read_sales',                label: 'Sales, Alara & Intelligence — Read' },
      { key: 'can_read_marketing',            label: 'Marketing — Read' },
      { key: 'can_read_bag_tracking',         label: 'Bag Tracking — Read' },
      { key: 'can_read_logistics',            label: 'Logistics — Read' },
      { key: 'can_write_logistics',           label: 'Logistics — Write' },
      { key: 'can_read_notebooks',            label: 'Note Books (GRN / Delivery Notes) — Read' },
      { key: 'can_write_notebooks',           label: 'Note Books (GRN / Delivery Notes) — Write' },
      { key: 'can_read_management',           label: 'Management dashboard & reports — Read' },
      { key: 'can_read_workspace',            label: 'Workspace — Read' },
      { key: 'can_read_staff_directory',      label: 'Staff Directory — Read' },
      { key: 'can_write_staff_directory',     label: 'Staff Directory — Write' },
      { key: 'can_delete_staff_directory',    label: 'Staff Directory — Delete' },
      { key: 'can_read_training',             label: 'Training (Skills Matrix & SOPs) — Read' },
      { key: 'can_write_training',            label: 'Training (Skills Matrix & SOPs) — Write' },
      { key: 'can_read_roster',               label: 'Shift Roster — Read' },
      { key: 'can_write_roster',              label: 'Shift Roster — Write' },
      { key: 'can_delete_roster',             label: 'Shift Roster — Delete' },
    ],
  },
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
      { key: 'can_view_lab_results',   label: 'View lab results (without full can_view_history)' },
      { key: 'can_save_lab_results',   label: 'Save lab results' },
      { key: 'can_delete_lab_results', label: 'Delete lab results' },
      { key: 'can_edit_lab_comments',  label: 'Edit comments on lab results' },
    ],
  },
  {
    group: 'Quality — Specifications',
    department: 'Quality',
    permissions: [
      { key: 'can_view_specs',          label: 'View specifications (without full can_view_history)' },
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
      { key: 'can_view_runs',     label: 'View granule / pasteuriser runs (without full can_view_history)' },
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
      { key: 'can_view_sieving',        label: 'View sieving (without full can_view_history)' },
      { key: 'can_add_sieving_runs',    label: 'Add new sieving runs' },
      { key: 'can_delete_sieving_runs', label: 'Delete sieving runs' },
      { key: 'can_edit_sieving_specs',  label: 'Edit sieving specs' },
    ],
  },
  {
    group: 'Quality — COA Generator',
    department: 'Quality',
    permissions: [
      // The only gate. See coa-gating.ts / coa/page.tsx's canUse — this key is
      // additive alongside the pre-existing can_save_lab_results /
      // can_approve_runs so nobody who already had access loses it.
      { key: 'can_generate_coa', label: 'Open & build a COA (view and edit are not yet separated for this screen)' },
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
    // Read-only — Acumatica is the master for both stock items and BOM
    // structure; data arrives via import, not manual add/edit in the app.
    permissions: [
      { key: 'can_view_inventory', label: 'View Master Inventory' },
      { key: 'can_view_blends',    label: 'View BOMs page (all work centres)' },
    ],
  },
  {
    group: 'Production — Pasteuriser Job Cards',
    department: 'Production',
    permissions: [
      { key: 'can_generate_job_cards', label: 'Generate a job card from a BOM and send it for approval' },
      { key: 'can_approve_job_cards',  label: 'Approve or reject a job card sent for approval' },
    ],
  },
  {
    group: 'Production — Granule Job Cards',
    department: 'Production',
    permissions: [
      { key: 'can_generate_job_cards_granule', label: 'Generate a Granule job card from a BOM and send it for approval' },
      { key: 'can_approve_job_cards_granule',  label: 'Approve or reject a Granule job card sent for approval' },
    ],
  },
  {
    group: 'Production — Finished-Product Labels',
    department: 'Production',
    permissions: [
      { key: 'can_view_labels',     label: 'View the label library, proofs and print history' },
      { key: 'can_design_labels',   label: 'Author a label template and issue a proof for approval' },
      { key: 'can_approve_labels',  label: 'Record the Control Union / customer approval of a template' },
      { key: 'can_assign_label_po', label: 'Assign a customer PO to an approved label' },
      { key: 'can_print_labels',    label: 'Print finished-product labels on the line' },
      { key: 'can_quality_sign_labels', label: 'Quality: sign a label template, and the pre-print test label' },
    ],
  },
  {
    group: 'Sales',
    department: 'Sales',
    permissions: [
      { key: 'can_access_sales',    label: 'Access sales module' },
      { key: 'can_view_research',      label: 'View Alara / research engine (no lead creation, no vault upload)' },
      { key: 'can_access_research',    label: 'Full use of the research engine — promote signals to accounts, upload to the vault' },
      { key: 'can_view_intelligence',  label: 'View the intelligence engine (no Global Wits import)' },
      { key: 'can_access_intelligence',label: 'Full use of the intelligence engine — import Global Wits data' },
      { key: 'can_export_csv',      label: 'Export data to CSV' },
      { key: 'can_view_labels',     label: 'View the label library' },
      { key: 'can_design_labels',   label: 'Author label templates and issue proofs' },
      { key: 'can_approve_labels',  label: 'Mark a label approved once the certifier and customer sign off' },
      { key: 'can_assign_label_po', label: 'Assign a customer PO to an approved label' },
    ],
  },
  {
    group: 'Marketing',
    department: 'Marketing',
    permissions: [
      { key: 'can_view_marketing',   label: 'View the marketing module (no report saving, bookmarking or account creation)' },
      { key: 'can_access_marketing', label: 'Full use of the marketing module' },
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
    group: 'Bag Tracking',
    // No single department — Production/Quality get it by department; this
    // permission grants it to anyone else (e.g. Management, Sales).
    permissions: [
      { key: 'can_access_bag_tracking', label: 'Access Bag Tracking (grant to other departments)' },
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
    group: 'Note Books (GRN / Delivery Notes)',
    // No single department — the books are written at the gate and the store,
    // and read by Quality, Production and Management alike.
    permissions: [
      { key: 'can_access_notebooks',    label: 'Open the GRN / Delivery Note books (read any site)' },
      { key: 'can_create_notebook_doc', label: 'Write a new note (takes the next number in that book)' },
      { key: 'can_sign_notebook_doc',   label: 'Sign a note in-app with your own signature' },
      { key: 'can_void_notebook_doc',   label: 'Void an issued note' },
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
      { key: 'can_access_hr',           label: 'Access the Staff Directory (people + how they sign in)' },
      { key: 'can_view_staff',          label: 'View staff directory, profiles & Skills Matrix' },
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
// lib/auth/permission-registry.ts
//
// Canonical, properly-defined permission map: Module → Function → action.
// Single source of truth for the "master permissions matrix" in Users & Roles.
//
// Every permission key in lib/auth/permissions.ts is mapped here into one of:
//   read    — view the resource (often implied by department today → 'dept')
//   write   — create / save / edit
//   delete  — delete
//   manage  — extra workflow/special actions that aren't plain CRUD (kept so
//             nothing is lost: approve, finalise, allocate, verify, export, …)
//
// The matrix renders read/write/delete as columns and manage as an expandable
// list. Cells that are genuinely N/A are simply omitted. We do NOT rename or
// migrate existing keys — this is a clean overlay that maps what exists.

import type { PermissionKey } from './permissions'
import type { Department } from './permissions'

export type ResourceAction = 'read' | 'write' | 'delete'

export interface ResourceDef {
  key:      string                          // stable id, e.g. 'quality.runs'
  label:    string
  read?:    PermissionKey | 'dept'          // 'dept' = currently implied by department membership
  write?:   PermissionKey
  delete?:  PermissionKey
  manage?:  { key: PermissionKey; label: string }[]
  note?:    string
}

export interface ModuleDef {
  module:      string
  // Stable id used to build this module's read-only key (`can_read_<slug>`).
  // Never rename one — the key is stored per user in shared.app_roles.permissions,
  // so a renamed slug silently revokes everyone who held it.
  slug:        string
  department?: Department
  resources:   ResourceDef[]
  // Opt a module OUT of the read-only grant. Only Administration sets this:
  // its resources are all `manage` (audit log, migrations, dev tools, user
  // admin) and none of them is a read anybody should get from a blanket
  // "view everything" toggle.
  readGrant?:  false
}

export const PERMISSION_MATRIX: ModuleDef[] = [
  {
    module: 'Quality', slug: 'quality', department: 'Quality',
    resources: [
      { key: 'quality.records', label: 'Raw-material records',
        read: 'can_view_history', write: 'can_save_records', delete: 'can_delete_records',
        manage: [
          { key: 'can_upload_pdfs', label: 'Upload PDFs & AI extract' },
          { key: 'can_edit_records', label: 'Edit records' },
          { key: 'can_export_csv', label: 'Export to CSV' },
        ] },
      { key: 'quality.lab_results', label: 'Final-product lab results',
        read: 'can_view_lab_results', write: 'can_save_lab_results', delete: 'can_delete_lab_results',
        manage: [{ key: 'can_edit_lab_comments', label: 'Edit comments' }] },
      { key: 'quality.specs', label: 'Specifications',
        read: 'can_view_specs', write: 'can_edit_customer_specs', delete: 'can_delete_specs',
        note: 'Read used to require the edit permission — nobody could view without also being able to change. Now separate.',
        manage: [
          { key: 'can_edit_sieve_specs', label: 'Edit sieve specs' },
          { key: 'can_edit_granule_specs', label: 'Edit granule specs' },
        ] },
      { key: 'quality.runs', label: 'Runs (granule / pasteuriser)',
        read: 'can_view_runs', write: 'can_create_runs', delete: 'can_delete_runs',
        manage: [
          { key: 'can_edit_runs', label: 'Edit runs & batch numbers' },
          { key: 'can_finalise_runs', label: 'Finalise runs (Pass/Fail)' },
          { key: 'can_reopen_runs', label: 'Re-open finalised runs' },
          { key: 'can_add_samples', label: 'Add samples' },
          { key: 'can_edit_samples', label: 'Edit samples' },
          { key: 'can_add_tastings', label: 'Record tastings' },
          { key: 'can_edit_tastings', label: 'Edit tastings' },
          { key: 'can_approve_runs', label: 'Approve allocated runs (Lab Manager)' },
          { key: 'can_signoff_day', label: 'Sign off daily station overviews' },
        ] },
      { key: 'quality.sieving', label: 'Sieving',
        read: 'can_view_sieving', write: 'can_add_sieving_runs', delete: 'can_delete_sieving_runs',
        manage: [{ key: 'can_edit_sieving_specs', label: 'Edit sieving specs' }] },
      { key: 'quality.coa', label: 'COA Generator',
        write: 'can_generate_coa',
        note: 'One key covers open + build — not yet split into read vs edit. can_save_lab_results and can_approve_runs also still grant access (unchanged, for whoever already had it via those).' },
    ],
  },
  {
    module: 'Production', slug: 'production', department: 'Production',
    resources: [
      { key: 'production.count', label: 'Morning stock count',
        read: 'can_view_ops_dashboard', write: 'can_submit_count',
        manage: [
          { key: 'can_edit_count', label: 'Edit a submitted count' },
          { key: 'can_view_all_sections', label: 'View all sections' },
        ] },
      // Read-only by design: the page shows what already happened on a line.
      // Deleting a session is done from Production Orders, which is why there is
      // no delete here even though the same page renders a delete control for
      // the roles that hold can_delete_session.
      { key: 'production.history', label: 'History / Planning (per-section record)',
        read: 'can_view_live_history' },
      { key: 'production.orders', label: 'Production orders (session history)',
        read: 'can_view_live_history', write: 'can_edit_session', delete: 'can_delete_session',
        manage: [{ key: 'can_approve_reopen_request', label: 'Decide a supervisor’s reopen request (Supervisor Hub)' }] },
      { key: 'production.live', label: 'Live capture',
        read: 'can_view_live_history', write: 'can_start_live_session',
        manage: [
          { key: 'can_scan_inputs', label: 'Scan bags in' },
          { key: 'can_add_outputs', label: 'Add output bags & labels' },
          { key: 'can_approve_session', label: 'Approve & lock session' },
          { key: 'can_reset_operator_pin', label: 'Reset operator PIN' },
          { key: 'can_edit_bag_tag', label: 'Edit bag tag records' },
          { key: 'can_delete_bag_tag', label: 'Delete bag tag records' },
        ] },
      { key: 'production.inventory', label: 'Master Inventory',
        read: 'can_view_inventory',
        note: 'Read-only — Acumatica is the master; items arrive via the /admin/inventory-import bulk refresh.' },
      { key: 'production.blends', label: 'BOMs (all work centres)',
        read: 'can_view_blends',
        note: 'Read-only — Acumatica is the master for BOM structure; no manual add/edit.' },
      { key: 'production.job_cards', label: 'Pasteuriser job cards',
        read: 'can_view_blends', write: 'can_generate_job_cards',
        manage: [{ key: 'can_approve_job_cards', label: 'Approve or reject a job card sent for approval' }] },
      { key: 'production.job_cards_granule', label: 'Granule job cards',
        read: 'can_view_blends', write: 'can_generate_job_cards_granule',
        manage: [{ key: 'can_approve_job_cards_granule', label: 'Approve or reject a Granule job card sent for approval' }] },
      { key: 'production.shift_report', label: 'Shift report (end-of-shift record)',
        read: 'can_view_shift_report', write: 'can_edit_shift_report',
        manage: [
          { key: 'can_submit_shift_report',  label: 'Send the report to the Production Manager' },
          { key: 'can_approve_shift_report', label: 'Sign the report off (Production Manager)' },
        ],
        note: 'Content is generated from capture, checks, timesheets and maintenance — Write covers regenerating and adding notes.' },
      { key: 'production.capture_ratings', label: 'Capture ratings (performance & accuracy)',
        read: 'can_view_capture_ratings', write: 'can_rate_capture', delete: 'can_delete_capture_rating' },
    ],
  },
  {
    module: 'Maintenance', slug: 'maintenance', department: 'Maintenance',
    resources: [
      { key: 'maintenance.access', label: 'Maintenance module', read: 'can_access_maintenance',
        note: 'Grant Read to give a non-Maintenance user the module.' },
      { key: 'maintenance.job_cards', label: 'Job cards',
        read: 'can_access_maintenance', write: 'can_raise_planned',
        manage: [
          { key: 'can_raise_breakdown', label: 'Raise breakdowns' },
          { key: 'can_allocate_jobs', label: 'Allocate to technicians' },
          { key: 'can_qc_jobs', label: 'Post-maintenance QC' },
          { key: 'can_verify_jobs', label: 'Verify / bounce back' },
        ] },
    ],
  },
  {
    module: 'Sales', slug: 'sales', department: 'Sales',
    resources: [
      // The Sales dashboard and Accounts pages perform no writes at all, so the
      // access key IS the read key — there is nothing to withhold.
      { key: 'sales.module', label: 'Sales module', read: 'can_access_sales' },
      // Research (Alara) and Intelligence DO write: Alara can promote a signal
      // into an account and upload to the document vault; Global Wits imports a
      // CSV. So each is split — a view key that opens the screens, and the
      // original can_access_* key which is what those three actions check.
      // Nobody loses anything: existing holders of can_access_* keep both.
      { key: 'sales.research', label: 'Research engine (Alara)',
        read: 'can_view_research',
        manage: [{ key: 'can_access_research', label: 'Full use — promote a signal to an account, upload to the vault' }] },
      { key: 'sales.intelligence', label: 'Signal / intelligence engine',
        read: 'can_view_intelligence',
        manage: [{ key: 'can_access_intelligence', label: 'Full use — import Global Wits data' }] },
    ],
  },
  {
    module: 'Marketing', slug: 'marketing', department: 'Marketing',
    resources: [
      // Split for the same reason as Research/Intelligence below: the Marketing
      // hub saves reports, bookmarks signals and promotes companies to accounts.
      { key: 'marketing.module', label: 'Marketing module',
        read: 'can_view_marketing',
        manage: [{ key: 'can_access_marketing', label: 'Full use — save reports, bookmark signals, create accounts' }] },
    ],
  },
  {
    // Cross-department — Production/Quality get it by department; this
    // permission grants it to anyone outside those departments.
    module: 'Bag Tracking', slug: 'bag_tracking',
    resources: [
      { key: 'bag_tracking.access', label: 'Bag Tracking module', read: 'can_access_bag_tracking',
        note: 'Grant Read to give a non-Production/Quality user the page.' },
    ],
  },
  {
    // Cross-department — Production/Quality/Management get it by department;
    // this permission grants it to anyone outside those departments.
    module: 'Logistics', slug: 'logistics',
    resources: [
      { key: 'logistics.access', label: 'Logistics module', read: 'can_access_logistics',
        note: 'Grant Read to give a non-Production/Quality/Management user the module.' },
      { key: 'logistics.dispatch_signing', label: 'Dispatch document signing',
        write: 'can_sign_dispatch_doc',
        manage: [
          { key: 'can_request_external_signature', label: 'Send external signing link to driver/customer' },
          { key: 'can_verify_dispatch_doc', label: 'Verify a signed document' },
        ] },
    ],
  },
  {
    // Cross-department — the books are written at the gate/store and read by
    // Quality, Production and Management. Access is by permission only, so it
    // can be granted to exactly the people who work a book.
    module: 'Note Books', slug: 'notebooks',
    resources: [
      { key: 'notebooks.documents', label: 'GRN / Delivery Note books',
        read: 'can_access_notebooks', write: 'can_create_notebook_doc',
        manage: [
          { key: 'can_sign_notebook_doc', label: 'Sign a note with your own signature' },
          { key: 'can_request_external_signature', label: 'Send a driver/recipient an external signing link' },
          { key: 'can_void_notebook_doc', label: 'Void an issued note (number is kept, never reused)' },
        ],
        note: 'A note keeps its number for life — a mistake is voided and rewritten, never renumbered.' },
    ],
  },
  {
    module: 'Management', slug: 'management', department: 'Management',
    resources: [
      { key: 'management.dashboard', label: 'Management dashboard & reports',
        read: 'can_view_management',
        manage: [
          { key: 'can_view_reports', label: 'View reports & analytics' },
          { key: 'can_export_reports', label: 'Export reports' },
        ] },
    ],
  },
  {
    module: 'Workspace', slug: 'workspace',
    resources: [
      { key: 'workspace.board', label: 'Personal workspace', read: 'can_access_workspace' },
      { key: 'workspace.ticketing', label: 'Ticketing',
        manage: [{ key: 'can_assign_tickets', label: 'Assign tickets to users' }] },
    ],
  },
  {
    // Cross-department — no single department owns this. Staff Directory is
    // just people + how they sign in — competency/SOP records live under
    // Training below (that's the qualification home).
    module: 'Staff Directory', slug: 'staff',
    resources: [
      { key: 'staff.access', label: 'Staff Directory section',
        read: 'can_access_hr',
        note: 'Grant Read to give someone the Staff Directory at all — the resources below control what they see once inside.' },
      { key: 'staff.directory', label: 'Staff directory & profiles',
        read: 'can_view_staff', write: 'can_edit_staff_profiles',
        manage: [{ key: 'can_delete_staff', label: 'Delete staff records' }] },
    ],
  },
  {
    // Cross-department — HR owns authoring org-wide; Production/Quality can author their own courses.
    // This is the qualification home: courses, assignments, sign-offs, the
    // Skills Matrix and the SOP Catalogue all live here.
    module: 'Training', slug: 'training',
    resources: [
      // No Read for these two, deliberately. The only screens that show course
      // content and assignments are the /training/manage authoring pages, which
      // are an editing tool rather than a record — there is no read-only view of
      // them to grant. The readable Training content is the Skills Matrix and
      // the SOP catalogue below, and those the read-only grant does cover.
      // Every learner already reaches their own courses at /training (always-open
      // route, no permission at all).
      { key: 'training.content', label: 'Courses, lessons & assessments',
        write: 'can_author_training',
        note: 'Authoring tool — no read-only view exists, so Read is intentionally blank.' },
      { key: 'training.assignments', label: 'Course assignments',
        write: 'can_assign_training' },
      { key: 'training.competency', label: 'Skills Matrix & assessments',
        read: 'can_view_staff', write: 'can_manage_competencies',
        manage: [
          { key: 'can_allocate_staff', label: 'Allocate staff to sections & override competency warnings (Phase 2)' },
          { key: 'can_view_all_competency', label: 'Cross-department competency overview (Skills Matrix "Overview" tab)' },
        ] },
      { key: 'training.sops', label: 'SOP / Work-Instruction catalogue',
        read: 'can_view_staff', write: 'can_manage_sop_catalog' },
    ],
  },
  {
    // Cross-department — the whole-site shift layout. View is one global key;
    // write/delete/submit are per section so a person changes only their own.
    module: 'Shift Roster', slug: 'roster',
    resources: [
      { key: 'roster.production', label: 'Roster — Production',
        read: 'can_view_roster', write: 'can_edit_roster_production', delete: 'can_delete_roster_production',
        manage: [{ key: 'can_submit_roster_production', label: 'Submit / sign off (receives reminders)' }] },
      { key: 'roster.store', label: 'Roster — Store',
        read: 'can_view_roster', write: 'can_edit_roster_store', delete: 'can_delete_roster_store',
        manage: [{ key: 'can_submit_roster_store', label: 'Submit / sign off (receives reminders)' }] },
      { key: 'roster.qc', label: 'Roster — Quality',
        read: 'can_view_roster', write: 'can_edit_roster_qc', delete: 'can_delete_roster_qc',
        manage: [{ key: 'can_submit_roster_qc', label: 'Submit / sign off (receives reminders)' }] },
      { key: 'roster.cleaning', label: 'Roster — Cleaning',
        read: 'can_view_roster', write: 'can_edit_roster_cleaning', delete: 'can_delete_roster_cleaning',
        manage: [{ key: 'can_submit_roster_cleaning', label: 'Submit / sign off (receives reminders)' }] },
      { key: 'roster.maintenance', label: 'Roster — Maintenance',
        read: 'can_view_roster', write: 'can_edit_roster_maintenance', delete: 'can_delete_roster_maintenance',
        manage: [{ key: 'can_submit_roster_maintenance', label: 'Submit / sign off (receives reminders)' }] },
      { key: 'roster.hs', label: 'Roster — Health & Safety',
        read: 'can_view_roster', write: 'can_edit_roster_hs', delete: 'can_delete_roster_hs',
        manage: [{ key: 'can_submit_roster_hs', label: 'Submit / sign off (receives reminders)' }] },
    ],
  },
  {
    module: 'Administration', slug: 'admin', department: 'IT', readGrant: false,
    resources: [
      { key: 'admin.users', label: 'User administration',
        manage: [
          { key: 'can_manage_users', label: 'Create & delete users' },
          { key: 'can_reset_passwords', label: 'Reset passwords' },
          { key: 'can_change_roles', label: 'Change roles' },
          { key: 'can_edit_permissions', label: 'Edit permissions' },
          { key: 'can_invite_users', label: 'Send invitations' },
          { key: 'can_confirm_emails', label: 'Confirm emails' },
        ] },
      { key: 'admin.system', label: 'System & developer',
        manage: [
          { key: 'can_view_audit_log', label: 'View audit log' },
          { key: 'can_run_migrations', label: 'Run migrations' },
          { key: 'can_access_dev_tools', label: 'Developer tools' },
          { key: 'can_manage_integrations', label: 'Manage integrations' },
        ] },
    ],
  },
]

// Every PermissionKey that appears anywhere in the matrix (sanity/coverage use).
export const MATRIX_KEYS: PermissionKey[] = Array.from(new Set(
  PERMISSION_MATRIX.flatMap(m => m.resources.flatMap(r => [
    r.read && r.read !== 'dept' ? r.read : null,
    r.write ?? null,
    r.delete ?? null,
    ...(r.manage?.map(x => x.key) ?? []),
  ].filter(Boolean) as PermissionKey[]))
))

// ─── Read-only access, derived from the matrix ────────────────────────────────
//
// "Give this person read-only access to <module>" is not a hand-written list of
// keys — it is exactly the `read` slots this file already declares. Deriving it
// means a module added below is covered the day it is added, and a resource with
// no `read` (an authoring tool, an admin action) is never swept in by accident.
//
// The grant is ADDITIVE ONLY. It turns read keys on; it never turns anything
// off, so it cannot quietly strip a write a role already grants. And it is
// checked LAST in resolvePermission(), after overrides, so an explicit `false`
// on one key still wins over a blanket grant.

/** `can_read_<slug>` for a module — the key that grants read across it. */
export function moduleReadKey(slug: string): PermissionKey {
  return `can_read_${slug}` as PermissionKey
}

/** Every module that participates in the read-only grant, in matrix order. */
export const READ_GRANT_MODULES: { slug: string; module: string; key: PermissionKey }[] =
  PERMISSION_MATRIX
    .filter(m => m.readGrant !== false)
    .map(m => ({ slug: m.slug, module: m.module, key: moduleReadKey(m.slug) }))

/** Module read key → the read keys it grants. Excludes 'dept' (not a key). */
export const READ_KEYS_BY_MODULE: Record<string, PermissionKey[]> = Object.fromEntries(
  PERMISSION_MATRIX
    .filter(m => m.readGrant !== false)
    .map(m => [
      moduleReadKey(m.slug),
      Array.from(new Set(
        m.resources
          .map(r => r.read)
          .filter((r): r is PermissionKey => !!r && r !== 'dept')
      )),
    ])
)

/** The set of per-module read keys, for the can_read_all_modules implication. */
export const MODULE_READ_KEYS: Set<PermissionKey> = new Set(READ_GRANT_MODULES.map(m => m.key))

/**
 * Read key → the module read keys that grant it. A Map, not a Record, because
 * one read key can belong to two modules (can_access_maintenance is the read
 * for both Maintenance resources; can_view_staff for Training's and Staff's).
 */
export const READ_KEY_GRANTORS: Map<PermissionKey, PermissionKey[]> = (() => {
  const m = new Map<PermissionKey, PermissionKey[]>()
  for (const [moduleKey, readKeys] of Object.entries(READ_KEYS_BY_MODULE)) {
    for (const rk of readKeys) {
      m.set(rk, [...(m.get(rk) ?? []), moduleKey as PermissionKey])
    }
  }
  return m
})()

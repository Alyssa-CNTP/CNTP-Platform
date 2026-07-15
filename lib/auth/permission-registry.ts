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
  department?: Department
  resources:   ResourceDef[]
}

export const PERMISSION_MATRIX: ModuleDef[] = [
  {
    module: 'Quality', department: 'Quality',
    resources: [
      { key: 'quality.records', label: 'Raw-material records',
        read: 'can_view_history', write: 'can_save_records', delete: 'can_delete_records',
        manage: [
          { key: 'can_upload_pdfs', label: 'Upload PDFs & AI extract' },
          { key: 'can_edit_records', label: 'Edit records' },
          { key: 'can_export_csv', label: 'Export to CSV' },
        ] },
      { key: 'quality.lab_results', label: 'Final-product lab results',
        read: 'dept', write: 'can_save_lab_results', delete: 'can_delete_lab_results',
        manage: [{ key: 'can_edit_lab_comments', label: 'Edit comments' }] },
      { key: 'quality.specs', label: 'Specifications',
        read: 'dept', write: 'can_edit_customer_specs', delete: 'can_delete_specs',
        manage: [
          { key: 'can_edit_sieve_specs', label: 'Edit sieve specs' },
          { key: 'can_edit_granule_specs', label: 'Edit granule specs' },
        ] },
      { key: 'quality.runs', label: 'Runs (granule / pasteuriser)',
        read: 'dept', write: 'can_create_runs', delete: 'can_delete_runs',
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
        read: 'dept', write: 'can_add_sieving_runs', delete: 'can_delete_sieving_runs',
        manage: [{ key: 'can_edit_sieving_specs', label: 'Edit sieving specs' }] },
    ],
  },
  {
    module: 'Production', department: 'Production',
    resources: [
      { key: 'production.count', label: 'Morning stock count',
        read: 'can_view_ops_dashboard', write: 'can_submit_count',
        manage: [
          { key: 'can_edit_count', label: 'Edit a submitted count' },
          { key: 'can_view_all_sections', label: 'View all sections' },
        ] },
      { key: 'production.orders', label: 'Production orders (session history)',
        read: 'can_view_live_history', write: 'can_edit_session', delete: 'can_delete_session' },
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
        read: 'can_view_inventory', write: 'can_edit_inventory', delete: 'can_delete_inventory' },
      { key: 'production.blends', label: 'Blends (BOM)',
        read: 'can_view_blends', write: 'can_edit_blends', delete: 'can_delete_blends' },
    ],
  },
  {
    module: 'Maintenance', department: 'Maintenance',
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
    module: 'Sales', department: 'Sales',
    resources: [
      { key: 'sales.module', label: 'Sales module', read: 'can_access_sales' },
      { key: 'sales.research', label: 'Research engine', read: 'can_access_research' },
      { key: 'sales.intelligence', label: 'Signal / intelligence engine', read: 'can_access_intelligence' },
    ],
  },
  {
    module: 'Marketing', department: 'Marketing',
    resources: [
      { key: 'marketing.module', label: 'Marketing module', read: 'can_access_marketing' },
    ],
  },
  {
    // Cross-department — Production/Quality/Management get it by department;
    // this permission grants it to anyone outside those departments.
    module: 'Logistics',
    resources: [
      { key: 'logistics.access', label: 'Logistics module', read: 'can_access_logistics',
        note: 'Grant Read to give a non-Production/Quality/Management user the module.' },
    ],
  },
  {
    module: 'Management', department: 'Management',
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
    module: 'Workspace',
    resources: [
      { key: 'workspace.board', label: 'Personal workspace', read: 'can_access_workspace' },
      { key: 'workspace.ticketing', label: 'Ticketing',
        manage: [{ key: 'can_assign_tickets', label: 'Assign tickets to users' }] },
    ],
  },
  {
    // Cross-department — no single department owns this.
    module: 'Staff & Competency',
    resources: [
      { key: 'staff.access', label: 'HR section (Staff & Skills, SOP, Skills Matrix)',
        read: 'can_access_hr',
        note: 'Grant Read to give someone the HR module at all — the resources below control what they see once inside.' },
      { key: 'staff.directory', label: 'Staff directory & profiles',
        read: 'can_view_staff', write: 'can_edit_staff_profiles',
        manage: [{ key: 'can_delete_staff', label: 'Delete staff records' }] },
      { key: 'staff.competency', label: 'Competency matrix & assessments',
        read: 'can_view_staff', write: 'can_manage_competencies',
        manage: [
          { key: 'can_allocate_staff', label: 'Allocate staff to sections & override competency warnings (Phase 2)' },
        ] },
      { key: 'staff.sops', label: 'SOP / Work-Instruction catalogue',
        read: 'can_view_staff', write: 'can_manage_sop_catalog' },
    ],
  },
  {
    // Cross-department — HR owns authoring org-wide; Production/Quality can author their own courses.
    module: 'Training',
    resources: [
      { key: 'training.content', label: 'Courses, lessons & assessments',
        read: 'dept', write: 'can_author_training' },
      { key: 'training.assignments', label: 'Course assignments',
        read: 'dept', write: 'can_assign_training' },
      { key: 'training.competency', label: 'Cross-department competency dashboard',
        read: 'can_view_all_competency' },
    ],
  },
  {
    // Cross-department — the whole-site shift layout. View is one global key;
    // write/delete/submit are per section so a person changes only their own.
    module: 'Shift Roster',
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
    module: 'Administration', department: 'IT',
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

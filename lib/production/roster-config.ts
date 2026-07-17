/**
 * Shift Roster — shared configuration. Lives in the Production area
 * (manager-owned), at /production/roster.
 *
 * The roster is the whole-site shift layout (the monthly "Shift Layout" sheet):
 * ~25 roles down the side, two shift columns across (Day 07h00–16h00 /
 * Night 16h00–01h00), a person (or several) in each cell, each tagged with the
 * skills/certifications they hold (FL, ER, FF…).
 *
 * This is intentionally SEPARATE from production capture's section-assignment
 * flow (`shift_assignments`, 3 shifts, 6 sections). Nothing here touches that.
 *
 * Roles live in `production.roster_roles` so they can be edited in-app later;
 * this list is the seed + a client-side fallback so the grid renders even
 * before the migration is applied.
 */

export type RosterShift = 'day' | 'night'

export const ROSTER_SHIFTS: { key: RosterShift; label: string; time: string }[] = [
  { key: 'day',   label: 'Day Shift',   time: '07h00 till 16h00' },
  { key: 'night', label: 'Night Shift', time: '16h00 till 01h00' },
]

// ── Role categories (grouping + colour for the grid) ──────────────────────────
export interface RosterCategory { key: string; label: string; colorHex: string }

export const ROSTER_CATEGORIES: RosterCategory[] = [
  { key: 'production',  label: 'Production',  colorHex: '#1A3A0E' },
  { key: 'store',       label: 'Store',       colorHex: '#2A7CB8' },
  { key: 'qc',          label: 'Quality',     colorHex: '#B85C0A' },
  { key: 'cleaning',    label: 'Cleaning',    colorHex: '#1A7A3C' },
  { key: 'maintenance', label: 'Maintenance', colorHex: '#6B4FA0' },
  { key: 'hs',          label: 'Health & Safety', colorHex: '#B81C1C' },
]

export function categoryMeta(key: string): RosterCategory {
  return ROSTER_CATEGORIES.find(c => c.key === key) ?? { key, label: key, colorHex: '#637056' }
}

// ── Role catalogue (seed + fallback) ──────────────────────────────────────────
export interface RosterRole { key: string; name: string; category: string; sort: number }

// Order + categories taken straight from the 2026 Shift Layout sheets.
export const ROSTER_ROLE_SEED: RosterRole[] = [
  { key: 'rooibos_supervisor', name: 'Rooibos Supervisor',          category: 'production', sort: 10 },
  { key: 'pasteuriser_op',     name: 'Pasteuriser Operator',        category: 'production', sort: 20 },
  { key: 'bagging_vacuum',     name: 'Bagging / Vacuum',            category: 'production', sort: 30 },
  { key: 'scanning_boxes',     name: 'Scanning Boxes',              category: 'production', sort: 40 },
  { key: 'granule_operator',   name: 'Granule Operator',            category: 'production', sort: 50 },
  { key: 'granule',            name: 'Granule',                     category: 'production', sort: 60 },
  { key: 'refining_1',         name: 'Refining 1',                  category: 'production', sort: 70 },
  { key: 'sieving_tower',      name: 'Sieving Tower',               category: 'production', sort: 80 },
  { key: 'blender',            name: 'Blender',                     category: 'production', sort: 90 },
  { key: 'refining_2',         name: 'Refining 2',                  category: 'production', sort: 100 },
  { key: 'rosehip',            name: 'Value Added Product',         category: 'production', sort: 110 },

  { key: 'store_supervisor',   name: 'Store Supervisor',            category: 'store',      sort: 200 },
  { key: 'store_operator',     name: 'Store Operator',              category: 'store',      sort: 210 },
  { key: 'forklift_driver',    name: 'Forklift Driver',             category: 'store',      sort: 220 },

  { key: 'qc_supervisor',      name: 'QC Supervisor',               category: 'qc',         sort: 300 },
  { key: 'qc',                 name: 'QC',                          category: 'qc',         sort: 310 },
  { key: 'lab_analyst',        name: 'Lab Analyst',                 category: 'qc',         sort: 320 },
  { key: 'incoming_goods_qc',  name: 'Incoming Goods QC Inspector', category: 'qc',         sort: 330 },

  { key: 'cleaner_operator',   name: 'Cleaner Operator',            category: 'cleaning',   sort: 400 },
  { key: 'cleaner',            name: 'Cleaner',                     category: 'cleaning',   sort: 410 },

  // Manager sits ABOVE tech/asst and is deliberately NOT one of the on-duty
  // technician role keys (see lib/maintenance/roster.ts MAINT_ROLE_KEYS) — the
  // manager is rostered for visibility but is never auto-assigned a breakdown.
  { key: 'maintenance_manager', name: 'Maintenance Manager',         category: 'maintenance', sort: 490 },
  { key: 'maintenance_tech',   name: 'Maintenance Tech',            category: 'maintenance', sort: 500 },
  { key: 'maintenance_asst',   name: 'Maintenance Assistant',       category: 'maintenance', sort: 510 },

  { key: 'hs_assistant',       name: 'H&S Assistant',               category: 'hs',         sort: 600 },
]

// ── Skill / certification tags (the legend at the foot of the sheet) ──────────
export interface SkillTag { code: string; label: string }

export const SKILL_TAGS: SkillTag[] = [
  { code: 'FL',   label: 'Forklift License' },
  { code: 'ER',   label: 'Emergency Responder' },
  { code: 'FF',   label: 'Fire Fighter' },
  { code: 'FA',   label: 'First Aider' },
  { code: 'II',   label: 'Incident Investigator' },
  { code: 'FM',   label: 'Fire Marshall' },
  { code: 'SHER', label: 'Safety Representative' },
  { code: 'SS',   label: 'Stacking & Storage' },
  { code: 'H&S',  label: 'Health & Safety Rep' },
  { code: 'C',    label: 'Casual / Contract' },
]

export function tagLabel(code: string): string {
  return SKILL_TAGS.find(t => t.code === code)?.label ?? code
}

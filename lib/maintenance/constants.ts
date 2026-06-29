// lib/maintenance/constants.ts
// Maintenance constants — extracted verbatim from the original page.
// STATUS_COLOR (hex) is replaced by token-based STATUS_STYLE (.badge variants).

import type { Status, Urgency } from './types'
export { STATUSES, URGENCIES } from './types'

export const AREAS = ['Sieving Tower', 'Pasteurizer', 'Granules - RB', 'Refining 1', 'Refining 2', 'Diamond Blender', 'Rosehips Crusher', 'Rosehips Cutter', 'Rosehips Hammer Mill', 'Rosehips Blending', 'Rosehips Granules', 'Vacuum Packing', 'Pallet Wrapper', 'Stitching Machine', 'Facility', 'Boiler Room', 'Workshop', 'Lab', 'Reception', 'Admin Office', 'Chemical Room', 'Stores', 'Unit 1', 'Unit 2', 'Unit 3 Blender', 'Production Staff Male', 'Production Staff Female', 'Quality Office', 'Forklift Charging', 'Outside Back', 'Outside Front', 'Factory']

// Fallback technician list — used until the live staff directory loads.
export const TECHS = ['Shane', 'Mohapi', 'John', 'Yamkela', 'Melikhaya']

// Breakdown is its own workflow now — removed from the selectable planned types
export const PLANNED_TYPES = ['Planned Maintenance', 'Safety Related', 'Engineering', 'Repair', 'Temporary Repair', 'Improvement', 'Audit/Inspection Finding']

export const QC_CHECKS = ['Any loose screws visible?', 'Any spares, equipment or foreign objects left behind?', 'Any oil or grease spillages present or visible on the machine/equipment?', 'Any water leakages, spillages or poor housekeeping present?', 'Any loose or missing machine cover plates/end-guards?', 'Any reason why the machine is not safe for work?']

export const STATUS_LABEL: Record<Status, string> = {
  raised: 'NEW — AWAITING ALLOCATION',
  clarify: 'BACK TO RAISER — CLARIFY',
  assigned: 'ASSIGNED — AWAITING ACCEPT',
  in_progress: 'IN PROGRESS',
  qc_check: 'QC CHECK',
  verify: 'VERIFY',
  complete: 'COMPLETE',
  cancelled: 'CANCELLED',
}

// Token-based status styles — map each status to a .badge variant class.
export const STATUS_STYLE: Record<Status, string> = {
  raised: 'badge-warn',
  clarify: 'badge-warn',
  assigned: 'badge-info',
  in_progress: 'badge-warn',
  qc_check: 'badge-info',
  verify: 'badge-info',
  complete: 'badge-ok',
  cancelled: 'badge-gray',
}

// Manager urgency labels — colour + ordering. Mirrors PRIORITY_META so the board
// can render a manager-set urgency the same way as a derived priority.
export const URGENCY_META: Record<Urgency, { label: string; badge: string; dot: string; accent: string; rank: number }> = {
  critical: { label: 'Critical', badge: 'badge-err',  dot: 'bg-err',  accent: 'border-l-err',  rank: 0 },
  high:     { label: 'High',     badge: 'badge-err',  dot: 'bg-err',  accent: 'border-l-err',  rank: 1 },
  medium:   { label: 'Medium',   badge: 'badge-warn', dot: 'bg-warn', accent: 'border-l-warn', rank: 2 },
  low:      { label: 'Low',      badge: 'badge-gray', dot: 'bg-ok',   accent: 'border-l-ok',   rank: 3 },
}

// Machine criticality for breakdown auto-routing & priority tie-breaks.
// Pasteurizer first, then sieving tower, granule line, refining 1 & 2.
// Lower number = more critical. Anything unlisted ranks after these.
export const MACHINE_CRITICALITY: { match: RegExp; rank: number }[] = [
  { match: /pasteuri[sz]er/i, rank: 1 },
  { match: /siev/i,           rank: 2 },
  { match: /granule/i,        rank: 3 },
  { match: /refining\s*1/i,   rank: 4 },
  { match: /refining\s*2/i,   rank: 5 },
]
export function criticalityRank(area: string | null, machine: string | null): number {
  const hay = `${area ?? ''} ${machine ?? ''}`
  for (const c of MACHINE_CRITICALITY) if (c.match.test(hay)) return c.rank
  return 99
}

// lib/maintenance/constants.ts
// Maintenance constants — extracted verbatim from the original page.
// STATUS_COLOR (hex) is replaced by token-based STATUS_STYLE (.badge variants).

import type { Status } from './types'
export { STATUSES } from './types'

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
}

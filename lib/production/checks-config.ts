/**
 * Machine checks — process map per section.
 *
 * A single config drives the Checks engine UI, the audit timeline, and what's
 * surfaced "due now". Sieving is authored first (the proven slice); other
 * sections inherit the engine by filling in their own array — no new code.
 *
 * Phases follow the shift: start-up → running (hourly) → shut-down. Some checks
 * are afternoon-only (Afternoon/Night block, 16:00–01:00). Acceptable ranges for
 * machine parameters live in production.check_specs (see check-specs.ts) so they
 * stay supervisor-editable and consistent — not hardcoded here.
 */
export type CheckPhase = 'startup' | 'running' | 'shutdown'
export type CheckKind  = 'confirm' | 'number' | 'text' | 'scale' | 'massbalance'

export interface MachineCheckDef {
  key:                    string
  phase:                  CheckPhase
  label:                  string
  kind:                   CheckKind
  unit?:                  string
  afternoonOnly?:         boolean   // show only on the Afternoon/Night block
  hourly?:                boolean   // repeated reading; drives the hourly nudge
  equipment?:             string    // maintenance machine/asset name for a raise
  failRaisesMaintenance?: boolean
  allowNegative?:         boolean
  help?:                  string
}

export const MACHINE_CHECKS: Record<string, MachineCheckDef[]> = {
  sieving: [
    // ── Start-up ──
    { key: 'indent_screen_speed', phase: 'startup', label: 'Indent screen speed', kind: 'number', unit: 'rpm', equipment: 'Indent Screen' },
    { key: 'indent_screen_angle', phase: 'startup', label: 'Indent screen angle', kind: 'number', unit: '°',  equipment: 'Indent Screen', allowNegative: true },
    { key: 'rotex_clean_start',   phase: 'startup', label: 'Cleaning of Rotex',   kind: 'confirm', afternoonOnly: true, equipment: 'Rotex', help: 'Start of afternoon shift only' },
    { key: 'sieving_config',      phase: 'startup', label: 'Sieving configuration', kind: 'text', help: 'State the screen configuration in use' },
    { key: 'scale_verification',  phase: 'startup', label: 'Scale verification',  kind: 'scale', unit: 'kg', equipment: 'Scale — Sieving', failRaisesMaintenance: true },
    { key: 'prestart_done',       phase: 'startup', label: 'Machine pre-start checks conducted', kind: 'confirm' },
    // ── Running ──
    { key: 'infeed_vsd',          phase: 'running', label: 'Infeed speed (VSD)',  kind: 'number', unit: 'Hz', hourly: true },
    { key: 'dust_extraction',     phase: 'running', label: 'Dust extraction',     kind: 'confirm', equipment: 'Dust Extraction', failRaisesMaintenance: true },
    // ── Shut-down ──
    { key: 'rotex_clean_end',     phase: 'shutdown', label: 'Cleaning of Rotex',  kind: 'confirm', afternoonOnly: true, equipment: 'Rotex', help: 'Afternoon shift only' },
    { key: 'mass_balance',        phase: 'shutdown', label: 'Mass balance',       kind: 'massbalance', afternoonOnly: true, help: 'At shut-down and at each grade/material/variant change-over' },
  ],
  refining1:   [],
  refining2:   [],
  granule:     [],
  blender:     [],
  pasteuriser: [],
}

export const PHASE_LABEL: Record<CheckPhase, string> = {
  startup: 'Start-up', running: 'Running', shutdown: 'Shut-down',
}

export function machineChecksFor(sectionId: string): MachineCheckDef[] {
  return MACHINE_CHECKS[sectionId] ?? []
}

// Afternoon/Night block runs 16:00–01:00 — afternoon-only checks show for both.
export function isAfternoonBlock(shift: string): boolean {
  return shift === 'afternoon' || shift === 'night'
}

// Checks visible for this shift (drops afternoon-only on the morning shift).
export function visibleChecks(sectionId: string, shift: string): MachineCheckDef[] {
  const aft = isAfternoonBlock(shift)
  return machineChecksFor(sectionId).filter(c => !c.afternoonOnly || aft)
}

// Shift windows (operator hours). Used for the hourly nudge + shut-down prompt.
export const SHIFT_END_HOUR: Record<string, number> = {
  morning: 16,        // 07:00–16:00
  afternoon: 1,       // 16:00–01:00 (next day)
  night: 1,
}

// How long before a fresh hourly reading is "due".
export const HOURLY_NUDGE_MINUTES = 60

// Section → maintenance AREA (lib/maintenance/constants.ts AREAS) for raising jobs.
export const SECTION_TO_AREA: Record<string, string> = {
  sieving:     'Sieving Tower',
  refining1:   'Refining 1',
  refining2:   'Refining 2',
  granule:     'Granules - RB',
  blender:     'Diamond Blender',
  pasteuriser: 'Pasteurizer',
}

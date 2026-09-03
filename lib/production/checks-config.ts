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
export type CheckKind  = 'confirm' | 'number' | 'text' | 'scale' | 'massbalance' | 'mesh'

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

/**
 * The UI kind a check renders as, mapped to the kind stored on the event.
 *
 * They are not the same list, and must not be conflated:
 * `production.check_events.kind` carries
 *
 *     CHECK (kind IN ('confirm','number','text','scale','massbalance'))
 *
 * from migration 20260618_002, so a UI-only kind written straight to the column
 * is REJECTED — the whole event fails to save, which on a tablet reads as a
 * check that will not sign off. 'mesh' is three inputs on screen and a string
 * in the column, which is what 'text' already means.
 *
 * Add a UI kind here the moment you add one to CheckKind; the compiler will
 * not tell you, because CheckKind is a superset by design.
 */
export type CheckStorageKind = 'confirm' | 'number' | 'text' | 'scale' | 'massbalance'

export function storageKindFor(kind: CheckKind): CheckStorageKind {
  return kind === 'mesh' ? 'text' : kind
}

export const MACHINE_CHECKS: Record<string, MachineCheckDef[]> = {
  sieving: [
    // ── Start-up ──
    { key: 'indent_screen_speed', phase: 'startup', label: 'Indent screen speed', kind: 'number', unit: 'rpm', equipment: 'Indent Screen' },
    { key: 'indent_screen_angle', phase: 'startup', label: 'Indent screen angle', kind: 'number', unit: '°',  equipment: 'Indent Screen', allowNegative: true },
    { key: 'rotex_clean_start',   phase: 'startup', label: 'Cleaning of Rotex',   kind: 'confirm', afternoonOnly: true, equipment: 'Rotex', help: 'Start of afternoon shift only' },
    // Three deck sizes, not free text. The operator fills in the numbers and
    // lib/core/mesh.ts writes '#12 / #14 / #16' — the '#' is the app's job.
    // It was a text box, so what reached check_events.value_text was whatever
    // was typed ('#12 #14 #16', '12/14/16', 'top 12 mid 14 bot 16'), and the
    // four screens that read it back cannot group or compare free text: two
    // shifts on the identical configuration did not match.
    { key: 'sieving_config',      phase: 'startup', label: 'Sieving configuration (mesh sizes)', kind: 'mesh', help: 'Top, middle and bottom deck' },
    { key: 'scale_verification',  phase: 'startup', label: 'Scale verification',  kind: 'scale', unit: 'kg', equipment: 'Scale — Sieving', failRaisesMaintenance: true },
    { key: 'prestart_done',       phase: 'startup', label: 'Machine pre-start checks conducted', kind: 'confirm' },
    // Asked ONCE here, with the rest of the start-up checks, then hinted
    // hourly. It used to sit in 'running' with nothing asking for the first
    // reading, so HourlyVsdPrompt auto-popped a full-screen modal the moment
    // material was captured — which on the floor meant mid-way through adding
    // a bulk bag. `hourly` still drives the hourly reminder; what changed is
    // that the first reading is part of the start-up round.
    { key: 'infeed_vsd',          phase: 'startup', label: 'Infeed speed (VSD)',  kind: 'number', unit: 'Hz', hourly: true },
    // ── Running ──
    { key: 'dust_extraction',     phase: 'running', label: 'Dust extraction',     kind: 'confirm', equipment: 'Dust Extraction', failRaisesMaintenance: true },
    // ── Shut-down ──
    { key: 'rotex_clean_end',     phase: 'shutdown', label: 'Cleaning of Rotex',  kind: 'confirm', afternoonOnly: true, equipment: 'Rotex', help: 'Afternoon shift only' },
    // Mass balance is NOT a check. It has its own tab, its own persisted
    // prod_mass_balance row and its own +/-1% tolerance (ARCHITECTURE.md §5);
    // confirming it a second time here asked the operator to agree with a
    // figure they had already agreed with, and blocked sign-off on it. The
    // 'massbalance' CheckKind stays defined because historical check_events
    // rows carry kind='massbalance' and must still read back.
  ],
  refining1:   [],
  refining2:   [],
  granule: [
    // ── Start-up ── scale verification is a legal-metrology requirement (NRCS/SANAS)
    // and the source of the scale-health KPI. Zero check → test load → pass/fail.
    { key: 'scale_zero_check',   phase: 'startup', label: 'Scale zero check',              kind: 'confirm', equipment: 'Scale — Granule', help: 'Zero the scale so no tare weight affects readings' },
    { key: 'scale_verification', phase: 'startup', label: 'Scale verification (test load)', kind: 'scale', unit: 'kg', equipment: 'Scale — Granule', failRaisesMaintenance: true, help: 'Place the certified test mass — actual must fall within tolerance of the standard' },
    { key: 'prestart_done',      phase: 'startup', label: 'Machine pre-start checks conducted', kind: 'confirm' },
  ],
  blender:      [],
  smallblender: [],
  pasteuriser:  [],
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

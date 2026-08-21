// lib/production/shift-report.ts
//
// The end-of-shift report — the one document that answers "what actually
// happened on the floor today" without anyone re-typing it.
//
// Every figure in here is DERIVED from records the floor already captures:
// capture sessions + mass balance (tons, yield), bagging rows (what was
// produced and how much of each), timesheets (who was actually there, hours,
// changeovers, breaks), the checks engine (machine settings, sieving config,
// VSD, failed checks), maintenance job cards (breakdowns and the downtime they
// cost), the roster (who was SUPPOSED to be there) and leave (why they weren't).
// Nothing here is a second place to type a number — if a value is wrong the fix
// is in the record it came from, which is what makes the report auditable.
//
// The shape below is also the shape frozen into production.shift_reports.payload
// at submit time, so a report signed in July still reads the same in December
// even if a session is later recaptured. Treat added fields as optional so an
// old payload keeps rendering.

import type { Shift } from '@/lib/supabase/database.types'

export type ShiftReportStatus = 'draft' | 'submitted' | 'approved'

export interface ShiftReportMeta {
  date: string                 // yyyy-MM-dd (SAST)
  shift: Shift
  shiftLabel: string           // 'Morning' | 'Afternoon / Night'
  shiftWindow: string          // '07h00–16h00'
  generatedAt: string          // ISO
  rosterPeriodName: string | null
  rosterShiftLabel: string | null   // 'Shift A' / 'Shift B' from the roster period
  supervisorNames: string[]
}

/** Headline numbers — the strip a manager reads before anything else. */
export interface ShiftReportHeadline {
  linesRun: number
  totalInputKg: number
  totalOutputKg: number
  tonsOut: number
  yieldPct: number | null
  sessionsSignedOff: number
  sessionsOutstanding: number
  balanceFlags: number
  breakdowns: number
  downtimeMinutes: number
  peopleRostered: number
  peoplePresent: number
  peopleAbsent: number
  checksFailed: number
}

export interface RosteredPerson {
  personName: string
  employeeId: string | null
  operatorId: string | null
  roleKey: string
  roleName: string
}

export interface PresentPerson {
  personName: string
  /** Only set when this name matches someone on the roster for this shift —
   *  neither the timesheet nor the capture session carries an employee id of
   *  its own, so an unrostered swap nobody wrote down can't be linked. */
  employeeId: string | null
  sectionIds: string[]
  workedMinutes: number
  firstIn: string | null       // ISO
  lastOut: string | null       // ISO
  breakMinutes: number
  confirmed: boolean
}

export interface AbsentPerson {
  personName: string
  employeeId: string | null
  roleName: string
  /** 'leave' — an approved leave period covers this date; 'no_record' — rostered
   *  but nothing (no timesheet, no capture) shows them on the floor. */
  reason: 'leave' | 'no_record'
  leaveKind: string | null
  leaveNote: string | null
}

export interface ShiftReportAttendance {
  rostered: RosteredPerson[]
  present: PresentPerson[]
  absent: AbsentPerson[]
  /** Worked but not on the roster for this shift — a swap nobody wrote down. */
  unrostered: PresentPerson[]
  totalWorkedMinutes: number
}

export interface LineReport {
  sessionId: string
  sectionId: string
  sectionName: string
  sectionCode: string
  colorHex: string
  recordNo: string | null
  status: string               // draft | submitted | approved
  variant: string | null
  lotNumber: string | null
  productionOrders: string[]
  operatorNames: string[]
  inputKg: number
  outputKg: number
  balanceKg: number | null
  toleranceKg: number
  withinTolerance: boolean | null
  yieldPct: number | null
  bagsOut: number
  bagsIn: number
  spillageKg: number
  handoverNote: string | null
  firstCaptureAt: string | null
  lastCaptureAt: string | null
  submittedAt: string | null
  /** Wall-clock minutes between first and last captured bag — the closest thing
   *  to "how long the line actually ran" without a machine-hours feed. */
  runMinutes: number | null
}

export interface OutputLine {
  productType: string
  kg: number
  bags: number
  sharePct: number | null
  sections: string[]
}

export interface ThroughputLine {
  sectionId: string
  sectionName: string
  outputKg: number
  inputKg: number
  runMinutes: number | null
  workedMinutes: number
  /** Output kg per running hour. Uses run minutes (first→last bag) when we have
   *  them, else confirmed worked hours — the two answer slightly different
   *  questions and the source is reported so nobody reads them as one number. */
  kgPerHour: number | null
  basis: 'run' | 'worked' | null
}

export interface MachineSetting {
  label: string
  value: string
  unit: string | null
  status: 'ok' | 'flagged' | 'fail' | 'na'
  at: string | null
}

export interface MachineConfigLine {
  sectionId: string
  sectionName: string
  sievingConfig: string | null
  settings: MachineSetting[]
  vsdHz: { avg: number | null; min: number | null; max: number | null; readings: number }
}

export interface Changeover {
  sectionId: string
  sectionName: string
  at: string                   // ISO
  personName: string | null
  /** Where we learned about it: an operator's timesheet changeover event, or a
   *  new production index appearing in the checks record (a grade/variant swap). */
  source: 'timesheet' | 'checks'
  detail: string | null
}

export interface BreakdownLine {
  cardId: number
  cardNo: string
  area: string
  machine: string | null
  description: string
  workflow: 'breakdown' | 'planned'
  status: string
  raisedBy: string | null
  raisedAt: string
  assignedTo: string | null
  startedAt: string | null
  completedAt: string | null
  /** Minutes from raise to completion, capped at the shift window when the card
   *  is still open — an open breakdown shouldn't report 40 days of downtime. */
  downtimeMinutes: number | null
  stillOpen: boolean
  rootCause: string | null
  workDone: string | null
}

export interface CheckFailure {
  label: string
  value: string | null
  unit: string | null
  status: 'flagged' | 'fail'
  reason: string | null
  at: string
  actorName: string | null
}

export interface ChecksLine {
  sectionId: string
  sectionName: string
  status: string | null        // in_progress | operator_signed | supervisor_verified
  operatorName: string | null
  supervisorName: string | null
  total: number
  ok: number
  flagged: number
  failed: number
  na: number
  aiSummary: string | null
  failures: CheckFailure[]
}

export interface WasteLine {
  sectionId: string
  sectionName: string
  spillageKg: number
  dustExtractionKg: number
  floorWasteKg: number
  waterKg: number
}

export interface ReportNote {
  kind: 'handover' | 'message'
  sectionId: string | null
  sectionName: string
  author: string
  body: string
  at: string
}

export interface OutstandingItem {
  sessionId: string
  sectionId: string
  sectionName: string
  status: string
  reason: string
}

export interface ShiftReportAuditEntry {
  action: string
  fromStatus: string | null
  toStatus: string | null
  actorName: string | null
  note: string | null
  at: string
}

export interface ShiftReportRecord {
  id: string | null
  status: ShiftReportStatus
  supervisorNotes: string | null
  generatedAt: string | null
  generatedByName: string | null
  submittedAt: string | null
  submittedByName: string | null
  approvedAt: string | null
  approvedByName: string | null
  trail: ShiftReportAuditEntry[]
}

export interface ShiftReport {
  meta: ShiftReportMeta
  headline: ShiftReportHeadline
  attendance: ShiftReportAttendance
  lines: LineReport[]
  outputs: OutputLine[]
  throughput: ThroughputLine[]
  machineConfig: MachineConfigLine[]
  changeovers: Changeover[]
  breakdowns: BreakdownLine[]
  checks: ChecksLine[]
  waste: WasteLine[]
  notes: ReportNote[]
  outstanding: OutstandingItem[]
  record: ShiftReportRecord
  /** Sections of the report that could not be built — a missing table or a
   *  permission gap. Surfaced rather than silently rendering an empty section,
   *  so "no breakdowns" is never confused with "we couldn't read breakdowns". */
  gaps: string[]
}

// ── Display helpers, shared by the page and the print stylesheet ─────────────

export const SHIFT_WINDOW: Record<string, string> = {
  morning: '07h00–16h00',
  afternoon: '16h00–01h00',
  night: '16h00–01h00',
}

export const tons = (kg: number) => Math.round((kg / 1000) * 100) / 100

export function hoursLabel(minutes: number): string {
  if (!minutes) return '0h'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** SAST clock time for an ISO timestamp — every time in the report is SAST. */
export function sastTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export function sastDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export const STATUS_LABEL: Record<string, string> = {
  draft: 'In progress',
  submitted: 'Awaiting sign-off',
  approved: 'Signed off',
}

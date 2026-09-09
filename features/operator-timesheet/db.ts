/**
 * Operator timesheet — data access.
 *
 * Every write here is a PER-ROW UPSERT on a stable, client-minted uuid, and a
 * removal is a VOID rather than a delete (ARCHITECTURE.md §4 and §6). That is
 * not ceremony: the stoppage ledger is the only record that a machine was down,
 * and the previous implementation held the whole set in React state and wrote it
 * once at sign-off, so anything that re-derived first threw it away.
 *
 * Nothing in this file is pure — the arithmetic lives in lib/core/timesheet.
 */

import { getDb } from '@/lib/supabase/db'
import {
  scheduledStoppages, toSnapshotBreaks, workedMinutes,
  type Stoppage, type StoppageKind, type StoppageSource, type SupervisorVerdict,
} from '@/lib/core/timesheet/stoppages'
import { areasForSection } from './areas'

// ── Row ⇄ Stoppage ───────────────────────────────────────────────────────────

const COLS =
  'id,kind,started_at,ended_at,notes,machine,area,job_card_id,source,voided_at,' +
  'supervisor_verdict,supervisor_name,supervisor_employee_id,supervisor_signed_at,' +
  'supervisor_note,notified_at'

function toStoppage(r: any): Stoppage {
  return {
    id:        String(r.id),
    kind:      r.kind as StoppageKind,
    startedAt: r.started_at,
    endedAt:   r.ended_at ?? null,
    notes:     r.notes ?? null,
    machine:   r.machine ?? null,
    area:      r.area ?? null,
    jobCardId: r.job_card_id == null ? null : Number(r.job_card_id),
    source:    (r.source ?? 'operator') as StoppageSource,
    voidedAt:  r.voided_at ?? null,
    // An attestation exists only when a verdict was actually recorded. A row
    // with a supervisor name but no verdict is a half-written signature and
    // must read as unsigned, not as approval.
    attestation: r.supervisor_verdict
      ? {
          verdict:        r.supervisor_verdict as SupervisorVerdict,
          supervisorName: r.supervisor_name ?? 'Supervisor',
          employeeId:     r.supervisor_employee_id ?? null,
          signedAt:       r.supervisor_signed_at ?? r.updated_at ?? new Date().toISOString(),
          note:           r.supervisor_note ?? null,
        }
      : null,
    notifiedAt: r.notified_at ?? null,
  }
}

const table = () => getDb().schema('production').from('timesheet_stoppages')

/** The session/operator/date columns every row carries. Denormalised — see the migration. */
export interface StoppageScope {
  sessionId:    string
  operatorId:   string | null
  operatorName: string
  sectionId:    string
  date:         string
  shift:        string
}

function scopeCols(scope: StoppageScope) {
  return {
    session_id:    scope.sessionId,
    operator_id:   scope.operatorId,
    operator_name: scope.operatorName,
    section_id:    scope.sectionId,
    date:          scope.date,
    shift:         scope.shift,
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Every stoppage on this session for this operator, VOIDED ONES INCLUDED,
 * oldest first.
 *
 * Voided rows come back on purpose. They are what tells the seeder that this
 * operator has been here before, so a lunch they deliberately voided is not
 * helpfully restored on their next page load.
 */
export async function loadStoppages(
  sessionId: string,
  operatorName: string,
): Promise<Stoppage[]> {
  const { data, error } = await table()
    .select(COLS)
    .eq('session_id', sessionId)
    .eq('operator_name', operatorName)
    .order('started_at', { ascending: true })
  if (error) throw new Error(`Could not read stoppages: ${error.message}`)
  return ((data as any[]) ?? []).map(toStoppage)
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Insert or update ONE stoppage, keyed on its id.
 *
 * Called on every edit — adding a stoppage, closing it, changing a time,
 * typing a note (debounced by the caller). A stoppage therefore exists in the
 * database from the moment it is logged, which is the whole fix: a tab switch,
 * a reload or a re-render can no longer lose it.
 */
export async function saveStoppage(scope: StoppageScope, s: Stoppage): Promise<void> {
  const { error } = await table().upsert({
    id:          s.id,
    ...scopeCols(scope),
    kind:        s.kind,
    started_at:  s.startedAt,
    ended_at:    s.endedAt,
    notes:       s.notes?.trim() || null,
    machine:     s.machine || null,
    area:        s.area || null,
    job_card_id: s.jobCardId,
    source:      s.source,
    voided_at:   s.voidedAt,
    // The attestation columns are written from the stoppage's own `attestation`
    // field so there is ONE writer for them and the row cannot disagree with
    // what the screen shows. This is also what makes re-signing work: an
    // operator who edits an attested breakdown's window clears the attestation
    // locally (see `patch` in OperatorTimesheet), and that clearing has to
    // reach the database — otherwise a supervisor's signature would stand over
    // times they never saw.
    supervisor_verdict:     s.attestation?.verdict ?? null,
    supervisor_name:        s.attestation?.supervisorName ?? null,
    supervisor_employee_id: s.attestation?.employeeId ?? null,
    supervisor_signed_at:   s.attestation?.signedAt ?? null,
    supervisor_note:        s.attestation?.note ?? null,
    notified_at: s.notifiedAt,
    updated_at:  new Date().toISOString(),
  } as any, { onConflict: 'id' })
  if (error) throw new Error(`Could not save the stoppage: ${error.message}`)
}

/**
 * Record a supervisor's verdict on a breakdown.
 *
 * Separate from `saveStoppage` because the two have different authors and
 * different authority: an operator edits the stoppage, a supervisor signs it.
 * Writing only the attestation columns means signing cannot accidentally
 * rewrite the operator's times or notes, which a full-row upsert from the
 * supervisor's copy of state could.
 *
 * `supervisor_user_id` is left to the caller's auth session rather than passed
 * in from the client — see the API route.
 */
export async function attestStoppage(args: {
  stoppageId:   string
  verdict:      SupervisorVerdict
  supervisorName: string
  employeeId:   string | null
  note:         string | null
}): Promise<void> {
  const { error } = await table().update({
    supervisor_verdict:     args.verdict,
    supervisor_name:        args.supervisorName,
    supervisor_employee_id: args.employeeId,
    supervisor_signed_at:   new Date().toISOString(),
    supervisor_note:        args.note?.trim() || null,
    updated_at:             new Date().toISOString(),
  } as any).eq('id', args.stoppageId)
  if (error) throw new Error(`Could not record the signature: ${error.message}`)
}

/**
 * Mark a breakdown as having been reported to the maintenance manager.
 *
 * Written AFTER the notification is accepted, never before: a stamp written
 * first would suppress the retry when the send actually failed, and the
 * maintenance manager would never hear about the breakdown at all.
 */
export async function markNotified(stoppageId: string, at: string): Promise<void> {
  const { error } = await table()
    .update({ notified_at: at, updated_at: new Date().toISOString() } as any)
    .eq('id', stoppageId)
  if (error) throw new Error(`Could not record the notification: ${error.message}`)
}

/**
 * Tell the maintenance manager (and the production supervisors) that a line is
 * down, then stamp the row so it is never sent twice.
 *
 * Goes through an API route because `notify()` is server-only — it writes other
 * users' notification rows with the service-role client, which a browser
 * session cannot and must not be able to do.
 *
 * Returns true when the row was stamped. A failure is deliberately quiet at the
 * call site: the breakdown is already saved, and an operator mid-shift cannot
 * act on "the notification service is down". It retries on the next poll,
 * because `notified_at` is still null.
 */
export async function reportBreakdown(args: {
  stoppageId:  string
  sectionId:   string
  machine:     string | null
  area:        string | null
  description: string
  operatorName: string
  startedAt:   string
  jobCardId:   number | null
}): Promise<boolean> {
  try {
    const res = await fetch('/api/production/breakdown/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`notify route returned ${res.status}`)
    const body = await res.json().catch(() => ({}))
    await markNotified(args.stoppageId, body.notifiedAt ?? new Date().toISOString())
    return true
  } catch (e) {
    console.warn('[operator-timesheet] breakdown notification failed, will retry:', e)
    return false
  }
}

/**
 * Remove a stoppage from the count without removing it from the record.
 *
 * There is no delete path here at all. An operator who mis-logs a breakdown
 * must be able to take it off their sheet — but a machine-downtime figure that
 * can be silently erased is not an audit record, so the row stays with
 * `voided_at` set and stops counting everywhere.
 */
export async function voidStoppage(
  id: string,
  voidedBy: string,
  reason?: string,
): Promise<void> {
  const { error } = await table().update({
    voided_at:   new Date().toISOString(),
    voided_by:   voidedBy,
    void_reason: reason?.trim() || null,
    updated_at:  new Date().toISOString(),
  } as any).eq('id', id)
  if (error) throw new Error(`Could not remove the stoppage: ${error.message}`)
}

// ── Seeding the scheduled breaks ─────────────────────────────────────────────

/**
 * Materialise the shift's scheduled tea and lunch as real ledger rows, ONCE.
 *
 * Operators confirm the sheet rather than punch it, so it has to arrive
 * pre-filled with what the shift is supposed to be. Persisting the schedule
 * (instead of re-deriving it on every mount, as before) is what makes an
 * operator's edit to lunch survive the next render.
 *
 * Idempotent on "has this operator any row on this session at all" — voided
 * rows count. So a lunch the operator deliberately removed is NOT restored on
 * their next page load, which re-deriving would have done every time.
 *
 * Returns the full set after seeding.
 */
export async function seedScheduledStoppages(
  scope: StoppageScope,
  existing: Stoppage[],
): Promise<Stoppage[]> {
  if (existing.length > 0) return existing

  const seeded = scheduledStoppages(
    scope.shift,
    scope.date,
    () => crypto.randomUUID(),
    // The tablet's clock is SAST; a scheduled 10:30 means 10:30 on the floor.
    local => {
      const d = new Date(`${local}:00`)
      return Number.isNaN(d.getTime()) ? null : d.toISOString()
    },
  )
  if (seeded.length === 0) return existing

  const { error } = await table().upsert(
    seeded.map(s => ({
      id: s.id,
      ...scopeCols(scope),
      kind: s.kind, started_at: s.startedAt, ended_at: s.endedAt,
      notes: null, machine: null, area: null, job_card_id: null,
      source: s.source, voided_at: null,
    })) as any,
    { onConflict: 'id' },
  )
  // A failed seed is not fatal — the operator can add the breaks by hand, and
  // the alternative (throwing) would leave them with no timesheet at all.
  if (error) {
    console.warn('[operator-timesheet] could not seed scheduled breaks:', error.message)
    return existing
  }
  return seeded
}

// ── The confirmed snapshot on prod_timesheets ────────────────────────────────

export interface StoredTimesheet {
  shiftStart: string | null
  shiftEnd:   string | null
  notes:      string | null
  confirmed:  boolean
  confirmedAt: string | null
  workedMinutes: number | null
}

/** The confirmed timesheet row for a session + operator, if there is one. */
export async function loadTimesheet(
  sessionId: string,
  operatorName: string,
): Promise<StoredTimesheet | null> {
  const { data, error } = await getDb().schema('production').from('prod_timesheets')
    .select('shift_start,shift_end,notes,confirmed,confirmed_at,worked_minutes')
    .eq('session_id', sessionId).eq('operator_name', operatorName).maybeSingle()
  if (error) throw new Error(`Could not read the timesheet: ${error.message}`)
  if (!data) return null
  const r = data as any
  return {
    shiftStart: r.shift_start ?? null,
    shiftEnd:   r.shift_end ?? null,
    notes:      r.notes ?? null,
    confirmed:  !!r.confirmed,
    confirmedAt: r.confirmed_at ?? null,
    workedMinutes: r.worked_minutes ?? null,
  }
}

/**
 * Save the operator's shift note without confirming the timesheet.
 *
 * The note used to reach the database only as part of a confirm, so an
 * operator who typed one and then went back to capture lost it — the same
 * "exists only in React state until sign-off" failure as the stoppages. It
 * upserts the row with `confirmed` left alone, so writing a note mid-shift
 * cannot mark a sheet as signed off.
 */
export async function saveTimesheetNote(scope: StoppageScope, note: string): Promise<void> {
  const { error } = await getDb().schema('production').from('prod_timesheets').upsert({
    ...scopeCols(scope),
    notes:      note.trim() || null,
    updated_at: new Date().toISOString(),
  } as any, { onConflict: 'session_id,operator_name' })
  if (error) throw new Error(`Could not save your note: ${error.message}`)
}

export interface ConfirmArgs extends StoppageScope {
  shiftStart: string | null
  shiftEnd:   string | null
  stoppages:  Stoppage[]
  notes:      string | null
}

/**
 * Write the confirmed timesheet.
 *
 * `breaks` is a DERIVED SNAPSHOT of the ledger, not a second source of truth.
 * It is still written because the shift report, the production order detail and
 * supervisor analytics all read `prod_timesheets.breaks` today, and breaking
 * three reporting surfaces to avoid one denormalised column is a bad trade.
 * Anything that needs the machine, the job card, or a stoppage that is still
 * running reads the ledger.
 *
 * THROWS on failure. The caller must not report a confirmed timesheet it could
 * not save — the previous version marked the sign-off confirmed in a `finally`
 * regardless, so a failed write showed the operator a green tick.
 */
export async function confirmTimesheet(args: ConfirmArgs): Promise<void> {
  const endFallback = args.shiftEnd ?? new Date().toISOString()
  const breaks = toSnapshotBreaks(args.stoppages, endFallback)
  const worked = workedMinutes(args.shiftStart, args.shiftEnd, args.stoppages)

  const { error } = await getDb().schema('production').from('prod_timesheets').upsert({
    ...scopeCols(args),
    shift_start:    args.shiftStart,
    shift_end:      args.shiftEnd,
    breaks,
    notes:          args.notes?.trim() || null,
    worked_minutes: worked,
    derived_data:   { source: 'stoppage_ledger', stoppages: args.stoppages },
    confirmed:      true,
    confirmed_by:   args.operatorName,
    confirmed_at:   new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  } as any, { onConflict: 'session_id,operator_name' })

  if (error) throw new Error(`Could not save the timesheet: ${error.message}`)
}

// ── Maintenance job cards for this line ──────────────────────────────────────

export interface LineJobCard {
  id:          number
  cardNo:      string
  area:        string
  machine:     string | null
  description: string
  workflow:    'breakdown' | 'planned'
  status:      string
  raisedAt:    string
  startedAt:   string | null
  completedAt: string | null
  raisedBy:    string | null
  assignedTo:  string | null
}

const CLOSED_STATUSES = new Set(['complete', 'cancelled'])

export function isCardOpen(c: LineJobCard): boolean {
  return !CLOSED_STATUSES.has(c.status)
}

/**
 * The machines on this line, from the maintenance module's own register.
 *
 * Read from `maintenance.machines` rather than kept as a list here, because a
 * per-machine downtime KPI is only as good as the machine names agreeing across
 * the two modules — a second list would drift, and every stoppage typed against
 * a name maintenance does not use is a machine with no history.
 *
 * Returns [] on any failure. A missing picker degrades to free text (the
 * component keeps an "other" option); a throw here would take out the whole
 * timesheet, which is the trade §3 names — degrade to the old answer, never a
 * blank screen over a half-captured session.
 */
export async function loadLineMachines(sectionId: string): Promise<string[]> {
  const areas = areasForSection(sectionId)
  if (areas.length === 0) return []
  try {
    const { data, error } = await getDb().schema('maintenance' as any).from('machines')
      .select('name,area').in('area', areas).eq('active', true).order('name')
    if (error) throw new Error(error.message)
    const names = ((data as any[]) ?? []).map(m => String(m.name)).filter(Boolean)
    return [...new Set(names)]
  } catch (e) {
    console.warn('[operator-timesheet] machine register unavailable:', e)
    return []
  }
}

/**
 * Maintenance job cards touching this line during this shift.
 *
 * Both the open ones and any closed since the shift began: a card completed
 * twenty minutes ago is exactly the one whose stoppage the operator still needs
 * prompting to close.
 *
 * Read-only. This feature never writes to the maintenance schema — a job card's
 * lifecycle belongs to the maintenance module, and a capture screen quietly
 * completing a card would be two owners of one workflow.
 */
export async function loadLineJobCards(
  sectionId: string,
  sinceIso: string,
): Promise<LineJobCard[]> {
  const areas = areasForSection(sectionId)
  if (areas.length === 0) return []

  const { data, error } = await getDb().schema('maintenance' as any).from('job_cards')
    .select('id,card_no,area,machine,description,workflow,status,raised_at,started_at,completed_at,raised_by,assigned_to')
    .in('area', areas)
    // Raised during the shift, OR raised earlier and still not closed — a
    // breakdown from yesterday that is still down is still stopping this line.
    .or(`raised_at.gte.${sinceIso},status.not.in.(complete,cancelled)`)
    .order('raised_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(`Could not read maintenance job cards: ${error.message}`)

  return ((data as any[]) ?? []).map(c => ({
    id:          Number(c.id),
    cardNo:      c.card_no ?? String(c.id),
    area:        c.area ?? '',
    machine:     c.machine ?? null,
    description: c.description ?? '',
    workflow:    (c.workflow === 'breakdown' ? 'breakdown' : 'planned') as 'breakdown' | 'planned',
    status:      c.status ?? 'raised',
    raisedAt:    c.raised_at,
    startedAt:   c.started_at ?? null,
    completedAt: c.completed_at ?? null,
    raisedBy:    c.raised_by ?? null,
    assignedTo:  c.assigned_to ?? null,
  }))
}

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
import type { Database } from '@/lib/supabase/database.types'

// ── Typed edges ──────────────────────────────────────────────────────────────
//
// `stoppageWrite` / `timesheetWrite` exist because Supabase's generated Insert
// type demands every non-defaulted column, so a PARTIAL write — a supervisor
// signing, without restating the operator's times — cannot satisfy it.
// `Partial<Row>` is what these writes actually are.
//
// Neither uses `any`, which matters beyond style: they still check every column
// name against the real row, and they earned that immediately — the first
// compile caught `breaks` and `derived_data` being handed objects the `jsonb`
// columns' type does not accept.
//
// NOTHING in this file reads the `maintenance` schema. An earlier version
// polled `job_cards` and `machines`; both are gone, along with the untyped
// client that reaching another schema required. See prompts.ts for why.

type StoppageRow    = Database['production']['Tables']['timesheet_stoppages']['Row']
type StoppageInsert = Database['production']['Tables']['timesheet_stoppages']['Insert']
type TimesheetRow    = Database['production']['Tables']['prod_timesheets']['Row']
type TimesheetInsert = Database['production']['Tables']['prod_timesheets']['Insert']

// Not `as any`: the input stays `Partial<Row>`, so a misspelled or non-existent
// column is still a type error at the call site — which is the whole point, and
// what a bare `as any` on the payload gives up.
const stoppageWrite  = (w: Partial<StoppageRow>)  => w as unknown as StoppageInsert
const timesheetWrite = (w: Partial<TimesheetRow>) => w as unknown as TimesheetInsert

/**
 * A value bound for a `jsonb` column.
 *
 * `Json` in database.types.ts is a recursive union, and an interface carrying
 * OPTIONAL properties does not structurally satisfy it even when it serialises
 * perfectly — `{ notes?: string }` is not assignable, because `undefined` is
 * not `Json`. The conversion is real (both callers pass plain data), so it is
 * asserted here once rather than at each column. `undefined` fields are dropped
 * by JSON.stringify on the way out, which is the behaviour both callers want.
 */
type JsonValue = TimesheetRow['breaks']
const asJson = (v: unknown): JsonValue => v as JsonValue

// ── Row ⇄ Stoppage ───────────────────────────────────────────────────────────

const COLS =
  'id,kind,started_at,ended_at,notes,machine,area,job_card_id,source,voided_at,' +
  'supervisor_verdict,supervisor_name,supervisor_employee_id,supervisor_signed_at,' +
  'supervisor_note,notified_at,supervisor_requested_at,supervisor_request_count'

function toStoppage(r: StoppageRow): Stoppage {
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
    supervisorRequestedAt:  r.supervisor_requested_at ?? null,
    supervisorRequestCount: Number(r.supervisor_request_count ?? 0),
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
  return ((data as StoppageRow[] | null) ?? []).map(toStoppage)
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
  const { error } = await table().upsert(stoppageWrite({
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
    // Carried through rather than omitted: this is an UPSERT, so on the insert
    // path an omitted column takes its default and would silently reset a call
    // the operator had already made.
    supervisor_requested_at:  s.supervisorRequestedAt,
    supervisor_request_count: s.supervisorRequestCount,
    updated_at:  new Date().toISOString(),
  }), { onConflict: 'id' })
  if (error) throw new Error(`Could not save the stoppage: ${error.message}`)
}

/**
 * Call a supervisor to come and confirm a breakdown.
 *
 * The operator's "submit". Without this the screen said "awaiting supervisor
 * confirmation" and then nothing happened — there was no way to actually ask
 * anyone, so the sheet sat unsigned until somebody wandered past the tablet.
 *
 * Repeatable on purpose. A supervisor who did not come the first time is the
 * case this exists for, and `supervisor_request_count` records how many times
 * they were asked — so a shift report can tell "never asked" apart from "asked
 * four times and ignored", which are different problems with different people
 * at fault.
 *
 * Returns the timestamp recorded, or null if the call could not be sent. The
 * stamp is written only AFTER the notification is accepted: stamping first
 * would show the operator "supervisor called" for a call that never left.
 */
export async function callSupervisor(args: {
  stoppageId:   string
  sectionId:    string
  area:         string | null
  description:  string
  operatorName: string
  startedAt:    string
  /** How many times they have been asked already, for the message. */
  previousCalls: number
}): Promise<string | null> {
  try {
    const res = await fetch('/api/production/stoppage/call-supervisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`call-supervisor route returned ${res.status}`)
    const body = await res.json().catch(() => ({}))
    const at = body.requestedAt ?? new Date().toISOString()
    const { error } = await table().update(stoppageWrite({
      supervisor_requested_at:  at,
      supervisor_request_count: args.previousCalls + 1,
      updated_at:               new Date().toISOString(),
    })).eq('id', args.stoppageId)
    if (error) throw new Error(error.message)
    return at
  } catch (e) {
    console.warn('[operator-timesheet] could not call a supervisor:', e)
    return null
  }
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
  const { error } = await table().update(stoppageWrite({
    supervisor_verdict:     args.verdict,
    supervisor_name:        args.supervisorName,
    supervisor_employee_id: args.employeeId,
    supervisor_signed_at:   new Date().toISOString(),
    supervisor_note:        args.note?.trim() || null,
    updated_at:             new Date().toISOString(),
  })).eq('id', args.stoppageId)
  if (error) throw new Error(`Could not record the signature: ${error.message}`)
}

/**
 * Mark a stoppage as having been reported to the team that owns it.
 *
 * Written AFTER the notification is accepted, never before: a stamp written
 * first would suppress the retry when the send actually failed, and the
 * maintenance manager would never hear about the breakdown at all.
 */
export async function markNotified(stoppageId: string, at: string): Promise<void> {
  const { error } = await table()
    .update(stoppageWrite({ notified_at: at, updated_at: new Date().toISOString() }))
    .eq('id', stoppageId)
  if (error) throw new Error(`Could not record the notification: ${error.message}`)
}

/**
 * Tell whichever team can act that the line has stopped, then stamp the row so
 * it is never sent twice.
 *
 * The OPERATOR stopped the machine and the operator logged it — this only
 * carries the news. Which team is decided server-side from the stoppage kind
 * (`STOPPAGE_META[kind].notify`): maintenance for a breakdown or a power
 * failure, IT for the system being down, the production supervisors for a
 * material or quality hold.
 *
 * Goes through an API route because `notify()` is server-only — it writes other
 * users' notification rows with the service-role client, which a browser
 * session cannot and must not be able to do.
 *
 * Returns HOW MANY people were actually reached, or null if the call failed.
 *
 * The count matters, and returning a bare boolean was a bug. The route answers
 * `ok` even when it finds nobody to tell — deliberately, so the row gets
 * stamped and the app stops retrying a send that can never succeed — and the
 * caller then told the operator "maintenance knows" when nobody had been told.
 * Zero is a real answer and has to travel, or this is the silent no-op class in
 * feedback_silent_noop_latches all over again, on the one screen where the
 * consequence is a machine nobody comes to fix.
 *
 * A failure (null) is deliberately quiet at the call site: the stoppage is
 * already saved, and an operator mid-shift cannot act on "the notification
 * service is down". It retries on the next render, because `notified_at` is
 * still null.
 */
export async function reportStoppage(args: {
  stoppageId:   string
  sectionId:    string
  kind:         StoppageKind
  area:         string | null
  description:  string
  operatorName: string
  startedAt:    string
}): Promise<number | null> {
  try {
    const res = await fetch('/api/production/stoppage/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!res.ok) throw new Error(`notify route returned ${res.status}`)
    const body = await res.json().catch(() => ({}))
    await markNotified(args.stoppageId, body.notifiedAt ?? new Date().toISOString())
    return Number(body.notified ?? 0)
  } catch (e) {
    console.warn('[operator-timesheet] stoppage notification failed, will retry:', e)
    return null
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
  const { error } = await table().update(stoppageWrite({
    voided_at:   new Date().toISOString(),
    voided_by:   voidedBy,
    void_reason: reason?.trim() || null,
    updated_at:  new Date().toISOString(),
  })).eq('id', id)
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
    seeded.map(s => stoppageWrite({
      id: s.id,
      ...scopeCols(scope),
      kind: s.kind, started_at: s.startedAt, ended_at: s.endedAt,
      notes: null, machine: null, area: null, job_card_id: null,
      source: s.source, voided_at: null,
    })),
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
  const r = data as Pick<TimesheetRow,
    'shift_start' | 'shift_end' | 'notes' | 'confirmed' | 'confirmed_at' | 'worked_minutes'>
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
  const { error } = await getDb().schema('production').from('prod_timesheets').upsert(timesheetWrite({
    ...scopeCols(scope),
    notes:      note.trim() || null,
    updated_at: new Date().toISOString(),
  }), { onConflict: 'session_id,operator_name' })
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

  const { error } = await getDb().schema('production').from('prod_timesheets').upsert(timesheetWrite({
    ...scopeCols(args),
    shift_start:    args.shiftStart,
    shift_end:      args.shiftEnd,
    breaks:         asJson(breaks),
    notes:          args.notes?.trim() || null,
    worked_minutes: worked,
    derived_data:   asJson({ source: 'stoppage_ledger', stoppages: args.stoppages }),
    confirmed:      true,
    confirmed_by:   args.operatorName,
    confirmed_at:   new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  }), { onConflict: 'session_id,operator_name' })

  if (error) throw new Error(`Could not save the timesheet: ${error.message}`)
}

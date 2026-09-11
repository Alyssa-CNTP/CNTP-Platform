/**
 * Feature flags.
 *
 * Mount features with plain conditional rendering:
 *
 *     {flags.supervisorAdjustments && <SupervisorAdjustments />}
 *
 * Deliberately NOT a dynamic slot/hook registry. A registry resolves features at
 * runtime, which hides control flow from TypeScript — the same class of problem
 * as the `as any` casts this architecture is unwinding. Plain booleans keep the
 * React tree readable and the compiler in charge. See ARCHITECTURE.md §3.
 *
 * Flags are build-time constants, not per-user targeting. A flag exists so a
 * half-finished feature can sit on `staging` without reaching operators, and so
 * a misbehaving one can be turned off in a one-line revert rather than a
 * rollback of the whole deploy.
 */

/**
 * ── EVERY CALL SITE MUST PASS `process.env.NEXT_PUBLIC_FF_X` DIRECTLY ────────
 *
 * These take the VALUE, not the name. That is not a style preference; it is the
 * whole reason flags work in the browser at all.
 *
 * Next replaces `process.env.NEXT_PUBLIC_FOO` with a literal at build time by
 * matching the *static member access* in the source. It cannot replace
 * `process.env[name]`, because the key is only known at runtime — and in the
 * client bundle `process` is a polyfill whose `env` is literally `{}`. So a
 * dynamic lookup compiles to `{}[name]` → `undefined` → the fallback, forever,
 * no matter what the environment says.
 *
 * These helpers previously took a NAME and did exactly that. The effect was
 * silent and total: **every flag in this file was permanently stuck at its
 * fallback in the browser.** Setting NEXT_PUBLIC_FF_PASTEURISER_LABELS=true on
 * staging and rebuilding changed nothing, and nothing anywhere reported a
 * problem — the flag simply read false. Confirmed against the built bundle:
 * `NEXT_PUBLIC_SUPABASE_URL` does not appear by name (its value was inlined),
 * while every flag name appears verbatim as a string argument and no value
 * ever does.
 *
 * Server-side the old form worked, because Node has a real `process.env` — so
 * an API route and a client component could disagree about the same flag. That
 * is worse than a flag that is simply off.
 *
 * `flags-inlining.test.ts` fails the build if a dynamic lookup comes back.
 */
function envFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

/**
 * A per-section rollout flag: a comma-separated list of section ids, or 'all'.
 *
 * Unset means none. 'true'/'1' are accepted as synonyms for 'all' so an
 * environment already set to the old boolean form does not silently mean
 * "no sections" after this changed shape.
 *
 * Takes the value, not the name — see the note above.
 */
function sectionSetFlag(raw: string | undefined): ReadonlySet<string> {
  const value = (raw ?? '').trim().toLowerCase()
  if (!value) return new Set()
  if (value === 'all' || value === 'true' || value === '1') return new Set(['*'])
  return new Set(value.split(',').map(s => s.trim()).filter(Boolean))
}

export const flags = {
  /**
   * Supervisor adjustment page — Tier 1 corrections on open sessions,
   * Tier 2 stock adjustments on submitted ones. See ARCHITECTURE.md §6.
   */
  supervisorAdjustments: envFlag(process.env.NEXT_PUBLIC_FF_SUPERVISOR_ADJUSTMENTS, false),

  /**
   * Read bag totals from the append-only ledger instead of prod_bagging.
   * Stays false through the dual-write shadow period: the ledger is written
   * and reconciled while prod_bagging remains authoritative. Flipping this is
   * the cutover, and flipping it back is the rollback.
   */
  ledgerAuthoritative: envFlag(process.env.NEXT_PUBLIC_FF_LEDGER_AUTHORITATIVE, false),

  /**
   * Sections that mint serials under the current scheme (ARCHITECTURE.md §5),
   * with the sequence allocated by production.next_bag_seq. Everything else
   * keeps the historic per-section format and the app-side max+1 seeding.
   *
   * A SET, not a boolean, because the flag's own contract is "rolled out one
   * section at a time" and a boolean cannot express that. Serials are printed
   * onto physical bags: a bad rollout is not undone by reverting code, so the
   * blast radius has to be one line in the environment, one section wide.
   *
   *     NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION=sieving
   *     NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION=sieving,granule
   *     NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION=all      (every section)
   *     unset / empty                                (none — the default)
   */
  dbSerialSections: sectionSetFlag(process.env.NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION),

  /**
   * Sections whose operator timesheet is scoped to the SHIFT rather than to
   * one capture session. See lib/core/timesheet/shift-scope.ts for why that
   * distinction exists and what it fixes.
   *
   * Defaults to the two blenders. Unlike every other flag here that is a
   * default of ON for those sections, deliberately: the per-session
   * behaviour it replaces is a data bug, not a feature waiting to be
   * revealed, and the Blender is where it actually bites today. Set the
   * variable to an empty string to go back to per-session everywhere.
   */
  shiftScopedTimesheetSections: sectionSetFlag(
    process.env.NEXT_PUBLIC_FF_SHIFT_SCOPED_TIMESHEET ?? 'blender,smallblender',
  ),

  /**
   * The Pasteuriser finished-product label workflow: design -> proof ->
   * Control Union / customer approval -> PO -> job card -> print.
   *
   * Off by default so the whole chain can sit on staging while the thirteen
   * existing BarTender designs are transcribed and re-approved. Turning it off
   * hides the nav entries and the job-card label picker; it does NOT hide the
   * routes themselves, which stay behind their own permissions — a flag is a
   * rollout control, not an access control.
   */
  pasteuriserLabels: envFlag(process.env.NEXT_PUBLIC_FF_PASTEURISER_LABELS, false),

  /**
   * Resolve Acumatica item codes against the synced master inventory
   * (features/acumatica-items) instead of building them from the templates in
   * lib/production/acumatica-codes.ts.
   *
   * A plain boolean, not a per-section set like the serial flag: an item code
   * is not printed on anything and is not an identity — it is a field on a row
   * that can be corrected afterwards, so the blast radius of a bad flip is a
   * re-save rather than a re-labelled pallet.
   *
   * ON is the more truthful behaviour, not merely the newer one: the templates
   * can emit ids that do not exist in Acumatica (20BGGE-001-RC and the whole
   * Granule -002 family), and the resolver refuses to. Expect codes that used
   * to appear silently to become a visible "not in the master inventory"
   * warning — that is the point, and those bags were failing the import
   * already.
   */
  acumaticaResolver: envFlag(process.env.NEXT_PUBLIC_FF_ACUMATICA_RESOLVER, false),

  /**
   * The mid-shift grade/variant changeover UI (features/changeover).
   *
   * DEFAULTS TO TRUE, unlike every other flag here, and the reason matters.
   * This is not a half-finished feature waiting to reach operators — it is
   * shipped, working behaviour on staging. A flag that defaulted to false would
   * silently remove a control supervisors use the moment this merged, and the
   * floor would report it as "the changeover is gone" with nothing in the logs.
   * That is the silent-latch failure mode, not a safe default.
   *
   * The flag exists for the PROMOTION. `main` removed this button because it was
   * broken, so the changeover must arrive on production switched OFF and be
   * turned on deliberately once a shift has run against it.
   *
   *     NEXT_PUBLIC_FF_CHANGEOVER=false     <- REQUIRED in production's env,
   *                                            in the same change that ships it
   *
   * Setting it is part of that cherry-pick, not a follow-up. See
   * docs/capture-phases.md, promotion order step 4.
   */
  changeover: envFlag(process.env.NEXT_PUBLIC_FF_CHANGEOVER, true),

  /**
   * The live operator timesheet (features/operator-timesheet) — a stoppage
   * ledger written as things happen, replacing the sign-off-time form in
   * `TimesheetConfirm`.
   *
   * DEFAULTS TO TRUE, for the same reason `changeover` does and one more.
   *
   * The old component is not merely older, it is LOSING DATA: its load effect
   * keys on the operator-name input, so typing a name resets the sheet to the
   * standard tea/lunch schedule and discards every stoppage the operator
   * logged. Defaulting this off would leave the floor on the broken path and
   * make fixing it an environment change somebody has to remember — which is
   * how the flag-inlining bug above stayed invisible for a whole release.
   *
   * Turning it OFF is still a one-line rollback to the old component, which is
   * what a flag is for. What it must not be is the default.
   *
   * REQUIRES migration 20260909_002_timesheet_stoppages.sql. With the flag on
   * and the migration unapplied the timesheet shows a read error and capture
   * carries on — the failure is visible and contained, not silent.
   */
  operatorTimesheet: envFlag(process.env.NEXT_PUBLIC_FF_OPERATOR_TIMESHEET, true),

  /**
   * The shift clock (features/shift-clock) — the operator's timesheet starts at
   * LOGIN and stops at LOGOUT, instead of at the first capture-page heartbeat.
   *
   * DEFAULTS TO TRUE, for the same reason `operatorTimesheet` does: the
   * behaviour it replaces is not merely older, it is WRONG. Shift start was the
   * first `capture_activity` stamp, which only `/production/capture/[section]`
   * writes — so an operator who reached the tablet at 08h40 had a 08h40 start,
   * and one who never opened Sign-off fell back to the earliest scheduled
   * break and read 10:30.
   *
   * Turning it OFF is a one-line rollback to that behaviour, which is what a
   * flag is for. What it must not be is the default: leaving the floor on the
   * broken path and making the fix an environment variable somebody has to
   * remember is how the flag-inlining bug above survived a whole release.
   *
   * REQUIRES migration 20260911_020_operator_shift_clock.sql. With the flag on
   * and the migration unapplied the clock writes fail, `db.ts` swallows them,
   * and the timesheet falls back to the old derivation — visible in the console,
   * contained, and no worse than before.
   */
  shiftClock: envFlag(process.env.NEXT_PUBLIC_FF_SHIFT_CLOCK, true),
} as const

export type FeatureFlag = keyof typeof flags

/**
 * Does this section mint serials under the current scheme yet?
 *
 * The one place the rollout is decided. Call it with the SECTION ID
 * ('refining1', not 'refining') — the two Refining lines roll out separately.
 */
export function usesDbSerials(sectionId: string): boolean {
  return flags.dbSerialSections.has('*') || flags.dbSerialSections.has(String(sectionId))
}


/**
 * Does this section keep ONE timesheet per operator per shift, rather than
 * one per capture session? See lib/core/timesheet/shift-scope.ts.
 *
 * Defaults to the two blenders, not to everything, because the Blender is the
 * section that actually runs several blends in a shift — and a change to
 * where an operator's hours are written is not something to switch on for
 * five lines at once. Widen it by naming more sections; set it to an empty
 * string to go back to per-session behaviour everywhere.
 *
 * Takes the VALUE of the env var, not its name — see the note at the top of
 * this file. `?? ` supplies the default after Next has inlined the literal,
 * so the default survives into the browser bundle.
 */
export function usesShiftScopedTimesheet(sectionId: string): boolean {
  return flags.shiftScopedTimesheetSections.has('*')
    || flags.shiftScopedTimesheetSections.has(String(sectionId))
}

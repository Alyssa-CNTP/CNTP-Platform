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

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

/**
 * A per-section rollout flag: a comma-separated list of section ids, or 'all'.
 *
 * Unset means none. 'true'/'1' are accepted as synonyms for 'all' so an
 * environment already set to the old boolean form does not silently mean
 * "no sections" after this changed shape.
 */
function sectionSetFlag(name: string): ReadonlySet<string> {
  const raw = (process.env[name] ?? '').trim().toLowerCase()
  if (!raw) return new Set()
  if (raw === 'all' || raw === 'true' || raw === '1') return new Set(['*'])
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
}

export const flags = {
  /**
   * Supervisor adjustment page — Tier 1 corrections on open sessions,
   * Tier 2 stock adjustments on submitted ones. See ARCHITECTURE.md §6.
   */
  supervisorAdjustments: envFlag('NEXT_PUBLIC_FF_SUPERVISOR_ADJUSTMENTS', false),

  /**
   * Read bag totals from the append-only ledger instead of prod_bagging.
   * Stays false through the dual-write shadow period: the ledger is written
   * and reconciled while prod_bagging remains authoritative. Flipping this is
   * the cutover, and flipping it back is the rollback.
   */
  ledgerAuthoritative: envFlag('NEXT_PUBLIC_FF_LEDGER_AUTHORITATIVE', false),

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
  dbSerialSections: sectionSetFlag('NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION'),

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
  acumaticaResolver: envFlag('NEXT_PUBLIC_FF_ACUMATICA_RESOLVER', false),

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
  changeover: envFlag('NEXT_PUBLIC_FF_CHANGEOVER', true),
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

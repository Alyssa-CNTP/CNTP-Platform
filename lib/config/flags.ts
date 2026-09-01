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
   * Allocate bag serial sequences via the next_bag_serial database function
   * rather than reading a max in app code. Rolled out one section at a time;
   * the old app-side seeding remains as the fallback while this is false.
   */
  dbSerialAllocation: envFlag('NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION', false),
} as const

export type FeatureFlag = keyof typeof flags

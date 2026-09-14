/**
 * Is a persisted mass-balance row inside tolerance?
 *
 * ── Why this is derived and never read from the row ────────────────────────
 *
 * Five screens — History, the Production overview, the operator and supervisor
 * dashboards — used to select `prod_mass_balance.within_tolerance`. That column
 * does not exist. No migration in this repo has ever created it, so PostgREST
 * answers the whole query with
 *
 *     400  column prod_mass_balance_1.within_tolerance does not exist
 *
 * which takes out the entire session list, not just the flag: History rendered
 * with no sessions at all and its charts drew `points="54.0,NaN"`.
 *
 * The fix is not to add the column. ARCHITECTURE.md §5 already settled this for
 * the tolerance figure itself — `production.v_session_yield` derives it in SQL
 * rather than reading `prod_mass_balance.tolerance_kg`, because every row
 * written before the ±1% rule carries the old flat 15 kg and trusting the
 * stored value would leave two tolerance regimes side by side on one screen. A
 * stored `within_tolerance` boolean is the same trap one step further on: it
 * would be a frozen verdict computed under whichever rule was live the day the
 * row was written, and `live/capture/page.tsx` still writes exactly that with
 * `Math.abs(balance) <= 15`.
 *
 * So the verdict is computed from the two figures that are genuinely stored —
 * the balance and the input that produced it — against the one tolerance rule
 * in `lib/core/mass-balance/tolerance.ts`.
 *
 * ── null is not "out of tolerance" ─────────────────────────────────────────
 *
 * A session with no mass-balance row, or with no input captured yet, is "not
 * started", not "unaccounted for". Every caller tests `=== false` to decide
 * whether to flag, so returning null keeps an un-captured session off the
 * exception list instead of filling the screen with false alarms.
 */

import { withinMassBalanceTolerance } from '@/lib/core/mass-balance/tolerance'

export function massBalanceFlag(
  totalInputKg: number | null | undefined,
  balanceKg: number | null | undefined,
): boolean | null {
  const input = Number(totalInputKg)
  const balance = Number(balanceKg)
  if (!Number.isFinite(input) || input <= 0) return null
  if (balanceKg == null || !Number.isFinite(balance)) return null
  return withinMassBalanceTolerance(balance, input)
}

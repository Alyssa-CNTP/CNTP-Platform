/**
 * Floor-operator login helpers — shared by the provisioning API (server) and
 * the floor login page (client) so the derived password matches on both sides.
 *
 * Operators only ever type their 4-digit PIN. Supabase requires a password of
 * at least 6 characters, so we derive a longer deterministic password from the
 * PIN + the operator's synthetic email. The effective secret is still the
 * 4-digit PIN — this only satisfies Supabase's length rule.
 */

export const FLOOR_EMAIL_DOMAIN = 'floor.rooibostea.co.za'

/** Generate a unique synthetic email for a new operator auth account. */
export function newFloorEmail(): string {
  // Random local part — guaranteed unique, never shown to the operator.
  const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()
  return `op-${rand}@${FLOOR_EMAIL_DOMAIN}`
}

/** Deterministic Supabase password from PIN + email. Must match on create + login. */
export function deriveAuthPassword(pin: string, email: string): string {
  return `flr_${pin}_${email}`.slice(0, 64)
}

/** Permission overrides given to floor-operator app_roles so they can reach capture. */
export const FLOOR_OPERATOR_PERMISSIONS = {
  can_submit_count:       true,
  can_view_ops_dashboard: true,
  can_start_live_session: true,
  can_scan_inputs:        true,
  can_add_outputs:        true,
} as const

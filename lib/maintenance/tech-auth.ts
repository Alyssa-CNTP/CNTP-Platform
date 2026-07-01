/**
 * Maintenance-technician login helpers — mirrors lib/production/operator-auth.ts.
 *
 * Technicians sign in with a 4-digit PIN. Supabase requires passwords ≥ 6 chars,
 * so we derive a deterministic password from PIN + synthetic email. The synthetic
 * email is internal — technicians never see it. The effective secret is the PIN.
 */

export const MAINT_EMAIL_DOMAIN = 'maint.rooibostea.co.za'

/** Generate a unique synthetic email for a new technician auth account. */
export function newMaintEmail(): string {
  const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()
  return `tech-${rand}@${MAINT_EMAIL_DOMAIN}`
}

/** Deterministic Supabase password from PIN + email. Must match on create + login. */
export function deriveMaintPassword(pin: string, email: string): string {
  return `mnt_${pin}_${email}`.slice(0, 64)
}

/** Permissions granted to a maintenance_technician app_roles row. */
export const MAINT_TECH_PERMISSIONS = {
  can_view_maintenance:    true,
  can_raise_breakdown:     true,
  can_log_maintenance_work: true,
} as const

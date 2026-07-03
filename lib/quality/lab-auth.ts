/**
 * Quality lab assistant login helpers — mirrors lib/maintenance/tech-auth.ts.
 *
 * Lab assistants sign in with a 4-digit PIN. Supabase requires passwords ≥ 6 chars,
 * so we derive a deterministic password from PIN + synthetic email. The effective
 * secret is the PIN; the synthetic email is internal and never shown.
 */

export const LAB_EMAIL_DOMAIN = 'lab.rooibostea.co.za'

/** Generate a unique synthetic email for a new lab assistant auth account. */
export function newLabEmail(): string {
  const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()
  return `lab-${rand}@${LAB_EMAIL_DOMAIN}`
}

/** Deterministic Supabase password from PIN + email. Must match on create + login. */
export function deriveLabPassword(pin: string, email: string): string {
  return `lab_${pin}_${email}`.slice(0, 64)
}

/** Permissions granted to a quality_lab_assistant app_roles row. */
export const LAB_ASSISTANT_PERMISSIONS = {
  can_save_records:     true,
  can_create_runs:      true,
  can_add_samples:      true,
  can_add_tastings:     true,
  can_add_sieving_runs: true,
} as const

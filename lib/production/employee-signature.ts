// lib/production/employee-signature.ts
// Signatures live on the Staff Directory record (production.employees), set
// once from a person's own profile, verified server-side before ever being
// applied to a job card — see app/api/me/signature and
// app/api/staff/[id]/signature. Supersedes the old draw-every-time
// user-signature.ts helper.

import { getDb } from '@/lib/supabase/db'

export interface MySignatureStatus {
  employeeId: string | null
  employeeName: string | null
  hasSignature: boolean
}

export async function getMySignatureStatus(): Promise<MySignatureStatus> {
  try {
    const res = await fetch('/api/me/signature')
    if (!res.ok) return { employeeId: null, employeeName: null, hasSignature: false }
    return await res.json()
  } catch {
    return { employeeId: null, employeeName: null, hasSignature: false }
  }
}

// The exact wording shown at the moment of consent — stored verbatim on the
// row (see 20260730_004_employee_signature_consent.sql) so a later copy
// change never rewrites what someone actually agreed to.
export const SIGNATURE_CONSENT_TEXT_SELF =
  'I confirm this is my own signature and I consent to CNTP storing it and using it on this platform to sign records on my behalf (e.g. job cards, shift reports, dispatch documents).'

// TEMPORARY, for initial platform setup only: senior_developer/co_developer
// can set a signature on someone else's behalf (see app/api/staff/[id]/signature
// route.ts). This wording is deliberately honest about that — it never claims
// the employee consented themselves, and set_by records who actually did this.
export const SIGNATURE_CONSENT_TEXT_ADMIN_SETUP = (employeeName: string) =>
  `Signature set up on behalf of ${employeeName} by a developer during platform setup, with their permission. Going forward, ${employeeName} should redraw and consent to their own signature from their own login.`

export async function setEmployeeSignature(employeeId: string, signature: string, consentText: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/staff/${employeeId}/signature`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature, consentText }),
  })
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({}))
  return { ok: false, error: body.error || 'Could not save signature' }
}

export async function loadEmployeeSignature(employeeId: string | null): Promise<string | null> {
  if (!employeeId) return null
  const { data } = await getDb().schema('production').from('employee_signatures')
    .select('signature').eq('employee_id', employeeId).maybeSingle()
  return (data as any)?.signature ?? null
}

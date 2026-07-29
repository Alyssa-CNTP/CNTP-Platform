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

export async function setEmployeeSignature(employeeId: string, signature: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/staff/${employeeId}/signature`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature }),
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

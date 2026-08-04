// app/api/staff/[id]/signature/route.ts
// PUT — set/replace an employee's on-file signature. Gate: strictly your own
// Staff Directory record, resolved server-side via the app_roles link, never
// trusted from the client — a signature drawn by someone other than its
// owner is exactly what this platform must never allow, since every "Verify
// & Sign" downstream trusts whatever image sits on this row.
//
// TEMPORARY exception while the platform is being set up: senior_developer
// and co_developer may set a signature on someone else's behalf. This is
// narrower than the old can_edit_staff_profiles bypass (HR onboarding) that
// used to live here — it's role-based, not permission-based, and deliberately
// not the same escape hatch. Remove this exception once setup is done.
//
// Also requires explicit consent (see 20260730_004_employee_signature_consent.sql)
// — this route is the only way to set a signature at all, since
// production.employee_signatures has no write policy for `authenticated`.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'

const SETUP_OVERRIDE_ROLES = new Set(['senior_developer', 'co_developer'])

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: employeeId } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const myEmployeeId = await resolveEmployeeId(caller.userId)
  const isSelf = myEmployeeId === employeeId
  const isSetupOverride = !isSelf && SETUP_OVERRIDE_ROLES.has(caller.role ?? '')
  if (!isSelf && !isSetupOverride) {
    return NextResponse.json({ error: 'You can only set up your own signature — log in as yourself.' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const signature = typeof body?.signature === 'string' ? body.signature : null
  const consentText = typeof body?.consentText === 'string' ? body.consentText.trim() : null
  if (!signature) return NextResponse.json({ error: 'A signature is required' }, { status: 400 })
  if (!consentText) return NextResponse.json({ error: 'Consent is required to store a signature' }, { status: 400 })

  const admin = getAdminClient() as any
  const { error } = await admin.schema('production').from('employee_signatures')
    .upsert({
      employee_id: employeeId,
      signature,
      consent_text: consentText,
      consent_given_at: new Date().toISOString(),
      set_by: caller.userId,
    } as any, { onConflict: 'employee_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

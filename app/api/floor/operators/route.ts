// app/api/floor/operators/route.ts
// Public list of active floor operators for the unauthenticated floor login.
// Returns ONLY non-sensitive fields (id, display name, synthetic email) — never the PIN.

import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/auth/server-helpers'

export async function GET() {
  try {
    const admin = getAdminClient()
    const { data, error } = await admin.schema('production').from('operators')
      .select('id, display_name, name, auth_email, section_ids')
      .eq('active', true)
      .not('auth_email', 'is', null)
      .order('name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const operators = (data ?? []).map((o: any) => ({
      id:           o.id,
      display_name: o.display_name || o.name,
      email:        o.auth_email,
      section_ids:  o.section_ids ?? [],
    }))
    return NextResponse.json(operators)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

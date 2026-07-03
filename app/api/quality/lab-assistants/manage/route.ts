// app/api/quality/lab-assistants/manage/route.ts
// Quality manager / lab manager / IT only.
// Returns all lab assistants sourced from the shift roster (qc category roles),
// excluding staff who sign in with Microsoft, enriched with PIN + section_ids.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

const QC_ROLE_KEYS = ['qc_supervisor', 'qc', 'lab_analyst', 'incoming_goods_qc']

// These staff use Microsoft SSO — exclude them from the PIN login list.
const MICROSOFT_STAFF = new Set([
  'monique', 'tamlyn', 'shannon', 'cyril', 'michelle', 'lucinda', 'amoretta',
])

function normName(n: string) { return (n ?? '').trim().toLowerCase() }

function isMicrosoftStaff(name: string): boolean {
  const norm = normName(name)
  // Match on first name only so "Monique van der Berg" is still excluded.
  const firstName = norm.split(/\s+/)[0]
  return MICROSOFT_STAFF.has(firstName)
}

export async function GET() {
  try {
    const caller = await getCallerPermissions()
    const ok =
      (caller as any).can?.('can_manage_users') ||
      (caller as any).role === 'quality_manager' ||
      (caller as any).role === 'lab_manager' ||
      (caller as any).department === 'IT' ||
      (caller as any).isFullAdmin ||
      (caller as any).isIT
    if (!ok) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const admin = getAdminClient()

    // 1. All unique names from roster with a qc role.
    const { data: rosterRows, error: rosterErr } = await admin
      .schema('production' as any)
      .from('roster_entries')
      .select('person_name, role_key')
      .in('role_key', QC_ROLE_KEYS)
    if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })

    // Deduplicate by normalised name; keep display name + role. Exclude Microsoft staff.
    const nameMap = new Map<string, { display: string; role: string }>()
    for (const r of rosterRows ?? []) {
      if (!r.person_name) continue
      if (isMicrosoftStaff(r.person_name)) continue
      const norm = normName(r.person_name)
      if (!nameMap.has(norm)) {
        nameMap.set(norm, { display: r.person_name, role: r.role_key })
      }
    }
    if (!nameMap.size) return NextResponse.json([])

    // 2. lab_auth rows — keyed by full_name (normalised).
    const { data: authRows } = await admin
      .schema('qms' as any)
      .from('lab_auth')
      .select('user_id, full_name, pin, section_ids, active')
    const authByName = new Map<string, any>()
    for (const r of authRows ?? []) {
      if (r.full_name) authByName.set(normName(r.full_name), r)
    }

    // 3. Assemble.
    const assistants = [...nameMap.entries()].map(([norm, { display, role }]) => {
      const authRow = authByName.get(norm)
      return {
        full_name:   display,
        role,
        has_pin:     !!authRow?.pin,
        pin:         authRow?.pin ?? null,
        section_ids: authRow?.section_ids ?? [],
        is_active:   authRow?.active ?? true,
        user_id:     authRow?.user_id ?? null,
      }
    }).sort((a, b) => a.full_name.localeCompare(b.full_name))

    return NextResponse.json(assistants)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

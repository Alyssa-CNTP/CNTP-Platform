// app/api/quality/lab-assistants/manage/route.ts
// Quality manager / lab manager / IT only.
// Returns all lab assistants sourced from BOTH the shift roster (qc category
// roles) AND the Staff Directory (production.employees, department = QC) — so a
// newly-added QC person appears here for a PIN even before they're rostered.
// Microsoft-SSO staff are excluded; each row is enriched with PIN + section_ids.

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

    // Also include everyone in the Staff Directory under the QC department, even
    // if not yet placed on the shift roster — so the lab manager can assign a PIN
    // the moment a QC person is added. Roster entries take precedence (they carry
    // a specific role); staff-directory-only people show as generic 'qc'.
    const { data: qcStaff } = await admin
      .schema('production' as any)
      .from('employees')
      .select('id, name, display_name, department, active')
      .ilike('department', 'qc')
    // Employee id by normalised name, so a PIN can be linked to the Staff
    // Directory profile by ID rather than matched by name later.
    const empIdByName = new Map<string, string>()
    for (const e of qcStaff ?? []) {
      if (e.active === false) continue
      const display = (e.display_name || e.name || '').trim()
      if (!display || isMicrosoftStaff(display)) continue
      const norm = normName(display)
      if (e.id && !empIdByName.has(norm)) empIdByName.set(norm, e.id)
      if (!nameMap.has(norm)) nameMap.set(norm, { display, role: 'qc' })
    }

    if (!nameMap.size) return NextResponse.json([])

    // 2. lab_auth rows — keyed by full_name (normalised).
    const { data: authRows } = await admin
      .schema('qms' as any)
      .from('lab_auth')
      .select('user_id, full_name, pin, section_ids, active, employee_id')
    const authByName = new Map<string, any>()
    for (const r of authRows ?? []) {
      if (r.full_name) authByName.set(normName(r.full_name), r)
    }

    // 3. Assemble. Deliberately no `pin` field — the actual value is only ever
    // fetched on demand, per-person, via the reveal route (see ./reveal/route.ts).
    const assistants = [...nameMap.entries()].map(([norm, { display, role }]) => {
      const authRow = authByName.get(norm)
      return {
        full_name:   display,
        role,
        has_pin:     !!authRow?.pin,
        section_ids: authRow?.section_ids ?? [],
        is_active:   authRow?.active ?? true,
        user_id:     authRow?.user_id ?? null,
        // Prefer an existing account's link, else the Staff Directory match.
        employee_id: authRow?.employee_id ?? empIdByName.get(norm) ?? null,
      }
    }).sort((a, b) => a.full_name.localeCompare(b.full_name))

    return NextResponse.json(assistants)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

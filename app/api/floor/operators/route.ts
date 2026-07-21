// app/api/floor/operators/route.ts
// Public list of active floor operators for the unauthenticated floor login.
// Returns ONLY non-sensitive fields (id, display name, synthetic email) — never the PIN.
// Also resolves on_shift via the roster (server-side, admin client bypasses RLS).

import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/auth/server-helpers'

// Resolve "today" + the current shift in SAST (Africa/Johannesburg), independent
// of the server's timezone. The VPS runs in UTC, so new Date().getHours() /
// toISOString() placed the day/night boundary — and the date, around midnight —
// two hours off, which is what made this on-shift list disagree with the roster.
// Mirrors sastNow() in app/(app)/production/roster/page.tsx (the roster's own
// "On duty" logic), so both read the roster the same way.
function sastNow() {
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false,
  }).format(now))
  const shift = hour >= 7 && hour < 16 ? 'day' : 'night'
  return { date, shift }
}

export async function GET() {
  try {
    const admin = getAdminClient()
    const { date: today, shift } = sastNow()

    const [{ data, error }, { data: rosterRows }] = await Promise.all([
      admin.schema('production').from('operators')
        .select('id, display_name, name, auth_email, section_ids')
        .eq('active', true)
        .not('auth_email', 'is', null)
        .order('name'),

      // Roster entries for today's shift — operator_id references production.operators.id
      admin.schema('production' as any).from('roster_entries')
        .select('operator_id, roster_periods!inner(start_date, end_date)')
        .eq('shift', shift)
        .not('operator_id', 'is', null)
        .lte('roster_periods.start_date', today)
        .gte('roster_periods.end_date',   today),
    ])

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const onShift = new Set((rosterRows ?? []).map((r: any) => r.operator_id).filter(Boolean))

    const operators = (data ?? []).map((o: any) => ({
      id:           o.id,
      display_name: o.display_name || o.name,
      email:        o.auth_email,
      section_ids:  o.section_ids ?? [],
      on_shift:     onShift.has(o.id),
    }))

    return NextResponse.json(operators)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal server error' }, { status: 500 })
  }
}

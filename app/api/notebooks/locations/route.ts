// app/api/notebooks/locations/route.ts
// GET — the sites that have a GRN/DN book, in display order. The `code` is
// also the prefix every number in that site's books carries.

import { NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { listLocations } from '@/lib/notebooks/server'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_access_notebooks')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  try {
    return NextResponse.json({ locations: await listLocations() })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not load sites' }, { status: 500 })
  }
}

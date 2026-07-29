// app/api/axis/intelligence-hub/route.ts
// Read-only data for the AXIS dashboard's Intelligence Hub radial. Returns
// all-time cell counts (business_function x capability_layer) plus overall
// categorization progress and the most recent categorize-job status.
//
// Deliberately separate from /api/axis/dashboard: that route fetches a
// recent, capped (200-row) window of change_logs for the operational charts.
// The Hub's counts must be cumulative/all-time so wedges only ever grow as
// more gets built — reusing the capped fetch would make a wedge's count a
// rolling window that can shrink, which is exactly what this is meant to avoid.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { isBusinessFunction, isCapabilityLayer } from '@/lib/axis/hub-taxonomy'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const admin = getAdminClient()
  const axis = (admin as any).schema('axis')

  const [{ data: categorized, error: catErr }, totalRes, categorizedRes, logRes] = await Promise.all([
    axis.from('change_logs').select('business_function, capability_layer').not('business_function', 'is', null),
    axis.from('change_logs').select('id', { count: 'exact', head: true }),
    axis.from('change_logs').select('id', { count: 'exact', head: true }).not('categorized_at', 'is', null),
    axis.from('change_log_categorization_log').select('finished_at, status').order('started_at', { ascending: false }).limit(1),
  ])

  if (catErr) {
    console.error('[api/axis/intelligence-hub GET]', catErr)
    return NextResponse.json({ error: catErr.message }, { status: 500 })
  }

  const counts = new Map<string, number>()
  for (const row of categorized ?? []) {
    if (!isBusinessFunction(row.business_function) || !isCapabilityLayer(row.capability_layer)) continue
    const key = `${row.business_function}|${row.capability_layer}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const cells = Array.from(counts.entries()).map(([key, count]) => {
    const [business_function, capability_layer] = key.split('|')
    return { business_function, capability_layer, count }
  })

  const lastRun = logRes.data?.[0]

  return NextResponse.json({
    cells,
    totalCount: totalRes.count ?? 0,
    categorizedCount: categorizedRes.count ?? 0,
    lastRunAt: lastRun?.finished_at ?? null,
  })
}

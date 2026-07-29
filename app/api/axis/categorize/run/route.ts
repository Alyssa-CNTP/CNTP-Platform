// app/api/axis/categorize/run/route.ts
//
// Classifies uncategorized axis.change_logs rows onto the Intelligence Hub's
// business-function x capability-layer axes via Gemini. Powers:
//   • the "Recategorize now" button on the AXIS dashboard (authenticated IT caller), and
//   • the scheduled GitHub Actions cron (.github/workflows/axis-categorize.yml),
//     which presents Authorization: Bearer <CRON_SECRET>.
// Mirrors app/api/eu-mrl-sync/run/route.ts's dual-gate + run-log pattern.
//
// This route is entirely decoupled from the dashboard's read path — the Hub
// only ever reads whatever's already categorized (see /api/axis/intelligence-hub).
// A slow/failed/misconfigured Gemini call here can never block the dashboard.

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, getCallerPermissions } from '@/lib/auth/server-helpers'
import { classifyChangeLog } from '@/lib/axis/categorize'

export const maxDuration = 60

// Rows per invocation — bounded by maxDuration above (batch x ~4.5s Gemini
// pacing must fit inside the serverless time budget). Repeated cron ticks or
// manual clicks work through any remaining backlog.
const BATCH_SIZE = 10

export async function POST(req: NextRequest) {
  const authz = req.headers.get('authorization') || ''
  const isCron = !!process.env.CRON_SECRET && authz === `Bearer ${process.env.CRON_SECRET}`
  let triggeredBy = 'cron'
  if (!isCron) {
    const caller = await getCallerPermissions()
    if (!caller.userId || caller.department !== 'IT')
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    triggeredBy = caller.userId
  }

  const admin = getAdminClient()
  const axis = (admin as any).schema('axis')

  // Open a run-log row so this run is visible even if it fails midway.
  let logId: number | null = null
  try {
    const { data: logRow } = await axis
      .from('change_log_categorization_log')
      .insert({ status: 'running', triggered_by: triggeredBy })
      .select('id')
      .single()
    logId = logRow?.id ?? null
  } catch { /* logging is best-effort */ }

  const finish = async (status: string, message: string, counts?: { scanned: number; classified: number; skipped: number }) => {
    if (logId == null) return
    try {
      await axis.from('change_log_categorization_log').update({
        status, message,
        rows_scanned: counts?.scanned ?? null,
        rows_classified: counts?.classified ?? null,
        rows_skipped: counts?.skipped ?? null,
        finished_at: new Date().toISOString(),
      }).eq('id', logId)
    } catch { /* ignore */ }
  }

  const { data: rows, error } = await axis
    .from('change_logs')
    .select('id, sector, change_type, description, reason, affected_systems, source')
    .is('categorized_at', null)
    .order('created_at', { ascending: false })
    .limit(BATCH_SIZE)

  if (error) {
    await finish('error', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!rows?.length) {
    await finish('success', 'No uncategorized rows found.', { scanned: 0, classified: 0, skipped: 0 })
    return NextResponse.json({ processed: 0, succeeded: 0, failed: 0, remaining: 0 })
  }

  let succeeded = 0, failed = 0
  for (const row of rows) {
    const result = await classifyChangeLog(row)
    const now = new Date().toISOString()
    if (result.ok) {
      await axis.from('change_logs').update({
        business_function: result.business_function,
        capability_layer: result.capability_layer,
        classify_confidence: result.confidence,
        classify_reasoning: result.reasoning,
        classify_model: result.model,
        categorized_at: now,
      }).eq('id', row.id)
      succeeded++
    } else {
      // Stamp categorized_at anyway (with null function/layer) so a
      // permanently-unclassifiable or errored row doesn't get retried every
      // run forever — it shows up as "uncategorized" in the Hub's caption.
      await axis.from('change_logs').update({
        categorized_at: now,
        classify_model: result.model,
      }).eq('id', row.id)
      failed++
    }
  }

  const { count: remaining } = await axis
    .from('change_logs')
    .select('id', { count: 'exact', head: true })
    .is('categorized_at', null)

  await finish('success', `Processed ${rows.length} rows.`, {
    scanned: rows.length, classified: succeeded, skipped: failed,
  })

  return NextResponse.json({ processed: rows.length, succeeded, failed, remaining: remaining ?? 0 })
}

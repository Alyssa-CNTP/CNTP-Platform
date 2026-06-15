// app/api/acumatica/sync/route.ts
// GET /api/acumatica/sync?inquiry=<GI>&key=<KeyField>&modified=<ModifiedField>
//
// Triggers ONE incremental sync run: reads changed rows from an Acumatica GI and
// writes them into production.acumatica_sync. Reads from Acumatica, writes only to
// Supabase — never writes to Acumatica. Gated behind an app login.
//
// SPIKE NOTE: this is a GET so it's trivial to trigger from the browser while
// iterating. A production sync should be a POST run by a scheduler (cron / n8n)
// with a shared-secret header instead of relying on a user session.

import { NextResponse }              from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { syncInquiry }               from '@/lib/acumatica/sync'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  // Require a logged-in app user.
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const inquiry  = searchParams.get('inquiry')?.trim()
  const keyField = searchParams.get('key')?.trim()      || 'Name'
  const modified = searchParams.get('modified')?.trim() || 'LastModifiedOn'
  if (!inquiry) {
    return NextResponse.json({ error: 'Pass ?inquiry=<GenericInquiryName>' }, { status: 400 })
  }

  const summary = await syncInquiry(inquiry, keyField, modified)
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 })
}

// app/api/sales/feedback/route.ts
// Records a verdict (accepted / edited / discarded) against a previously-logged
// sales.ai_interactions row. Body:
//   { interaction_id: uuid, verdict: 'accepted'|'edited'|'discarded',
//     edited_response?: string, notes?: string }
//
// RLS already restricts updates to the row's owner (or IT). This route is just
// the thin write surface the UI hits when the user clicks accept / edit / bin.

import { NextResponse }       from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies }            from 'next/headers'

type Verdict = 'accepted' | 'edited' | 'discarded'
const VALID_VERDICTS: Verdict[] = ['accepted', 'edited', 'discarded']

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { interaction_id, verdict, edited_response, notes } = body as {
    interaction_id?:   string
    verdict?:          Verdict
    edited_response?:  string
    notes?:            string
  }

  if (!interaction_id) {
    return NextResponse.json({ error: 'interaction_id required' }, { status: 400 })
  }
  if (!verdict || !VALID_VERDICTS.includes(verdict)) {
    return NextResponse.json(
      { error: `verdict must be one of ${VALID_VERDICTS.join(', ')}` },
      { status: 400 },
    )
  }

  const patch: Record<string, unknown> = {
    verdict,
    verdict_at:    new Date().toISOString(),
    verdict_notes: notes ?? null,
  }
  if (verdict === 'edited' && typeof edited_response === 'string') {
    patch.edited_response = edited_response
  }

  const { data, error } = await supabase
    .schema('sales' as any)
    .from('ai_interactions')
    .update(patch)
    .eq('id', interaction_id)
    .select('id, verdict, verdict_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    // RLS may have hidden the row, or the id was bogus.
    return NextResponse.json({ error: 'Interaction not found or access denied' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, interaction: data })
}

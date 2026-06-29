// app/api/home/overview/route.ts
// Ambient "what's happening on the floor" feed for the home page factory map.
// Service-role so EVERY signed-in role gets the same high-level view (no RLS gaps)
// — it only returns counts/labels, never sensitive figures. Always fresh.

import { NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabase/admin'
import { sectionMeta } from '@/lib/production/capture-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Production "date" is recorded against the SAST working day.
function todaySAST() {
  const sast = new Date(Date.now() + 2 * 3600 * 1000)
  return sast.toISOString().slice(0, 10)
}

const rank = (s: string) => ({ approved: 3, submitted: 2, draft: 1 } as Record<string, number>)[s] ?? 0

export async function GET() {
  try {
    const today = todaySAST()
    const [{ data: sess }, { data: bd }] = await Promise.all([
      supabaseAdmin.schema('production').from('prod_sessions').select('section_id,status').eq('date', today),
      supabaseAdmin.schema('maintenance').from('job_cards')
        .select('card_no,area,machine,status,raised_at')
        .eq('workflow', 'breakdown').neq('status', 'complete')
        .order('raised_at', { ascending: false }),
    ])

    // Best status per section today.
    const bySection = new Map<string, string>()
    for (const s of (sess as any[]) ?? []) {
      const cur = bySection.get(s.section_id)
      if (!cur || rank(s.status) > rank(cur)) bySection.set(s.section_id, s.status)
    }
    const sections = Array.from(bySection.entries()).map(([id, status]) => {
      const m = sectionMeta(id)
      return { id, name: m.name, code: m.code, color: m.colorHex, status }
    })

    return NextResponse.json({
      date: today,
      sections,
      runningCount: sections.filter(s => s.status === 'draft').length,
      breakdowns: ((bd as any[]) ?? []).map(b => ({
        card: b.card_no, area: b.area, machine: b.machine, status: b.status, raisedAt: b.raised_at,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'overview error' }, { status: 500 })
  }
}

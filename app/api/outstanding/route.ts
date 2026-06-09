// app/api/outstanding/route.ts
//
// Replaces GET /api/outstanding from Express server.
// Queries qms.quality_records to find raw material batches with incomplete workflows.
// Logic mirrors the Express route exactly:
//   - Required workflows: pa_ta_analysis, residue
//   - Incomplete batches listed first, then alphabetically
//   - Batch numbers normalised (whitespace/dash variants collapsed)

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

function normalizeBatch(b: string | null): string {
  return (b || '').replace(/\s*-\s*/g, '-').replace(/\s+/g, '').trim().toUpperCase()
}

const REQUIRED_WORKFLOWS = ['pa_ta_analysis', 'residue']

export async function GET() {
  try {
    const cookieStore = await cookies()

    const db = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        db: { schema: 'qms' },
        cookies: {
          getAll:  () => cookieStore.getAll(),
          setAll:  (cs) => { try { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
        },
      }
    )

    const { data, error } = await db
      .from('quality_records')
      .select('batch_number, workflow')
      .eq('workcenter', 'rawMaterial')
      .order('batch_number')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Build map: normalizedKey → { display, workflows: Set }
    const batchMap: Record<string, { display: string; workflows: Set<string> }> = {}
    for (const row of data ?? []) {
      const key = normalizeBatch(row.batch_number)
      if (!batchMap[key]) batchMap[key] = { display: row.batch_number ?? '', workflows: new Set() }
      if (row.workflow) batchMap[key].workflows.add(row.workflow)
    }

    const outstanding = Object.entries(batchMap).map(([, { display, workflows }]) => {
      const status: Record<string, boolean> = {}
      for (const wf of REQUIRED_WORKFLOWS) status[wf] = workflows.has(wf)
      const missing = REQUIRED_WORKFLOWS.filter(wf => !workflows.has(wf))
      return { batch_number: display, complete: missing.length === 0, missing, status }
    })

    // Incomplete first, then alphabetical
    outstanding.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1
      return a.batch_number.localeCompare(b.batch_number)
    })

    return NextResponse.json(outstanding)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
// app/api/production/dashboard-supply/route.ts
//
// "Supply" side of the Supply & demand domain — output actually produced,
// grouped by the PO reference an operator typed against the session
// (prod_sessions.production_orders). This is NOT a planned/ordered quantity:
// there is no Acumatica production-order sync in this codebase (confirmed —
// production_orders is a free-text label, never validated against a real
// order), so "demand" cannot be built honestly yet. This endpoint only
// answers "how much has been supplied so far against each PO reference,"
// which is the one real number available.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sectionMeta } from '@/lib/production/capture-config'

export const runtime = 'nodejs'

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from and to dates (yyyy-MM-dd) are required.' }, { status: 400 })
    }

    const db = await createServerSupabaseClient()
    const { data: sessRaw, error } = await db.schema('production').from('prod_sessions')
      .select('id,section_id,date,production_orders')
      .gte('date', from).lte('date', to).is('deleted_at', null)
    if (error) throw error
    const sessions = (sessRaw as any[]) ?? []
    const sessionIds = sessions.map(s => s.id)

    let mb: any[] = [], bagging: any[] = []
    for (let i = 0; i < sessionIds.length; i += 200) {
      const slice = sessionIds.slice(i, i + 200)
      const [mbRes, bagRes] = await Promise.all([
        db.schema('production').from('prod_mass_balance')
          .select('session_id,total_output_b_kg,total_output_c_kg,total_output_d_kg')
          .in('session_id', slice),
        // product_type per bag — the only real "what is this PO actually for"
        // signal available, since production_orders is just a typed-in label
        // with no linked description anywhere in this codebase.
        db.schema('production').from('prod_bagging')
          .select('session_id,product_type,kg').in('session_id', slice),
      ])
      mb = mb.concat(mbRes.data ?? [])
      bagging = bagging.concat(bagRes.data ?? [])
    }
    const outputBySession = new Map(mb.map(m => [m.session_id, num(m.total_output_b_kg) + num(m.total_output_c_kg) + num(m.total_output_d_kg)]))
    const baggingBySession = new Map<string, any[]>()
    bagging.forEach(b => { const a = baggingBySession.get(b.session_id) ?? []; a.push(b); baggingBySession.set(b.session_id, a) })

    interface PoAgg { poRef: string; outputKg: number; sessions: number; sections: Set<string>; firstDate: string; lastDate: string; products: Map<string, number>; byDate: Map<string, number> }
    const byPo = new Map<string, PoAgg>()
    let sessionsWithoutPo = 0
    let outputWithoutPo = 0

    for (const s of sessions) {
      const output = outputBySession.get(s.id) ?? 0
      const refs: string[] = Array.isArray(s.production_orders) ? s.production_orders.filter(Boolean) : []
      if (!refs.length) {
        sessionsWithoutPo++
        outputWithoutPo += output
        continue
      }
      for (const ref of refs) {
        const row = byPo.get(ref) ?? { poRef: ref, outputKg: 0, sessions: 0, sections: new Set<string>(), firstDate: s.date, lastDate: s.date, products: new Map<string, number>(), byDate: new Map<string, number>() }
        row.outputKg += output
        row.sessions++
        row.sections.add(s.section_id)
        row.byDate.set(s.date, (row.byDate.get(s.date) ?? 0) + output)
        for (const b of (baggingBySession.get(s.id) ?? [])) {
          const pt = b.product_type || 'Unspecified'
          row.products.set(pt, (row.products.get(pt) ?? 0) + num(b.kg))
        }
        if (s.date < row.firstDate) row.firstDate = s.date
        if (s.date > row.lastDate) row.lastDate = s.date
        byPo.set(ref, row)
      }
    }

    const orders = [...byPo.values()]
      .map(r => {
        const productsSorted = [...r.products.entries()].sort((a, b) => b[1] - a[1])
        return {
          poRef: r.poRef,
          outputKg: Math.round(r.outputKg),
          sessions: r.sessions,
          sections: [...r.sections].map(id => ({ id, name: sectionMeta(id).name, code: sectionMeta(id).code, colorHex: sectionMeta(id).colorHex })),
          firstDate: r.firstDate, lastDate: r.lastDate,
          // "Product" is derived from what was actually bagged under this PO —
          // there's no real description field for the PO reference itself.
          product: productsSorted.length
            ? productsSorted.slice(0, 2).map(([name]) => name).join(' + ') + (productsSorted.length > 2 ? ' + other' : '')
            : null,
          byDate: Object.fromEntries(r.byDate),
        }
      })
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate))

    return NextResponse.json({
      window: { from, to },
      orders,
      totals: {
        totalOutputKg: Math.round(orders.reduce((t, o) => t + o.outputKg, 0)),
        poCount: orders.length,
        sessionsWithoutPo,
        outputWithoutPoKg: Math.round(outputWithoutPo),
      },
    })
  } catch (err: any) {
    console.error('[dashboard-supply]', err)
    return NextResponse.json({ error: err?.message ?? 'Could not load supply data' }, { status: 500 })
  }
}

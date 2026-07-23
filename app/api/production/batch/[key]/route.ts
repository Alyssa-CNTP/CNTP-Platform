// app/api/production/batch/[key]/route.ts
// Full consolidated "batch 360" for a single canonical batch — the payload behind
// the batch drill-down and the bag-tracking KPI view. Pulls the reporting views
// (v_batch_360 / v_session_yield / v_output_stream / v_machine_params) plus the
// bag line items, keyed on the canonical batch_key so sieving config, grade,
// variant, yield and quality all hang off one identity.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { normalizeBatch } from '@/lib/production/batch-key'

export const runtime = 'nodejs'

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const key = normalizeBatch(decodeURIComponent(params.key))
    if (!key) return NextResponse.json({ error: 'Invalid batch key' }, { status: 400 })

    const db = await createServerSupabaseClient()

    // ── Consolidated header ────────────────────────────────────────────────────
    const { data: b360, error: bErr } = await db.schema('production').from('v_batch_360')
      .select('batch_id,batch_key,display_lot,variant,first_section,sections,session_count,total_input_kg,total_output_kg,yield_pct,first_date,last_date,bulk_density_latest,leaf_shade_latest,pa_level_latest,all_passed,sd_run_count,pa_ta_level,residue_grade,has_quality')
      .eq('batch_key', key)
      .maybeSingle()
    if (bErr) throw bErr
    if (!b360) return NextResponse.json({ error: 'Batch not found', batchKey: key }, { status: 404 })

    // ── Sessions (per-shift yield) ─────────────────────────────────────────────
    const { data: sessions } = await db.schema('production').from('v_session_yield')
      .select('session_id,section_id,date,shift,status,variant,input_kg,output_kg,balance_kg,tolerance_kg,yield_pct,within_tol')
      .eq('batch_key', key)
      .order('date', { ascending: true })
    const sess = (sessions || []) as any[]
    const sessionIds = sess.map(s => s.session_id)

    // ── Output streams (per-product share) ─────────────────────────────────────
    const { data: streams } = await db.schema('production').from('v_output_stream')
      .select('session_id,section_id,date,product_type,kg,bag_count,session_output_kg,output_share_pct')
      .eq('batch_key', key)

    // ── Machine params for this batch's sessions ───────────────────────────────
    let machine: any[] = []
    if (sessionIds.length) {
      const { data } = await db.schema('production').from('v_machine_params')
        .select('session_id,section_id,date,shift,indent_screen_speed_rpm,indent_screen_angle_deg,infeed_vsd_hz_avg,infeed_vsd_hz_min,infeed_vsd_hz_max,sieving_config,scale_verification_kg')
        .in('session_id', sessionIds)
      machine = (data || []) as any[]
    }

    // ── Bag line items (input + output) ────────────────────────────────────────
    const bagBy = async (table: string, sel: string) => {
      if (!sessionIds.length) return []
      const out: any[] = []
      for (let i = 0; i < sessionIds.length; i += 200) {
        const { data } = await db.schema('production').from(table)
          .select(sel).in('session_id', sessionIds.slice(i, i + 200))
        out.push(...((data || []) as any[]))
      }
      return out
    }
    const inputs = await bagBy('prod_debagging', 'session_id,bag_no,bag_serial_no,lot_number,product_type,variant,kg_nett,is_spillage')
    const outputs = await bagBy('prod_bagging', 'session_id,bag_no,output_group,bag_serial_no,lot_number,product_type,acumatica_id,variant,kg')

    return NextResponse.json({
      batch: {
        batchKey: b360.batch_key,
        displayLot: b360.display_lot,
        variant: b360.variant,
        sections: b360.sections || [],
        firstSection: b360.first_section,
        sessionCount: b360.session_count,
        totalInputKg: num(b360.total_input_kg),
        totalOutputKg: num(b360.total_output_kg),
        yieldPct: num(b360.yield_pct),
        firstDate: b360.first_date,
        lastDate: b360.last_date,
      },
      quality: {
        hasQuality: !!b360.has_quality,
        bulkDensity: num(b360.bulk_density_latest),
        leafShade: b360.leaf_shade_latest || null,
        paLevel: num(b360.pa_level_latest) ?? num(b360.pa_ta_level),
        residueGrade: b360.residue_grade || null,
        allPassed: b360.all_passed,
        sdRunCount: b360.sd_run_count || 0,
      },
      sessions: sess.map(s => ({
        sessionId: s.session_id, sectionId: s.section_id, date: s.date, shift: s.shift, status: s.status,
        variant: s.variant, inputKg: num(s.input_kg), outputKg: num(s.output_kg),
        balanceKg: num(s.balance_kg), toleranceKg: num(s.tolerance_kg), yieldPct: num(s.yield_pct), withinTol: s.within_tol,
      })),
      streams: (streams || []).map((r: any) => ({
        sessionId: r.session_id, sectionId: r.section_id, date: r.date, productType: r.product_type,
        kg: num(r.kg), bagCount: r.bag_count, sessionOutputKg: num(r.session_output_kg), sharePct: num(r.output_share_pct),
      })),
      machineParams: machine.map(m => ({
        sessionId: m.session_id, sectionId: m.section_id, date: m.date, shift: m.shift,
        indentSpeedRpm: num(m.indent_screen_speed_rpm), indentAngleDeg: num(m.indent_screen_angle_deg),
        vsdHzAvg: num(m.infeed_vsd_hz_avg), vsdHzMin: num(m.infeed_vsd_hz_min), vsdHzMax: num(m.infeed_vsd_hz_max),
        sievingConfig: m.sieving_config || null, scaleVerificationKg: num(m.scale_verification_kg),
      })),
      bags: {
        inputs: inputs.map(r => ({ sessionId: r.session_id, bagNo: r.bag_no, serial: r.bag_serial_no, lot: r.lot_number, productType: r.product_type, variant: r.variant, kg: num(r.kg_nett), isSpillage: r.is_spillage })),
        outputs: outputs.map(r => ({ sessionId: r.session_id, bagNo: r.bag_no, group: r.output_group, serial: r.bag_serial_no, lot: r.lot_number, productType: r.product_type, acumaticaId: r.acumatica_id, variant: r.variant, kg: num(r.kg) })),
      },
    })
  } catch (err: any) {
    console.error('[batch-360]', err)
    return NextResponse.json({ error: err.message ?? 'Unknown' }, { status: 500 })
  }
}

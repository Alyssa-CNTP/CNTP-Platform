// app/api/admin/re-enrich-residues/route.ts
//
// Re-enriches (re-syncs) the EU MRL-derived R-grades on every stored raw-material
// residue record. Each residue record already carries the EU MRL value per
// compound (captured from the lab report at upload time). This route re-runs the
// same grading logic the upload route uses, so records pick up any correction to
// the grading rules without having to re-upload the PDF.
//
// Powers the "🔄 Re-enrich MRLs" button on the Raw Material → Residue tab.

import { NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { loadMrlMap, applyEuMrl } from '@/lib/quality/eu-mrl'

// ─── Residue grade computation ────────────────────────────────────────────────
// Kept identical to app/api/upload/route.ts so re-enrichment produces the same
// grades as a fresh upload.
function computeResidueGrades(extracted: any): any {
  if (!extracted?.compounds_detected) return extracted

  const enriched = { ...extracted }
  let overallRGrade = 'R-0'
  let hasExceedance = false
  let hasBanned = false

  const gradeNum = (g: string) => parseInt(g.replace('R-', '')) || 0

  enriched.compounds_detected = (extracted.compounds_detected || []).map((c: any) => {
    const detectedVal = parseFloat(
      String(c.detected_value_mg_kg ?? c.result_mg_kg ?? '0').replace(/[<>]/g, '')
    ) || 0

    let r_grade = detectedVal === 0 ? 'R-0' : 'R-1'

    // EU MRL check
    const mrl = parseFloat(String(c.mrl_eu_mg_kg ?? ''))
    if (!isNaN(mrl) && mrl > 0) {
      if (detectedVal === 0)           r_grade = 'R-0'
      else if (detectedVal <= mrl / 2) r_grade = 'R-1'
      else if (detectedVal <= mrl)     r_grade = 'R-2'
      else                             r_grade = 'R-3'
    }
    if (c.eu_mrl_exceeded) r_grade = 'R-3'

    const is_banned = c.is_banned ?? false
    if (r_grade === 'R-3') hasExceedance = true
    if (is_banned)         hasBanned     = true
    if (gradeNum(r_grade) > gradeNum(overallRGrade)) overallRGrade = r_grade

    return { ...c, r_grade, is_banned }
  })

  enriched.overall_r_grade        = overallRGrade
  enriched.overall_status         = hasExceedance || hasBanned ? 'FAIL' : 'PASS'
  enriched.banned_compounds_count = enriched.compounds_detected.filter((c: any) => c.is_banned).length
  return enriched
}

export async function POST() {
  try {
    const caller = await getCallerPermissions()
    if (!caller.can('can_save_records'))
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

    const db = getAdminClient()

    // Current EU MRLs (synced into qms.eu_mrl) — overlaid before re-grading so
    // records pick up the latest EU limits, not just the lab-report values.
    const mrlMap = await loadMrlMap(db)

    const { data: rows, error } = await db
      .schema('qms' as any)
      .from('quality_records')
      .select('id, data')
      .eq('workcenter', 'rawMaterial')
      .eq('workflow', 'residue')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let updated = 0
    for (const row of rows ?? []) {
      const before = JSON.stringify((row as any).data ?? null)
      const enriched = computeResidueGrades(applyEuMrl((row as any).data, mrlMap))
      const after = JSON.stringify(enriched)
      if (after === before) continue

      const { error: upErr } = await db
        .schema('qms' as any)
        .from('quality_records')
        .update({ data: enriched })
        .eq('id', (row as any).id)

      if (upErr) return NextResponse.json({ error: upErr.message, updated }, { status: 500 })
      updated++
    }

    return NextResponse.json({ updated, total: rows?.length ?? 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 })
  }
}

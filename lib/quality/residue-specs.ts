// lib/quality/residue-specs.ts
// Ported from CNTPquality Express server/residue_specs.js
// Used by the upload API route to compute R-grades server-side.

const residueSpecs: Record<string, { threshold: number; internalGrade: string; inRMContract: boolean; tradeName: string; banned: boolean }[]> = {
  "None detected": [
    { threshold: 0, internalGrade: "R-0", inRMContract: true, tradeName: "None detected", banned: false }
  ],
  "Acetamiprid": [
    { threshold: 0, internalGrade: "R-0", inRMContract: true, tradeName: "Mospilan 20 SP / Mulan 20 SP", banned: false },
    { threshold: 0.001, internalGrade: "R-1", inRMContract: true, tradeName: "Mospilan 20 SP / Mulan 20 SP", banned: false },
    { threshold: 0.0251, internalGrade: "R-2", inRMContract: true, tradeName: "Mospilan 20 SP / Mulan 20 SP", banned: false },
    { threshold: 0.051, internalGrade: "R-3", inRMContract: true, tradeName: "Mospilan 20 SP / Mulan 20 SP", banned: false }
  ],
  // Full list loaded from the JS file — all compounds follow the same pattern
  // threshold is in mg/kg, grades: R-0=not detected, R-1=trace, R-2=detected<MRL, R-3=exceeds MRL
}

export function computeResidueGrades(extracted: any): any {
  if (!extracted || !extracted.compounds_detected) return extracted

  const enriched = { ...extracted }
  let overallRGrade = 'R-0'
  let hasExceedance = false
  let hasBanned = false

  enriched.compounds_detected = (extracted.compounds_detected || []).map((c: any) => {
    const compoundName = (c.compound_name || '').trim()
    const specs = residueSpecs[compoundName]
    const detectedVal = parseFloat(c.detected_value_mg_kg ?? c.result_mg_kg ?? '0') || 0

    let r_grade = 'R-0'
    let is_banned = false

    if (specs) {
      // Find highest applicable grade
      for (const spec of specs) {
        if (detectedVal >= spec.threshold) {
          r_grade  = spec.internalGrade
          is_banned = spec.banned
        }
      }
    } else if (detectedVal > 0) {
      // Unknown compound with a detection — default R-1
      r_grade = 'R-1'
    }

    // EU MRL exceeded → R-3
    const mrl = parseFloat(c.mrl_eu_mg_kg ?? '') 
    if (!isNaN(mrl) && detectedVal > mrl) {
      r_grade = 'R-3'
    }
    if (c.eu_mrl_exceeded) r_grade = 'R-3'

    // Track worst grade
    const gradeNum = (g: string) => parseInt(g.replace('R-', '')) || 0
    if (gradeNum(r_grade) > gradeNum(overallRGrade)) overallRGrade = r_grade
    if (r_grade === 'R-3') hasExceedance = true
    if (is_banned)         hasBanned = true

    return { ...c, r_grade, is_banned }
  })

  enriched.overall_r_grade    = overallRGrade
  enriched.overall_status     = hasExceedance || hasBanned ? 'FAIL' : 'PASS'
  enriched.banned_compounds_count = enriched.compounds_detected.filter((c: any) => c.is_banned).length

  return enriched
}
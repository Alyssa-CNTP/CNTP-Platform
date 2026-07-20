// lib/quality/eu-mrl.ts
//
// Shared helpers for the EU Maximum Residue Level (MRL) integration.
//
// MRL limits are synced from the official EU Pesticides Database into
// qms.eu_mrl (see app/api/eu-mrl-sync/run). Residue grading then resolves each
// detected compound's MRL from that table so the R-grade tracks the *current*
// EU limit, falling back to the value printed on the lab report when the EU
// table has no entry for that compound.

// Rooibos in the EU MRL database (Reg. (EC) 396/2005 Annex I product code).
export const ROOIBOS_COMMODITY = { code: '0632020', name: 'Rooibos' }

// Normalise a pesticide / active-substance name so lab-report spellings and EU
// spellings line up: lowercase, strip accents, drop anything in brackets
// (isomer notes, CAS refs), collapse punctuation/whitespace.
export function normPesticide(name: string): string {
  return String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')                        // drop "(sum of ...)" etc.
    .replace(/[^a-z0-9]+/g, ' ')                        // punctuation -> space
    .trim()
    .replace(/\s+/g, ' ')
}

// Parse an MRL cell that may be "0.01", "0,01", "0.01*", "0.05 (F)" etc.
export function parseMrlValue(raw: unknown): number | null {
  if (raw == null) return null
  const m = String(raw).replace(',', '.').match(/-?\d+(\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0])
  return isNaN(n) ? null : n
}

export type MrlMap = Map<string, number>

// Build a normalised-name → mg/kg lookup from qms.eu_mrl rows for one commodity.
export async function loadMrlMap(
  db: any,
  commodityCode: string = ROOIBOS_COMMODITY.code,
): Promise<MrlMap> {
  const map: MrlMap = new Map()
  try {
    const { data } = await db
      .schema('qms')
      .from('eu_mrl')
      .select('pesticide_norm, mrl_mg_kg')
      .eq('commodity_code', commodityCode)
    for (const r of (data ?? []) as any[]) {
      if (r.pesticide_norm != null && r.mrl_mg_kg != null) {
        map.set(r.pesticide_norm, Number(r.mrl_mg_kg))
      }
    }
  } catch {
    // No table / no rows yet — grading falls back to lab-report MRLs.
  }
  return map
}

// Overlay synced EU MRLs onto an extracted residue payload. For every detected
// compound found in the EU table, set the authoritative MRL and recompute the
// exceedance flag; untouched compounds keep the lab report's value. Returns a
// new object (does not mutate the input).
export function applyEuMrl(extracted: any, map: MrlMap): any {
  if (!extracted?.compounds_detected || !map.size) return extracted
  const out = { ...extracted }
  out.compounds_detected = (extracted.compounds_detected || []).map((c: any) => {
    const euMrl = map.get(normPesticide(c.compound_name || c.pesticide || ''))
    if (euMrl == null) return { ...c, mrl_source: c.mrl_source ?? 'lab_report' }
    const detectedVal = parseFloat(
      String(c.detected_value_mg_kg ?? c.result_mg_kg ?? '0').replace(/[<>]/g, '')
    ) || 0
    return {
      ...c,
      mrl_eu_mg_kg: euMrl,
      mrl_source: 'eu_db',
      eu_mrl_exceeded: detectedVal > euMrl,
    }
  })
  return out
}

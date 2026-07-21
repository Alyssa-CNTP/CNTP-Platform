// lib/quality/eu-mrl.ts
//
// Shared helpers for the EU Maximum Residue Level (MRL) integration.
//
// MRL limits are synced from the official EU Pesticides Database into
// qms.eu_mrl (see app/api/eu-mrl-sync/run). Residue grading then resolves each
// detected compound's MRL from that table so the R-grade tracks the *current*
// EU limit, falling back to the value printed on the lab report when the EU
// table has no entry for that compound.

import * as XLSX from 'xlsx'

// Rooibos in the EU MRL database (Reg. (EC) 396/2005 Annex I product code).
export const ROOIBOS_COMMODITY = { code: '0632020', name: 'Rooibos' }

export type ParsedEuMrl = {
  productCode: string
  productName: string
  rows: { pesticide: string; mrl_mg_kg: number | null; mrl_raw: string }[]
}

// Parse an official EU Pesticides Database "Export_Pesticide_residue_CurrentMRL"
// workbook. Its real layout is:
//   row 0..6  preamble ("Selected Product: 0632020 - Rooibos", legend, blanks)
//   header    | Pesticide Id | Pesticide residue | Maximum residue level (mg/kg) |
//   data...   one row per active substance; MRL like "0.01*" (* = at LOD)
export function parseEuMrlWorkbook(buf: ArrayBuffer): ParsedEuMrl {
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })

  // Product code/name from the "Selected Product:" preamble line.
  let productCode = '', productName = ''
  for (const r of aoa) {
    const m = String(r?.[0] ?? '').match(/Selected Product:\s*(\S+)\s*-\s*(.+)/i)
    if (m) { productCode = m[1]; productName = m[2].trim(); break }
  }

  // Locate the real header row (needs a distinct name cell AND an MRL cell).
  let h = -1, nameCol = -1, mrlCol = -1
  for (let i = 0; i < aoa.length; i++) {
    const cells = (aoa[i] || []).map((x: any) => String(x).trim())
    const n = cells.findIndex((c: string) => /^pesticide residue$/i.test(c))
    const m = cells.findIndex((c: string) => /^maximum residue level/i.test(c))
    if (n >= 0 && m >= 0) { h = i; nameCol = n; mrlCol = m; break }
  }
  if (h < 0) return { productCode, productName, rows: [] }

  const rows: ParsedEuMrl['rows'] = []
  for (let i = h + 1; i < aoa.length; i++) {
    const row = aoa[i] || []
    const pesticide = String(row[nameCol] ?? '').trim()
    if (!pesticide) continue
    const raw = String(row[mrlCol] ?? '').trim()
    rows.push({ pesticide, mrl_mg_kg: parseMrlValue(raw), mrl_raw: raw })
  }
  return { productCode, productName, rows }
}

// Turn parsed rows into qms.eu_mrl upsert payloads (dedup by normalised name).
export function toEuMrlPayload(
  parsed: ParsedEuMrl,
  fallback: { code: string; name: string },
  syncedAt: string,
) {
  const code = parsed.productCode || fallback.code
  const name = parsed.productName || fallback.name
  const byPest = new Map<string, any>()
  for (const r of parsed.rows) {
    const norm = normPesticide(r.pesticide)
    if (!norm) continue
    byPest.set(norm, {
      pesticide: r.pesticide,
      pesticide_norm: norm,
      commodity_code: code,
      commodity: name,
      mrl_mg_kg: r.mrl_mg_kg,
      mrl_raw: r.mrl_raw,
      source: 'eu_pesticides_db',
      synced_at: syncedAt,
    })
  }
  return { code, name, payload: [...byPest.values()] }
}

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

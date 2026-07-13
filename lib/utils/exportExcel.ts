// lib/utils/exportExcel.ts — branded Excel export helpers for QC workcenters.
// All exports go through the ExcelJS engine (buildStyledWorkbook) below.

// ── helpers ──────────────────────────────────────────────────────────────────

// Generic one-sheet branded export for plain row objects (e.g. the lab-results
// tables). Tones any Pass/Fail status column green/red.
export async function exportTableXlsx(rows: Record<string, any>[], filename: string, sheetName = 'Data') {
  const fill = (r: Record<string, any>) => {
    const key = ['Overall', 'Overall Status', 'Status', 'Result'].find(k => k in r)
    if (key) {
      const v = String(r[key])
      const tone: Tone | undefined = /pass/i.test(v) ? 'ok' : /fail|reject/i.test(v) ? 'err' : undefined
      if (tone) return { [key]: tone }
    }
    return undefined
  }
  await buildStyledWorkbook(
    [{ name: sheetName.slice(0, 31), rows, fill }],
    { subtitle: `Lab Results — ${sheetName}` },
    filename,
  )
}

function n(v: any): number | null {
  const x = parseFloat(v)
  return isNaN(x) ? null : x
}

function avg(vals: any[]): number | null {
  const clean = vals.map(n).filter((v): v is number => v !== null)
  return clean.length ? Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 100) / 100 : null
}

function fmtAvg(v: number | null, unit = '') {
  return v === null ? '—' : `${v}${unit}`
}

// ── ExcelJS styled engine (branded headers, conditional fills, frozen + filter) ─
// ExcelJS is lazy-loaded inside buildStyledWorkbook so it never enters the main
// bundle — it only downloads when a user actually clicks an export button.
// Colours mirror the app's design tokens (app/globals.css, light theme).
const XS = {
  brand:  'FF1A3A0E', headerTx: 'FFFFFFFF', band: 'FFF5F7F4', border: 'FFE5E7EB',
  muted:  'FF6B7280', faint: 'FF9CA3AF',
  errBg:  'FFFEF2F2', errTx: 'FFB81C1C',
  okBg:   'FFEDFAF3', okTx:  'FF1A7A3C',
  warnBg: 'FFFEF5ED', warnTx:'FFB85C0A',
}
type Tone = 'err' | 'ok' | 'warn'
type StyledSheet = {
  name: string
  rows: Record<string, any>[]
  numFmt?: Record<string, string>
  fill?: (row: Record<string, any>) => Record<string, Tone> | undefined
  // Whole-row background tint (ARGB hex, e.g. from lighten()) — used for
  // category-coded exports (e.g. roster) instead of pass/fail tones.
  rowFill?: (row: Record<string, any>) => string | undefined
  // Columns that should always render bold (e.g. a "Section" label column).
  boldCols?: string[]
}

// Lighten a '#rrggbb' colour towards white by `amt` (0–1) and return an
// ExcelJS-ready ARGB string. Used to tint whole rows by category colour
// while keeping text legible.
function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amt)
  const toHex = (c: number) => c.toString(16).padStart(2, '0').toUpperCase()
  return `FF${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

async function buildStyledWorkbook(
  sheets: StyledSheet[],
  meta: { subtitle?: string },
  filename: string,
) {
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()

  // brand logo (top-right of each sheet) — resilient: skip silently if it fails
  let logoId: number | null = null
  try {
    const res = await fetch('/logo.png')
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b) })
      logoId = wb.addImage({ base64: btoa(bin), extension: 'png' })
    }
  } catch { /* no logo — title text still shows */ }

  const thin = { style: 'thin' as const, color: { argb: XS.border } }
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin }
  const generated = `Generated ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })} (SAST)`

  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name)
    let rows = spec.rows
    const keys0 = rows.length ? Object.keys(rows[0]) : ['Note']
    const keep = keys0.filter(k => rows.some(r => r[k] !== '' && r[k] != null))
    const cols = keep.length && keep.length < keys0.length ? keep : keys0
    rows = rows.map(r => Object.fromEntries(cols.map(k => [k, r[k]])))
    const ncol = Math.max(cols.length, 1)

    // ── title block (rows 1–3) ──
    ws.mergeCells(1, 1, 1, ncol)
    ws.getCell(1, 1).value = 'Cape Natural — Operations Platform'
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: XS.brand } }
    ws.mergeCells(2, 1, 2, ncol)
    ws.getCell(2, 1).value = meta.subtitle || ''
    ws.getCell(2, 1).font = { size: 10, color: { argb: XS.muted } }
    ws.mergeCells(3, 1, 3, ncol)
    ws.getCell(3, 1).value = generated
    ws.getCell(3, 1).font = { size: 9, italic: true, color: { argb: XS.faint } }
    if (logoId != null) ws.addImage(logoId, { tl: { col: Math.max(ncol - 1.2, 0), row: 0.1 }, ext: { width: 110, height: 36 } })

    // ── header row (row 5) ──
    const hr = 5
    cols.forEach((c, i) => {
      const cell = ws.getCell(hr, i + 1)
      cell.value = c
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XS.brand } }
      cell.font = { bold: true, color: { argb: XS.headerTx }, size: 10 }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = BORDER
    })
    ws.getRow(hr).height = 22

    // ── data rows ──
    rows.forEach((r, ri) => {
      const rn = hr + 1 + ri
      const tones = spec.fill ? spec.fill(r) : undefined
      const rowBg = spec.rowFill ? spec.rowFill(r) : undefined
      cols.forEach((c, ci) => {
        const cell = ws.getCell(rn, ci + 1)
        const v = r[c]
        cell.value = v === '' || v == null ? null : v
        const fmt = spec.numFmt?.[c]
        if (fmt && typeof cell.value === 'number') cell.numFmt = fmt
        cell.border = BORDER
        cell.alignment = { horizontal: typeof cell.value === 'number' ? 'center' : 'left', vertical: 'middle' }
        const bold = spec.boldCols?.includes(c)
        const tone = tones?.[c]
        if (tone === 'err')       { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XS.errBg } };  cell.font = { color: { argb: XS.errTx }, bold: true } }
        else if (tone === 'ok')   { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XS.okBg } };   cell.font = { color: { argb: XS.okTx } } }
        else if (tone === 'warn') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XS.warnBg } }; cell.font = { color: { argb: XS.warnTx }, bold: true } }
        else if (rowBg)           { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } }; if (bold) cell.font = { bold: true } }
        else if (ri % 2 === 1)    { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XS.band } }; if (bold) cell.font = { bold: true } }
        else if (bold)            { cell.font = { bold: true } }
      })
    })

    ws.views = [{ state: 'frozen', ySplit: hr }]
    if (rows.length) ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: ncol } }
    cols.forEach((c, i) => {
      const maxLen = Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length))
      ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 9), 30)
    })
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Pasteuriser ───────────────────────────────────────────────────────────────

const PAST_SIEVES = ['gt6','gt10','gt12','gt16','gt20','gt60','dust']
const PAST_SIEVE_LABELS: Record<string,string> = {
  gt6:'>6%', gt10:'>10%', gt12:'>12%', gt16:'>16%', gt20:'>20%', gt60:'>60%', dust:'Dust%'
}

export async function exportPasteuriserBatch(batch: any) {
  const samples: any[] = batch.samples || []

  // ── Sheet 1: Raw Data ─────────────────────────────────────────────────────
  const rawRows = samples.map((s: any, i: number) => {
    const row: any = {
      // identity / dimension columns — repeated per row so the sheet pivots cleanly
      'Batch Number': batch.batch_number || '',
      'Production Date': batch.production_date || '',
      'Product': batch.type_grade || batch.product_family || '',
      'Grade': batch.grade || '',
      'Variant': batch.variant || '',
      'Customer': batch.customer || '',
      'Final Result': batch.final_result || '',
      'Sample #': i + 1,
      'Date': s.date || '',
      'Time': s.time || '',
      'QC Controller': s.qc_name || '',
      'Bin/Bag': s.serial_bin || '',
      'Type': s.has_sieve ? 'Full Sieve+MB' : 'MB only',
      'Temp (°C)': n(s.hourly_temp),
    }
    PAST_SIEVES.forEach(k => { row[PAST_SIEVE_LABELS[k]] = n(s[k]) })
    PAST_SIEVES.forEach(k => { row[`${PAST_SIEVE_LABELS[k]} (g)`] = n(s[`${k}_g`]) })
    row['Moisture %'] = n(s.moisture)
    row['BD (cc/100g)'] = n(s.untapped_bd)
    row['Customer BD'] = n(s.customer_bd)
    row['Weight 1 (kg)'] = n(s.final_weight_1)
    row['Weight 2 (kg)'] = n(s.final_weight_2)
    row['Weight 3 (kg)'] = n(s.final_weight_3)
    row['Needle Count'] = n(s.needle_count)
    row['Compares to Ref'] = s.compares_to_ref || ''
    row['Afternoon QC'] = s.afternoon_qc || ''
    row['Aroma'] = n(s.aroma)
    row['Flavour'] = n(s.flavour_profile)
    row['Briskness'] = n(s.briskness)
    row['Strength'] = n(s.strength)
    row['Cup Colour'] = n(s.cup_colour)
    row['Cup Clarity'] = s.cup_clarity || ''
    row['Sensorial'] = s.sensorial_pass || ''
    row['Sensorial Note'] = s.sensorial_note || ''
    row['Comment'] = s.comment || ''
    return row
  })

  // ── Sheet 2: Daily Averages ───────────────────────────────────────────────
  const byDate: Record<string, any[]> = {}
  samples.forEach((s: any) => {
    const d = s.date || 'Unknown'
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(s)
  })
  const dailyRows = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ss]) => {
      const row: any = { 'Date': date, 'Samples': ss.length }
      row['Avg Temp (°C)'] = avg(ss.map((s: any) => s.hourly_temp))
      PAST_SIEVES.forEach(k => { row[`Avg ${PAST_SIEVE_LABELS[k]}`] = avg(ss.map((s: any) => s[k])) })
      row['Avg Moisture %'] = avg(ss.map((s: any) => s.moisture))
      row['Avg BD (cc/100g)'] = avg(ss.map((s: any) => s.untapped_bd))
      row['Avg Customer BD'] = avg(ss.map((s: any) => s.customer_bd))
      row['Sieve Samples'] = ss.filter((s: any) => s.has_sieve).length
      row['MB Samples'] = ss.filter((s: any) => s.has_mb).length
      row['Sensorial Pass'] = ss.filter((s: any) => s.sensorial_pass === 'Pass').length
      row['Sensorial Reject'] = ss.filter((s: any) => s.sensorial_pass === 'Reject').length
      return row
    })

  // ── Sheet 3: Batch Summary (key/value) ────────────────────────────────────
  const sieveSamples = samples.filter((s: any) => s.has_sieve)
  const mbSamples = samples.filter((s: any) => s.has_mb)
  const summaryRows: any[] = [
    { Field: 'Batch Number',     Value: batch.batch_number },
    { Field: 'Production Date',  Value: batch.production_date || '' },
    { Field: 'Product',          Value: batch.type_grade || '' },
    { Field: 'Product Family',   Value: batch.product_family || '' },
    { Field: 'Grade',            Value: batch.grade || '' },
    { Field: 'Variant',          Value: batch.variant || '' },
    { Field: 'Customer',         Value: batch.customer || '' },
    { Field: 'Packaging',        Value: batch.packaging || '' },
    { Field: 'QC Controller',    Value: batch.qc_name || '' },
    { Field: 'Reference Batch',  Value: batch.reference_batch || '' },
    { Field: 'Final Result',     Value: batch.final_result || 'In Progress' },
    { Field: 'Finalised At',     Value: batch.finalised_at || '' },
    { Field: 'Comments',         Value: batch.comments || '' },
    { Field: 'Total Samples',    Value: samples.length },
    { Field: 'Sieve Samples',    Value: sieveSamples.length },
    { Field: 'MB Samples',       Value: mbSamples.length },
    { Field: 'Sensorial Done',   Value: samples.filter((s: any) => s.has_sensorial).length },
    { Field: 'Avg Temp (°C)',    Value: fmtAvg(avg(samples.map((s: any) => s.hourly_temp)), '°C') },
    ...PAST_SIEVES.map(k => ({
      Field: `Avg ${PAST_SIEVE_LABELS[k]}`,
      Value: fmtAvg(avg(sieveSamples.map((s: any) => s[k])), '%')
    })),
    { Field: 'Avg Moisture %',   Value: fmtAvg(avg(mbSamples.map((s: any) => s.moisture)), '%') },
    { Field: 'Avg BD (cc/100g)', Value: fmtAvg(avg(mbSamples.map((s: any) => s.untapped_bd))) },
    { Field: 'Avg Customer BD',  Value: fmtAvg(avg(mbSamples.map((s: any) => s.customer_bd))) },
  ]

  const pct = '0.0"%"'
  const rawNumFmt: Record<string, string> = { 'Temp (°C)': '0.0', 'Moisture %': '0.00"%"', 'BD (cc/100g)': '0', 'Customer BD': '0', 'Weight 1 (kg)': '0.0', 'Weight 2 (kg)': '0.0', 'Weight 3 (kg)': '0.0', 'Needle Count': '0', 'Aroma': '0', 'Flavour': '0', 'Briskness': '0', 'Strength': '0', 'Cup Colour': '0' }
  PAST_SIEVES.forEach(k => { rawNumFmt[PAST_SIEVE_LABELS[k]] = pct; rawNumFmt[`${PAST_SIEVE_LABELS[k]} (g)`] = '0' })
  const dailyNumFmt: Record<string, string> = { 'Avg Temp (°C)': '0.0', 'Avg Moisture %': '0.00"%"', 'Avg BD (cc/100g)': '0', 'Avg Customer BD': '0' }
  PAST_SIEVES.forEach(k => { dailyNumFmt[`Avg ${PAST_SIEVE_LABELS[k]}`] = pct })

  const rawFill = (r: any) => {
    const t: Record<string, Tone> = {}
    if (typeof r['Moisture %'] === 'number' && r['Moisture %'] > 8.5) t['Moisture %'] = 'err'
    if (r['Sensorial'] === 'Pass') t['Sensorial'] = 'ok'
    else if (r['Sensorial'] === 'Reject' || r['Sensorial'] === 'Fail') t['Sensorial'] = 'err'
    return Object.keys(t).length ? t : undefined
  }
  const dailyFill = (r: any) => (typeof r['Avg Moisture %'] === 'number' && r['Avg Moisture %'] > 8.5 ? { 'Avg Moisture %': 'err' as Tone } : undefined)
  const summaryFill = (r: any) => {
    if (r.Field === 'Final Result') {
      const v = String(r.Value)
      const tone: Tone | undefined = v === 'Pass' ? 'ok' : v === 'Fail' ? 'err' : v === 'Concession' ? 'warn' : undefined
      if (tone) return { Value: tone }
    }
    return undefined
  }

  const dates = [...new Set(samples.map((s: any) => s.date).filter(Boolean))].sort()
  const range = dates.length ? (dates.length === 1 ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`) : (batch.production_date || '')
  const product = [batch.product_family || batch.type_grade, batch.grade].filter(Boolean).join(' ')
  const subtitle = [`Pasteuriser Batch ${batch.batch_number || ''}`, product, range, batch.customer, batch.qc_name ? `QC ${batch.qc_name}` : ''].filter(Boolean).join('  ·  ')

  const date = batch.production_date || new Date().toISOString().slice(0, 10)
  try {
    await buildStyledWorkbook([
      { name: 'Raw Data',       rows: rawRows,     numFmt: rawNumFmt,   fill: rawFill },
      { name: 'Daily Averages', rows: dailyRows,   numFmt: dailyNumFmt, fill: dailyFill },
      { name: 'Batch Summary',  rows: summaryRows,                      fill: summaryFill },
    ], { subtitle }, `Pasteuriser_${batch.batch_number}_${date}.xlsx`)
  } catch (e) {
    console.error('Pasteuriser export failed', e)
    alert('Export failed — see console for details.')
  }
}

// Combined export of many pasteuriser batches (all raw samples in one sheet +
// a per-batch summary sheet) — used for the historical archive.
export async function exportPasteuriserBatches(batches: any[], filename: string) {
  // ── Sheet 1: All Raw Samples (every sample across every batch) ────────────
  const rawRows: any[] = []
  batches.forEach((b: any) => {
    (b.samples || []).forEach((s: any, i: number) => {
      const row: any = {
        'Batch Number': b.batch_number || '',
        'Production Date': b.production_date || '',
        'Product': b.type_grade || b.product_family || '',
        'Grade': b.grade || '',
        'Variant': b.variant || '',
        'Customer': b.customer || '',
        'Final Result': b.final_result || '',
        'Sample #': i + 1,
        'Date': s.date || '',
        'Time': s.time || '',
        'QC Controller': s.qc_name || '',
        'Bin/Bag': s.serial_bin || '',
        'Type': s.has_sieve ? 'Full Sieve+MB' : 'MB only',
        'Temp (°C)': n(s.hourly_temp),
      }
      PAST_SIEVES.forEach(k => { row[PAST_SIEVE_LABELS[k]] = n(s[k]) })
      row['Moisture %'] = n(s.moisture)
      row['BD (cc/100g)'] = n(s.untapped_bd)
      row['Aroma'] = n(s.aroma)
      row['Flavour'] = n(s.flavour_profile)
      row['Briskness'] = n(s.briskness)
      row['Strength'] = n(s.strength)
      row['Cup Colour'] = n(s.cup_colour)
      row['Sensorial'] = s.sensorial_pass || ''
      row['Comment'] = s.comment || ''
      rawRows.push(row)
    })
  })
  // ── Sheet 2: Batch Summary (one row per batch with averages) ──────────────
  const summaryRows = batches.map((b: any) => {
    const samples: any[] = b.samples || []
    const sieveSamples = samples.filter((s: any) => s.has_sieve)
    const mbSamples = samples.filter((s: any) => s.has_mb)
    const row: any = {
      'Batch Number': b.batch_number || '',
      'Production Date': b.production_date || '',
      'Product': b.type_grade || b.product_family || '',
      'Customer': b.customer || '',
      'QC Controller': b.qc_name || '',
      'Final Result': b.final_result || '',
      'Total Samples': samples.length,
      'Avg Temp (°C)': avg(samples.map((s: any) => s.hourly_temp)),
    }
    PAST_SIEVES.forEach(k => { row[`Avg ${PAST_SIEVE_LABELS[k]}`] = avg(sieveSamples.map((s: any) => s[k])) })
    row['Avg Moisture %'] = avg(mbSamples.map((s: any) => s.moisture))
    row['Avg BD (cc/100g)'] = avg(mbSamples.map((s: any) => s.untapped_bd))
    row['Avg Customer BD'] = avg(mbSamples.map((s: any) => s.customer_bd))
    return row
  })

  const pct = '0.0"%"'
  const rawNumFmt: Record<string, string> = { 'Temp (°C)': '0.0', 'Moisture %': '0.00"%"', 'BD (cc/100g)': '0', 'Aroma': '0', 'Flavour': '0', 'Briskness': '0', 'Strength': '0', 'Cup Colour': '0' }
  PAST_SIEVES.forEach(k => { rawNumFmt[PAST_SIEVE_LABELS[k]] = pct })
  const sumNumFmt: Record<string, string> = { 'Avg Temp (°C)': '0.0', 'Avg Moisture %': '0.00"%"', 'Avg BD (cc/100g)': '0', 'Avg Customer BD': '0', 'Total Samples': '0' }
  PAST_SIEVES.forEach(k => { sumNumFmt[`Avg ${PAST_SIEVE_LABELS[k]}`] = pct })

  const resultTone = (v: any): Tone | undefined => { const s = String(v); return s === 'Pass' ? 'ok' : s === 'Fail' ? 'err' : s === 'Concession' ? 'warn' : undefined }
  const rawFill = (r: any) => {
    const t: Record<string, Tone> = {}
    if (typeof r['Moisture %'] === 'number' && r['Moisture %'] > 8.5) t['Moisture %'] = 'err'
    const rt = resultTone(r['Final Result']); if (rt) t['Final Result'] = rt
    return Object.keys(t).length ? t : undefined
  }
  const sumFill = (r: any) => {
    const t: Record<string, Tone> = {}
    if (typeof r['Avg Moisture %'] === 'number' && r['Avg Moisture %'] > 8.5) t['Avg Moisture %'] = 'err'
    const rt = resultTone(r['Final Result']); if (rt) t['Final Result'] = rt
    return Object.keys(t).length ? t : undefined
  }

  await buildStyledWorkbook([
    { name: 'All Raw Samples', rows: rawRows,     numFmt: rawNumFmt, fill: rawFill },
    { name: 'Batch Summary',   rows: summaryRows, numFmt: sumNumFmt, fill: sumFill },
  ], { subtitle: `Pasteuriser — ${batches.length} batch${batches.length === 1 ? '' : 'es'}` }, filename)
}

// ── Granule Line ──────────────────────────────────────────────────────────────

export async function exportGranuleRun(
  run: any,
  sieves: Array<{ key: string; label: string }>
) {
  const samples: any[] = run.samples || []

  // ── Sheet 1: Raw Data ─────────────────────────────────────────────────────
  const rawRows = samples.map((s: any, i: number) => {
    const row: any = {
      'Sample #': i + 1,
      'Date': s.sample_date || '',
      'Time': s.sample_time || '',
      'Dryer': s.dryer_number || '',
      'Bag/Serial': s.bulk_bag_serial || '',
      'Bag Type': s.bag_type || '',
      'Moisture %': n(s.moisture),
      'BD (cc/100g)': n(s.bulk_density),
      'Dryer Temp (°C)': n(s.dryer_temp),
      'Compares to Ref': s.compares_to_ref || '',
      'Final Weight OK': s.final_weight_ok ? 'Yes' : 'No',
      'Weight 1 (kg)': n(s.weight_1),
      'Weight 2 (kg)': n(s.weight_2),
      'Weight 3 (kg)': n(s.weight_3),
      'Sieving Done': s.sieving_done ? 'Yes' : 'No',
    }
    if (s.sieving_done) {
      const pct = s.sieve_pct || {}
      const grm = s.sieve_g || {}
      sieves.forEach(sv => {
        row[`${sv.label}%`] = n(pct[sv.key])
        row[`${sv.label} (g)`] = n(grm[sv.key])
      })
    } else {
      sieves.forEach(sv => { row[`${sv.label}%`] = null; row[`${sv.label} (g)`] = null })
    }
    if (s.dryer2_running) {
      row['Dryer 2 Moisture %'] = n(s.dryer2_moisture)
      row['Dryer 2 BD'] = n(s.dryer2_bulk_density)
      row['Dryer 2 Temp (°C)'] = n(s.dryer2_dryer_temp)
    }
    row['Violations'] = Array.isArray(s.violations) ? s.violations.join('; ') : ''
    return row
  })

  // ── Sheet 2: Daily Averages ───────────────────────────────────────────────
  const byDate: Record<string, any[]> = {}
  samples.forEach((s: any) => {
    const d = s.sample_date || 'Unknown'
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(s)
  })
  const sieveSamples = samples.filter((s: any) => s.sieving_done)
  const dailyRows = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ss]) => {
      const row: any = { 'Date': date, 'Samples': ss.length }
      row['Avg Moisture %'] = avg(ss.map((s: any) => s.moisture))
      row['Avg BD (cc/100g)'] = avg(ss.map((s: any) => s.bulk_density))
      row['Avg Dryer Temp (°C)'] = avg(ss.map((s: any) => s.dryer_temp))
      const sieveSS = ss.filter((s: any) => s.sieving_done)
      row['Sieve Samples'] = sieveSS.length
      sieves.forEach(sv => {
        row[`Avg ${sv.label}%`] = avg(sieveSS.map((s: any) => n(s.sieve_pct?.[sv.key])))
      })
      return row
    })
  // ── Sheet 3: Run Summary (key/value) ──────────────────────────────────────
  const summaryRows: any[] = [
    { Field: 'Batch Number',     Value: run.batch_number || '' },
    { Field: 'Production Date',  Value: run.production_date || '' },
    { Field: 'Type/Grade',       Value: run.type_grade || '' },
    { Field: 'Customer',         Value: run.customer || '' },
    { Field: 'QC Controller',    Value: run.qc_name || '' },
    { Field: 'Reference Used',   Value: run.reference_used || '' },
    { Field: 'CNTP Batch',       Value: run.is_cntp ? 'Yes' : 'No' },
    { Field: 'Final Status',     Value: run.final_status || 'In Progress' },
    { Field: 'Overall Status',   Value: run.overall_status || '' },
    { Field: 'Total Samples',    Value: samples.length },
    { Field: 'Sieve Samples',    Value: sieveSamples.length },
    { Field: 'Avg Moisture %',   Value: fmtAvg(avg(samples.map((s: any) => s.moisture)), '%') },
    { Field: 'Avg BD (cc/100g)', Value: fmtAvg(avg(samples.map((s: any) => s.bulk_density))) },
    { Field: 'Avg Dryer Temp',   Value: fmtAvg(avg(samples.map((s: any) => s.dryer_temp)), '°C') },
    ...sieves.map(sv => ({
      Field: `Avg ${sv.label}%`,
      Value: fmtAvg(avg(sieveSamples.map((s: any) => n(s.sieve_pct?.[sv.key]))), '%')
    })),
  ]

  const pct = '0.0"%"'
  const rawNumFmt: Record<string, string> = { 'Moisture %': '0.00"%"', 'BD (cc/100g)': '0', 'Dryer Temp (°C)': '0.0', 'Weight 1 (kg)': '0.0', 'Weight 2 (kg)': '0.0', 'Weight 3 (kg)': '0.0', 'Dryer 2 Moisture %': '0.00"%"', 'Dryer 2 BD': '0', 'Dryer 2 Temp (°C)': '0.0' }
  sieves.forEach(sv => { rawNumFmt[`${sv.label}%`] = pct; rawNumFmt[`${sv.label} (g)`] = '0' })
  const dailyNumFmt: Record<string, string> = { 'Avg Moisture %': '0.00"%"', 'Avg BD (cc/100g)': '0', 'Avg Dryer Temp (°C)': '0.0' }
  sieves.forEach(sv => { dailyNumFmt[`Avg ${sv.label}%`] = pct })

  const rawFill = (r: any) => {
    const t: Record<string, Tone> = {}
    if (typeof r['Moisture %'] === 'number' && r['Moisture %'] > 8.5) t['Moisture %'] = 'err'
    if (r['Violations']) t['Violations'] = 'err'
    return Object.keys(t).length ? t : undefined
  }
  const dailyFill = (r: any) => (typeof r['Avg Moisture %'] === 'number' && r['Avg Moisture %'] > 8.5 ? { 'Avg Moisture %': 'err' as Tone } : undefined)
  const sumFill = (r: any) => {
    if (r.Field === 'Final Status' || r.Field === 'Overall Status') {
      const v = String(r.Value)
      const tone: Tone | undefined = /pass|approved/i.test(v) ? 'ok' : /fail|reject/i.test(v) ? 'err' : undefined
      if (tone) return { Value: tone }
    }
    return undefined
  }

  const date = run.production_date || new Date().toISOString().slice(0, 10)
  const subtitle = [`Granule Line — Batch ${run.batch_number || ''}`, run.type_grade, run.customer, run.qc_name ? `QC ${run.qc_name}` : ''].filter(Boolean).join('  ·  ')
  await buildStyledWorkbook([
    { name: 'Raw Data',       rows: rawRows,     numFmt: rawNumFmt,   fill: rawFill },
    { name: 'Daily Averages', rows: dailyRows,   numFmt: dailyNumFmt, fill: dailyFill },
    { name: 'Run Summary',    rows: summaryRows,                      fill: sumFill },
  ], { subtitle }, `GranuleLine_${run.batch_number}_${date}.xlsx`)
}

// ── Sieving Tower ─────────────────────────────────────────────────────────────

export async function exportSievingRuns(
  product: string,
  runs: any[],
  meshLabels: string[]   // e.g. ['>6 (%)', '>10 (%)', ...]
) {
  // ── Sheet 1: Raw Data ─────────────────────────────────────────────────────
  const rawRows = runs.map((r: any) => {
    const row: any = {
      'Date': r.date || '',
      'Time': r.time || '',
      'Lot Number': r.lotNumber || '',
      'Serial No.': r.serialNumber || '',
      'Grade': r.grade || '',
      'Variant': r.variant || '',
      'Run Type': r.runType || '',
      'QC Controller': r.qcName || '',
      'Bulk Density': n(r.bulkDensity),
      'Leaf Shade': n(r.leafShade),
      'Needle Count': n(r.needleCount),
      'PA Level': r.paLevel || '',
    }
    meshLabels.forEach(m => { row[m.replace(' (%)', '%')] = n(r[m]) })
    row['Pass/Fail'] = r.passStatus || ''
    row['Violations'] = Array.isArray(r.violations) ? r.violations.join('; ') : ''
    row['Comment'] = r.comment || ''
    return row
  })

  // ── Sheet 2: Daily Averages ───────────────────────────────────────────────
  const byDate: Record<string, any[]> = {}
  runs.forEach((r: any) => {
    const d = r.date || 'Unknown'
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(r)
  })
  const dailyRows = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rs]) => {
      const row: any = { 'Date': date, 'Runs': rs.length }
      row['Avg Bulk Density'] = avg(rs.map((r: any) => r.bulkDensity))
      row['Avg Leaf Shade'] = avg(rs.map((r: any) => r.leafShade))
      meshLabels.forEach(m => {
        row[`Avg ${m.replace(' (%)', '%')}`] = avg(rs.map((r: any) => r[m]))
      })
      row['Pass Count'] = rs.filter((r: any) => r.passStatus === 'Pass').length
      row['Fail Count'] = rs.filter((r: any) => r.passStatus === 'Fail').length
      return row
    })
  // ── Sheet 3: Summary by Grade/Variant ────────────────────────────────────
  const byGV: Record<string, any[]> = {}
  runs.forEach((r: any) => {
    const key = `${r.grade} · ${r.variant}`
    if (!byGV[key]) byGV[key] = []
    byGV[key].push(r)
  })
  const gradeRows = Object.entries(byGV)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([gv, rs]) => {
      const row: any = { 'Grade · Variant': gv, 'Runs': rs.length }
      row['Pass Rate %'] = rs.length ? Math.round(rs.filter((r: any) => r.passStatus === 'Pass').length / rs.length * 100) : null
      row['Avg Bulk Density'] = avg(rs.map((r: any) => r.bulkDensity))
      row['Avg Leaf Shade'] = avg(rs.map((r: any) => r.leafShade))
      meshLabels.forEach(m => {
        row[`Avg ${m.replace(' (%)', '%')}`] = avg(rs.map((r: any) => r[m]))
      })
      return row
    })

  const pct = '0.0"%"'
  const meshKey = (m: string) => m.replace(' (%)', '%')
  const rawNumFmt: Record<string, string> = { 'Bulk Density': '0', 'Leaf Shade': '0', 'Needle Count': '0' }
  meshLabels.forEach(m => { rawNumFmt[meshKey(m)] = pct })
  const dailyNumFmt: Record<string, string> = { 'Runs': '0', 'Avg Bulk Density': '0', 'Avg Leaf Shade': '0', 'Pass Count': '0', 'Fail Count': '0' }
  meshLabels.forEach(m => { dailyNumFmt[`Avg ${meshKey(m)}`] = pct })
  const gradeNumFmt: Record<string, string> = { 'Runs': '0', 'Pass Rate %': '0"%"', 'Avg Bulk Density': '0', 'Avg Leaf Shade': '0' }
  meshLabels.forEach(m => { gradeNumFmt[`Avg ${meshKey(m)}`] = pct })

  const rawFill = (r: any) => {
    const t: Record<string, Tone> = {}
    if (r['Pass/Fail'] === 'Pass') t['Pass/Fail'] = 'ok'
    else if (r['Pass/Fail'] === 'Fail') t['Pass/Fail'] = 'err'
    if (r['Violations']) t['Violations'] = 'err'
    return Object.keys(t).length ? t : undefined
  }
  const dailyFill = (r: any) => (typeof r['Fail Count'] === 'number' && r['Fail Count'] > 0 ? { 'Fail Count': 'err' as Tone } : undefined)
  const gradeFill = (r: any) => {
    if (typeof r['Pass Rate %'] === 'number') return { 'Pass Rate %': (r['Pass Rate %'] === 100 ? 'ok' : 'warn') as Tone }
    return undefined
  }

  const date = new Date().toISOString().slice(0, 10)
  await buildStyledWorkbook([
    { name: 'Raw Data',       rows: rawRows,   numFmt: rawNumFmt,   fill: rawFill },
    { name: 'Daily Averages', rows: dailyRows, numFmt: dailyNumFmt, fill: dailyFill },
    { name: 'By Grade',       rows: gradeRows, numFmt: gradeNumFmt, fill: gradeFill },
  ], { subtitle: `Sieving — ${product}` }, `Sieving_${product.replace(/ /g, '_')}_${date}.xlsx`)
}

// ── Shift Roster ──────────────────────────────────────────────────────────────

export async function exportRosterPeriod(
  period: { name: string; day_label: string | null; night_label: string | null },
  entries: Array<{ role_key: string; shift: 'day' | 'night'; person_name: string; tags: string[] }>,
  roles: Array<{ key: string; name: string }>,
  roleCategory: Map<string, string>,
  categories: Array<{ key: string; label: string; colorHex: string }>,
  dateRange: string,
) {
  const roleName = new Map(roles.map(r => [r.key, r.name]))
  const catName  = new Map(categories.map(c => [c.key, c.label]))
  const catColorByLabel = new Map(categories.map(c => [c.label, c.colorHex]))

  // Group entries by role, then by shift
  const byRole = new Map<string, { day: typeof entries; night: typeof entries }>()
  entries.forEach(e => {
    if (!byRole.has(e.role_key)) byRole.set(e.role_key, { day: [], night: [] })
    const bucket = byRole.get(e.role_key)!
    ;(e.shift === 'day' ? bucket.day : bucket.night).push(e)
  })

  const sorted = [...byRole.entries()].sort((a, b) => {
    const catA = roleCategory.get(a[0]) ?? ''
    const catB = roleCategory.get(b[0]) ?? ''
    return catA.localeCompare(catB) || a[0].localeCompare(b[0])
  })

  const dayLabel = period.day_label || 'Day Shift'
  const nightLabel = period.night_label || 'Night Shift'

  const rows = sorted.map(([roleKey, shifts]) => {
    const cat = roleCategory.get(roleKey) ?? ''
    return {
      'Section': catName.get(cat) ?? cat,
      'Role': roleName.get(roleKey) ?? roleKey,
      [`${dayLabel} — People`]: shifts.day.map(e => e.person_name).join('; '),
      [`${dayLabel} — Tags`]: [...new Set(shifts.day.flatMap(e => e.tags))].join(' '),
      [`${nightLabel} — People`]: shifts.night.map(e => e.person_name).join('; '),
      [`${nightLabel} — Tags`]: [...new Set(shifts.night.flatMap(e => e.tags))].join(' '),
    }
  })

  const rowFill = (r: Record<string, any>) => {
    const hex = catColorByLabel.get(r['Section'])
    return hex ? lighten(hex, 0.85) : undefined
  }

  await buildStyledWorkbook(
    [{ name: 'Roster', rows, rowFill, boldCols: ['Section'] }],
    { subtitle: `Shift Roster — ${dateRange}` },
    `Shift Roster (${dateRange}).xlsx`,
  )
}

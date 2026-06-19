// lib/utils/exportExcel.ts — Excel export helpers for QC workcenters
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as XLSX from 'xlsx'

// ── helpers ──────────────────────────────────────────────────────────────────

function dl(wb: XLSX.WorkBook, filename: string) {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
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

// ── Pasteuriser ───────────────────────────────────────────────────────────────

const PAST_SIEVES = ['gt6','gt10','gt12','gt16','gt20','gt60','dust']
const PAST_SIEVE_LABELS: Record<string,string> = {
  gt6:'>6%', gt10:'>10%', gt12:'>12%', gt16:'>16%', gt20:'>20%', gt60:'>60%', dust:'Dust%'
}

export function exportPasteuriserBatch(batch: any) {
  const wb = XLSX.utils.book_new()
  const samples: any[] = batch.samples || []

  // ── Sheet 1: Raw Data ─────────────────────────────────────────────────────
  const rawRows = samples.map((s: any, i: number) => {
    const row: any = {
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawRows), 'Raw Data')

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
      row['Sieve Samples'] = ss.filter((s: any) => s.has_sieve).length
      row['MB Samples'] = ss.filter((s: any) => s.has_mb).length
      row['Sensorial Pass'] = ss.filter((s: any) => s.sensorial_pass === 'Pass').length
      row['Sensorial Reject'] = ss.filter((s: any) => s.sensorial_pass === 'Reject').length
      return row
    })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows.length ? dailyRows : [{ 'Note': 'No samples recorded' }]), 'Daily Averages')

  // ── Sheet 3: Batch Summary ────────────────────────────────────────────────
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
    { Field: '---',              Value: '' },
    { Field: 'Total Samples',    Value: samples.length },
    { Field: 'Sieve Samples',    Value: sieveSamples.length },
    { Field: 'MB Samples',       Value: mbSamples.length },
    { Field: 'Sensorial Done',   Value: samples.filter((s: any) => s.has_sensorial).length },
    { Field: '---',              Value: '' },
    { Field: 'Avg Temp (°C)',    Value: fmtAvg(avg(samples.map((s: any) => s.hourly_temp)), '°C') },
    ...PAST_SIEVES.map(k => ({
      Field: `Avg ${PAST_SIEVE_LABELS[k]}`,
      Value: fmtAvg(avg(sieveSamples.map((s: any) => s[k])), '%')
    })),
    { Field: 'Avg Moisture %',   Value: fmtAvg(avg(mbSamples.map((s: any) => s.moisture)), '%') },
    { Field: 'Avg BD (cc/100g)', Value: fmtAvg(avg(mbSamples.map((s: any) => s.untapped_bd))) },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Batch Summary')

  const date = batch.production_date || new Date().toISOString().slice(0, 10)
  dl(wb, `Pasteuriser_${batch.batch_number}_${date}.xlsx`)
}

// ── Granule Line ──────────────────────────────────────────────────────────────

export function exportGranuleRun(
  run: any,
  sieves: Array<{ key: string; label: string }>
) {
  const wb = XLSX.utils.book_new()
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawRows.length ? rawRows : [{ Note: 'No samples' }]), 'Raw Data')

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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows.length ? dailyRows : [{ Note: 'No samples' }]), 'Daily Averages')

  // ── Sheet 3: Run Summary ──────────────────────────────────────────────────
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
    { Field: '---',              Value: '' },
    { Field: 'Total Samples',    Value: samples.length },
    { Field: 'Sieve Samples',    Value: sieveSamples.length },
    { Field: '---',              Value: '' },
    { Field: 'Avg Moisture %',   Value: fmtAvg(avg(samples.map((s: any) => s.moisture)), '%') },
    { Field: 'Avg BD (cc/100g)', Value: fmtAvg(avg(samples.map((s: any) => s.bulk_density))) },
    { Field: 'Avg Dryer Temp',   Value: fmtAvg(avg(samples.map((s: any) => s.dryer_temp)), '°C') },
    ...sieves.map(sv => ({
      Field: `Avg ${sv.label}%`,
      Value: fmtAvg(avg(sieveSamples.map((s: any) => n(s.sieve_pct?.[sv.key]))), '%')
    })),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Run Summary')

  const date = run.production_date || new Date().toISOString().slice(0, 10)
  dl(wb, `GranuleLine_${run.batch_number}_${date}.xlsx`)
}

// ── Sieving Tower ─────────────────────────────────────────────────────────────

export function exportSievingRuns(
  product: string,
  runs: any[],
  meshLabels: string[]   // e.g. ['>6 (%)', '>10 (%)', ...]
) {
  const wb = XLSX.utils.book_new()

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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawRows.length ? rawRows : [{ Note: 'No runs' }]), 'Raw Data')

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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows.length ? dailyRows : [{ Note: 'No runs' }]), 'Daily Averages')

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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gradeRows.length ? gradeRows : [{ Note: 'No data' }]), 'By Grade')

  const date = new Date().toISOString().slice(0, 10)
  dl(wb, `Sieving_${product.replace(/ /g, '_')}_${date}.xlsx`)
}

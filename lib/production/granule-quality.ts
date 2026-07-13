/**
 * Granule quality — the single source of moisture / bulk-density readings is the
 * QC lab, captured on the Granule QC page into qms.granule_runs (headers, keyed by
 * batch_number + production_date) → qms.granule_samples (per-sample moisture,
 * bulk_density with sample_date/time). Production capture and the dashboard read
 * from here by LOT NUMBER (+ date) instead of re-capturing, so there's one graph
 * and one truth linked across QC and production.
 */
import { getDb } from '@/lib/supabase/db'

// Normalise a batch/lot number so "RSGG-04526" / "RSGG 04526" / "rsgg_04526"
// all match — same rule the QC page uses for duplicate detection.
export function normBatch(b: string | null | undefined): string {
  return (b ?? '').trim().toLowerCase().replace(/_/g, '-').replace(/\s*-\s*/g, '-')
}

export interface QualityPoint {
  date: string
  time: string
  moisture: number | null
  bulkDensity: number | null
  batch: string
}

const num = (v: any): number | null => {
  const x = parseFloat(String(v).replace(',', '.'))
  return isNaN(x) ? null : x
}

/**
 * Fetch QC granule quality readings (moisture % + bulk density cc/100g).
 * @param opts.lot       match only runs whose batch_number equals this lot (normalised)
 * @param opts.fromDate  only runs with production_date >= this (yyyy-MM-dd)
 * Returns points sorted by date then time. Best-effort: returns [] on any error.
 */
export async function fetchGranuleQuality(opts: { lot?: string; fromDate?: string } = {}): Promise<QualityPoint[]> {
  try {
    const db = getDb()
    let runQ = db.schema('qms').from('granule_runs').select('id,batch_number,production_date')
    if (opts.fromDate) runQ = runQ.gte('production_date', opts.fromDate)
    const { data: runs } = await runQ
    let runList = (runs as any[]) ?? []
    if (opts.lot) {
      const key = normBatch(opts.lot)
      runList = runList.filter(r => normBatch(r.batch_number) === key)
    }
    if (!runList.length) return []
    const runMap = new Map(runList.map(r => [r.id, r]))
    const { data: samples } = await db.schema('qms').from('granule_samples')
      .select('run_id,sample_date,sample_time,moisture,bulk_density')
      .in('run_id', runList.map(r => r.id))
    const points = ((samples as any[]) ?? []).map(s => {
      const r = runMap.get(s.run_id)
      return {
        date: s.sample_date || r?.production_date || '',
        time: s.sample_time || '',
        moisture: num(s.moisture),
        bulkDensity: num(s.bulk_density),
        batch: r?.batch_number ?? '',
      } as QualityPoint
    }).filter(p => p.moisture != null || p.bulkDensity != null)
    points.sort((a, b) => (`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`))
    return points
  } catch {
    return []
  }
}

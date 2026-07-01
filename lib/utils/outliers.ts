// lib/utils/outliers.ts
//
// Shared statistical outlier / typing-error detection used across the
// Quality module (pasteuriser, granule, sieving). A value is flagged only
// when the comparison history already has real spread (std > stdFloor) AND
// the new value sits more than `threshold` standard deviations from the mean
// — this avoids false positives on tightly-controlled fields.

export interface OutlierCheck {
  flagged: boolean
  mean:    number
  std:     number
}

export function checkOutlier(
  value:    number,
  history:  number[],
  stdFloor: number,
  threshold = 2.5,
): OutlierCheck | null {
  if (isNaN(value) || history.length < 3) return null
  const mean = history.reduce((a, b) => a + b, 0) / history.length
  const std  = Math.sqrt(history.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / history.length)
  if (std <= stdFloor) return null
  return { flagged: Math.abs(value - mean) > threshold * std, mean, std }
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN
}

export function stdDev(values: number[]): number {
  if (!values.length) return NaN
  const m = mean(values)
  return Math.sqrt(values.map(v => (v - m) ** 2).reduce((a, b) => a + b, 0) / values.length)
}

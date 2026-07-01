// lib/utils/formatDate.ts
//
// Scientific (ISO 8601) date formatting — the single standard used across
// the Quality module so every date/timestamp reads the same way everywhere:
// date-only   -> YYYY-MM-DD          e.g. 2026-06-30
// date + time -> YYYY-MM-DD HH:mm    e.g. 2026-06-30 14:05 (24-hour, local time)

function toValidDate(d: string | number | Date | null | undefined): Date | null {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? null : dt
}

export function isoDate(d: string | number | Date | null | undefined): string {
  const dt = toValidDate(d)
  if (!dt) return '—'
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isoDateTime(d: string | number | Date | null | undefined): string {
  const dt = toValidDate(d)
  if (!dt) return '—'
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return `${isoDate(dt)} ${hh}:${mm}`
}

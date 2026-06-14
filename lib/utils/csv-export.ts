// Minimal client-side CSV export. No dependency — Blob + object URL download.
// Gate the calling UI on the `can_export_csv` permission.

export interface CsvColumn<T> {
  header: string
  value:  (row: T) => string | number | null | undefined
}

function escapeCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  // Quote if the cell contains a comma, quote, or newline; double up inner quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build a CSV string from rows + typed columns. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map(c => escapeCell(c.header)).join(',')
  const body = rows.map(r => columns.map(c => escapeCell(c.value(r))).join(',')).join('\n')
  return `${head}\n${body}`
}

/** Trigger a browser download of `rows` as `filename`.csv. */
export function downloadCsv<T>(rows: T[], columns: CsvColumn<T>[], filename: string): void {
  const csv  = toCsv(rows, columns)
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

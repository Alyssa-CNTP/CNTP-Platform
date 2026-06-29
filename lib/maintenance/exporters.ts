// lib/maintenance/exporters.ts
// Client-side export/print helpers for job cards and checklists. No external
// deps — CSV via a Blob download, print via a hidden print window.

import type { JobCard } from './types'
import { fmtDT, diffM } from './helpers'

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const JOBCARD_COLUMNS: { h: string; get: (j: JobCard) => unknown }[] = [
  { h: 'Card No', get: j => j.card_no },
  { h: 'Workflow', get: j => j.workflow },
  { h: 'Status', get: j => j.status },
  { h: 'Urgency', get: j => j.urgency ?? '' },
  { h: 'Area', get: j => j.area },
  { h: 'Machine', get: j => j.machine ?? '' },
  { h: 'Description', get: j => j.description },
  { h: 'Raised By', get: j => j.raised_by },
  { h: 'Raised At', get: j => fmtDT(j.raised_at) },
  { h: 'Technician', get: j => j.assigned_to ?? '' },
  { h: 'Accepted At', get: j => fmtDT(j.accepted_at) },
  { h: 'Started At', get: j => fmtDT(j.started_at) },
  { h: 'Completed At', get: j => fmtDT(j.completed_at) },
  { h: 'Duration (min)', get: j => (j.completed_at ? diffM(j.workflow === 'breakdown' ? j.raised_at : (j.started_at ?? j.accepted_at), j.completed_at) : '') },
  { h: 'Root Cause', get: j => j.root_cause },
  { h: 'Work Done', get: j => j.work_done },
  { h: 'QC Required', get: j => (j.qc_required ? 'Yes' : 'No') },
  { h: 'Reopens', get: j => j.reopen_count ?? 0 },
]

export function exportJobCardsCsv(cards: JobCard[], filename = 'job-cards.csv') {
  const header = JOBCARD_COLUMNS.map(c => csvCell(c.h)).join(',')
  const rows = cards.map(j => JOBCARD_COLUMNS.map(c => csvCell(c.get(j))).join(','))
  downloadBlob([header, ...rows].join('\n'), filename, 'text/csv;charset=utf-8')
}

// Generic table-to-print: opens a clean print window for any header/rows pair.
export function printTable(title: string, headers: string[], rows: (string | number)[][]) {
  const w = window.open('', '_blank', 'width=1000,height=700')
  if (!w) return
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const thead = headers.map(h => `<th>${esc(h)}</th>`).join('')
  const tbody = rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#1a2415}
    h1{font-size:18px;margin:0 0 4px} .meta{color:#667085;font-size:12px;margin-bottom:16px}
    table{border-collapse:collapse;width:100%;font-size:11px}
    th,td{border:1px solid #d0d5dd;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#f2f4f0;text-transform:uppercase;font-size:9px;letter-spacing:.05em}
    @media print{button{display:none}}
  </style></head><body>
    <h1>${esc(title)}</h1>
    <div class="meta">${esc(new Date().toLocaleString('en-ZA'))} · ${rows.length} row${rows.length === 1 ? '' : 's'}</div>
    <button onclick="window.print()" style="margin-bottom:12px;padding:6px 12px">Print</button>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
  </body></html>`)
  w.document.close()
  setTimeout(() => { try { w.print() } catch { /* user can use the button */ } }, 400)
}

export function printJobCards(cards: JobCard[], title = 'Job cards') {
  printTable(
    title,
    JOBCARD_COLUMNS.map(c => c.h),
    cards.map(j => JOBCARD_COLUMNS.map(c => String(c.get(j) ?? ''))),
  )
}

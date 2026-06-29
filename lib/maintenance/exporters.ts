// lib/maintenance/exporters.ts
// Client-side export/print helpers for job cards and checklists. No external
// deps — CSV via a Blob download, print via a hidden print window.

import type { JobCard, CardLog, SpareUsed, Template, Completion } from './types'
import { fmtDT, fmtD, diffM } from './helpers'

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

// ── Single-document prints (one job card / one checklist) ──
const escHtml = (s: unknown) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

// Open a clean print window with a pre-built HTML body, then trigger print.
function printDocument(title: string, bodyHtml: string) {
  const w = window.open('', '_blank', 'width=900,height=800')
  if (!w) return
  w.document.write(`<!doctype html><html><head><title>${escHtml(title)}</title><style>
    body{font-family:system-ui,Arial,sans-serif;margin:28px;color:#1a2415;font-size:12px;line-height:1.45}
    h1{font-size:20px;margin:0 0 2px} h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.05em;color:#475467;border-bottom:1px solid #e4e7ec;padding-bottom:4px}
    .meta{color:#667085;font-size:11px;margin-bottom:14px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}
    .f{padding:3px 0;border-bottom:1px solid #f2f4f0}
    .f b{display:inline-block;min-width:120px;color:#475467;font-weight:600}
    .block{white-space:pre-wrap;padding:6px 0}
    table{border-collapse:collapse;width:100%;font-size:11px;margin-top:4px}
    th,td{border:1px solid #d0d5dd;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#f2f4f0;text-transform:uppercase;font-size:9px;letter-spacing:.05em}
    .pill{display:inline-block;padding:1px 7px;border:1px solid #d0d5dd;border-radius:10px;font-size:10px;font-weight:600;text-transform:uppercase}
    @media print{button{display:none}}
  </style></head><body>
    <button onclick="window.print()" style="margin-bottom:14px;padding:6px 12px;cursor:pointer">Print</button>
    ${bodyHtml}
  </body></html>`)
  w.document.close()
  setTimeout(() => { try { w.print() } catch { /* user can use the button */ } }, 400)
}

// Print one full job card as a document (header, work/root-cause, spares, activity).
export function printJobCardDetail(j: JobCard, logs: CardLog[] = [], spares: SpareUsed[] = []) {
  const dur = j.completed_at ? diffM(j.workflow === 'breakdown' ? j.raised_at : (j.started_at ?? j.accepted_at), j.completed_at) : null
  const f = (label: string, val: unknown) => `<div class="f"><b>${escHtml(label)}</b>${escHtml(val ?? '—')}</div>`
  const spareRows = spares.length
    ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Source</th><th>Critical</th></tr></thead><tbody>${
        spares.map(s => `<tr><td>${escHtml(s.description)}</td><td>${escHtml(s.qty)}</td><td>${escHtml(s.from_stock)}</td><td>${s.is_critical ? 'YES' : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="block">No spares logged.</div>'
  const logRows = logs.length
    ? `<table><thead><tr><th>When</th><th>Type</th><th>Stage</th><th>Author</th><th>Note</th></tr></thead><tbody>${
        logs.map(l => `<tr><td>${escHtml(fmtDT(l.created_at))}</td><td>${escHtml(l.kind)}</td><td>${escHtml(l.stage.replace(/_/g, ' '))}</td><td>${escHtml(l.author)}</td><td>${escHtml(l.body)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="block">No activity logged.</div>'
  printDocument(`Job card ${j.card_no}`, `
    <h1>Job card ${escHtml(j.card_no)}</h1>
    <div class="meta">${escHtml(j.workflow === 'breakdown' ? 'Breakdown' : 'Planned')} · ${escHtml(j.area)}${j.machine ? ' · ' + escHtml(j.machine) : ''} · printed ${escHtml(new Date().toLocaleString('en-ZA'))}</div>
    <div class="grid">
      ${f('Status', j.status.replace(/_/g, ' '))}
      ${f('Urgency', j.urgency ?? '(auto)')}
      ${f('Raised by', j.raised_by)}
      ${f('Raised at', fmtDT(j.raised_at))}
      ${f('Technician', j.external ? `${j.external_company} (external)` : (j.assigned_to ?? '—'))}
      ${f('Accepted', fmtDT(j.accepted_at))}
      ${f('Started', fmtDT(j.started_at))}
      ${f('Completed', fmtDT(j.completed_at))}
      ${f('Duration', dur != null ? dur + ' min' : '—')}
      ${f('QC', j.qc_required ? `Required${j.qc_name ? ' — ' + j.qc_name : ''}` : 'Not required')}
      ${f('Reopens', j.reopen_count ?? 0)}
      ${f('Verified', j.verified_ok == null ? '—' : (j.verified_ok ? 'OK' : 'Redo'))}
    </div>
    <h2>Description</h2><div class="block">${escHtml(j.description)}${j.long_desc ? '\n\n' + escHtml(j.long_desc) : ''}</div>
    <h2>Work done</h2><div class="block">${escHtml(j.work_done || '—')}</div>
    <h2>Root cause</h2><div class="block">${escHtml(j.root_cause || '—')}</div>
    ${j.tools_used ? `<h2>Tools used</h2><div class="block">${escHtml(j.tools_used)}</div>` : ''}
    <h2>Spares used</h2>${spareRows}
    <h2>Activity log</h2>${logRows}
  `)
}

// Print a single checklist (one area's tasks) with the who/when audit trail.
export function printChecklistOne(tpl: Template, comp: Completion | undefined, period: string) {
  const st = comp?.task_states ?? {}
  const rows = tpl.tasks.map((task, ti) => {
    const s: any = st[ti] ?? {}
    return `<tr><td>${escHtml(task)}</td><td>${s.done ? '✓ Done' : 'Outstanding'}</td><td>${s.fault ? 'FAULT' : ''}</td><td>${escHtml(s.by ?? '')}</td><td>${escHtml(s.at ? fmtD(s.at) : '')}</td><td>${escHtml(s.notes ?? '')}</td></tr>`
  }).join('')
  const doneN = tpl.tasks.filter((_, i) => (st as any)[i]?.done).length
  printDocument(`${tpl.area} checklist — ${period}`, `
    <h1>${escHtml(tpl.area)}</h1>
    <div class="meta">${escHtml(tpl.doc_ref)} · ${escHtml(tpl.frequency)} · ${period} · ${doneN}/${tpl.tasks.length} done${comp?.completed_by ? ' · last by ' + escHtml(comp.completed_by) : ''}</div>
    <table><thead><tr><th>Task</th><th>Status</th><th>Fault</th><th>By</th><th>Date</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
    ${comp?.comments ? `<h2>Comments</h2><div class="block">${escHtml(comp.comments)}</div>` : ''}
  `)
}

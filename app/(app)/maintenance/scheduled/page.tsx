'use client'

// app/(app)/maintenance/scheduled/page.tsx
// Scheduled maintenance dashboard — Overview (actions needed), weekly / monthly
// checklists with a who+when audit trail and fault→job-card links, annual /
// calibration registers, and Readings & Trends (water, IP, diesel, loadshedding,
// run-hours, boiler starts) with the Excel database history and due-date formulas.

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { useMaintenanceContext } from '../layout'
import { calClass, calBadge, fmtD, fmtT } from '@/lib/maintenance/helpers'
import { TECHS } from '@/lib/maintenance/constants'
import { printTable } from '@/lib/maintenance/exporters'
import { INP } from '@/components/production/shared/ui'

// Order forklift run-hour rows by their forklift number; non-forklifts keep their
// (days-to-service) order ahead of them.
const forkliftNum = (name: string): number | null => {
  const m = /fork\s*lift\D*(\d+)/i.exec(name || '')
  return m ? parseInt(m[1], 10) : null
}

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'
const BTN_OK = 'bg-ok text-white rounded-lg px-3 py-2 text-[12px] font-semibold hover:brightness-110 transition'
const BTN_SM = 'border border-surface-rule bg-surface-card text-text rounded-md px-2.5 py-1.5 text-[11px] font-semibold hover:border-text/25 transition'

// Tiny SVG line chart for trends — no chart library needed
function Spark({ pts, color = '#2563eb', h = 44, labels }: { pts: number[]; color?: string; h?: number; labels?: [string, string] }) {
  if (pts.length < 2) return <div className="text-[11px] text-text-faint py-2">Not enough data yet</div>
  const min = Math.min(...pts), max = Math.max(...pts), w = 200
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${max === min ? h / 2 : h - ((v - min) / (max - min)) * (h - 8) - 4}`).join(' ')
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
        <polyline points={xy} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {labels && <div className="flex justify-between text-[10px] text-text-faint"><span>{labels[0]}</span><span>{labels[1]}</span></div>}
    </div>
  )
}

export default function ScheduledPage() {
  const { loading, data, actions, derived, ui, weekKey, moKey, actor } = useMaintenanceContext()
  const { templates, waterReadings, ipReadings, dieselReadings, lsLogs, boilerStarts, eqHours, staff } = data
  const { getComp, saveComp, toggleTask, setTaskField, saveAnnualNotes, raiseFromChecklist, saveReading, calDone, calDoneOn, eqServiced } = actions
  const { annualRows, lastComp, eqLatest, calRows, waterUsage, ipUsage, outstandingChecklists } = derived
  const { drafts, setDrafts, setPopup } = ui

  const [sub, setSub] = useState(0)
  const [openCL, setOpenCL] = useState<number | null>(null)
  const [calSearch, setCalSearch] = useState('')
  const [rd, setRd] = useState<Record<string, string>>({})
  // Trend window for the Readings & Trends sparks (weeks of history to plot).
  const [trendWeeks, setTrendWeeks] = useState(26)
  // Run-hours list ordered so forklifts are grouped in forklift-number order.
  const eqOrdered = [...eqLatest].sort((a, b) => {
    const fa = forkliftNum(a.cfg.equipment), fb = forkliftNum(b.cfg.equipment)
    if (fa == null && fb == null) return a.days - b.days
    if (fa == null) return -1
    if (fb == null) return 1
    return fa - fb
  })

  // Print the current weekly/monthly checklist set (status + who/when per task).
  const printChecklists = (freq: 'weekly' | 'monthly', period: string) => {
    const rows: (string | number)[][] = []
    templates.filter(t => t.frequency === freq).forEach(cl => {
      const st = getComp(cl.id, period)?.task_states ?? {}
      cl.tasks.forEach((task, ti) => {
        const s: any = st[ti] ?? {}
        rows.push([cl.area, cl.doc_ref, task, s.done ? 'Done' : 'Outstanding', s.fault ? 'FAULT' : '', s.by ?? '', s.at ? fmtD(s.at) : '', s.notes ?? ''])
      })
    })
    printTable(`${freq === 'weekly' ? 'Weekly' : 'Monthly'} checklist — ${period}`,
      ['Area', 'Ref', 'Task', 'Status', 'Fault', 'By', 'Date', 'Notes'], rows)
  }

  const techNames = staff.length ? staff.map(s => s.name) : TECHS
  const lastOf = <T,>(arr: T[]) => arr[arr.length - 1]

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading…</div></div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Scheduled Maintenance</h1>
        <p className="text-sm text-text-muted mt-1">Weekly and monthly checklists, calibration & service due dates, and meter readings — every check is recorded with who did it and when.</p>
      </div>

      {/* Light segmented control */}
      <div className="flex items-center gap-1 bg-surface-dim rounded-lg p-1 w-fit flex-wrap">
        {['Overview', 'Weekly', 'Monthly', 'Annual / Calibration', 'Readings & Trends'].map((t, i) => (
          <button key={t} onClick={() => setSub(i)}
            className={`px-3.5 py-1.5 rounded-md text-[12px] font-semibold whitespace-nowrap transition ${sub === i ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text'}`}>{t}</button>
        ))}
      </div>

      {/* ── OVERVIEW: everything needing action, in one place ── */}
      {sub === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { v: outstandingChecklists.filter(x => x.t.frequency === 'weekly').length, l: `Weekly outstanding — ${weekKey}`, warn: true },
              { v: outstandingChecklists.filter(x => x.t.frequency === 'monthly').length, l: `Monthly outstanding — ${moKey}`, warn: true },
              { v: calRows.filter(c => c.days <= 0).length, l: 'Calibrations overdue', warn: true },
              { v: calRows.filter(c => c.days > 0 && c.days <= 30).length, l: 'Calibrations due ≤30d', warn: false },
              { v: eqLatest.filter(e => e.days <= 14).length, l: 'Services due ≤14d (run-hrs)', warn: false },
            ].map((t, i) => (
              <div key={i} className="card p-3 text-center">
                <div className={`text-2xl font-semibold tabular-nums ${t.v > 0 && t.warn ? 'text-err' : t.v > 0 ? 'text-warn' : 'text-ok'}`}>{t.v}</div>
                <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.l}</div>
              </div>
            ))}
          </div>

          {/* Actions needed */}
          <div>
            <h2 className="text-sm font-semibold text-text mb-2">Actions needed</h2>
            <div className="space-y-1.5">
              {calRows.filter(c => c.days <= 30).map(c => (
                <div key={'cal' + c.id} className="rounded-lg border border-surface-rule bg-surface-card px-3 py-2.5 flex items-center gap-2 text-[13px] flex-wrap">
                  <span className={`badge shrink-0 ${calClass(c.days)}`}>{calBadge(c.days)}</span>
                  <span className="flex-1 min-w-[220px]"><strong className="text-text">{c.asset_name}</strong> <span className="text-text-faint text-[11px]">({c.serial_no}{c.department ? ' · ' + c.department : ''})</span> <span className="text-text-muted">— {c.days <= 0 ? 'overdue by ' + Math.abs(c.days) + ' days' : 'due in ' + c.days + ' days'} · last done {fmtD(c.last_done)}</span></span>
                  <button className={BTN_SM} onClick={() => calDone(c)}>Done today</button>
                  <button className={BTN_SM} onClick={() => setSub(3)}>Register</button>
                </div>
              ))}
              {eqLatest.filter(e => e.days <= 14 && e.latest).map(e => (
                <div key={'eq' + e.cfg.id} className="rounded-lg border border-surface-rule bg-surface-card px-3 py-2.5 flex items-center gap-2 text-[13px] flex-wrap">
                  <span className={`badge shrink-0 ${calClass(e.days)}`}>{e.days <= 0 ? 'SERVICE OVERDUE' : 'SERVICE DUE'}</span>
                  <span className="flex-1 min-w-[220px]"><strong className="text-text">{e.cfg.equipment}</strong> <span className="text-text-muted">— {Math.round(e.latest!.hours_since_service!)} / {e.cfg.service_interval_hours} run-hrs since service · projected due {fmtD(e.due!.toISOString())}</span></span>
                  <button className={BTN_SM} onClick={() => eqServiced(e.cfg.equipment, e.latest!.total_hours)}>Serviced today</button>
                  <button className={BTN_SM} onClick={() => raiseFromChecklist(e.cfg.equipment, 'Run-hours service', `Service due — ${Math.round(e.latest!.hours_since_service!)} run-hours since last service`, '')}>Raise job card</button>
                </div>
              ))}
              {calRows.filter(c => c.days <= 30).length === 0 && eqLatest.filter(e => e.days <= 14 && e.latest).length === 0 && (
                <div className="card p-3 text-[12px] text-ok">✓ Nothing overdue — all calibrations and run-hour services are inside their windows.</div>
              )}
            </div>
          </div>

          {/* Outstanding checklists with last-done info */}
          <div>
            <h2 className="text-sm font-semibold text-text mb-2">Checklists outstanding this period</h2>
            <div className="rounded-xl border border-surface-rule bg-surface-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr>{['Checklist', 'Frequency', 'Progress', 'Last completed', 'By', ''].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>{outstandingChecklists.map(({ t, doneN, total, last }) => (
                    <tr key={t.id}>
                      <td className="font-semibold">{t.area} <span className="text-text-faint text-[10px] font-normal">{t.doc_ref}</span></td>
                      <td><span className={`badge ${t.frequency === 'weekly' ? 'badge-info' : 'badge-gray'}`}>{t.frequency.toUpperCase()}</span></td>
                      <td className={`font-semibold ${doneN > 0 ? 'text-warn' : 'text-err'}`}>{doneN}/{total}</td>
                      <td>{last ? last.period_key : 'never'}</td>
                      <td>{last?.completed_by || '—'}</td>
                      <td><button className={BTN_SM} onClick={() => { setSub(t.frequency === 'weekly' ? 1 : 2); setOpenCL(t.id) }}>Open</button></td>
                    </tr>
                  ))}</tbody>
                </table>
                {outstandingChecklists.length === 0 && <div className="p-3 text-[12px] text-ok">✓ All checklists completed for the current week and month.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {(sub === 1 || sub === 2) && (() => {
        const freq = sub === 1 ? 'weekly' : 'monthly'
        const period = freq === 'weekly' ? weekKey : moKey
        const list = templates.filter(t => t.frequency === freq)
        return (
          <div>
            <div className="mb-3 flex items-start justify-between gap-2 flex-wrap">
              <div>
              <h2 className="text-sm font-semibold text-text">{freq === 'weekly' ? 'Weekly checklists (WC) — ' + weekKey : 'Monthly checklists (MC) — ' + moKey}</h2>
              <p className="text-[12px] text-text-muted mt-0.5">
                {freq === 'weekly'
                  ? 'Complete every week. Tap an area to expand the checklist. Every tick records who checked it and when.'
                  : 'Full inspections per area, per the QM-FM checklist. Each task has a fault selector and action notes — a fault can raise a job card directly.'}
              </p>
              </div>
              <button onClick={() => printChecklists(freq, period)}
                className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2 text-[12px] font-semibold hover:border-text/30 transition shrink-0">
                <Printer size={14} /> Print / export {freq === 'weekly' ? 'weekly' : 'monthly'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {list.map(cl => {
                const comp = getComp(cl.id, period)
                const st = comp?.task_states ?? {}
                const doneN = cl.tasks.filter((_, i) => st[i]?.done).length
                const done = doneN === cl.tasks.length
                const isOpen = openCL === cl.id
                const prev = lastComp(cl.id)
                const dot = done ? 'bg-ok' : doneN > 0 ? 'bg-warn' : 'bg-text-faint'
                return (
                  <div key={cl.id} className={`rounded-xl border bg-surface-card transition ${isOpen ? 'border-text/20 shadow-sm' : 'border-surface-rule hover:border-text/20'}`}>
                    <div className="p-3 cursor-pointer flex justify-between items-center gap-2" onClick={() => setOpenCL(isOpen ? null : cl.id)}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-text truncate">{cl.area}</div>
                          <div className="text-[11px] text-text-faint">{cl.doc_ref} · {cl.tasks.length} tasks</div>
                          <div className={`text-[10px] mt-0.5 ${prev || done ? 'text-text-muted' : 'text-err'}`}>
                            {done && comp ? <>✓ Completed by <strong className="text-ok">{comp.completed_by || '—'}</strong> ({fmtD(comp.updated_at ?? null)})</>
                              : prev ? <>Last: {prev.period_key} by <strong className="text-text">{prev.completed_by || '—'}</strong></>
                              : 'Never completed in the system'}
                          </div>
                        </div>
                      </div>
                      <span className={`badge shrink-0 ${done ? 'badge-ok' : doneN > 0 ? 'badge-warn' : 'badge-gray'}`}>{done ? 'DONE' : doneN > 0 ? doneN + '/' + cl.tasks.length : 'NOT STARTED'}</span>
                    </div>
                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-surface-rule pt-2.5 max-h-[400px] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        {cl.tasks.map((task, ti) => {
                          const s = st[ti] ?? {}
                          return (
                            <div key={ti} className="mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center text-[11px] text-white cursor-pointer transition ${s.done ? 'bg-ok border-ok' : 'bg-transparent border-surface-rule hover:border-text/30'}`} onClick={() => toggleTask(cl, ti)}>
                                  {s.done && '✓'}
                                </div>
                                <span className={`text-[12px] flex-1 ${s.done ? 'text-text-muted line-through' : 'text-text'}`}>{task}</span>
                                {s.done && s.by && <span className="text-[10px] text-text-faint whitespace-nowrap shrink-0">{s.by} {fmtT(s.at ?? null)}</span>}
                              </div>
                              <div className="flex gap-1.5 mt-1" style={{ marginLeft: 28 }}>
                                {freq === 'monthly' && (
                                  <select className={`${INP} w-24 text-[11px] py-1 min-h-0`} value={s.fault ? 'YES' : 'NO'} onChange={e => setTaskField(cl, ti, 'fault', e.target.value === 'YES')}>
                                    <option value="NO">No Fault</option><option value="YES">Fault</option>
                                  </select>
                                )}
                                <input className={`${INP} flex-1 text-[11px] py-1 min-h-0`} placeholder="Action needed / notes…"
                                  value={drafts['t' + cl.id + '-' + ti] ?? s.notes ?? ''}
                                  onChange={e => setDrafts(p => ({ ...p, ['t' + cl.id + '-' + ti]: e.target.value }))}
                                  onBlur={e => setTaskField(cl, ti, 'notes', e.target.value)} />
                                {(s.fault || (drafts['t' + cl.id + '-' + ti] ?? s.notes)) && (
                                  <button className="shrink-0 border border-err/40 text-err bg-err/5 rounded-md px-2 py-1 text-[10px] font-semibold hover:bg-err/10 transition whitespace-nowrap"
                                    title="Raise a job card for this fault"
                                    onClick={() => raiseFromChecklist(cl.area, cl.doc_ref, task, drafts['t' + cl.id + '-' + ti] ?? s.notes ?? '')}>→ Job card</button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        <div className="mt-2.5"><label className={LB}>Comments</label>
                          <textarea className={`${INP} min-h-[36px]`}
                            value={drafts['c' + cl.id] ?? getComp(cl.id, period)?.comments ?? ''}
                            onChange={e => setDrafts(p => ({ ...p, ['c' + cl.id]: e.target.value }))}
                            onBlur={e => saveComp(cl, { comments: e.target.value })}
                            placeholder="General comments…" />
                        </div>
                        {!done && <button className="mt-2 border border-warn/40 text-warn bg-warn/5 rounded-lg px-3 py-2 min-h-[40px] text-[12px] font-semibold hover:bg-warn/10 transition" onClick={() => setPopup(cl.area + ': ' + (cl.tasks.length - doneN) + ' task(s) still outstanding! Please finish the remaining items.')}>Check missing items</button>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {sub === 3 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-text">Annual / calibration / verification</h2>
            <p className="text-[12px] text-text-muted mt-0.5">Boiler: 180-day warning. Others: 60, 30, 7, 1 day alerts. Email the supplier directly from the table.</p>
          </div>

          {annualRows.filter(a => a.days <= 60).length > 0 && (
            <div className="space-y-1.5">
              {annualRows.filter(a => a.days <= 60).map(a => (
                <div key={a.id} className="rounded-lg border border-surface-rule bg-surface-card px-3 py-2.5 flex items-center gap-2 text-[13px]">
                  <span className="flex-1"><strong className="text-text">{a.asset}</strong> <span className="text-text-muted">— {a.days <= 0 ? 'overdue by ' + Math.abs(a.days) + ' days' : 'due in ' + a.days + ' days'}</span></span>
                  <span className={`badge ${calClass(a.days)}`}>{calBadge(a.days)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-surface-rule bg-surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>{['Status', 'Category', 'Asset', 'Serial', 'Supplier', 'Due', 'Days', 'Email', 'Notes'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{annualRows.map(a => (
                  <tr key={a.id}>
                    <td><span className={`badge ${calClass(a.days)}`}>{calBadge(a.days)}</span></td>
                    <td><span className="badge badge-gray">{a.category}</span></td>
                    <td className="font-semibold">{a.asset}</td>
                    <td className="font-mono text-[11px]">{a.serial_no || '—'}</td>
                    <td>{a.supplier}</td>
                    <td>{fmtD(a.next_due)}</td>
                    <td className="font-semibold">{a.days}</td>
                    <td>{a.supplier !== 'Internal' && <button className={BTN_SM} onClick={() => setPopup('Draft Email to ' + a.supplier + ':\n\nSubject: ' + a.category + ' Due — ' + a.asset + '\n\nDear ' + a.supplier + ',\n\nPlease schedule ' + a.category.toLowerCase() + ' for:\nAsset: ' + a.asset + '\nSerial: ' + a.serial_no + '\nDue: ' + fmtD(a.next_due) + '\n\nPlease confirm.\n\nRegards,\nCNTP Maintenance')}>Email</button>}</td>
                    <td><input className={`${INP} w-28 text-[11px] py-1 min-h-0`} placeholder="Notes…"
                      value={drafts['a' + a.id] ?? a.notes}
                      onChange={e => setDrafts(p => ({ ...p, ['a' + a.id]: e.target.value }))}
                      onBlur={e => saveAnnualNotes(a.id, e.target.value)} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {/* Full calibration register imported from the Excel — next due = last done + interval */}
          <div>
            <h2 className="text-sm font-semibold text-text mb-2">Full calibration &amp; verification register ({calRows.length} assets)</h2>
            <input className={`${INP} max-w-[300px] mb-2`} placeholder="Search asset / serial / department…" value={calSearch} onChange={e => setCalSearch(e.target.value)} />
            <div className="rounded-xl border border-surface-rule bg-surface-card overflow-hidden">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="data-table">
                  <thead><tr>{['Status', 'Asset', 'Serial', 'Department', 'Last done', 'Interval', 'Next due', 'Days', '', 'Comment'].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>{calRows
                    .filter(c => !calSearch || (c.asset_name + ' ' + c.serial_no + ' ' + c.department).toLowerCase().includes(calSearch.toLowerCase()))
                    .map(c => (
                      <tr key={c.id}>
                        <td><span className={`badge ${calClass(c.days)}`}>{calBadge(c.days)}</span></td>
                        <td className="font-semibold">{c.asset_name}</td>
                        <td className="font-mono text-[10px]">{c.serial_no || '—'}</td>
                        <td>{c.department || '—'}</td>
                        <td>{fmtD(c.last_done)}</td>
                        <td>{c.interval_days}d</td>
                        <td>{c.next ? fmtD(c.next.toISOString()) : '—'}</td>
                        <td className="font-semibold">{c.days === 9999 ? '—' : c.days}</td>
                        <td>
                          <div className="flex gap-1 items-center">
                            <input className={`${INP} w-32 text-[11px] py-1 min-h-0`} type="date"
                              value={drafts['cd' + c.id] ?? (c.last_done ?? '').slice(0, 10)}
                              onChange={e => setDrafts(p => ({ ...p, ['cd' + c.id]: e.target.value }))} />
                            <button className={BTN_OK} title="Finalise on this date — recalculates the next cycle"
                              onClick={() => calDoneOn(c, drafts['cd' + c.id] ?? new Date().toISOString().slice(0, 10))}>Set</button>
                            <button className={BTN_SM} onClick={() => calDone(c)}>Today</button>
                          </div>
                        </td>
                        <td className="text-[10px] text-text-faint max-w-[160px]">{c.comment || '—'}</td>
                      </tr>
                    ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── READINGS & TRENDS: friendly numeric capture + history ── */}
      {sub === 4 && (
        <div className="space-y-4">
          <div className="card p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[12px] text-text-muted">
              Enter readings below — the previous value is shown next to each field and usage is calculated automatically (same formulas as the Excel database). Recording as <strong className="text-text">{actor}</strong>.
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-text-muted">Trend window:</span>
              {([['8w', 8], ['Quarter', 13], ['6 months', 26], ['Year', 52]] as [string, number][]).map(([l, n]) => (
                <button key={n} onClick={() => setTrendWeeks(n)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${trendWeeks === n ? 'bg-brand text-white' : 'bg-surface-dim text-text-muted hover:text-text'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Water meters */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text mb-1">💧 Water meters (weekly)</h3>
              {(() => { const last = lastOf(waterReadings); return (
                <div>
                  <div className="text-[11px] text-text-faint mb-2">Last reading: {last ? fmtD(last.reading_date) : '—'}</div>
                  {([['main_meter', 'Main Meter', last?.main_meter], ['unit1', 'Unit 1', last?.unit1], ['unit2_w1', 'Unit 2 W1', last?.unit2_w1], ['unit2_w2', 'Unit 2 W2', last?.unit2_w2], ['boiler', 'Boiler', last?.boiler]] as [string, string, number | null | undefined][]).map(([k, l, prev]) => (
                    <div key={k} className="flex gap-2 items-center mb-1.5">
                      <span className="text-[12px] w-20 text-text-muted shrink-0">{l}</span>
                      <input className={`${INP} flex-1`} type="number" inputMode="decimal" placeholder={prev != null ? 'prev: ' + prev : 'reading…'}
                        value={rd['w' + k] ?? ''} onChange={e => setRd(p => ({ ...p, ['w' + k]: e.target.value }))} />
                      <span className={`text-[11px] w-20 shrink-0 ${rd['w' + k] && prev != null ? (parseFloat(rd['w' + k]) >= prev ? 'text-ok' : 'text-err') : 'text-text-faint'}`}>
                        {rd['w' + k] && prev != null ? (parseFloat(rd['w' + k]) - prev).toFixed(1) + ' used' : ''}
                      </span>
                    </div>
                  ))}
                  <button className={`${BTN_OK} mt-1`} onClick={async () => {
                    const ok = await saveReading('water_readings', {
                      reading_date: new Date().toISOString().slice(0, 10),
                      main_meter: rd.wmain_meter ? parseFloat(rd.wmain_meter) : null,
                      unit1: rd.wunit1 ? parseFloat(rd.wunit1) : null,
                      unit2_w1: rd.wunit2_w1 ? parseFloat(rd.wunit2_w1) : null,
                      unit2_w2: rd.wunit2_w2 ? parseFloat(rd.wunit2_w2) : null,
                      boiler: rd.wboiler ? parseFloat(rd.wboiler) : null,
                    })
                    if (ok) setRd(p => ({ ...p, wmain_meter: '', wunit1: '', wunit2_w1: '', wunit2_w2: '', wboiler: '' }))
                  }}>Save water readings</button>
                  <div className="mt-3">
                    <div className={LB}>Main meter weekly usage (kL)</div>
                    <Spark pts={waterUsage.main.slice(-trendWeeks)} color="#2563eb" labels={[fmtD(waterReadings[Math.max(0, waterReadings.length - trendWeeks)]?.reading_date ?? null), fmtD(lastOf(waterReadings)?.reading_date ?? null)]} />
                    <div className={`${LB} mt-2`}>Boiler usage</div>
                    <Spark pts={waterUsage.boiler.slice(-trendWeeks)} color="#0891b2" />
                  </div>
                </div>
              )})()}
            </div>

            {/* IP usage */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text mb-1">🔥 IP (paraffin) usage</h3>
              {(() => { const last = lastOf(ipReadings); return (
                <div>
                  <div className="text-[11px] text-text-faint mb-2">Last: {last ? `${fmtD(last.reading_date)} — flow ${last.flow_meter_l} L, dip ${last.tank_dip_l ?? '—'} L` : '—'}</div>
                  {([['flow', 'Flow meter (L)', last?.flow_meter_l], ['dip', 'Tank dip (L)', last?.tank_dip_l], ['recv', 'Fuel received (L)', null], ['cost', 'Cost (R)', null]] as [string, string, number | null | undefined][]).map(([k, l, prev]) => (
                    <div key={k} className="flex gap-2 items-center mb-1.5">
                      <span className="text-[12px] w-28 text-text-muted shrink-0">{l}</span>
                      <input className={`${INP} flex-1`} type="number" inputMode="decimal" placeholder={prev != null ? 'prev: ' + prev : '…'}
                        value={rd['ip' + k] ?? ''} onChange={e => setRd(p => ({ ...p, ['ip' + k]: e.target.value }))} />
                      {k === 'flow' && rd.ipflow && last?.flow_meter_l != null && <span className="text-[11px] w-20 text-ok shrink-0">{(parseFloat(rd.ipflow) - last.flow_meter_l).toFixed(0)} L used</span>}
                    </div>
                  ))}
                  <button className={`${BTN_OK} mt-1`} onClick={async () => {
                    if (!rd.ipflow) { setPopup('Enter the flow meter reading.'); return }
                    const ok = await saveReading('ip_readings', {
                      reading_date: new Date().toISOString().slice(0, 10),
                      flow_meter_l: parseFloat(rd.ipflow),
                      tank_dip_l: rd.ipdip ? parseFloat(rd.ipdip) : null,
                      fuel_received_l: rd.iprecv ? parseFloat(rd.iprecv) : null,
                      cost_r: rd.ipcost ? parseFloat(rd.ipcost) : null,
                    })
                    if (ok) setRd(p => ({ ...p, ipflow: '', ipdip: '', iprecv: '', ipcost: '' }))
                  }}>Save IP reading</button>
                  <div className="mt-3">
                    <div className={LB}>Weekly IP usage (L)</div>
                    <Spark pts={ipUsage.slice(-trendWeeks)} color="#d97706" />
                  </div>
                </div>
              )})()}
            </div>

            {/* Generator / diesel */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text mb-1">⚡ Generator / diesel</h3>
              {(() => { const last = lastOf(dieselReadings); return (
                <div>
                  <div className="text-[11px] text-text-faint mb-2">Last: {last ? `${fmtD(last.reading_date)} — ${last.run_hours ?? 0} hrs, ${last.fuel_l ?? 0} L` : '—'}</div>
                  <div className="flex gap-2 items-center mb-1.5">
                    <span className="text-[12px] w-28 text-text-muted shrink-0">Run hours (week)</span>
                    <input className={`${INP} flex-1`} type="number" inputMode="decimal" value={rd.dhrs ?? ''} onChange={e => setRd(p => ({ ...p, dhrs: e.target.value }))} placeholder="0" />
                    {rd.dhrs && <span className="text-[11px] w-20 text-text-muted shrink-0">≈ {(parseFloat(rd.dhrs) * 40.7).toFixed(0)} L</span>}
                  </div>
                  <div className="flex gap-2 items-center mb-1.5">
                    <span className="text-[12px] w-28 text-text-muted shrink-0">Fuel used (L)</span>
                    <input className={`${INP} flex-1`} type="number" inputMode="decimal" value={rd.dfuel ?? ''} onChange={e => setRd(p => ({ ...p, dfuel: e.target.value }))} placeholder="auto from hours if blank" />
                  </div>
                  <button className={`${BTN_OK} mt-1`} onClick={async () => {
                    const hrs = parseFloat(rd.dhrs || '0') || 0
                    const ok = await saveReading('diesel_readings', {
                      reading_date: new Date().toISOString().slice(0, 10),
                      run_hours: hrs, fuel_l: rd.dfuel ? parseFloat(rd.dfuel) : Math.round(hrs * 40.7 * 10) / 10,
                    })
                    if (ok) setRd(p => ({ ...p, dhrs: '', dfuel: '' }))
                  }}>Save diesel reading</button>
                  <div className="mt-3">
                    <div className={LB}>Generator run hours / week</div>
                    <Spark pts={dieselReadings.slice(-trendWeeks).map(r => r.run_hours ?? 0)} color="#dc2626" />
                  </div>
                </div>
              )})()}
            </div>

            {/* Loadshedding / power outage log */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text mb-1">🔌 Loadshedding / power outage log</h3>
              <div className="flex gap-2 flex-wrap items-end mb-2">
                <div><label className={LB}>Date</label><input className={`${INP} w-36`} type="date" value={rd.lsdate ?? new Date().toISOString().slice(0, 10)} onChange={e => setRd(p => ({ ...p, lsdate: e.target.value }))} /></div>
                <div><label className={LB}>Stage</label><select className={`${INP} w-20`} value={rd.lsstage ?? 'X'} onChange={e => setRd(p => ({ ...p, lsstage: e.target.value }))}>{['X', '1', '2', '3', '4', '5', '6'].map(s => <option key={s}>{s}</option>)}</select></div>
                <div><label className={LB}>Time slot / type</label><input className={`${INP} w-36`} value={rd.lsslot ?? ''} onChange={e => setRd(p => ({ ...p, lsslot: e.target.value }))} placeholder="e.g. 18:00 - 20:30" /></div>
                <div><label className={LB}>Gen hours</label><input className={`${INP} w-20`} type="number" inputMode="decimal" value={rd.lshrs ?? ''} onChange={e => setRd(p => ({ ...p, lshrs: e.target.value }))} /></div>
                <button className={BTN_OK} onClick={async () => {
                  const ok = await saveReading('loadshedding_log', {
                    log_date: rd.lsdate ?? new Date().toISOString().slice(0, 10),
                    stage: rd.lsstage ?? 'X', time_slot: rd.lsslot || 'No loadshedding',
                    run_hours: rd.lshrs ? parseFloat(rd.lshrs) : null,
                  }, 'log_date')
                  if (ok) setRd(p => ({ ...p, lsslot: '', lshrs: '' }))
                }}>+ Log</button>
              </div>
              <div className="max-h-[180px] overflow-y-auto space-y-1">
                {lsLogs.slice(0, 14).map(l => (
                  <div key={l.id} className="text-[12px] flex gap-2 items-center px-2 py-1.5 bg-surface-raised rounded">
                    <span className="w-20 shrink-0">{fmtD(l.log_date)}</span>
                    <span className={`badge ${l.time_slot.toLowerCase().includes('outage') ? 'badge-err' : l.stage !== 'X' && l.stage !== 'x' ? 'badge-warn' : 'badge-ok'}`}>{l.time_slot.toLowerCase().includes('outage') ? 'OUTAGE' : (l.stage !== 'X' && l.stage !== 'x' ? 'STAGE ' + l.stage : 'OK')}</span>
                    <span className="text-text-muted flex-1 truncate">{l.time_slot}</span>
                    {l.run_hours != null && <span className="text-text-faint shrink-0">{l.run_hours}h gen</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Compressor + forklift run-hours */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text mb-1">🛠 Run-hours &amp; service due</h3>
              <div className="text-[11px] text-text-faint mb-2">Due = reading date + workdays to reach the service interval at the configured usage rate — exactly the Excel WORKDAY formula. Update hours weekly.</div>
              <div className="max-h-[420px] overflow-y-auto space-y-1.5">
                {eqOrdered.map(({ cfg, latest, due, days }) => (
                  <div key={cfg.id} className="bg-surface-raised rounded-lg p-2.5">
                    <div className="flex justify-between items-center gap-2 flex-wrap">
                      <strong className="text-[12px] text-text">{cfg.equipment}</strong>
                      {latest && due ? <span className={`badge ${calClass(days)}`}>{days <= 0 ? 'OVERDUE' : 'due ' + fmtD(due.toISOString())}</span> : <span className="badge badge-gray">NO DATA</span>}
                    </div>
                    {latest && latest.hours_since_service != null && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1.5 bg-surface-dim rounded overflow-hidden">
                          <div className={`h-full ${days <= 0 ? 'bg-err' : days <= 14 ? 'bg-warn' : 'bg-ok'}`} style={{ width: Math.min(100, (latest.hours_since_service / cfg.service_interval_hours) * 100) + '%' }} />
                        </div>
                        <span className="text-[10px] text-text-muted shrink-0">{Math.round(latest.hours_since_service)}/{cfg.service_interval_hours}h</span>
                      </div>
                    )}
                    <div className="flex gap-1.5 mt-2 items-center flex-wrap">
                      <input className={`${INP} w-24 text-[11px] py-1 min-h-0`} type="number" inputMode="decimal" placeholder={latest?.total_hours != null ? 'total: ' + latest.total_hours : 'total hrs'}
                        value={rd['eqt' + cfg.id] ?? ''} onChange={e => setRd(p => ({ ...p, ['eqt' + cfg.id]: e.target.value }))} />
                      <input className={`${INP} w-24 text-[11px] py-1 min-h-0`} type="number" inputMode="decimal" placeholder={latest?.hours_since_service != null ? 'since: ' + Math.round(latest.hours_since_service) : 'since service'}
                        value={rd['eqs' + cfg.id] ?? ''} onChange={e => setRd(p => ({ ...p, ['eqs' + cfg.id]: e.target.value }))} />
                      <button className={BTN_SM} onClick={async () => {
                        const total = rd['eqt' + cfg.id] ? parseFloat(rd['eqt' + cfg.id]) : null
                        let since = rd['eqs' + cfg.id] ? parseFloat(rd['eqs' + cfg.id]) : null
                        // like the Excel: new since = previous since + (new total − previous total)
                        if (since == null && total != null && latest?.total_hours != null && latest?.hours_since_service != null) since = latest.hours_since_service + (total - latest.total_hours)
                        if (total == null && since == null) { setPopup('Enter total hours or hours since service.'); return }
                        const ok = await saveReading('equipment_hours', { equipment: cfg.equipment, reading_date: new Date().toISOString().slice(0, 10), total_hours: total, hours_since_service: since, serviced: false, notes: '' })
                        if (ok) setRd(p => ({ ...p, ['eqt' + cfg.id]: '', ['eqs' + cfg.id]: '' }))
                      }}>+ Reading</button>
                      <button className={BTN_SM} onClick={() => eqServiced(cfg.equipment, latest?.total_hours ?? null)}>Serviced</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <div className={LB}>Compressor hours since service</div>
                <Spark pts={eqHours.filter(h => h.equipment === '500L Factory Compressor' && h.hours_since_service != null).slice(-trendWeeks).map(h => h.hours_since_service!)} color="#7c3aed" />
              </div>
            </div>

            {/* Boiler start log */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-text mb-1">♨ Boiler start log</h3>
              <div className="flex gap-2 flex-wrap items-end mb-2">
                <div><label className={LB}>Date</label><input className={`${INP} w-36`} type="date" value={rd.bsdate ?? new Date().toISOString().slice(0, 10)} onChange={e => setRd(p => ({ ...p, bsdate: e.target.value }))} /></div>
                <div><label className={LB}>Switched on by</label><select className={`${INP} w-32`} value={rd.bsby ?? techNames[0]} onChange={e => setRd(p => ({ ...p, bsby: e.target.value }))}>{techNames.map(t => <option key={t}>{t}</option>)}</select></div>
                <button className={BTN_OK} onClick={async () => {
                  await saveReading('boiler_start_log', { log_date: rd.bsdate ?? new Date().toISOString().slice(0, 10), switched_on_by: rd.bsby ?? techNames[0], morning_shift: '', afternoon_shift: '' }, 'log_date')
                }}>+ Log start</button>
              </div>
              <div className="max-h-[180px] overflow-y-auto space-y-1">
                {boilerStarts.map(b => (
                  <div key={b.id} className="text-[12px] flex gap-2 items-center px-2 py-1.5 bg-surface-raised rounded">
                    <span className="w-20 shrink-0">{fmtD(b.log_date)}</span>
                    <strong className="w-20 text-text shrink-0">{b.switched_on_by}</strong>
                    {b.morning_shift && <span className="text-text-muted truncate">AM: {b.morning_shift} · PM: {b.afternoon_shift}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

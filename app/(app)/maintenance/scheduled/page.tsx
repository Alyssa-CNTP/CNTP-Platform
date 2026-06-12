'use client'

// app/(app)/maintenance/scheduled/page.tsx
// Scheduled maintenance — weekly / monthly checklists + annual / calibration.
// Lifted from the original Tab 1 and restyled with design tokens. Weekly /
// Monthly / Annual are segmented controls. Behaviour is unchanged.

import { useState } from 'react'
import { useMaintenanceContext } from '../layout'
import { calClass, calBadge, fmtD } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'
const SEG = (active: boolean) =>
  `px-3.5 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap ${active ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-dim'}`

export default function ScheduledPage() {
  const { loading, data, actions, ui, weekKey, moKey } = useMaintenanceContext()
  const { templates, annual } = data
  const { getComp, saveComp, toggleTask, setTaskField, saveAnnualNotes } = actions
  const { drafts, setDrafts, setPopup } = ui

  const [sub, setSub] = useState(0)
  const [openCL, setOpenCL] = useState<number | null>(null)

  const annualRows = annual.map(a => ({ ...a, days: (a.next_due ? Math.ceil((new Date(a.next_due).getTime() - Date.now()) / 86400000) : 0) })).sort((a, b) => a.days - b.days)

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading…</div></div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-semibold text-text mb-4">Scheduled Maintenance</h1>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {['Weekly', 'Monthly', 'Annual / Calibration'].map((t, i) => (
          <button key={t} className={SEG(sub === i)} onClick={() => setSub(i)}>{t}</button>
        ))}
      </div>

      {(sub === 0 || sub === 1) && (() => {
        const freq = sub === 0 ? 'weekly' : 'monthly'
        const period = freq === 'weekly' ? weekKey : moKey
        const list = templates.filter(t => t.frequency === freq)
        return (
          <div className="card p-4">
            <div className="text-sm font-semibold text-text mb-1">{freq === 'weekly' ? 'Weekly Checklists (WC) — ' + weekKey : 'Monthly Checklists (MC) — ' + moKey}</div>
            <div className="text-[12px] text-text-muted mb-3">
              {freq === 'weekly'
                ? 'Complete every week. Tap an area to expand the checklist. Progress is saved per week.'
                : 'Full inspections per area, per the QM-FM checklist. Tap to expand. Each task has a fault selector and action notes. Progress is saved per month.'}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {list.map(cl => {
                const st = getComp(cl.id, period)?.task_states ?? {}
                const doneN = cl.tasks.filter((_, i) => st[i]?.done).length
                const done = doneN === cl.tasks.length
                const isOpen = openCL === cl.id
                const borderClass = done ? 'border-ok/40' : doneN > 0 ? 'border-warn/40' : 'border-err/30'
                return (
                  <div key={cl.id} className={`card p-3 cursor-pointer border ${borderClass}`} onClick={() => setOpenCL(isOpen ? null : cl.id)}>
                    <div className="flex justify-between items-center">
                      <div><div className="text-[13px] font-semibold text-text">{cl.area}</div><div className="text-[11px] text-text-faint">{cl.doc_ref} • {cl.tasks.length} tasks</div></div>
                      <span className={`badge ${done ? 'badge-ok' : doneN > 0 ? 'badge-warn' : 'badge-err'}`}>{done ? 'DONE' : doneN > 0 ? doneN + '/' + cl.tasks.length : 'NOT STARTED'}</span>
                    </div>
                    {isOpen && (
                      <div className="mt-2.5 border-t border-surface-rule pt-2 max-h-[400px] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        {cl.tasks.map((task, ti) => {
                          const s = st[ti] ?? {}
                          return (
                            <div key={ti} className="mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className={`w-4 h-4 rounded border border-surface-rule flex-shrink-0 flex items-center justify-center text-[10px] text-white cursor-pointer ${s.done ? 'bg-ok' : 'bg-transparent'}`} onClick={() => toggleTask(cl, ti)}>
                                  {s.done && '✓'}
                                </div>
                                <span className={`text-[12px] ${s.done ? 'text-ok' : 'text-text'}`}>{task}</span>
                              </div>
                              <div className="flex gap-1 mt-0.5" style={{ marginLeft: 22 }}>
                                {freq === 'monthly' && (
                                  <select className={`${INP} w-20 text-[11px] py-1`} value={s.fault ? 'YES' : 'NO'} onChange={e => setTaskField(cl, ti, 'fault', e.target.value === 'YES')}>
                                    <option value="NO">No Fault</option><option value="YES">Fault</option>
                                  </select>
                                )}
                                <input className={`${INP} flex-1 text-[11px] py-1`} placeholder="Action needed / notes…"
                                  value={drafts['t' + cl.id + '-' + ti] ?? s.notes ?? ''}
                                  onChange={e => setDrafts(p => ({ ...p, ['t' + cl.id + '-' + ti]: e.target.value }))}
                                  onBlur={e => setTaskField(cl, ti, 'notes', e.target.value)} />
                              </div>
                            </div>
                          )
                        })}
                        <div className="mt-2"><label className={LB}>Comments</label>
                          <textarea className={`${INP} min-h-[36px]`}
                            value={drafts['c' + cl.id] ?? getComp(cl.id, period)?.comments ?? ''}
                            onChange={e => setDrafts(p => ({ ...p, ['c' + cl.id]: e.target.value }))}
                            onBlur={e => saveComp(cl, { comments: e.target.value })}
                            placeholder="General comments…" />
                        </div>
                        {!done && <button className="mt-1.5 bg-err text-white rounded-lg px-3 py-2 text-[12px] font-semibold" onClick={() => setPopup(cl.area + ': ' + (cl.tasks.length - doneN) + ' task(s) still outstanding! Please finish the remaining items.')}>Check missing items</button>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {sub === 2 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-text mb-1">Annual / Calibration / Verification</div>
          <div className="text-[12px] text-text-muted mb-3">Boiler: 180 days warning. Others: 60, 30, 7, 1 day alerts. Email supplier directly.</div>
          {annualRows.filter(a => a.days <= 60).map(a => (
            <div key={a.id} className="rounded-lg border border-surface-rule p-2.5 mb-1.5 flex items-center gap-2 text-[13px]">
              <div className="flex-1"><strong>{a.asset}</strong> — {a.days <= 0 ? 'OVERDUE by ' + Math.abs(a.days) + ' days' : 'Due in ' + a.days + ' days'}</div>
              <span className={`badge ${calClass(a.days)}`}>{calBadge(a.days)}</span>
            </div>
          ))}
          <div className="overflow-x-auto mt-3">
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
                  <td>{a.supplier !== 'Internal' && <button className="bg-info text-white rounded-md px-2.5 py-1 text-[11px] font-semibold" onClick={() => setPopup('Draft Email to ' + a.supplier + ':\n\nSubject: ' + a.category + ' Due — ' + a.asset + '\n\nDear ' + a.supplier + ',\n\nPlease schedule ' + a.category.toLowerCase() + ' for:\nAsset: ' + a.asset + '\nSerial: ' + a.serial_no + '\nDue: ' + fmtD(a.next_due) + '\n\nPlease confirm.\n\nRegards,\nCNTP Maintenance')}>Email</button>}</td>
                  <td><input className={`${INP} w-28 text-[11px] py-1`} placeholder="Notes…"
                    value={drafts['a' + a.id] ?? a.notes}
                    onChange={e => setDrafts(p => ({ ...p, ['a' + a.id]: e.target.value }))}
                    onBlur={e => saveAnnualNotes(a.id, e.target.value)} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

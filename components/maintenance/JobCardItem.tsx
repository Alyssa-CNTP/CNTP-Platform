'use client'

// components/maintenance/JobCardItem.tsx
// Per-card workflow renderer. On the board it renders COMPACT (a scannable
// summary + the next action) and expands its working panel on demand; on the
// detail page it renders fully expanded. All workflow logic is unchanged.

import { useEffect, useState } from 'react'
import { ChevronDown, ScanLine, ShoppingCart } from 'lucide-react'
import { useMaintenanceContext } from '@/app/(app)/maintenance/layout'
import { StatusBadge } from './StatusBadge'
import { Timer } from './Timer'
import { QC_CHECKS } from '@/lib/maintenance/constants'
import { fmtDT, fmtT, diffM, diffDays, normQc, priorityOf, PRIORITY_META } from '@/lib/maintenance/helpers'
import type { JobCard, QcAnswer } from '@/lib/maintenance/types'
import { INP } from '@/components/production/shared/ui'
import PartScanner from './PartScanner'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'
const PRIMARY = 'bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] hover:brightness-110 transition'
const TOG = (active: boolean) =>
  `px-3 py-2 min-h-[40px] rounded-lg text-[11px] font-semibold transition ${active ? 'bg-brand/10 text-brand border border-brand/25' : 'border border-surface-rule text-text-muted hover:border-text/25'}`
const PANEL = 'rounded-xl border border-surface-rule bg-surface-raised/60 p-3.5 mt-3'

export interface JobCardRoles {
  canManage: boolean
  isTech: boolean
  isQc: boolean
  isRaiser: boolean
}

export function JobCardItem({ j, roles, compact = true }: { j: JobCard; roles: JobCardRoles; compact?: boolean }) {
  const { ui, actions, derived, data, actor } = useMaintenanceContext()
  const { drafts, setDrafts, alloc, setAlloc, spForm, setSpForm } = ui
  const { cardLogs, cardSpares } = derived
  const { qcFor } = actions
  const staff = data.staff

  const [expanded, setExpanded] = useState(!compact)
  const [showDetail, setShowDetail] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [scanning, setScanning] = useState(false)
  // Compact "request a part not in stock" form (in-progress spares panel).
  const [requesting, setRequesting] = useState(false)
  const [reqDesc, setReqDesc] = useState('')
  const [reqQty, setReqQty] = useState('1')

  useEffect(() => {
    if (!roles.canManage || j.status !== 'raised' || !expanded) return
    if (alloc[j.id]?.tech !== undefined || alloc[j.id]?.external) return
    let cancelled = false
    fetch(`/api/maintenance/job-cards/${j.id}/assign`)
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        if (cancelled || !res?.suggested?.name) return
        setAlloc(p => (p[j.id]?.tech !== undefined ? p : { ...p, [j.id]: { ...p[j.id], tech: res.suggested.name, techId: res.suggested.userId ?? null } }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [j.id, j.status, roles.canManage, expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const isBd = j.workflow === 'breakdown'
  const prio = priorityOf(j)
  const prioMeta = PRIORITY_META[prio]
  const timerStart = isBd ? j.raised_at : j.accepted_at
  const showTimer = (j.status === 'in_progress') || (isBd && j.status === 'assigned')
  // Worked minutes net of any paused (breakdown-interruption) time.
  const netMin = Math.max(0, diffM(timerStart, j.completed_at) - Math.round((j.pause_ms ?? 0) / 60000))
  const lgs = cardLogs(j.id)
  const sps = cardSpares(j.id)
  const hasDetail = !!(j.long_desc || j.photo_url || j.ai_suggestion)

  const canManage = roles.canManage
  const isTech = roles.isTech || canManage
  const isQc = roles.isQc || canManage
  const isRaiser = roles.isRaiser || canManage

  // What does this card need next, for this user?
  const act: { label: string; primary: boolean } =
    j.status === 'raised' && canManage ? { label: 'Allocate', primary: true }
    : j.status === 'clarify' && isRaiser ? { label: 'Clarify & resubmit', primary: true }
    : j.status === 'assigned' && isTech ? { label: isBd ? 'Attend & accept' : 'Accept', primary: true }
    : j.status === 'in_progress' && isTech ? { label: 'Log work', primary: true }
    : j.status === 'qc_check' && isQc ? { label: 'QC check', primary: true }
    : j.status === 'verify' && isRaiser ? { label: 'Verify', primary: true }
    : { label: expanded ? 'Hide' : 'Open', primary: false }

  const ageDays = diffDays(j.raised_at, j.completed_at ?? j.verified_at ?? new Date().toISOString())
  const collapsedHint = [
    j.assigned_to ? `${j.external ? 'External' : 'Tech'}: ${j.assigned_to}` : (j.status === 'raised' ? 'Unassigned' : null),
    j.status !== 'complete' && ageDays > 0 ? `${ageDays}d open` : null,
    lgs.length ? `${lgs.length} update${lgs.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join('  ·  ')

  // High-priority / breakdown cards get a faint tint so they pop in a list.
  const tint = prio === 'high' ? 'bg-err/[0.03]' : 'bg-surface-card'

  return (
    <div className={`rounded-xl border border-surface-rule border-l-4 ${prioMeta.accent} ${tint} shadow-sm p-4 mb-3`}>
      {/* Header — card no · priority · type · status */}
      <div className="flex justify-between gap-2 flex-wrap items-start">
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="text-accent text-sm">{j.card_no}</strong>
          <span className={`badge ${prioMeta.badge}`}>{prioMeta.label}</span>
          <span className={`badge ${isBd ? 'badge-err' : 'badge-info'}`}>{isBd ? 'BREAKDOWN' : 'PLANNED'}</span>
          <StatusBadge status={j.status} />
          {j.external && <span className="badge badge-warn">EXT: {j.external_company}</span>}
          {(j.reopen_count ?? 0) > 0 && <span className="badge badge-err">REOPENED ×{j.reopen_count}</span>}
          {!j.qc_required && j.status !== 'raised' && <span className="badge badge-gray">NO QC</span>}
        </div>
        <span className="text-[11px] text-text-faint shrink-0">{fmtDT(j.raised_at)}</span>
      </div>

      {/* Meta line + title */}
      <div className="text-[13px] text-text-muted mt-1.5">
        <span className="font-medium text-text">{j.area}</span>{j.machine ? ' · ' + j.machine : ''}
        <span className="text-text-faint"> · </span>Raised by {j.raised_by}
      </div>
      <div className={`text-[13px] text-text mt-1 ${compact && !expanded ? 'line-clamp-1' : ''}`}>{j.description}</div>

      {/* Compact collapsed: hint + next action; click to expand the working panel */}
      {compact && !expanded ? (
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-faint truncate">{collapsedHint}</span>
          <button onClick={() => setExpanded(true)}
            className={act.primary
              ? 'bg-brand text-white rounded-lg px-3.5 py-2 text-[12px] font-semibold min-h-[38px] hover:brightness-110 transition shrink-0'
              : 'border border-surface-rule bg-surface-card text-text-muted rounded-lg px-3.5 py-2 text-[12px] font-semibold min-h-[38px] hover:border-text/30 transition shrink-0'}>
            {act.label} →
          </button>
        </div>
      ) : (
        <>
          {hasDetail && (
            <>
              <button onClick={() => setShowDetail(s => !s)}
                className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text mt-1.5 transition">
                <ChevronDown size={13} className={`transition-transform ${showDetail ? 'rotate-180' : ''}`} />
                {showDetail ? 'Hide detail' : 'More detail'}
              </button>
              {showDetail && (
                <div className="mt-1.5 space-y-1.5">
                  {j.long_desc && <div className="text-[12px] text-text-muted whitespace-pre-wrap">{j.long_desc}</div>}
                  {j.photo_url && <img src={j.photo_url} className="max-h-[120px] rounded-lg" alt="" />}
                  {j.ai_suggestion && (
                    <div className="rounded-lg border border-accent/20 bg-accent/5 p-2 text-[12px]">
                      <span className="text-accent font-semibold text-[10px] uppercase tracking-wide">AI · </span>
                      <span className="text-text">{j.ai_suggestion}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {showTimer && (
            <div className="mt-2.5">
              <div className="text-[10px] text-text-muted uppercase tracking-wide">Time elapsed {isBd ? '(since raised — breakdown)' : '(since accepted)'}</div>
              <Timer start={timerStart} pauseMs={j.pause_ms ?? 0} pausedAt={j.paused ? j.paused_at ?? null : null} />
            </div>
          )}

          {/* Auto-paused by a breakdown — resume once the breakdown is finalised */}
          {j.status === 'in_progress' && isTech && j.paused && (() => {
            const techBusy = data.jcs.some(x => x.id !== j.id && x.assigned_to === j.assigned_to && x.status === 'in_progress' && !x.paused)
            return (
              <div className="rounded-xl border border-warn/30 bg-warn/5 p-3.5 mt-3">
                <div className="text-[12px] font-semibold text-warn">Paused — {j.paused_reason || 'technician pulled to a breakdown'}</div>
                <div className="text-[11px] text-text-muted mt-0.5">The timer is frozen. {techBusy ? 'Finish the breakdown first, then continue this job.' : 'The breakdown is done — you can continue this job.'}</div>
                <button
                  disabled={techBusy}
                  className={`mt-2 rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] transition ${techBusy ? 'bg-surface-dim text-text-faint cursor-not-allowed' : 'bg-brand text-white hover:brightness-110'}`}
                  onClick={() => actions.resumeJob(j)}>
                  Continue previous job
                </button>
              </div>
            )
          })()}

          {/* raised → manager allocates / sends back for clarification */}
          {j.status === 'raised' && canManage && (
            <div className={PANEL}>
              <div className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-2">Allocate job card</div>
              {/* Quick-pick: technicians on duty right now (one tap to select internally) */}
              {derived.dutyNow.length > 0 && !alloc[j.id]?.external && (
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <span className="text-[11px] text-text-muted">On duty now:</span>
                  {derived.dutyNow.map((name: string) => {
                    const picked = alloc[j.id]?.tech === name
                    const s = staff.find(x => x.name === name)
                    return (
                      <button key={name}
                        className={`px-2.5 py-1 rounded-full text-[12px] font-semibold transition ${picked ? 'bg-brand text-white' : 'bg-ok/10 text-ok border border-ok/25 hover:bg-ok/20'}`}
                        onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], external: false, tech: name, techId: s?.id ?? null } }))}>
                        {name}{picked ? ' ✓' : ''}
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="flex gap-1.5 items-center flex-wrap">
                <button className={TOG(!(alloc[j.id]?.external))} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], external: false } }))}>INTERNAL</button>
                <button className={TOG(!!alloc[j.id]?.external)} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], external: true } }))}>EXTERNAL</button>
                {alloc[j.id]?.external
                  ? <input className={`${INP} w-44`} placeholder="External company…" value={alloc[j.id]?.company ?? ''} onChange={e => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], company: e.target.value } }))} />
                  : <select className={`${INP} w-auto`} value={alloc[j.id]?.tech ?? ''} onChange={e => { const s = staff.find(x => x.name === e.target.value); setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], tech: e.target.value, techId: s?.id ?? null } })) }}><option value="">Technician…</option>{staff.map(s => <option key={s.id ?? s.name} value={s.name}>{s.name}</option>)}</select>}
                <button className={TOG(alloc[j.id]?.qc ?? true)} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], qc: !(p[j.id]?.qc ?? true) } }))}>QC: {(alloc[j.id]?.qc ?? true) ? 'REQUIRED' : 'NOT REQUIRED'}</button>
                <button className={PRIMARY} onClick={() => actions.allocate(j)}>Forward</button>
              </div>
              <div className="text-[11px] text-text-faint mt-1.5">Production-related machines should be tested — keep QC required for those.</div>
              <div className="flex gap-1.5 mt-2.5 items-center">
                <input className={`${INP} flex-1`} placeholder="Not clear? Note what needs clarifying…" value={drafts['cl' + j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['cl' + j.id]: e.target.value }))} />
                <button className="border border-warn/40 text-warn bg-warn/5 rounded-lg px-3 py-2.5 min-h-[44px] text-[12px] font-semibold whitespace-nowrap hover:bg-warn/10 transition" onClick={() => actions.sendForClarify(j)}>Send back to raiser</button>
              </div>
            </div>
          )}

          {/* clarify → raiser updates and resubmits */}
          {j.status === 'clarify' && isRaiser && (
            <div className={PANEL}>
              <div className="text-[11px] font-semibold text-warn uppercase tracking-[0.07em] mb-2">Manager needs clarification — update &amp; resubmit</div>
              <label className={LB}>Short Description</label>
              <input className={INP} value={drafts['sd' + j.id] ?? j.description} onChange={e => setDrafts(p => ({ ...p, ['sd' + j.id]: e.target.value }))} />
              <label className={`${LB} mt-2`}>Detailed Description</label>
              <textarea className={`${INP} min-h-[50px]`} value={drafts['ld' + j.id] ?? j.long_desc} onChange={e => setDrafts(p => ({ ...p, ['ld' + j.id]: e.target.value }))} />
              <button className={`${PRIMARY} mt-2.5`} onClick={() => actions.resubmit(j)}>Resubmit job card</button>
            </div>
          )}

          {/* assigned → technician accepts (or manager records external start) */}
          {j.status === 'assigned' && isTech && (
            <div className={PANEL}>
              <div className="text-[12px] text-text-muted">{j.external ? 'External job with ' : 'Forwarded to '}<strong className="text-text">{j.assigned_to}</strong> at {fmtT(j.assigned_at)} — awaiting {j.external ? 'work start' : 'acceptance'}</div>
              <button className={`${PRIMARY} mt-2.5`} onClick={async () => {
                await actions.upJC(j.id, { status: 'in_progress', accepted_at: new Date().toISOString() })
                await actions.addLog(j.id, 'event', 'in_progress', j.assigned_to ?? actor, j.external ? 'External work started.' : 'Technician accepted the job card.')
              }}>{j.external ? 'Mark work started' : 'Accept job card'}</button>
              {!isBd && <div className="text-[11px] text-text-faint mt-1">Timer starts on accept</div>}
            </div>
          )}

          {/* in_progress → work details, tools, spares (hidden while paused) */}
          {j.status === 'in_progress' && isTech && !j.paused && (
            <div className="mt-3 space-y-2.5">
              <div>
                <label className={LB}>Work Done</label>
                <textarea className={`${INP} min-h-[40px]`} value={drafts['wd' + j.id] ?? j.work_done} onChange={e => setDrafts(p => ({ ...p, ['wd' + j.id]: e.target.value }))} onBlur={e => actions.upJC(j.id, { work_done: e.target.value })} placeholder="Work carried out…" />
              </div>
              <div>
                <label className={LB}>Root Cause</label>
                <textarea className={`${INP} min-h-[36px]`} value={drafts['rc' + j.id] ?? j.root_cause} onChange={e => setDrafts(p => ({ ...p, ['rc' + j.id]: e.target.value }))} onBlur={e => actions.upJC(j.id, { root_cause: e.target.value })} placeholder="Why did this fail?" />
              </div>
              <div>
                <label className={LB}>Tools Used{j.external ? ' (required for external jobs)' : ''}</label>
                <textarea className={`${INP} min-h-[36px]`} value={drafts['tl' + j.id] ?? j.tools_used} onChange={e => setDrafts(p => ({ ...p, ['tl' + j.id]: e.target.value }))} onBlur={e => actions.upJC(j.id, { tools_used: e.target.value })} placeholder="Tools / equipment used on this job…" />
              </div>

              <div className={PANEL}>
                <div className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-2">Spares / critical equipment used <span className="font-normal normal-case tracking-normal text-text-faint">— updates stock register</span></div>
                {sps.map(s => (
                  <div key={s.id} className="text-[12px] mb-1 flex gap-1.5 items-center">
                    <span className="text-ok">✓</span>
                    <span>{s.description} × {s.qty} ({s.from_stock})</span>
                    {s.is_critical && <span className="badge badge-err">CRITICAL</span>}
                  </div>
                ))}
                <div className="flex gap-1.5 flex-wrap items-center mt-1.5">
                  <select className={`${INP} w-[200px]`} value={spForm[j.id]?.partId ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], partId: e.target.value } }))}>
                    <option value="">From stock register…</option>
                    {data.stock.map(s => <option key={s.id} value={s.id}>{s.part_no} — {s.description} (new:{s.qty_new}/used:{s.qty_used})</option>)}
                  </select>
                  <button type="button" className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2 min-h-[40px] text-[11px] font-semibold hover:border-text/25 transition" onClick={() => setScanning(true)}>
                    <ScanLine size={13} /> Scan / identify
                  </button>
                  <button type="button" className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2 min-h-[40px] text-[11px] font-semibold hover:border-text/25 transition" onClick={() => setRequesting(v => !v)}>
                    <ShoppingCart size={13} /> Request part
                  </button>
                  <input className={`${INP} w-36`} placeholder="…or describe item" value={spForm[j.id]?.desc ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], desc: e.target.value } }))} />
                  <input className={`${INP} w-16`} type="number" min={1} placeholder="Qty" value={spForm[j.id]?.qty ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], qty: e.target.value } }))} />
                  <select className={`${INP} w-20`} value={spForm[j.id]?.from ?? 'new'} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], from: e.target.value } }))}><option value="new">New</option><option value="used">Used</option></select>
                  <button className={TOG(!!spForm[j.id]?.critical)} onClick={() => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], critical: !p[j.id]?.critical } }))}>CRITICAL</button>
                  <button className="border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2 min-h-[40px] text-[11px] font-semibold hover:border-text/25 transition" onClick={() => actions.logSpare(j)}>+ Log</button>
                </div>
                {scanning && (
                  <PartScanner
                    parts={data.stock}
                    onPick={p => setSpForm(prev => ({ ...prev, [j.id]: { ...prev[j.id], partId: String(p.id) } }))}
                    onClose={() => setScanning(false)}
                  />
                )}
                {/* Request a part that isn't in stock — raises a reorder request to the manager. */}
                {requesting && (
                  <div className="flex gap-1.5 flex-wrap items-center mt-2 rounded-lg border border-info/20 bg-info/5 p-2">
                    <input className={`${INP} flex-1 min-w-[160px]`} placeholder="Part / item needed…" value={reqDesc} onChange={e => setReqDesc(e.target.value)} />
                    <input className={`${INP} w-16`} type="number" min={1} placeholder="Qty" value={reqQty} onChange={e => setReqQty(e.target.value)} />
                    <button type="button" className={PRIMARY.replace('px-4 py-2.5 text-sm', 'px-3 py-2 text-[11px]').replace('min-h-[44px]', 'min-h-[40px]')}
                      onClick={async () => {
                        if (!reqDesc.trim()) return
                        const ok = await actions.createRequest({ card_id: j.id, description: reqDesc.trim(), qty: Math.max(1, parseInt(reqQty, 10) || 1), reason: 'job_card' })
                        if (ok) { setRequesting(false); setReqDesc(''); setReqQty('1') }
                      }}>
                      Send request
                    </button>
                  </div>
                )}
              </div>

              <button className={PRIMARY} onClick={() => actions.completeWork(j)}>
                {j.qc_required ? `Complete — send to QC${qcFor(j.area) ? ' (' + qcFor(j.area) + ')' : ''}` : 'Complete — send for verification'}
              </button>
            </div>
          )}

          {/* qc_check → YES/NO/N/A, any YES bounces back to tech */}
          {j.status === 'qc_check' && isQc && (
            <div className={PANEL}>
              <div className="text-[12px] font-semibold text-text mb-0.5">Quality post-maintenance check</div>
              <div className="text-[12px] text-text-muted mb-2.5">Station QC for {j.area}: <strong className="text-text">{qcFor(j.area) || 'not mapped — any QC on duty'}</strong></div>
              <div className="mb-2.5"><label className={LB}>QC Officer Name</label><input className={INP} value={drafts['qn' + j.id] ?? j.qc_name ?? qcFor(j.area)} onChange={e => setDrafts(p => ({ ...p, ['qn' + j.id]: e.target.value }))} placeholder="Enter your name…" /></div>
              {QC_CHECKS.map((q, i) => {
                const v = normQc((j.qc_checks ?? [])[i] ?? 'na')
                const setV = (nv: QcAnswer) => { const c = QC_CHECKS.map((_, k) => normQc((j.qc_checks ?? [])[k] ?? 'na')); c[i] = nv; actions.upJC(j.id, { qc_checks: c }) }
                return (
                  <div key={i} className="flex items-center gap-1.5 mb-1.5">
                    <button className={`w-11 py-2 min-h-[40px] rounded-lg text-[11px] font-semibold transition ${v === 'yes' ? 'bg-err/10 text-err border border-err/30' : 'border border-surface-rule text-text-muted hover:border-text/25'}`} onClick={() => setV('yes')}>YES</button>
                    <button className={`w-11 py-2 min-h-[40px] rounded-lg text-[11px] font-semibold transition ${v === 'no' ? 'bg-ok/10 text-ok border border-ok/30' : 'border border-surface-rule text-text-muted hover:border-text/25'}`} onClick={() => setV('no')}>NO</button>
                    <button className={`w-11 py-2 min-h-[40px] rounded-lg text-[11px] font-semibold transition ${v === 'na' ? 'bg-surface-dim text-text border border-surface-rule' : 'border border-surface-rule text-text-muted hover:border-text/25'}`} onClick={() => setV('na')}>N/A</button>
                    <span className="text-[12px]">{q}</span>
                  </div>
                )
              })}
              {QC_CHECKS.some((_, i) => normQc((j.qc_checks ?? [])[i]) === 'yes') && (
                <div className="mt-2">
                  <label className={`${LB} text-err`}>QC Comment (required — card will return to the technician)</label>
                  <textarea className={`${INP} min-h-[36px] border-err`} value={drafts['qf' + j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['qf' + j.id]: e.target.value }))} placeholder="Describe what failed the check…" />
                </div>
              )}
              <button className={`${PRIMARY} mt-2.5`} onClick={() => actions.qcSubmit(j)}>Submit QC check</button>
            </div>
          )}

          {/* verify → originator signs off */}
          {j.status === 'verify' && isRaiser && (
            <div className={PANEL}>
              <div className="text-[12px] font-semibold text-text mb-2">Verification by originator ({j.raised_by})</div>
              <div className="text-[12px] text-text-muted mb-0.5"><span className="text-text font-medium">Work:</span> {j.work_done || '—'}</div>
              <div className="text-[12px] text-text-muted mb-0.5"><span className="text-text font-medium">Root Cause:</span> {j.root_cause || '—'}</div>
              {j.tools_used && <div className="text-[12px] text-text-muted mb-0.5"><span className="text-text font-medium">Tools:</span> {j.tools_used}</div>}
              <div className="text-[12px] text-text-muted mb-0.5"><span className="text-text font-medium">Duration:</span> {netMin} min</div>
              {j.qc_required && <div className="text-[12px] text-text-muted mb-2"><span className="text-text font-medium">QC by:</span> {j.qc_name} at {fmtT(j.qc_done_at)}</div>}
              <div className="flex gap-2 flex-wrap mt-1">
                <button className={PRIMARY} onClick={() => actions.verifyCard(j, true)}>Satisfactory — close</button>
                <button className="border border-err/40 text-err bg-err/5 rounded-lg px-4 py-2.5 min-h-[44px] text-sm font-semibold hover:bg-err/10 transition" onClick={() => actions.verifyCard(j, false)}>Not satisfactory — return to tech</button>
              </div>
            </div>
          )}

          {j.status === 'complete' && (
            <div className="mt-2.5 text-[12px] text-text-muted flex gap-x-3 gap-y-1 flex-wrap">
              <span><span className="text-text font-medium">{j.external ? 'External' : 'Tech'}:</span> {j.assigned_to ?? '—'}</span>
              <span><span className="text-text font-medium">Duration:</span> {netMin} min</span>
              {j.qc_required && <span><span className="text-text font-medium">QC:</span> {j.qc_name || '—'} {fmtT(j.qc_done_at)}</span>}
              <span><span className="text-text font-medium">Verified:</span> {j.verified_ok ? <span className="text-ok">OK</span> : <span className="text-err">Redo</span>}</span>
              {j.root_cause && <span><span className="text-text font-medium">Root Cause:</span> {j.root_cause}</span>}
            </div>
          )}

          {/* Comments at every step + collapsible full log */}
          <div className="mt-3 border-t border-surface-rule pt-3">
            <div className="flex gap-1.5 items-center">
              <input className={`${INP} flex-1`} placeholder={`Comment as ${actor || '…'} (stage: ${j.status.replace(/_/g, ' ')})`} value={drafts['cm' + j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['cm' + j.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') actions.postComment(j) }} />
              <button className="border border-surface-rule bg-surface-card text-text rounded-lg px-3 py-2.5 min-h-[44px] text-[12px] font-semibold hover:border-text/25 transition" onClick={() => actions.postComment(j)}>Post</button>
            </div>
            {lgs.length > 0 && (
              <>
                <button onClick={() => setShowLog(s => !s)}
                  className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text mt-2 transition">
                  <ChevronDown size={13} className={`transition-transform ${showLog ? 'rotate-180' : ''}`} />
                  {showLog ? 'Hide activity' : `Activity (${lgs.length})`}
                </button>
                {showLog && (
                  <div className="mt-1.5 max-h-[220px] overflow-y-auto">
                    {lgs.map(l => (
                      <div key={l.id} className={`text-[11px] px-2 py-1 border-l-2 mb-1 bg-surface-raised rounded-r ${l.kind === 'comment' ? 'border-accent' : 'border-surface-rule'}`}>
                        <span className="text-text-faint">{fmtDT(l.created_at)}</span>{' '}
                        <span className={`badge ${l.kind === 'comment' ? 'badge-ok' : 'badge-gray'}`}>{l.kind === 'comment' ? 'COMMENT' : 'EVENT'}</span>{' '}
                        <span className="text-text-muted">[{l.stage.replace(/_/g, ' ')}]</span>{' '}
                        <strong className="text-text">{l.author}</strong>: <span className="text-text-muted">{l.body}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {compact && (
            <button onClick={() => setExpanded(false)} className="mt-2 text-[11px] text-text-faint hover:text-text-muted transition">Collapse</button>
          )}
        </>
      )}
    </div>
  )
}

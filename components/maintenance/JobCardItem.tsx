'use client'

// components/maintenance/JobCardItem.tsx
// Per-card workflow renderer — reskinned with design tokens. Behaviour and the
// full transition logic are preserved verbatim from the original renderCard;
// role gating now comes from the real deriveMaintRole flags rather than the mock
// view switcher.

import { useMaintenanceContext } from '@/app/(app)/maintenance/layout'
import { StatusBadge } from './StatusBadge'
import { Timer } from './Timer'
import { QC_CHECKS, TECHS } from '@/lib/maintenance/constants'
import { fmtDT, fmtT, diffM, normQc } from '@/lib/maintenance/helpers'
import type { JobCard, QcAnswer } from '@/lib/maintenance/types'
import { INP } from '@/components/production/shared/ui'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'
const PRIMARY = 'bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-semibold'

export interface JobCardRoles {
  canManage: boolean
  isTech: boolean
  isQc: boolean
  isRaiser: boolean
}

export function JobCardItem({ j, roles }: { j: JobCard; roles: JobCardRoles }) {
  const { ui, actions, derived, data, actor } = useMaintenanceContext()
  const { drafts, setDrafts, alloc, setAlloc, spForm, setSpForm } = ui
  const { cardLogs, cardSpares } = derived
  const { qcFor } = actions

  const isBd = j.workflow === 'breakdown'
  const timerStart = isBd ? j.raised_at : j.accepted_at
  const showTimer = (j.status === 'in_progress') || (isBd && j.status === 'assigned')
  const lgs = cardLogs(j.id)
  const sps = cardSpares(j.id)

  // The original allowed a manager to also act as tech/qc/raiser.
  const canManage = roles.canManage
  const isTech = roles.isTech || canManage
  const isQc = roles.isQc || canManage
  const isRaiser = roles.isRaiser || canManage

  return (
    <div className={`card p-4 mb-3.5 border-l-[3px] ${isBd ? 'border-l-err' : 'border-l-accent'}`}>
      <div className="flex justify-between mb-1.5 flex-wrap gap-1 items-start">
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="text-accent text-sm">{j.card_no}</strong>
          <span className={`badge ${isBd ? 'badge-err' : 'badge-info'}`}>{isBd ? 'BREAKDOWN' : 'PLANNED'}</span>
          <StatusBadge status={j.status} />
          {j.external && <span className="badge badge-warn">EXTERNAL: {j.external_company}</span>}
          {(j.reopen_count ?? 0) > 0 && <span className="badge badge-err">REOPENED ×{j.reopen_count}</span>}
          {!j.qc_required && j.status !== 'raised' && <span className="badge badge-gray">NO QC</span>}
          {j.maint_types?.filter(t => t !== 'Breakdown').map(t => <span key={t} className="badge badge-gray">{t}</span>)}
        </div>
        <span className="text-[11px] text-text-faint">{fmtDT(j.raised_at)}</span>
      </div>

      <div className="text-[13px] mb-1 text-text"><strong>{j.area}</strong>{j.machine ? ' → ' + j.machine : ''} • Raised by <strong>{j.raised_by}</strong>{j.assigned_to ? <> • {j.external ? 'External' : 'Tech'}: <strong>{j.assigned_to}</strong></> : null}</div>
      <div className="text-[12px] text-text mb-0.5">{j.description}</div>
      {j.long_desc && <div className="text-[12px] text-text-muted mb-1.5 whitespace-pre-wrap">{j.long_desc}</div>}
      {j.photo_url && <img src={j.photo_url} className="max-h-[120px] rounded mb-1.5" alt="" />}
      {j.ai_suggestion && (
        <div className="bg-accent/10 border border-accent/20 rounded-lg p-1.5 mb-1.5 text-[12px]">
          <span className="text-accent font-semibold text-[10px] uppercase">AI: </span>
          <span className="text-text">{j.ai_suggestion}</span>
        </div>
      )}

      {showTimer && (
        <div className="mb-1.5">
          <div className="text-[10px] text-text-muted uppercase tracking-wide">Time elapsed {isBd ? '(since raised — breakdown)' : '(since accepted)'}</div>
          <Timer start={timerStart} />
        </div>
      )}

      {/* raised → manager allocates / sends back for clarification */}
      {j.status === 'raised' && canManage && (
        <div className="bg-warn/10 border border-warn/20 rounded-lg p-2.5 mt-1.5">
          <div className="text-[11px] font-semibold text-warn uppercase tracking-wide mb-1.5">Allocate Job Card</div>
          <div className="flex gap-1.5 items-center flex-wrap">
            <button className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold ${!(alloc[j.id]?.external) ? 'bg-accent text-white' : 'bg-surface-dim text-text-muted'}`} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], external: false } }))}>INTERNAL</button>
            <button className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold ${alloc[j.id]?.external ? 'bg-warn text-white' : 'bg-surface-dim text-text-muted'}`} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], external: true } }))}>EXTERNAL</button>
            {alloc[j.id]?.external
              ? <input className={`${INP} w-44`} placeholder="External company…" value={alloc[j.id]?.company ?? ''} onChange={e => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], company: e.target.value } }))} />
              : <select className={`${INP} w-auto`} value={alloc[j.id]?.tech ?? ''} onChange={e => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], tech: e.target.value } }))}><option value="">Technician…</option>{TECHS.map(t => <option key={t}>{t}</option>)}</select>}
            <button className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold ${(alloc[j.id]?.qc ?? true) ? 'bg-info text-white' : 'bg-surface-dim text-text-muted'}`} onClick={() => setAlloc(p => ({ ...p, [j.id]: { ...p[j.id], qc: !(p[j.id]?.qc ?? true) } }))}>QC CHECK: {(alloc[j.id]?.qc ?? true) ? 'REQUIRED' : 'NOT REQUIRED'}</button>
            <button className="bg-info text-white rounded-lg px-4 py-2 text-sm font-semibold" onClick={() => actions.allocate(j)}>FORWARD</button>
          </div>
          <div className="text-[11px] text-text-faint mt-1">Production-related machines should be tested — keep QC required for those.</div>
          <div className="flex gap-1.5 mt-2 items-center">
            <input className={`${INP} flex-1`} placeholder="Not clear? Note what needs clarifying…" value={drafts['cl' + j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['cl' + j.id]: e.target.value }))} />
            <button className="bg-warn text-white rounded-lg px-3 py-2 text-[12px] font-semibold whitespace-nowrap" onClick={() => actions.sendForClarify(j)}>SEND BACK TO RAISER</button>
          </div>
        </div>
      )}

      {/* clarify → raiser updates and resubmits */}
      {j.status === 'clarify' && isRaiser && (
        <div className="bg-warn/10 border border-warn/20 rounded-lg p-2.5 mt-1.5">
          <div className="text-[11px] font-semibold text-warn uppercase tracking-wide mb-1">Manager needs clarification — update & resubmit</div>
          <label className={LB}>Short Description</label>
          <input className={INP} value={drafts['sd' + j.id] ?? j.description} onChange={e => setDrafts(p => ({ ...p, ['sd' + j.id]: e.target.value }))} />
          <label className={`${LB} mt-1`}>Detailed Description</label>
          <textarea className={`${INP} min-h-[50px]`} value={drafts['ld' + j.id] ?? j.long_desc} onChange={e => setDrafts(p => ({ ...p, ['ld' + j.id]: e.target.value }))} />
          <button className={`${PRIMARY} mt-1.5`} onClick={() => actions.resubmit(j)}>RESUBMIT JOB CARD</button>
        </div>
      )}

      {/* assigned → technician accepts (or manager records external start) */}
      {j.status === 'assigned' && isTech && (
        <div className="bg-info/10 border border-info/20 rounded-lg p-2.5 mt-1.5">
          <div className="text-[12px] text-text-muted">{j.external ? 'External job with ' : 'Forwarded to '}<strong className="text-text">{j.assigned_to}</strong> at {fmtT(j.assigned_at)} — awaiting {j.external ? 'work start' : 'acceptance'}</div>
          <button className="mt-1.5 bg-ok text-white rounded-lg px-4 py-2.5 text-sm font-semibold" onClick={async () => {
            await actions.upJC(j.id, { status: 'in_progress', accepted_at: new Date().toISOString() })
            await actions.addLog(j.id, 'event', 'in_progress', j.assigned_to ?? actor, j.external ? 'External work started.' : 'Technician accepted the job card.')
          }}>{j.external ? 'MARK WORK STARTED' : 'ACCEPT JOB CARD'}</button>
          {!isBd && <div className="text-[11px] text-text-faint mt-0.5">Timer starts on accept</div>}
        </div>
      )}

      {/* in_progress → work details, tools, spares */}
      {j.status === 'in_progress' && isTech && (
        <div className="mt-1.5">
          <label className={LB}>Work Done</label>
          <textarea className={`${INP} min-h-[40px]`} value={drafts['wd' + j.id] ?? j.work_done} onChange={e => setDrafts(p => ({ ...p, ['wd' + j.id]: e.target.value }))} onBlur={e => actions.upJC(j.id, { work_done: e.target.value })} placeholder="Work carried out…" />
          <label className={`${LB} mt-1`}>Root Cause</label>
          <textarea className={`${INP} min-h-[36px]`} value={drafts['rc' + j.id] ?? j.root_cause} onChange={e => setDrafts(p => ({ ...p, ['rc' + j.id]: e.target.value }))} onBlur={e => actions.upJC(j.id, { root_cause: e.target.value })} placeholder="Why did this fail?" />
          <label className={`${LB} mt-1`}>Tools Used{j.external ? ' (required for external jobs)' : ''}</label>
          <textarea className={`${INP} min-h-[36px]`} value={drafts['tl' + j.id] ?? j.tools_used} onChange={e => setDrafts(p => ({ ...p, ['tl' + j.id]: e.target.value }))} onBlur={e => actions.upJC(j.id, { tools_used: e.target.value })} placeholder="Tools / equipment used on this job…" />

          <div className="bg-surface-raised border border-surface-rule rounded-lg p-2.5 mt-2">
            <div className="text-[11px] font-semibold text-accent uppercase tracking-wide mb-1.5">Spares / Critical Equipment Used (updates stock register)</div>
            {sps.map(s => (
              <div key={s.id} className="text-[12px] mb-1 flex gap-1.5 items-center">
                <span className="text-ok">✓</span>
                <span>{s.description} × {s.qty} ({s.from_stock})</span>
                {s.is_critical && <span className="badge badge-err">CRITICAL</span>}
              </div>
            ))}
            <div className="flex gap-1.5 flex-wrap items-center mt-1">
              <select className={`${INP} w-[200px]`} value={spForm[j.id]?.partId ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], partId: e.target.value } }))}>
                <option value="">From stock register…</option>
                {data.stock.map(s => <option key={s.id} value={s.id}>{s.part_no} — {s.description} (new:{s.qty_new}/used:{s.qty_used})</option>)}
              </select>
              <input className={`${INP} w-36`} placeholder="…or describe item" value={spForm[j.id]?.desc ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], desc: e.target.value } }))} />
              <input className={`${INP} w-16`} type="number" min={1} placeholder="Qty" value={spForm[j.id]?.qty ?? ''} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], qty: e.target.value } }))} />
              <select className={`${INP} w-20`} value={spForm[j.id]?.from ?? 'new'} onChange={e => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], from: e.target.value } }))}><option value="new">New</option><option value="used">Used</option></select>
              <button className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold ${spForm[j.id]?.critical ? 'bg-err text-white' : 'bg-surface-dim text-text-muted'}`} onClick={() => setSpForm(p => ({ ...p, [j.id]: { ...p[j.id], critical: !p[j.id]?.critical } }))}>CRITICAL</button>
              <button className="bg-ok text-white rounded-md px-3 py-1.5 text-[11px] font-semibold" onClick={() => actions.logSpare(j)}>+ LOG</button>
            </div>
          </div>

          <button className="mt-2 bg-ok text-white rounded-lg px-4 py-2.5 text-sm font-semibold" onClick={() => actions.completeWork(j)}>
            {j.qc_required ? `COMPLETE — SEND TO QC${qcFor(j.area) ? ' (' + qcFor(j.area) + ')' : ''}` : 'COMPLETE — SEND FOR VERIFICATION'}
          </button>
        </div>
      )}

      {/* qc_check → YES/NO/N/A, any YES bounces back to tech */}
      {j.status === 'qc_check' && isQc && (
        <div className="mt-1.5">
          <div className="text-[12px] text-info font-semibold mb-0.5">Quality Post-Maintenance Check</div>
          <div className="text-[12px] text-text-muted mb-1.5">Station QC for {j.area}: <strong className="text-text">{qcFor(j.area) || 'not mapped — any QC on duty'}</strong></div>
          <div className="mb-1.5"><label className={LB}>QC Officer Name</label><input className={INP} value={drafts['qn' + j.id] ?? j.qc_name ?? qcFor(j.area)} onChange={e => setDrafts(p => ({ ...p, ['qn' + j.id]: e.target.value }))} placeholder="Enter your name…" /></div>
          {QC_CHECKS.map((q, i) => {
            const v = normQc((j.qc_checks ?? [])[i] ?? 'na')
            const setV = (nv: QcAnswer) => { const c = QC_CHECKS.map((_, k) => normQc((j.qc_checks ?? [])[k] ?? 'na')); c[i] = nv; actions.upJC(j.id, { qc_checks: c }) }
            return (
              <div key={i} className="flex items-center gap-1.5 mb-1">
                <button className={`w-10 py-1.5 rounded-md text-[11px] font-semibold ${v === 'yes' ? 'bg-err text-white' : 'bg-surface-dim text-text-muted'}`} onClick={() => setV('yes')}>YES</button>
                <button className={`w-10 py-1.5 rounded-md text-[11px] font-semibold ${v === 'no' ? 'bg-ok text-white' : 'bg-surface-dim text-text-muted'}`} onClick={() => setV('no')}>NO</button>
                <button className={`w-10 py-1.5 rounded-md text-[11px] font-semibold ${v === 'na' ? 'bg-surface-rule text-text' : 'bg-surface-dim text-text-muted'}`} onClick={() => setV('na')}>N/A</button>
                <span className="text-[12px]">{q}</span>
              </div>
            )
          })}
          {QC_CHECKS.some((_, i) => normQc((j.qc_checks ?? [])[i]) === 'yes') && (
            <div className="mt-1.5">
              <label className={`${LB} text-err`}>QC Comment (required — card will return to the technician)</label>
              <textarea className={`${INP} min-h-[36px] border-err`} value={drafts['qf' + j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['qf' + j.id]: e.target.value }))} placeholder="Describe what failed the check…" />
            </div>
          )}
          <button className="mt-1.5 bg-info text-white rounded-lg px-4 py-2.5 text-sm font-semibold" onClick={() => actions.qcSubmit(j)}>SUBMIT QC CHECK</button>
        </div>
      )}

      {/* verify → originator signs off */}
      {j.status === 'verify' && isRaiser && (
        <div className="mt-1.5">
          <div className="text-[12px] text-info font-semibold mb-1.5">Verification by originator ({j.raised_by})</div>
          <div className="text-[12px] mb-0.5"><strong>Work:</strong> {j.work_done || '—'}</div>
          <div className="text-[12px] mb-0.5"><strong>Root Cause:</strong> {j.root_cause || '—'}</div>
          {j.tools_used && <div className="text-[12px] mb-0.5"><strong>Tools:</strong> {j.tools_used}</div>}
          <div className="text-[12px] mb-0.5"><strong>Duration:</strong> {diffM(isBd ? j.raised_at : j.accepted_at, j.completed_at)} min</div>
          {j.qc_required && <div className="text-[12px] mb-1.5"><strong>QC by:</strong> {j.qc_name} at {fmtT(j.qc_done_at)}</div>}
          <div className="flex gap-1.5">
            <button className="bg-ok text-white rounded-lg px-4 py-2.5 text-sm font-semibold" onClick={() => actions.verifyCard(j, true)}>SATISFACTORY — CLOSE</button>
            <button className="bg-err text-white rounded-lg px-4 py-2.5 text-sm font-semibold" onClick={() => actions.verifyCard(j, false)}>NOT SATISFACTORY — RETURN TO TECH</button>
          </div>
        </div>
      )}

      {j.status === 'complete' && (
        <div className="mt-1.5 text-[12px] flex gap-2.5 flex-wrap">
          <span><strong>{j.external ? 'External' : 'Tech'}:</strong> {j.assigned_to ?? '—'}</span>
          <span><strong>Duration:</strong> {diffM(isBd ? j.raised_at : j.accepted_at, j.completed_at)} min</span>
          {j.qc_required && <span><strong>QC:</strong> {j.qc_name || '—'} {fmtT(j.qc_done_at)}</span>}
          <span><strong>Verified:</strong> {j.verified_ok ? <span className="text-ok">OK</span> : <span className="text-err">Redo</span>}</span>
          {j.root_cause && <span><strong>Root Cause:</strong> {j.root_cause}</span>}
        </div>
      )}

      {/* Comments at every step + full log */}
      <div className="mt-2 border-t border-surface-rule pt-1.5">
        <div className="flex gap-1.5 items-center">
          <input className={`${INP} flex-1`} placeholder={`Comment as ${actor || '…'} (stage: ${j.status.replace(/_/g, ' ')})`} value={drafts['cm' + j.id] ?? ''} onChange={e => setDrafts(p => ({ ...p, ['cm' + j.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') actions.postComment(j) }} />
          <button className="bg-accent text-white rounded-md px-3 py-1.5 text-[12px] font-semibold" onClick={() => actions.postComment(j)}>POST</button>
        </div>
        {lgs.length > 0 && (
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
      </div>
    </div>
  )
}

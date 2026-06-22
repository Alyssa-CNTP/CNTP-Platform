'use client'

// components/maintenance/RaiseJobCardForm.tsx
// The "Raise Job Card" form, reskinned with design tokens. Workflow logic is
// preserved — it drives the shared `nj` form state + createJC() from the
// maintenance data context.

import { useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useMaintenanceContext } from '@/app/(app)/maintenance/layout'
import { useAuth } from '@/lib/auth/context'
import { AREAS, PLANNED_TYPES } from '@/lib/maintenance/constants'
import { aiSuggest, downscalePhoto } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'
import { VoiceCapture } from './VoiceCapture'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'

export function RaiseJobCardForm({ onDone, initialWorkflow }: { onDone?: () => void; initialWorkflow?: 'breakdown' | 'planned' }) {
  const { ui, actions, derived, data } = useMaintenanceContext()
  const auth = useAuth()
  const { isProduction, p } = auth
  const { nj, setNj, saving, setPopup } = ui
  const { duty } = derived
  const fRef = useRef<HTMLInputElement>(null)
  const canRaiseBreakdown = isProduction || p('can_raise_breakdown')
  const isBd = nj.workflow === 'breakdown'

  // The raiser is the signed-in user. If their account carries a real name we use
  // it (no typing, cleaner data); accounts that only have an email must enter a
  // name + surname so the card can be traced to a person.
  const accountName = (auth.fullName
    || (auth.user?.user_metadata?.full_name as string)
    || (auth.user?.user_metadata?.display_name as string)
    || '').trim()
  const hasAccountName = accountName.length > 0
  const looksLikeFullName = (s: string) => s.trim().split(/\s+/).filter(w => w.length >= 2).length >= 2

  // Bind the raiser to the signed-in account: prefill from the account name, or
  // (for email-only accounts) leave it for them to type once.
  useEffect(() => {
    if (hasAccountName) setNj(prev => (prev.raisedBy === accountName ? prev : { ...prev, raisedBy: accountName }))
  }, [hasAccountName, accountName]) // eslint-disable-line react-hooks/exhaustive-deps

  // Machine catalogue — the selected area's machines first, then the rest.
  const machineOptions = (() => {
    const all = data.machines.map(m => m.name)
    if (!nj.area) return all
    const forArea = data.machines.filter(m => m.area === nj.area).map(m => m.name)
    return Array.from(new Set([...forArea, ...all]))
  })()

  // Open straight into the requested mode (Report Breakdown vs New Job Card).
  useEffect(() => {
    if (initialWorkflow) {
      const wf = initialWorkflow === 'breakdown' && !canRaiseBreakdown ? 'planned' : initialWorkflow
      setNj(prev => ({ ...prev, workflow: wf, type: [] }))
    }
  }, [initialWorkflow]) // eslint-disable-line react-hooks/exhaustive-deps

  // If the user can't raise breakdowns, never leave the form on the breakdown tab.
  useEffect(() => {
    if (!canRaiseBreakdown && nj.workflow === 'breakdown') setNj(prev => ({ ...prev, workflow: 'planned', type: [] }))
  }, [canRaiseBreakdown, nj.workflow, setNj])

  async function submit() {
    // Smart job card — make sure everything needed is captured.
    if (!hasAccountName && !looksLikeFullName(nj.raisedBy)) {
      setPopup('Please enter your name and surname — your account has no name on file, so we need it to know who raised this job card.')
      return
    }
    if (!nj.area) { setPopup('Please choose the area / location.'); return }
    if (!nj.machine?.trim()) { setPopup('Please pick or type the machine / equipment.'); return }
    if (!nj.desc?.trim()) { setPopup('Please give a short description of the problem (or record a voice note).'); return }
    if (!isBd && nj.type.length === 0) { setPopup('Please select at least one maintenance type.'); return }
    // Save a newly-typed machine to the catalogue so it's in the dropdown next time.
    const m = nj.machine?.trim()
    if (m && !data.machines.some(x => x.name.toLowerCase() === m.toLowerCase())) {
      const saved = await actions.addMachine(m, nj.area)
      if (saved && saved !== m) setNj(p => ({ ...p, machine: saved }))
    }
    await actions.createJC()
    onDone?.()
  }

  return (
    <div className={`card p-4 ${isBd ? 'border-err/40' : ''}`}>
      {/* The breakdown-vs-planned choice is made BEFORE this form opens (the
          Report Breakdown / New Job Card buttons) — shown here as a fixed mode,
          not a second selector. */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-semibold text-text">Raise Job Card</div>
        <div className="flex items-center gap-2">
          <span className={`badge ${isBd ? 'badge-err' : 'badge-info'}`}>{isBd ? 'BREAKDOWN — URGENT' : 'SCHEDULED / PLANNED'}</span>
          {onDone && (
            <button onClick={onDone} aria-label="Close" title="Close"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:bg-surface-dim hover:text-text transition">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {initialWorkflow === 'breakdown' && !canRaiseBreakdown && (
        <div className="rounded-lg bg-surface-dim border border-surface-rule p-2.5 mb-3 text-[12px] text-text-muted">
          Breakdowns can only be raised by Production — contact the maintenance manager. This will be raised as a scheduled / planned job card instead.
        </div>
      )}

      {isBd && (
        <div className="rounded-lg bg-err/10 border border-err/20 p-2.5 mb-3 text-[12px] text-err">
          Breakdown goes <strong>directly to the technician on duty</strong> ({duty ?? 'none on roster — manager will allocate'}) — the maintenance manager is informed. The job timer starts as soon as the card is raised.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label className={LB}>Raised By</label>
          {hasAccountName ? (
            <div className={`${INP} flex items-center justify-between cursor-default bg-surface-dim`} title="Linked to your account">
              <span className="text-text font-medium">{accountName}</span>
              <span className="text-[10px] text-text-faint uppercase tracking-wide">your account</span>
            </div>
          ) : (
            <>
              <input className={INP} value={nj.raisedBy} onChange={e => setNj(p => ({ ...p, raisedBy: e.target.value }))} placeholder="Name & surname (required)…" />
              <div className="text-[10px] text-warn mt-1">Your account has no name on file — enter your name &amp; surname.</div>
            </>
          )}
        </div>
        <div><label className={LB}>Area / Location</label>
          <select className={INP} value={nj.area} onChange={e => setNj(p => ({ ...p, area: e.target.value }))}>
            <option value="">Select area…</option>{AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div><label className={LB}>Machine / Equipment</label>
          <input className={INP} list="maint-machines" value={nj.machine} onChange={e => setNj(p => ({ ...p, machine: e.target.value }))} placeholder="Pick from list or type a new one…" />
          <datalist id="maint-machines">{machineOptions.map(m => <option key={m} value={m} />)}</datalist>
          <div className="text-[10px] text-text-faint mt-1">Not in the list? Type it — it will be saved to the catalogue.</div>
        </div>
      </div>

      {!isBd && (
        <div className="mt-3">
          <label className={LB}>Maintenance Type (select all that apply)</label>
          <div className="flex flex-wrap gap-1.5">
            {PLANNED_TYPES.map(t => (
              <button key={t}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${nj.type.includes(t) ? 'bg-accent text-white' : 'bg-surface-dim text-text-muted hover:bg-surface-rule'}`}
                onClick={() => setNj(p => ({ ...p, type: p.type.includes(t) ? p.type.filter(x => x !== t) : [...p.type, t] }))}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
        <label className={LB} style={{ marginBottom: 0 }}>Describe the problem</label>
        <VoiceCapture mode="jobcard" onResult={r => setNj(p => ({
          ...p,
          desc: r.short_description?.trim() || p.desc,
          longDesc: r.long_description?.trim() || p.longDesc,
          type: (!isBd && r.maint_types && r.maint_types.length) ? Array.from(new Set([...p.type, ...r.maint_types])) : p.type,
          aiSug: aiSuggest((r.short_description || '') + ' ' + (r.long_description || '')),
        }))} />
      </div>
      <div className="mt-1"><label className={LB}>Short Description of the Problem</label>
        <input className={INP} value={nj.desc} onChange={e => setNj(p => ({ ...p, desc: e.target.value, aiSug: aiSuggest(e.target.value + ' ' + p.longDesc) }))} placeholder="One line — what is wrong? (or use the voice note)" />
      </div>
      <div className="mt-3"><label className={LB}>Detailed Description (optional)</label>
        <textarea className={`${INP} min-h-[60px]`} value={nj.longDesc} onChange={e => setNj(p => ({ ...p, longDesc: e.target.value, aiSug: aiSuggest(p.desc + ' ' + e.target.value) }))} placeholder="Anything else the technician should know…" />
      </div>

      <div className="flex gap-3 mt-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className={LB}>Photo</label>
          <input ref={fRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => {
            const f = e.target.files?.[0]; if (!f) return
            try { const url = await downscalePhoto(f); setNj(p => ({ ...p, photo: url, aiSug: aiSuggest(f.name + ' ' + p.desc) })) }
            catch { setPopup('Could not read photo') }
          }} />
          <div className="w-full min-h-[44px] bg-surface-dim border-2 border-dashed border-surface-rule rounded-lg flex items-center justify-center cursor-pointer text-text-muted text-[12px]" onClick={() => fRef.current?.click()}>
            {nj.photo ? <img src={nj.photo} className="max-w-full max-h-[90px] rounded" alt="" /> : 'Tap to upload photo'}
          </div>
        </div>
        {nj.aiSug && (
          <div className="flex-[2] min-w-[220px] bg-accent/10 border border-accent/30 rounded-lg p-2.5">
            <div className="text-[10px] font-semibold text-accent uppercase tracking-wide">AI Suggestion (FSSC 22000)</div>
            <div className="text-[12px] text-text mt-1">{nj.aiSug}</div>
          </div>
        )}
      </div>

      <button
        disabled={saving}
        onClick={submit}
        className={`mt-4 w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60 ${isBd ? 'bg-err' : 'bg-brand'}`}>
        {saving ? 'Saving…' : isBd ? 'Raise Breakdown — Send to On-Duty Technician' : 'Raise Job Card — Send to Maintenance Manager'}
      </button>
    </div>
  )
}

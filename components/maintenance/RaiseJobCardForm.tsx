'use client'

// components/maintenance/RaiseJobCardForm.tsx
// The "Raise Job Card" form, reskinned with design tokens. Workflow logic is
// preserved — it drives the shared `nj` form state + createJC() from the
// maintenance data context.

import { useRef } from 'react'
import { useMaintenanceContext } from '@/app/(app)/maintenance/layout'
import { AREAS, PLANNED_TYPES } from '@/lib/maintenance/constants'
import { aiSuggest, downscalePhoto } from '@/lib/maintenance/helpers'
import { INP } from '@/components/production/shared/ui'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'

export function RaiseJobCardForm({ onDone }: { onDone?: () => void }) {
  const { ui, actions, derived } = useMaintenanceContext()
  const { nj, setNj, saving, setPopup } = ui
  const { duty } = derived
  const fRef = useRef<HTMLInputElement>(null)
  const isBd = nj.workflow === 'breakdown'

  async function submit() {
    await actions.createJC()
    onDone?.()
  }

  return (
    <div className={`card p-4 ${isBd ? 'border-err/40' : ''}`}>
      <div className="text-sm font-semibold text-text mb-3">Raise Job Card</div>

      <div className="flex gap-2 mb-3">
        <button
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${isBd ? 'bg-err text-white' : 'bg-surface-dim text-text-muted hover:bg-surface-rule'}`}
          onClick={() => setNj(p => ({ ...p, workflow: 'breakdown', type: [] }))}>
          Breakdown — Urgent
        </button>
        <button
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${!isBd ? 'bg-info text-white' : 'bg-surface-dim text-text-muted hover:bg-surface-rule'}`}
          onClick={() => setNj(p => ({ ...p, workflow: 'planned' }))}>
          Scheduled / Planned
        </button>
      </div>

      {isBd && (
        <div className="rounded-lg bg-err/10 border border-err/20 p-2.5 mb-3 text-[12px] text-err">
          Breakdown goes <strong>directly to the technician on duty</strong> ({duty ?? 'none on roster — manager will allocate'}) — the maintenance manager is informed. The job timer starts as soon as the card is raised.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label className={LB}>Your Name</label><input className={INP} value={nj.raisedBy} onChange={e => setNj(p => ({ ...p, raisedBy: e.target.value }))} placeholder="Type your name…" /></div>
        <div><label className={LB}>Area / Location</label>
          <select className={INP} value={nj.area} onChange={e => setNj(p => ({ ...p, area: e.target.value }))}>
            <option value="">Select area…</option>{AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div><label className={LB}>Machine (optional)</label><input className={INP} value={nj.machine} onChange={e => setNj(p => ({ ...p, machine: e.target.value }))} placeholder="Machine name…" /></div>
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

      <div className="mt-3"><label className={LB}>Short Description of the Problem</label>
        <input className={INP} value={nj.desc} onChange={e => setNj(p => ({ ...p, desc: e.target.value, aiSug: aiSuggest(e.target.value + ' ' + p.longDesc) }))} placeholder="One line — what is wrong?" />
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

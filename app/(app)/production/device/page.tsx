'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Tablet, CheckCircle2, ShieldCheck, RotateCcw } from 'lucide-react'
import { SECTION_ORDER, sectionMeta } from '@/lib/production/capture-config'
import { getDeviceBinding, setDeviceBinding, clearDeviceBinding, type DeviceBinding } from '@/lib/production/device'

export default function DeviceSetupPage() {
  const router = useRouter()
  const [binding, setBinding] = useState<DeviceBinding | null>(null)

  useEffect(() => { setBinding(getDeviceBinding()) }, [])

  function bindSection(sectionId: string) {
    const b: DeviceBinding = { kind: 'section', sectionId }
    setDeviceBinding(b); setBinding(b)
    try { sessionStorage.removeItem('cntp_device_routed') } catch { /* ignore */ }
  }
  function bindSupervisor() {
    const b: DeviceBinding = { kind: 'supervisor' }
    setDeviceBinding(b); setBinding(b)
    try { sessionStorage.removeItem('cntp_device_routed') } catch { /* ignore */ }
  }
  function reset() { clearDeviceBinding(); setBinding(null) }

  const isSection = (id: string) => binding?.kind === 'section' && binding.sectionId === id

  return (
    <div className="px-4 py-5 max-w-[720px] space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/production/capture')} className="p-2 -ml-1 rounded-lg hover:bg-stone-100 text-stone-400"><ChevronLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="font-semibold text-[22px] text-text leading-tight flex items-center gap-2"><Tablet size={20} /> This tablet</h1>
          <p className="text-[12px] text-text-muted mt-0.5">Bind this device to a section (machine) or to the supervisor. Stored on this tablet only. Operators still sign with their PIN.</p>
        </div>
      </div>

      {binding && (
        <div className="flex items-center gap-3 px-4 py-3 bg-ok/8 border border-ok/30 rounded-2xl">
          <CheckCircle2 size={18} className="text-ok shrink-0" />
          <span className="flex-1 text-[13px] text-text">
            This tablet is set to <strong>{binding.kind === 'supervisor' ? 'Supervisor' : sectionMeta(binding.sectionId).name}</strong>.
          </span>
          <button onClick={reset} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-err"><RotateCcw size={13} /> Reset</button>
        </div>
      )}

      {/* Supervisor */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest">Supervisor</div>
        <button onClick={bindSupervisor}
          className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition-colors ${binding?.kind === 'supervisor' ? 'border-brand bg-brand/5' : 'border-stone-200 bg-white hover:border-brand/40'}`}>
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0"><ShieldCheck size={18} className="text-purple-600" /></div>
          <div className="flex-1">
            <div className="font-semibold text-[14px] text-text">Factory supervisor</div>
            <div className="text-[12px] text-text-muted">Assign sections, review &amp; approve across all lines.</div>
          </div>
          {binding?.kind === 'supervisor' && <CheckCircle2 size={18} className="text-brand shrink-0" />}
        </button>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest">Section (machine)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SECTION_ORDER.map(id => {
            const m = sectionMeta(id)
            return (
              <button key={id} onClick={() => bindSection(id)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition-colors ${isSection(id) ? 'border-brand bg-brand/5' : 'border-stone-200 bg-white hover:border-brand/40'} ${m.built ? '' : 'opacity-60'}`}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                  <span className="font-mono font-bold text-[11px] text-white">{m.code}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[14px] text-text">{m.name}</div>
                  <div className="text-[11px] text-text-muted">{m.built ? 'Ready' : 'Coming soon'}</div>
                </div>
                {isSection(id) && <CheckCircle2 size={18} className="text-brand shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>

      {binding && (
        <button onClick={() => router.push('/production/capture')}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand text-white font-medium text-[14px] hover:bg-brand-mid transition-colors">
          Done — open {binding.kind === 'supervisor' ? 'supervisor home' : sectionMeta(binding.sectionId).name}
        </button>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Loader2, X, Search, AlertTriangle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'

interface EmployeeHit { id: string; name: string; display_name: string | null }

// Shared-tablet / kiosk flow: whoever is signed into the browser can hand the
// tablet to a different employee to take their own assessment, attested by
// PIN — the same identity model the Capture floor app already uses for
// shift changeover (see ChangeoverModal in production/capture/[section]).
export function PinSwitchModal({ onClose, onSwitched }: {
  onClose: () => void
  onSwitched: (employeeId: string, employeeName: string, pin: string) => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<EmployeeHit[]>([])
  const [selected, setSelected] = useState<EmployeeHit | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (selected || search.trim().length < 2) { setResults([]); return }
    let cancelled = false
    getDb().schema('production').from('employees').select('id,name,display_name').eq('active', true)
      .ilike('name', `%${search.trim()}%`).limit(8)
      .then(({ data }: any) => { if (!cancelled) setResults(data ?? []) })
    return () => { cancelled = true }
  }, [search, selected])

  async function confirm() {
    if (!selected || pin.length < 4) return
    setBusy(true); setError(null)
    const { data } = await getDb().schema('production').from('operators')
      .select('id').eq('employee_id', selected.id).eq('pin', pin).eq('active', true).maybeSingle()
    setBusy(false)
    if (!data) { setError('PIN not recognised for this person.'); return }
    onSwitched(selected.id, selected.display_name || selected.name, pin)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[380px] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[15px] text-text">Take training as someone else</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={15} /></button>
        </div>

        {!selected ? (
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Search by name</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" />
              <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
                className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand"
                placeholder="Employee name…" />
            </div>
            {results.length > 0 && (
              <div className="border border-stone-100 rounded-xl overflow-hidden divide-y divide-stone-100">
                {results.map(r => (
                  <button key={r.id} onClick={() => setSelected(r)}
                    className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-surface transition-colors">
                    {r.display_name || r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-text-muted">
              <span className="font-medium text-text">{selected.display_name || selected.name}</span> — enter their 4-digit PIN to confirm.
            </p>
            <input value={pin} inputMode="numeric" maxLength={4} autoFocus
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null) }}
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[18px] font-mono tracking-[0.4em] text-center outline-none focus:border-brand"
              placeholder="••••" />
            {error && <p className="text-[11px] text-err flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setSelected(null); setPin(''); setError(null) }} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Back</button>
              <button onClick={confirm} disabled={busy || pin.length < 4}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40">
                {busy ? <Loader2 size={14} className="animate-spin" /> : 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

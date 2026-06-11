'use client'
import { useState, useRef } from 'react'
import { Loader2, Lock, ShieldCheck } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import type { Operator } from '@/lib/supabase/database.types'

/**
 * Identity gate for the roster + PIN model.
 *
 * The header is already rostered by the supervisor; the operator just confirms
 * they are one of the assigned people by entering their 4-digit PIN. On success
 * the verified Operator is returned and capture unlocks.
 *
 * The input is uncontrolled (value read via ref) so typing never re-renders the
 * parent and focus is never lost on a tablet keyboard.
 */
export function PinGate({ assignedOperators, onVerified }: {
  assignedOperators: { id: string; name: string }[]
  onVerified: (op: Operator) => void
}) {
  const [selectedId, setSelectedId] = useState(assignedOperators[0]?.id ?? '')
  const [state, setState] = useState<'idle' | 'verifying' | 'failed'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  async function verify() {
    const pin = (inputRef.current?.value ?? '').replace(/\D/g, '')
    if (!selectedId)     { setState('failed'); return }
    if (pin.length !== 4) { setState('failed'); return }
    setState('verifying')
    const { data, error } = await getDb().schema('production').from('operators')
      .select('*').eq('id', selectedId).eq('pin', pin).maybeSingle()
    if (error || !data) { setState('failed'); return }
    onVerified(data as Operator)
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center">
            <ShieldCheck size={22} className="text-brand" />
          </div>
          <h2 className="font-semibold text-[17px] text-text">Confirm it's you</h2>
          <p className="text-[12px] text-text-muted leading-relaxed">
            You're rostered on this section. Enter your PIN to start capturing.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Operator</label>
          <select
            value={selectedId}
            onChange={e => { setSelectedId(e.target.value); setState('idle') }}
            className="w-full px-3 py-3 min-h-[44px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand cursor-pointer"
          >
            {assignedOperators.map(op => (
              <option key={op.id} value={op.id}>{op.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">PIN</label>
          <div className="flex gap-2">
            <input
              key={selectedId}
              ref={inputRef}
              type="password" inputMode="numeric" maxLength={4} defaultValue="" placeholder="••••"
              disabled={state === 'verifying'}
              onChange={() => state === 'failed' && setState('idle')}
              onKeyDown={e => { if (e.key === 'Enter') verify() }}
              className="flex-1 px-3 py-3 min-h-[44px] rounded-xl border border-stone-200 bg-white text-center text-[22px] font-mono tracking-[0.5em] text-text outline-none focus:border-brand"
            />
            <button
              onClick={verify} disabled={state === 'verifying'}
              className="flex-shrink-0 px-4 min-h-[44px] rounded-xl bg-brand text-white font-semibold text-[13px] disabled:opacity-40 flex items-center gap-1.5"
            >
              {state === 'verifying' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Verify
            </button>
          </div>
          {state === 'failed' && (
            <p className="text-[11px] text-err px-1">Incorrect PIN — please try again</p>
          )}
        </div>
      </div>
    </div>
  )
}

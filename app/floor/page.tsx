'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, Delete, ChevronLeft } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { deriveAuthPassword } from '@/lib/production/operator-auth'

interface FloorOperator { id: string; display_name: string; email: string; section_ids: string[] }

function currentShift(): 'day' | 'night' {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'day' : 'night'
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function FloorLoginPage() {
  const router = useRouter()
  const [operators, setOperators] = useState<FloorOperator[]>([])
  const [onShift,   setOnShift]   = useState<Set<string>>(new Set())
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<FloorOperator | null>(null)
  const [pin, setPin]             = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError]         = useState('')
  const redirected = useRef(false)

  // Already signed in? Go straight to capture.
  useEffect(() => {
    getSupabaseClient().auth.getSession().then(({ data }: any) => {
      if (data.session && !redirected.current) { redirected.current = true; router.replace('/production/capture') }
    })
  }, [router])

  useEffect(() => {
    async function load() {
      const [opsData, rosterData] = await Promise.all([
        fetch('/api/floor/operators').then(r => r.json()).catch(() => []),
        getSupabaseClient()
          .schema('production' as any)
          .from('roster_entries')
          .select('operator_id, roster_periods!inner(start_date, end_date)')
          .eq('shift', currentShift())
          .not('operator_id', 'is', null)
          .lte('roster_periods.start_date', todayISO())
          .gte('roster_periods.end_date',   todayISO())
          .then(r => r.data ?? [])
          .catch(() => []),
      ])
      setOperators(Array.isArray(opsData) ? opsData : [])
      setOnShift(new Set((rosterData as any[]).map((r: any) => r.operator_id).filter(Boolean)))
      setLoading(false)
    }
    load()
  }, [])

  // Sort: on-shift operators first, then alphabetical.
  const sorted = [...operators].sort((a, b) => {
    const aS = onShift.has(a.id) ? 0 : 1
    const bS = onShift.has(b.id) ? 0 : 1
    return aS - bS || a.display_name.localeCompare(b.display_name)
  })

  async function signIn(p: string) {
    if (!selected || p.length !== 4) return
    setSigningIn(true); setError('')
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email:    selected.email,
      password: deriveAuthPassword(p, selected.email),
    })
    if (error) {
      setError('Incorrect PIN — please try again')
      setPin(''); setSigningIn(false)
      return
    }
    router.replace('/production/capture')
  }

  function pressKey(k: string) {
    if (signingIn) return
    setError('')
    if (k === 'del') { setPin(p => p.slice(0, -1)); return }
    setPin(p => {
      const next = (p + k).slice(0, 4)
      if (next.length === 4) signIn(next)
      return next
    })
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5" style={{ background: 'linear-gradient(150deg,#EDF2FB,#F0F7EE 50%,#FDF4F0)' }}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex flex-col items-center gap-2 px-6 pt-7 pb-5 border-b border-stone-100">
          <Image src="/logo.png" alt="CNTP" width={56} height={56} style={{ objectFit: 'contain' }} priority />
          <h1 className="font-semibold text-[18px] text-text">Production Capture</h1>
          <p className="text-[12px] text-text-muted">Sign in with your name and PIN</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
        ) : !selected ? (
          /* ── Operator picker ── */
          <div className="p-4">
            {sorted.length === 0 ? (
              <p className="text-center text-[13px] text-text-muted py-10">
                No operators set up yet. Ask your supervisor to add you.
              </p>
            ) : (
              <>
                {onShift.size > 0 && (
                  <p className="text-[11px] font-semibold text-text-faint uppercase tracking-wider px-1 mb-2">On shift now</p>
                )}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {sorted.map((op, i) => {
                  const isShift  = onShift.has(op.id)
                  const prevShift = i > 0 && onShift.has(sorted[i - 1].id)
                  return (
                    <div key={op.id}>
                      {!isShift && prevShift && onShift.size > 0 && (
                        <p className="text-[11px] font-semibold text-text-faint uppercase tracking-wider px-1 mb-2 mt-3">Other operators</p>
                      )}
                  <button
                    key={op.id} onClick={() => { setSelected(op); setPin(''); setError('') }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left ${isShift ? 'border-brand/40 bg-brand/5 hover:border-brand hover:bg-brand/10' : 'border-stone-200 hover:border-brand hover:bg-brand/5'}`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                      <span className="font-mono font-bold text-[12px] text-stone-600">{op.display_name.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <span className="font-medium text-[15px] text-text flex-1">{op.display_name}</span>
                    {isShift && (
                      <span className="text-[10px] font-semibold text-brand bg-brand/10 rounded-full px-2 py-0.5 uppercase tracking-wide">On shift</span>
                    )}
                  </button>
                    </div>
                  )
                })}
              </div>
              </>
            )}
          </div>
        ) : (
          /* ── PIN pad ── */
          <div className="p-6 space-y-5">
            <button onClick={() => { setSelected(null); setPin(''); setError('') }} className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text">
              <ChevronLeft size={14} /> Not {selected.display_name}?
            </button>

            <div className="text-center space-y-3">
              <p className="text-[14px] text-text">Hi <strong>{selected.display_name}</strong>, enter your PIN</p>
              <div className="flex justify-center gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`w-4 h-4 rounded-full transition-colors ${i < pin.length ? 'bg-brand' : 'bg-stone-200'}`} />
                ))}
              </div>
              {error && <p className="text-[12px] text-err">{error}</p>}
              {signingIn && <Loader2 size={18} className="animate-spin text-brand mx-auto" />}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => (
                <button key={k} onClick={() => pressKey(k)} disabled={signingIn}
                  className="py-4 rounded-2xl bg-stone-50 border border-stone-200 text-[22px] font-mono font-semibold text-text hover:bg-stone-100 active:scale-95 transition disabled:opacity-40">
                  {k}
                </button>
              ))}
              <div />
              <button onClick={() => pressKey('0')} disabled={signingIn}
                className="py-4 rounded-2xl bg-stone-50 border border-stone-200 text-[22px] font-mono font-semibold text-text hover:bg-stone-100 active:scale-95 transition disabled:opacity-40">
                0
              </button>
              <button onClick={() => pressKey('del')} disabled={signingIn}
                className="py-4 rounded-2xl flex items-center justify-center text-stone-400 hover:text-text active:scale-95 transition">
                <Delete size={22} />
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-5 text-[10px] uppercase tracking-[0.07em] text-stone-400">Cape Natural Tea Products · Blackheath</p>
    </div>
  )
}

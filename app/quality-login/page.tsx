'use client'

// app/quality-login/page.tsx
// PIN-based login for quality lab assistants.
// After sign-in → /quality/lab-results (default lab landing).

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Delete, ChevronLeft, FlaskConical } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { deriveLabPassword } from '@/lib/quality/lab-auth'

interface Assistant { user_id: string; display_name: string; email: string }

export default function QualityLoginPage() {
  const router  = useRouter()
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState<Assistant | null>(null)
  const [pin,        setPin]        = useState('')
  const [signingIn,  setSigningIn]  = useState(false)
  const [error,      setError]      = useState('')
  const redirected = useRef(false)

  useEffect(() => {
    getSupabaseClient().auth.getSession().then(({ data }: any) => {
      if (data.session && !redirected.current) {
        redirected.current = true
        router.replace('/quality/lab-results')
      }
    })
  }, [router])

  useEffect(() => {
    fetch('/api/quality/lab-assistants')
      .then(r => r.json())
      .then(d => setAssistants(Array.isArray(d) ? d : []))
      .catch(() => setAssistants([]))
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...assistants].sort((a, b) => a.display_name.localeCompare(b.display_name))

  async function signIn(p: string) {
    if (!selected || p.length !== 4) return
    setSigningIn(true); setError('')
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email:    selected.email,
      password: deriveLabPassword(p, selected.email),
    })
    if (error) { setError('Incorrect PIN — please try again'); setPin(''); setSigningIn(false); return }
    router.replace('/quality/lab-results')
  }

  function pressKey(k: string) {
    if (signingIn) return
    setError('')
    if (k === 'del') { setPin(p => p.slice(0, -1)); return }
    setPin(p => { const next = (p + k).slice(0, 4); if (next.length === 4) signIn(next); return next })
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5"
      style={{ background: 'linear-gradient(150deg,#EDF2FB,#F0F7EE 50%,#FDF4F0)' }}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex flex-col items-center gap-2 px-6 pt-7 pb-5 border-b border-stone-100">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-brand/10">
            <FlaskConical size={26} className="text-brand" />
          </div>
          <h1 className="font-semibold text-[18px] text-text">Quality Lab</h1>
          <p className="text-[12px] text-text-muted">Select your name and enter your PIN</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-stone-300" />
          </div>
        ) : !selected ? (
          /* ── Assistant picker ── */
          <div className="p-4">
            {sorted.length === 0 ? (
              <p className="text-center text-[13px] text-text-muted py-10">
                No lab assistants set up yet. Ask your quality manager.
              </p>
            ) : (
              <div className="space-y-2 max-h-[52vh] overflow-y-auto">
                {sorted.map(asst => (
                  <button
                    key={asst.user_id}
                    onClick={() => { setSelected(asst); setPin(''); setError('') }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-stone-200 hover:border-brand hover:bg-brand/5 transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                      <span className="font-mono font-bold text-[12px] text-stone-600">
                        {asst.display_name.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <span className="font-medium text-[15px] text-text flex-1">{asst.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── PIN pad ── */
          <div className="p-6 space-y-5">
            <button
              onClick={() => { setSelected(null); setPin(''); setError('') }}
              className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text"
            >
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
      <p className="mt-5 text-[10px] uppercase tracking-[0.07em] text-stone-400">
        Cape Natural Tea Products · Blackheath
      </p>
    </div>
  )
}

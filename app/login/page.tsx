'use client'
// app/login/page.tsx

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { signIn, user } = useAuth()
  const router = useRouter()

  useEffect(() => { if (user) router.replace('/dashboard') }, [user, router])

  async function handle(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required'); return }
    setLoading(true); setError('')
    const { error } = await signIn(email.trim(), password)
    if (error) { setError(error); setLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-brand p-6">
      <div className="mb-8 text-center">
        <div className="font-display font-extrabold text-3xl text-white tracking-[3px] uppercase mb-1">
          CNTP <span className="text-accent-light">·</span> Platform
        </div>
        <div className="font-mono text-[10px] tracking-[2px] uppercase text-white/30">
          Ops · Quality · Sales · Management
        </div>
      </div>

      <form onSubmit={handle} className="w-full max-w-sm bg-white/6 border border-white/10 rounded-2xl p-7">
        <h1 className="font-display font-bold text-xl text-white mb-5">Sign in</h1>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/15 border border-red-400/30 rounded-xl text-[12px] text-red-200">{error}</div>
        )}

        <div className="mb-4">
          <label className="block font-mono text-[10px] tracking-[1px] uppercase text-white/40 mb-1.5">Email address</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@rooibostea.co.za" autoComplete="email" inputMode="email"
            className="w-full px-4 py-3 bg-white/7 border border-white/15 rounded-xl text-white font-mono text-sm outline-none focus:border-accent-light placeholder:text-white/20 transition-colors" />
        </div>

        <div className="mb-6">
          <label className="block font-mono text-[10px] tracking-[1px] uppercase text-white/40 mb-1.5">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••" autoComplete="current-password"
            className="w-full px-4 py-3 bg-white/7 border border-white/15 rounded-xl text-white text-base outline-none focus:border-accent-light placeholder:text-white/20 transition-colors" />
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3 rounded-xl bg-accent-light text-brand font-display font-bold text-sm transition-opacity disabled:opacity-50">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-center font-mono text-[10px] text-white/30">
          Forgotten your password? Contact your IT administrator.
        </p>
      </form>

      <p className="mt-6 font-mono text-[9px] tracking-[1px] uppercase text-white/20">
        Cape Natural Tea Products · Blackheath
      </p>
    </div>
  )
}
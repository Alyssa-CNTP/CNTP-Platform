'use client'
// app/reset-password/page.tsx
// Handles Supabase password reset callback.
// Supabase redirects here with ?code=... after the user clicks the email link.

import { useState, useEffect } from 'react'
import { useRouter }           from 'next/navigation'
import { createClient }        from '@supabase/supabase-js'
import Image                   from 'next/image'
import { Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react'

export default function ResetPasswordPage() {
  const [password,    setPassword]    = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [success,     setSuccess]     = useState(false)
  const [codeReady,   setCodeReady]   = useState(false)
  const [codeError,   setCodeError]   = useState(false)
  const router = useRouter()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Handles two Supabase flows:
  // 1. PKCE  — modern flow:     URL has ?code=xxx  → exchangeCodeForSession
  // 2. Implicit — legacy flow:  URL has #access_token=xxx&type=recovery → already in session
  useEffect(() => {
    async function init() {
      // Flow 1: check if Supabase already parsed hash tokens into a session (implicit flow)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { setCodeReady(true); return }

      // Flow 2: PKCE code in query string
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) setCodeError(true)
        else       setCodeReady(true)
        return
      }

      // Flow 3: hash tokens not yet parsed — listen for auth state change
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
          if (session) { setCodeReady(true); subscription.unsubscribe() }
        }
      })

      // If nothing fires within 4s, show error
      setTimeout(() => {
        subscription.unsubscribe()
        setCodeReady(prev => { if (!prev) setCodeError(true); return prev })
      }, 4000)
    }
    init()
  }, []) // eslint-disable-line

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (password.length < 8)   { setError('Password must be at least 8 characters'); return }
    if (password !== confirm)   { setError('Passwords do not match'); return }

    setLoading(true)
    setError('')

    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      // Sign out the recovery session so the login page starts completely clean.
      // Without this, the leftover session confuses the auth context on login.
      await supabase.auth.signOut()
      setSuccess(true)
      setTimeout(() => router.replace('/login'), 2000)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(150deg, #EDF2FB 0%, #F0F7EE 50%, #FDF4F0 100%)',
      fontFamily: 'var(--font-inter), Inter, -apple-system, sans-serif',
      padding: '24px 16px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: '#ffffff',
        borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
        padding: '40px 36px',
      }}>

        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
          <Image src="/logo.png" alt="Cape Natural" width={72} height={72}
            style={{ objectFit: 'contain' }} priority />
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 6px', letterSpacing: '-0.02em', textAlign: 'center' }}>
          Set your password
        </h1>
        <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 28px', textAlign: 'center', lineHeight: 1.5 }}>
          Choose a password for your CNTP Platform account
        </p>

        {/* Invalid / expired link */}
        {codeError && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 16px', borderRadius: 10,
            background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: 20,
          }}>
            <AlertCircle size={16} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#DC2626', margin: '0 0 2px' }}>Reset link is invalid or expired</p>
              <p style={{ fontSize: 12, color: '#B91C1C', margin: 0, lineHeight: 1.4 }}>
                Please go back to the login page and request a new password reset.
              </p>
            </div>
          </div>
        )}

        {/* Success */}
        {success && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 16px', borderRadius: 10,
            background: '#F0FDF4', border: '1px solid #86EFAC',
          }}>
            <CheckCircle2 size={18} style={{ color: '#16A34A', flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#166534', margin: '0 0 2px' }}>Password updated!</p>
              <p style={{ fontSize: 12, color: '#15803D', margin: 0 }}>Redirecting you to login…</p>
            </div>
          </div>
        )}

        {/* Form */}
        {!success && !codeError && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 8,
                background: '#FEF2F2', border: '1px solid #FECACA',
              }}>
                <AlertCircle size={14} style={{ color: '#DC2626', flexShrink: 0 }} />
                <p style={{ fontSize: 13, color: '#DC2626', margin: 0 }}>{error}</p>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                New password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  disabled={!codeReady}
                  style={{
                    display: 'block', width: '100%', padding: '12px 42px 12px 14px',
                    fontSize: 15, color: '#111827', background: codeReady ? '#F9FAFB' : '#F3F4F6',
                    border: '1.5px solid #E5E7EB', borderRadius: 10, outline: 'none',
                    boxSizing: 'border-box', minHeight: 48, transition: 'border-color 0.15s',
                    cursor: codeReady ? 'text' : 'not-allowed',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#16A34A'; e.currentTarget.style.background = '#fff' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.background = codeReady ? '#F9FAFB' : '#F3F4F6' }}
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2 }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Confirm password
              </label>
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                autoComplete="new-password"
                disabled={!codeReady}
                style={{
                  display: 'block', width: '100%', padding: '12px 14px',
                  fontSize: 15, color: '#111827', background: codeReady ? '#F9FAFB' : '#F3F4F6',
                  border: '1.5px solid #E5E7EB', borderRadius: 10, outline: 'none',
                  boxSizing: 'border-box', minHeight: 48, transition: 'border-color 0.15s',
                  cursor: codeReady ? 'text' : 'not-allowed',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#16A34A'; e.currentTarget.style.background = '#fff' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.background = codeReady ? '#F9FAFB' : '#F3F4F6' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !codeReady}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '13px 24px', fontSize: 15, fontWeight: 600,
                color: '#ffffff',
                background: loading || !codeReady ? '#86EFAC' : '#16A34A',
                border: 'none', borderRadius: 10,
                cursor: loading || !codeReady ? 'not-allowed' : 'pointer',
                minHeight: 48, transition: 'background 0.15s',
                fontFamily: 'inherit',
              }}
            >
              {loading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
              {loading ? 'Updating…' : !codeReady ? 'Loading…' : 'Set new password'}
            </button>

          </form>
        )}

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#9CA3AF' }}>
          <a href="/login" style={{ color: '#16A34A', textDecoration: 'none', fontWeight: 500 }}>
            ← Back to login
          </a>
        </p>

      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

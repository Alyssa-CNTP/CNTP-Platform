'use client'
// app/login/page.tsx — Split-layout login. Light theme always.
// Left: brand form panel. Right: rooibos field image.
// Uncontrolled inputs via FormData — zero re-renders while typing.

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getDefaultRoute } from '@/lib/auth/departments'
import { Loader2, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, user, department, permissionsReady } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user && permissionsReady) router.replace(getDefaultRoute(department ?? ''))
  }, [user, permissionsReady, department, router])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd       = new FormData(e.currentTarget)
    const email    = (fd.get('email')    as string ?? '').trim()
    const password = (fd.get('password') as string ?? '')
    if (!email || !password) { setError('Email and password are required'); return }
    setLoading(true); setError('')
    const { error } = await signIn(email, password)
    if (error) { setError(error); setLoading(false) }
  }

  return (
    <div style={{
      display: 'flex',
      minHeight: '100dvh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      background: '#ffffff',
    }}>

      {/* ── LEFT PANEL — form ──────────────────────────────────────────── */}
      <div style={{
        flex: '0 0 auto',
        width: '100%',
        maxWidth: 480,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '48px 40px',
        background: '#ffffff',
        position: 'relative',
        zIndex: 2,
      }}>

        {/* Logo */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ marginBottom: 24 }}>
            <Image
              src="/logo.png"
              alt="Cape Natural Tea Products"
              width={120}
              height={120}
              style={{ display: 'block' }}
              priority
            />
          </div>

          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#111827',
            margin: '0 0 6px',
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}>
            Welcome back
          </h1>
          <p style={{ fontSize: 15, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
            Sign in to your Cape Natural Tea Products account
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 16px',
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 12,
            marginBottom: 20,
          }}>
            <AlertCircle size={16} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }}/>
            <p style={{ fontSize: 14, color: '#DC2626', margin: 0, lineHeight: 1.4 }}>{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Email */}
          <div>
            <label style={{
              display: 'block',
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
              marginBottom: 6,
            }}>
              Email address
            </label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@rooibostea.co.za"
              style={{
                display: 'block',
                width: '100%',
                padding: '13px 16px',
                fontSize: 16,
                color: '#111827',
                background: '#F9FAFB',
                border: '1.5px solid #E5E7EB',
                borderRadius: 10,
                outline: 'none',
                boxSizing: 'border-box',
                minHeight: 50,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#1A3A0E'; e.currentTarget.style.background = '#fff' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.background = '#F9FAFB' }}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{
              display: 'block',
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
              marginBottom: 6,
            }}>
              Password
            </label>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              style={{
                display: 'block',
                width: '100%',
                padding: '13px 16px',
                fontSize: 16,
                color: '#111827',
                background: '#F9FAFB',
                border: '1.5px solid #E5E7EB',
                borderRadius: 10,
                outline: 'none',
                boxSizing: 'border-box',
                minHeight: 50,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#1A3A0E'; e.currentTarget.style.background = '#fff' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.background = '#F9FAFB' }}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: '14px 24px',
              fontSize: 16,
              fontWeight: 600,
              color: '#ffffff',
              background: loading ? '#2A5416' : '#1A3A0E',
              border: 'none',
              borderRadius: 10,
              cursor: loading ? 'not-allowed' : 'pointer',
              minHeight: 50,
              opacity: loading ? 0.8 : 1,
              transition: 'background 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {loading && <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }}/>}
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>

        </form>

        {/* Footer */}
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #F3F4F6' }}>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0, lineHeight: 1.6 }}>
            Use your <strong style={{ color: '#6B7280' }}>@rooibostea.co.za</strong> email address.<br/>
            Forgotten your password? Contact your IT administrator.
          </p>
        </div>

        <p style={{
          position: 'absolute',
          bottom: 20,
          left: 40,
          fontSize: 11,
          color: '#D1D5DB',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          margin: 0,
        }}>
          Cape Natural Tea Products · Blackheath, BHW
        </p>
      </div>

      {/* ── RIGHT PANEL — full-bleed photo ── */}
      <div
        className="hidden md:block"
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          backgroundImage: 'url(/rooibos-hero.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
        }}
      >
        {/* Subtle left-edge gradient to blend with white form panel */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, rgba(255,255,255,0.12) 0%, transparent 18%)',
        }}/>
        {/* Brand tag bottom-right */}
        <div style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          padding: '8px 18px',
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderRadius: 24,
          fontSize: 12,
          fontWeight: 600,
          color: '#1A3A0E',
          letterSpacing: '0.04em',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        }}>
          Rooibos · Blackheath, Western Cape
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        /* Mobile: full-width form panel */
        @media (max-width: 767px) {
          form { padding: 0 !important; }
        }
      `}</style>
    </div>
  )
}

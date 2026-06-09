'use client'

// app/(auth)/sales-login/page.tsx  — OR  app/login/page.tsx if unified
//
// Distinct visual identity for the CNTP Sales Portal.
// Uses Supabase auth (same instance as the main app).
// On success → redirects based on role:
//   admin / management  → /dashboard
//   sales               → /sales
//   research            → /research
//
// How this fits your VPS deployment:
//   - Supabase is already cloud-hosted → no changes needed when moving to VPS
//   - Just point NEXT_PUBLIC_SUPABASE_URL in your VPS .env to the same project
//   - The redirect logic works identically in prod

import React, { useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/navigation'

// Role → home route mapping
const ROLE_ROUTES: Record<string, string> = {
  admin:      '/dashboard',
  management: '/dashboard',
  sales:      '/sales',
  research:   '/research',
}

export default function SalesLoginPage() {
  const supabase = createClientComponentClient()
  const router   = useRouter()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // 1. Sign in with Supabase
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authErr || !authData.user) {
        setError('Invalid credentials. Please check your email and password.')
        setLoading(false)
        return
      }

      // 2. Fetch role from your profiles / app_roles table
      //    Adjust schema/table name to match your existing setup
      const { data: roleData } = await supabase
        .schema('shared' as any)
        .from('app_roles')
        .select('role')
        .eq('user_id', authData.user.id)
        .single()

      const role  = roleData?.role ?? 'sales'
      const route = ROLE_ROUTES[role] ?? '/sales'

      router.push(route)
      router.refresh()

    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080d0a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Mono', 'Courier New', monospace",
      padding: '2rem',
    }}>
      {/* Subtle grid texture */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(16,185,129,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.03) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      {/* Card */}
      <div style={{
        position: 'relative',
        width: '100%', maxWidth: '420px',
        background: '#0d1410',
        border: '1px solid rgba(16,185,129,0.15)',
        borderRadius: '2px',
        padding: '3rem 2.5rem',
      }}>
        {/* Corner accents */}
        <div style={{ position: 'absolute', top: -1, left: -1, width: 20, height: 20, borderTop: '2px solid #10b981', borderLeft: '2px solid #10b981' }} />
        <div style={{ position: 'absolute', top: -1, right: -1, width: 20, height: 20, borderTop: '2px solid #10b981', borderRight: '2px solid #10b981' }} />
        <div style={{ position: 'absolute', bottom: -1, left: -1, width: 20, height: 20, borderBottom: '2px solid #10b981', borderLeft: '2px solid #10b981' }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: 20, height: 20, borderBottom: '2px solid #10b981', borderRight: '2px solid #10b981' }} />

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.75rem' }}>
            <div style={{
              width: 32, height: 32,
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: '2px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L14 4V8C14 11.3 11.3 14.3 8 15C4.7 14.3 2 11.3 2 8V4L8 1Z" stroke="#10b981" strokeWidth="1.2" fill="none"/>
                <path d="M6 8L7.5 9.5L10 6.5" stroke="#10b981" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: '#10b981', textTransform: 'uppercase', lineHeight: 1 }}>CNTP // SECURE ACCESS</div>
            </div>
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#f0fdf4', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
            Sales Intelligence<br />
            <span style={{ color: '#10b981' }}>Portal</span>
          </h1>
          <p style={{ margin: '0.5rem 0 0', fontSize: 11, color: 'rgba(240,253,244,0.35)', letterSpacing: '0.05em' }}>
            CAPE NATURAL TEA PRODUCTS · INTERNAL ONLY
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(240,253,244,0.4)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="name@cntp.co.za"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#080d0a',
                border: '1px solid rgba(16,185,129,0.15)',
                borderRadius: '2px',
                padding: '10px 12px',
                fontSize: 12,
                color: '#f0fdf4',
                outline: 'none',
                letterSpacing: '0.02em',
                transition: 'border-color 0.2s',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(16,185,129,0.15)'}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 9, letterSpacing: '0.15em', color: 'rgba(240,253,244,0.4)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••••••"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#080d0a',
                border: '1px solid rgba(16,185,129,0.15)',
                borderRadius: '2px',
                padding: '10px 12px',
                fontSize: 14,
                color: '#f0fdf4',
                outline: 'none',
                transition: 'border-color 0.2s',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(16,185,129,0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(16,185,129,0.15)'}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '2px',
              padding: '10px 12px',
              fontSize: 11,
              color: '#fca5a5',
              letterSpacing: '0.02em',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.5rem',
              width: '100%',
              background: loading ? 'rgba(16,185,129,0.1)' : '#10b981',
              border: '1px solid',
              borderColor: loading ? 'rgba(16,185,129,0.2)' : '#10b981',
              borderRadius: '2px',
              padding: '11px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: loading ? '#10b981' : '#080d0a',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? (
              <>
                <span style={{
                  width: 12, height: 12,
                  border: '1.5px solid rgba(16,185,129,0.3)',
                  borderTopColor: '#10b981',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.8s linear infinite',
                }} />
                Authenticating
              </>
            ) : (
              'Access Portal →'
            )}
          </button>
        </form>

        {/* Footer note */}
        <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(16,185,129,0.08)' }}>
          <p style={{ margin: 0, fontSize: 10, color: 'rgba(240,253,244,0.2)', textAlign: 'center', letterSpacing: '0.05em', lineHeight: 1.6 }}>
            CONFIDENTIAL · INTERNAL USE ONLY<br />
            Authorised personnel of Cape Natural Tea Products
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(240,253,244,0.2); }
        input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 1000px #080d0a inset !important;
          -webkit-text-fill-color: #f0fdf4 !important;
        }
      `}</style>
    </div>
  )
}
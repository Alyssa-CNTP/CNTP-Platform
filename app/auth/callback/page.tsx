'use client'
// app/auth/callback/page.tsx
// Handles OAuth redirect from Microsoft/Azure.
//
// IMPORTANT: createBrowserClient (@supabase/ssr) has detectSessionInUrl:true by default.
// It automatically exchanges the ?code= param for a session when the page loads.
// We must NOT manually call exchangeCodeForSession — that would be a second attempt
// to use the PKCE verifier (already consumed by the auto-exchange), causing:
//   "PKCE code verifier not found in storage"
//
// Instead: just listen for SIGNED_IN via onAuthStateChange and redirect.

import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import { getSupabaseClient }   from '@/lib/supabase/client'
import Image                   from 'next/image'
import { Loader2 }             from 'lucide-react'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')

  useEffect(() => {
    const supabase = getSupabaseClient()

    // Listen for the session that createBrowserClient establishes automatically.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Detect first-ever sign-in: created_at ≈ last_sign_in_at (within 30s)
        const user      = session.user
        const created   = new Date(user.created_at).getTime()
        const lastLogin = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : created
        const isNew     = Math.abs(created - lastLogin) < 30_000

        if (isNew) {
          fetch('/api/auth/notify-new-user', {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              email: user.email,
              name:  user.user_metadata?.full_name ?? user.user_metadata?.name ?? '',
            }),
          }).catch(() => {/* ignore */})
        }

        router.replace('/dashboard')
      }
    })

    // If the session was already established before this listener registered
    // (e.g. fast auto-exchange completed synchronously), redirect immediately.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })

    // Timeout fallback — if nothing happens in 15s, something went wrong
    const fallback = setTimeout(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          router.replace('/dashboard')
        } else {
          setStatus('error')
          setTimeout(() => router.replace('/login'), 3000)
        }
      })
    }, 15_000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(fallback)
    }
  }, [router])

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      background: 'linear-gradient(150deg, #EDF2FB 0%, #F0F7EE 50%, #FDF4F0 100%)',
      fontFamily: 'var(--font-inter), Inter, -apple-system, sans-serif',
    }}>
      <Image src="/logo.png" alt="Cape Natural" width={64} height={64}
        style={{ objectFit: 'contain' }} priority />

      {status === 'loading' ? (
        <>
          <Loader2 size={22} style={{ color: '#16A34A', animation: 'spin 1s linear infinite' }} />
          <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
            Signing you in with Microsoft…
          </p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 14, color: '#DC2626', margin: 0, fontWeight: 500 }}>
            Sign-in failed
          </p>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0 }}>
            Redirecting back to login…
          </p>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

'use client'
// app/auth/callback/page.tsx
// Handles OAuth redirect from Microsoft/Azure.
// Supabase sends the user here with ?code=... after Microsoft login.
// Exchanges the code for a session then redirects to the dashboard.

import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import { createClient }        from '@supabase/supabase-js'
import Image                   from 'next/image'
import { Loader2 }             from 'lucide-react'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')

  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const code = new URLSearchParams(window.location.search).get('code')

    if (!code) {
      // No code — might be a hash-based implicit flow fallback
      router.replace('/dashboard')
      return
    }

    supabase.auth.exchangeCodeForSession(code)
      .then(async ({ data, error }) => {
        if (error) {
          console.error('OAuth callback error:', error.message)
          setStatus('error')
          setTimeout(() => router.replace('/login'), 3000)
          return
        }

        // Detect first-ever sign-in: created_at and last_sign_in_at are within 30s of each other
        const user = data.session?.user
        if (user) {
          const created   = new Date(user.created_at).getTime()
          const lastLogin = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : created
          const isNew     = Math.abs(created - lastLogin) < 30_000

          if (isNew) {
            // Fire-and-forget — send auth token so the endpoint can verify the caller
            const accessToken = data.session?.access_token
            fetch('/api/auth/notify-new-user', {
              method:  'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${accessToken ?? ''}`,
              },
              body: JSON.stringify({
                email: user.email,
                name:  user.user_metadata?.full_name ?? user.user_metadata?.name ?? '',
              }),
            }).catch(() => {/* ignore */})
          }
        }

        router.replace('/dashboard')
      })
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

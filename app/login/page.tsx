'use client'
// app/login/page.tsx
// Single layout, pure CSS responsive. No JS show/hide — no hydration issues.
// Mobile/tablet: card on gradient. Desktop (≥1024px): split with photo.

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getDefaultRoute } from '@/lib/auth/departments'
import { getSupabaseClient } from '@/lib/supabase/client'
import { Loader2, AlertCircle } from 'lucide-react'

const IS_STAGING = process.env.NEXT_PUBLIC_APP_ENV === 'staging'

export default function LoginPage() {
  const [error,     setError]     = useState('')
  const [msLoading, setMsLoading] = useState(false)
  const { user, department, role, permissionsReady } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user && permissionsReady) router.replace(getDefaultRoute(department ?? '', role))
  }, [user, permissionsReady, department, role, router])

  async function handleMicrosoft() {
    setMsLoading(true); setError('')
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'email openid profile',
        skipBrowserRedirect: false,
        // Force Azure to show the account picker every time. Without this,
        // Azure silently re-uses its cached SSO session on a shared browser and
        // signs the previous person straight back in ("auto-login from cache").
        // 'select_account' makes the next user choose/confirm their own account.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) { setError(error.message); setMsLoading(false) }
  }

  return (
    <>
      {/* ── Outer wrapper — mobile: gradient bg, desktop: flex row ── */}
      <div className="login-outer" data-env={IS_STAGING ? 'staging' : 'production'}>

        {IS_STAGING && (
          <div className="login-staging-banner">
            <span className="login-staging-dot" />
            <span className="login-staging-text">
              STAGING<span className="login-staging-text-full"> ENVIRONMENT — not for real production data</span>
            </span>
          </div>
        )}

        {/* ── Form panel ─────────────────────────────────────────── */}
        <div className="login-form-panel">
          <div className="login-form-inner">

            {/* Logo */}
            <div className="login-logo-wrap">
              <Image src="/logo.png" alt="Cape Natural Tea Products"
                width={80} height={80} style={{ objectFit: 'contain' }} priority />
              <h1 className="login-heading">Welcome back</h1>
              <p className="login-sub">Sign in to your Cape Natural Tea Products account</p>
            </div>

            {/* ── Work account sign-in (Microsoft OAuth) ── */}
            <button
              type="button"
              onClick={handleMicrosoft}
              disabled={msLoading}
              className="btn-work-account"
            >
              {msLoading
                ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                : (
                  <svg width="17" height="17" viewBox="0 0 21 21" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
                    <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
                    <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
                    <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                  </svg>
                )
              }
              <span>{msLoading ? 'Redirecting…' : 'Continue with work account'}</span>
            </button>

            {/* Error */}
            {error && (
              <div className="login-error">
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <p>{error}</p>
              </div>
            )}

            {/* Divider */}
            <div className="login-divider">
              <div className="login-divider-line" />
              <span className="login-divider-text">or sign in as</span>
              <div className="login-divider-line" />
            </div>

            {/* Role cards */}
            <div className="login-role-cards">
              <a href="/quality-login" className="login-role-card">
                <div className="login-role-icon login-role-icon--quality">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/>
                  </svg>
                </div>
                <div className="login-role-text">
                  <span className="login-role-name">Quality Lab</span>
                  <span className="login-role-desc">Sign in with your PIN</span>
                </div>
                <svg className="login-role-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
              </a>

              <a href="/maintenance-login" className="login-role-card">
                <div className="login-role-icon login-role-icon--maint">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                  </svg>
                </div>
                <div className="login-role-text">
                  <span className="login-role-name">Maintenance Tech</span>
                  <span className="login-role-desc">Sign in with your PIN</span>
                </div>
                <svg className="login-role-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
              </a>

              <a href="/floor" className="login-role-card">
                <div className="login-role-icon login-role-icon--floor">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                  </svg>
                </div>
                <div className="login-role-text">
                  <span className="login-role-name">Floor Operator</span>
                  <span className="login-role-desc">Sign in with your PIN</span>
                </div>
                <svg className="login-role-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
              </a>
            </div>

            {/* Footer */}
            <div className="login-footer-note">
              <p>
                Sign in with your <strong>@rooibostea.co.za</strong> Microsoft account.<br/>
                Trouble signing in? Contact your IT administrator.
              </p>
            </div>

          </div>

          <p className="login-copyright">
            Cape Natural Tea Products · Blackheath, BHW
          </p>
        </div>

        {/* ── Photo panel — hidden below 1024px via CSS ── */}
        <div className="login-photo-panel">
          <div className="login-photo-overlay" />
          <div className="login-photo-tag">Rooibos · Blackheath, Western Cape</div>
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }

        /* ── Base ── */
        .login-outer {
          position: relative;
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          background: linear-gradient(150deg, #EDF2FB 0%, #F0F7EE 50%, #FDF4F0 100%);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        }

        /* ── Staging banner — fixed/overlaid so it never disturbs the split
           layout (that's what made the earlier in-flow banner feel awkward).
           No page-wide recolor, just this one clearly-visible strip. ── */
        .login-staging-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 34px;
          padding: 0 10px;
          background: #FFEDD5;
          border-bottom: 1px solid #FDBA74;
          color: #9A3412;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.03em;
          box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        }
        .login-staging-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #F97316;
          flex-shrink: 0;
        }
        /* Never let the banner wrap/overflow its fixed height — that's what
           was spilling into the logo on narrow phones. Truncate with ellipsis
           as a safety net, and hide the long tail below 480px so it reads as
           just "STAGING" on small screens instead of getting cut off. */
        .login-staging-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .login-staging-text-full { display: none; }
        @media (min-width: 480px) {
          .login-staging-text-full { display: inline; }
        }
        /* Reserve room for the fixed banner so it never covers the logo/content */
        .login-outer[data-env="staging"] .login-form-panel { padding-top: calc(32px + 34px); }
        .login-outer[data-env="staging"] .login-photo-panel { margin-top: 34px; }

        /* ── Form panel ── */
        .login-form-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 20px 48px;
          position: relative;
        }
        .login-form-inner {
          width: 100%;
          max-width: 420px;
          background: #fff;
          border-radius: 16px;
          padding: 32px 28px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.06);
        }

        /* ── Logo ── */
        .login-logo-wrap {
          text-align: center;
          margin-bottom: 24px;
        }
        .login-heading {
          font-size: 22px;
          font-weight: 700;
          color: #111827;
          margin: 12px 0 4px;
          letter-spacing: -0.02em;
          line-height: 1.2;
        }
        .login-sub {
          font-size: 14px;
          color: #6B7280;
          margin: 0;
          line-height: 1.5;
        }

        /* ── Work account button ── */
        .btn-work-account {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 12px 20px;
          margin-bottom: 16px;
          font-size: 14px;
          font-weight: 500;
          color: #111827;
          background: #fff;
          border: 1.5px solid #E5E7EB;
          border-radius: 8px;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          transition: border-color 0.15s, box-shadow 0.15s;
          font-family: inherit;
        }
        .btn-work-account:hover:not(:disabled) {
          border-color: #0078D4;
          box-shadow: 0 2px 8px rgba(0,120,212,0.15);
        }
        .btn-work-account:disabled { opacity: 0.7; cursor: not-allowed; }

        /* ── Divider ── */
        .login-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }
        .login-divider-line { flex: 1; height: 1px; background: #F0F0F0; }
        .login-divider-text { font-size: 12px; color: #9CA3AF; white-space: nowrap; }

        /* ── Error ── */
        .login-error {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 14px;
          background: #FEF2F2;
          border: 1px solid #FECACA;
          border-radius: 8px;
          margin-bottom: 14px;
          color: #DC2626;
          font-size: 13px;
        }
        .login-error p { margin: 0; line-height: 1.4; }

        /* ── Form ── */
        .login-form { display: flex; flex-direction: column; gap: 14px; }
        .login-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 5px;
        }
        .login-input {
          display: block;
          width: 100%;
          padding: 11px 14px;
          font-size: 15px;
          color: #111827;
          background: #F9FAFB;
          border: 1.5px solid #E5E7EB;
          border-radius: 8px;
          outline: none;
          transition: border-color 0.15s;
          font-family: inherit;
        }
        .login-submit {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 12px 24px;
          font-size: 15px;
          font-weight: 600;
          color: #fff;
          background: #1A3A0E;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          min-height: 46px;
          transition: background 0.15s;
          font-family: inherit;
        }
        .login-submit:disabled { background: #2A5416; opacity: 0.8; cursor: not-allowed; }

        /* ── Role cards ── */
        .login-role-cards {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 16px;
        }
        .login-role-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border: 1.5px solid #E5E7EB;
          border-radius: 10px;
          text-decoration: none;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
          background: #FAFAFA;
        }
        .login-role-card:hover {
          border-color: #1A3A0E;
          background: #F5F8F4;
          box-shadow: 0 2px 8px rgba(26,58,14,0.08);
        }
        .login-role-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          shrink: 0;
          flex-shrink: 0;
        }
        .login-role-icon--quality { background: #EEF2FF; color: #4338CA; }
        .login-role-icon--maint { background: #FFF7ED; color: #C2410C; }
        .login-role-icon--floor { background: #F0FDF4; color: #15803D; }
        .login-role-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .login-role-name {
          font-size: 14px;
          font-weight: 600;
          color: #111827;
          line-height: 1.2;
        }
        .login-role-desc {
          font-size: 12px;
          color: #9CA3AF;
        }
        .login-role-arrow { color: #D1D5DB; flex-shrink: 0; }
        .login-role-card:hover .login-role-arrow { color: #6B7280; }

        /* ── Footer note ── */
        .login-footer-note {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid #F3F4F6;
        }
        .login-footer-note p { font-size: 12px; color: #9CA3AF; margin: 0; line-height: 1.7; text-align: center; }
        .login-footer-note strong { color: #6B7280; }

        /* ── Copyright ── */
        .login-copyright {
          font-size: 10px;
          color: #C4C9D4;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          text-align: center;
          margin-top: 20px;
        }

        /* ── Photo panel — hidden by default ── */
        .login-photo-panel { display: none; }

        /* ─────────────────────────────────────────────────────────
           DESKTOP ≥ 1024px — side-by-side layout
        ───────────────────────────────────────────────────────── */
        @media (min-width: 1024px) {
          .login-outer {
            flex-direction: row;
            background: #fff;
            min-height: 100dvh;
            height: 100dvh;
            overflow: hidden;
          }
          .login-form-panel {
            flex: 0 0 480px;
            width: 480px;
            overflow-y: auto;
            background: #fff;
            padding: 48px;
            align-items: flex-start;
            justify-content: center;
          }
          .login-form-inner {
            max-width: none;
            border-radius: 0;
            padding: 0;
            box-shadow: none;
            background: transparent;
          }
          .login-logo-wrap { text-align: left; }
          .login-heading { font-size: 28px; }
          .login-footer-note p { text-align: left; }
          .login-copyright {
            position: absolute;
            bottom: 20px;
            left: 48px;
            text-align: left;
            margin: 0;
          }
          /* Photo panel */
          .login-photo-panel {
            display: block;
            flex: 1;
            position: relative;
            overflow: hidden;
            background-image: url(/rooibos-hero.png);
            background-size: cover;
            background-position: center center;
          }
          .login-photo-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, rgba(255,255,255,0.12) 0%, transparent 18%);
          }
          .login-photo-tag {
            position: absolute;
            bottom: 24px;
            right: 24px;
            padding: 8px 18px;
            background: rgba(255,255,255,0.88);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 24px;
            font-size: 12px;
            font-weight: 600;
            color: #1A3A0E;
            letter-spacing: 0.04em;
            box-shadow: 0 2px 12px rgba(0,0,0,0.12);
          }
        }

        /* ─────────────────────────────────────────────────────────
           TABLET landscape ≥ 768px — wider card
        ───────────────────────────────────────────────────────── */
        @media (min-width: 768px) and (max-width: 1023px) {
          .login-form-inner { max-width: 500px; padding: 40px 44px; }
          .login-form-panel { padding: 40px 24px 60px; }
        }

        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}

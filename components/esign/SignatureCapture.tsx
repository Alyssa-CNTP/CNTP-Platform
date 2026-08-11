'use client'

// components/esign/SignatureCapture.tsx
// Shared capture UI for both esign signer kinds, built on the existing
// components/ui/SignaturePad canvas (not forked).
//
//   mode="internal" — logged-in staff, no drawing: mirrors the "Verify & Sign"
//                      pattern already shipped on job cards (QualitySignOff in
//                      app/(app)/job-cards/pasteuriser/page.tsx) — the click IS
//                      the identity check, the image comes from the signature
//                      already on file (production.employee_signatures).
//   mode="external" — a driver/customer with no account: must draw fresh and
//                      type their name; nothing is remembered afterwards.
//
// Once `audit` is set (either mode), both render the same locked receipt —
// signer, timestamp, and an expandable IP/device disclosure.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Eye, X } from 'lucide-react'
import SignaturePad from '@/components/ui/SignaturePad'
import { getMySignatureStatus, type MySignatureStatus } from '@/lib/production/employee-signature'

export interface SignatureAudit {
  signerName: string
  signedAt: string
  signatureImage?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

interface SignResult { ok: boolean; error?: string }

interface Props {
  mode: 'internal' | 'external'
  documentLabel: string
  context?: string
  audit?: SignatureAudit | null
  onSignInternal?: () => Promise<SignResult>
  onSignExternal?: (signatureImage: string, signerName: string) => Promise<SignResult>
}

export default function SignatureCapture({ mode, documentLabel, context, audit, onSignInternal, onSignExternal }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<MySignatureStatus | null>(null)
  const [signerName, setSignerName] = useState('')
  const [drawn, setDrawn] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)

  useEffect(() => {
    if (mode === 'internal' && !audit) getMySignatureStatus().then(setStatus)
  }, [mode, audit])

  if (audit) {
    return (
      <div className="rounded-xl border border-ok/30 bg-ok-bg/20 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-status-ok text-[12px] font-semibold">
          <CheckCircle2 size={13} /> Signed by {audit.signerName}
        </div>
        {audit.signatureImage && (
          // A deliberate view-then-close popup, not an always-on-screen image —
          // this is the per-document snapshot already applied to this record
          // (not the reusable Staff Directory master, which stays self-only),
          // so viewing it here is fine, but it shouldn't just sit open on the
          // page indefinitely either.
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            className="inline-flex items-center gap-1.5 text-[11px] text-brand font-medium hover:underline"
          >
            <Eye size={12} /> View signature
          </button>
        )}
        <p className="text-[11px] text-text-muted">
          {new Date(audit.signedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })}
        </p>
        {(audit.ipAddress || audit.userAgent) && (
          <details className="text-[11px] text-text-faint">
            <summary className="cursor-pointer">Audit detail</summary>
            <div className="mt-1 space-y-0.5">
              {audit.ipAddress && <p>IP: {audit.ipAddress}</p>}
              {audit.userAgent && <p className="break-all">Device: {audit.userAgent}</p>}
            </div>
          </details>
        )}

        {viewerOpen && audit.signatureImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setViewerOpen(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-4 space-y-3"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-text">{audit.signerName}'s signature</span>
                <button onClick={() => setViewerOpen(false)} className="p-1 rounded-lg hover:bg-stone-100 text-stone-400">
                  <X size={16} />
                </button>
              </div>
              <div className="rounded-lg border border-surface-rule bg-white px-3 py-4 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={audit.signatureImage} alt={`${audit.signerName}'s signature`} style={{ height: 60 }} />
              </div>
              <button onClick={() => setViewerOpen(false)}
                className="w-full py-2 rounded-xl border border-stone-200 text-[12px] font-medium text-stone-500 hover:bg-stone-50">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (mode === 'internal') {
    if (!status) return null
    if (!status.hasSignature) {
      return (
        <p className="text-[11px] text-warn">
          No signature on file — {status.employeeId
            ? <Link href={`/production/staff/${status.employeeId}`} className="underline">set one up on your Staff Directory profile</Link>
            : 'ask IT to link your login to your Staff Directory profile'} first.
        </p>
      )
    }
    return (
      <div className="space-y-1.5">
        <button
          disabled={busy}
          onClick={async () => {
            if (!onSignInternal) return
            setBusy(true); setError(null)
            const res = await onSignInternal()
            if (!res.ok) setError(res.error || 'Could not sign')
            setBusy(false)
          }}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-brand text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Signing…' : `Verify & Sign as ${status.employeeName ?? 'you'}`}
        </button>
        {error && <p className="text-[11px] text-err">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {context && <p className="text-[13px] text-text-muted">{context}</p>}
      <input
        value={signerName}
        onChange={e => setSignerName(e.target.value)}
        placeholder="Your full name"
        className="w-full px-3 py-2 border border-surface-rule rounded-lg text-[13px]"
      />
      <SignaturePad label={documentLabel} name={signerName || 'Signature'} value={drawn} onChange={setDrawn} />
      <button
        disabled={busy || !drawn || !signerName.trim()}
        onClick={async () => {
          if (!onSignExternal || !drawn) return
          setBusy(true); setError(null)
          const res = await onSignExternal(drawn, signerName.trim())
          if (!res.ok) { setError(res.error || 'Could not submit signature'); setBusy(false) }
        }}
        className="w-full py-2.5 rounded-xl text-[13px] font-semibold bg-brand text-white hover:opacity-90 disabled:bg-surface-rule disabled:text-text-faint transition-colors"
      >
        {busy ? 'Submitting…' : 'Submit signature'}
      </button>
      {error && <p className="text-[11px] text-err">{error}</p>}
    </div>
  )
}

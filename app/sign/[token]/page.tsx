// app/sign/[token]/page.tsx
// Standalone public page (no app chrome/nav/login) for an external signer —
// a driver or customer with no CNTP account, signing on their own device at
// the point of delivery. State comes straight from the DB via
// getRequestByToken (server-side, service-role) — never trust a client-only
// "signed" flag, so a hard reload always reflects reality. Listed in
// PUBLIC_ROUTES in app/middleware.ts.

import type { Metadata } from 'next'
import { XCircle } from 'lucide-react'
import { getRequestByToken } from '@/lib/esign/request'
import SignatureCapture from '@/components/esign/SignatureCapture'
import SignClient from './SignClient'

// Never leak the token via the Referer header if this page links anywhere,
// and never log it as part of an outgoing request's referrer.
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await getRequestByToken(token)

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-surface-rule bg-white p-6 space-y-4">
        <div className="text-center">
          <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">CNTP</p>
          <h1 className="text-lg font-semibold text-text">Document signature</h1>
        </div>

        {result.state === 'not_found' && (
          <ErrorState message="This signing link is no longer valid. Please contact CNTP to request a new one." />
        )}

        {result.state === 'expired' && (
          <ErrorState message="This signing link has expired. Please contact CNTP to request a new one." />
        )}

        {result.state === 'signed' && (
          <SignatureCapture
            mode="external"
            documentLabel={result.title}
            audit={{ signerName: result.signerName ?? 'Unknown', signedAt: result.signedAt }}
          />
        )}

        {result.state === 'pending' && <SignClient token={token} title={result.title} />}
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-err/20 bg-err/5 p-4 flex items-start gap-2 text-sm text-err">
      <XCircle size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

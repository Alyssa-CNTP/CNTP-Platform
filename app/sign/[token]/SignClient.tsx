'use client'

// app/sign/[token]/SignClient.tsx
// The interactive half of the public signer page. Submits straight to the
// public token API, then calls router.refresh() so the SERVER re-derives the
// state from the DB — there is no client-only "signed" flag, so a hard reload
// always shows the real, current state (matches app/sign/[token]/page.tsx's
// server-driven design).

import { useRouter } from 'next/navigation'
import SignatureCapture from '@/components/esign/SignatureCapture'

export default function SignClient({ token, title }: { token: string; title: string }) {
  const router = useRouter()

  async function onSignExternal(signatureImage: string, signerName: string) {
    const res = await fetch(`/api/esign/sign/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureImage, signerName }),
    })
    if (res.ok) { router.refresh(); return { ok: true } }
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: body.error || 'Could not submit signature' }
  }

  return (
    <SignatureCapture
      mode="external"
      documentLabel={title}
      context={`You're signing: ${title}`}
      onSignExternal={onSignExternal}
    />
  )
}

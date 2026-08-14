'use client'

// components/shared/ScanCameraButton.tsx
// Drop-in "scan with camera" trigger — sits alongside an existing scan/type
// input, opens BarcodeScanner, and hands the decoded code back via onScan.
// Hidden until the client confirms getUserMedia exists, so it never renders
// on a device/browser with no camera API at all (avoids an SSR/client mismatch
// by starting hidden and only appearing once that check has run).

import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import BarcodeScanner from '@/components/shared/BarcodeScanner'

export interface ScanCameraButtonProps {
  onScan: (code: string) => void
  title?: string
  hint?: string
  formats?: string[]
  className?: string
}

const DEFAULT_CLASS =
  'inline-flex items-center justify-center w-11 h-11 min-h-[44px] rounded-xl border border-surface-rule bg-surface-card text-text-muted hover:text-brand hover:border-brand/40 transition shrink-0'

export default function ScanCameraButton({
  onScan,
  title,
  hint,
  formats,
  className,
}: ScanCameraButtonProps) {
  const [supported, setSupported] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  }, [])

  if (!supported) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Scan with camera"
        title="Scan with camera"
        className={className ?? DEFAULT_CLASS}
      >
        <Camera className="w-4 h-4" />
      </button>
      {open && (
        <BarcodeScanner
          title={title}
          hint={hint}
          formats={formats}
          onDetect={code => { setOpen(false); onScan(code) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

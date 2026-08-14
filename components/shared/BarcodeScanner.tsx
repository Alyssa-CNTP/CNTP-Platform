'use client'

// components/shared/BarcodeScanner.tsx
// Universal camera barcode scanner — works on any phone, tablet or desktop with
// a camera, regardless of browser:
//   - Chrome / Edge / Android: native BarcodeDetector API (zero dependency, fast).
//   - iOS Safari / Firefox (no BarcodeDetector): lazy-loaded @zxing/browser
//     fallback, so scanning still works there instead of silently doing nothing.
// Always renders the <video> element up front and starts the stream in an
// effect after it mounts — starting the stream before the element exists is
// what caused the old "permission granted but no camera" bug.
// Rear camera by default (facingMode: environment) — this is for scanning
// physical labels, not a selfie camera.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null
}

const DEFAULT_FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e', 'itf']

export interface BarcodeScannerProps {
  /** Fired once per open, with the raw decoded text (e.g. the bag serial). */
  onDetect: (code: string) => void
  onClose: () => void
  title?: string
  hint?: string
  /** BarcodeDetector-style format names. Defaults cover every symbology this app prints. */
  formats?: string[]
}

export default function BarcodeScanner({
  onDetect,
  onClose,
  title = 'Scan barcode',
  hint = 'Point the camera at the barcode…',
  formats = DEFAULT_FORMATS,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null)
  const doneRef = useRef(false)

  const [mode, setMode] = useState<'starting' | 'native' | 'zxing' | 'error'>('starting')
  const [err, setErr] = useState('')
  const [manual, setManual] = useState('')

  const stop = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    zxingControlsRef.current?.stop()
    zxingControlsRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const fire = useCallback((code: string) => {
    const trimmed = code.trim()
    if (doneRef.current || !trimmed) return
    doneRef.current = true
    stop()
    onDetect(trimmed)
  }, [onDetect, stop])

  const close = useCallback(() => { stop(); onClose() }, [stop, onClose])

  useEffect(() => {
    let cancelled = false
    const video = videoRef.current
    if (!video) return

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        video.srcObject = stream
        await video.play().catch(() => {})
        if (cancelled) return

        const Ctor = getBarcodeDetectorCtor()
        if (Ctor) {
          setMode('native')
          const detector = new Ctor({ formats })
          const tick = async () => {
            if (cancelled) return
            if (video.readyState >= 2) {
              try {
                const found = await detector.detect(video)
                const code = found?.[0]?.rawValue
                if (code) { fire(code); return }
              } catch { /* transient decode error — keep looping */ }
            }
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
          return
        }

        // No native BarcodeDetector (iOS Safari, Firefox) — fall back to a JS
        // decoder, loaded on demand so browsers with native support never pay for it.
        setMode('zxing')
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])
        if (cancelled) return
        const formatMap: Partial<Record<string, number>> = {
          code_128: BarcodeFormat.CODE_128,
          code_39: BarcodeFormat.CODE_39,
          ean_13: BarcodeFormat.EAN_13,
          ean_8: BarcodeFormat.EAN_8,
          qr_code: BarcodeFormat.QR_CODE,
          upc_a: BarcodeFormat.UPC_A,
          upc_e: BarcodeFormat.UPC_E,
          itf: BarcodeFormat.ITF,
        }
        const possible = formats.map(f => formatMap[f]).filter((f): f is number => f != null)
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, possible)
        const reader = new BrowserMultiFormatReader(hints)
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (!cancelled && result) fire(result.getText())
        })
        if (cancelled) { controls.stop(); return }
        zxingControlsRef.current = controls
      } catch (e: any) {
        if (cancelled) return
        setMode('error')
        setErr(e?.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Could not start the camera.')
      }
    }

    start()
    return () => { cancelled = true; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <BottomSheet open onClose={close} center>
      <div className="bg-surface-card rounded-2xl rounded-b-none lg:rounded-2xl w-full lg:w-[420px] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-rule">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-brand" />
            <h2 className="text-sm font-semibold text-text">{title}</h2>
          </div>
          <button onClick={close} className="text-text-faint hover:text-text w-9 h-9 flex items-center justify-center rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative rounded-lg overflow-hidden border border-surface-rule bg-black">
            {/* Always rendered (even before the stream starts) so the effect has
                a mounted <video> to attach the stream to — no mount-order race. */}
            <video ref={videoRef} muted playsInline className="w-full max-h-[280px] object-cover" />
            {mode !== 'error' && <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-brand/70" />}
          </div>

          {mode === 'error' ? (
            <>
              <div className="text-[12px] text-err text-center">{err}</div>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={manual}
                  onChange={e => setManual(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && manual.trim()) fire(manual) }}
                  placeholder="Type the code instead…"
                  className="h-10 flex-1 rounded-lg border border-surface-rule bg-surface-card px-3 text-[13px] font-mono text-text focus:outline-none focus:ring-2 focus:ring-brand/30"
                  autoCapitalize="characters" spellCheck={false}
                />
                <button
                  onClick={() => manual.trim() && fire(manual)}
                  disabled={!manual.trim()}
                  className="px-4 rounded-lg bg-brand text-white text-[13px] font-semibold disabled:opacity-40"
                >
                  Use
                </button>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-text-faint text-center">{hint}</div>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}

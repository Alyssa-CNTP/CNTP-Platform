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
//
// Camera acquisition and decoder startup are two separate failure points, and
// they're reported separately: getUserMedia failing means there's genuinely no
// camera/permission, but on iOS the camera opens fine and it's the zxing
// decoder that can fail to attach — that's not "could not start the camera"
// (misleading — it did), so the preview stays up and only the auto-decode
// step is reported as unavailable, with typing still on offer right there.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
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

type Mode = 'starting' | 'native' | 'zxing' | 'zxing-failed' | 'camera-error'

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

  const [mode, setMode] = useState<Mode>('starting')
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
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch (e: any) {
        if (cancelled) return
        console.error('[BarcodeScanner] camera failed to start', e)
        setMode('camera-error')
        setErr(e?.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Could not start the camera.')
        return
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream

      const Ctor = getBarcodeDetectorCtor()
      if (Ctor) {
        video.srcObject = stream
        await video.play().catch(() => {})
        if (cancelled) return
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
      // decoder, loaded on demand so browsers with native support never pay
      // for it. The camera has already opened successfully at this point
      // (getUserMedia above succeeded), so a failure from here on is a
      // decoder problem, not a camera problem, and is reported as such —
      // separate try/catch, doesn't touch the "could not start the camera"
      // message.
      try {
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
        // decodeFromStream (not decodeFromVideoElement) — it owns attaching
        // the stream to the video element and waiting for it to actually be
        // playable, which is exactly the iOS Safari timing a bare
        // `video.play()` can race (camera opens, but the first decode
        // attempt fires before frames are really flowing).
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (!cancelled && result) fire(result.getText())
        })
        if (cancelled) { controls.stop(); return }
        zxingControlsRef.current = controls
        setMode('zxing')
      } catch (e: any) {
        if (cancelled) return
        console.error('[BarcodeScanner] decoder failed to start (camera itself opened fine)', e)
        // The camera stream is live even though the decoder never attached —
        // show it anyway so typing the code is at least visually anchored to
        // "yes, this is the bag in front of you", not a dead black box.
        if (!video.srcObject) { video.srcObject = stream; video.play().catch(() => {}) }
        setMode('zxing-failed')
      }
    }

    start()
    return () => { cancelled = true; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const manualEntry = (
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
  )

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
          <div className="relative min-h-[180px] rounded-lg overflow-hidden border border-surface-rule bg-black flex items-center justify-center">
            {/* Always rendered (even before the stream starts) so the effect has
                a mounted <video> to attach the stream to — no mount-order race. */}
            <video ref={videoRef} muted playsInline className="w-full max-h-[280px] object-cover" />
            {mode === 'starting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70 bg-black/40">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-[11px]">Starting camera…</span>
              </div>
            )}
            {mode === 'camera-error' && (
              <div className="absolute inset-0 flex items-center justify-center text-white/30">
                <Camera className="w-6 h-6" />
              </div>
            )}
            {(mode === 'native' || mode === 'zxing') && (
              <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-brand/70" />
            )}
          </div>

          {mode === 'camera-error' && (
            <>
              <div className="text-[12px] text-err text-center">{err}</div>
              {manualEntry}
            </>
          )}
          {mode === 'zxing-failed' && (
            <>
              <div className="text-[12px] text-warn text-center">Couldn't read barcodes automatically on this device — type the code below.</div>
              {manualEntry}
            </>
          )}
          {(mode === 'native' || mode === 'zxing') && (
            <div className="text-[11px] text-text-faint text-center">{hint}</div>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}

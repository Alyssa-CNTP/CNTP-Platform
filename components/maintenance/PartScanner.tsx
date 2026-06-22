'use client'

// components/maintenance/PartScanner.tsx
// Fast part picker for the maintenance storeroom. Four ways to find a part,
// all of which end in onPick(part):
//   1. Handheld / type-in scan  — always-on autofocused input; hardware
//      scanners type the code + Enter. Matches barcode then part_no.
//   2. Camera scan              — progressive enhancement via the native
//      BarcodeDetector API (no npm dep). Hidden when unsupported.
//   3. Identify by photo        — Gemini vision against the register; the
//      photo is downscaled client-side and NEVER stored.
//   4. Manual search            — text filter over the register (fallback).
//
// Matches the app's light design language: hairline borders, bg-brand primary,
// ≥44px tap targets.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Search, ScanLine, Image as ImageIcon, X, Loader2 } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'
import { downscalePhoto } from '@/lib/maintenance/helpers'
import type { SparePart } from '@/lib/maintenance/types'

// ── Minimal BarcodeDetector typings (not in the standard TS DOM lib) ──
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null
}

interface IdentifyMatch { id: number; confidence: 'high' | 'medium' | 'low'; why: string }

const PRIMARY = 'inline-flex items-center justify-center gap-2 bg-brand text-white rounded-lg px-4 min-h-[44px] text-[13px] font-semibold hover:brightness-110 transition'
const GHOST = 'inline-flex items-center justify-center gap-2 border border-surface-rule bg-surface-card text-text rounded-lg px-4 min-h-[44px] text-[13px] font-semibold hover:border-text/25 transition'
const ROW = 'w-full text-left flex items-center justify-between gap-3 px-3 min-h-[44px] py-2 rounded-lg border border-surface-rule hover:border-brand/40 hover:bg-surface-dim/50 transition'

const CONF_TONE: Record<string, string> = {
  high: 'badge-ok',
  medium: 'badge-warn',
  low: 'badge-gray',
}

export default function PartScanner({
  parts,
  onPick,
  onClose,
}: {
  parts: SparePart[]
  onPick: (p: SparePart) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [typedErr, setTypedErr] = useState('')
  const [search, setSearch] = useState('')

  const [camOn, setCamOn] = useState(false)
  const [camErr, setCamErr] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)

  const [identifying, setIdentifying] = useState(false)
  const [guess, setGuess] = useState('')
  const [matches, setMatches] = useState<IdentifyMatch[]>([])
  const [identifyErr, setIdentifyErr] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const hasCamera = useMemo(() => getBarcodeDetectorCtor() !== null, [])

  // Shared barcode → part match (barcode first, then part_no; trim/case-insensitive).
  const matchCode = useCallback(
    (code: string): SparePart | null => {
      const c = (code ?? '').trim().toLowerCase()
      if (!c) return null
      return (
        parts.find(s => (s.barcode ?? '').trim().toLowerCase() === c) ??
        parts.find(s => (s.part_no ?? '').trim().toLowerCase() === c) ??
        null
      )
    },
    [parts],
  )

  // ── Camera cleanup ──
  const stopCamera = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCamOn(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  const startCamera = useCallback(async () => {
    setCamErr('')
    const Ctor = getBarcodeDetectorCtor()
    if (!Ctor) { setCamErr('Camera scanning is not supported on this device.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      detectorRef.current = new Ctor({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e', 'itf'] })
      setCamOn(true)
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => {})

      const tick = async () => {
        const det = detectorRef.current
        const v = videoRef.current
        if (!det || !v || v.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return }
        try {
          const found = await det.detect(v)
          const code = found?.[0]?.rawValue
          if (code) {
            const part = matchCode(code)
            if (part) { stopCamera(); onPick(part); onClose(); return }
          }
        } catch { /* transient detect error — keep looping */ }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e: any) {
      setCamErr(e?.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Could not start the camera.')
      stopCamera()
    }
  }, [matchCode, onPick, onClose, stopCamera])

  // ── Handheld / type-in scan ──
  const submitTyped = () => {
    setTypedErr('')
    const part = matchCode(typed)
    if (part) { onPick(part); onClose(); return }
    setTypedErr('No match — pick below')
  }

  // ── Identify by photo (Gemini) ──
  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    setIdentifying(true)
    setIdentifyErr('')
    setGuess('')
    setMatches([])
    try {
      const imageBase64 = await downscalePhoto(file)
      const res = await fetch('/api/maintenance/identify-part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          parts: parts.map(p => ({ id: p.id, part_no: p.part_no, description: p.description, class: p.class })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (json?.error) setIdentifyErr(json.error)
      setGuess(json?.guess ?? '')
      setMatches(Array.isArray(json?.matches) ? json.matches : [])
      if (!json?.matches?.length && !json?.error) setIdentifyErr('No likely match — try a clearer photo or search below.')
    } catch (e: any) {
      setIdentifyErr(e?.message ?? 'Could not identify the part.')
    } finally {
      setIdentifying(false)
    }
  }

  const partById = (id: number) => parts.find(p => p.id === id) ?? null

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase()
    if (!t) return parts.slice(0, 50)
    return parts.filter(p => `${p.part_no} ${p.description} ${p.class}`.toLowerCase().includes(t)).slice(0, 50)
  }, [parts, search])

  const pick = (p: SparePart) => { onPick(p); onClose() }

  return (
    <BottomSheet open onClose={onClose} center>
      <div className="bg-surface-card rounded-2xl rounded-b-none lg:rounded-2xl w-full lg:w-[460px] max-h-[88vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-rule sticky top-0 bg-surface-card z-10">
          <div className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-brand" />
            <h2 className="text-sm font-semibold text-text">Scan / identify part</h2>
          </div>
          <button onClick={onClose} className="text-text-faint hover:text-text w-9 h-9 flex items-center justify-center rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* 1. Handheld / type-in scan */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block">Scan or type a barcode / part #</label>
            <div className="flex gap-2">
              <input
                autoFocus
                value={typed}
                onChange={e => { setTyped(e.target.value); setTypedErr('') }}
                onKeyDown={e => { if (e.key === 'Enter') submitTyped() }}
                placeholder="Point a handheld scanner here, or type…"
                className="h-11 flex-1 rounded-lg border border-surface-rule bg-surface-card px-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <button onClick={submitTyped} className={PRIMARY}>Find</button>
            </div>
            {typedErr && <div className="text-[12px] text-err mt-1">{typedErr}</div>}
          </div>

          {/* 2. Camera scan (progressive enhancement) */}
          {hasCamera && (
            <div>
              {!camOn ? (
                <button onClick={startCamera} className={`${GHOST} w-full`}>
                  <Camera className="w-4 h-4" /> Scan with camera
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="relative rounded-lg overflow-hidden border border-surface-rule bg-black">
                    <video ref={videoRef} muted playsInline className="w-full max-h-[240px] object-cover" />
                    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-0.5 bg-brand/70" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-faint">Point the camera at the barcode…</span>
                    <button onClick={stopCamera} className="text-[12px] font-semibold text-text-muted hover:text-text">Stop</button>
                  </div>
                </div>
              )}
              {camErr && <div className="text-[12px] text-err mt-1">{camErr}</div>}
            </div>
          )}

          {/* 3. Identify by photo (Gemini) */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => onPhoto(e.target.files?.[0] ?? undefined)}
            />
            <button onClick={() => fileRef.current?.click()} disabled={identifying} className={`${GHOST} w-full disabled:opacity-60`}>
              {identifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              {identifying ? 'Identifying…' : 'Identify by photo'}
            </button>
            {guess && <div className="text-[12px] text-text-muted mt-2">Looks like: <span className="text-text font-medium">{guess}</span></div>}
            {identifyErr && <div className="text-[12px] text-warn mt-1">{identifyErr}</div>}
            {matches.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {matches.map(m => {
                  const p = partById(m.id)
                  if (!p) return null
                  return (
                    <button key={m.id} onClick={() => pick(p)} className={ROW}>
                      <span className="min-w-0">
                        <span className="font-mono text-[12px] text-text">{p.part_no || '—'}</span>
                        <span className="text-text-muted text-[12px]"> — {p.description}</span>
                        {m.why && <span className="block text-[11px] text-text-faint truncate">{m.why}</span>}
                      </span>
                      <span className={`badge ${CONF_TONE[m.confidence] ?? 'badge-gray'} shrink-0`}>{m.confidence.toUpperCase()}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 4. Manual search (always-visible fallback) */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block">Or search the register</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Part #, description or type…"
                className="h-11 w-full rounded-lg border border-surface-rule bg-surface-card pl-8 pr-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <div className="space-y-1.5 mt-2">
              {filtered.map(p => (
                <button key={p.id} onClick={() => pick(p)} className={ROW}>
                  <span className="min-w-0">
                    <span className="font-mono text-[12px] text-text">{p.part_no || '—'}</span>
                    <span className="text-text-muted text-[12px]"> — {p.description}</span>
                    <span className="block text-[11px] text-text-faint">{p.class} · new {p.qty_new} / used {p.qty_used}</span>
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div className="text-[12px] text-text-faint py-3 text-center">No parts match.</div>}
            </div>
          </div>
        </div>
      </div>
    </BottomSheet>
  )
}

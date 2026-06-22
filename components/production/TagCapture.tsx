'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Camera, X, CheckCircle2, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import type { ParsedTag } from '@/app/api/ocr-tag/route'

export interface TagCaptureResult {
  lot_number:    string
  serial_number: string
  product_type:  string
  variant:       string
  weight_kg:     string
  tag_date:      string
  leaf_shade:    string
  confidence:    'high' | 'medium' | 'low'
  raw_text:      string
}

interface TagCaptureProps {
  sectionId:   string
  sectionName: string
  rowLabel:    string
  onConfirm:   (result: TagCaptureResult) => void
  sessionId?:  string | null
  disabled?:   boolean
}

const INP = `w-full px-3 py-2.5 rounded-xl border-2 border-surface-rule bg-surface-card
  font-mono text-[13px] text-text outline-none transition-colors
  focus:border-accent focus:bg-white placeholder:text-text-faint`

// ── Detect rectangular tag in image data using edge/corner detection ──────────
// Returns {x, y, w, h} of the most tag-like rectangle found, or null.
// Strategy: find the largest white/light rectangular region with clear edges.
function detectTagRegion(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): { x: number; y: number; w: number; h: number } | null {
  const { width: W, height: H } = canvas
  const imageData = ctx.getImageData(0, 0, W, H)
  const data      = imageData.data

  // Convert to grayscale
  const gray = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2])
  }

  // Simple edge detection: look for rows/cols with high brightness variance
  // Tags are typically lighter (white/cream) against darker backgrounds (wood, bags)
  const rowBrightness = new Float32Array(H)
  const colBrightness = new Float32Array(W)

  for (let y = 0; y < H; y++) {
    let sum = 0
    for (let x = 0; x < W; x++) sum += gray[y * W + x]
    rowBrightness[y] = sum / W
  }
  for (let x = 0; x < W; x++) {
    let sum = 0
    for (let y = 0; y < H; y++) sum += gray[y * W + x]
    colBrightness[x] = sum / H
  }

  // Find the brightest contiguous region in rows and columns
  const avgBrightness = gray.reduce((a, b) => a + b, 0) / gray.length
  const threshold = avgBrightness + 15 // Tag should be brighter than average

  // Find row extents of bright region
  let rowStart = -1, rowEnd = -1
  for (let y = Math.floor(H * 0.05); y < Math.floor(H * 0.95); y++) {
    if (rowBrightness[y] > threshold) {
      if (rowStart === -1) rowStart = y
      rowEnd = y
    }
  }

  // Find col extents
  let colStart = -1, colEnd = -1
  for (let x = Math.floor(W * 0.05); x < Math.floor(W * 0.95); x++) {
    if (colBrightness[x] > threshold) {
      if (colStart === -1) colStart = x
      colEnd = x
    }
  }

  if (rowStart === -1 || colStart === -1) return null

  // Add small padding
  const pad = 8
  const x = Math.max(0, colStart - pad)
  const y = Math.max(0, rowStart - pad)
  const w = Math.min(W - x, colEnd - colStart + pad * 2)
  const h = Math.min(H - y, rowEnd - rowStart + pad * 2)

  // Reject if region is too small or too large (i.e. the whole image)
  const area    = w * h
  const imgArea = W * H
  if (area < imgArea * 0.05 || area > imgArea * 0.95) return null
  if (w < 80 || h < 80) return null

  return { x, y, w, h }
}

// ── Preprocess: detect tag, crop, boost contrast ──────────────────────────────
async function preprocessImage(file: File): Promise<{
  base64: string; previewUrl: string; mimeType: string
  detected: boolean; cropBox: { x: number; y: number; w: number; h: number } | null
}> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      // Step 1: Draw full image at reduced size for detection
      const DETECT_MAX = 800
      let dw = img.width, dh = img.height
      const ratio = Math.min(DETECT_MAX / dw, DETECT_MAX / dh)
      dw = Math.round(dw * ratio)
      dh = Math.round(dh * ratio)

      const detectCanvas = document.createElement('canvas')
      detectCanvas.width  = dw
      detectCanvas.height = dh
      const detectCtx = detectCanvas.getContext('2d')!
      detectCtx.drawImage(img, 0, 0, dw, dh)

      // Step 2: Detect tag region
      const cropBox = detectTagRegion(detectCanvas, detectCtx)

      // Step 3: Draw cropped (or full) image at output resolution
      const OUTPUT_MAX = 1400
      const canvas  = document.createElement('canvas')
      const ctx     = canvas.getContext('2d')!

      let sx = 0, sy = 0, sw = img.width, sh = img.height

      if (cropBox) {
        // Scale crop box back to original image coordinates
        const scaleBack = 1 / ratio
        sx = Math.round(cropBox.x * scaleBack)
        sy = Math.round(cropBox.y * scaleBack)
        sw = Math.round(cropBox.w * scaleBack)
        sh = Math.round(cropBox.h * scaleBack)
        // Clamp to image bounds
        sx = Math.max(0, sx); sy = Math.max(0, sy)
        sw = Math.min(img.width  - sx, sw)
        sh = Math.min(img.height - sy, sh)
      }

      // Scale output
      let ow = sw, oh = sh
      if (ow > OUTPUT_MAX || oh > OUTPUT_MAX) {
        const r = Math.min(OUTPUT_MAX / ow, OUTPUT_MAX / oh)
        ow = Math.round(ow * r)
        oh = Math.round(oh * r)
      }

      canvas.width  = ow
      canvas.height = oh
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ow, oh)

      // Step 4: Contrast + brightness boost for handwriting
      const imageData = ctx.getImageData(0, 0, ow, oh)
      const pixels    = imageData.data
      const contrast  = 1.5
      const brightness = 15
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i]     = Math.min(255, Math.max(0, (pixels[i]     - 128) * contrast + 128 + brightness))
        pixels[i + 1] = Math.min(255, Math.max(0, (pixels[i + 1] - 128) * contrast + 128 + brightness))
        pixels[i + 2] = Math.min(255, Math.max(0, (pixels[i + 2] - 128) * contrast + 128 + brightness))
      }
      ctx.putImageData(imageData, 0, 0)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const base64  = dataUrl.split(',')[1]

      resolve({
        base64,
        previewUrl: dataUrl,
        mimeType: 'image/jpeg',
        detected: cropBox !== null,
        cropBox,
      })
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = objectUrl
  })
}

// ── Live camera with tag detection overlay ────────────────────────────────────
interface LiveCameraProps {
  onCapture: (file: File) => void
  onClose:   () => void
}

function LiveCamera({ onCapture, onClose }: LiveCameraProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const rafRef     = useRef<number>(0)
  const stableRef  = useRef(0)   // frames the box has been stable
  const lastBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const capturedRef = useRef(false)

  const [status,    setStatus]    = useState<'starting' | 'scanning' | 'found' | 'capturing' | 'error'>('starting')
  const [errorMsg,  setErrorMsg]  = useState('')
  const [countdown, setCountdown] = useState(0)

  // Start camera
  useEffect(() => {
    let active = true
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width:  { ideal: 1280 },
            height: { ideal: 960 },
          }
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setStatus('scanning')
        }
      } catch (err: any) {
        setStatus('error')
        setErrorMsg(err.message ?? 'Camera access denied')
      }
    }
    start()
    return () => {
      active = false
      streamRef.current?.getTracks().forEach(t => t.stop())
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Detection loop
  useEffect(() => {
    if (status !== 'scanning' && status !== 'found') return

    function tick() {
      const video   = videoRef.current
      const canvas  = canvasRef.current
      const overlay = overlayRef.current
      if (!video || !canvas || !overlay || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const W = video.videoWidth, H = video.videoHeight
      if (W === 0 || H === 0) { rafRef.current = requestAnimationFrame(tick); return }

      canvas.width  = W; canvas.height = H
      overlay.width = W; overlay.height = H

      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0, W, H)

      const box = detectTagRegion(canvas, ctx)
      const oc  = overlay.getContext('2d')!
      oc.clearRect(0, 0, W, H)

      if (box) {
        // Check stability — box should be in roughly the same position
        const last = lastBoxRef.current
        const stable = last &&
          Math.abs(box.x - last.x) < 30 &&
          Math.abs(box.y - last.y) < 30 &&
          Math.abs(box.w - last.w) < 40 &&
          Math.abs(box.h - last.h) < 40

        if (stable) {
          stableRef.current++
        } else {
          stableRef.current = 0
        }
        lastBoxRef.current = box

        const isStable = stableRef.current > 8 // ~8 frames stable
        const color    = isStable ? '#22c55e' : '#f59e0b'

        // Draw bounding box
        oc.strokeStyle = color
        oc.lineWidth   = 3
        oc.setLineDash(isStable ? [] : [8, 4])
        oc.strokeRect(box.x, box.y, box.w, box.h)

        // Corner accents
        const cl = 20
        oc.setLineDash([])
        oc.lineWidth = 5
        ;[
          [box.x, box.y, cl, 0, 0, cl],
          [box.x + box.w, box.y, -cl, 0, 0, cl],
          [box.x, box.y + box.h, cl, 0, 0, -cl],
          [box.x + box.w, box.y + box.h, -cl, 0, 0, -cl],
        ].forEach(([x, y, dx1, dy1, dx2, dy2]) => {
          oc.beginPath()
          oc.moveTo(x + dx1, y + dy1)
          oc.lineTo(x, y)
          oc.lineTo(x + dx2, y + dy2)
          oc.stroke()
        })

        // Label
        oc.fillStyle = color
        oc.font = 'bold 14px monospace'
        oc.fillText(isStable ? '✓ TAG DETECTED — Hold steady' : 'Detecting tag…', box.x + 8, box.y - 8)

        if (isStable && !capturedRef.current) {
          setStatus('found')
        }
      } else {
        lastBoxRef.current = null
        stableRef.current  = 0
        setStatus('scanning')
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [status])

  // Auto-capture after detection
  useEffect(() => {
    if (status !== 'found' || capturedRef.current) return
    capturedRef.current = true
    let n = 2
    setCountdown(n)

    const timer = setInterval(() => {
      n--
      setCountdown(n)
      if (n <= 0) {
        clearInterval(timer)
        capture()
      }
    }, 800)

    return () => clearInterval(timer)
  }, [status])

  function capture() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    setStatus('capturing')
    cancelAnimationFrame(rafRef.current)

    const W = video.videoWidth, H = video.videoHeight
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, W, H)

    // Stop stream
    streamRef.current?.getTracks().forEach(t => t.stop())

    canvas.toBlob(blob => {
      if (blob) onCapture(new File([blob], 'tag.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.95)
  }

  function manualCapture() {
    capturedRef.current = true
    setCountdown(0)
    capture()
  }

  // Scale overlay to match video display size
  const videoStyle = { width: '100%', height: '100%', objectFit: 'cover' as const }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Camera view */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={videoStyle}
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Hidden processing canvas */}
        <canvas ref={canvasRef} className="hidden"/>
        {/* Visible overlay */}
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        />

        {/* Status bar */}
        <div className="absolute top-4 left-0 right-0 flex justify-center">
          <div className={`px-4 py-2 rounded-full text-sm font-semibold backdrop-blur-sm ${
            status === 'found' || status === 'capturing'
              ? 'bg-green-500/90 text-white'
              : 'bg-black/60 text-white'
          }`}>
            {status === 'starting'   && 'Starting camera…'}
            {status === 'scanning'   && '🔍 Point camera at the bag tag'}
            {status === 'found'      && countdown > 0 ? `✓ Tag found — capturing in ${countdown}…` : '✓ Tag found'}
            {status === 'capturing'  && 'Capturing…'}
            {status === 'error'      && `Camera error: ${errorMsg}`}
          </div>
        </div>

        {/* Guide overlay — shows where to point */}
        {status === 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="border-2 border-white/30 rounded-lg"
              style={{ width: '70%', height: '55%' }}>
              <div className="absolute top-2 left-0 right-0 text-center">
                <span className="text-white/60 text-xs">Centre the tag here</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-black px-6 py-5 flex items-center justify-between">
        <button onClick={onClose}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/20 text-white text-sm">
          <X size={16}/> Cancel
        </button>

        {/* Manual capture button — always available */}
        <button
          onClick={manualCapture}
          disabled={status === 'capturing' || status === 'starting'}
          className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/30 disabled:opacity-40 transition-all flex items-center justify-center"
        >
          <div className="w-10 h-10 rounded-full bg-white"/>
        </button>

        <div className="w-24 text-right">
          <p className="text-white/60 text-xs leading-tight">
            {status === 'scanning' ? 'or tap\nto capture' : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Field row ─────────────────────────────────────────────────────────────────
function FieldRow({ label, value, onChange, opts, ph }: {
  label: string; value: string; onChange: (v: string) => void
  opts?: string[]; ph?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.07em]">{label}</label>
      {opts ? (
        <select value={value} onChange={e => onChange(e.target.value)} className={INP}>
          <option value="">— not read —</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder={ph ?? '—'}
          className={`${INP} ${!value ? 'border-warn/40 bg-warn/5' : ''}`}
        />
      )}
    </div>
  )
}

function ConfBadge({ conf }: { conf: 'high' | 'medium' | 'low' }) {
  const cfg = {
    high:   { cls: 'bg-ok/10 text-ok border-ok/20',       label: 'High confidence'       },
    medium: { cls: 'bg-warn/10 text-warn border-warn/20', label: 'Medium — check fields' },
    low:    { cls: 'bg-err/10 text-err border-err/20',    label: 'Low — review carefully'},
  }[conf]
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-bold px-2.5 py-1 rounded-lg border ${cfg.cls}`}>
      {conf === 'high' ? <CheckCircle2 size={10}/> : <AlertTriangle size={10}/>}
      {cfg.label}
    </span>
  )
}

// ── Main TagCapture ───────────────────────────────────────────────────────────
export default function TagCapture({
  sectionId, sectionName, rowLabel, onConfirm, sessionId, disabled = false,
}: TagCaptureProps) {
  // File input ref for desktop upload fallback
  const fileRef = useRef<HTMLInputElement>(null)

  const [phase,           setPhase]           = useState<'idle' | 'camera' | 'preprocessing' | 'processing' | 'confirm' | 'error' | 'cooldown'>('idle')
  const [cooldown,        setCooldown]        = useState(0)
  const [preview,         setPreview]         = useState<string | null>(null)
  const [rawText,         setRawText]         = useState('')
  const [confidence,      setConfidence]      = useState<'high' | 'medium' | 'low'>('low')
  const [errorMsg,        setErrorMsg]        = useState('')
  const [detected,        setDetected]        = useState(false)
  const [hasTouchCamera,  setHasTouchCamera]  = useState(false)

  // Detect if device has a rear camera (mobile/tablet) vs laptop/desktop.
  // On desktop, skip the live camera and go straight to file upload.
  useEffect(() => {
    const isTouch = navigator.maxTouchPoints > 0
    if (isTouch && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then(devices => setHasTouchCamera(devices.some(d => d.kind === 'videoinput')))
        .catch(() => setHasTouchCamera(false))
    }
  }, [])

  function handleScanClick() {
    if (disabled || phase !== 'idle') return
    if (hasTouchCamera) {
      setPhase('camera')        // Mobile — live camera with tag detection
    } else {
      fileRef.current?.click()  // Desktop — file picker
    }
  }

  const [fields, setFields] = useState<Required<Record<keyof ParsedTag, string>>>({
    lot_number: '', serial_number: '', product_type: '',
    variant: '', weight_kg: '', tag_date: '', leaf_shade: '',
  })

  function upField(k: keyof ParsedTag, v: string) {
    setFields(f => ({ ...f, [k]: v }))
  }

  const handleCapture = useCallback(async (file: File) => {
    setPhase('preprocessing')
    setErrorMsg('')

    try {
      const { base64, previewUrl, mimeType, detected: det } = await preprocessImage(file)
      setPreview(previewUrl)
      setDetected(det)
      setPhase('processing')

      const res = await fetch('/api/ocr-tag', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image: base64, mimeType }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'OCR request failed')
      }

      const data   = await res.json()
      const parsed = data.fields as ParsedTag

      setFields({
        lot_number:    parsed.lot_number    ?? '',
        serial_number: parsed.serial_number ?? '',
        product_type:  parsed.product_type  ?? '',
        variant:       parsed.variant       ?? '',
        weight_kg:     parsed.weight_kg     ?? '',
        tag_date:      parsed.tag_date      ?? '',
        leaf_shade:    parsed.leaf_shade    ?? '',
      })
      setConfidence(data.confidence)
      setRawText(data.raw_text ?? '')
      setPhase('confirm')

    } catch (err: any) {
      const msg = err.message ?? 'Could not read tag'
      if (msg.includes('quota') || msg.includes('429') || msg.includes('limit')) {
        setPhase('cooldown')
        let secs = 65
        setCooldown(secs)
        const timer = setInterval(() => {
          secs--; setCooldown(secs)
          if (secs <= 0) { clearInterval(timer); setPhase('idle'); setCooldown(0) }
        }, 1000)
      } else {
        setErrorMsg(msg)
        setPhase('error')
      }
    }
  }, [])

  async function handleConfirm() {
    const result: TagCaptureResult = { ...fields, confidence, raw_text: rawText }
    onConfirm(result)

    try {
      const { getDb } = await import('@/lib/supabase/db')
      await getDb().schema('production').from('bag_tags').insert({
        section_id:      sectionId,
        section_name:    sectionName,
        lot_number:      fields.lot_number    || null,
        serial_number:   fields.serial_number || null,
        product_type:    fields.product_type  || null,
        variant:         fields.variant       || null,
        weight_kg:       fields.weight_kg     ? parseFloat(fields.weight_kg) : null,
        tag_date:        fields.tag_date      || null,
        leaf_shade:      fields.leaf_shade    || null,
        ocr_raw_text:    rawText,
        ocr_confidence:  confidence,
        ocr_corrected:   confidence !== 'high',
        prod_session_id: sessionId ?? null,
        qr_payload: ['CNTP', sectionId, fields.lot_number, fields.serial_number,
                     fields.weight_kg, fields.variant, fields.tag_date].join('|'),
      } as any)
    } catch (e) { console.warn('bag_tags insert failed:', e) }

    reset()
  }

  function reset() {
    setPhase('idle')
    setPreview(null)
    setRawText('')
    setDetected(false)
    setFields({ lot_number:'', serial_number:'', product_type:'', variant:'', weight_kg:'', tag_date:'', leaf_shade:'' })
  }

  return (
    <>
      {/* Cooldown */}
      {phase === 'cooldown' && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-warn/30 bg-warn/8 text-[11px] font-mono text-warn">
          <Loader2 size={11} className="animate-spin"/> Wait {cooldown}s
        </div>
      )}

      {/* Trigger button — camera on mobile, upload on desktop */}
      <button
        type="button"
        onClick={handleScanClick}
        disabled={disabled || phase !== 'idle'}
        title={hasTouchCamera ? 'Scan bag tag with camera' : 'Upload tag photo'}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
          disabled ? 'border-stone-200 text-stone-300 cursor-not-allowed'
                   : 'border-brand/30 text-brand bg-brand/5 hover:bg-brand/10'
        }`}
      >
        <Camera size={12}/>
        {hasTouchCamera ? 'Scan tag' : 'Upload tag photo'}
      </button>

      {/* Hidden file input — desktop upload fallback */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleCapture(file)
          e.target.value = ''
        }}
      />

      {/* Live camera — mobile only */}
      {phase === 'camera' && (
        <LiveCamera
          onCapture={file => { handleCapture(file) }}
          onClose={reset}
        />
      )}

      {/* Processing modal */}
      {(phase === 'preprocessing' || phase === 'processing' || phase === 'confirm' || phase === 'error') && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6">
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

            <div className="sticky top-0 bg-white border-b border-stone-200 px-5 py-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-[15px] text-text">Scan bag tag</p>
                <p className="font-mono text-[11px] text-stone-400 mt-0.5">{rowLabel}</p>
              </div>
              <button onClick={reset} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-stone-100">
                <X size={16} className="text-stone-400"/>
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">

              {(phase === 'preprocessing' || phase === 'processing') && (
                <div className="py-10 flex flex-col items-center gap-4">
                  {preview && phase === 'processing' && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="Tag"
                      className="w-full max-w-xs rounded-xl border border-stone-200 object-contain max-h-48"/>
                  )}
                  <Loader2 size={28} className="animate-spin text-brand"/>
                  <div className="text-center">
                    <p className="font-mono text-[12px] text-stone-500">
                      {phase === 'preprocessing' ? 'Cropping and enhancing tag…' : 'Reading tag with Gemini Vision…'}
                    </p>
                    {detected && phase === 'processing' && (
                      <p className="text-[11px] text-ok mt-1">✓ Tag region detected and cropped</p>
                    )}
                  </div>
                </div>
              )}

              {phase === 'error' && (
                <div className="py-8 flex flex-col items-center gap-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-err/10 flex items-center justify-center">
                    <AlertTriangle size={20} className="text-err"/>
                  </div>
                  <div>
                    <p className="font-semibold text-[14px] text-text">Could not read tag</p>
                    <p className="font-mono text-[11px] text-stone-400 mt-1">{errorMsg}</p>
                  </div>
                  <button onClick={handleScanClick}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-semibold">
                    <RefreshCw size={14}/> Try again
                  </button>
                </div>
              )}

              {phase === 'confirm' && (
                <>
                  {preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="Tag"
                      className="w-full rounded-xl border border-stone-200 object-contain max-h-40"/>
                  )}

                  <div className="flex items-center justify-between">
                    <ConfBadge conf={confidence}/>
                    <button onClick={handleScanClick}
                      className="flex items-center gap-1 font-mono text-[10px] text-stone-400 hover:text-brand">
                      <RefreshCw size={10}/> {hasTouchCamera ? 'Retake' : 'Re-upload'}
                    </button>
                  </div>

                  {detected && (
                    <p className="text-[11px] text-ok flex items-center gap-1.5">
                      <CheckCircle2 size={11}/> Tag detected and cropped automatically
                    </p>
                  )}

                  {confidence !== 'high' && (
                    <div className="flex items-start gap-2 px-3 py-2.5 bg-warn/8 border border-warn/20 rounded-xl">
                      <AlertTriangle size={13} className="text-warn flex-shrink-0 mt-0.5"/>
                      <p className="text-[11px] text-warn leading-relaxed">
                        Review all fields carefully. Correct any errors before confirming.
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    <FieldRow label="Lot / Batch number"  value={fields.lot_number}    onChange={v=>upField('lot_number',v.toUpperCase())}    ph="e.g. GS-0266"/>
                    <FieldRow label="Serial / Bag number" value={fields.serial_number} onChange={v=>upField('serial_number',v.toUpperCase())} ph="e.g. N.204"/>
                    <FieldRow label="Product type"        value={fields.product_type}  onChange={v=>upField('product_type',v)}                ph="e.g. Raw Material Dry"/>
                    <FieldRow label="Variant"             value={fields.variant}       onChange={v=>upField('variant',v)}
                      opts={['CON','ORG','RA-CON','RA-ORG']}/>
                    <FieldRow label="Weight (kg)"         value={fields.weight_kg}     onChange={v=>upField('weight_kg',v)}                   ph="e.g. 352.5"/>
                    <FieldRow label="Date"                value={fields.tag_date}      onChange={v=>upField('tag_date',v)}                    ph="yyyy-MM-dd"/>
                    <FieldRow label="Grade / Leaf shade"  value={fields.leaf_shade}    onChange={v=>upField('leaf_shade',v)}                  ph="e.g. A, B, C"/>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button onClick={reset}
                      className="flex-1 py-3 rounded-xl border-2 border-stone-200 text-[13px] font-semibold text-stone-500 hover:bg-stone-50">
                      Cancel
                    </button>
                    <button onClick={handleConfirm}
                      className="flex-1 py-3 rounded-xl bg-brand text-white text-[13px] font-semibold hover:opacity-90 flex items-center justify-center gap-2">
                      <CheckCircle2 size={15}/> Confirm — fill row
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
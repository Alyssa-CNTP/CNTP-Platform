'use client'

/**
 * SignaturePad
 * ─────────────────────────────────────────────────────────────────────────────
 * A canvas-based finger/mouse signature component.
 * Renders a name label, a drawing canvas, and Clear / Confirm controls.
 * On mobile the operator draws with their finger.
 * On desktop they draw with the mouse.
 *
 * Props:
 *   label    — heading shown above the pad (e.g. "Supervisor signature")
 *   name     — person's name shown as a sub-label
 *   value    — current signature as base64 data URL (null = unsigned)
 *   onChange — called with the data URL when confirmed, or null when cleared
 *   disabled — locks the pad after submission
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { PenLine, Trash2, Check } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  label:    string
  name:     string
  value:    string | null
  onChange: (sig: string | null) => void
  disabled?: boolean
}

export default function SignaturePad({ label, name, value, onChange, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing   = useRef(false)
  const lastPos   = useRef<{ x: number; y: number } | null>(null)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [confirmed,  setConfirmed]  = useState(!!value)

  // Resize canvas to match its CSS size (handles retina + layout changes)
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect  = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    // Preserve existing drawing before resize
    const prev = canvas.toDataURL()
    canvas.width  = rect.width  * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.strokeStyle = '#1A2B1A'
    ctx.lineWidth   = 2.2
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    // Restore drawing
    if (hasStrokes) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height)
      img.src = prev
    }
  }, [hasStrokes])

  useEffect(() => {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [resizeCanvas])

  // If value is set from outside (e.g. load from DB), show confirmed state
  useEffect(() => {
    if (value) setConfirmed(true)
  }, [value])

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    if (disabled || confirmed) return
    e.preventDefault()
    drawing.current = true
    lastPos.current = getPos(e)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current || disabled || confirmed) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    const pos = getPos(e)
    if (!pos || !lastPos.current) return
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
    setHasStrokes(true)
  }

  function endDraw() {
    drawing.current = false
    lastPos.current = null
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    setHasStrokes(false)
    setConfirmed(false)
    onChange(null)
  }

  function confirm() {
    const canvas = canvasRef.current
    if (!canvas || !hasStrokes) return
    const dataUrl = canvas.toDataURL('image/png')
    onChange(dataUrl)
    setConfirmed(true)
  }

  // Confirmed — show the saved signature image
  if (confirmed && value) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
            <p className="text-[12px] text-text font-semibold">{name}</p>
          </div>
          <div className="flex items-center gap-1.5 text-status-ok">
            <Check size={13} />
            <span className="font-mono text-[10px] font-semibold">Signed</span>
          </div>
        </div>
        <div className="relative rounded-xl border border-ok/30 bg-ok-bg/20 overflow-hidden" style={{ height: 80 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Signature" className="w-full h-full object-contain p-2" />
          {!disabled && (
            <button
              onClick={clear}
              className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-surface-card border border-surface-rule flex items-center justify-center text-text-faint hover:text-status-error transition-colors"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Drawing pad
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
          <p className="text-[12px] text-text font-semibold">{name}</p>
        </div>
        <div className="flex items-center gap-1 text-text-faint">
          <PenLine size={12} />
          <span className="font-mono text-[10px]">Draw signature</span>
        </div>
      </div>

      {/* Canvas */}
      <div className={clsx(
        'relative rounded-xl border-2 overflow-hidden bg-surface-card',
        disabled ? 'opacity-50 cursor-not-allowed border-surface-rule' : 'border-dashed border-surface-rule hover:border-accent/30 transition-colors',
        hasStrokes && !disabled && 'border-accent/40'
      )} style={{ height: 100 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          style={{ cursor: disabled ? 'not-allowed' : 'crosshair' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-text-faint text-[12px]">Sign here with your finger or mouse</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {!disabled && (
        <div className="flex gap-2">
          <button
            onClick={clear}
            disabled={!hasStrokes}
            className="flex items-center gap-1.5 px-3 py-2 border border-surface-rule rounded-xl text-[12px] font-semibold text-text-muted hover:bg-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={12} /> Clear
          </button>
          <button
            onClick={confirm}
            disabled={!hasStrokes}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold transition-all',
              hasStrokes
                ? 'bg-brand text-white hover:opacity-90'
                : 'bg-surface-rule text-text-faint cursor-not-allowed'
            )}
          >
            <Check size={12} /> Confirm signature
          </button>
        </div>
      )}
    </div>
  )
}
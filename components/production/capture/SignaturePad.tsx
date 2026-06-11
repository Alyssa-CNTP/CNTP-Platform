'use client'
import { useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

/**
 * Touch/stylus signature pad. Emits a base64 PNG on Confirm.
 * Once `signed` is true it collapses to a confirmation chip.
 */
export function SignaturePad({ label, onSign, signed, disabled }: {
  label: string
  onSign: (dataUrl: string) => void
  signed: boolean
  disabled: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing   = useRef(false)
  const [hasSig, setHasSig] = useState(false)

  function pos(e: MouseEvent | TouchEvent, c: HTMLCanvasElement) {
    const r = c.getBoundingClientRect()
    const s = 'touches' in e ? e.touches[0] : e
    return { x: s.clientX - r.left, y: s.clientY - r.top }
  }
  function start(e: any) {
    if (disabled || signed) return
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e.nativeEvent ?? e, canvasRef.current!)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
    e.preventDefault?.()
  }
  function move(e: any) {
    if (!drawing.current || disabled) return
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1C1917'
    const p = pos(e.nativeEvent ?? e, canvasRef.current!)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    setHasSig(true)
    e.preventDefault?.()
  }
  function end() { drawing.current = false }
  function clear() { canvasRef.current!.getContext('2d')!.clearRect(0, 0, 600, 140); setHasSig(false) }

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">{label}</label>
      <div className={`rounded-2xl border-2 overflow-hidden ${signed ? 'border-ok/40 bg-ok/5' : 'border-stone-200 bg-white'}`}>
        {signed ? (
          <div className="flex items-center gap-3 px-5 py-5">
            <CheckCircle2 size={20} className="text-ok" />
            <span className="font-semibold text-[14px] text-ok">Signed</span>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef} width={600} height={140}
              className="w-full touch-none cursor-crosshair block" style={{ height: 140 }}
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
            />
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50">
              <span className="text-[10px] text-stone-400">Sign above with finger or stylus</span>
              <div className="flex gap-2">
                {hasSig && <button onClick={clear} disabled={disabled} className="text-[11px] text-stone-500 hover:text-err px-3 py-1.5 rounded-lg border border-stone-200">Clear</button>}
                {hasSig && <button onClick={() => onSign(canvasRef.current!.toDataURL())} disabled={disabled} className="text-[11px] text-white bg-brand px-3 py-1.5 rounded-lg">Confirm</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

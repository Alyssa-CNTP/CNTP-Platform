'use client'

// components/maintenance/VoiceCapture.tsx
// Mic button that records a short voice note, sends it to /api/maintenance/transcribe
// for Gemini transcription + refinement, and hands the structured result back via
// onResult. The audio is NEVER stored — it's held in memory only for the request
// and discarded; only the refined text is used.

import { useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

const MAX_MS = 30000 // hard cap at 30s

export function VoiceCapture({ mode, onResult, disabled }: {
  mode: 'jobcard' | 'rootcause'
  onResult: (r: { transcript?: string; short_description?: string; long_description?: string; maint_types?: string[]; root_cause?: string; work_done?: string }) => void
  disabled?: boolean
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'working' | 'error'>('idle')
  const [err, setErr] = useState('')
  const [secs, setSecs] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const pickMime = () => {
    const prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    return prefs.find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || ''
  }

  async function start() {
    setErr('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMime()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (tickTimer.current) clearInterval(tickTimer.current)
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        await transcribe(blob, (rec.mimeType || 'audio/webm').split(';')[0])
      }
      recRef.current = rec
      rec.start()
      setState('recording'); setSecs(0)
      tickTimer.current = setInterval(() => setSecs(s => s + 1), 1000)
      stopTimer.current = setTimeout(() => stop(), MAX_MS)
    } catch {
      setState('error'); setErr('Microphone blocked — allow mic access, or type it in.')
    }
  }

  function stop() {
    if (stopTimer.current) clearTimeout(stopTimer.current)
    if (recRef.current && recRef.current.state !== 'inactive') {
      setState('working')
      recRef.current.stop()
    }
  }

  async function transcribe(blob: Blob, mimeType: string) {
    try {
      const audio = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = reject
        r.readAsDataURL(blob)
      })
      const res = await fetch('/api/maintenance/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, mimeType, mode }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setState('error'); setErr(json?.error ?? 'Transcription failed — type it in instead.'); return }
      onResult(json)
      setState('idle')
    } catch {
      setState('error'); setErr('Could not transcribe — type it in instead.')
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {state === 'recording' ? (
        <button type="button" onClick={stop}
          className="inline-flex items-center gap-1.5 rounded-lg bg-err text-white px-3 py-2 text-[12px] font-semibold min-h-[40px] hover:brightness-110 transition">
          <Square size={14} /> Stop ({secs}s)
        </button>
      ) : state === 'working' ? (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted px-1"><Loader2 size={14} className="animate-spin" /> Transcribing…</span>
      ) : (
        <button type="button" onClick={start} disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-rule bg-surface-card text-text px-3 py-2 text-[12px] font-semibold min-h-[40px] hover:border-text/30 transition disabled:opacity-50">
          <Mic size={14} /> {mode === 'rootcause' ? 'Voice note — root cause' : 'Voice note'}
        </button>
      )}
      {state === 'recording' && <span className="text-[11px] text-text-faint">Speak now — up to 30s. Audio is transcribed, not stored.</span>}
      {err && <span className="text-[11px] text-err">{err}</span>}
    </div>
  )
}

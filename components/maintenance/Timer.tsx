'use client'

// components/maintenance/Timer.tsx
// Live elapsed-time counter, restyled with tokens (text-warn, mono).
// Subtracts accumulated paused time (pauseMs); when pausedAt is set the clock
// freezes at the moment of pausing (technician pulled to a breakdown).

import { useState, useEffect } from 'react'

export function Timer({ start, pauseMs = 0, pausedAt = null }: { start: string | null; pauseMs?: number; pausedAt?: string | null }) {
  const [, setTick] = useState(0)
  const paused = !!pausedAt
  useEffect(() => {
    if (!start || paused) return
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [start, paused])
  const ref = paused ? new Date(pausedAt!).getTime() : Date.now()
  const e = start ? Math.max(0, Math.floor((ref - new Date(start).getTime() - (pauseMs || 0)) / 1000)) : 0
  const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), s = e % 60
  return (
    <div className={`text-2xl font-bold tabular-nums font-mono ${paused ? 'text-text-faint' : 'text-warn'}`}>
      {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      {paused && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted align-middle">Paused</span>}
    </div>
  )
}

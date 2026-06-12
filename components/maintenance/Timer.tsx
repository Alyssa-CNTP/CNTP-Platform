'use client'

// components/maintenance/Timer.tsx
// Live elapsed-time counter, restyled with tokens (text-warn, mono).

import { useState, useEffect } from 'react'

export function Timer({ start }: { start: string | null }) {
  const [e, setE] = useState(0)
  useEffect(() => {
    if (!start) return
    const tick = () => setE(Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [start])
  const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), s = e % 60
  return (
    <div className="text-2xl font-bold tabular-nums font-mono text-warn">
      {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </div>
  )
}

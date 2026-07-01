'use client'

// components/production/EnergyTotals.tsx
// Lightweight solar + grid totals strip for the production dashboard.
// Two stat tiles only — no charts, no Recharts.

import { useEffect, useState } from 'react'
import { Sun, Zap } from 'lucide-react'

interface EnergySnap {
  solar_kwh: number
  grid_kwh: number
  unit: string
}

export function EnergyTotals() {
  const [data, setData] = useState<EnergySnap | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/maintenance/energy')
        if (res.ok) {
          const json = await res.json()
          setData({ solar_kwh: json.solar_kwh, grid_kwh: json.grid_kwh, unit: json.unit ?? 'kWh' })
        }
      } catch { /* best-effort */ }
      setLoading(false)
    }
    load()
    const id = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const pct = data && (data.solar_kwh + data.grid_kwh > 0)
    ? Math.round((data.solar_kwh / (data.solar_kwh + data.grid_kwh)) * 100)
    : null
  const unit = data?.unit ?? 'kWh'

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Solar */}
      <div className="rounded-xl border border-amber-200/40 bg-amber-50/30 dark:border-amber-400/20 dark:bg-amber-400/5 p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0">
          <Sun size={16} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/70 dark:text-amber-400/70">Solar today</div>
          <div className={`text-[18px] font-bold tabular-nums leading-tight ${loading ? 'animate-pulse text-amber-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {data ? <>{data.solar_kwh.toFixed(1)} <span className="text-[11px] font-normal">{unit}</span></> : '—'}
          </div>
          {pct !== null && <div className="text-[10px] text-amber-600/60 dark:text-amber-400/60">{pct}% of consumption</div>}
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-blue-200/40 bg-blue-50/30 dark:border-blue-400/20 dark:bg-blue-400/5 p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
          <Zap size={16} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700/70 dark:text-blue-400/70">Grid today</div>
          <div className={`text-[18px] font-bold tabular-nums leading-tight ${loading ? 'animate-pulse text-blue-300' : 'text-blue-700 dark:text-blue-300'}`}>
            {data ? <>{data.grid_kwh.toFixed(1)} <span className="text-[11px] font-normal">{unit}</span></> : '—'}
          </div>
          {pct !== null && <div className="text-[10px] text-blue-600/60 dark:text-blue-400/60">{100 - pct}% of consumption</div>}
        </div>
      </div>
    </div>
  )
}

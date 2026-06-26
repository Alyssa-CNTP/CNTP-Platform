'use client'

// components/production/WeatherTile.tsx
// Factory weather for the production dashboard — live from Open-Meteo via
// /api/weather (no API key). Production planning is weather-sensitive (drying,
// outdoor movement), so the manager sees today's conditions + a short forecast.

import { useEffect, useState } from 'react'
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog,
  Droplets, Wind, MapPin,
} from 'lucide-react'

interface Day { date: string; max: number; min: number; rainPct: number; label: string; icon: string }
interface Weather {
  location: string
  current: { temp: number; feelsLike: number; humidity: number; wind: number; precip: number; label: string; icon: string }
  forecast: Day[]
}

const ICON: Record<string, typeof Sun> = {
  sun: Sun, cloud: Cloud, rain: CloudRain, snow: CloudSnow, storm: CloudLightning, fog: CloudFog,
}
function Glyph({ icon, size = 18, className = '' }: { icon: string; size?: number; className?: string }) {
  const C = ICON[icon] ?? Cloud
  return <C size={size} className={className} />
}

export function WeatherTile() {
  const [w, setW] = useState<Weather | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/weather')
      .then(r => r.json())
      .then(j => { if (!alive) return; j.error ? setError(j.error) : setW(j) })
      .catch(() => alive && setError('Weather unavailable'))
    return () => { alive = false }
  }, [])

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <MapPin size={13} className="text-text-muted" />
        <span className="text-[11px] uppercase tracking-wider text-text-muted">{w?.location ?? 'Factory weather'}</span>
      </div>

      {error && <div className="text-[12px] text-text-faint py-3">{error}</div>}
      {!w && !error && <div className="text-[12px] text-text-faint py-3">Loading weather…</div>}

      {w && (
        <>
          <div className="flex items-center gap-3">
            <Glyph icon={w.current.icon} size={40} className="text-brand" />
            <div>
              <div className="text-[30px] leading-none font-semibold text-text tabular-nums">{w.current.temp}°</div>
              <div className="text-[12px] text-text-muted">{w.current.label} · feels {w.current.feelsLike}°</div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-3 text-[12px] text-text-muted">
            <span className="inline-flex items-center gap-1"><Droplets size={13} /> {w.current.humidity}%</span>
            <span className="inline-flex items-center gap-1"><Wind size={13} /> {w.current.wind} km/h</span>
          </div>

          {w.forecast.length > 1 && (
            <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-surface-rule">
              {w.forecast.slice(0, 3).map((d, i) => (
                <div key={d.date} className="text-center">
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">
                    {i === 0 ? 'Today' : new Date(d.date).toLocaleDateString('en-ZA', { weekday: 'short' })}
                  </div>
                  <Glyph icon={d.icon} size={18} className="text-text-muted mx-auto my-1" />
                  <div className="text-[12px] text-text tabular-nums">{d.max}° <span className="text-text-faint">{d.min}°</span></div>
                  <div className="text-[10px] text-info inline-flex items-center gap-0.5 justify-center"><Droplets size={9} /> {d.rainPct}%</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

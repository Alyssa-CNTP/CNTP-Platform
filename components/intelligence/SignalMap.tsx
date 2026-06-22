'use client'

// components/intelligence/SignalMap.tsx
// World-map visualisation for the Signal Engine. Renders each region with
// signals as a pulsing pin, coloured by its dominant classification. Hovering
// a pin reveals a tooltip with a per-classification breakdown; clicking syncs
// the parent's selectedRegion. A continent summary bar sits below the map.
//
// Imported dynamically (ssr:false) from app/(app)/intelligence/page.tsx because
// react-simple-maps relies on browser-side SVG sizing.

import { useMemo, useState, useCallback, useRef } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from 'react-simple-maps'
import type { Signal, Classification } from './types'
import { regionFlag } from './helpers'

// ─── Region geo + meta ───────────────────────────────────────────────────────
const REGION_COORDS: Record<string, { lat: number; lng: number; name: string; continent: string }> = {
  ZA:     { lat: -30.5595, lng:  22.9375, name: 'South Africa',   continent: 'Africa'   },
  DE:     { lat:  51.1657, lng:  10.4515, name: 'Germany',        continent: 'Europe'   },
  JP:     { lat:  36.2048, lng: 138.2529, name: 'Japan',          continent: 'Asia'     },
  KR:     { lat:  35.9078, lng: 127.7669, name: 'South Korea',    continent: 'Asia'     },
  CN:     { lat:  35.8617, lng: 104.1954, name: 'China',          continent: 'Asia'     },
  US:     { lat:  37.0902, lng: -95.7129, name: 'United States',  continent: 'Americas' },
  GB:     { lat:  55.3781, lng:  -3.4360, name: 'United Kingdom', continent: 'Europe'   },
  AU:     { lat: -25.2744, lng: 133.7751, name: 'Australia',      continent: 'Oceania'  },
  IN:     { lat:  20.5937, lng:  78.9629, name: 'India',          continent: 'Asia'     },
  BR:     { lat: -14.2350, lng: -51.9253, name: 'Brazil',         continent: 'Americas' },
  NL:     { lat:  52.1326, lng:   5.2913, name: 'Netherlands',    continent: 'Europe'   },
  FR:     { lat:  46.2276, lng:   2.2137, name: 'France',         continent: 'Europe'   },
  ES:     { lat:  40.4637, lng:  -3.7492, name: 'Spain',          continent: 'Europe'   },
  IT:     { lat:  41.8719, lng:  12.5674, name: 'Italy',          continent: 'Europe'   },
  PL:     { lat:  51.9194, lng:  19.1451, name: 'Poland',         continent: 'Europe'   },
  CA:     { lat:  56.1304, lng:-106.3468, name: 'Canada',         continent: 'Americas' },
  MX:     { lat:  23.6345, lng:-102.5528, name: 'Mexico',         continent: 'Americas' },
  NG:     { lat:   9.0820, lng:   8.6753, name: 'Nigeria',        continent: 'Africa'   },
  KE:     { lat:  -0.0236, lng:  37.9062, name: 'Kenya',          continent: 'Africa'   },
  // GLOBAL sits in the Atlantic so it doesn't overlap any country pin
  GLOBAL: { lat:  20,      lng: -20,      name: 'Global',         continent: 'Global'   },
}

const CLASSIFICATION_HEX: Record<Classification, string> = {
  opportunity:  '#15803D',
  threat:       '#B91C1C',
  competitor:   '#C2410C',
  regulation:   '#1D4ED8',
  relationship: '#2E7D32',
  neutral:      '#78716C',
}

const CONTINENTS = ['Africa', 'Europe', 'Asia', 'Americas', 'Oceania', 'Global'] as const
type Continent = typeof CONTINENTS[number]

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// SVG viewBox — picks a comfortable world aspect for geoEqualEarth
const MAP_W = 980
const MAP_H = 460

// ─── Props ───────────────────────────────────────────────────────────────────
interface SignalMapProps {
  signals:        Signal[]
  selectedRegion: string | null
  onRegionSelect: (region: string | null) => void
}

// ─── Per-region rollup ───────────────────────────────────────────────────────
interface RegionRollup {
  code:        string
  name:        string
  continent:   string
  lat:         number
  lng:         number
  total:       number
  byClass:     Record<Classification, number>
  dominant:    Classification
}

function rollUp(signals: Signal[]): RegionRollup[] {
  const map = new Map<string, RegionRollup>()
  for (const s of signals) {
    if (!s.region) continue
    const code = s.region.toUpperCase()
    const meta = REGION_COORDS[code]
    if (!meta) continue
    let r = map.get(code)
    if (!r) {
      r = {
        code,
        name:      meta.name,
        continent: meta.continent,
        lat:       meta.lat,
        lng:       meta.lng,
        total:     0,
        byClass:   {
          opportunity:0, threat:0, competitor:0, regulation:0, relationship:0, neutral:0,
        },
        dominant:  'neutral',
      }
      map.set(code, r)
    }
    r.total += 1
    r.byClass[s.classification] = (r.byClass[s.classification] ?? 0) + 1
  }
  // Pick dominant classification per region
  for (const r of map.values()) {
    let best: Classification = 'neutral'
    let bestN = -1
    ;(Object.keys(r.byClass) as Classification[]).forEach(c => {
      if (r.byClass[c] > bestN) { best = c; bestN = r.byClass[c] }
    })
    r.dominant = best
  }
  return Array.from(map.values())
}

function pinColor(dom: Classification): string {
  if (dom === 'opportunity') return CLASSIFICATION_HEX.opportunity
  if (dom === 'threat')      return CLASSIFICATION_HEX.threat
  if (dom === 'competitor')  return CLASSIFICATION_HEX.competitor
  return '#2E7D32' // accent fallback
}

function pinRadius(total: number): number {
  if (total >= 16) return 11
  if (total >= 6)  return 8
  return 5.5
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SignalMap({ signals, selectedRegion, onRegionSelect }: SignalMapProps) {
  const rollups = useMemo(() => rollUp(signals), [signals])

  // Continent totals — for the chip row + highlighting
  const continentRollup = useMemo(() => {
    const totals: Record<Continent, { count: number; byClass: Record<Classification, number> }> =
      Object.fromEntries(CONTINENTS.map(c => [c, { count: 0, byClass: {
        opportunity:0, threat:0, competitor:0, regulation:0, relationship:0, neutral:0,
      } }])) as any
    for (const r of rollups) {
      const k = (r.continent as Continent)
      if (!totals[k]) continue
      totals[k].count += r.total
      ;(Object.keys(r.byClass) as Classification[]).forEach(c => {
        totals[k].byClass[c] += r.byClass[c]
      })
    }
    return totals
  }, [rollups])

  const [hover,            setHover]            = useState<{ region: RegionRollup; x: number; y: number } | null>(null)
  const [activeContinent,  setActiveContinent]  = useState<Continent | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Click handlers
  const handlePinClick = useCallback((code: string) => {
    onRegionSelect(selectedRegion === code ? null : code)
  }, [onRegionSelect, selectedRegion])

  const handleBackgroundClick = useCallback(() => {
    if (selectedRegion) onRegionSelect(null)
  }, [onRegionSelect, selectedRegion])

  const toggleContinent = (c: Continent) => {
    setActiveContinent(prev => prev === c ? null : c)
  }

  return (
    <div className="relative" ref={containerRef}>
      <style jsx>{`
        @keyframes signalmap-pulse {
          0%   { transform: scale(1);   opacity: 0.55; }
          80%  { transform: scale(2.6); opacity: 0;    }
          100% { transform: scale(2.6); opacity: 0;    }
        }
        @keyframes signalmap-pulse-slow {
          0%   { transform: scale(1);   opacity: 0.4; }
          80%  { transform: scale(2.2); opacity: 0;   }
          100% { transform: scale(2.2); opacity: 0;   }
        }
        .pulse-ring {
          transform-origin: center;
          transform-box: fill-box;
          animation: signalmap-pulse 2.4s ease-out infinite;
        }
        .pulse-ring-slow {
          transform-origin: center;
          transform-box: fill-box;
          animation: signalmap-pulse-slow 3.2s ease-out infinite;
          animation-delay: 0.4s;
        }
      `}</style>

      {/* Map surface */}
      <div
        className="rounded-xl border overflow-hidden relative"
        style={{
          background:   '#0D1F0D',
          borderColor:  'var(--color-surface-rule)',
          height:        420,
          width:        '100%',
        }}
        onClick={handleBackgroundClick}
      >
        <ComposableMap
          projection="geoEqualEarth"
          width={MAP_W}
          height={MAP_H}
          projectionConfig={{ scale: 165 }}
          style={{ width: '100%', height: '100%' }}
        >
          {/* Continents */}
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo: any) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  style={{
                    default: {
                      fill:   '#162B16',
                      stroke: '#1A3A1A',
                      strokeWidth: 0.5,
                      outline: 'none',
                    },
                    hover: {
                      fill:   '#1A3A1A',
                      stroke: '#264f26',
                      strokeWidth: 0.5,
                      outline: 'none',
                    },
                    pressed: {
                      fill:   '#162B16',
                      outline: 'none',
                    },
                  }}
                />
              ))
            }
          </Geographies>

          {/* Pins */}
          {rollups.map(r => {
            const color    = pinColor(r.dominant)
            const radius   = pinRadius(r.total)
            const selected = selectedRegion === r.code
            const dimmed   = activeContinent !== null && r.continent !== activeContinent

            return (
              <Marker
                key={r.code}
                coordinates={[r.lng, r.lat]}
                onMouseEnter={(e: any) => {
                  // Use the SVG marker's screen position to place tooltip
                  const rect = containerRef.current?.getBoundingClientRect()
                  if (!rect) return
                  setHover({
                    region: r,
                    x: (e.clientX ?? 0) - rect.left,
                    y: (e.clientY ?? 0) - rect.top,
                  })
                }}
                onMouseMove={(e: any) => {
                  const rect = containerRef.current?.getBoundingClientRect()
                  if (!rect) return
                  setHover(prev => prev ? {
                    ...prev,
                    x: (e.clientX ?? 0) - rect.left,
                    y: (e.clientY ?? 0) - rect.top,
                  } : prev)
                }}
                onMouseLeave={() => setHover(null)}
                onClick={(e: any) => {
                  e.stopPropagation()
                  handlePinClick(r.code)
                }}
                style={{
                  default: { cursor: 'pointer', outline: 'none' },
                  hover:   { cursor: 'pointer', outline: 'none' },
                  pressed: { cursor: 'pointer', outline: 'none' },
                }}
              >
                <g opacity={dimmed ? 0.25 : 1} style={{ transition: 'opacity 200ms ease' }}>
                  {/* Pulse rings */}
                  <circle r={radius} fill={color} className="pulse-ring" />
                  <circle r={radius} fill={color} className="pulse-ring-slow" />
                  {/* Core */}
                  <circle
                    r={radius}
                    fill={color}
                    stroke={selected ? '#FFFFFF' : 'rgba(255,255,255,0.35)'}
                    strokeWidth={selected ? 2 : 1}
                    style={{
                      filter: `drop-shadow(0 0 6px ${color}aa)`,
                    }}
                  />
                  {/* Inner highlight dot */}
                  <circle r={Math.max(1, radius * 0.35)} fill="rgba(255,255,255,0.85)" />
                </g>
              </Marker>
            )
          })}
        </ComposableMap>

        {/* Tooltip */}
        {hover && (
          <MapTooltip
            region={hover.region}
            x={hover.x}
            y={hover.y}
            containerWidth={containerRef.current?.clientWidth ?? MAP_W}
          />
        )}

        {/* Empty state overlay */}
        {rollups.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            <span className="font-mono text-[11px] uppercase tracking-wider">
              No regional signals to plot
            </span>
          </div>
        )}

        {/* Selected region readout (bottom-left chip) */}
        {selectedRegion && (
          <div
            className="absolute bottom-3 left-3 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md"
            style={{
              background:  'rgba(13,31,13,0.85)',
              border:      '1px solid rgba(255,255,255,0.15)',
              backdropFilter: 'blur(6px)',
              color:       '#fff',
            }}
            onClick={e => e.stopPropagation()}
          >
            <span className="text-[14px] leading-none">{regionFlag(selectedRegion)}</span>
            <span className="font-display text-[12px] font-semibold tracking-tight">
              {REGION_COORDS[selectedRegion]?.name ?? selectedRegion}
            </span>
            <button
              onClick={() => onRegionSelect(null)}
              className="ml-1 text-[10px] font-mono uppercase tracking-wider opacity-70 hover:opacity-100"
              aria-label="Clear region filter"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {/* Continent summary chips */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {CONTINENTS.map(c => {
          const t = continentRollup[c]
          const dominant: Classification = (Object.keys(t.byClass) as Classification[])
            .reduce<Classification>((best, k) => t.byClass[k] > t.byClass[best] ? k : best, 'neutral')
          const active = activeContinent === c
          const empty  = t.count === 0
          return (
            <button
              key={c}
              onClick={() => !empty && toggleContinent(c)}
              disabled={empty}
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[11px] font-mono uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: active ? 'var(--color-brand)' : 'var(--color-surface-card)',
                color:      active ? '#fff' : 'var(--color-text)',
                borderColor: active ? 'var(--color-brand)' : 'var(--color-surface-rule)',
              }}
            >
              <span
                className="inline-block rounded-full"
                style={{
                  width:  6,
                  height: 6,
                  background: empty ? 'var(--color-text-faint)' : CLASSIFICATION_HEX[dominant],
                  boxShadow:  empty ? 'none' : `0 0 6px ${CLASSIFICATION_HEX[dominant]}80`,
                }}
              />
              <span>{c}</span>
              <span
                className="rounded px-1 py-0.5 text-[10px]"
                style={{
                  background: active ? 'rgba(255,255,255,0.15)' : 'var(--color-surface)',
                  color:      active ? 'rgba(255,255,255,0.85)' : 'var(--color-text-muted)',
                }}
              >
                {t.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function MapTooltip({
  region, x, y, containerWidth,
}: {
  region:         RegionRollup
  x:              number
  y:              number
  containerWidth: number
}) {
  const flipLeft = x > containerWidth / 2
  const breakdown = (Object.keys(region.byClass) as Classification[])
    .filter(c => region.byClass[c] > 0)
    .sort((a, b) => region.byClass[b] - region.byClass[a])

  return (
    <div
      className="absolute pointer-events-none z-10"
      style={{
        left:      flipLeft ? undefined : x + 14,
        right:     flipLeft ? (containerWidth - x) + 14 : undefined,
        top:       y + 12,
        maxWidth:  240,
        minWidth:  180,
        background: 'rgba(13,31,13,0.96)',
        border:     '1px solid rgba(255,255,255,0.12)',
        boxShadow:  '0 12px 30px rgba(0,0,0,0.45)',
        borderRadius: 10,
        padding:    '10px 12px',
        color:      '#fff',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[15px] leading-none">{regionFlag(region.code)}</span>
        <span className="font-display font-semibold text-[13px] tracking-tight">
          {region.name}
        </span>
        <span
          className="ml-auto font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' }}
        >
          {region.code}
        </span>
      </div>
      <div className="font-display font-bold text-[20px] leading-none mb-2">
        {region.total}
        <span className="font-mono text-[10px] text-white/55 ml-1.5 uppercase tracking-wider">
          {region.total === 1 ? 'signal' : 'signals'}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {breakdown.map(c => (
          <div key={c} className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-block rounded-full"
              style={{
                width:  6,
                height: 6,
                background: CLASSIFICATION_HEX[c],
              }}
            />
            <span className="capitalize text-white/85">{c}</span>
            <span className="ml-auto font-mono text-white/70">{region.byClass[c]}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-white/10 font-mono text-[9.5px] uppercase tracking-wider text-white/45">
        Click pin to filter feed
      </div>
    </div>
  )
}

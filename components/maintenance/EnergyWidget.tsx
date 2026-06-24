'use client'

// components/maintenance/EnergyWidget.tsx
// Energy dashboard with two views:
//  • Today   — hourly usage + solar production charts (Recharts) and a Sources
//              breakdown table, pulled live from Home Assistant every 5 min via
//              /api/maintenance/energy.
//  • History — daily usage over time from Supabase (see EnergyHistory).

import { useEffect, useState, useCallback } from 'react'
import { Activity, RefreshCw, AlertCircle } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { EnergyHistory } from './EnergyHistory'

interface EnergyData {
  solar_kwh:         number
  grid_kwh:          number
  total_kwh:         number
  grid_export_kwh:   number
  generator_kwh:     number
  bat_charge_kwh:    number
  bat_discharge_kwh: number
  unit:              string
  last_updated:      string
  hourly: { solar: number[]; grid: number[]; load: number[] }
}

const REFRESH_MS = 5 * 60 * 1000

// Build the 24-slot chart payload
function buildChartRows(hourly: EnergyData['hourly']) {
  return Array.from({ length: 24 }, (_, h) => {
    const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
    return {
      hour: label,
      solar: hourly.solar[h] ?? 0,
      grid:  hourly.grid[h]  ?? 0,
      load:  hourly.load[h]  ?? 0,
    }
  }).filter(r => r.load > 0 || r.solar > 0 || r.grid > 0 || r.hour === '12 AM')
}

function SourceRow({ color, label, value, unit, bold }: {
  color?: string; label: string; value: number; unit: string; bold?: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-2 border-b border-surface-rule last:border-0 ${bold ? 'font-semibold' : ''}`}>
      <div className="flex items-center gap-2">
        {color && <span className="inline-block w-5 h-4 rounded-sm shrink-0" style={{ background: color }} />}
        {!color && <span className="inline-block w-5 h-4 shrink-0" />}
        <span className={`text-[13px] ${bold ? 'text-text' : 'text-text-muted'}`}>{label}</span>
      </div>
      <span className={`text-[13px] tabular-nums ${bold ? 'text-text' : 'text-text-muted'}`}>
        {value >= 0 ? '' : '−'}{Math.abs(value).toFixed(2)} {unit}
      </span>
    </div>
  )
}

const CHART_STYLE = {
  solar: '#d97706',
  grid:  '#3b82f6',
  load:  '#8b5cf6',
  bat:   '#10b981',
  gen:   '#ef4444',
}

export function EnergyWidget() {
  const [view, setView]           = useState<'today' | 'history'>('today')
  const [data, setData]           = useState<EnergyData | null>(null)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/maintenance/energy')
      const json = await res.json()
      if (!res.ok) { setError(json?.error ?? 'Could not load energy data'); setData(null) }
      else         { setData(json); setError('') }
    } catch {
      setError('Network error — check connection')
    } finally {
      setLoading(false)
      setLastFetch(new Date())
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const fmt = (d: Date) => d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })

  const chartRows = data ? buildChartRows(data.hourly) : []
  const unit      = data?.unit ?? 'kWh'
  const isSetup   = error.includes('HOMEASSISTANT_TOKEN')

  return (
    <div className="card p-4 space-y-5">
      {/* Header + view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-text-muted" />
          <span className="text-sm font-semibold text-text">Energy</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-surface-rule overflow-hidden">
            {(['today', 'history'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2.5 py-1 text-[11px] font-medium capitalize transition ${view === v ? 'bg-surface-dim text-text' : 'text-text-muted hover:bg-surface-dim/50'}`}>
                {v}
              </button>
            ))}
          </div>
          {view === 'today' && (
            <>
              {lastFetch && <span className="text-[10px] text-text-faint">Updated {fmt(lastFetch)}</span>}
              <button onClick={load} disabled={loading} title="Refresh"
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:bg-surface-dim transition disabled:opacity-50">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* History view */}
      {view === 'history' && <EnergyHistory />}

      {/* Today view — setup / error notice */}
      {view === 'today' && error && (
        <div className="rounded-lg bg-warn/10 border border-warn/20 p-3 text-[12px] text-warn flex gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            {isSetup ? (
              <>
                Home Assistant not connected.{' '}
                <a href="https://capenaturalteaproducts.invertermon.com" target="_blank" rel="noreferrer"
                  className="underline">Open HA</a>{' '}
                → Profile → Long-lived access tokens → Create token → set as{' '}
                <code className="font-mono bg-warn/10 px-1 rounded">HOMEASSISTANT_TOKEN</code> env var.
              </>
            ) : error}
          </span>
        </div>
      )}

      {/* Today view — data */}
      {view === 'today' && !error && (
        <>
          {loading && !data && (
            <div className="text-[12px] text-text-faint py-4 text-center">Fetching energy data…</div>
          )}

          {data && (
            <>
              {/* Electricity usage chart */}
              {chartRows.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Electricity Usage</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={chartRows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barSize={14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} axisLine={false} unit=" kWh" />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface-card, #1a1a1a)', border: '1px solid var(--color-surface-rule, #333)', borderRadius: 8, fontSize: 11 }}
                        formatter={(v: unknown, name: unknown) => [`${(v as number).toFixed(1)} kWh`, name as string]}
                      />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="solar" name="Solar" stackId="a" fill={CHART_STYLE.solar} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="grid"  name="Grid"  stackId="a" fill={CHART_STYLE.grid}  radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Solar production chart */}
              {chartRows.some(r => r.solar > 0) && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Solar Production</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={chartRows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barSize={14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} axisLine={false} unit=" kWh" />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface-card, #1a1a1a)', border: '1px solid var(--color-surface-rule, #333)', borderRadius: 8, fontSize: 11 }}
                        formatter={(v: unknown) => [`${(v as number).toFixed(1)} kWh`, 'Solar']}
                      />
                      <Bar dataKey="solar" name="Solar" fill={CHART_STYLE.solar} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Sources table */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Sources</p>
                <div className="rounded-lg border border-surface-rule bg-surface-dim px-3 py-1">
                  <div className="flex items-center justify-between py-1.5 border-b border-surface-rule">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">Source</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">Energy</span>
                  </div>
                  <SourceRow color={CHART_STYLE.solar} label="PV Energy"               value={data.solar_kwh}         unit={unit} />
                  <SourceRow                            label="Solar total"              value={data.solar_kwh}         unit={unit} bold />
                  <SourceRow color={CHART_STYLE.bat}   label="Battery Discharge Energy" value={data.bat_discharge_kwh} unit={unit} />
                  <SourceRow color="#e11d48"            label="Battery Charge Energy"    value={-data.bat_charge_kwh}   unit={unit} />
                  <SourceRow                            label="Battery total"            value={data.bat_discharge_kwh - data.bat_charge_kwh} unit={unit} bold />
                  <SourceRow color={CHART_STYLE.grid}  label="Daily Grid Intake"        value={data.grid_kwh}          unit={unit} />
                  <SourceRow color="#a78bfa"            label="Daily Grid Feedback"      value={-data.grid_export_kwh}  unit={unit} />
                  <SourceRow                            label="Grid total"               value={data.grid_kwh - data.grid_export_kwh} unit={unit} bold />
                  {data.generator_kwh > 0 && (
                    <>
                      <SourceRow color={CHART_STYLE.gen} label="Generator" value={data.generator_kwh} unit={unit} />
                      <SourceRow label="Generator total" value={data.generator_kwh} unit={unit} bold />
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

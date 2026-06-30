'use client'

// components/maintenance/EnergyHistory.tsx
// Historical daily energy usage from maintenance.energy_daily (Supabase), pulled
// via /api/maintenance/energy/history. Two charts — Electricity Usage (grid
// imported + total consumed) and Solar Usage (PV produced) — over a selectable
// window, plus period totals. Rendered inside EnergyWidget's "History" tab.

import { useEffect, useState, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

interface DayRow {
  day:                   string
  solar_kwh:             number
  grid_import_kwh:       number
  grid_export_kwh:       number
  generator_kwh:         number
  battery_charge_kwh:    number
  battery_discharge_kwh: number
  total_kwh:             number
  unit:                  string
}

const RANGES = [7, 30, 90] as const
const COLORS = { solar: '#d97706', grid: '#3b82f6', total: '#8b5cf6' }

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-card, #1a1a1a)',
  border: '1px solid var(--color-surface-rule, #333)',
  borderRadius: 8,
  fontSize: 11,
}

function Stat({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="rounded-lg border border-surface-rule bg-surface-dim px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{label}</span>
      </div>
      <div className="text-[15px] font-semibold text-text tabular-nums mt-0.5">{value.toFixed(1)} <span className="text-[11px] font-normal text-text-muted">{unit}</span></div>
    </div>
  )
}

export function EnergyHistory() {
  const [days, setDays]       = useState<number>(30)
  const [from, setFrom]       = useState('')   // custom range (overrides days when set)
  const [to, setTo]           = useState('')
  const [rows, setRows]       = useState<DayRow[]>([])
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (d: number, f: string, t: string) => {
    setLoading(true)
    try {
      const qs = (f || t) ? `from=${f}&to=${t}` : `days=${d}`
      const res  = await fetch(`/api/maintenance/energy/history?${qs}`)
      const json = await res.json()
      if (!res.ok) { setError(json?.error ?? 'Could not load energy history'); setRows([]) }
      else         { setRows(json.days ?? []); setError('') }
    } catch {
      setError('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(days, from, to) }, [days, from, to, load])
  const customActive = !!(from || to)

  const fmtDay = (s: string) =>
    new Date(`${s}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })

  const chartRows = rows.map(r => ({
    day:   fmtDay(r.day),
    solar: r.solar_kwh,
    grid:  r.grid_import_kwh,
    total: r.total_kwh,
  }))

  const unit = rows[0]?.unit ?? 'kWh'
  const sum  = (k: 'solar_kwh' | 'grid_import_kwh' | 'total_kwh') =>
    rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)

  return (
    <div className="space-y-5">
      {/* Range selector — quick windows + a custom date range */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[11px] text-text-faint">{rows.length} day{rows.length === 1 ? '' : 's'} recorded</span>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-surface-rule overflow-hidden">
            {RANGES.map(r => (
              <button key={r} onClick={() => { setFrom(''); setTo(''); setDays(r) }}
                className={`px-2.5 py-1 text-[11px] font-medium transition ${!customActive && days === r ? 'bg-surface-dim text-text' : 'text-text-muted hover:bg-surface-dim/50'}`}>
                {r}d
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-text-muted">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From"
              className="rounded-md border border-surface-rule bg-surface-card px-2 py-1 text-[11px] text-text" />
            <span>–</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To"
              className="rounded-md border border-surface-rule bg-surface-card px-2 py-1 text-[11px] text-text" />
            {customActive && <button onClick={() => { setFrom(''); setTo('') }} className="text-text-muted hover:text-text underline">Clear</button>}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-warn/10 border border-warn/20 p-3 text-[12px] text-warn flex gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="text-[12px] text-text-faint py-4 text-center">Loading history…</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="text-[12px] text-text-faint py-6 text-center">
          No history captured yet. Daily usage is recorded each time the Energy widget loads — check back tomorrow.
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* Period totals */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Solar"     value={sum('solar_kwh')}       unit={unit} color={COLORS.solar} />
            <Stat label="Grid in"   value={sum('grid_import_kwh')} unit={unit} color={COLORS.grid} />
            <Stat label="Consumed"  value={sum('total_kwh')}       unit={unit} color={COLORS.total} />
          </div>

          {/* Electricity usage — grid imported vs total consumed, per day */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Electricity Usage — daily</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartRows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barSize={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} axisLine={false} unit=" kWh" />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: unknown, n: unknown) => [`${(v as number).toFixed(1)} kWh`, n as string]} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="grid"  name="Grid imported"  fill={COLORS.grid}  radius={[2, 2, 0, 0]} />
                <Bar dataKey="total" name="Total consumed" fill={COLORS.total} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Solar usage — PV produced, per day */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">Solar Usage — daily</p>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={chartRows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barSize={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-faint, #888)' }} tickLine={false} axisLine={false} unit=" kWh" />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: unknown) => [`${(v as number).toFixed(1)} kWh`, 'Solar']} />
                <Bar dataKey="solar" name="Solar produced" fill={COLORS.solar} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}

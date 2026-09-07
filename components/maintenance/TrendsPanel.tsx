'use client'

// components/maintenance/TrendsPanel.tsx
// Utility trend graphs (water, IP/paraffin, generator diesel, compressor run-hrs)
// surfaced on the maintenance dashboard. Capture of the underlying readings lives
// in Scheduled → Readings; this is the at-a-glance trend view. Points are
// clickable to read the exact date + value.

import { useState } from 'react'
import { useMaintenanceContext } from '@/app/(app)/maintenance/layout'
import { Spark } from './Spark'
import { fmtD } from '@/lib/maintenance/helpers'
import { ServiceCard } from './ServiceCard'

const LB = 'text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] mb-1 block'
const WINDOWS: [string, number][] = [['8w', 8], ['Quarter', 13], ['6 months', 26], ['Year', 52]]

export function TrendsPanel() {
  const { loading, data, derived } = useMaintenanceContext()
  const { waterReadings } = data
  const { waterUsage, ipUsage, compressorService, generatorService } = derived
  const [weeks, setWeeks] = useState(26)

  if (loading) return null

  const lastDate = (arr: { reading_date: string }[]) => fmtD(arr[arr.length - 1]?.reading_date ?? null)

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Utilities &amp; trends</h2>
          <p className="text-[11px] text-text-muted">Water &amp; paraffin usage, plus compressor and generator service status. Tap a point for its value. Readings captured on the weekly checklists feed straight in.</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-text-muted">Window:</span>
          {WINDOWS.map(([l, n]) => (
            <button key={n} onClick={() => setWeeks(n)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${weeks === n ? 'bg-brand text-white' : 'bg-surface-dim text-text-muted hover:text-text'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <div className={LB}>Main meter weekly usage (kL)</div>
          <Spark pts={waterUsage.main.slice(-weeks)} color="#2563eb" unit="kL"
            labels={[lastDate(waterReadings.slice(0, Math.max(1, waterReadings.length - weeks) + 1)), lastDate(waterReadings)]} />
        </div>
        <div>
          <div className={LB}>Boiler weekly usage (kL)</div>
          <Spark pts={waterUsage.boiler.slice(-weeks)} color="#0891b2" unit="kL" />
        </div>
        <div>
          <div className={LB}>IP (paraffin) usage (L)</div>
          <Spark pts={ipUsage.slice(-weeks)} color="#d97706" unit="L" digits={0} />
        </div>
        {/* Compressor and generator are service-status, not trends — the useful
            question is "how many hours since the last service and when is the
            next one due", which a sparkline never answered. */}
        {compressorService && <div><div className={LB}>Compressor service</div><ServiceCard s={compressorService} /></div>}
        {generatorService && <div><div className={LB}>Generator service</div><ServiceCard s={generatorService} /></div>}
      </div>
    </div>
  )
}

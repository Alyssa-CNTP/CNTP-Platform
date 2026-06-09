'use client'

// app/(app)/logistics/warehouse/page.tsx
// Warehouse map: aisles → bays → bins. Click a bin to filter units.
// Large warehouse logic: group by aisle, show occupancy density per bin.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { logisticsDb } from '@/lib/logistics/db'
import type { Location, Warehouse, Unit } from '@/lib/logistics/types'
import { LOCATION_TYPE_LABELS } from '@/lib/logistics/types'
import { Loader2, MapPin, Search } from 'lucide-react'

interface BinWithCount extends Location {
  unit_count: number
  total_kg:   number
}

export default function WarehouseMapPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [whId, setWhId]             = useState<string>('')
  const [bins, setBins]             = useState<BinWithCount[]>([])
  const [units, setUnits]           = useState<Unit[]>([])
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null)
  const [search, setSearch]         = useState('')
  const [loading, setLoading]       = useState(true)

  useEffect(() => { void loadWarehouses() }, [])
  useEffect(() => { if (whId) void loadBins(whId) }, [whId])

  async function loadWarehouses() {
    const db = logisticsDb()
    const { data } = await db.from('warehouses').select('*').eq('active', true).order('name')
    const list = (data as Warehouse[]) ?? []
    setWarehouses(list)
    if (list.length && !whId) setWhId(list[0].id)
  }

  async function loadBins(warehouseId: string) {
    setLoading(true)
    try {
      const db = logisticsDb()
      const { data: locs } = await db
        .from('locations').select('*')
        .eq('warehouse_id', warehouseId).eq('active', true).order('code')

      // Count units per location
      const counts = new Map<string, { count: number; kg: number }>()
      const { data: u } = await db
        .from('units')
        .select('current_location_id, weight_kg')
        .eq('status', 'active')
      for (const row of (u ?? []) as any[]) {
        if (!row.current_location_id) continue
        const c = counts.get(row.current_location_id) ?? { count: 0, kg: 0 }
        c.count += 1
        c.kg += Number(row.weight_kg ?? 0)
        counts.set(row.current_location_id, c)
      }

      setBins(((locs as Location[]) ?? []).map(l => ({
        ...l,
        unit_count: counts.get(l.id)?.count ?? 0,
        total_kg:   counts.get(l.id)?.kg ?? 0,
      })))
    } finally {
      setLoading(false)
    }
  }

  // Load units for selected bin
  useEffect(() => {
    if (!selectedBinId) { setUnits([]); return }
    void (async () => {
      const db = logisticsDb()
      const { data } = await db
        .from('units')
        .select('*')
        .eq('current_location_id', selectedBinId)
        .order('arrived_at', { ascending: false })
        .limit(200)
      setUnits((data as Unit[]) ?? [])
    })()
  }, [selectedBinId])

  // Group bins by aisle
  const aisles = useMemo(() => {
    const grouped: Record<string, BinWithCount[]> = {}
    for (const b of bins) {
      const key = b.aisle ?? 'Other'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(b)
    }
    return grouped
  }, [bins])

  const filteredBins = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    return bins.filter(b =>
      b.code.toLowerCase().includes(q) ||
      (b.barcode ?? '').toLowerCase().includes(q) ||
      b.location_type.toLowerCase().includes(q)
    )
  }, [bins, search])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Warehouse map</h1>
          <p className="text-sm text-text-muted mt-1">Live occupancy by aisle and bin. Click a bin to see what's there.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={whId} onChange={e => { setWhId(e.target.value); setSelectedBinId(null) }}
            className="px-3 py-1.5 border border-surface-rule rounded-lg text-sm bg-white">
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <Link href="/logistics/warehouse/units"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-rule bg-white text-sm hover:bg-surface">
            <Search className="w-4 h-4" /> Find unit
          </Link>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter bins by code, barcode, or type"
          className="w-full pl-9 pr-3 py-2 border border-surface-rule rounded-lg text-sm bg-white" />
      </div>

      {loading ? (
        <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
      ) : filteredBins ? (
        <BinGrid bins={filteredBins} selectedId={selectedBinId} onSelect={setSelectedBinId} />
      ) : (
        Object.entries(aisles).map(([aisle, list]) => (
          <div key={aisle} className="mb-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> Aisle {aisle}
            </div>
            <BinGrid bins={list} selectedId={selectedBinId} onSelect={setSelectedBinId} />
          </div>
        ))
      )}

      {/* Selected bin's units */}
      {selectedBinId && (
        <div className="mt-6 rounded-xl border border-surface-rule bg-white p-5">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">
            Units at this location ({units.length})
          </div>
          {units.length === 0 ? (
            <div className="text-sm text-text-muted py-6 text-center">Empty.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="text-left py-1.5">Barcode</th>
                  <th className="text-left">Product</th>
                  <th className="text-left">Variant</th>
                  <th className="text-right">Weight (kg)</th>
                  <th className="text-left">Stage</th>
                  <th className="text-left">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {units.map(u => (
                  <tr key={u.id} className="border-t border-surface-rule">
                    <td className="py-2 font-mono text-xs">
                      <Link href={`/logistics/warehouse/units/${u.id}`} className="hover:underline text-text">{u.barcode}</Link>
                    </td>
                    <td>{u.product_type ?? '—'}</td>
                    <td className="text-text-muted">{u.variant ?? '—'}</td>
                    <td className="text-right tabular-nums">{u.weight_kg ?? '—'}</td>
                    <td className="text-text-muted">{u.current_stage}</td>
                    <td className="text-text-muted text-xs">{new Date(u.arrived_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function BinGrid({ bins, selectedId, onSelect }: {
  bins: BinWithCount[]; selectedId: string | null; onSelect: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {bins.map(b => {
        const isSelected = b.id === selectedId
        const isEmpty    = b.unit_count === 0
        const density    = Math.min(1, b.unit_count / 10) // crude
        return (
          <button
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={`text-left p-3 rounded-lg border transition
              ${isSelected
                ? 'border-text shadow-md ring-2 ring-text/10'
                : isEmpty
                ? 'border-surface-rule bg-surface/40 hover:bg-surface'
                : 'border-surface-rule bg-white hover:border-text/30'}
            `}
            style={{
              backgroundColor: !isSelected && !isEmpty
                ? `rgba(16, 185, 129, ${0.05 + 0.15 * density})`
                : undefined,
            }}
          >
            <div className="font-mono text-xs text-text font-medium">{b.code}</div>
            <div className="text-[10px] text-text-muted">{LOCATION_TYPE_LABELS[b.location_type]}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-base font-semibold tabular-nums">{b.unit_count}</span>
              <span className="text-[10px] text-text-muted">units</span>
            </div>
            {b.total_kg > 0 && (
              <div className="text-[10px] text-text-muted tabular-nums">{b.total_kg.toFixed(0)} kg</div>
            )}
          </button>
        )
      })}
    </div>
  )
}

'use client'

// app/(app)/logistics/warehouse/units/page.tsx
// Searchable/filterable list of every unit in the system.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { logisticsDb } from '@/lib/logistics/db'
import ScanInput from '@/components/logistics/ScanInput'
import type { Unit, Location, Supplier, Customer } from '@/lib/logistics/types'
import { UNIT_STAGE_LABELS, UNIT_STATUS_LABELS } from '@/lib/logistics/types'
import { Loader2, Boxes } from 'lucide-react'

interface UnitFlat extends Unit {
  location_code?:  string | null
  supplier_name?:  string | null
  customer_name?:  string | null
  batch_code?:     string | null
}

export default function UnitsListPage() {
  const router = useRouter()
  const [rows, setRows]         = useState<UnitFlat[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [stage, setStage]       = useState<string>('')
  const [status, setStatus]     = useState<string>('active')

  useEffect(() => { void load() }, [stage, status])

  async function load() {
    setLoading(true)
    try {
      const db = logisticsDb()
      let q = db.from('units').select(`
        *,
        location:current_location_id ( code ),
        supplier:supplier_id ( name ),
        customer:customer_id ( name ),
        batch:batch_id ( batch_code )
      `).order('arrived_at', { ascending: false }).limit(500)
      if (stage)  q = q.eq('current_stage', stage)
      if (status) q = q.eq('status', status)
      const { data } = await q
      setRows(((data as any[]) ?? []).map(u => ({
        ...u,
        location_code: u.location?.code ?? null,
        supplier_name: u.supplier?.name ?? null,
        customer_name: u.customer?.name ?? null,
        batch_code:    u.batch?.batch_code ?? null,
      })))
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(u =>
      u.barcode.toLowerCase().includes(q) ||
      (u.product_type ?? '').toLowerCase().includes(q) ||
      (u.variant ?? '').toLowerCase().includes(q) ||
      (u.location_code ?? '').toLowerCase().includes(q) ||
      (u.supplier_name ?? '').toLowerCase().includes(q) ||
      (u.customer_name ?? '').toLowerCase().includes(q) ||
      (u.batch_code ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  async function onScan(code: string) {
    // Look up by barcode → navigate to detail
    const db = logisticsDb()
    const { data } = await db.from('units').select('id').eq('barcode', code).maybeSingle()
    if (data?.id) router.push(`/logistics/warehouse/units/${data.id}`)
    else          alert(`No unit found with barcode "${code}"`)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold text-text mb-1">Units</h1>
      <p className="text-sm text-text-muted mb-5">Scan a barcode to jump to its detail, or filter by stage/status.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="md:col-span-2">
          <ScanInput
            label="Scan or search"
            placeholder="Scan a barcode or type to filter"
            onScan={onScan}
            autoFocus={false}
            hint="Scan a unit barcode to open it. Type any text to filter the list below."
          />
        </div>
        <div className="flex items-end gap-2">
          <select value={stage} onChange={e => setStage(e.target.value)}
            className="flex-1 px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
            <option value="">All stages</option>
            {Object.entries(UNIT_STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="flex-1 px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
            <option value="">All statuses</option>
            {Object.entries(UNIT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Filter loaded rows (barcode, product, variant, location, supplier, customer, batch)"
        className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white mb-4" />

      <div className="rounded-xl border border-surface-rule bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-text-muted">
            <Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <div className="text-sm">No units match.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[11px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="text-left px-4 py-2.5">Barcode</th>
                  <th className="text-left px-4 py-2.5">Product</th>
                  <th className="text-left px-4 py-2.5">Variant</th>
                  <th className="text-right px-4 py-2.5">kg</th>
                  <th className="text-left px-4 py-2.5">Stage</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Location</th>
                  <th className="text-left px-4 py-2.5">Batch</th>
                  <th className="text-left px-4 py-2.5">Supplier</th>
                  <th className="text-left px-4 py-2.5">Customer</th>
                  <th className="text-left px-4 py-2.5">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} onClick={() => router.push(`/logistics/warehouse/units/${u.id}`)}
                    className="border-t border-surface-rule hover:bg-surface/50 cursor-pointer">
                    <td className="px-4 py-2 font-mono text-xs">{u.barcode}</td>
                    <td className="px-4 py-2">{u.product_type ?? '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{u.variant ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.weight_kg ?? '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{UNIT_STAGE_LABELS[u.current_stage]}</td>
                    <td className="px-4 py-2 text-text-muted">{UNIT_STATUS_LABELS[u.status]}</td>
                    <td className="px-4 py-2 text-text-muted">{u.location_code ?? '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{u.batch_code ?? '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{u.supplier_name ?? '—'}</td>
                    <td className="px-4 py-2 text-text-muted">{u.customer_name ?? '—'}</td>
                    <td className="px-4 py-2 text-text-muted text-xs">{new Date(u.arrived_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

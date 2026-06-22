'use client'

// app/(app)/logistics/receiving/[id]/page.tsx
// GRN detail + scan items into stock. This is the core receiving UI.
//
// Flow:
//   1. Pick a GRN line (product_type/variant)
//   2. Optionally pick a batch (or create one inline — done elsewhere later)
//   3. Pick a location (scan a location barcode OR pick from dropdown)
//   4. Enter weight (USB scale integration future)
//   5. Press Enter / scan → unit row created, label barcode shown, receive_in event logged
//   6. Repeat. Close GRN when done.

import { useEffect, useMemo, useState, use } from 'react'
import Link from 'next/link'
import { logisticsDb } from '@/lib/logistics/db'
import { receiveUnit } from '@/lib/logistics/actions'
import { useAuth } from '@/lib/auth/context'
import type { GRN, GRNLine, Location, Unit } from '@/lib/logistics/types'
import {
  ArrowLeft, Loader2, CheckCircle2, AlertCircle, PackageOpen,
  Printer, Lock, Boxes,
} from 'lucide-react'
import { format } from 'date-fns'

interface UnitRow extends Pick<Unit,'id'|'barcode'|'product_type'|'variant'|'weight_kg'|'arrived_at'|'current_location_id'> {
  location_code?: string | null
}

export default function ReceivingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: grnId } = use(params)
  const { user, displayName } = useAuth()

  const [grn,       setGrn]       = useState<(GRN & { supplier: any; warehouse: any }) | null>(null)
  const [lines,     setLines]     = useState<GRNLine[]>([])
  const [units,     setUnits]     = useState<UnitRow[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  // Scan form state
  const [lineId,     setLineId]     = useState<string>('')
  const [locationId, setLocationId] = useState<string>('')
  const [weight,     setWeight]     = useState<string>('')
  const [unitType,   setUnitType]   = useState<'bag'|'box'|'pallet'>('bag')
  const [scanning,   setScanning]   = useState(false)
  const [lastUnit,   setLastUnit]   = useState<{ barcode: string; weight_kg: number } | null>(null)

  const isClosed = grn?.status === 'closed'

  useEffect(() => {
    void load()
  }, [grnId])

  async function load() {
    setLoading(true)
    try {
      const db = logisticsDb()
      const [grnRes, linesRes, unitsRes, locsRes] = await Promise.all([
        db.from('grns').select('*, supplier:supplier_id(*), warehouse:warehouse_id(*)').eq('id', grnId).maybeSingle(),
        db.from('grn_lines').select('*').eq('grn_id', grnId).order('line_no'),
        db.from('units').select('id, barcode, product_type, variant, weight_kg, arrived_at, current_location_id')
          .eq('grn_id', grnId).order('arrived_at', { ascending: false }),
        db.from('locations').select('*').eq('active', true).order('code'),
      ])
      const g = grnRes.data as any
      setGrn(g ?? null)
      setLines((linesRes.data as GRNLine[]) ?? [])
      // Map location codes onto units for display
      const locById = new Map(((locsRes.data as Location[]) ?? []).map(l => [l.id, l.code]))
      setUnits(((unitsRes.data ?? []) as any[]).map(u => ({ ...u, location_code: locById.get(u.current_location_id) ?? null })))
      setLocations((locsRes.data as Location[]) ?? [])

      // Auto-pick first line + warehouse default location
      if ((linesRes.data ?? []).length) setLineId((linesRes.data as any[])[0].id)
      if (g?.warehouse_id) {
        const firstLoc = (locsRes.data as Location[] | null)?.find(l => l.warehouse_id === g.warehouse_id && l.location_type === 'raw_storage')
        if (firstLoc) setLocationId(firstLoc.id)
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  const selectedLine = useMemo(() => lines.find(l => l.id === lineId), [lines, lineId])

  // Aggregate per-line received kg from units
  const lineProgress = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of units) {
      const key = `${u.product_type}|${u.variant ?? ''}`
      map.set(key, (map.get(key) ?? 0) + (u.weight_kg ?? 0))
    }
    return map
  }, [units])

  async function doScan() {
    setError(null)
    if (isClosed)        return setError('This GRN is closed')
    if (!selectedLine)   return setError('Pick a line first')
    if (!locationId)     return setError('Pick a location')
    const w = Number(weight)
    if (!w || w <= 0)    return setError('Enter a valid weight')

    setScanning(true)
    try {
      const res = await receiveUnit({
        grnId,
        supplierId:   grn?.supplier_id ?? null,
        productType:  selectedLine.product_type,
        variant:      selectedLine.variant ?? null,
        weightKg:     w,
        unitType,
        locationId,
        operatorId:   user?.id ?? null,
        operatorName: displayName ?? null,
      })

      if ('error' in res) { setError(res.error); return }

      setLastUnit({ barcode: res.barcode, weight_kg: w })
      // Update line received_kg (best-effort)
      await logisticsDb().from('grn_lines').update({
        received_kg: (selectedLine.received_kg ?? 0) + w,
      }).eq('id', selectedLine.id)

      // Clear weight, keep line/location/unitType so operator can rapid-scan
      setWeight('')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function closeGrn() {
    if (!confirm('Close this GRN? You will not be able to scan further units.')) return
    setError(null)
    try {
      const { error } = await logisticsDb()
        .from('grns')
        .update({ status: 'closed', closed_at: new Date().toISOString(), received_at: new Date().toISOString() })
        .eq('id', grnId)
      if (error) throw error
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Close failed')
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
  }
  if (!grn) {
    return <div className="p-6 text-center text-text-muted">GRN not found.</div>
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link href="/logistics/receiving" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to GRNs
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-text font-mono">{grn.grn_code}</h1>
            <StatusBadge status={grn.status} />
            {isClosed && <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock className="w-3 h-3" /> Locked</span>}
          </div>
          <div className="text-sm text-text-muted mt-1">
            {grn.supplier?.name ?? 'Unknown supplier'} → {grn.warehouse?.name ?? 'Unknown warehouse'}
          </div>
        </div>
        {!isClosed && (
          <button onClick={closeGrn}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-surface-rule bg-white text-sm hover:bg-surface">
            <CheckCircle2 className="w-4 h-4" /> Close GRN
          </button>
        )}
      </div>

      {/* Scan form */}
      {!isClosed && (
        <div className="rounded-xl border border-surface-rule bg-white p-5 mb-5">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Receive a unit</div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-4">
              <FieldLabel>GRN line</FieldLabel>
              <select value={lineId} onChange={e => setLineId(e.target.value)}
                className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
                {lines.map(l => (
                  <option key={l.id} value={l.id}>
                    #{l.line_no} {l.product_type}{l.variant ? ` · ${l.variant}` : ''}
                    {l.expected_kg ? ` (exp ${l.expected_kg} kg)` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <FieldLabel>Location</FieldLabel>
              <select value={locationId} onChange={e => setLocationId(e.target.value)}
                className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
                <option value="">— pick —</option>
                {locations
                  .filter(l => !grn.warehouse_id || l.warehouse_id === grn.warehouse_id)
                  .map(l => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.location_type}
                    </option>
                  ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Type</FieldLabel>
              <select value={unitType} onChange={e => setUnitType(e.target.value as any)}
                className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
                <option value="bag">Bag</option>
                <option value="box">Box</option>
                <option value="pallet">Pallet</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Weight (kg)</FieldLabel>
              <input
                value={weight} onChange={e => setWeight(e.target.value)}
                type="number" step="0.001" placeholder="e.g. 200"
                onKeyDown={e => { if (e.key === 'Enter') doScan() }}
                className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm text-right tabular-nums" />
            </div>
            <div className="md:col-span-1 flex items-end">
              <button onClick={doScan} disabled={scanning}
                className="w-full px-3 py-2 rounded-lg bg-text text-white text-sm hover:bg-text/90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageOpen className="w-4 h-4" />}
                Add
              </button>
            </div>
          </div>

          {/* Confirmation flash */}
          {lastUnit && !error && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <div>
                  <div className="text-sm font-medium text-emerald-900">Unit received</div>
                  <div className="text-xs text-emerald-700 font-mono">{lastUnit.barcode} · {lastUnit.weight_kg} kg</div>
                </div>
              </div>
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-300 bg-white text-emerald-700 text-xs hover:bg-emerald-100"
                title="Print label (browser print for now — wire to JsBarcode label later)"
              >
                <Printer className="w-3.5 h-3.5" /> Print label
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-err/20 bg-err/5 px-4 py-2.5 flex items-center gap-2 text-sm text-err">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
        </div>
      )}

      {/* Line progress */}
      <div className="rounded-xl border border-surface-rule bg-white p-5 mb-5">
        <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Lines</div>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-text-muted">
            <tr>
              <th className="text-left py-1.5">#</th>
              <th className="text-left">Product</th>
              <th className="text-left">Variant</th>
              <th className="text-right">Expected kg</th>
              <th className="text-right">Received kg</th>
              <th className="text-right">Progress</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const got = lineProgress.get(`${l.product_type}|${l.variant ?? ''}`) ?? l.received_kg ?? 0
              const pct = l.expected_kg ? Math.min(100, (got / l.expected_kg) * 100) : 0
              return (
                <tr key={l.id} className="border-t border-surface-rule">
                  <td className="py-2 text-text-muted">{l.line_no}</td>
                  <td>{l.product_type}</td>
                  <td className="text-text-muted">{l.variant ?? '—'}</td>
                  <td className="text-right tabular-nums">{l.expected_kg ?? '—'}</td>
                  <td className="text-right tabular-nums">{got.toFixed(1)}</td>
                  <td className="text-right">
                    {l.expected_kg ? (
                      <div className="inline-flex items-center gap-2">
                        <div className="w-24 h-1.5 rounded-full bg-surface overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-text-muted tabular-nums">{pct.toFixed(0)}%</span>
                      </div>
                    ) : <span className="text-text-muted">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Received units */}
      <div className="rounded-xl border border-surface-rule bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">Units received ({units.length})</div>
          <Boxes className="w-4 h-4 text-text-muted" />
        </div>
        {units.length === 0 ? (
          <div className="text-sm text-text-muted py-6 text-center">No units yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="text-left py-1.5">Barcode</th>
                <th className="text-left">Product</th>
                <th className="text-left">Variant</th>
                <th className="text-right">Weight (kg)</th>
                <th className="text-left">Location</th>
                <th className="text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {units.map(u => (
                <tr key={u.id} className="border-t border-surface-rule">
                  <td className="py-2 font-mono text-xs">
                    <Link href={`/logistics/warehouse/units/${u.id}`} className="hover:underline text-text">
                      {u.barcode}
                    </Link>
                  </td>
                  <td>{u.product_type}</td>
                  <td className="text-text-muted">{u.variant ?? '—'}</td>
                  <td className="text-right tabular-nums">{u.weight_kg}</td>
                  <td className="text-text-muted">{u.location_code ?? '—'}</td>
                  <td className="text-text-muted text-xs">{format(new Date(u.arrived_at), 'HH:mm:ss')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{children}</div>
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open:       'bg-amber-100 text-amber-700 border-amber-200',
    receiving:  'bg-blue-100 text-blue-700 border-blue-200',
    closed:     'bg-emerald-100 text-emerald-700 border-emerald-200',
    cancelled:  'bg-stone-100 text-stone-600 border-stone-200',
  }
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md border ${map[status] ?? 'bg-stone-100 text-stone-600'}`}>
      {status}
    </span>
  )
}

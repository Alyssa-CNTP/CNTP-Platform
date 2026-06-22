'use client'

// app/(app)/logistics/warehouse/units/[id]/page.tsx
// Full unit detail: identity, batch + traceability, lineage tree, event timeline,
// and inline actions (move, quarantine, release).
// Mobile-first layout (single column, sticky barcode at top).

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { logisticsDb } from '@/lib/logistics/db'
import { moveUnit } from '@/lib/logistics/actions'
import { useAuth } from '@/lib/auth/context'
import type { Unit, UnitEvent, Location, Batch, Supplier, Customer } from '@/lib/logistics/types'
import { UNIT_STAGE_LABELS, UNIT_STATUS_LABELS } from '@/lib/logistics/types'
import {
  ArrowLeft, Loader2, MapPin, Package, AlertCircle, CheckCircle2,
  Clock, ArrowRight, Move, Building2, User, Calendar, Tag,
  GitBranch, ScanLine, ExternalLink,
} from 'lucide-react'
import { format } from 'date-fns'

interface FullUnit extends Unit {
  location?: Location | null
  batch?: Batch | null
  supplier?: Supplier | null
  customer?: Customer | null
  parent?: { id: string; barcode: string } | null
}

interface LineageNode {
  unit_id: string
  barcode: string
  product_type: string | null
  variant: string | null
  weight_kg: number | null
  share_kg: number | null
}

export default function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user, displayName } = useAuth()

  const [unit, setUnit]       = useState<FullUnit | null>(null)
  const [events, setEvents]   = useState<UnitEvent[]>([])
  const [parents, setParents] = useState<LineageNode[]>([])
  const [children, setChildren] = useState<LineageNode[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [moving, setMoving]   = useState(false)
  const [moveTo, setMoveTo]   = useState<string>('')
  const [moveErr, setMoveErr] = useState<string | null>(null)

  useEffect(() => { void load() }, [id])

  async function load() {
    setLoading(true)
    try {
      const db = logisticsDb()
      const [unitRes, eventsRes, parentRes, childRes, locsRes] = await Promise.all([
        db.from('units').select(`
          *,
          location:current_location_id ( * ),
          batch:batch_id ( * ),
          supplier:supplier_id ( * ),
          customer:customer_id ( * ),
          parent:parent_unit_id ( id, barcode )
        `).eq('id', id).maybeSingle(),
        db.from('unit_events').select('*').eq('unit_id', id).order('scanned_at', { ascending: false }).limit(200),
        db.from('unit_lineage').select(`
          share_kg,
          parent:parent_unit_id ( id, barcode, product_type, variant, weight_kg )
        `).eq('child_unit_id', id),
        db.from('unit_lineage').select(`
          share_kg,
          child:child_unit_id ( id, barcode, product_type, variant, weight_kg )
        `).eq('parent_unit_id', id),
        db.from('locations').select('*').eq('active', true).order('code'),
      ])

      setUnit(unitRes.data as FullUnit | null)
      setEvents((eventsRes.data as UnitEvent[]) ?? [])
      setParents(((parentRes.data ?? []) as any[]).map(r => ({
        unit_id: r.parent.id, barcode: r.parent.barcode,
        product_type: r.parent.product_type, variant: r.parent.variant,
        weight_kg: r.parent.weight_kg, share_kg: r.share_kg,
      })))
      setChildren(((childRes.data ?? []) as any[]).map(r => ({
        unit_id: r.child.id, barcode: r.child.barcode,
        product_type: r.child.product_type, variant: r.child.variant,
        weight_kg: r.child.weight_kg, share_kg: r.share_kg,
      })))
      setLocations((locsRes.data as Location[]) ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function doMove() {
    if (!moveTo || !unit) return
    setMoveErr(null)
    setMoving(true)
    try {
      const res = await moveUnit({
        unitId:       unit.id,
        toLocationId: moveTo,
        operatorId:   user?.id ?? null,
        operatorName: displayName ?? null,
      })
      if ('error' in res) { setMoveErr(res.error); return }
      setMoveTo('')
      await load()
    } finally {
      setMoving(false)
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
  }
  if (!unit) {
    return <div className="p-6 text-center text-text-muted">Unit not found.</div>
  }

  const publicLink = `/scan/${encodeURIComponent(unit.barcode)}`

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <Link href="/logistics/warehouse/units" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to units
      </Link>

      {/* Sticky barcode header */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-surface/80 backdrop-blur border-b border-surface-rule mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-lg sm:text-xl font-semibold text-text">{unit.barcode}</div>
            <div className="text-xs text-text-muted">
              {unit.product_type ?? '—'}{unit.variant ? ` · ${unit.variant}` : ''} · {unit.weight_kg ?? '—'} kg
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StageBadge stage={unit.current_stage} />
            <StatusBadge status={unit.status} />
            <Link href={publicLink} target="_blank"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-surface-rule bg-white text-xs text-text-muted hover:text-text"
              title="Customer-facing public scan page">
              <ExternalLink className="w-3 h-3" /> Public
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left/main: identity + traceability + lineage */}
        <div className="md:col-span-2 space-y-4">

          {/* Identity */}
          <Card title="Identity">
            <Row icon={Package} label="Type"     value={unit.unit_type} />
            <Row icon={Tag}     label="Product"  value={unit.product_type ?? '—'} />
            <Row icon={Tag}     label="Variant"  value={unit.variant ?? '—'} />
            <Row icon={Tag}     label="Weight"   value={unit.weight_kg != null ? `${unit.weight_kg} kg` : '—'} />
            {unit.acumatica_inventory_id && (
              <Row icon={Tag} label="Acumatica ID" value={<span className="font-mono">{unit.acumatica_inventory_id}</span>} />
            )}
          </Card>

          {/* Location */}
          <Card title="Location & stage">
            <Row icon={MapPin}   label="Location" value={unit.location?.code ?? '—'} />
            <Row icon={Building2} label="Stage"    value={UNIT_STAGE_LABELS[unit.current_stage]} />
            <Row icon={Clock}    label="Arrived"  value={format(new Date(unit.arrived_at), 'd MMM yyyy HH:mm')} />
            {unit.departed_at && (
              <Row icon={Clock} label="Departed" value={format(new Date(unit.departed_at), 'd MMM yyyy HH:mm')} />
            )}

            {/* Move action */}
            {(unit.status === 'active' || unit.status === 'in_process') && (
              <div className="pt-3 mt-3 border-t border-surface-rule">
                <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Move</div>
                <div className="flex items-center gap-2">
                  <select value={moveTo} onChange={e => setMoveTo(e.target.value)}
                    className="flex-1 px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
                    <option value="">— pick new location —</option>
                    {locations.filter(l => l.id !== unit.current_location_id).map(l => (
                      <option key={l.id} value={l.id}>{l.code} · {l.location_type}</option>
                    ))}
                  </select>
                  <button onClick={doMove} disabled={moving || !moveTo}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-text text-white text-sm hover:bg-text/90 disabled:opacity-50">
                    {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Move className="w-4 h-4" />}
                    Move
                  </button>
                </div>
                {moveErr && <div className="mt-2 text-xs text-err">{moveErr}</div>}
              </div>
            )}
          </Card>

          {/* Traceability */}
          <Card title="Traceability">
            <Row icon={Calendar} label="Harvest date" value={unit.batch?.harvest_date ?? '—'} />
            <Row icon={Calendar} label="Expiry date"  value={unit.batch?.expiry_date ?? '—'} />
            <Row icon={Tag}      label="Batch code"   value={unit.batch?.batch_code ?? '—'} />
            <Row icon={Tag}      label="Lot number"   value={unit.batch?.lot_number ?? '—'} />
            <Row icon={Building2} label="Supplier"    value={unit.supplier?.name ?? '—'} />
            <Row icon={User}     label="Intended customer" value={unit.customer?.name ?? '—'} />
            {unit.batch?.pesticide_notes && (
              <div className="pt-2 mt-2 border-t border-surface-rule text-xs text-text-muted">
                <strong>Pesticide:</strong> {unit.batch.pesticide_notes}
              </div>
            )}
          </Card>

          {/* Lineage */}
          {(parents.length > 0 || children.length > 0) && (
            <Card title="Lineage" icon={GitBranch}>
              {parents.length > 0 && (
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Parents (consumed into this unit)</div>
                  <LineageList nodes={parents} />
                </div>
              )}
              {children.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Children (produced from this unit)</div>
                  <LineageList nodes={children} />
                </div>
              )}
            </Card>
          )}

        </div>

        {/* Right: event timeline */}
        <div className="md:col-span-1">
          <Card title="Event timeline" icon={ScanLine}>
            {events.length === 0 ? (
              <div className="text-sm text-text-muted py-6 text-center">No events yet.</div>
            ) : (
              <ol className="space-y-3">
                {events.map(ev => (
                  <li key={ev.id} className="text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-mono text-text-muted shrink-0">
                        {format(new Date(ev.scanned_at), 'd MMM HH:mm:ss')}
                      </span>
                      <span className="text-text font-medium">{ev.event_type}</span>
                    </div>
                    {(ev.from_stage || ev.to_stage) && (
                      <div className="text-xs text-text-muted ml-1 pl-3 border-l border-surface-rule">
                        {ev.from_stage ?? '—'} <ArrowRight className="inline w-3 h-3" /> {ev.to_stage ?? '—'}
                      </div>
                    )}
                    {ev.operator_name && (
                      <div className="text-xs text-text-muted ml-1 pl-3">by {ev.operator_name}</div>
                    )}
                    {ev.notes && (
                      <div className="text-xs text-text-muted ml-1 pl-3 italic">{ev.notes}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-rule bg-white p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3" />} {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <Icon className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
      <div className="text-text-muted w-32 shrink-0">{label}</div>
      <div className="text-text">{value}</div>
    </div>
  )
}

function LineageList({ nodes }: { nodes: LineageNode[] }) {
  return (
    <ul className="space-y-1.5">
      {nodes.map(n => (
        <li key={n.unit_id}>
          <Link href={`/logistics/warehouse/units/${n.unit_id}`}
            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-surface text-sm">
            <span className="font-mono text-xs">{n.barcode}</span>
            <span className="text-text-muted text-xs">
              {n.product_type ?? '—'}{n.share_kg != null ? ` · ${n.share_kg} kg` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md border bg-blue-50 text-blue-700 border-blue-200">
      {UNIT_STAGE_LABELS[stage as keyof typeof UNIT_STAGE_LABELS] ?? stage}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:     'bg-emerald-100 text-emerald-700 border-emerald-200',
    in_process: 'bg-blue-100 text-blue-700 border-blue-200',
    consumed:   'bg-stone-100 text-stone-600 border-stone-200',
    dispatched: 'bg-purple-100 text-purple-700 border-purple-200',
    quarantine: 'bg-amber-100 text-amber-700 border-amber-200',
    rejected:   'bg-red-100 text-red-700 border-red-200',
  }
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md border ${map[status] ?? ''}`}>
      {UNIT_STATUS_LABELS[status as keyof typeof UNIT_STATUS_LABELS] ?? status}
    </span>
  )
}

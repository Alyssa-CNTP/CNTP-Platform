'use client'

// app/(app)/logistics/page.tsx
// Landing page for the barcode-driven logistics module.
// Shows live counts and a card per workflow.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { logisticsDb } from '@/lib/logistics/db'
import {
  PackageOpen, Warehouse, Truck, ScanLine, ArrowRight,
  Boxes, Activity,
} from 'lucide-react'

interface Stats {
  openGrns:        number
  activeUnits:     number
  unitsInProcess:  number
  pendingDispatch: number
  unitsToday:      number
}

export default function OpsLandingPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadStats()
  }, [])

  async function loadStats() {
    setLoading(true)
    try {
      const db = logisticsDb()
      const [grns, active, inProc, disp, today] = await Promise.all([
        db.from('grns').select('id', { count: 'exact', head: true }).in('status', ['open','receiving']),
        db.from('units').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        db.from('units').select('id', { count: 'exact', head: true }).eq('status', 'in_process'),
        db.from('dispatches').select('id', { count: 'exact', head: true }).in('status', ['planning','picking','loading']),
        db.from('units').select('id', { count: 'exact', head: true }).gte('arrived_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
      ])
      setStats({
        openGrns:        grns.count   ?? 0,
        activeUnits:     active.count ?? 0,
        unitsInProcess:  inProc.count ?? 0,
        pendingDispatch: disp.count   ?? 0,
        unitsToday:      today.count  ?? 0,
      })
    } catch (e) {
      console.error('[logistics] stats load failed', e)
    } finally {
      setLoading(false)
    }
  }

  const cards = [
    {
      href:  '/logistics/receiving',
      icon:  PackageOpen,
      title: 'Receiving',
      desc:  'Create GRNs, scan inbound bags & pallets, assign locations.',
      stat:  stats ? `${stats.openGrns} open` : '—',
      accent:'bg-amber-50 text-amber-700 border-amber-200',
    },
    {
      href:  '/logistics/warehouse',
      icon:  Warehouse,
      title: 'Warehouse',
      desc:  'Live map of every unit, batch, supplier, location, customer.',
      stat:  stats ? `${stats.activeUnits} active` : '—',
      accent:'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      href:  '/logistics/dispatch',
      icon:  Truck,
      title: 'Dispatch',
      desc:  'Pick (FEFO), load to container, run the 10-doc checklist, seal.',
      stat:  stats ? `${stats.pendingDispatch} pending` : '—',
      accent:'bg-purple-50 text-purple-700 border-purple-200',
    },
    {
      href:  '/logistics/warehouse/units',
      icon:  ScanLine,
      title: 'Scan lookup',
      desc:  'Scan or search a barcode and jump straight to the unit detail.',
      stat:  stats ? `${stats.unitsToday} arrived today` : '—',
      accent:'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text">Logistics</h1>
          <p className="text-sm text-text-muted mt-1">
            Every bag, box and pallet has a stable unit_id from receipt to dispatch.
            Every scan is an event.
          </p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Open GRNs"            value={stats?.openGrns}        loading={loading} />
        <Stat label="Active units"         value={stats?.activeUnits}     loading={loading} />
        <Stat label="In process"           value={stats?.unitsInProcess}  loading={loading} />
        <Stat label="Pending dispatch"     value={stats?.pendingDispatch} loading={loading} />
        <Stat label="Arrived today"        value={stats?.unitsToday}      loading={loading} />
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map(c => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-surface-rule bg-white p-5 hover:border-text/30 transition shadow-sm hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg border ${c.accent}`}>
                <c.icon className="w-5 h-5" />
              </div>
              <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-text group-hover:translate-x-0.5 transition" />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text">{c.title}</h3>
              <span className="text-[11px] uppercase tracking-wider text-text-muted">{c.stat}</span>
            </div>
            <p className="text-sm text-text-muted mt-1">{c.desc}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-surface-rule bg-surface p-4">
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <Activity className="w-3.5 h-3.5" />
          <span>
            Acumatica remains the ERP system of record. This is the operational
            execution layer — every internal movement is captured here in real time
            and synced back.
          </span>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <div className="rounded-lg border border-surface-rule bg-white p-3">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-2xl font-semibold text-text mt-1 tabular-nums">
        {loading ? <span className="text-text-muted/40">—</span> : (value ?? 0)}
      </div>
    </div>
  )
}

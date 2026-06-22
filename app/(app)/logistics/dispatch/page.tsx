'use client'

// app/(app)/logistics/dispatch/page.tsx
// Dispatch list — every in-progress + recent dispatch.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { logisticsDb } from '@/lib/logistics/db'
import { Plus, Truck, ArrowRight, Loader2 } from 'lucide-react'
import { format } from 'date-fns'

interface Row {
  id:             string
  dispatch_code:  string
  status:         string
  container_no:   string | null
  container_size: string | null
  scheduled_at:   string | null
  dispatched_at:  string | null
  created_at:     string
  so:             { so_code: string; customer: { name: string } | null } | null
  units_count:    number
}

export default function DispatchListPage() {
  const router = useRouter()
  const [rows, setRows]       = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'open' | 'sealed' | 'dispatched' | 'all'>('open')

  useEffect(() => { void load() }, [filter])

  async function load() {
    setLoading(true)
    try {
      const db = logisticsDb()
      let q = db
        .from('dispatches')
        .select(`
          id, dispatch_code, status, container_no, container_size,
          scheduled_at, dispatched_at, created_at,
          so:so_id ( so_code, customer:customer_id ( name ) )
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      if (filter === 'open')       q = q.in('status', ['planning', 'picking', 'loading'])
      if (filter === 'sealed')     q = q.eq('status', 'sealed')
      if (filter === 'dispatched') q = q.eq('status', 'dispatched')

      const { data } = await q

      const enriched: Row[] = await Promise.all(((data ?? []) as any[]).map(async (d) => {
        const { count } = await db
          .from('unit_events')
          .select('id', { count: 'exact', head: true })
          .eq('dispatch_id', d.id)
          .eq('event_type', 'pick_for_order')
        return { ...d, units_count: count ?? 0 }
      }))
      setRows(enriched)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Dispatch</h1>
          <p className="text-sm text-text-muted mt-1">Pick, load, checklist, seal. FEFO/FIFO enforced on pick.</p>
        </div>
        <Link href="/logistics/dispatch/new"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-text text-white text-sm hover:bg-text/90 transition">
          <Plus className="w-4 h-4" /> New dispatch
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(['open', 'sealed', 'dispatched', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm transition
              ${filter === f ? 'bg-text text-white' : 'bg-white text-text-muted border border-surface-rule hover:text-text'}`}>
            {f === 'open' ? 'Open' : f === 'sealed' ? 'Sealed' : f === 'dispatched' ? 'Dispatched' : 'All'}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-surface-rule bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-text-muted">
            <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <div className="text-sm">No dispatches.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="text-left px-4 py-2.5">Dispatch</th>
                <th className="text-left px-4 py-2.5">SO</th>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Container</th>
                <th className="text-right px-4 py-2.5">Units</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onClick={() => router.push(`/logistics/dispatch/${r.id}`)}
                  className="border-t border-surface-rule hover:bg-surface/50 cursor-pointer">
                  <td className="px-4 py-3 font-mono font-medium">{r.dispatch_code}</td>
                  <td className="px-4 py-3 text-text-muted">{r.so?.so_code ?? '—'}</td>
                  <td className="px-4 py-3 text-text-muted">{r.so?.customer?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {r.container_no ? <><span className="font-mono">{r.container_no}</span> · {r.container_size}</> : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.units_count}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-text-muted text-xs">{format(new Date(r.created_at), 'd MMM yyyy HH:mm')}</td>
                  <td className="px-4 py-3 text-right"><ArrowRight className="w-4 h-4 text-text-muted inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    planning:   'bg-amber-100 text-amber-700 border-amber-200',
    picking:    'bg-blue-100 text-blue-700 border-blue-200',
    loading:    'bg-blue-100 text-blue-700 border-blue-200',
    sealed:     'bg-purple-100 text-purple-700 border-purple-200',
    dispatched: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    cancelled:  'bg-stone-100 text-stone-600 border-stone-200',
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded-md border ${map[status] ?? 'bg-stone-100 text-stone-600'}`}>{status}</span>
}

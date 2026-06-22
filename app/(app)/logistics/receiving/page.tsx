'use client'

// app/(app)/logistics/receiving/page.tsx
// List of GRNs (Goods Receipt Notes). Open + recently-closed.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { logisticsDb } from '@/lib/logistics/db'
import { Plus, PackageOpen, ArrowRight, Loader2 } from 'lucide-react'
import { format } from 'date-fns'

interface Row {
  id:           string
  grn_code:     string
  status:       string
  received_at:  string | null
  created_at:   string
  supplier:     { name: string; code: string } | null
  warehouse:    { name: string; code: string } | null
  lines_count:  number
  units_count:  number
}

export default function ReceivingListPage() {
  const router = useRouter()
  const [rows, setRows]       = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'open' | 'closed' | 'all'>('open')

  useEffect(() => {
    void load()
  }, [filter])

  async function load() {
    setLoading(true)
    try {
      const db = logisticsDb()
      let q = db
        .from('grns')
        .select(`
          id, grn_code, status, received_at, created_at,
          supplier:supplier_id ( name, code ),
          warehouse:warehouse_id ( name, code )
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      if (filter === 'open')   q = q.in('status', ['open', 'receiving'])
      if (filter === 'closed') q = q.eq('status', 'closed')

      const { data: grns, error } = await q
      if (error) throw error

      // For each GRN fetch line + unit counts (cheap with .head)
      const enriched: Row[] = await Promise.all(((grns ?? []) as any[]).map(async (g) => {
        const [linesRes, unitsRes] = await Promise.all([
          db.from('grn_lines').select('id', { count: 'exact', head: true }).eq('grn_id', g.id),
          db.from('units').select('id', { count: 'exact', head: true }).eq('grn_id', g.id),
        ])
        return {
          id:           g.id,
          grn_code:     g.grn_code,
          status:       g.status,
          received_at:  g.received_at,
          created_at:   g.created_at,
          supplier:     g.supplier,
          warehouse:    g.warehouse,
          lines_count:  linesRes.count ?? 0,
          units_count:  unitsRes.count ?? 0,
        }
      }))
      setRows(enriched)
    } catch (e) {
      console.error('[receiving] load failed', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Receiving</h1>
          <p className="text-sm text-text-muted mt-1">Inbound from suppliers. Each GRN groups one delivery into one or more lines.</p>
        </div>
        <Link
          href="/logistics/receiving/new"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-text text-white text-sm hover:bg-text/90 transition"
        >
          <Plus className="w-4 h-4" /> New GRN
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {(['open', 'closed', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm transition
              ${filter === f
                ? 'bg-text text-white'
                : 'bg-white text-text-muted border border-surface-rule hover:text-text'}`}
          >
            {f === 'open' ? 'Open' : f === 'closed' ? 'Closed' : 'All'}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-surface-rule bg-white overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-text-muted">
            <PackageOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <div className="text-sm">No GRNs yet. Click <strong>New GRN</strong> to start receiving.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="text-left px-4 py-2.5">GRN</th>
                <th className="text-left px-4 py-2.5">Supplier</th>
                <th className="text-left px-4 py-2.5">Warehouse</th>
                <th className="text-right px-4 py-2.5">Lines</th>
                <th className="text-right px-4 py-2.5">Units</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  className="border-t border-surface-rule hover:bg-surface/50 cursor-pointer"
                  onClick={() => router.push(`/logistics/receiving/${r.id}`)}
                >
                  <td className="px-4 py-3 font-mono font-medium text-text">{r.grn_code}</td>
                  <td className="px-4 py-3 text-text-muted">{r.supplier?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-text-muted">{r.warehouse?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.lines_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.units_count}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {format(new Date(r.created_at), 'd MMM yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ArrowRight className="w-4 h-4 text-text-muted inline" />
                  </td>
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

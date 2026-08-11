'use client'

// app/(app)/production/inventory/page.tsx
// Master Inventory — read-only browser over the Acumatica stock-item register
// (production.inventory_items). Acumatica is the master for this data; items
// arrive and are corrected exclusively through the /admin/inventory-import
// bulk refresh. This page has no add/edit/delete — it's a lookup for the
// Blends (BOM) page and every capture picker (lib/production/inventory.ts).

import { useEffect, useMemo, useState } from 'react'
import { Search, PackageOpen, EyeOff, Eye } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import type { InventoryItem } from '@/lib/supabase/database.types'

export default function InventoryPage() {
  const [items, setItems]   = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]           = useState('')
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await getDb().schema('production').from('inventory_items')
        .select('*').order('inventory_id')
      setItems((data as InventoryItem[]) ?? [])
      setLoading(false)
    })()
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    let rows = showInactive ? items : items.filter(i => i.active)
    if (t) rows = rows.filter(i => `${i.inventory_id} ${i.description ?? ''} ${i.product_group ?? ''} ${i.variant ?? ''}`.toLowerCase().includes(t))
    return rows
  }, [items, q, showInactive])

  const stats = useMemo(() => ({
    total: items.length,
    active: items.filter(i => i.active).length,
    missingVariant: items.filter(i => i.active && !i.variant).length,
  }), [items])

  if (loading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="rounded-xl border border-surface-rule bg-surface-card p-6 text-text-muted text-sm">Loading…</div></div>

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Master Inventory</h1>
        <p className="text-sm text-text-muted mt-1">Every Acumatica stock item CNTP production uses. Read-only — Acumatica is the master; items are refreshed via the import, not edited here. Blends and capture pickers read this table directly.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Stat label="Items on register" value={stats.total} />
        <Stat label="Active" value={stats.active} />
        <Stat label="Missing variant" value={stats.missingVariant} tone={stats.missingVariant ? 'warn' : undefined} />
      </div>

      <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-sm font-semibold text-text flex items-center gap-2"><PackageOpen className="w-4 h-4" /> Stock Items</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, description…"
                className="h-9 w-56 rounded-lg border border-surface-rule bg-surface-card pl-8 pr-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <button onClick={() => setShowInactive(v => !v)}
              className="inline-flex items-center gap-1.5 border border-surface-rule bg-surface-card text-text-muted rounded-lg px-3 h-9 text-[13px] font-semibold hover:border-text/25">
              {showInactive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {showInactive ? 'Showing inactive' : 'Active only'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-surface-rule">
                <th className="text-left font-semibold py-2 px-2">Item Code</th>
                <th className="text-left font-semibold py-2 px-2">Description</th>
                <th className="text-left font-semibold py-2 px-2">Item Class</th>
                <th className="text-left font-semibold py-2 px-2">Group</th>
                <th className="text-left font-semibold py-2 px-2">Grade</th>
                <th className="text-left font-semibold py-2 px-2">Variant</th>
                <th className="text-left font-semibold py-2 px-2">Unit</th>
                <th className="text-left font-semibold py-2 px-2">Status</th>
                <th className="text-center font-semibold py-2 px-2 w-16">Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => <ItemRow key={r.inventory_id} r={r} />)}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-[12px] text-text-faint py-6 text-center">
              {q ? 'No items match your search.' : 'No inventory items yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ItemRow({ r }: { r: InventoryItem }) {
  return (
    <tr className={`border-b border-surface-rule/60 hover:bg-surface-dim/40 ${!r.active ? 'opacity-50' : ''}`}>
      <td className="py-1.5 px-2 font-mono text-[12px] text-text">{r.inventory_id}</td>
      <td className="py-1.5 px-2 text-text">{r.description ?? ''}</td>
      <td className="py-1.5 px-2 text-text-muted">{r.item_class ?? ''}</td>
      <td className="py-1.5 px-2 text-text-muted">{r.product_group ?? ''}</td>
      <td className="py-1.5 px-2 text-text-muted">{r.grade ?? ''}</td>
      <td className="py-1.5 px-2 text-text-muted">{r.variant ?? '—'}</td>
      <td className="py-1.5 px-2 text-text-muted">{r.base_unit ?? ''}</td>
      <td className="py-1.5 px-2 text-text-muted">{r.item_status ?? ''}</td>
      <td className="py-1.5 px-2 text-center">
        <span className={`inline-block w-2 h-2 rounded-full ${r.active ? 'bg-ok' : 'bg-text-faint'}`} title={r.active ? 'Active' : 'Inactive'} />
      </td>
    </tr>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'err' | 'info' }) {
  const v = tone === 'err' ? 'text-err' : tone === 'warn' ? 'text-warn' : tone === 'info' ? 'text-info' : 'text-text'
  return (
    <div className="rounded-lg border border-surface-rule bg-surface-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${v}`}>{value}</div>
    </div>
  )
}

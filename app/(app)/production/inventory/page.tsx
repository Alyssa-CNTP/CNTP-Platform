'use client'

// app/(app)/production/inventory/page.tsx
// Master Inventory — the Acumatica stock-item register (production.inventory_items),
// browsable and editable inline. This is the master data the Blends (BOM) page and
// every capture picker (lib/production/inventory.ts) point at, so a code fixed here
// is fixed everywhere at once. Bulk refreshes from Acumatica still go through
// /admin/inventory-import — this page is for day-to-day per-row corrections.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Check, X, PackageOpen, EyeOff, Eye } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import type { InventoryItem } from '@/lib/supabase/database.types'

const VARIANTS = ['Conventional', 'Organic', 'RA-Conventional', 'RA-Organic', 'FT-ORG', 'FT-CON']

export default function InventoryPage() {
  const { p, isFullAdmin } = useAuth()
  const canEdit = isFullAdmin || p('can_edit_inventory')
  const canDelete = isFullAdmin || p('can_delete_inventory')

  const [items, setItems]   = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]           = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)

  async function reload() {
    const { data } = await getDb().schema('production').from('inventory_items')
      .select('*').order('inventory_id')
    setItems((data as InventoryItem[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

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

  async function updateItem(id: string, patch: Partial<InventoryItem>) {
    setItems(rows => rows.map(r => r.inventory_id === id ? { ...r, ...patch } : r))
    await getDb().schema('production').from('inventory_items').update(patch as any).eq('inventory_id', id)
  }

  async function addItem(row: { inventory_id: string; description: string; item_class: string; category_code: string; product_group: string; grade: string; qc_grade: string; variant: string; base_unit: string; item_status: string }) {
    const payload = { ...row, active: true }
    const { error } = await getDb().schema('production').from('inventory_items').insert(payload as any)
    if (error) { alert(error.message); return }
    setAdding(false)
    reload()
  }

  if (loading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="rounded-xl border border-surface-rule bg-surface-card p-6 text-text-muted text-sm">Loading…</div></div>

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Master Inventory</h1>
        <p className="text-sm text-text-muted mt-1">Every Acumatica stock item CNTP production uses — edit inline. Blends and capture pickers read this table directly.</p>
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
            {canEdit && (
              <button onClick={() => setAdding(a => !a)}
                className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-3 h-9 text-[13px] font-semibold">
                <Plus className="w-4 h-4" /> Add item
              </button>
            )}
          </div>
        </div>

        {adding && <AddItemRow onAdd={addItem} onCancel={() => setAdding(false)} />}

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
                <th className="py-2 px-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <ItemRow key={r.inventory_id} r={r} canEdit={canEdit} canDelete={canDelete} onUpdate={updateItem} />
              ))}
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

function ItemRow({ r, canEdit, canDelete, onUpdate }: {
  r: InventoryItem; canEdit: boolean; canDelete: boolean
  onUpdate: (id: string, patch: Partial<InventoryItem>) => void
}) {
  return (
    <tr className={`border-b border-surface-rule/60 hover:bg-surface-dim/40 ${!r.active ? 'opacity-50' : ''}`}>
      <td className="py-1.5 px-2 font-mono text-[12px] text-text">{r.inventory_id}</td>
      <td className="py-1.5 px-2"><Cell value={r.description ?? ''} disabled={!canEdit} onSave={v => onUpdate(r.inventory_id, { description: v })} /></td>
      <td className="py-1.5 px-2"><Cell value={r.item_class ?? ''} disabled={!canEdit} onSave={v => onUpdate(r.inventory_id, { item_class: v })} /></td>
      <td className="py-1.5 px-2"><Cell value={r.product_group ?? ''} disabled={!canEdit} onSave={v => onUpdate(r.inventory_id, { product_group: v })} /></td>
      <td className="py-1.5 px-2"><Cell value={r.grade ?? ''} disabled={!canEdit} onSave={v => onUpdate(r.inventory_id, { grade: v })} /></td>
      <td className="py-1.5 px-2">
        <select value={r.variant ?? ''} disabled={!canEdit} onChange={e => onUpdate(r.inventory_id, { variant: e.target.value || null })}
          className="bg-transparent border border-transparent hover:border-surface-rule focus:border-brand rounded px-1.5 py-1 text-[12px] text-text-muted focus:outline-none disabled:opacity-60">
          <option value="">—</option>
          {VARIANTS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </td>
      <td className="py-1.5 px-2"><Cell value={r.base_unit ?? ''} disabled={!canEdit} onSave={v => onUpdate(r.inventory_id, { base_unit: v })} /></td>
      <td className="py-1.5 px-2"><Cell value={r.item_status ?? ''} disabled={!canEdit} onSave={v => onUpdate(r.inventory_id, { item_status: v })} /></td>
      <td className="py-1.5 px-2 text-center">
        <input type="checkbox" checked={r.active} disabled={!canDelete}
          onChange={e => onUpdate(r.inventory_id, { active: e.target.checked })}
          className="w-4 h-4 accent-brand disabled:opacity-50" />
      </td>
      <td />
    </tr>
  )
}

function AddItemRow({ onAdd, onCancel }: {
  onAdd: (row: { inventory_id: string; description: string; item_class: string; category_code: string; product_group: string; grade: string; qc_grade: string; variant: string; base_unit: string; item_status: string }) => void
  onCancel: () => void
}) {
  const [f, setF] = useState({ inventory_id: '', description: '', item_class: '', category_code: '', product_group: '', grade: '', qc_grade: '', variant: '', base_unit: 'KG', item_status: 'Active' })
  const submit = () => { if (!f.inventory_id.trim() || !f.description.trim()) return; onAdd({ ...f, inventory_id: f.inventory_id.trim().toUpperCase() }) }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-center p-3 mb-3 rounded-lg border border-brand/20 bg-accent-bg/40">
      <input autoFocus value={f.inventory_id} onChange={e => setF({ ...f, inventory_id: e.target.value.toUpperCase() })} placeholder="Item code *" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px] font-mono" />
      <input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Description *" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px] col-span-2 md:col-span-1" />
      <input value={f.item_class} onChange={e => setF({ ...f, item_class: e.target.value })} placeholder="Item class" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <input value={f.product_group} onChange={e => setF({ ...f, product_group: e.target.value })} placeholder="Group" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <select value={f.variant} onChange={e => setF({ ...f, variant: e.target.value })} className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]">
        <option value="">Variant —</option>
        {VARIANTS.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <input value={f.base_unit} onChange={e => setF({ ...f, base_unit: e.target.value })} placeholder="Unit" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <div className="flex gap-1.5">
        <button onClick={submit} className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white"><Check className="w-4 h-4" /></button>
        <button onClick={onCancel} className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-surface-dim text-text-muted"><X className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

function Cell({ value, onSave, disabled, mono }: { value: string; onSave: (v: string) => void; disabled?: boolean; mono?: boolean }) {
  return (
    <input defaultValue={value} disabled={disabled}
      onBlur={e => { if (e.target.value !== value) onSave(e.target.value) }}
      className={`w-full min-w-[80px] bg-transparent border border-transparent hover:border-surface-rule focus:border-brand rounded px-2 py-1 text-[13px] text-text focus:outline-none disabled:opacity-60 ${mono ? 'font-mono text-[11px]' : ''}`} />
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

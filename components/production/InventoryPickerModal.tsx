'use client'

// A full search-and-browse modal over Master Inventory (production.inventory_items),
// for contexts where a quick 30-result text dropdown isn't enough — building a BOM
// means comparing many candidate items at once. Adds faceted filters (item class,
// group, grade, variant) on top of the text search, and shows every match in a
// scrollable table rather than capping results. Deliberately separate from the
// lightweight ItemPicker (components/production/capture/ItemPicker.tsx) used during
// live production capture, whose single-item quick-lookup use case doesn't need this.

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { InventoryItem } from '@/lib/supabase/database.types'

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim().length > 0))).sort()
}

export interface InventoryPickerModalProps {
  items: InventoryItem[]
  open: boolean
  onClose: () => void
  onPick: (item: InventoryItem) => void
  title?: string
}

export function InventoryPickerModal({ items, open, onClose, onPick, title = 'Search Master Inventory' }: InventoryPickerModalProps) {
  const [q, setQ] = useState('')
  const [itemClass, setItemClass] = useState('')
  const [group, setGroup] = useState('')
  const [grade, setGrade] = useState('')
  const [variant, setVariant] = useState('')

  useEffect(() => {
    if (open) { setQ(''); setItemClass(''); setGroup(''); setGrade(''); setVariant('') }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const itemClasses = useMemo(() => uniqueSorted(items.map(i => i.item_class)), [items])
  const groups      = useMemo(() => uniqueSorted(items.map(i => i.product_group)), [items])
  const grades      = useMemo(() => uniqueSorted(items.map(i => i.grade)), [items])
  const variants    = useMemo(() => uniqueSorted(items.map(i => i.variant)), [items])

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter(it => {
      if (itemClass && it.item_class !== itemClass) return false
      if (group && it.product_group !== group) return false
      if (grade && it.grade !== grade) return false
      if (variant && it.variant !== variant) return false
      if (words.length) {
        const haystack = `${it.inventory_id} ${it.description ?? ''} ${it.product_group ?? ''}`.toLowerCase()
        if (!words.every(w => haystack.includes(w))) return false
      }
      return true
    })
  }, [items, q, itemClass, group, grade, variant])

  const activeFilterCount = [itemClass, group, grade, variant].filter(Boolean).length

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-surface-rule bg-surface-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-rule shrink-0">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button onClick={onClose} className="text-text-faint hover:text-text p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 pt-3 pb-2 space-y-2 border-b border-surface-rule shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search code or description…"
              className="h-9 w-full rounded-lg border border-surface-rule bg-surface-card pl-8 pr-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect label="Item class" value={itemClass} onChange={setItemClass} options={itemClasses} />
            <FilterSelect label="Group" value={group} onChange={setGroup} options={groups} />
            <FilterSelect label="Grade" value={grade} onChange={setGrade} options={grades} />
            <FilterSelect label="Variant" value={variant} onChange={setVariant} options={variants} />
            {activeFilterCount > 0 && (
              <button onClick={() => { setItemClass(''); setGroup(''); setGrade(''); setVariant('') }}
                className="text-[11px] text-text-faint hover:text-text underline underline-offset-2">
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface-card">
              <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-surface-rule">
                <th className="text-left font-semibold py-2 px-3">Code</th>
                <th className="text-left font-semibold py-2 px-3">Description</th>
                <th className="text-left font-semibold py-2 px-3">Class</th>
                <th className="text-left font-semibold py-2 px-3">Group</th>
                <th className="text-left font-semibold py-2 px-3">Grade</th>
                <th className="text-left font-semibold py-2 px-3">Variant</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <tr key={it.inventory_id} onClick={() => { onPick(it); onClose() }}
                  className="border-b border-surface-rule/60 hover:bg-surface-dim/40 cursor-pointer">
                  <td className="py-1.5 px-3 font-mono text-[11px] text-text whitespace-nowrap">{it.inventory_id}</td>
                  <td className="py-1.5 px-3 text-text">{it.description}</td>
                  <td className="py-1.5 px-3 text-text-muted whitespace-nowrap">{it.item_class}</td>
                  <td className="py-1.5 px-3 text-text-muted whitespace-nowrap">{it.product_group}</td>
                  <td className="py-1.5 px-3 text-text-muted whitespace-nowrap">{it.grade}</td>
                  <td className="py-1.5 px-3 text-text-muted whitespace-nowrap">{it.variant}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-[12px] text-text-faint py-8 text-center">No items match.</div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-surface-rule text-[11px] text-text-faint shrink-0">
          Showing {filtered.length} of {items.length} items
        </div>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-8 rounded-lg border border-surface-rule bg-surface-card px-2 text-[12px] text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/30">
      <option value="">{label}: all</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

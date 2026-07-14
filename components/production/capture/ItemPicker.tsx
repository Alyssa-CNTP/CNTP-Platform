'use client'

// Shared live search-picker over Master Inventory (production.inventory_items).
// Used by the Blends (BOM) page to pick component/output items, and by
// BlenderCapture's ingredient rows so an operator can confirm/search the real
// item they're using instead of being locked to whatever the BOM declared —
// materials genuinely substitute in practice (e.g. a blend's "Other" slot might
// be Cut Heavy Stick one run and Corn Cutter Fine Leaf the next).

import { useMemo, useState } from 'react'
import { filterInventory } from '@/lib/production/inventory'
import type { InventoryItem } from '@/lib/supabase/database.types'

export function ItemPicker({ items, onPick, placeholder, className }: {
  items: InventoryItem[]
  onPick: (item: InventoryItem) => void
  placeholder: string
  className?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => filterInventory(items, query), [items, query])
  return (
    <div className="relative">
      <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className ?? 'h-9 w-full rounded-lg border border-surface-rule px-2 text-[13px]'} />
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-surface-rule bg-surface-card shadow-lg">
          {matches.map(it => (
            <button key={it.inventory_id} type="button"
              onClick={() => { onPick(it); setQuery(`${it.inventory_id} — ${it.description ?? ''}`); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-surface-dim/60 text-[12px] border-b border-surface-rule/40 last:border-0">
              <div className="font-mono text-[11px] text-text">{it.inventory_id}</div>
              <div className="text-text-muted truncate">{it.description}</div>
            </button>
          ))}
        </div>
      )}
      {open && (
        <button type="button" onClick={() => setOpen(false)}
          className="fixed inset-0 z-[5] cursor-default" style={{ background: 'transparent' }} aria-hidden />
      )}
    </div>
  )
}

'use client'

/**
 * AddItemModal
 * ─────────────────────────────────────────────────────────────────────────────
 * Bottom-sheet modal for adding an ad-hoc inventory item to a count section.
 * Searches production.inventory_items (with local fallback to sections.ts).
 *
 * Usage:
 *   <AddItemModal
 *     open={showAdd}
 *     sectionId="sieve"
 *     onAdd={(item) => { store.addItem(...); setShowAdd(false) }}
 *     onClose={() => setShowAdd(false)}
 *   />
 */

import { useState, useEffect } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import { useInventorySearch } from '@/lib/data/useInventorySearch'
import { Search, Package, Database, HardDrive, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { InventoryItem } from '@/lib/data/sections'
import { V4 } from '@/lib/data/sections'

// What we hand back to the caller
export interface AddedItem {
  inventoryId: string
  description: string
  itemClass:   string | null
}

interface AddItemModalProps {
  open:      boolean
  sectionId: string
  onAdd:     (item: AddedItem) => void
  onClose:   () => void
}

export default function AddItemModal({ open, sectionId, onAdd, onClose }: AddItemModalProps) {
  const [query, setQuery] = useState('')
  const { results, loading, search, clear } = useInventorySearch()

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      clear()
    }
  }, [open])

  function handleQueryChange(value: string) {
    setQuery(value)
    search(value)
  }

  function handleSelect(r: { inventory_id: string; description: string; item_class: string | null }) {
    onAdd({
      inventoryId: r.inventory_id,
      description: r.description,
      itemClass:   r.item_class,
    })
    setQuery('')
    clear()
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Package size={18} className="text-accent" />
          <span className="font-display font-bold text-[17px] text-text">Add item</span>
          <span className="font-mono text-[10px] bg-surface-rule text-text-muted px-2 py-0.5 rounded-md uppercase tracking-wide ml-auto">
            {sectionId}
          </span>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search by ID, name, or class…"
            className="w-full pl-9 pr-4 py-3 border-2 border-surface-rule rounded-xl font-body text-[14px] text-text bg-surface-card outline-none focus:border-accent transition-colors"
          />
          {loading && (
            <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
          )}
        </div>

        {/* Results */}
        {results.length > 0 ? (
          <div className="space-y-1 max-h-72 overflow-y-auto -mx-1 px-1">
            {results.map(r => (
              <button
                key={r.inventory_id}
                onClick={() => handleSelect(r)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface transition-colors text-left group"
              >
                {/* Source badge */}
                <div className={clsx(
                  'flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center',
                  r.source === 'db' ? 'bg-info-bg' : 'bg-surface-rule'
                )}>
                  {r.source === 'db'
                    ? <Database size={11} className="text-status-info" />
                    : <HardDrive size={11} className="text-text-muted" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[12px] font-bold text-text truncate">
                    {r.inventory_id}
                  </div>
                  <div className="text-[12px] text-text-muted truncate">{r.description}</div>
                </div>

                {r.item_class && (
                  <span className="flex-shrink-0 font-mono text-[9px] uppercase tracking-wide text-text-faint bg-surface-rule px-1.5 py-0.5 rounded">
                    {r.item_class}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : query.length > 1 && !loading ? (
          <div className="text-center py-8 text-text-muted">
            <Package size={28} className="mx-auto mb-2 text-text-faint" />
            <p className="text-sm">No items found for "{query}"</p>
            <p className="text-xs text-text-faint mt-1">Try a different ID or name</p>
          </div>
) : query.length === 0 ? (
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted px-1 mb-2">Common items</p>
            {[
              { inventory_id: '10LGEF',      description: 'Fine Leaf: Export',           item_class: 'Leaf' },
              { inventory_id: '10LGBLF',     description: 'Fine Leaf: Export Blend',     item_class: 'Leaf' },
              { inventory_id: '15IGDB',      description: 'Dust: Brown',                 item_class: 'Dust' },
              { inventory_id: '15IGDPOWDR',  description: 'Dust: Powder',                item_class: 'Dust' },
              { inventory_id: '15IGIS',      description: 'Indent Sticks',               item_class: 'Stick' },
              { inventory_id: '15IGDW',      description: 'Dust: White',                 item_class: 'Dust' },
              { inventory_id: '20BGTBC',     description: 'Tea Bag Cut (TBC)',            item_class: 'Granule' },
              { inventory_id: 'SPILL',       description: 'Machine Spillage',            item_class: null },
            ].map(r => (
              <button
                key={r.inventory_id}
                onClick={() => handleSelect(r)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface transition-colors text-left"
              >
                <div className="flex-shrink-0 w-6 h-6 rounded-md bg-surface-rule flex items-center justify-center">
                  <Package size={11} className="text-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[12px] font-bold text-text">{r.inventory_id}</div>
                  <div className="text-[12px] text-text-muted">{r.description}</div>
                </div>
                {r.item_class && (
                  <span className="font-mono text-[9px] uppercase tracking-wide text-text-faint bg-surface-rule px-1.5 py-0.5 rounded">
                    {r.item_class}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : null}

      <button
                onClick={onClose}
                className="w-full py-3 text-sm font-semibold text-status-error border-2 border-err/30 bg-err-bg rounded-xl hover:bg-err-bg/70 transition-colors"
              >
                Cancel
              </button>
      </div>
    </BottomSheet>
  )
}

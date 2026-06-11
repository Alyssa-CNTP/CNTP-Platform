'use client'

import { useState, useEffect } from 'react'
import { Search, Sparkles, X, Printer } from 'lucide-react'
import { suggestOutputs, loadAllInventory, filterInventory } from '@/lib/production/inventory'
import { DESTINATION_OPTIONS } from '@/lib/production/capture-config'
import type { InventoryItem } from '@/lib/supabase/database.types'

export interface PickedOutput {
  productType: string
  code: string | null
  description: string
  isLeaf: boolean
  weight: string
  destination: string
  batch: string
}

const INP = 'w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'

/**
 * Easy output picker: the few items that fit the section + variant up top
 * (AI-suggested), full 630-item master search only when the operator looks.
 */
export function OutputPicker({ sectionId, variantWord, defaultBatch, onAdd, onClose }: {
  sectionId: string
  variantWord: string
  defaultBatch: string
  onAdd: (p: PickedOutput) => void
  onClose: () => void
}) {
  const suggestions = suggestOutputs(sectionId, variantWord)
  const [query, setQuery]     = useState('')
  const [all, setAll]         = useState<InventoryItem[]>([])
  const [picked, setPicked]   = useState<{ productType: string; code: string | null; description: string; isLeaf: boolean } | null>(null)
  const [weight, setWeight]   = useState('')
  const [batch, setBatch]     = useState(defaultBatch)
  const [destination, setDestination] = useState('A')

  // Load the master list once; filtering is then instant on every keystroke.
  useEffect(() => { loadAllInventory().then(setAll) }, [])

  const results = filterInventory(all, query, variantWord)
  function onSearch(q: string) { setQuery(q) }

  function confirm() {
    if (!picked || !weight) return
    onAdd({ ...picked, weight, batch: batch || defaultBatch, destination })
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <span className="font-semibold text-[15px] text-text flex-1">Add output bag</span>
        <button onClick={onClose} className="text-stone-400 hover:text-text p-1"><X size={18} /></button>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200">
          <Search size={16} className="text-stone-400" />
          <input value={query} onChange={e => onSearch(e.target.value)} placeholder="Search all inventory…"
            className="flex-1 py-2.5 text-[14px] outline-none bg-transparent" />
        </div>

        {query.trim().length === 0 ? (
          <>
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-ok" />
              <span className="text-[12px] text-ok">Suggested for this section · {variantWord}</span>
            </div>
            {suggestions.map(s => (
              <PickRow key={s.productType} active={picked?.productType === s.productType}
                title={s.productType} code={s.code} match={s.match}
                onClick={() => setPicked({ productType: s.productType, code: s.code, description: s.description, isLeaf: s.isLeaf })} />
            ))}
          </>
        ) : (
          <>
            <span className="text-[12px] text-text-muted">{results.length} match{results.length === 1 ? '' : 'es'}</span>
            {results.map(it => (
              <PickRow key={it.inventory_id} active={picked?.code === it.inventory_id}
                title={it.description ?? it.inventory_id} code={it.inventory_id}
                onClick={() => setPicked({ productType: it.description ?? it.inventory_id, code: it.inventory_id, description: it.description ?? '', isLeaf: false })} />
            ))}
          </>
        )}

        {picked && (
          <div className="pt-2 border-t border-stone-100 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Weight (kg) *</label>
                <input autoFocus type="number" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} className={INP} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Batch</label>
                <input value={batch} onChange={e => setBatch(e.target.value)} className={INP} />
              </div>
              {picked.isLeaf && (
                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Destination</label>
                  <select value={destination} onChange={e => setDestination(e.target.value)} className={INP + ' cursor-pointer'}>
                    {DESTINATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
            </div>
            <button onClick={confirm} disabled={!weight}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[14px] font-medium disabled:opacity-40">
              <Printer size={16} /> Add &amp; print label
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PickRow({ active, title, code, match, onClick }: {
  active: boolean; title: string; code: string | null; match?: number; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${active ? 'border-brand bg-brand/5' : 'border-stone-200 hover:border-brand/40'}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-text truncate">{title}</div>
        {code && <div className="font-mono text-[11px] text-text-muted">{code}</div>}
      </div>
      {match != null && <span className="text-[11px] px-2 py-0.5 rounded-full bg-ok/10 text-ok shrink-0">{match}%</span>}
    </button>
  )
}

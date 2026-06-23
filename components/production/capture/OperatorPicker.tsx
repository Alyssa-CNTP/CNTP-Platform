'use client'

import { useState } from 'react'
import { Search, X, CheckCircle2, Plus } from 'lucide-react'
import type { Operator } from '@/lib/supabase/database.types'

/**
 * Searchable operator roster picker. Lists every active operator (sourced from
 * the employee import) — the supervisor types a name to find someone and taps
 * to roster them. Selected operators show as removable chips above the search.
 */
export function OperatorPicker({ operators, selectedIds, onToggle, onLeaveIds }: {
  operators: Operator[]
  selectedIds: string[]
  onToggle: (id: string) => void
  /** Operator ids who are on leave for the selected date — flagged in the list. */
  onLeaveIds?: Set<string>
}) {
  const [query, setQuery]     = useState('')
  const [focused, setFocused] = useState(false)
  const onLeave = (id: string) => onLeaveIds?.has(id) ?? false

  const selected = operators.filter(op => selectedIds.includes(op.id))
  const q = query.trim().toLowerCase()
  const matches = operators
    .filter(op => !selectedIds.includes(op.id))
    .filter(op => q === '' || (op.display_name || op.name).toLowerCase().includes(q))
    .slice(0, 8)

  const label = (op: Operator) => op.display_name || op.name

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(op => (
            <span key={op.id} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium ${onLeave(op.id) ? 'bg-amber-500 text-white' : 'bg-brand text-white'}`}>
              <CheckCircle2 size={13} />
              {label(op)}
              {onLeave(op.id) && <span className="opacity-80">· on leave</span>}
              {op.role === 'production_supervisor' && <span className="opacity-60">· Sup</span>}
              <button onClick={() => onToggle(op.id)} className="ml-0.5 opacity-70 hover:opacity-100"><X size={14} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="flex items-center gap-2 px-3 rounded-xl border border-stone-200 bg-white focus-within:border-brand">
          <Search size={15} className="text-stone-400" />
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search a name to roster…"
            className="flex-1 py-2.5 text-[13px] outline-none bg-transparent"
          />
        </div>
        {focused && matches.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg max-h-64 overflow-y-auto divide-y divide-stone-100">
            {matches.map(op => (
              <button
                key={op.id} type="button"
                onMouseDown={e => { e.preventDefault(); onToggle(op.id); setQuery('') }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[13px] text-text hover:bg-brand/5"
              >
                <Plus size={14} className="text-stone-400 shrink-0" />
                <span className="flex-1">{label(op)}</span>
                {onLeave(op.id) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">on leave</span>}
                {op.role === 'production_supervisor' && <span className="text-[11px] text-text-muted">Sup</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

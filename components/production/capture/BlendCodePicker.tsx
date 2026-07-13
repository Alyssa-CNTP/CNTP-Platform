'use client'

// Supervisor-side blend-code picker for the Assign screen — lists blends from the
// Blends (BOM) page, filtered to the chosen variant, single-select (a shift runs
// exactly one blend). Selecting one writes into the section's `prodOrders` field,
// which the capture screen reads to know which BOM to release ingredients for.

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { listBlenderBoms, type BlenderBomSummary } from '@/lib/production/bom'

export function BlendCodePicker({ variant, selected, onSelect }: {
  variant: string
  selected: string[]
  onSelect: (bomId: string) => void
}) {
  const [boms, setBoms] = useState<BlenderBomSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    listBlenderBoms(variant || null).then(rows => { setBoms(rows); setLoading(false) })
  }, [variant])

  if (loading) return <p className="text-[12px] text-stone-400 px-1">Loading blends…</p>
  if (boms.length === 0) {
    return (
      <p className="text-[12px] text-stone-400 px-1">
        No blends found{variant ? ` for ${variant}` : ''} — add one on the{' '}
        <a href="/production/blends" className="text-brand underline">Blends</a> page.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {boms.map(b => {
        const on = selected.includes(b.bomId)
        return (
          <button key={b.bomId} type="button" onClick={() => onSelect(b.bomId)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200 hover:border-brand/40'}`}>
            {on ? <CheckCircle2 size={14} className="shrink-0" /> : <span className="w-3.5 shrink-0" />}
            <span className="flex-1 text-[13px]">{b.outputDescription || b.outputItemId}</span>
            {!b.itemFound && <AlertTriangle size={13} className={on ? 'text-white/80' : 'text-warn'} title="Output item not found in Master Inventory" />}
            <span className={`font-mono text-[11px] ${on ? 'opacity-80' : 'text-text-muted'}`}>{b.bomId}</span>
          </button>
        )
      })}
      <p className="text-[10px] text-stone-400 px-1">One blend per shift. Manage blend recipes on the Blends page.</p>
    </div>
  )
}

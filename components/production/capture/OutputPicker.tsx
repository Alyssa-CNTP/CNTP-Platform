'use client'

import { useState, useEffect } from 'react'
import { Search, Sparkles, X, Printer, Check } from 'lucide-react'
import { suggestOutputs, loadAllInventory, filterInventory, recentBatches } from '@/lib/production/inventory'
import { LABEL_PRINTING_ENABLED } from '@/lib/production/capture-config'
import { BatchInput } from '@/components/production/capture/BatchInput'
import type { InventoryItem } from '@/lib/supabase/database.types'

export interface PickedOutput {
  productType: string
  code: string | null
  description: string
  weight: string
  batch: string
}

const INP = 'w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'

// Standard full-bag weights so the operator only overrides for end-of-shift
// half bags. Matched on the item description/name; '' = no standard (type it in).
function standardWeight(label: string): string {
  const s = label.toLowerCase()
  if (/indent stick/.test(s)) return '252'
  if (/fine leaf/.test(s) || /coarse leaf/.test(s)) return '300'
  return ''
}

/**
 * Easy output picker: the few items that fit the section + variant up top
 * (AI-suggested), full 630-item master search only when the operator looks.
 */
export function OutputPicker({ sectionId, variantWord, gradeLetter = 'A', defaultBatch, batchHints = [], onAdd, onClose }: {
  sectionId: string
  variantWord: string
  gradeLetter?: string
  defaultBatch: string
  batchHints?: string[]
  onAdd: (p: PickedOutput) => void
  onClose: () => void
}) {
  const [dbBatches, setDbBatches] = useState<string[]>([])
  useEffect(() => { recentBatches(sectionId).then(setDbBatches) }, [sectionId])
  const batchOptions = Array.from(new Set([...batchHints, ...dbBatches].filter(Boolean)))
  const [query, setQuery]     = useState('')
  const [all, setAll]         = useState<InventoryItem[]>([])
  const [picked, setPicked]   = useState<{ productType: string; code: string | null; description: string; batchTracked: boolean } | null>(null)
  const [weight, setWeight]   = useState('')
  const [batch, setBatch]     = useState(defaultBatch)

  // Load the master list once; filtering is then instant on every keystroke.
  useEffect(() => { loadAllInventory().then(setAll) }, [])

  // The curated family shortlist for this section + variant + destination
  // (Fine/Coarse Leaf, Blocks, Rolsiev/Indent Sticks, Brown/Powder Dust) — codes
  // come from the canonical getAcumaticaCode map. Waste streams (no code) drop out.
  const outputs = suggestOutputs(sectionId, variantWord, gradeLetter).filter(o => o.code)
  const results = filterInventory(all, query, variantWord)
  function onSearch(q: string) { setQuery(q) }

  function confirm() {
    if (!picked || !weight) return
    if (picked.batchTracked && !batch.trim()) return
    // Internally-tracked items carry no operator batch — the barcode is the record.
    onAdd({ productType: picked.productType, code: picked.code, description: picked.description, weight, batch: picked.batchTracked ? (batch || defaultBatch) : '' })
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
              <span className="text-[12px] text-ok">Outputs for {variantWord}{outputs.length ? '' : ' — loading…'}</span>
            </div>
            {outputs.map(o => (
              <PickRow key={o.code ?? o.productType} active={picked?.code === o.code}
                title={o.productType} code={o.code}
                onClick={() => { setPicked({ productType: o.productType, code: o.code, description: o.description, batchTracked: o.isLeaf }); setWeight(standardWeight(o.productType)) }} />
            ))}
          </>
        ) : (
          <>
            <span className="text-[12px] text-text-muted">{results.length} match{results.length === 1 ? '' : 'es'}</span>
            {results.map(it => (
              <PickRow key={it.inventory_id} active={picked?.code === it.inventory_id}
                title={it.description ?? it.inventory_id} code={it.inventory_id} highlight={query}
                onClick={() => { setPicked({ productType: it.description ?? it.inventory_id, code: it.inventory_id, description: it.description ?? '', batchTracked: /leaf/i.test(it.description ?? '') }); setWeight(standardWeight(it.description ?? it.inventory_id)) }} />
            ))}
          </>
        )}

        {picked && (
          <div className="pt-2 border-t border-stone-100 space-y-3">
            <div className={`grid gap-3 ${picked.batchTracked ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Weight (kg) *</label>
                <input autoFocus type="number" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} className={INP} />
              </div>
              {picked.batchTracked && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Batch *</label>
                  <BatchInput value={batch} onChange={setBatch} options={batchOptions} placeholder="Type or pick a batch" className={INP} />
                </div>
              )}
            </div>
            {!picked.batchTracked && (
              <p className="text-[11px] text-text-muted flex items-center gap-1.5"><Check size={12} /> Tracked by its bag number{LABEL_PRINTING_ENABLED ? ' (barcode)' : ''} — no batch number needed.</p>
            )}
            {picked.code && <p className="text-[11px] text-text-muted font-mono">{picked.code} · {picked.description}</p>}
            <button onClick={confirm} disabled={!weight}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[14px] font-medium disabled:opacity-40">
              {LABEL_PRINTING_ENABLED ? <><Printer size={16} /> Add &amp; print label</> : <><Check size={16} /> Complete bag</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function hl(text: string, q?: string) {
  if (!q || !q.trim()) return text
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase())
  if (i < 0) return text
  const end = i + q.trim().length
  return <>{text.slice(0, i)}<mark className="bg-brand/15 text-brand rounded px-0.5">{text.slice(i, end)}</mark>{text.slice(end)}</>
}

function PickRow({ active, title, code, match, highlight, onClick }: {
  active: boolean; title: string; code: string | null; match?: number; highlight?: string; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${active ? 'border-brand bg-brand/5' : 'border-stone-200 hover:border-brand/40'}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-text truncate">{hl(title, highlight)}</div>
        {code && <div className="font-mono text-[11px] text-text-muted">{hl(code, highlight)}</div>}
      </div>
      {match != null && <span className="text-[11px] px-2 py-0.5 rounded-full bg-ok/10 text-ok shrink-0">{match}%</span>}
    </button>
  )
}

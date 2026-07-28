'use client'

// app/(app)/production/blends/page.tsx
// BOMs — full BOM catalogue over production.bom_components, every work centre
// in the plant (Sieving through Packing). Blender BOMs keep their editable
// header/detail grid (components validated against Master Inventory via the
// item picker, read live by Blender capture — lib/production/bom.ts, an edit
// here is visible in capture immediately, no publish step). Every other work
// centre is browse-only reference data: this page is where a Pasteuriser BOM's
// Acumatica code and blend/final ratios actually live now, filterable by work
// centre and free-text search.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Check, X, ChevronDown, ChevronRight, Trash2, Layers, AlertTriangle, ArrowUpRight, FileText } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { loadAllInventory } from '@/lib/production/inventory'
import { matchColumn, findParentBlendBom, type ParentBlendBom } from '@/lib/production/bom'
import { ItemPicker } from '@/components/production/capture/ItemPicker'
import type { InventoryItem } from '@/lib/supabase/database.types'

// Only these two work centres get the editable grid + "Add blend" affordance —
// that's where the capture-release relationship lives (BlenderCapture reads
// this table directly). Every other work centre below is browse-only.
const EDITABLE_WORK_CENTRES = ['05-BLENDER BIG', '05-BLENDER SMALL']
const ALL_WORK_CENTRES = [
  '01-SIEVING', '02-REFINING1', '03-REFINING2', '04-GRANULATION',
  '05-BLENDER BIG', '05-BLENDER SMALL', '06-PASTEURISING', '08-PACKING',
  '12RHHAMMER', '15-RHBLENDING', '20-SCARIFICATION', '21-CHEMICAL TREATMEN',
]
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F']
function isEditableWorkCentre(wc: string) { return EDITABLE_WORK_CENTRES.includes(wc) }

interface BomRow {
  id: string
  bom_id: string
  output_item_id: string
  output_description: string | null
  work_centre: string
  component_item_id: string
  component_description: string | null
  line_nbr: number
  qty_required: number
  uom: string | null
  ingredient_column: string | null
}

interface BlendGroup {
  bomId: string
  outputItemId: string
  outputDescription: string | null
  workCentre: string
  components: BomRow[]
}

function variantFromSuffix(itemId: string): string | null {
  if (itemId.endsWith('-RO')) return 'RA-Organic'
  if (itemId.endsWith('-RC')) return 'RA-Conventional'
  if (itemId.endsWith('-FO')) return 'FT-ORG'
  if (itemId.endsWith('-FC')) return 'FT-CON'
  if (itemId.endsWith('-O'))  return 'Organic'
  if (itemId.endsWith('-C'))  return 'Conventional'
  return null
}

export default function BlendsPage() {
  const { p, isFullAdmin } = useAuth()
  const canEdit = isFullAdmin || p('can_edit_blends')
  const canDelete = isFullAdmin || p('can_delete_blends')
  const canGenerateJobCards = isFullAdmin || p('can_generate_job_cards')

  const [rows, setRows] = useState<BomRow[]>([])
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [workCentreFilter, setWorkCentreFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [addingBlend, setAddingBlend] = useState(false)

  async function reload() {
    const { data } = await getDb().schema('production').from('bom_components')
      .select('*').order('bom_id').order('line_nbr')
    setRows((data as BomRow[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { reload(); loadAllInventory().then(setItems) }, [])

  const itemsById = useMemo(() => new Map(items.map(i => [i.inventory_id, i])), [items])

  const groups = useMemo<BlendGroup[]>(() => {
    const byBom = new Map<string, BlendGroup>()
    for (const r of rows) {
      let g = byBom.get(r.bom_id)
      if (!g) {
        g = { bomId: r.bom_id, outputItemId: r.output_item_id, outputDescription: r.output_description, workCentre: r.work_centre, components: [] }
        byBom.set(r.bom_id, g)
      }
      g.components.push(r)
    }
    return Array.from(byBom.values()).sort((a, b) => a.bomId.localeCompare(b.bomId))
  }, [rows])

  const filteredGroups = useMemo(() => {
    let list = groups
    if (workCentreFilter !== 'all') list = list.filter(g => g.workCentre === workCentreFilter)
    const t = q.trim().toLowerCase()
    if (t) list = list.filter(g => `${g.bomId} ${g.outputDescription ?? ''} ${g.outputItemId}`.toLowerCase().includes(t))
    return list
  }, [groups, q, workCentreFilter])

  const workCentreCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of groups) counts.set(g.workCentre, (counts.get(g.workCentre) ?? 0) + 1)
    return counts
  }, [groups])

  const stats = useMemo(() => {
    const big = groups.filter(g => g.workCentre === '05-BLENDER BIG').length
    const small = groups.filter(g => g.workCentre === '05-BLENDER SMALL').length
    const pasteuriser = groups.filter(g => g.workCentre === '06-PASTEURISING').length
    const mismatched = rows.filter(r => !itemsById.has(r.component_item_id) || !itemsById.has(r.output_item_id)).length
    return { total: groups.length, big, small, pasteuriser, mismatched }
  }, [groups, rows, itemsById])

  async function addComponent(g: BlendGroup, componentItemId: string, description: string, qtyPct: number) {
    const nextLine = Math.max(0, ...g.components.map(c => c.line_nbr)) + 1
    const { data, error } = await getDb().schema('production').from('bom_components').insert({
      bom_id: g.bomId, output_item_id: g.outputItemId, output_description: g.outputDescription,
      work_centre: g.workCentre, component_item_id: componentItemId, component_description: description,
      line_nbr: nextLine, qty_required: qtyPct / 100, ingredient_column: matchColumn(description),
    } as any).select().single()
    if (error) { alert(error.message); return }
    setRows(rs => [...rs, data as BomRow])
  }

  async function updateComponent(id: string, patch: Partial<BomRow>) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    const dbPatch: any = { ...patch }
    if ('qty_required' in dbPatch) dbPatch.qty_required = patch.qty_required
    await getDb().schema('production').from('bom_components').update(dbPatch).eq('id', id)
  }

  async function removeComponent(id: string) {
    setRows(rs => rs.filter(r => r.id !== id))
    await getDb().schema('production').from('bom_components').delete().eq('id', id)
  }

  async function removeBlend(bomId: string) {
    if (!confirm(`Delete blend ${bomId} and all its components? This cannot be undone.`)) return
    setRows(rs => rs.filter(r => r.bom_id !== bomId))
    await getDb().schema('production').from('bom_components').delete().eq('bom_id', bomId)
  }

  async function addBlend(bomId: string, outputItemId: string, workCentre: string, firstComponentId: string, firstDesc: string) {
    const outputDesc = itemsById.get(outputItemId)?.description ?? null
    const { data, error } = await getDb().schema('production').from('bom_components').insert({
      bom_id: bomId, output_item_id: outputItemId, output_description: outputDesc, work_centre: workCentre,
      component_item_id: firstComponentId, component_description: firstDesc,
      line_nbr: 1, qty_required: 1, ingredient_column: matchColumn(firstDesc),
    } as any).select().single()
    if (error) { alert(error.message); return }
    setRows(rs => [...rs, data as BomRow])
    setAddingBlend(false)
    setExpanded(bomId)
  }

  if (loading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="rounded-xl border border-surface-rule bg-surface-card p-6 text-text-muted text-sm">Loading…</div></div>

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">BOMs</h1>
        <p className="text-sm text-text-muted mt-1">The full bill-of-materials catalogue — every work centre, from Sieving through Packing. Blender BOMs are editable and Blender capture releases exactly what's defined here; every other work centre is reference data for browsing Acumatica codes, blend ratios and job-card generation.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Total BOMs" value={stats.total} />
        <Stat label="Big Blender" value={stats.big} />
        <Stat label="Pasteuriser" value={stats.pasteuriser} />
        <Stat label="Unresolved item links" value={stats.mismatched} tone={stats.mismatched ? 'warn' : undefined} />
      </div>

      <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-sm font-semibold text-text flex items-center gap-2"><Layers className="w-4 h-4" /> BOMs</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={workCentreFilter} onChange={e => setWorkCentreFilter(e.target.value)}
              className="h-9 rounded-lg border border-surface-rule bg-surface-card px-2 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All work centres ({groups.length})</option>
              {ALL_WORK_CENTRES.map(w => (
                <option key={w} value={w}>{w} ({workCentreCounts.get(w) ?? 0})</option>
              ))}
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search BOM code, item, description…"
                className="h-9 w-56 rounded-lg border border-surface-rule bg-surface-card pl-8 pr-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            {canEdit && (
              <button onClick={() => setAddingBlend(a => !a)}
                className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-3 h-9 text-[13px] font-semibold">
                <Plus className="w-4 h-4" /> Add blend
              </button>
            )}
          </div>
        </div>

        {addingBlend && <AddBlendRow items={items} onAdd={addBlend} onCancel={() => setAddingBlend(false)} />}

        <div className="space-y-2">
          {filteredGroups.map(g => (
            <BlendGroupRow key={g.bomId} g={g} items={items} itemsById={itemsById}
              expanded={expanded === g.bomId} onToggle={() => setExpanded(expanded === g.bomId ? null : g.bomId)}
              canEdit={canEdit && isEditableWorkCentre(g.workCentre)} canDelete={canDelete && isEditableWorkCentre(g.workCentre)}
              canGenerateJobCards={canGenerateJobCards}
              onAddComponent={addComponent} onUpdateComponent={updateComponent}
              onRemoveComponent={removeComponent} onRemoveBlend={removeBlend} />
          ))}
          {filteredGroups.length === 0 && (
            <div className="text-[12px] text-text-faint py-6 text-center">
              {q ? 'No BOMs match your search.' : 'No BOMs yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BlendGroupRow({ g, items, itemsById, expanded, onToggle, canEdit, canDelete, canGenerateJobCards, onAddComponent, onUpdateComponent, onRemoveComponent, onRemoveBlend }: {
  g: BlendGroup; items: InventoryItem[]; itemsById: Map<string, InventoryItem>
  expanded: boolean; onToggle: () => void; canEdit: boolean; canDelete: boolean; canGenerateJobCards: boolean
  onAddComponent: (g: BlendGroup, componentItemId: string, description: string, qtyPct: number) => void
  onUpdateComponent: (id: string, patch: Partial<BomRow>) => void
  onRemoveComponent: (id: string) => void
  onRemoveBlend: (bomId: string) => void
}) {
  const variant = itemsById.get(g.outputItemId)?.variant ?? variantFromSuffix(g.outputItemId)
  const totalPct = g.components.reduce((s, c) => s + c.qty_required, 0) * 100
  const outOfRange = Math.abs(totalPct - 100) > 1
  const outputFound = itemsById.has(g.outputItemId)

  return (
    <div className="rounded-lg border border-surface-rule overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-dim/40 text-left">
        {expanded ? <ChevronDown className="w-4 h-4 text-text-faint shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-faint shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-text">{g.bomId}</span>
            <span className="text-[12px] text-text-muted truncate">{g.outputDescription ?? g.outputItemId}</span>
            {!outputFound && <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" title="Output item not found in Master Inventory" />}
          </div>
          <div className="text-[10px] text-text-faint mt-0.5">{g.workCentre} · {variant ?? 'variant unknown'} · {g.components.length} component{g.components.length !== 1 ? 's' : ''}</div>
        </div>
        <span className={`text-[12px] font-mono font-semibold ${outOfRange ? 'text-warn' : 'text-ok'}`}>{totalPct.toFixed(0)}%</span>
        {canGenerateJobCards && g.workCentre === '06-PASTEURISING' && (
          <Link href={`/job-cards/pasteuriser?bomId=${encodeURIComponent(g.bomId)}`} onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-brand/10 text-brand text-[11px] font-semibold hover:bg-brand/20 shrink-0">
            <FileText className="w-3 h-3" /> Generate job card
          </Link>
        )}
        {canDelete && (
          <span onClick={e => { e.stopPropagation(); onRemoveBlend(g.bomId) }} className="text-text-faint hover:text-err p-1">
            <Trash2 className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-surface-rule bg-surface-dim/20 p-3 space-y-2">
          {outOfRange && (
            <div className="flex items-center gap-1.5 text-[11px] text-warn px-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Components sum to {totalPct.toFixed(1)}% — should be ~100%.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-surface-rule">
                  <th className="text-left font-semibold py-1.5 px-2">Component item</th>
                  <th className="text-left font-semibold py-1.5 px-2 w-24">Column</th>
                  <th className="text-right font-semibold py-1.5 px-2 w-24">Qty %</th>
                  <th className="py-1.5 px-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {g.components.map(c => (
                  <ComponentRow key={c.id} c={c} found={itemsById.has(c.component_item_id)} canEdit={canEdit}
                    onUpdate={onUpdateComponent} onRemove={onRemoveComponent} />
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && <AddComponentRow g={g} items={items} onAdd={onAddComponent} />}
          {g.workCentre === '06-PASTEURISING' && <ParentBlendPanel bomId={g.bomId} itemsById={itemsById} />}
        </div>
      )}
    </div>
  )
}

// The paper job card's "before granules" blend ratio table lives one hop up
// the chain — the Blender BOM that this Pasteuriser BOM's own "Blend: xxx"
// component resolves to. Shown inline so browsing the catalogue surfaces the
// full chain without leaving the page.
function ParentBlendPanel({ bomId, itemsById }: { bomId: string; itemsById: Map<string, InventoryItem> }) {
  const [state, setState] = useState<'loading' | 'none' | ParentBlendBom>('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    findParentBlendBom(bomId).then(res => { if (!cancelled) setState(res ?? 'none') })
    return () => { cancelled = true }
  }, [bomId])

  if (state === 'loading') return <div className="text-[11px] text-text-faint pt-2 px-1">Resolving parent blend…</div>
  if (state === 'none') return null

  const parent = state as ParentBlendBom
  const total = parent.components.reduce((s, c) => s + c.qtyRequired, 0) * 100

  return (
    <div className="mt-2 rounded-lg border border-brand/20 bg-accent-bg/30 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text mb-1.5">
        <ArrowUpRight className="w-3.5 h-3.5 text-brand" />
        Blend ratio (before granules) — <span className="font-mono">{parent.bomId}</span>
        <span className="text-text-muted font-normal">{parent.outputDescription}</span>
      </div>
      <table className="w-full text-[12px]">
        <tbody>
          {parent.components.map(c => (
            <tr key={c.id} className="border-b border-surface-rule/40 last:border-0">
              <td className="py-1 pr-2">
                <div className="flex items-center gap-1.5">
                  {!itemsById.has(c.componentItemId) && <AlertTriangle className="w-3 h-3 text-warn shrink-0" title="Not found in Master Inventory" />}
                  <span className="font-mono text-[11px] text-text">{c.componentItemId}</span>
                  <span className="text-[11px] text-text-muted truncate">{c.componentDescription}</span>
                </div>
              </td>
              <td className="py-1 pl-2 text-right font-mono text-[12px] text-text w-20">{(c.qtyRequired * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`text-[10px] mt-1 text-right ${Math.abs(total - 100) > 1 ? 'text-warn' : 'text-text-faint'}`}>Total: {total.toFixed(1)}%</div>
    </div>
  )
}

function ComponentRow({ c, found, canEdit, onUpdate, onRemove }: {
  c: BomRow; found: boolean; canEdit: boolean
  onUpdate: (id: string, patch: Partial<BomRow>) => void
  onRemove: (id: string) => void
}) {
  const [pct, setPct] = useState(String(Math.round(c.qty_required * 1000) / 10))
  return (
    <tr className="border-b border-surface-rule/60">
      <td className="py-1 px-2">
        <div className="flex items-center gap-1.5">
          {!found && <AlertTriangle className="w-3 h-3 text-warn shrink-0" title="Not found in Master Inventory" />}
          <span className="font-mono text-[11px] text-text">{c.component_item_id}</span>
          <span className="text-[11px] text-text-muted truncate">{c.component_description}</span>
        </div>
      </td>
      <td className="py-1 px-2">
        <select value={c.ingredient_column ?? ''} disabled={!canEdit}
          onChange={e => onUpdate(c.id, { ingredient_column: e.target.value || null })}
          className="bg-transparent border border-transparent hover:border-surface-rule focus:border-brand rounded px-1.5 py-1 text-[11px] text-text-muted focus:outline-none disabled:opacity-60">
          <option value="">—</option>
          {COLUMNS.map(col => <option key={col} value={col}>{col}</option>)}
        </select>
      </td>
      <td className="py-1 px-2 text-right">
        <input value={pct} disabled={!canEdit} inputMode="decimal"
          onChange={e => setPct(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={() => { const n = parseFloat(pct) || 0; onUpdate(c.id, { qty_required: n / 100 }) }}
          className="w-16 text-right bg-transparent border border-transparent hover:border-surface-rule focus:border-brand rounded px-1.5 py-1 text-[12px] text-text focus:outline-none disabled:opacity-60" />
      </td>
      <td className="py-1 px-2">
        {canEdit && <button onClick={() => onRemove(c.id)} className="text-text-faint hover:text-err"><Trash2 className="w-3.5 h-3.5" /></button>}
      </td>
    </tr>
  )
}

function AddComponentRow({ g, items, onAdd }: { g: BlendGroup; items: InventoryItem[]; onAdd: (g: BlendGroup, id: string, desc: string, pct: number) => void }) {
  const [picked, setPicked] = useState<InventoryItem | null>(null)
  const [pct, setPct] = useState('')
  const submit = () => {
    if (!picked || !pct.trim()) return
    onAdd(g, picked.inventory_id, picked.description ?? picked.inventory_id, parseFloat(pct) || 0)
    setPicked(null); setPct('')
  }
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="flex-1"><ItemPicker items={items} onPick={setPicked} placeholder="Search component item…" /></div>
      <input value={pct} onChange={e => setPct(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="%" inputMode="decimal"
        className="h-9 w-20 rounded-lg border border-surface-rule px-2 text-[13px] text-right" />
      <button onClick={submit} disabled={!picked || !pct.trim()}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white disabled:opacity-40"><Check className="w-4 h-4" /></button>
    </div>
  )
}

function AddBlendRow({ items, onAdd, onCancel }: {
  items: InventoryItem[]
  onAdd: (bomId: string, outputItemId: string, workCentre: string, firstComponentId: string, firstDesc: string) => void
  onCancel: () => void
}) {
  const [bomId, setBomId] = useState('')
  const [output, setOutput] = useState<InventoryItem | null>(null)
  const [workCentre, setWorkCentre] = useState(EDITABLE_WORK_CENTRES[0])
  const [component, setComponent] = useState<InventoryItem | null>(null)
  const submit = () => {
    if (!bomId.trim() || !output || !component) return
    onAdd(bomId.trim().toUpperCase(), output.inventory_id, workCentre, component.inventory_id, component.description ?? component.inventory_id)
    setBomId(''); setOutput(null); setComponent(null)
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_170px_1fr_auto] gap-2 items-start p-3 mb-3 rounded-lg border border-brand/20 bg-accent-bg/40">
      <input autoFocus value={bomId} onChange={e => setBomId(e.target.value.toUpperCase())} placeholder="Blend code *"
        className="h-9 rounded-lg border border-surface-rule px-2 text-[13px] font-mono" />
      <ItemPicker items={items} onPick={setOutput} placeholder="Output item *" />
      <select value={workCentre} onChange={e => setWorkCentre(e.target.value)} className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]">
        {EDITABLE_WORK_CENTRES.map(w => <option key={w} value={w}>{w}</option>)}
      </select>
      <ItemPicker items={items} onPick={setComponent} placeholder="First component item *" />
      <div className="flex gap-1.5">
        <button onClick={submit} disabled={!bomId.trim() || !output || !component}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white disabled:opacity-40"><Check className="w-4 h-4" /></button>
        <button onClick={onCancel} className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-surface-dim text-text-muted"><X className="w-4 h-4" /></button>
      </div>
    </div>
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

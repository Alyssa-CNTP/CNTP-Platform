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
//
// Layout: master-detail split (list on the left, one BOM's full detail on the
// right) rather than an in-page accordion — expanding one BOM used to collapse
// any other and shared vertical space with every other BOM on the page. The
// list stays sticky/scrollable on desktop; on narrow screens the detail pane
// takes over the full screen with a "back to list" affordance. The selected
// BOM is reflected in ?bomId= so it's shareable/deep-linkable, same as the
// existing ?workCentre= filter.

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Check, X, ChevronLeft, Trash2, Layers, AlertTriangle, ArrowUpRight, FileText } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { loadAllInventory } from '@/lib/production/inventory'
import { matchColumn, findParentBlendBom, type ParentBlendBom } from '@/lib/production/bom'
import { InventoryPickerModal } from '@/components/production/InventoryPickerModal'
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

function BlendsScreen() {
  const { p, isFullAdmin } = useAuth()
  const canEdit = isFullAdmin || p('can_edit_blends')
  const canDelete = isFullAdmin || p('can_delete_blends')
  const canGenerateJobCards = isFullAdmin || p('can_generate_job_cards')
  const router = useRouter()
  const searchParams = useSearchParams()
  const deepLinkWorkCentre = searchParams.get('workCentre')

  const [rows, setRows] = useState<BomRow[]>([])
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [workCentreFilter, setWorkCentreFilter] = useState<string>(deepLinkWorkCentre ?? 'all')
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)
  const [selectedBomId, setSelectedBomId] = useState<string | null>(searchParams.get('bomId'))
  const [creating, setCreating] = useState(false)
  const [pickerCb, setPickerCb] = useState<((it: InventoryItem) => void) | null>(null)

  function openPicker(cb: (it: InventoryItem) => void) { setPickerCb(() => cb) }

  function selectBom(id: string | null) {
    setSelectedBomId(id)
    setCreating(false)
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('bomId', id); else params.delete('bomId')
    router.replace(`/production/blends?${params.toString()}`, { scroll: false })
  }

  function startCreating() {
    selectBom(null)
    setCreating(true)
  }

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

  const isUnresolved = (g: BlendGroup) =>
    !itemsById.has(g.outputItemId) || g.components.some(c => !itemsById.has(c.component_item_id))

  const filteredGroups = useMemo(() => {
    let list = groups
    if (workCentreFilter !== 'all') list = list.filter(g => g.workCentre === workCentreFilter)
    if (unresolvedOnly) list = list.filter(isUnresolved)
    const t = q.trim().toLowerCase()
    if (t) list = list.filter(g => `${g.bomId} ${g.outputDescription ?? ''} ${g.outputItemId}`.toLowerCase().includes(t))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, q, workCentreFilter, unresolvedOnly, itemsById])

  const selectedGroup = useMemo(() => groups.find(g => g.bomId === selectedBomId) ?? null, [groups, selectedBomId])

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
    if (selectedBomId === bomId) selectBom(null)
    await getDb().schema('production').from('bom_components').delete().eq('bom_id', bomId)
  }

  async function addBlend(bomId: string, output: InventoryItem, workCentre: string, comps: { item: InventoryItem; pct: number }[]) {
    const payload = comps.map((c, i) => ({
      bom_id: bomId, output_item_id: output.inventory_id, output_description: output.description ?? null,
      work_centre: workCentre, component_item_id: c.item.inventory_id,
      component_description: c.item.description ?? c.item.inventory_id,
      line_nbr: i + 1, qty_required: c.pct / 100, ingredient_column: matchColumn(c.item.description),
    }))
    const { data, error } = await getDb().schema('production').from('bom_components').insert(payload as any).select()
    if (error) { alert(error.message); return }
    setRows(rs => [...rs, ...(data as BomRow[])])
    selectBom(bomId)
  }

  if (loading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="rounded-xl border border-surface-rule bg-surface-card p-6 text-text-muted text-sm">Loading…</div></div>

  const showDetail = !!selectedGroup || creating

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
        <Stat label="Unresolved item links" value={stats.mismatched} tone={stats.mismatched ? 'warn' : undefined}
          onClick={stats.mismatched ? () => setUnresolvedOnly(v => !v) : undefined} active={unresolvedOnly} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4 items-start">
        {/* ── List (sidebar on desktop, full screen when nothing selected on mobile) ── */}
        <div className={`rounded-xl border border-surface-rule bg-surface-card p-3 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto ${showDetail ? 'hidden md:block' : ''}`}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-text flex items-center gap-2"><Layers className="w-4 h-4" /> BOMs</h2>
            {canEdit && (
              <button onClick={startCreating}
                className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-2.5 h-8 text-[12px] font-semibold shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>

          <div className="space-y-2 mb-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search BOM code, item, description…"
                className="h-9 w-full rounded-lg border border-surface-rule bg-surface-card pl-8 pr-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <select value={workCentreFilter} onChange={e => setWorkCentreFilter(e.target.value)}
              className="h-9 w-full rounded-lg border border-surface-rule bg-surface-card px-2 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30">
              <option value="all">All work centres ({groups.length})</option>
              {ALL_WORK_CENTRES.map(w => (
                <option key={w} value={w}>{w} ({workCentreCounts.get(w) ?? 0})</option>
              ))}
            </select>
            {unresolvedOnly && (
              <button onClick={() => setUnresolvedOnly(false)}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-warn bg-warn/10 rounded-lg px-2.5 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Unresolved only <X className="w-3 h-3 ml-auto" />
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {filteredGroups.map(g => (
              <BomListItem key={g.bomId} g={g} selected={selectedBomId === g.bomId}
                unresolved={isUnresolved(g)} onSelect={() => selectBom(g.bomId)} />
            ))}
            {filteredGroups.length === 0 && (
              <div className="text-[12px] text-text-faint py-6 text-center">
                {q || unresolvedOnly ? 'No BOMs match your filters.' : 'No BOMs yet.'}
              </div>
            )}
          </div>
        </div>

        {/* ── Detail pane ───────────────────────────────────────────────────── */}
        <div className={showDetail ? '' : 'hidden md:block'}>
          {creating ? (
            <NewBomForm onSave={addBlend} onCancel={() => setCreating(false)} openPicker={openPicker} onBack={() => setCreating(false)} />
          ) : selectedGroup ? (
            <BomDetail g={selectedGroup} itemsById={itemsById}
              canEdit={canEdit && isEditableWorkCentre(selectedGroup.workCentre)}
              canDelete={canDelete && isEditableWorkCentre(selectedGroup.workCentre)}
              canGenerateJobCards={canGenerateJobCards}
              onAddComponent={addComponent} onUpdateComponent={updateComponent}
              onRemoveComponent={removeComponent} onRemoveBlend={removeBlend}
              onBack={() => selectBom(null)} openPicker={openPicker} />
          ) : (
            <div className="rounded-xl border border-dashed border-surface-rule p-10 text-center text-text-faint text-[13px]">
              Select a BOM from the list, or add a new one.
            </div>
          )}
        </div>
      </div>

      <InventoryPickerModal items={items} open={!!pickerCb} onClose={() => setPickerCb(null)}
        onPick={it => { pickerCb?.(it); setPickerCb(null) }} />
    </div>
  )
}

export default function BlendsPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6 text-sm text-text-muted">Loading…</div>}>
      <BlendsScreen />
    </Suspense>
  )
}

function BomListItem({ g, selected, unresolved, onSelect }: {
  g: BlendGroup; selected: boolean; unresolved: boolean; onSelect: () => void
}) {
  const totalPct = g.components.reduce((s, c) => s + c.qty_required, 0) * 100
  const outOfRange = Math.abs(totalPct - 100) > 1
  return (
    <button onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${selected ? 'border-brand bg-accent-bg/40' : 'border-transparent hover:bg-surface-dim/40'}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-text">{g.bomId}</span>
        {unresolved && <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />}
        <span className={`ml-auto text-[11px] font-mono shrink-0 ${outOfRange ? 'text-warn' : 'text-text-faint'}`}>{totalPct.toFixed(0)}%</span>
      </div>
      <div className="text-[11px] text-text-muted truncate mt-0.5">{g.outputDescription ?? g.outputItemId}</div>
      <div className="text-[10px] text-text-faint mt-0.5">{g.workCentre} · {g.components.length} component{g.components.length !== 1 ? 's' : ''}</div>
    </button>
  )
}

function BomDetail({ g, itemsById, canEdit, canDelete, canGenerateJobCards, onAddComponent, onUpdateComponent, onRemoveComponent, onRemoveBlend, onBack, openPicker }: {
  g: BlendGroup; itemsById: Map<string, InventoryItem>
  canEdit: boolean; canDelete: boolean; canGenerateJobCards: boolean
  onAddComponent: (g: BlendGroup, componentItemId: string, description: string, qtyPct: number) => void
  onUpdateComponent: (id: string, patch: Partial<BomRow>) => void
  onRemoveComponent: (id: string) => void
  onRemoveBlend: (bomId: string) => void
  onBack: () => void
  openPicker: (cb: (it: InventoryItem) => void) => void
}) {
  const variant = itemsById.get(g.outputItemId)?.variant ?? variantFromSuffix(g.outputItemId)
  const totalPct = g.components.reduce((s, c) => s + c.qty_required, 0) * 100
  const outOfRange = Math.abs(totalPct - 100) > 1
  const outputFound = itemsById.has(g.outputItemId)

  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card p-4 space-y-3">
      <button onClick={onBack} className="md:hidden inline-flex items-center gap-1 text-[12px] text-text-muted mb-1">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to list
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[14px] font-semibold text-text">{g.bomId}</span>
            {!outputFound && <AlertTriangle className="w-4 h-4 text-warn shrink-0" title="Output item not found in Master Inventory" />}
          </div>
          <div className="text-[13px] text-text-muted mt-0.5">{g.outputDescription ?? g.outputItemId}</div>
          <div className="text-[11px] text-text-faint mt-1">{g.workCentre} · {variant ?? 'variant unknown'} · {g.components.length} component{g.components.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[13px] font-mono font-semibold ${outOfRange ? 'text-warn' : 'text-ok'}`}>{totalPct.toFixed(0)}%</span>
          {canGenerateJobCards && g.workCentre === '06-PASTEURISING' && (
            <Link href={`/job-cards/pasteuriser?bomId=${encodeURIComponent(g.bomId)}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-brand/10 text-brand text-[11px] font-semibold hover:bg-brand/20">
              <FileText className="w-3 h-3" /> Generate job card
            </Link>
          )}
          {canDelete && (
            <button onClick={() => onRemoveBlend(g.bomId)} className="text-text-faint hover:text-err p-1.5 rounded-lg hover:bg-err/5">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

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

      {canEdit && <AddComponentRow g={g} onAdd={onAddComponent} openPicker={openPicker} />}
      {g.workCentre === '06-PASTEURISING' && <ParentBlendPanel bomId={g.bomId} itemsById={itemsById} />}
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

function AddComponentRow({ g, onAdd, openPicker }: {
  g: BlendGroup
  onAdd: (g: BlendGroup, id: string, desc: string, pct: number) => void
  openPicker: (cb: (it: InventoryItem) => void) => void
}) {
  const [picked, setPicked] = useState<InventoryItem | null>(null)
  const [pct, setPct] = useState('')
  const submit = () => {
    if (!picked || !pct.trim()) return
    onAdd(g, picked.inventory_id, picked.description ?? picked.inventory_id, parseFloat(pct) || 0)
    setPicked(null); setPct('')
  }
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="flex-1"><InventoryField value={picked} placeholder="Search component item…" onOpen={() => openPicker(setPicked)} /></div>
      <input value={pct} onChange={e => setPct(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="%" inputMode="decimal"
        className="h-9 w-20 rounded-lg border border-surface-rule px-2 text-[13px] text-right" />
      <button onClick={submit} disabled={!picked || !pct.trim()}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white disabled:opacity-40"><Check className="w-4 h-4" /></button>
    </div>
  )
}

function NewBomForm({ onSave, onCancel, openPicker, onBack }: {
  onSave: (bomId: string, output: InventoryItem, workCentre: string, comps: { item: InventoryItem; pct: number }[]) => void
  onCancel: () => void
  onBack: () => void
  openPicker: (cb: (it: InventoryItem) => void) => void
}) {
  const [bomId, setBomId] = useState('')
  const [output, setOutput] = useState<InventoryItem | null>(null)
  const [workCentre, setWorkCentre] = useState(EDITABLE_WORK_CENTRES[0])
  const [comps, setComps] = useState<{ item: InventoryItem | null; pct: string }[]>([{ item: null, pct: '' }])

  function setCompItem(i: number, item: InventoryItem) { setComps(cs => cs.map((c, idx) => idx === i ? { ...c, item } : c)) }
  function setCompPct(i: number, pct: string) { setComps(cs => cs.map((c, idx) => idx === i ? { ...c, pct } : c)) }
  function addRow() { setComps(cs => [...cs, { item: null, pct: '' }]) }
  function removeRow(i: number) { setComps(cs => cs.length === 1 ? cs : cs.filter((_, idx) => idx !== i)) }

  const totalPct = comps.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
  const validComps = comps.filter((c): c is { item: InventoryItem; pct: string } => !!c.item && parseFloat(c.pct) > 0)
  const canSubmit = !!bomId.trim() && !!output && validComps.length > 0

  function submit() {
    if (!canSubmit || !output) return
    onSave(bomId.trim().toUpperCase(), output, workCentre, validComps.map(c => ({ item: c.item, pct: parseFloat(c.pct) || 0 })))
  }

  return (
    <div className="rounded-xl border border-brand/30 bg-accent-bg/30 p-4 space-y-4">
      <button onClick={onBack} className="md:hidden inline-flex items-center gap-1 text-[12px] text-text-muted -mb-1">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to list
      </button>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">New BOM</h3>
        <button onClick={onCancel} className="text-text-faint hover:text-text p-1"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Blend code *">
          <input autoFocus value={bomId} onChange={e => setBomId(e.target.value.toUpperCase())}
            className="h-9 w-full rounded-lg border border-surface-rule px-2 text-[13px] font-mono" />
        </Field>
        <Field label="Work centre *">
          <select value={workCentre} onChange={e => setWorkCentre(e.target.value)} className="h-9 w-full rounded-lg border border-surface-rule px-2 text-[13px]">
            {EDITABLE_WORK_CENTRES.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Output item *">
            <InventoryField value={output} placeholder="Search Master Inventory…" onOpen={() => openPicker(setOutput)} />
          </Field>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Components</span>
          <span className={`text-[11px] font-mono ${Math.abs(totalPct - 100) > 1 ? 'text-warn' : 'text-ok'}`}>{totalPct.toFixed(1)}%</span>
        </div>
        {comps.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1"><InventoryField value={c.item} placeholder="Search component item…" onOpen={() => openPicker(it => setCompItem(i, it))} /></div>
            <input value={c.pct} onChange={e => setCompPct(i, e.target.value.replace(/[^0-9.]/g, ''))} placeholder="%" inputMode="decimal"
              className="h-9 w-20 rounded-lg border border-surface-rule px-2 text-[13px] text-right" />
            <button onClick={() => removeRow(i)} disabled={comps.length === 1}
              className="text-text-faint hover:text-err p-1 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button onClick={addRow} className="inline-flex items-center gap-1.5 text-[12px] text-brand font-medium hover:underline">
          <Plus className="w-3.5 h-3.5" /> Add another component
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={submit} disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-4 h-9 text-[13px] font-semibold disabled:opacity-40">
          <Check className="w-4 h-4" /> Create BOM
        </button>
        <button onClick={onCancel} className="inline-flex items-center gap-1.5 border border-surface-rule text-text-muted rounded-lg px-4 h-9 text-[13px] font-semibold">
          Cancel
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}

function InventoryField({ value, placeholder, onOpen }: { value: InventoryItem | null; placeholder: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="h-9 w-full rounded-lg border border-surface-rule px-2 text-[13px] text-left flex items-center justify-between gap-2 bg-surface-card hover:border-brand/40">
      {value ? (
        <span className="truncate"><span className="font-mono text-[11px]">{value.inventory_id}</span> — {value.description}</span>
      ) : <span className="text-text-faint">{placeholder}</span>}
      <Search className="w-3.5 h-3.5 text-text-faint shrink-0" />
    </button>
  )
}

function Stat({ label, value, tone, onClick, active }: {
  label: string; value: number; tone?: 'warn' | 'err' | 'info'; onClick?: () => void; active?: boolean
}) {
  const v = tone === 'err' ? 'text-err' : tone === 'warn' ? 'text-warn' : tone === 'info' ? 'text-info' : 'text-text'
  const cls = `rounded-lg border p-3 text-left w-full ${active ? 'border-warn bg-warn/5' : 'border-surface-rule bg-surface-card'} ${onClick ? 'hover:border-text/25 cursor-pointer' : ''}`
  const body = (
    <>
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${v}`}>{value}</div>
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={cls}>{body}</button>
    : <div className={cls}>{body}</div>
}

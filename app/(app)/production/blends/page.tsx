'use client'

// app/(app)/production/blends/page.tsx
// BOMs — read-only browser over production.bom_components, every work centre
// in the plant (Sieving through Packing). Acumatica is the master for BOM
// structure (which components make up a blend, and in what ratio); there is
// no add/edit/delete here — this page is where a BOM's Acumatica code and
// blend/final ratios live for browsing, filterable by work centre and
// free-text search, and where a Pasteuriser BOM launches job-card generation.
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
import { Search, ChevronLeft, Layers, AlertTriangle, ArrowUpRight, FileText, X } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { loadAllInventory } from '@/lib/production/inventory'
import { findParentBlendBom, type ParentBlendBom } from '@/lib/production/bom'
import type { InventoryItem } from '@/lib/supabase/database.types'

const ALL_WORK_CENTRES = [
  '01-SIEVING', '02-REFINING1', '03-REFINING2', '04-GRANULATION',
  '05-BLENDER BIG', '05-BLENDER SMALL', '06-PASTEURISING', '08-PACKING',
  '12RHHAMMER', '15-RHBLENDING', '20-SCARIFICATION', '21-CHEMICAL TREATMEN',
]

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

  function selectBom(id: string | null) {
    setSelectedBomId(id)
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('bomId', id); else params.delete('bomId')
    router.replace(`/production/blends?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    ;(async () => {
      const { data } = await getDb().schema('production').from('bom_components')
        .select('*').order('bom_id').order('line_nbr')
      setRows((data as BomRow[]) ?? [])
      setLoading(false)
    })()
    loadAllInventory().then(setItems)
  }, [])

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

  if (loading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="rounded-xl border border-surface-rule bg-surface-card p-6 text-text-muted text-sm">Loading…</div></div>

  const showDetail = !!selectedGroup

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">BOMs</h1>
        <p className="text-sm text-text-muted mt-1">The full bill-of-materials catalogue — every work centre, from Sieving through Packing. Read-only — Acumatica is the master for BOM structure; browse Acumatica codes and blend ratios here, and launch job-card generation from a Pasteuriser BOM.</p>
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
          {selectedGroup ? (
            <BomDetail g={selectedGroup} itemsById={itemsById} canGenerateJobCards={canGenerateJobCards} onBack={() => selectBom(null)} />
          ) : (
            <div className="rounded-xl border border-dashed border-surface-rule p-10 text-center text-text-faint text-[13px]">
              Select a BOM from the list.
            </div>
          )}
        </div>
      </div>
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

function BomDetail({ g, itemsById, canGenerateJobCards, onBack }: {
  g: BlendGroup; itemsById: Map<string, InventoryItem>
  canGenerateJobCards: boolean
  onBack: () => void
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
            </tr>
          </thead>
          <tbody>
            {g.components.map(c => (
              <ComponentRow key={c.id} c={c} found={itemsById.has(c.component_item_id)} />
            ))}
          </tbody>
        </table>
      </div>

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

function ComponentRow({ c, found }: { c: BomRow; found: boolean }) {
  return (
    <tr className="border-b border-surface-rule/60">
      <td className="py-1 px-2">
        <div className="flex items-center gap-1.5">
          {!found && <AlertTriangle className="w-3 h-3 text-warn shrink-0" title="Not found in Master Inventory" />}
          <span className="font-mono text-[11px] text-text">{c.component_item_id}</span>
          <span className="text-[11px] text-text-muted truncate">{c.component_description}</span>
        </div>
      </td>
      <td className="py-1 px-2 text-text-muted text-[11px]">{c.ingredient_column ?? '—'}</td>
      <td className="py-1 px-2 text-right font-mono text-[12px] text-text">{(c.qty_required * 100).toFixed(1)}%</td>
    </tr>
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

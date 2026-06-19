'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import {
  ChevronLeft, Loader2, CheckCircle2, Users, Save, Calendar,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import {
  SECTION_ORDER, sectionMeta, NEEDS_LOT, NEEDS_VARIANT, VARIANT_OPTIONS,
} from '@/lib/production/capture-config'
import { productionOrderItems, loadAllInventory } from '@/lib/production/inventory'
import { OperatorPicker } from '@/components/production/capture/OperatorPicker'
import type { Operator, Variant, InventoryItem } from '@/lib/supabase/database.types'

type Shift = 'morning' | 'afternoon' | 'night'

interface SectionDraft {
  operatorIds: string[]
  lotNumber:   string
  variant:     Variant | ''
  prodOrders:  string[]   // planned output codes (or real PO numbers once synced)
}

const emptyDraft = (): SectionDraft => ({ operatorIds: [], lotNumber: '', variant: '', prodOrders: [] })

function AssignScreen() {
  const router = useRouter()
  const sp     = useSearchParams()
  const { user } = useAuth()

  // Date/shift can be deep-linked (e.g. from the supervisor calendar); otherwise
  // default to today + the current shift.
  const [date, setDate]   = useState(sp.get('date') ?? format(new Date(), 'yyyy-MM-dd'))
  const [shift, setShift] = useState<Shift>(() => {
    const q = sp.get('shift')
    if (q === 'morning' || q === 'afternoon' || q === 'night') return q
    const h = new Date().getHours()
    return h >= 7 && h < 16 ? 'morning' : h >= 16 && h < 23 ? 'afternoon' : 'night'
  })

  const [operators, setOperators] = useState<Operator[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [drafts, setDrafts]       = useState<Record<string, SectionDraft>>({})
  const [loading, setLoading]     = useState(true)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [savedSection, setSavedSection]   = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)

  // Load operators once
  useEffect(() => {
    getDb().schema('production').from('operators')
      .select('*').eq('active', true).order('name')
      .then(({ data }: any) => setOperators((data as Operator[]) ?? []))
    loadAllInventory().then(setInventory)
  }, [])

  // Load existing assignments whenever date/shift changes
  useEffect(() => {
    setLoading(true)
    getDb().schema('production').from('shift_assignments')
      .select('*').eq('date', date).eq('shift', shift)
      .then(({ data }: any) => {
        const next: Record<string, SectionDraft> = {}
        SECTION_ORDER.forEach(id => { next[id] = emptyDraft() })
        ;(data ?? []).forEach((a: any) => {
          next[a.section_id] = {
            operatorIds: a.operator_ids ?? [],
            lotNumber:   a.lot_number ?? '',
            variant:     a.variant ?? '',
            prodOrders:  a.production_orders ?? [],
          }
        })
        setDrafts(next)
        setLoading(false)
      })
  }, [date, shift])

  function toggleProdOrder(sectionId: string, code: string) {
    setDrafts(d => {
      const cur = d[sectionId] ?? emptyDraft()
      const has = cur.prodOrders.includes(code)
      return { ...d, [sectionId]: { ...cur, prodOrders: has ? cur.prodOrders.filter(c => c !== code) : [...cur.prodOrders, code] } }
    })
  }

  function toggleOperator(sectionId: string, opId: string) {
    setDrafts(d => {
      const cur = d[sectionId] ?? emptyDraft()
      const has = cur.operatorIds.includes(opId)
      return {
        ...d,
        [sectionId]: {
          ...cur,
          operatorIds: has ? cur.operatorIds.filter(x => x !== opId) : [...cur.operatorIds, opId],
        },
      }
    })
  }

  function setField(sectionId: string, key: keyof SectionDraft, value: any) {
    setDrafts(d => ({ ...d, [sectionId]: { ...(d[sectionId] ?? emptyDraft()), [key]: value } }))
  }

  async function saveSection(sectionId: string) {
    const draft = drafts[sectionId] ?? emptyDraft()
    setError(null)
    setSavingSection(sectionId)
    try {
      if (draft.operatorIds.length === 0) {
        // Empty roster → remove any existing assignment for this slot
        await getDb().schema('production').from('shift_assignments')
          .delete().eq('date', date).eq('shift', shift).eq('section_id', sectionId)
      } else {
        await getDb().schema('production').from('shift_assignments').upsert({
          date, shift, section_id: sectionId,
          operator_ids:      draft.operatorIds,
          lot_number:        draft.lotNumber || null,
          variant:           draft.variant || null,
          production_orders: draft.prodOrders.length ? draft.prodOrders : null,
          assigned_by:       user?.id ?? null,
        } as any, { onConflict: 'date,shift,section_id' })
      }
      setSavedSection(sectionId)
      setTimeout(() => setSavedSection(s => s === sectionId ? null : s), 2000)
    } catch (e: any) {
      setError(`${sectionId}: ${e.message}`)
    }
    setSavingSection(null)
  }

  const shifts: Shift[] = ['morning', 'afternoon', 'night']

  return (
    <div className="px-4 py-5 max-w-[900px] space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/production/capture')} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-[22px] text-text leading-tight">Assign sections</h1>
          <p className="text-[12px] text-text-muted mt-0.5">Roster operators onto each section. They confirm with their PIN on the tablet.</p>
        </div>
      </div>

      {/* Date + shift */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-stone-200 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-text-muted" />
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand"
          />
        </div>
        <div className="flex gap-2">
          {shifts.map(s => (
            <button
              key={s} onClick={() => setShift(s)}
              className={`px-4 py-2 rounded-lg border font-medium text-[13px] capitalize transition-colors ${shift === s ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200 hover:border-brand/40'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[12px] text-err px-1">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 size={22} className="animate-spin text-text-muted" /></div>
      ) : (
        <div className="space-y-4">
          {SECTION_ORDER.map(sectionId => {
            const meta   = sectionMeta(sectionId)
            const draft  = drafts[sectionId] ?? emptyDraft()
            const ops    = operators
            const saving = savingSection === sectionId
            const saved  = savedSection === sectionId

            return (
              <div key={sectionId} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: meta.colorHex }}>
                    <span className="font-mono font-bold text-[10px] text-white">{meta.code}</span>
                  </div>
                  <span className="font-semibold text-[15px] text-text flex-1">{meta.name}</span>
                  {draft.operatorIds.length > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-text-muted font-mono">
                      <Users size={12} /> {draft.operatorIds.length}
                    </span>
                  )}
                </div>

                <div className="px-4 py-4 space-y-4">
                  {/* Operators */}
                  {ops.length === 0 ? (
                    <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      No operators are set up yet. Add them in the operators table first.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] text-stone-400">Search a name to roster them onto this section, then Save.</p>
                      <OperatorPicker
                        operators={ops}
                        selectedIds={draft.operatorIds}
                        onToggle={opId => toggleOperator(sectionId, opId)}
                      />
                    </div>
                  )}

                  {/* Lot / variant / POs */}
                  {(NEEDS_VARIANT.has(sectionId) || NEEDS_LOT.has(sectionId)) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {NEEDS_VARIANT.has(sectionId) && (
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Variant</label>
                          <select
                            value={draft.variant} onChange={e => setField(sectionId, 'variant', e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand cursor-pointer"
                          >
                            <option value="">Select…</option>
                            {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                          </select>
                        </div>
                      )}
                      {NEEDS_LOT.has(sectionId) && (
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Lot / Batch</label>
                          <input
                            value={draft.lotNumber} onChange={e => setField(sectionId, 'lotNumber', e.target.value)}
                            placeholder="e.g. GS-2026-001"
                            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand"
                          />
                        </div>
                      )}
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Production orders</label>
                        {!draft.variant ? (
                          <p className="text-[12px] text-stone-400 px-1">Pick a variant first to see production-order items.</p>
                        ) : (() => {
                          const items = productionOrderItems(inventory, sectionId, draft.variant)
                          if (items.length === 0) return <p className="text-[12px] text-stone-400 px-1">No production-order items configured for this section yet.</p>
                          return (
                            <div className="flex flex-col gap-2">
                              {items.map(it => {
                                const on = draft.prodOrders.includes(it.inventory_id)
                                return (
                                  <button key={it.inventory_id} type="button" onClick={() => toggleProdOrder(sectionId, it.inventory_id)}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200 hover:border-brand/40'}`}>
                                    {on ? <CheckCircle2 size={14} className="shrink-0" /> : <span className="w-3.5 shrink-0" />}
                                    <span className="flex-1 text-[13px]">{it.description || it.inventory_id}</span>
                                    <span className={`font-mono text-[11px] ${on ? 'opacity-80' : 'text-text-muted'}`}>{it.inventory_id}</span>
                                  </button>
                                )
                              })}
                            </div>
                          )
                        })()}
                        <p className="text-[10px] text-stone-400 px-1">Orders are created against the phantom / final items above. Real Acumatica PO numbers slot in here once that sync is connected.</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => saveSection(sectionId)} disabled={saving || ops.length === 0 || draft.operatorIds.length === 0}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand text-white font-medium text-[13px] disabled:opacity-40 disabled:bg-stone-300 hover:bg-brand-mid transition-colors"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} className="text-white" /> : <Save size={14} />}
                      {saving ? 'Saving…' : saved ? 'Saved ✓' : draft.operatorIds.length === 0 ? 'Select an operator first' : 'Save assignment'}
                    </button>
                    {draft.operatorIds.length === 0 && (
                      <button onClick={() => saveSection(sectionId)} className="text-[12px] text-stone-400 hover:text-err px-2 whitespace-nowrap">Clear</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AssignPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>}>
      <AssignScreen />
    </Suspense>
  )
}

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
import { BlendCodePicker } from '@/components/production/capture/BlendCodePicker'
import { WORK_CENTRE_FOR_SECTION } from '@/components/production/capture/BlenderCapture'
import type { Operator, Variant, InventoryItem } from '@/lib/supabase/database.types'

const isBlenderSection = (id: string) => id === 'blender' || id === 'smallblender'

type Shift = 'morning' | 'afternoon' | 'night'

interface SectionDraft {
  operatorIds: string[]
  lotNumber:   string
  variant:     Variant | ''
  prodOrders:  string[]   // planned output codes (or real PO numbers once synced)
}

const emptyDraft = (): SectionDraft => ({ operatorIds: [], lotNumber: '', variant: '', prodOrders: [] })

// Capture's shift maps onto the roster's two bands (day 07–16 / night 16–01).
// The Afternoon/Night capture shift (16h00–01h00) draws from the roster's night
// band. 'night' is a legacy alias of 'afternoon'.
const ROSTER_SHIFT: Record<Shift, 'day' | 'night'> = { morning: 'day', afternoon: 'night', night: 'night' }
// User-facing shift labels (the 16h00–01h00 shift is the "Afternoon / Night" shift).
const SHIFT_BTN: Record<Shift, string> = {
  morning:   'Morning · 07h00–16h00',
  afternoon: 'Afternoon / Night · 16h00–01h00',
  night:     'Night',
}
// Which roster role(s) feed each capture section, for autofill.
const SECTION_ROLES: Record<string, string[]> = {
  sieving:     ['sieving_tower'],
  refining1:   ['refining_1'],
  refining2:   ['refining_2'],
  granule:     ['granule_operator', 'granule'],
  blender:     ['blender'],
  pasteuriser: ['pasteuriser_op'],
}

function AssignScreen() {
  const router = useRouter()
  const sp     = useSearchParams()
  const { user } = useAuth()

  // Date/shift can be deep-linked (e.g. from the supervisor calendar); otherwise
  // default to today + the current shift.
  const [date, setDate]   = useState(sp.get('date') ?? format(new Date(), 'yyyy-MM-dd'))
  const [shift, setShift] = useState<Shift>(() => {
    const q = sp.get('shift')
    if (q === 'morning' || q === 'afternoon') return q
    if (q === 'night') return 'afternoon'   // legacy deep-links → afternoon/night shift
    const h = new Date().getHours()
    return h >= 7 && h < 16 ? 'morning' : 'afternoon'
  })

  const [operators, setOperators] = useState<Operator[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [drafts, setDrafts]       = useState<Record<string, SectionDraft>>({})
  const [loading, setLoading]     = useState(true)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [savedSection, setSavedSection]   = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [onLeaveOps, setOnLeaveOps] = useState<Set<string>>(new Set())
  const [filling, setFilling]     = useState(false)
  const [fillNote, setFillNote]   = useState<string | null>(null)

  // Load operators once
  useEffect(() => {
    getDb().schema('production').from('operators')
      .select('*').eq('active', true).order('name')
      .then(({ data }: any) => setOperators((data as Operator[]) ?? []))
    loadAllInventory().then(setInventory)
  }, [])

  // Load existing assignments whenever date/shift changes; auto-fill from roster if none exist yet
  useEffect(() => {
    setLoading(true)
    setFillNote(null)
    getDb().schema('production').from('shift_assignments')
      .select('*').eq('date', date).eq('shift', shift)
      .then(async ({ data }: any) => {
        const rows = (data ?? []) as any[]
        const next: Record<string, SectionDraft> = {}
        SECTION_ORDER.forEach(id => { next[id] = emptyDraft() })
        rows.forEach((a: any) => {
          next[a.section_id] = {
            operatorIds: a.operator_ids ?? [],
            lotNumber:   a.lot_number ?? '',
            variant:     a.variant ?? '',
            prodOrders:  a.production_orders ?? [],
          }
        })
        setDrafts(next)
        setLoading(false)
        // Auto-fill from roster when no assignments exist for this slot yet
        if (rows.length === 0) {
          await fillFromRoster()
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shift])

  // Who's on leave for the selected date — flagged in the operator picker so a
  // stand-in can be rostered instead. (Best-effort; ignores if the view is absent.)
  useEffect(() => {
    getDb().schema('production').from('employee_leave_active')
      .select('operator_id').lte('start_date', date).gte('end_date', date)
      .then(({ data }: any) => {
        const ids = ((data as any[]) ?? []).map(r => r.operator_id).filter(Boolean)
        setOnLeaveOps(new Set(ids))
      }, () => setOnLeaveOps(new Set()))
  }, [date])

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

  // ── Autofill from the Shift Roster ──────────────────────────────────────────
  // Each capture section is fed by one or more roster roles; capture's three
  // shifts collapse onto the roster's two (day 07–16 covers morning+afternoon,
  // night 16–01). We pull the people rostered to those roles for the date and
  // resolve them to their Capture operator record (directly, or via their
  // employee link), then pre-fill each section.
  async function fillFromRoster() {
    setFilling(true); setFillNote(null); setError(null)
    try {
      const pdb = getDb().schema('production')
      const { data: ps } = await pdb.from('roster_periods')
        .select('id,name').lte('start_date', date).gte('end_date', date)
        .order('start_date', { ascending: false }).limit(1)
      const period = ((ps as any[]) ?? [])[0]
      if (!period) {
        setFillNote('No roster period covers this date yet — set up the Shift Roster first.')
        setFilling(false); return
      }
      const rShift = ROSTER_SHIFT[shift]
      const { data: rows } = await pdb.from('roster_entries')
        .select('role_key,operator_id,employee_id,person_name')
        .eq('period_id', period.id).eq('shift', rShift)
      const entries = (rows as any[]) ?? []

      // Resolve operator ids: 1) direct operator_id, 2) employee→operator link, 3) name match.
      const empIds = [...new Set(entries.filter(e => !e.operator_id && e.employee_id).map(e => e.employee_id))]
      const empOp = new Map<string, string | null>()
      if (empIds.length) {
        const { data: emps } = await pdb.from('employees').select('id,operator_id').in('id', empIds)
        ;(emps as any[] ?? []).forEach(e => empOp.set(e.id, e.operator_id))
      }
      // Name-based fallback: match person_name to operators.name (case-insensitive trim)
      const nameOp = new Map<string, string>()
      operators.forEach(op => nameOp.set(op.name.trim().toLowerCase(), op.id))
      const opFor = (e: any): string | null =>
        e.operator_id ??
        (e.employee_id ? (empOp.get(e.employee_id) ?? null) : null) ??
        (e.person_name ? (nameOp.get(e.person_name.trim().toLowerCase()) ?? null) : null)

      // Calculate fills synchronously before setDrafts so the count is accurate
      // when setFillNote is called (setDrafts updater runs async on next render).
      let filled = 0
      const sectionFills: Record<string, string[]> = {}
      SECTION_ORDER.forEach(sectionId => {
        const roleKeys = SECTION_ROLES[sectionId] ?? []
        const ids: string[] = []
        entries.filter(e => roleKeys.includes(e.role_key)).forEach(e => {
          const opId = opFor(e)
          if (opId && !ids.includes(opId)) ids.push(opId)
        })
        if (ids.length) { sectionFills[sectionId] = ids; filled += ids.length }
      })
      setDrafts(prev => {
        const next = { ...prev }
        Object.entries(sectionFills).forEach(([sectionId, ids]) => {
          next[sectionId] = { ...(next[sectionId] ?? emptyDraft()), operatorIds: ids }
        })
        return next
      })
      setFillNote(`Filled ${filled} ${filled === 1 ? 'person' : 'people'} from the “${period.name}” roster (${rShift} shift). Review each section and Save.`)
    } catch (e: any) {
      setError(e.message)
    }
    setFilling(false)
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

  const shifts: Shift[] = ['morning', 'afternoon']

  return (
    <div className="px-4 py-5 max-w-[900px] space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/production/capture')} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-[22px] text-text leading-tight">Assign sections</h1>
          <p className="text-[12px] text-text-muted mt-0.5">Confirm variant, grade, and operators per section. Pre-filled from the Shift Roster automatically.</p>
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
              className={`px-4 py-2 rounded-lg border font-medium text-[13px] transition-colors ${shift === s ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200 hover:border-brand/40'}`}
            >
              {SHIFT_BTN[s]}
            </button>
          ))}
        </div>
        {filling && (
          <div className="ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand/10 text-brand border border-brand/20 text-[13px]">
            <Loader2 size={14} className="animate-spin" /> Filling from roster…
          </div>
        )}
      </div>

      {fillNote && (
        <div className="px-4 py-3 bg-brand/5 border border-brand/20 rounded-xl text-[12px] text-brand-mid">
          {fillNote}
        </div>
      )}

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
            // Granule and Blender/Small Blender's lot number silently defaults to
            // blank if skipped here — Granule's serial numbering + QC linking and
            // Blender's Fine/Coarse Leaf batch tracking both key off it, and the
            // supervisor doesn't find out until later. Require it up front.
            const lotMissing = (sectionId === 'granule' || isBlenderSection(sectionId))
              && draft.operatorIds.length > 0 && !draft.lotNumber.trim()

            return (
              <div key={sectionId} className="bg-white border border-stone-200 rounded-2xl overflow-hidden"
                style={{ borderLeft: `4px solid ${meta.colorHex}` }}>
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
                        onLeaveIds={onLeaveOps}
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
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">
                            Lot / Batch{(sectionId === 'granule' || isBlenderSection(sectionId)) && <span className="text-err"> *</span>}
                          </label>
                          <input
                            value={draft.lotNumber} onChange={e => setField(sectionId, 'lotNumber', e.target.value)}
                            placeholder="e.g. GS-2026-001"
                            className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] text-text outline-none focus:border-brand ${lotMissing ? 'border-err' : 'border-stone-200'}`}
                          />
                          {lotMissing && (
                            <p className="text-[11px] text-err px-0.5">
                              {sectionId === 'granule'
                                ? 'Required — every output bag tag is stamped with this lot, and QC readings link to it.'
                                : 'Required — every output bag tag (the finished blend label) is stamped with this lot number.'}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">
                          {isBlenderSection(sectionId) ? 'Blend code (default for this shift)' : 'Production orders'}
                        </label>
                        {!draft.variant ? (
                          <p className="text-[12px] text-stone-400 px-1">Pick a variant first to see {isBlenderSection(sectionId) ? 'blends' : 'production-order items'}.</p>
                        ) : isBlenderSection(sectionId) ? (
                          <BlendCodePicker variant={draft.variant} workCentre={WORK_CENTRE_FOR_SECTION[sectionId]} selected={draft.prodOrders}
                            onSelect={bomId => setField(sectionId, 'prodOrders', [bomId])} />
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
                        {isBlenderSection(sectionId) ? (
                          <p className="text-[10px] text-stone-400 px-1">The operator can pick or switch the blend directly in Capture too — this is just a convenient default for the first batch of the shift.</p>
                        ) : (
                          <p className="text-[10px] text-stone-400 px-1">Orders are created against the phantom / final items above. Real Acumatica PO numbers slot in here once that sync is connected.</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => saveSection(sectionId)} disabled={saving || ops.length === 0 || draft.operatorIds.length === 0 || lotMissing}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand text-white font-medium text-[13px] disabled:opacity-40 disabled:bg-stone-300 hover:bg-brand-mid transition-colors"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} className="text-white" /> : <Save size={14} />}
                      {saving ? 'Saving…' : saved ? 'Saved ✓' : draft.operatorIds.length === 0 ? 'Select an operator first' : lotMissing ? 'Enter a lot/batch number first' : 'Save assignment'}
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

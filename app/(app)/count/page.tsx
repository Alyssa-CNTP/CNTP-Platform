'use client'

import React from 'react'
import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getDb } from '@/lib/supabase/db'
import { useCountStore, itemKey, bagTotal, palletTotal, itemTotal, groupByBatch, defaultItemState } from '@/lib/store/countStore'
import { ROOIBOS_SECTIONS, ROSEHIP_SECTIONS, inventoryCode, palletKg, PALLET_PACKAGES } from '@/lib/data/sections'
import type { Section, InventoryItem } from '@/lib/data/sections'
import { t, type Lang } from '@/lib/data/translations'
import BottomSheet from '@/components/ui/BottomSheet'
import { useToast } from '@/components/ui/Toast'
import ConfirmSheet from '@/components/ui/ConfirmSheet'
import NumKeypad from '@/components/count/NumKeypad'
import BatchKeypad from '@/components/count/BatchKeypad'
import { format } from 'date-fns'
import { ChevronRight, ChevronDown, Plus, Trash2, CheckCircle, RotateCcw, GitCompare, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import CountCompareView from '@/components/count/CountCompareView'
import AddItemModal from '@/components/count/AddItemModal'
import type { AddedItem } from '@/components/count/AddItemModal'

// ── SAVE STATUS ───────────────────────────────────────────────────────────────
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ── KEYPAD STATE ─────────────────────────────────────────────────────────────
interface KpState {
  type:    'batch' | 'weight'
  key:     string
  index:   number
  context: string
  initial: string
}

function CountPage() {
  const { user, role, displayName } = useAuth()
  const toast = useToast()
  const store    = useCountStore()
  const db       = getDb()
  const supa     = getSupabaseClient()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const SECTION_NAME_TO_ID: Record<string, string> = {
    'Sieving Tower': 'sieve', 'Refining 1': 'ref1', 'Refining 2': 'ref2',
    'Pasteuriser': 'past', 'Blender': 'blend', 'Granule Line': 'gran',
    'Final Product': 'fp', 'Hammermill / Other': 'hmr',
    'Siewtoring': 'sieve', 'Verfyning 1': 'ref1', 'Verfyning 2': 'ref2',
  }

  const searchParams     = useSearchParams()
  const isRecount        = searchParams.get('recount') === '1'
  const recountSection   = searchParams.get('section') ?? ''
  const recountSectionId = recountSection ? (SECTION_NAME_TO_ID[recountSection] ?? recountSection) : ''
  const recountBannerRef = useRef<HTMLDivElement | null>(null)

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [openItems,    setOpenItems]    = useState<Record<string, boolean>>({})
  const [kp,           setKp]           = useState<KpState | null>(null)
  const [saving,       setSaving]       = useState<SaveStatus>('idle')
  const [submitted,    setSubmitted]    = useState(false)
  const [doneStats,    setDoneStats]    = useState<{ kg: number; bags: number; time: string } | null>(null)
  const [showCompare,  setShowCompare]  = useState(false)
  const [draftWarning, setDraftWarning] = useState<string | null>(null)
  const [showAddItem,  setShowAddItem]  = useState<string | null>(null)
  const [showConfirm,  setShowConfirm]  = useState(false)

  const today    = format(new Date(), 'yyyy-MM-dd')
  const lang     = store.lang as Lang
  const sections = store.product === 'r' ? ROOIBOS_SECTIONS : ROSEHIP_SECTIONS

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (store.date && store.date !== today && !store.submitted) {
      setDraftWarning(store.date)
    }
    if (!store.date) store.setDate(today)
    if (role) store.setRole(role as 'admin' | 'supervisor')
    checkSubmission()
  }, [today, role])

  useEffect(() => {
    if (!isRecount || !recountSectionId) return
    setOpenSections({ [recountSectionId]: true })
    setTimeout(() => {
      recountBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 300)
  }, [isRecount, recountSectionId])

  async function checkSubmission() {
    if (!store.date) return
    const { data } = await db.from('sc_sessions').select('*')
      .eq('count_date', store.date).maybeSingle()
    if (!data) return
    const s = data as any
    if (!store.sessionId) store.setSessionId(s.id)
    const done = store.role === 'supervisor' ? !!s.sup_confirmed_at : !!s.adm_confirmed_at
    if (done) {
      const kg   = store.role === 'supervisor' ? (s.sup_total_kg ?? 0) : (s.adm_total_kg ?? 0)
      const bags = store.role === 'supervisor' ? (s.sup_total_bags ?? 0) : (s.adm_total_bags ?? 0)
      const ts   = store.role === 'supervisor' ? s.sup_confirmed_at : s.adm_confirmed_at
      setDoneStats({ kg, bags, time: ts ? format(new Date(ts), 'HH:mm') : '—' })
      setSubmitted(true)
    }
  }

  // ── Auto-save ────────────────────────────────────────────────────────────
  function triggerSave() {
    if (submitted) return
    setSaving('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving('saved')
      setTimeout(() => setSaving('idle'), 2000)
    }, 1500)
  }

  // ── Computed totals ────────────────────────────────────────────────────────
  function sectionProgress(sec: Section) {
    let done = 0, totalKg = 0, totalBags = 0
    const customRaw   = store.customItems?.[sec.id] ?? []
    const customItems = customRaw.map(ci => ({
      uid: ci.base, base: ci.base, name: ci.name,
      g: 'simple' as const, v: [] as any[],
    }))
    const allItems = [...sec.items, ...customItems]
    for (const it of allItems) {
      const k  = itemKey(sec.id, it.uid)
      const st = store.items[k]
      if (!st) continue
      const isPallet = it.g === 'pallet'
      if (st.ns) { done++; continue }
      const kg = itemTotal(st, isPallet)
      if (kg > 0) {
        done++
        totalKg += kg
        totalBags += isPallet
          ? st.pallets.filter(p => palletKg(+p.boxes||0,+p.bags||0,+p.paper||0) > 0).length
          : st.bags.filter(b => parseFloat(b.kg) > 0).length
      }
    }
    return { done, total: allItems.length, totalKg, totalBags }
  }

  function globalProgress() {
    const secs = [...ROOIBOS_SECTIONS, ...ROSEHIP_SECTIONS]
    let done = 0, total = 0, totalKg = 0
    for (const sec of secs) {
      const customRaw   = store.customItems?.[sec.id] ?? []
      const customItems = customRaw.map(ci => ({
        uid: ci.base, base: ci.base, name: ci.name,
        g: 'simple' as const, v: [] as any[],
      }))
      const allItems = [...sec.items, ...customItems]
      for (const it of allItems) {
        total++
        const k  = itemKey(sec.id, it.uid)
        const st = store.items[k]
        if (!st) continue
        if (st.ns) { done++; continue }
        const kg = itemTotal(st, it.g === 'pallet')
        if (kg > 0) { done++; totalKg += kg }
      }
    }
    return { done, total, totalKg }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    const missing: string[] = []
    const allSecs = [...ROOIBOS_SECTIONS, ...ROSEHIP_SECTIONS]
    for (const sec of allSecs) {
      const customRaw   = store.customItems?.[sec.id] ?? []
      const customItems = customRaw.map(ci => ({
        uid: ci.base, base: ci.base, name: ci.name, g: 'simple' as const, v: [] as any[],
      }))
      for (const it of [...sec.items, ...customItems]) {
        const k  = itemKey(sec.id, it.uid)
        const st = store.items[k]
        if (!st || st.ns) continue
        if (it.g === 'pallet') {
          st.pallets.forEach((p, i) => {
            const kg = palletKg(+p.boxes||0,+p.bags||0,+p.paper||0)
            if (kg > 0 && !p.batch.trim())
              missing.push(`${t(lang, sec.tk as any)} › ${it.name} (Pallet ${i+1})`)
          })
        } else {
          st.bags.forEach((b, i) => {
            if (parseFloat(b.kg) > 0 && !b.batch.trim())
              missing.push(`${t(lang, sec.tk as any)} › ${it.name} (Bag ${i+1})`)
          })
        }
      }
    }
    if (missing.length) {
      toast(
        `Missing batch numbers on ${missing.length} bag${missing.length!==1?'s':''}. Check each bag has a batch number before submitting.`,
        'error'
      )
      return
    }
    setShowConfirm(true)
  }

  async function doSubmit() {
    const allSecs = [...ROOIBOS_SECTIONS, ...ROSEHIP_SECTIONS]
    setSaving('saving')
    let sessionId: string | null = store.sessionId
    if (!sessionId) {
      const existing = await db.from('sc_sessions').select('id').eq('count_date', store.date).maybeSingle()
      if (existing.data) {
        sessionId = (existing.data as any).id as string
      } else {
        const created = await db.from('sc_sessions').insert({ count_date: store.date, warehouse_id: 'BHW' }).select('id').single()
        if (created.error) { toast('Could not create session: ' + created.error.message, 'error'); setSaving('error'); return }
        sessionId = (created.data as any).id as string
      }
      if (sessionId) store.setSessionId(sessionId)
    }

    const rows: any[] = []
    for (const sec of allSecs) {
      const customRaw   = store.customItems?.[sec.id] ?? []
      const customItems = customRaw.map(ci => ({
        uid: ci.base, base: ci.base, name: ci.name,
        g: 'simple' as const, v: [] as any[], tk: sec.tk, hk: sec.hk,
      }))
      const allItems = [...sec.items, ...customItems]
      for (const it of allItems) {
        const k  = itemKey(sec.id, it.uid)
        const st = store.items[k]
        if (!st) continue
        const base = {
          session_id: sessionId, warehouse_id: 'BHW', role: store.role,
          inventory_id: it.base, inventory_code: inventoryCode(it, st.variant),
          item_name: it.name, section_id: sec.id, section_name: t(lang, sec.tk as any),
        }
        if (st.ns) {
          rows.push({ ...base, entry_type:'no_stock', is_no_stock:true, batch_number:null, kg:0, entry_index:0, boxes:0, bags_qty:0, paper_bags:0, pallet_index:0 })
        } else if (it.g === 'pallet') {
          st.pallets.forEach((p, i) => {
            const kg = palletKg(+p.boxes||0,+p.bags||0,+p.paper||0)
            if (!kg && !p.batch) return
            rows.push({ ...base, entry_type:'pallet', is_no_stock:false, batch_number:p.batch||null, kg:0, entry_index:i, pallet_index:i, boxes:+p.boxes||0, bags_qty:+p.bags||0, paper_bags:+p.paper||0 })
          })
        } else {
          st.bags.forEach((b, i) => {
            const kg = parseFloat(b.kg) || 0
            if (!kg && !b.batch) return
            rows.push({ ...base, entry_type:'bag', is_no_stock:false, batch_number:b.batch||null, kg, entry_index:i, boxes:0, bags_qty:0, paper_bags:0, pallet_index:0 })
          })
        }
      }
    }

    await db.from('sc_entries').delete().eq('session_id', sessionId).eq('role', store.role)
    if (rows.length) {
      const { error } = await db.from('sc_entries').insert(rows)
      if (error) { toast('Save error: ' + error.message, 'error'); setSaving('error'); return }
    }

    const now = new Date()
    let totalKg = 0, totalBags = 0
    for (const sec of allSecs) {
      const customRaw2   = store.customItems?.[sec.id] ?? []
      const customItems2 = customRaw2.map(ci => ({
        uid: ci.base, base: ci.base, name: ci.name, g: 'simple' as const, v: [] as any[],
      }))
      for (const it of [...sec.items, ...customItems2]) {
        const k   = itemKey(sec.id, it.uid)
        const st  = store.items[k]
        if (!st || st.ns) continue
        const isPlt = it.g === 'pallet'
        totalKg   += itemTotal(st, isPlt)
        totalBags += isPlt
          ? st.pallets.filter(p => palletKg(+p.boxes||0,+p.bags||0,+p.paper||0) > 0).length
          : st.bags.filter(b => parseFloat(b.kg) > 0).length
      }
    }

    const upd = store.role === 'supervisor'
      ? { sup_confirmed_at: now.toISOString(), sup_name: displayName, sup_total_kg: totalKg, sup_total_bags: totalBags }
      : { adm_confirmed_at: now.toISOString(), adm_name: displayName, adm_total_kg: totalKg, adm_total_bags: totalBags }

    const { error: updErr } = await db.from('sc_sessions').update(upd).eq('id', sessionId)
    if (updErr) { toast('Submission error: ' + updErr.message, 'error'); setSaving('error'); return }

    setSaving('saved')
    toast('Count submitted successfully', 'success')
    setDoneStats({ kg: totalKg, bags: totalBags, time: format(now, 'HH:mm') })
    setSubmitted(true)
    store.setSubmitted(true)
  }

  // ── Date change ───────────────────────────────────────────────────────────
  function handleDateChange(date: string) {
    store.resetForDate(date, store.role as any)
    setSubmitted(false)
    setDoneStats(null)
    setOpenSections({})
    setOpenItems({})
    checkSubmission()
  }

  // ── DONE SCREEN ───────────────────────────────────────────────────────────
  if (submitted && doneStats) {
    const isAdm = store.role === 'admin'
    if (showCompare && store.sessionId) {
      return (
        <div className="min-h-full bg-surface p-4 lg:p-8 max-w-3xl mx-auto">
          <CountCompareView
            sessionId={store.sessionId}
            date={store.date}
            onClose={() => setShowCompare(false)}
          />
        </div>
      )
    }
    return (
      <div className="min-h-full bg-brand flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center mb-6">
          <CheckCircle size={32} className="text-accent-light" />
        </div>
        <h2 className="font-display font-extrabold text-3xl text-white mb-2">Count submitted</h2>
        <p className="text-white/50 text-sm mb-8">
          {isAdm ? 'Admin' : 'Supervisor'} count · {format(new Date(store.date+'T12:00:00'), 'd MMMM yyyy')} · {doneStats.time}
        </p>
        <div className="flex gap-10 mb-10">
          <div>
            <div className="font-display font-extrabold text-4xl text-white">{doneStats.bags}</div>
            <div className="font-mono text-[10px] uppercase tracking-[1px] text-white/40 mt-1">Bags counted</div>
          </div>
          <div>
            <div className="font-display font-extrabold text-4xl text-white">{Math.round(doneStats.kg).toLocaleString()}</div>
            <div className="font-mono text-[10px] uppercase tracking-[1px] text-white/40 mt-1">Kilograms</div>
          </div>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          {isAdm && (
            <button
              onClick={() => setShowCompare(true)}
              className="w-full py-3 bg-accent rounded-xl font-display font-bold text-base text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <GitCompare size={18} />
              View comparison
            </button>
          )}
          <button
            onClick={() => handleDateChange(format(new Date(), 'yyyy-MM-dd'))}
            className="w-full py-3 bg-white/10 border border-white/15 rounded-xl font-display font-bold text-base text-white hover:bg-white/15 transition-colors flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} />
            New count
          </button>
        </div>
      </div>
    )
  }

  const { done: gDone, total: gTotal, totalKg: gKg } = globalProgress()

  return (
    <div className="flex flex-col lg:flex-row min-h-full">

      {/* ── MAIN COUNT AREA ── */}
      <div className="flex-1 p-4 min-w-0">

        {/* Draft-date warning banner */}
        {draftWarning && draftWarning !== today && (
          <div className="flex items-start gap-3 p-3 mb-4 bg-warn-bg border border-warn/40 rounded-xl text-sm">
            <AlertTriangle size={16} className="text-status-warn flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-text">You have a saved draft from {format(new Date(draftWarning+'T12:00:00'), 'd MMM yyyy')}</p>
              <p className="text-text-muted text-xs mt-0.5">Resume that draft or discard it and start fresh for today.</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => { handleDateChange(draftWarning); setDraftWarning(null) }}
                className="text-xs font-bold text-status-warn border border-warn/40 rounded-lg px-2.5 py-1.5 hover:bg-warn-bg transition-colors"
              >
                Resume
              </button>
              <button
                onClick={() => { store.resetForDate(today, store.role as any); setDraftWarning(null) }}
                className="text-xs font-bold text-text-muted border border-surface-rule rounded-lg px-2.5 py-1.5 hover:bg-surface transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Count header */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className={clsx(
            'font-display font-bold text-sm px-3 py-1.5 rounded-lg uppercase tracking-wide',
            store.role === 'admin' ? 'bg-status-infoBg text-status-info' : 'bg-status-okBg text-status-ok'
          )}>
            {store.role === 'admin' ? 'Admin count' : 'Supervisor count'}
          </span>

          <input
            type="date"
            value={store.date}
            onChange={e => handleDateChange(e.target.value)}
            className="px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-xs text-text bg-surface-card outline-none focus:border-accent"
          />

          <span className="font-mono text-xs text-text-muted px-3 py-1.5 bg-surface rounded-lg border border-surface-rule">
            {displayName}
          </span>

          <div className="flex-1" />

          <select
            value={store.lang}
            onChange={e => store.setLang(e.target.value as Lang)}
            className="px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-xs text-text bg-surface-card outline-none"
          >
            <option value="en">English</option>
            <option value="af">Afrikaans</option>
            <option value="zu">isiZulu</option>
            <option value="xh">isiXhosa</option>
          </select>
        </div>

        {/* Product switcher */}
        <div className="flex border border-surface-rule rounded-xl overflow-hidden w-fit mb-4">
          {(['r','h'] as const).map((p, i) => (
            <button
              key={p}
              onClick={() => store.setProduct(p)}
              className={clsx(
                'px-5 py-2 font-display font-bold text-[14px] transition-colors',
                i === 0 && 'border-r border-surface-rule',
                store.product === p ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'
              )}
            >
              {p === 'r' ? 'Rooibos' : 'Rosehips'}
            </button>
          ))}
        </div>

        {/* Recount banner */}
        {isRecount && recountSection && (
          <div ref={recountBannerRef} className="flex items-start gap-3 p-3.5 bg-warn-bg border border-warn/40 rounded-xl mb-3">
            <AlertTriangle size={18} className="text-status-warn flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-text">Recount required — {recountSection}</p>
              <p className="text-[12px] text-text-muted mt-0.5">
                A variance was detected in this section. Please recount and update the figures below, then re-submit.
              </p>
            </div>
          </div>
        )}

        {/* Sections */}
        <div className="space-y-2">
          {sections.map(sec => {
            const { done, total, totalKg, totalBags } = sectionProgress(sec)
            const isOpen = openSections[sec.id]
            const subtitle = done === 0
              ? t(lang, sec.hk as any)
              : done === total
                ? `✓ ${totalBags} bag${totalBags!==1?'s':''} · ${Math.round(totalKg).toLocaleString()} kg`
                : `${done}/${total} · ${Math.round(totalKg).toLocaleString()} kg`

            return (
              <div key={sec.id} className="card overflow-visible">
                <button
                  onClick={() => setOpenSections(s => ({ ...s, [sec.id]: !s[sec.id] }))}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface/50 transition-colors"
                >
                  <div className={clsx('w-1 h-10 rounded-full flex-shrink-0', sec.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-bold text-[16px] text-text">{t(lang, sec.tk as any)}</div>
                    <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>
                  </div>
                  {done === total && done > 0 && <CheckCircle size={16} className="text-status-ok flex-shrink-0" />}
                  {isOpen
                    ? <ChevronDown size={18} className="text-text-muted flex-shrink-0" />
                    : <ChevronRight size={18} className="text-text-muted flex-shrink-0" />
                  }
                </button>

                {isOpen && (() => {
                  const customRaw   = store.customItems?.[sec.id] ?? []
                  const customItems = customRaw.map(ci => ({
                    uid: ci.base, base: ci.base, name: ci.name,
                    g: 'simple' as const, v: [] as any[],
                  }))
                  const allItems = [...sec.items, ...customItems]
                  return (
                    <div className="border-t border-surface-rule px-3 pb-3 pt-2 space-y-2">
                      {allItems.map(it => (
                        <ItemCard
                          key={it.uid}
                          section={sec}
                          item={it}
                          lang={lang}
                          open={!!openItems[itemKey(sec.id, it.uid)]}
                          onToggle={() => setOpenItems(s => {
                            const k = itemKey(sec.id, it.uid)
                            return { ...s, [k]: !s[k] }
                          })}
                          onOpenKp={setKp}
                          onChange={triggerSave}
                        />
                      ))}
                      <button
                        onClick={() => setShowAddItem(sec.id)}
                        className="w-full py-2 border-2 border-dashed border-surface-rule rounded-xl font-display font-bold text-sm text-text-muted hover:text-accent hover:border-accent/40 hover:bg-ok-bg transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Plus size={14} />
                        {t(lang, 'ai' as any)}
                      </button>
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>

        <div className="h-24" />
      </div>

      {/* ── STICKY SUMMARY PANEL (desktop) ── */}
      <div className="hidden lg:flex flex-col w-72 flex-shrink-0 border-l border-surface-rule">
        <div className="p-4 sticky top-0">
          <SummaryPanel done={gDone} total={gTotal} kg={gKg} saving={saving} onSubmit={handleSubmit} />
        </div>
      </div>

      {/* ── MOBILE SUBMIT FOOTER ── */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 p-4 bg-surface-card border-t border-surface-rule">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-1.5 bg-surface-rule rounded-full overflow-hidden">
            <div className="h-full bg-accent-DEFAULT rounded-full transition-all" style={{ width: `${gTotal ? (gDone/gTotal)*100 : 0}%` }} />
          </div>
          <span className="font-mono text-xs text-text-muted">{gDone}/{gTotal}</span>
        </div>
        <button
          onClick={handleSubmit}
          disabled={gDone === 0}
          className={clsx(
            'w-full py-3.5 rounded-xl font-display font-bold text-base transition-all',
            gDone > 0 ? 'bg-brand text-white hover:opacity-90' : 'bg-surface-rule text-text-faint cursor-not-allowed'
          )}
        >
          {gDone > 0 ? `Submit count (${gDone}/${gTotal} sections)` : 'Enter data to submit'}
        </button>
      </div>

      {/* ── SUBMIT CONFIRM SHEET ── */}
      <ConfirmSheet
        open={showConfirm}
        title={`Submit ${store.role === 'admin' ? 'admin' : 'supervisor'} count?`}
        message={`${format(new Date(store.date+'T12:00:00'), 'd MMMM yyyy')} · Once submitted you cannot edit entries for this date.`}
        confirmLabel="Yes, submit count"
        onConfirm={() => { setShowConfirm(false); doSubmit() }}
        onCancel={() => setShowConfirm(false)}
      />

      {/* ── ADD ITEM MODAL ── */}
      <AddItemModal
        open={!!showAddItem}
        sectionId={showAddItem ?? ''}
        onAdd={(added) => {
          const secId = showAddItem ?? ''
          useCountStore.getState().addCustomItem(secId, added.inventoryId, added.description)
          const k = itemKey(secId, added.inventoryId)
          useCountStore.getState().getItem(k, '')
          setShowAddItem(null)
          setOpenSections(s => ({ ...s, [secId]: true }))
          setOpenItems(s => ({ ...s, [k]: true }))
          triggerSave()
        }}
        onClose={() => setShowAddItem(null)}
      />

      {/* ── KEYPADS ── */}
      <BottomSheet open={!!kp} onClose={() => setKp(null)}>
        {kp?.type === 'weight' && (
          <NumKeypad
            label="Weight (kg)"
            context={kp.context}
            initial={kp.initial}
            onCancel={() => setKp(null)}
            onConfirm={val => {
              useCountStore.getState().updateBag(kp.key, kp.index, 'kg', val)
              setKp(null)
              triggerSave()
            }}
          />
        )}
        {kp?.type === 'batch' && (
          <BatchKeypad
            label="Batch number"
            context={kp.context}
            initial={kp.initial}
            onCancel={() => setKp(null)}
            onConfirm={val => {
              useCountStore.getState().updateBag(kp.key, kp.index, 'batch', val)
              setKp(null)
              triggerSave()
            }}
          />
        )}
      </BottomSheet>
    </div>
  )
}

// ── SUMMARY PANEL ─────────────────────────────────────────────────────────────
function SummaryPanel({ done, total, kg, saving, onSubmit }: {
  done: number; total: number; kg: number; saving: SaveStatus; onSubmit: () => void
}) {
  const pct = total ? Math.round((done/total)*100) : 0
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-display font-bold text-base text-text">Count summary</span>
        <span className={clsx('font-mono text-[10px]',
          saving === 'saving' ? 'text-status-warn' :
          saving === 'saved'  ? 'text-status-ok'   : 'text-text-faint'
        )}>
          {saving === 'saving' ? '⏳ Saving…' : saving === 'saved' ? '✓ Saved' : ''}
        </span>
      </div>
      <div>
        <div className="flex justify-between font-mono text-[10px] text-text-muted mb-1.5">
          <span>Sections completed</span>
          <span>{done}/{total}</span>
        </div>
        <div className="h-2 bg-surface-rule rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="space-y-2">
        {[
          { label: 'Total kg', value: `${Math.round(kg).toLocaleString()} kg` },
          { label: 'Progress',  value: `${pct}%` },
        ].map(r => (
          <div key={r.label} className="flex justify-between items-center text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[.5px] text-text-muted">{r.label}</span>
            <span className="font-mono font-bold text-text">{r.value}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onSubmit}
        disabled={done === 0}
        className={clsx(
          'w-full py-3.5 rounded-xl font-display font-bold text-base transition-all',
          done > 0 ? 'bg-brand text-white hover:opacity-90' : 'bg-surface-rule text-text-faint cursor-not-allowed'
        )}
      >
        {done > 0 ? 'Submit count' : 'Enter data first'}
      </button>
    </div>
  )
}

// ── ITEM CARD ──────────────────────────────────────────────────────────────────
function ItemCard({ section, item, lang, open, onToggle, onOpenKp, onChange }: {
  section:  Section
  item:     InventoryItem
  lang:     Lang
  open:     boolean
  onToggle: () => void
  onOpenKp: (kp: KpState) => void
  onChange:  () => void
}) {
  const store    = useCountStore()
  const k        = itemKey(section.id, item.uid)
  const rawState = store.items[k]
  const state    = rawState ?? defaultItemState(item.v[0]?.val)

  useEffect(() => {
    if (!store.items[k]) store.getItem(k, item.v[0]?.val)
  }, [k])

  const isPlt   = item.g === 'pallet'
  const total   = itemTotal(state, isPlt)
  const hasData = total > 0 || state.ns

  return (
    <div className={clsx(
      'rounded-xl border overflow-hidden transition-colors',
      hasData
        ? state.ns
          ? 'border-status-warn/40 bg-status-warnBg/30'
          : 'border-status-ok/40 bg-status-okBg/30'
        : 'border-surface-rule bg-surface/50'
    )}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text truncate">{item.name}</div>
          <div className="font-mono text-[10px] text-text-muted mt-0.5">{inventoryCode(item, state.variant)}</div>
        </div>
        {hasData && (
          <span className={clsx(
            'font-mono text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0',
            state.ns ? 'bg-status-warnBg text-status-warn' : 'bg-status-okBg text-status-ok'
          )}>
            {state.ns ? 'No stock' : `${Math.round(total)} kg`}
          </span>
        )}
        {open ? <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
               : <ChevronRight size={14} className="text-text-muted flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-surface-rule px-3 pb-3 pt-2">
          {item.v.length > 1 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[10px] uppercase tracking-[.5px] text-text-muted">Variant</span>
              <select
                value={state.variant}
                onChange={e => { store.setVariant(k, e.target.value); onChange() }}
                className="flex-1 px-2 py-1.5 border border-surface-rule rounded-lg font-mono text-xs text-text bg-surface-card outline-none focus:border-accent"
              >
                {item.v.map(v => <option key={v.val} value={v.val}>{v.label}</option>)}
              </select>
              <span className="font-mono text-[10px] font-bold text-accent">→ {inventoryCode(item, state.variant)}</span>
            </div>
          )}

          {state.ns ? (
            <button
              onClick={() => { store.setNS(k, false); onChange() }}
              className="w-full py-2.5 text-sm font-semibold text-status-warn bg-status-warnBg border border-status-warn/30 rounded-xl hover:opacity-80 transition-opacity"
            >
              ✓ Nothing here — tap to undo
            </button>
          ) : (
            <>
              {isPlt ? (
                <PalletEntry k={k} state={state} store={store} onChange={onChange} lang={lang} />
              ) : (
                <BagEntry k={k} state={state} store={store} onChange={onChange} onOpenKp={onOpenKp} item={item} section={section} lang={lang} />
              )}
              <button
                onClick={() => { store.setNS(k, true); onChange() }}
                className="w-full mt-2 py-2 text-xs text-text-muted border border-surface-rule rounded-xl hover:border-status-warn hover:text-status-warn hover:bg-status-warnBg transition-colors"
              >
                {t(lang, 'ns' as any)}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── BAG ENTRY ─────────────────────────────────────────────────────────────────
// Desktop (lg+): native inputs — no bounce, works with laptop keyboard
// Tablet/mobile: tap-to-open keypad bottom sheet — large tap targets
function BagEntry({ k, state, store, onChange, onOpenKp, item, section, lang }: any) {
  const groups = groupByBatch(state.bags)

  // pointer:coarse = touch device (tablet/phone) → custom keypad, large tap targets
  // pointer:fine   = mouse/trackpad (laptop/desktop) → native inputs with proper styling
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  // Shared input style — used for desktop native inputs
  // Explicitly written out (not relying on .input CSS class which may not exist)
  const nativeInputCls = `w-full px-3 py-2.5 rounded-xl border-2 border-surface-rule bg-surface-card
    font-mono text-[13px] text-text outline-none transition-colors
    focus:border-accent focus:bg-white placeholder:text-text-faint`

  return (
    <div className="space-y-2">
      {state.bags.map((b: any, i: number) => (
        <div key={i} className="bg-surface rounded-xl p-3 border border-surface-rule">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase tracking-[.5px] text-text-muted">Bag {i+1}</span>
            {state.bags.length > 1 && (
              <button onClick={() => { store.removeBag(k, i); onChange() }}>
                <Trash2 size={13} className="text-text-faint hover:text-status-error transition-colors" />
              </button>
            )}
          </div>

          {/* Batch number */}
          <div className="text-[10px] font-mono text-text-muted mb-1 uppercase tracking-[.5px]">Batch number</div>
          {!isTouch ? (
            // Desktop / laptop — native input, types directly
            <input
              type="text"
              value={b.batch || ''}
              onChange={e => { store.updateBag(k, i, 'batch', e.target.value.toUpperCase()); onChange() }}
              placeholder="Enter batch number"
              className={`${nativeInputCls} mb-3 text-[13px]`}
            />
          ) : (
            // Tablet / phone — tap to open custom keypad
            <button
              onClick={() => onOpenKp({ type: 'batch', key: k, index: i, context: `${item.name} · Bag ${i+1}`, initial: b.batch })}
              className={clsx(
                'w-full px-3 py-2.5 text-left rounded-xl border-2 font-mono text-[13px] font-bold mb-3 transition-colors',
                b.batch
                  ? 'border-accent/40 bg-status-okBg/50 text-text'
                  : 'border-accent/20 bg-surface-card text-text-muted hover:border-accent/40'
              )}
            >
              {b.batch || (
                <span className="flex items-center gap-2 text-text-muted font-normal">
                  <span className="text-accent text-[16px] leading-none">+</span>
                  Tap to enter batch number
                </span>
              )}
            </button>
          )}

          {/* Weight */}
          <div className="text-[10px] font-mono text-text-muted mb-1 uppercase tracking-[.5px]">Weight (kg)</div>
          {!isTouch ? (
            // Desktop / laptop — native input, type="text" + inputMode to avoid bounce
            <input
              type="text"
              inputMode="decimal"
              value={b.kg || ''}
              onChange={e => { store.updateBag(k, i, 'kg', e.target.value); onChange() }}
              placeholder="0.0"
              className={`${nativeInputCls} text-[15px]`}
            />
          ) : (
            // Tablet / phone — tap to open numpad
            <button
              onClick={() => onOpenKp({ type: 'weight', key: k, index: i, context: `${item.name} · Bag ${i+1}`, initial: b.kg })}
              className={clsx(
                'w-full px-3 py-2.5 text-left rounded-xl border-2 font-mono text-[15px] font-bold transition-colors',
                parseFloat(b.kg) > 0
                  ? 'border-accent/40 bg-status-okBg/50 text-text'
                  : 'border-accent/20 bg-surface-card text-text-muted hover:border-accent/40'
              )}
            >
              {parseFloat(b.kg) > 0 ? `${b.kg} kg` : (
                <span className="flex items-center gap-2 text-text-muted font-normal">
                  <span className="text-accent text-[16px] leading-none">+</span>
                  Tap to enter weight
                </span>
              )}
            </button>
          )}
        </div>
      ))}

      {/* Batch summary pills */}
      {Object.keys(groups).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(groups).map(([batch, g]: any) => (
            <div key={batch} className="flex items-center gap-2 px-2.5 py-1 bg-status-okBg border border-status-ok/30 rounded-lg text-[11px]">
              <span className="font-mono font-bold text-status-ok">{batch}</span>
              <span className="text-text-muted">{g.count} bag{g.count!==1?'s':''}</span>
              <span className="font-bold text-status-ok">{g.total.toFixed(1)} kg</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => { store.addBag(k); onChange() }}
        className="w-full py-2.5 border-2 border-dashed border-surface-rule rounded-xl font-display font-bold text-sm text-accent hover:bg-status-okBg hover:border-accent/40 transition-colors"
      >
        {t(lang, 'abag' as any)}
      </button>
    </div>
  )
}

// ── PALLET ENTRY ──────────────────────────────────────────────────────────────
function PalletEntry({ k, state, store, onChange, lang }: any) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted bg-surface-card rounded-xl px-3 py-2 border border-surface-rule">
        Enter container counts — weight calculates automatically
      </p>
      {state.pallets.map((p: any, i: number) => {
        const kg = palletKg(+p.boxes||0, +p.bags||0, +p.paper||0)
        return (
          <div key={i} className="bg-surface rounded-xl p-3 border border-surface-rule">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] uppercase tracking-[.5px] text-text-muted">Pallet {i+1}</span>
              <div className="flex items-center gap-3">
                {kg > 0 && <span className="font-mono text-xs font-bold text-status-ok">{kg.toLocaleString()} kg</span>}
                {state.pallets.length > 1 && (
                  <button onClick={() => { store.removePallet(k, i); onChange() }}>
                    <Trash2 size={13} className="text-text-faint hover:text-status-error transition-colors" />
                  </button>
                )}
              </div>
            </div>

            <div className="text-[10px] font-mono text-text-muted mb-1 uppercase tracking-[.5px]">Batch number</div>
            <input
              type="text"
              value={p.batch}
              onChange={e => { store.updatePallet(k, i, 'batch', e.target.value); onChange() }}
              placeholder="Batch number"
              className="w-full px-3 py-2 mb-3 border-2 border-surface-rule rounded-xl font-mono text-[13px] font-bold bg-surface-card text-text outline-none focus:border-accent uppercase"
            />

            {PALLET_PACKAGES.map(pkg => (
              <div key={pkg.key} className="flex items-center gap-3 mb-2">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-text">{pkg.label}</div>
                  <div className="font-mono text-[9px] text-text-muted">{pkg.weight} kg each</div>
                </div>
                {/* FIX: type="text" + inputMode="numeric" prevents keyboard bounce */}
                <input
                  type="text"
                  inputMode="numeric"
                  value={p[pkg.key] || ''}
                  onChange={e => { store.updatePallet(k, i, pkg.key as any, e.target.value); onChange() }}
                  placeholder="0"
                  className="w-20 px-2 py-2 border-2 border-surface-rule rounded-xl font-mono text-base font-bold text-center bg-surface-card text-text outline-none focus:border-accent"
                />
                {parseInt(p[pkg.key]) > 0 && (
                  <span className="font-mono text-[10px] font-bold text-status-ok w-16 text-right">
                    {(parseInt(p[pkg.key]) * pkg.weight).toLocaleString()} kg
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      })}
      <button
        onClick={() => { store.addPallet(k); onChange() }}
        className="w-full py-2.5 border-2 border-dashed border-surface-rule rounded-xl font-display font-bold text-sm text-accent hover:bg-status-okBg hover:border-accent/40 transition-colors"
      >
        {t(lang, 'aplt' as any)}
      </button>
    </div>
  )
}

export default function CountPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-full flex items-center justify-center">
        <div className="font-mono text-[11px] tracking-[2px] uppercase text-text-muted animate-pulse">Loading…</div>
      </div>
    }>
      <CountPage />
    </Suspense>
  )
}
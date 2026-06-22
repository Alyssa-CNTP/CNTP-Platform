'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { ROOIBOS_SECTIONS, ROSEHIP_SECTIONS } from '@/lib/data/sections'
import type { Section, InventoryItem } from '@/lib/data/sections'
import { t } from '@/lib/data/translations'
import { ChevronDown, ChevronRight, Plus, Trash2, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface McSession {
  id:               string
  count_month:      string
  warehouse_id:     string
  product_type:     string
  sup_name:         string | null
  adm_name:         string | null
  sup_confirmed_at: string | null
  adm_confirmed_at: string | null
  sup_total_kg:     number | null
  adm_total_kg:     number | null
  match_rate_pct:   number | null
  signed_off_by:    string | null
  signed_off_at:    string | null
  sign_off_notes:   string | null
}

interface BatchRow {
  id:      string
  batch:   string
  kg:      string
  bags:    string
}

interface ItemState {
  rows:    BatchRow[]
  noStock: boolean
}

type FormState = Record<string, ItemState>   // key: `${sectionId}:${item.uid}`

function itemKey(sectionId: string, uid: string) { return `${sectionId}:${uid}` }

function emptyRow(): BatchRow {
  return { id: crypto.randomUUID(), batch: '', kg: '', bags: '' }
}

function defaultItemState(): ItemState {
  return { rows: [emptyRow()], noStock: false }
}

function totalKg(state: FormState): number {
  return Object.values(state).reduce((sum, it) => {
    if (it.noStock) return sum
    return sum + it.rows.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0)
  }, 0)
}

// ── Section card ──────────────────────────────────────────────────────────────
function SectionCard({
  section, state, open, onToggle, onChange,
}: {
  section: Section
  state:   FormState
  open:    boolean
  onToggle: () => void
  onChange: (key: string, next: ItemState) => void
}) {
  const sectionKg = section.items.reduce((sum, it) => {
    const st = state[itemKey(section.id, it.uid)]
    if (!st || st.noStock) return sum
    return sum + st.rows.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0)
  }, 0)

  const doneItems = section.items.filter(it => {
    const st = state[itemKey(section.id, it.uid)]
    return st && (st.noStock || st.rows.some(r => parseFloat(r.kg) > 0))
  }).length

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-surface transition-colors"
      >
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${section.color}`} />
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[14px] text-text">{t('en', section.tk as any)}</div>
          <div className="font-mono text-[11px] text-text-muted mt-0.5">
            {doneItems}/{section.items.length} items
            {sectionKg > 0 && ` · ${Math.round(sectionKg).toLocaleString()} kg`}
          </div>
        </div>
        {doneItems === section.items.length && (
          <CheckCircle2 size={16} className="text-ok flex-shrink-0" />
        )}
        {open
          ? <ChevronDown  size={16} className="text-text-muted flex-shrink-0" />
          : <ChevronRight size={16} className="text-text-muted flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-surface-rule divide-y divide-surface-rule">
          {section.items.map(item => (
            <ItemRow
              key={item.uid}
              item={item}
              state={state[itemKey(section.id, item.uid)] ?? defaultItemState()}
              onChange={next => onChange(itemKey(section.id, item.uid), next)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Item row ──────────────────────────────────────────────────────────────────
function ItemRow({
  item, state, onChange,
}: {
  item:     InventoryItem
  state:    ItemState
  onChange: (next: ItemState) => void
}) {
  function updateRow(rowId: string, field: keyof BatchRow, value: string) {
    onChange({
      ...state,
      rows: state.rows.map(r => r.id === rowId ? { ...r, [field]: value } : r),
    })
  }

  function addRow() {
    onChange({ ...state, rows: [...state.rows, emptyRow()] })
  }

  function removeRow(rowId: string) {
    const rows = state.rows.filter(r => r.id !== rowId)
    onChange({ ...state, rows: rows.length ? rows : [emptyRow()] })
  }

  function toggleNoStock() {
    onChange({ ...state, noStock: !state.noStock })
  }

  const totalItemKg = state.noStock
    ? 0
    : state.rows.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0)

  return (
    <div className={`px-5 py-4 space-y-3 transition-colors ${state.noStock ? 'bg-surface-rule/30' : ''}`}>
      {/* Item header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-body font-semibold text-[13px] text-text">{item.name}</div>
          <div className="font-mono text-[10px] text-text-muted">{item.base}</div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {totalItemKg > 0 && (
            <span className="font-mono text-[11px] font-bold text-ok">
              {totalItemKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
            </span>
          )}
          {/* No Stock toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <div
              onClick={toggleNoStock}
              className={`w-8 h-4 rounded-full transition-colors relative flex-shrink-0 ${
                state.noStock ? 'bg-warn' : 'bg-surface-rule'
              }`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                state.noStock ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </div>
            <span className="font-mono text-[10px] text-text-muted">No stock</span>
          </label>
        </div>
      </div>

      {/* Batch rows */}
      {!state.noStock && (
        <div className="space-y-2">
          {/* Column headers — show once */}
          <div className="grid grid-cols-[1fr_100px_70px_24px] gap-2 px-1">
            <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted">Batch Number</div>
            <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted text-right">Weight (kg)</div>
            <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted text-right">Bags</div>
            <div />
          </div>

          {state.rows.map((row, i) => (
            <div key={row.id} className="grid grid-cols-[1fr_100px_70px_24px] gap-2 items-center">
              <input
                type="text"
                value={row.batch}
                onChange={e => updateRow(row.id, 'batch', e.target.value.toUpperCase())}
                placeholder="e.g. RB-2025-05"
                className="px-3 py-2.5 rounded-xl border border-surface-rule bg-surface font-mono text-[12px] text-text uppercase outline-none focus:border-brand"
              />
              <input
                type="text"
                inputMode="decimal"
                value={row.kg}
                onChange={e => updateRow(row.id, 'kg', e.target.value)}
                placeholder="0.000"
                className="px-3 py-2.5 rounded-xl border border-surface-rule bg-surface font-mono text-[13px] text-text text-right outline-none focus:border-brand"
              />
              <input
                type="text"
                inputMode="numeric"
                value={row.bags}
                onChange={e => updateRow(row.id, 'bags', e.target.value)}
                placeholder="0"
                className="px-3 py-2.5 rounded-xl border border-surface-rule bg-surface font-mono text-[13px] text-text text-right outline-none focus:border-brand"
              />
              <button
                onClick={() => removeRow(row.id)}
                disabled={state.rows.length === 1 && i === 0}
                className="w-6 h-6 flex items-center justify-center rounded-lg text-text-muted hover:text-err hover:bg-err/10 transition-colors disabled:opacity-20"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          <button
            onClick={addRow}
            className="flex items-center gap-1.5 font-mono text-[11px] text-brand hover:underline mt-1"
          >
            <Plus size={11} /> Add batch
          </button>
        </div>
      )}
    </div>
  )
}

// ── Submitted state ───────────────────────────────────────────────────────────
function SubmittedState({
  role, session,
}: {
  role:    'supervisor' | 'admin'
  session: McSession
}) {
  const ts   = role === 'supervisor' ? session.sup_confirmed_at : session.adm_confirmed_at
  const name = role === 'supervisor' ? session.sup_name        : session.adm_name
  const kg   = role === 'supervisor' ? session.sup_total_kg    : session.adm_total_kg
  const other = role === 'supervisor' ? session.adm_confirmed_at : session.sup_confirmed_at

  return (
    <div className="space-y-4 py-6 max-w-md mx-auto text-center">
      <div className="w-16 h-16 rounded-full bg-ok/10 border-2 border-ok/30 flex items-center justify-center mx-auto">
        <CheckCircle2 size={30} className="text-ok" />
      </div>
      <div>
        <p className="font-display font-bold text-[18px] text-text">Count Submitted</p>
        <p className="font-mono text-[12px] text-text-muted mt-1">
          {name} · {kg != null ? `${Math.round(kg).toLocaleString()} kg` : '—'}
        </p>
        {ts && (
          <p className="font-mono text-[11px] text-text-faint mt-0.5">
            {format(new Date(ts), 'd MMM yyyy · HH:mm')}
          </p>
        )}
      </div>
      {!other && (
        <div className="flex items-center gap-2 px-4 py-3 bg-info/8 border border-info/25 rounded-xl text-left">
          <AlertTriangle size={14} className="text-info flex-shrink-0" />
          <p className="font-mono text-[11px] text-info">
            Waiting for the {role === 'supervisor' ? 'admin' : 'supervisor'} to complete their count before comparison is available.
          </p>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MONTHLY COUNT FORM
// ═════════════════════════════════════════════════════════════════════════════
export default function MonthlyCountForm({
  session,
  month,
  product,
  displayName,
  onSessionUpdate,
}: {
  session:         McSession | null
  month:           string           // yyyy-MM
  product:         'r' | 'h'
  displayName:     string
  onSessionUpdate: (s: McSession) => void
}) {
  const { user, role, isIT } = useAuth()
  const db = getDb()

  // For admin/supervisor roles, pin automatically. IT and other roles choose.
  const autoRole = (role === 'admin' || role === 'supervisor') ? role : null
  const [pickedRole, setPickedRole] = useState<'admin' | 'supervisor'>(
    autoRole ?? 'admin'
  )
  const countRole: 'admin' | 'supervisor' = autoRole ?? pickedRole
  const sections  = product === 'r' ? ROOIBOS_SECTIONS : ROSEHIP_SECTIONS

  const [formState,    setFormState]    = useState<FormState>({})
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [submitting,   setSubmitting]   = useState(false)
  const [saveStatus,   setSaveStatus]   = useState<'idle'|'saving'|'saved'>('idle')
  const [error,        setError]        = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const alreadySubmitted =
    session && (countRole === 'supervisor' ? !!session.sup_confirmed_at : !!session.adm_confirmed_at)

  // ── Initialise form state ─────────────────────────────────────────────────
  useEffect(() => {
    initForm()
  }, [month, product, session?.id])

  async function initForm() {
    // Build default state for all items
    const defaults: FormState = {}
    sections.forEach(sec => {
      sec.items.forEach(item => {
        defaults[itemKey(sec.id, item.uid)] = defaultItemState()
      })
    })

    // Try loading draft
    if (user?.id) {
      const monthDate = `${month}-01`
      const { data: draft } = await db
        .from('mc_drafts')
        .select('state')
        .eq('user_id', user.id)
        .eq('count_month', monthDate)
        .eq('product_type', product)
        .eq('role', countRole)
        .maybeSingle()

      if (draft?.state && Object.keys(draft.state).length > 0) {
        setFormState({ ...defaults, ...(draft.state as FormState) })
        return
      }
    }

    // If session exists and this role has already submitted, load submitted entries
    if (session?.id && alreadySubmitted) {
      const { data: entries } = await db
        .from('mc_entries')
        .select('*')
        .eq('session_id', session.id)
        .eq('role', countRole)

      if (entries?.length) {
        const restored: FormState = { ...defaults }
        // Group entries by item key
        entries.forEach((e: any) => {
          const k = Object.keys(defaults).find(k => {
            const [, uid] = k.split(':')
            return e.inventory_code?.startsWith(uid) || e.section_id + ':' + uid === k
          })
          if (!k) return
          const row: BatchRow = {
            id:    crypto.randomUUID(),
            batch: e.batch_number ?? '',
            kg:    String(e.kg ?? ''),
            bags:  String(e.bags_qty ?? ''),
          }
          if (!restored[k]) restored[k] = { rows: [], noStock: false }
          if (e.is_no_stock) {
            restored[k].noStock = true
          } else {
            if (restored[k].rows.length === 1 && !restored[k].rows[0].kg) {
              restored[k].rows = [row]
            } else {
              restored[k].rows.push(row)
            }
          }
        })
        setFormState(restored)
        return
      }
    }

    setFormState(defaults)
  }

  // ── Auto-save draft ───────────────────────────────────────────────────────
  const scheduleSave = useCallback((state: FormState) => {
    if (!user?.id || alreadySubmitted) return
    setSaveStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const monthDate = `${month}-01`
      await db.from('mc_drafts').upsert({
        user_id:      user.id,
        count_month:  monthDate,
        product_type: product,
        role:         countRole,
        state,
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'user_id,count_month,product_type,role' })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 1200)
  }, [user?.id, month, product, countRole, alreadySubmitted])

  function updateItem(key: string, next: ItemState) {
    setFormState(prev => {
      const s = { ...prev, [key]: next }
      scheduleSave(s)
      return s
    })
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    try {
      const monthDate = `${month}-01`

      // Ensure session exists
      let sessionId = session?.id
      if (!sessionId) {
        const { data: existing } = await db
          .from('mc_sessions')
          .select('id')
          .eq('count_month', monthDate)
          .eq('warehouse_id', 'BHW')
          .eq('product_type', product)
          .maybeSingle()

        if (existing?.id) {
          sessionId = existing.id
        } else {
          const { data: created, error: createErr } = await db
            .from('mc_sessions')
            .insert({ count_month: monthDate, warehouse_id: 'BHW', product_type: product })
            .select('id')
            .single()
          if (createErr || !created) throw new Error(createErr?.message ?? 'Failed to create session')
          sessionId = created.id
        }
      }

      // Build entry rows
      const totalKgVal = totalKg(formState)
      const entries: any[] = []

      sections.forEach(sec => {
        sec.items.forEach(item => {
          const k  = itemKey(sec.id, item.uid)
          const st = formState[k]
          if (!st) return

          if (st.noStock) {
            entries.push({
              session_id:     sessionId,
              role:           countRole,
              section_id:     sec.id,
              section_name:   t('en', sec.tk as any),
              inventory_code: item.base,
              item_name:      item.name,
              batch_number:   null,
              kg:             0,
              bags_qty:       0,
              is_no_stock:    true,
            })
          } else {
            st.rows.forEach(r => {
              const kg = parseFloat(r.kg) || 0
              if (kg === 0 && !r.batch) return
              entries.push({
                session_id:     sessionId,
                role:           countRole,
                section_id:     sec.id,
                section_name:   t('en', sec.tk as any),
                inventory_code: item.base,
                item_name:      item.name,
                batch_number:   r.batch.trim().toUpperCase() || null,
                kg,
                bags_qty:       parseInt(r.bags) || 0,
                is_no_stock:    false,
              })
            })
          }
        })
      })

      // Delete old entries for this role + session, re-insert
      await db.from('mc_entries')
        .delete()
        .eq('session_id', sessionId)
        .eq('role', countRole)

      if (entries.length > 0) {
        const { error: entryErr } = await db.from('mc_entries').insert(entries)
        if (entryErr) throw new Error(entryErr.message)
      }

      // Update session confirmed fields
      const now  = new Date().toISOString()
      const patch: Record<string, any> = { updated_at: now }
      if (countRole === 'supervisor') {
        patch.sup_confirmed_at = now
        patch.sup_name         = displayName
        patch.sup_total_kg     = totalKgVal
      } else {
        patch.adm_confirmed_at = now
        patch.adm_name         = displayName
        patch.adm_total_kg     = totalKgVal
      }

      const { data: updatedSession, error: sessionErr } = await db
        .from('mc_sessions')
        .update(patch)
        .eq('id', sessionId)
        .select('*')
        .single()

      if (sessionErr) throw new Error(sessionErr.message)

      // Compute match rate if both roles confirmed
      const s = updatedSession as McSession
      if (s.sup_confirmed_at && s.adm_confirmed_at && s.sup_total_kg != null && s.adm_total_kg != null) {
        const maxKg = Math.max(s.sup_total_kg, s.adm_total_kg)
        if (maxKg > 0) {
          const diff = Math.abs(s.sup_total_kg - s.adm_total_kg)
          const rate = Math.round((1 - diff / maxKg) * 100)
          await db.from('mc_sessions').update({ match_rate_pct: rate }).eq('id', sessionId)
          ;(s as any).match_rate_pct = rate
        }
      }

      // Clear draft
      if (user?.id) {
        await db.from('mc_drafts')
          .delete()
          .eq('user_id', user.id)
          .eq('count_month', monthDate)
          .eq('product_type', product)
          .eq('role', countRole)
      }

      onSessionUpdate(s)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render — submitted state ──────────────────────────────────────────────
  if (alreadySubmitted && session) {
    return <SubmittedState role={countRole} session={session} />
  }

  // ── Render — form ─────────────────────────────────────────────────────────
  const grandKg    = totalKg(formState)
  const totalItems = sections.reduce((n, s) => n + s.items.length, 0)
  const doneItems  = Object.values(formState).filter(
    st => st.noStock || st.rows.some(r => parseFloat(r.kg) > 0)
  ).length

  return (
    <div className="space-y-3 pb-32">
      {/* Role selector — shown for IT/management who can enter either role's count */}
      {!autoRole && (
        <div className="flex items-center gap-3 p-3 bg-surface-card border border-surface-rule rounded-xl">
          <span className="font-mono text-[11px] text-text-muted flex-shrink-0">Entering as:</span>
          <div className="flex border border-surface-rule rounded-lg overflow-hidden">
            {([
              { key: 'supervisor', label: 'Warehouse Supervisor' },
              { key: 'admin',      label: 'Stock' },
            ] as const).map((r, i) => (
              <button
                key={r.key}
                onClick={() => setPickedRole(r.key)}
                className={`px-4 py-1.5 font-display font-bold text-[12px] transition-colors ${i > 0 ? 'border-l border-surface-rule' : ''} ${pickedRole === r.key ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Role badge */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`font-mono text-[11px] font-bold px-3 py-1.5 rounded-lg uppercase tracking-wide ${
          countRole === 'admin'
            ? 'bg-info/10 text-info'
            : 'bg-ok/10 text-ok'
        }`}>
          {countRole === 'admin' ? 'Stock' : 'Warehouse Supervisor'} count
        </span>
        <span className="font-mono text-[11px] text-text-muted">{displayName}</span>
        <span className="font-mono text-[11px] text-text-faint ml-auto">
          {saveStatus === 'saving' ? '⏳ Saving…' : saveStatus === 'saved' ? '✓ Saved' : ''}
        </span>
      </div>

      {/* Sections */}
      {sections.map(sec => (
        <SectionCard
          key={sec.id}
          section={sec}
          state={formState}
          open={!!openSections[sec.id]}
          onToggle={() => setOpenSections(p => ({ ...p, [sec.id]: !p[sec.id] }))}
          onChange={updateItem}
        />
      ))}

      {/* Sticky submit footer */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-card border-t border-surface-rule px-4 py-3 xl:pl-[240px]">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <div>
            <div className="font-display font-bold text-[18px] text-text">
              {Math.round(grandKg).toLocaleString()} kg
            </div>
            <div className="font-mono text-[10px] text-text-muted">
              {doneItems}/{totalItems} items completed
            </div>
          </div>
          <div className="flex-1 h-2 bg-surface-rule rounded-full overflow-hidden">
            <div
              className="h-full bg-brand rounded-full transition-all"
              style={{ width: `${totalItems ? Math.round((doneItems / totalItems) * 100) : 0}%` }}
            />
          </div>
          {error && <p className="font-mono text-[11px] text-err">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={submitting || doneItems === 0}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-brand text-white font-display font-bold text-[14px] disabled:opacity-40 transition-opacity flex-shrink-0"
          >
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
              : 'Submit Count'
            }
          </button>
        </div>
      </div>
    </div>
  )
}

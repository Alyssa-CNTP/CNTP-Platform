'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  Loader2, Users, ChevronRight, ClipboardList, CalendarPlus, Play, Pen, CheckCircle2, Clock, Lock, UserCog,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SECTION_ORDER, sectionMeta } from '@/lib/production/capture-config'
import { SHIFT_LABEL, shiftValuesFor, productionShiftNow } from '@/lib/production/shifts'
import {
  shiftRecordCards, sectionStatus,
  type ShiftSessionRecord, type ShiftRecordCard,
} from '@/lib/core/production/shift-records'
import type { Operator, ShiftAssignment } from '@/lib/supabase/database.types'

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  none:      { label: 'Not started',    cls: 'bg-stone-100 text-stone-500',  icon: Play },
  draft:     { label: 'In progress',    cls: 'bg-warn/10 text-warn',         icon: Pen },
  submitted: { label: 'Awaiting sign-off', cls: 'bg-info/10 text-info',      icon: Clock },
  approved:  { label: 'Signed off',     cls: 'bg-ok/10 text-ok',             icon: CheckCircle2 },
}

/**
 * The session columns this screen reads. Named rather than `any` so a renamed
 * column fails here instead of silently rendering a blank chip.
 */
interface SessionRow {
  id: string
  section_id: string
  status: string | null
  record_no: string | null
  variant: string | null
  lot_number: string | null
  production_orders: string[] | null
  created_at: string | null
  deleted_at: string | null
}

/** snake_case row → the shape the core rule reasons over. */
function toRecord(r: SessionRow): ShiftSessionRecord {
  return {
    id: r.id,
    sectionId: r.section_id,
    status: r.status,
    recordNo: r.record_no,
    variant: r.variant,
    lotNumber: r.lot_number,
    productionOrders: r.production_orders,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  }
}

export default function CaptureLandingPage() {
  const router = useRouter()
  const { user, isSupervisor, isIT, role, displayName } = useAuth()
  const canAssign = isSupervisor || isIT || role === 'admin'
  const isFloorOperator = role === 'floor_operator'
  const firstName = (displayName ?? '').split(' ')[0] || 'there'

  // date and shift always agree on which production shift "now" belongs to —
  // see productionShiftNow()'s comment for why that's not simply today+currentShift().
  const [{ date, shift }, setDateShift] = useState(productionShiftNow())

  // A tablet left open across a shift boundary (07h00/16h00) would otherwise be
  // stuck showing the shift that was current when the tab was opened, forever —
  // recheck periodically and roll forward when it actually changes.
  useEffect(() => {
    const id = setInterval(() => {
      const next = productionShiftNow()
      setDateShift(prev => (prev.date === next.date && prev.shift === next.shift) ? prev : next)
    }, 60_000)
    return () => clearInterval(id)
  }, [])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [opMap, setOpMap] = useState<Record<string, string>>({})
  const [records, setRecords] = useState<ShiftSessionRecord[]>([])
  const [myOperatorId, setMyOperatorId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const db = getDb()
      const [{ data: ops }, { data: assigns }, { data: sessions }] = await Promise.all([
        db.schema('production').from('operators').select('id,name,display_name,user_id').eq('active', true),
        db.schema('production').from('shift_assignments').select('*').eq('date', date).in('shift', shiftValuesFor(shift)),
        // Every column a card needs. This used to select `section_id,status`
        // only, which is why two records could not be told apart.
        db.schema('production').from('prod_sessions')
          .select('id,section_id,status,record_no,variant,lot_number,production_orders,created_at,deleted_at')
          .eq('date', date).in('shift', shiftValuesFor(shift)),
      ])
      const m: Record<string, string> = {}
      ;(ops as Operator[] ?? []).forEach(o => { m[o.id] = o.display_name || o.name })
      setOpMap(m)
      setAssignments((assigns as ShiftAssignment[]) ?? [])
      setRecords(((sessions ?? []) as SessionRow[]).map(toRecord))
      // Resolve which operator record belongs to the logged-in user
      if (user?.id) {
        const me = (ops as Operator[] ?? []).find(o => o.user_id === user.id)
        if (me) setMyOperatorId(me.id)
      }
      setLoading(false)
    }
    load()
  }, [date, shift, user?.id])

  // Supervisors/admins see all rostered sections.
  // Floor operators only see sections where they are listed as an assigned operator.
  const assignedSections = SECTION_ORDER.filter(id => {
    const a = assignments.find(x => x.section_id === id)
    if (!a) return false
    if (canAssign) return true
    if (!myOperatorId) return true   // operator record not found — show all as fallback
    return (a.operator_ids ?? []).includes(myOperatorId)
  })

  /**
   * The cards, derived ONCE. The sign-off queue and the grid below both read
   * this, so they cannot disagree about how many records a shift has — which is
   * the drift ARCHITECTURE.md §4 keeps naming.
   */
  const cardsBySection: [string, ShiftRecordCard[]][] = assignedSections.map(sectionId => {
    const a = assignments.find(x => x.section_id === sectionId)!
    return [sectionId, shiftRecordCards(records, {
      sectionId,
      variant: a.variant ?? null,
      lotNumber: a.lot_number ?? null,
      productionOrders: (a.production_orders as string[] | null) ?? null,
    })]
  })

  /** A card links to its OWN record — without `session` the page opens the
   *  newest one, which is the wrong half of a changeover as often as not. */
  const hrefFor = (c: ShiftRecordCard) =>
    `/production/capture/${c.sectionId}?date=${date}&shift=${shift}` +
    (c.sessionId ? `&session=${c.sessionId}` : '')

  return (
    <div className="px-4 py-5 max-w-[900px] space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-[22px] text-text leading-tight">
            {isFloorOperator ? `Hi ${firstName}` : 'Capture'}
          </h1>
          <p className="text-[12px] text-text-muted mt-0.5">
            {format(new Date(date + 'T12:00:00'), 'EEEE d MMMM yyyy')} · {SHIFT_LABEL[shift]} shift
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canAssign && (
            <>
              <Link
                href="/production/operators"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-stone-200 text-text font-medium text-[13px] hover:bg-stone-50 transition-colors"
              >
                <UserCog size={15} /> Operators
              </Link>
              <Link
                href="/production/capture/assign"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white font-medium text-[13px] hover:bg-brand-mid transition-colors"
              >
                <CalendarPlus size={15} /> Assign sections
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Supervisor approvals queue */}
      {!loading && canAssign && (() => {
        // One row per RECORD awaiting sign-off, not per section. A shift that
        // changed over has two, and they are signed off separately — listing
        // the section once sent the supervisor to whichever record the page
        // happened to open and left the other one waiting, invisibly.
        const pending = cardsBySection.flatMap(([, cards]) =>
          cards.filter(c => c.status === 'submitted'))
        if (!pending.length) return null
        return (
          <div className="bg-info/5 border border-info/30 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-medium text-info"><Pen size={14} /> Needs your sign-off ({pending.length})</div>
            {pending.map(c => {
              const m = sectionMeta(c.sectionId)
              return (
                <Link key={c.key} href={hrefFor(c)}
                  className="flex items-center gap-3 px-3 py-2.5 bg-white border border-stone-200 rounded-xl hover:border-info/40 transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                    <span className="font-mono font-bold text-[10px] text-white">{m.code}</span>
                  </div>
                  <span className="flex-1 text-[13px] font-medium text-text truncate">
                    {m.name}
                    {c.total > 1 && (
                      <span className="text-text-muted font-normal"> · {c.recordNo ?? `record ${c.ordinal}`}</span>
                    )}
                  </span>
                  <span className="text-[11px] text-info flex items-center gap-1 shrink-0">Review &amp; approve <ChevronRight size={13} /></span>
                </Link>
              )
            })}
          </div>
        )
      })()}

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 size={22} className="animate-spin text-text-muted" /></div>
      ) : assignedSections.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto">
            <ClipboardList size={22} className="text-stone-400" />
          </div>
          <p className="text-[14px] font-medium text-text">No sections assigned for this shift yet</p>
          <p className="text-[12px] text-text-muted max-w-sm mx-auto">
            {canAssign
              ? 'Tap “Assign sections” to roster operators onto each line.'
              : 'Your supervisor hasn’t rostered any sections for this shift. Check back shortly.'}
          </p>
        </div>
      ) : (
        <>
        {/* At-a-glance overview */}
        <div className="grid grid-cols-3 gap-3 mb-1">
          {(() => {
            // Still counted per SECTION — an operator thinks in lines, not in
            // records. What changed is that a section counts as finished only
            // when every one of its records is, instead of whichever row the
            // query happened to return last.
            const total = assignedSections.length
            const statuses = assignedSections.map(id => sectionStatus(records, id))
            const done   = statuses.filter(st => st === 'approved').length
            const active = statuses.filter(st => st === 'draft' || st === 'submitted').length
            const tiles = [
              { label: 'My sections', value: total,  cls: 'text-text' },
              { label: 'In progress', value: active, cls: 'text-warn' },
              { label: 'Completed',   value: done,   cls: 'text-ok' },
            ]
            return tiles.map(t => (
              <div key={t.label} className="bg-white border border-stone-200 rounded-2xl p-4">
                <div className={`font-mono font-bold text-[24px] ${t.cls}`}>{t.value}</div>
                <div className="text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
              </div>
            ))
          })()}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cardsBySection.flatMap(([sectionId, cards]) => cards.map(rec => {
            const meta   = sectionMeta(sectionId)
            const assign = assignments.find(a => a.section_id === sectionId)!
            const names  = (assign.operator_ids ?? []).map(id => opMap[id] ?? '—')
            const status = rec.status
            const sm     = STATUS_META[status] ?? STATUS_META.none
            const Icon   = sm.icon
            const locked = status === 'approved'
            // A shift that changed over shows one card per record. Each carries
            // its OWN variant, lot and status and opens its OWN session — the
            // second blend is Organic even when the roster row says Conventional.
            const multi  = rec.total > 1

            const href = hrefFor(rec)
            const card = (
              <div className={`relative flex flex-col gap-3 p-4 rounded-2xl border bg-white shadow-sm transition-all ${meta.built ? 'hover:shadow-md hover:border-stone-300 active:scale-[0.99]' : 'opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: meta.colorHex }}>
                    <span className="font-mono font-bold text-[12px] text-white">{meta.code}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[15px] text-text leading-tight flex items-baseline gap-1.5">
                      <span className="truncate">{meta.name}</span>
                      {multi && (
                        <span className="text-[11px] font-mono font-medium text-text-muted shrink-0">
                          {rec.ordinal}/{rec.total}
                        </span>
                      )}
                    </div>
                    {multi && rec.recordNo && (
                      <div className="text-[10px] font-mono text-text-faint truncate mt-0.5">{rec.recordNo}</div>
                    )}
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-text-muted font-mono truncate">
                      <Users size={11} className="shrink-0" />
                      {names.join(', ') || 'No operators'}
                    </div>
                  </div>
                  {locked ? <Lock size={15} className="text-ok shrink-0" /> : meta.built ? <ChevronRight size={18} className="text-stone-300 shrink-0" /> : null}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg ${sm.cls}`}>
                    <Icon size={11} /> {sm.label}
                  </span>
                  {/* The RECORD's own identity, not the roster row's. */}
                  {rec.variant && <span className="text-[10px] font-mono text-text-muted px-2 py-1 rounded-lg bg-stone-50 border border-stone-100">{rec.variant}</span>}
                  {rec.lotNumber && <span className="text-[10px] font-mono text-text-muted px-2 py-1 rounded-lg bg-stone-50 border border-stone-100">{rec.lotNumber}</span>}
                  {rec.productionOrders.slice(0, 2).map(po => (
                    <span key={po} className="text-[10px] font-mono text-text-muted px-2 py-1 rounded-lg bg-stone-50 border border-stone-100">{po}</span>
                  ))}
                  {!meta.built && <span className="text-[10px] font-medium text-amber-700 ml-auto">Coming soon</span>}
                  {/* Only on the LAST record of the section. On an earlier one
                      it read as an invitation to add a batch that already
                      exists, which is how a shift ends up with an empty third
                      record nobody meant to open. */}
                  {locked && rec.ordinal === rec.total && (
                    <span className="text-[10px] font-medium text-ok ml-auto">Tap to add another batch</span>
                  )}
                </div>
              </div>
            )

            return meta.built
              ? <Link key={rec.key} href={href}>{card}</Link>
              : <div key={rec.key}>{card}</div>
          }))}
        </div>
        </>
      )}
    </div>
  )
}

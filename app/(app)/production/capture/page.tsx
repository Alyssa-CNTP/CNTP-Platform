'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  Loader2, Users, ChevronRight, ClipboardList, CalendarPlus, Play, Pen, CheckCircle2, Clock, Lock, UserCog, Tablet,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SECTION_ORDER, sectionMeta } from '@/lib/production/capture-config'
import { getDeviceBinding } from '@/lib/production/device'
import type { Operator, ShiftAssignment } from '@/lib/supabase/database.types'

type Shift = 'morning' | 'afternoon' | 'night'

function currentShift(): Shift {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'morning' : h >= 16 && h < 23 ? 'afternoon' : 'night'
}

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  none:      { label: 'Not started',    cls: 'bg-stone-100 text-stone-500',  icon: Play },
  draft:     { label: 'In progress',    cls: 'bg-warn/10 text-warn',         icon: Pen },
  submitted: { label: 'Awaiting sign-off', cls: 'bg-info/10 text-info',      icon: Clock },
  approved:  { label: 'Signed off',     cls: 'bg-ok/10 text-ok',             icon: CheckCircle2 },
}

export default function CaptureLandingPage() {
  const router = useRouter()
  const { isSupervisor, isIT, role, displayName } = useAuth()
  const canAssign = isSupervisor || isIT || role === 'admin'
  const isFloorOperator = role === 'floor_operator'
  const firstName = (displayName ?? '').split(' ')[0] || 'there'

  const [shift]       = useState<Shift>(currentShift())
  const date          = format(new Date(), 'yyyy-MM-dd')
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [opMap, setOpMap] = useState<Record<string, string>>({})
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [device, setDevice] = useState(() => getDeviceBinding())

  // Tablet bound to a section opens straight to that section's capture — once per
  // app launch (sessionStorage guard) so the back button still returns here.
  useEffect(() => {
    const b = getDeviceBinding()
    setDevice(b)
    if (b?.kind === 'section') {
      try {
        if (!sessionStorage.getItem('cntp_device_routed')) {
          sessionStorage.setItem('cntp_device_routed', '1')
          router.replace(`/production/capture/${b.sectionId}?date=${format(new Date(), 'yyyy-MM-dd')}&shift=${currentShift()}`)
        }
      } catch { /* ignore */ }
    }
  }, [router])

  useEffect(() => {
    async function load() {
      const db = getDb()
      const [{ data: ops }, { data: assigns }, { data: sessions }] = await Promise.all([
        db.schema('production').from('operators').select('id,name,display_name').eq('active', true),
        db.schema('production').from('shift_assignments').select('*').eq('date', date).eq('shift', shift),
        db.schema('production').from('prod_sessions').select('section_id,status').eq('date', date).eq('shift', shift),
      ])
      const m: Record<string, string> = {}
      ;(ops as Operator[] ?? []).forEach(o => { m[o.id] = o.display_name || o.name })
      setOpMap(m)
      setAssignments((assigns as ShiftAssignment[]) ?? [])
      const sm: Record<string, string> = {}
      ;(sessions ?? []).forEach((s: any) => { sm[s.section_id] = s.status })
      setStatusMap(sm)
      setLoading(false)
    }
    load()
  }, [date, shift])

  const assignedSections = SECTION_ORDER.filter(id => assignments.some(a => a.section_id === id))

  return (
    <div className="px-4 py-5 max-w-[900px] space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-[22px] text-text leading-tight">
            {isFloorOperator ? `Hi ${firstName}` : 'Capture'}
          </h1>
          <p className="text-[12px] text-text-muted mt-0.5 capitalize">
            {format(new Date(date + 'T12:00:00'), 'EEEE d MMMM yyyy')} · {shift} shift
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/production/device"
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-stone-200 text-stone-600 font-medium text-[12px] hover:bg-stone-50 transition-colors"
            title="Set which section/role this tablet is"
          >
            <Tablet size={14} /> {device ? `This tablet: ${device.kind === 'supervisor' ? 'Supervisor' : sectionMeta(device.sectionId).name}` : 'Set up this tablet'}
          </Link>
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
        const pending = assignedSections.filter(id => statusMap[id] === 'submitted')
        if (!pending.length) return null
        return (
          <div className="bg-info/5 border border-info/30 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-medium text-info"><Pen size={14} /> Needs your sign-off ({pending.length})</div>
            {pending.map(id => {
              const m = sectionMeta(id)
              return (
                <Link key={id} href={`/production/capture/${id}?date=${date}&shift=${shift}`}
                  className="flex items-center gap-3 px-3 py-2.5 bg-white border border-stone-200 rounded-xl hover:border-info/40 transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                    <span className="font-mono font-bold text-[10px] text-white">{m.code}</span>
                  </div>
                  <span className="flex-1 text-[13px] font-medium text-text">{m.name}</span>
                  <span className="text-[11px] text-info flex items-center gap-1">Review &amp; approve <ChevronRight size={13} /></span>
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
            const total = assignedSections.length
            const done  = assignedSections.filter(id => statusMap[id] === 'approved').length
            const active = assignedSections.filter(id => statusMap[id] === 'draft' || statusMap[id] === 'submitted').length
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
          {assignedSections.map(sectionId => {
            const meta   = sectionMeta(sectionId)
            const assign = assignments.find(a => a.section_id === sectionId)!
            const names  = (assign.operator_ids ?? []).map(id => opMap[id] ?? '—')
            const status = statusMap[sectionId] ?? 'none'
            const sm     = STATUS_META[status] ?? STATUS_META.none
            const Icon   = sm.icon
            const locked = status === 'approved'

            const href = `/production/capture/${sectionId}?date=${date}&shift=${shift}`
            const card = (
              <div className={`relative flex flex-col gap-3 p-4 rounded-2xl border bg-white shadow-sm transition-all ${meta.built ? 'hover:shadow-md hover:border-stone-300 active:scale-[0.99]' : 'opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: meta.colorHex }}>
                    <span className="font-mono font-bold text-[12px] text-white">{meta.code}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[15px] text-text leading-tight">{meta.name}</div>
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
                  {assign.variant && <span className="text-[10px] font-mono text-text-muted px-2 py-1 rounded-lg bg-stone-50 border border-stone-100">{assign.variant}</span>}
                  {assign.lot_number && <span className="text-[10px] font-mono text-text-muted px-2 py-1 rounded-lg bg-stone-50 border border-stone-100">{assign.lot_number}</span>}
                  {!meta.built && <span className="text-[10px] font-medium text-amber-700 ml-auto">Coming soon</span>}
                  {locked && <span className="text-[10px] font-medium text-ok ml-auto">Tap to add another batch</span>}
                </div>
              </div>
            )

            return meta.built
              ? <Link key={sectionId} href={href}>{card}</Link>
              : <div key={sectionId}>{card}</div>
          })}
        </div>
        </>
      )}
    </div>
  )
}

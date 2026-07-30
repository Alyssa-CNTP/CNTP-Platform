'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  Users, Factory,
  ChevronRight, RefreshCw, Loader2, Pen, Play, CheckCircle2, Clock,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { currentShift, sastToday, SHIFT_LABEL, shiftValuesFor } from '@/lib/production/shifts'
import { sectionMeta, SECTION_ORDER } from '@/lib/production/capture-config'
import type { Shift } from '@/lib/supabase/database.types'
import { HubHeader } from '@/components/supervisor/HubTabs'
import { PendingSignOffs } from '@/components/supervisor/PendingSignOffs'

// This tab is the day-to-day "what needs my sign-off, right now" view — the
// KPI strip and 7-day trend charts that used to live on this route were cut
// deliberately (see components/supervisor/HubTabs.tsx): a supervisor who just
// needs to know which lines are running and what's waiting on their signature
// doesn't need an analytics dashboard in front of that.

const LINE_STATUS: Record<string, { label: string; cls: string; dot: string; icon: any }> = {
  none:      { label: 'Not started',       cls: 'bg-stone-100 text-stone-500', dot: 'bg-stone-300', icon: Play },
  draft:     { label: 'In progress',       cls: 'bg-warn/10 text-warn',        dot: 'bg-warn',      icon: Pen },
  submitted: { label: 'Awaiting sign-off', cls: 'bg-info/10 text-info',        dot: 'bg-info',      icon: Clock },
  approved:  { label: 'Signed off',        cls: 'bg-ok/10 text-ok',            dot: 'bg-ok',        icon: CheckCircle2 },
}

interface Sess { id: string; section_id: string; date: string; shift: string; status: string; operator_names: string[] | null }
interface MB   { session_id: string; total_input_kg: number; total_output_a_kg: number; total_output_b_kg: number; total_output_c_kg: number; total_output_d_kg: number }
interface Line { sectionId: string; status: string; operators: string[]; kg: number }

export default function SupervisorSignoff() {
  const today = sastToday()
  const shift = currentShift()

  const [sess, setSess]     = useState<Sess[]>([])
  const [mb, setMb]         = useState<Map<string, MB>>(new Map())
  const [opMap, setOpMap]   = useState<Record<string, string>>({})
  const [roster, setRoster] = useState<{ section_id: string; operator_ids: string[] }[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const db = getDb()
    const [assigns, sessToday, ops] = await Promise.all([
      db.schema('production').from('shift_assignments').select('section_id,operator_ids').eq('date', today).in('shift', shiftValuesFor(shift)),
      db.schema('production').from('prod_sessions').select('id,section_id,date,shift,status,operator_names').eq('date', today).is('deleted_at', null),
      db.schema('production').from('operators').select('id,name,display_name').eq('active', true),
    ])

    const sessRows = (sessToday.data as Sess[]) ?? []
    let mbRows: MB[] = []
    if (sessRows.length) {
      const { data } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_a_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
        .in('session_id', sessRows.map(s => s.id))
      mbRows = (data as MB[]) ?? []
    }

    const m: Record<string, string> = {}
    ;((ops.data as any[]) ?? []).forEach(o => { m[o.id] = o.display_name || o.name })

    setSess(sessRows)
    setMb(new Map(mbRows.map(r => [r.session_id, r])))
    setOpMap(m)
    setRoster(((assigns.data as any[]) ?? []).map(a => ({ section_id: a.section_id, operator_ids: a.operator_ids ?? [] })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const kgOut = (s: Sess) => { const r = mb.get(s.id); return r ? (Number(r.total_output_a_kg) || 0) + (Number(r.total_output_b_kg) || 0) + (Number(r.total_output_c_kg) || 0) + (Number(r.total_output_d_kg) || 0) : 0 }

  const signedOff = useMemo(() => sess.filter(s => s.status === 'approved').length, [sess])

  const lines: Line[] = useMemo(() => {
    return roster
      .slice()
      .sort((a, b) => SECTION_ORDER.indexOf(a.section_id as any) - SECTION_ORDER.indexOf(b.section_id as any))
      .map(r => {
        const s = sess.find(x => x.section_id === r.section_id && x.shift === shift)
        return {
          sectionId: r.section_id,
          status: s?.status ?? 'none',
          operators: r.operator_ids.map(id => opMap[id] ?? '—'),
          kg: s ? Math.round(kgOut(s)) : 0,
        }
      })
  }, [roster, sess, opMap, shift, mb])

  return (
    <div className="px-4 py-6 max-w-[900px] mx-auto space-y-5">
      <HubHeader
        subtitle={`${format(new Date(), 'EEEE d MMM')} · ${SHIFT_LABEL[shift]} shift`}
        action={
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ShiftLines lines={lines} loading={loading} shift={shift} today={today} signedOff={signedOff} />
        </div>
        <div>
          <PendingSignOffs />
        </div>
      </div>
    </div>
  )
}

function ShiftLines({ lines, loading, shift, today, signedOff }: { lines: Line[]; loading: boolean; shift: Shift; today: string; signedOff: number }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-rule bg-surface">
        <div className="flex items-center gap-2">
          <Factory size={15} className="text-text-muted" />
          <span className="font-display font-bold text-[14px] text-text">Lines this shift</span>
        </div>
        {!loading && lines.length > 0 && (
          <span className="font-mono text-[11px] text-text-muted">{signedOff}/{lines.length} signed off</span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
      ) : !lines.length ? (
        <div className="text-center py-14 px-4">
          <Factory size={24} className="mx-auto mb-3 text-stone-200" />
          <p className="font-mono text-[12px] text-stone-400">No sections rostered for the {SHIFT_LABEL[shift]} shift</p>
          <Link href="/supervisor" className="text-[12px] text-brand hover:underline mt-1 inline-block">Roster the shift →</Link>
        </div>
      ) : (
        <div className="divide-y divide-surface-rule">
          {lines.map(l => {
            const m = sectionMeta(l.sectionId)
            const st = LINE_STATUS[l.status] ?? LINE_STATUS.none
            const Icon = st.icon
            const href = `/production/capture/${l.sectionId}?date=${today}&shift=${shift}${l.status === 'submitted' ? '&tab=signoff' : ''}`
            return (
              <Link key={l.sectionId} href={href}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors group">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                  <span className="font-mono font-bold text-[10px] text-white">{m.code}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-body font-semibold text-[14px] text-text truncate">{m.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-text-muted font-mono truncate">
                    <Users size={11} className="shrink-0" /> {l.operators.join(', ') || 'No operators'}
                  </div>
                </div>
                {l.kg > 0 && (
                  <div className="text-right shrink-0 hidden sm:block">
                    <div className="font-mono text-[12px] text-text">{l.kg.toLocaleString()}</div>
                    <div className="font-mono text-[9px] text-text-muted uppercase">kg out</div>
                  </div>
                )}
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg shrink-0 ${st.cls}`}>
                  <Icon size={11} /> {st.label}
                </span>
                <ChevronRight size={15} className="text-stone-300 group-hover:text-brand transition-colors shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

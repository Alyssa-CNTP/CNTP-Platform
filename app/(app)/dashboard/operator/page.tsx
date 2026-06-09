'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO } from 'date-fns'
import {
  CheckCircle2, Clock, AlertTriangle, Scale,
  ChevronRight, ChevronDown, RefreshCw, Users,
  Circle, Activity, Pen,
} from 'lucide-react'
import Link from 'next/link'

interface ProdSession {
  id: string; section_id: string; section_name: string
  shift: string; status: string
  operator_names: string[] | null; supervisor_name: string | null
  submitted_at: string | null
}
interface MassBalance {
  session_id: string; total_input_kg: number | null
  balance_kg: number | null; within_tolerance: boolean | null
}

const SECTIONS = [
  { id: 'sieving',     name: 'Sieving Tower', code: 'ST', color: 'bg-blue-500'    },
  { id: 'refining1',   name: 'Refining 1',    code: 'R1', color: 'bg-emerald-600' },
  { id: 'refining2',   name: 'Refining 2',    code: 'R2', color: 'bg-emerald-500' },
  { id: 'granule',     name: 'Granule Line',  code: 'GL', color: 'bg-amber-500'   },
  { id: 'blender',     name: 'Blender',       code: 'BL', color: 'bg-purple-500'  },
  { id: 'pasteuriser', name: 'Pasteuriser',   code: 'PR', color: 'bg-red-500'     },
]
const SHIFTS = ['morning', 'night'] as const

function shiftStatus(status: string | null) {
  if (!status)                return { dot: 'bg-surface-rule',  label: 'Not started',    color: 'text-text-muted/40' }
  if (status === 'draft')     return { dot: 'bg-warn',          label: 'In progress',    color: 'text-warn'          }
  if (status === 'submitted') return { dot: 'bg-info',          label: 'Needs sign-off', color: 'text-info'          }
  if (status === 'approved')  return { dot: 'bg-ok',            label: 'Signed off',     color: 'text-ok'            }
  return { dot: 'bg-surface-rule', label: status, color: 'text-text-muted' }
}

// ── Shift accordion ────────────────────────────────────────────────────────────
function ShiftPanel({
  shift, sessions, balances, viewDate, defaultOpen,
}: {
  shift: string
  sessions: ProdSession[]
  balances: MassBalance[]
  viewDate: string
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const today = format(new Date(), 'yyyy-MM-dd')

  const shiftSessions = sessions.filter(s => s.shift === shift)
  const submitted     = shiftSessions.filter(s => ['submitted','approved'].includes(s.status)).length
  const needsSignOff  = shiftSessions.filter(s => s.status === 'submitted').length
  const inProg        = shiftSessions.filter(s => s.status === 'draft').length

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-display font-bold text-[16px] text-text capitalize">{shift} shift</span>
          {needsSignOff > 0 && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-info/15 text-info font-bold">
              {needsSignOff} need sign-off
            </span>
          )}
          {inProg > 0 && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-warn/15 text-warn">
              {inProg} in progress
            </span>
          )}
          {submitted > 0 && needsSignOff === 0 && inProg === 0 && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-ok/15 text-ok">
              {submitted}/{SECTIONS.length} done
            </span>
          )}
        </div>
        {open ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
      </button>

      {open && (
        <div className="border-t border-surface-rule divide-y divide-surface-rule">
          {SECTIONS.map(sec => {
            const sess = shiftSessions.find(s => s.section_id === sec.id) ?? null
            const mb   = balances.find(b => b.session_id === sess?.id)   ?? null
            const st   = shiftStatus(sess?.status ?? null)
            const mbFlag = mb?.within_tolerance === false
            const href = `/production/section?id=${sec.id}&shift=${shift}&date=${viewDate}`

            return (
              <div key={sec.id} className="flex items-center gap-4 px-5 py-3.5">
                {/* Badge */}
                <div className={`w-8 h-8 rounded-lg ${sec.color} flex items-center justify-center shrink-0`}>
                  <span className="font-mono font-bold text-[10px] text-white">{sec.code}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-body font-semibold text-[13px] text-text">{sec.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    <span className={`font-mono text-[10px] ${st.color}`}>{st.label}</span>
                  </div>
                  {sess?.operator_names && sess.operator_names.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Users size={10} className="text-text-muted/60" />
                      <span className="font-mono text-[10px] text-text-muted truncate">
                        {sess.operator_names.join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Mass balance */}
                {mb?.total_input_kg != null && (
                  <div className={`text-right shrink-0 font-mono text-[11px] ${mbFlag ? 'text-warn font-bold' : 'text-text-muted'}`}>
                    {mb.total_input_kg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg
                    {mb.balance_kg != null && (
                      <div className={`text-[10px] ${mbFlag ? 'text-warn' : 'text-text-muted/60'}`}>
                        var {Math.abs(mb.balance_kg).toFixed(1)} kg{mbFlag && ' ⚠'}
                      </div>
                    )}
                  </div>
                )}

                {/* Sign-off button or status */}
                {sess?.status === 'submitted' ? (
                  <Link href={href}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-info/15 border border-info/30 text-info rounded-xl font-mono text-[11px] font-bold hover:bg-info/25 transition-colors">
                    <Pen size={11} /> Sign off
                  </Link>
                ) : sess?.status === 'approved' ? (
                  <CheckCircle2 size={18} className="text-ok shrink-0" />
                ) : sess?.status === 'draft' ? (
                  <Link href={href} className="shrink-0">
                    <Clock size={18} className="text-warn" />
                  </Link>
                ) : (
                  viewDate === today ? (
                    <Link href={href} className="shrink-0">
                      <Circle size={18} className="text-text-muted/30" />
                    </Link>
                  ) : (
                    <Circle size={18} className="text-text-muted/20 shrink-0" />
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// FACTORY SUPERVISOR DASHBOARD (operator role)
// ═════════════════════════════════════════════════════════════════════════════
export default function FactorySupervisorDashboard() {
  const [sessions,  setSessions]  = useState<ProdSession[]>([])
  const [balances,  setBalances]  = useState<MassBalance[]>([])
  const [loading,   setLoading]   = useState(true)
  const [refreshing,setRefreshing]= useState(false)
  const [viewDate,  setViewDate]  = useState(format(new Date(), 'yyyy-MM-dd'))

  const today = format(new Date(), 'yyyy-MM-dd')
  const hour  = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Detect current shift
  const currentShift = hour >= 5 && hour < 17 ? 'morning' : 'night'

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    const db = getDb()

    const { data: sessData } = await db
      .from('prod_sessions')
      .select('id,section_id,section_name,shift,status,operator_names,supervisor_name,submitted_at')
      .eq('date', viewDate)
      .order('section_id')

    const sess = (sessData as ProdSession[]) ?? []
    setSessions(sess)

    if (sess.length > 0) {
      const { data: mbData } = await db
        .from('prod_mass_balance')
        .select('session_id,total_input_kg,balance_kg,within_tolerance')
        .in('session_id', sess.map(s => s.id))
      setBalances((mbData as MassBalance[]) ?? [])
    } else {
      setBalances([])
    }

    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [viewDate])
  useEffect(() => {
    const t = setInterval(() => load(true), 90_000)
    return () => clearInterval(t)
  }, [viewDate])

  // KPIs
  const submitted    = sessions.filter(s => ['submitted','approved'].includes(s.status)).length
  const needsSignOff = sessions.filter(s => s.status === 'submitted').length
  const mbFlags      = balances.filter(m => m.within_tolerance === false).length
  const inProgress   = sessions.filter(s => s.status === 'draft').length

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
    </div>
  )

  return (
    <div className="px-4 py-5 space-y-5 max-w-[900px]">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">{greeting}</h1>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {format(new Date(), 'EEEE d MMMM yyyy')} · Factory supervisor
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date" value={viewDate}
            onChange={e => setViewDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-rule bg-surface-card font-mono text-[11px] text-text outline-none focus:border-brand"
          />
          <button onClick={() => load(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors">
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Sign-off alert */}
      {needsSignOff > 0 && (
        <Link href="/production"
          className="flex items-center gap-3 px-4 py-3 bg-info/10 border border-info/30 rounded-xl">
          <Pen size={14} className="text-info shrink-0" />
          <span className="font-body font-semibold text-[13px] text-info flex-1">
            {needsSignOff} session{needsSignOff > 1 ? 's' : ''} waiting for your sign-off
          </span>
          <ChevronRight size={13} className="text-info shrink-0" />
        </Link>
      )}

      {/* Mass balance alert */}
      {mbFlags > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-warn/10 border border-warn/30 rounded-xl">
          <AlertTriangle size={14} className="text-warn shrink-0" />
          <span className="font-body font-semibold text-[13px] text-warn">
            {mbFlags} mass balance{mbFlags > 1 ? 's' : ''} outside tolerance — review before signing off
          </span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'In progress',    value: inProgress,   color: 'text-warn',          icon: <Activity size={14} /> },
          { label: 'Need sign-off',  value: needsSignOff, color: 'text-info',           icon: <Pen size={14} /> },
          { label: 'Signed off',     value: sessions.filter(s=>s.status==='approved').length, color: 'text-ok', icon: <CheckCircle2 size={14} /> },
          { label: 'Balance flags',  value: mbFlags,      color: mbFlags > 0 ? 'text-warn' : 'text-text-muted/30', icon: <Scale size={14} /> },
        ].map(k => (
          <div key={k.label} className="bg-surface-card border border-surface-rule rounded-xl p-4">
            <div className={`${k.color} mb-1`}>{k.icon}</div>
            <div className={`font-display font-bold text-[26px] ${k.color}`}>{k.value}</div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Shift panels — current shift open by default */}
      <div className="space-y-3">
        {SHIFTS.map(shift => (
          <ShiftPanel
            key={shift}
            shift={shift}
            sessions={sessions}
            balances={balances}
            viewDate={viewDate}
            defaultOpen={shift === currentShift}
          />
        ))}
      </div>

      {/* Go to full production page */}
      <Link href="/production"
        className="flex items-center justify-between px-5 py-4 bg-brand text-white rounded-2xl font-display font-bold text-[14px]">
        Open full production capture
        <ChevronRight size={16} />
      </Link>

    </div>
  )
}
'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import {
  Activity, ClipboardCheck, ShieldCheck, Clock, CheckCircle2,
  AlertCircle, Circle, RefreshCw, ChevronRight, ChevronDown,
  Play, Pen, Users, Scale, AlertTriangle, Wrench,
} from 'lucide-react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProdSession {
  id: string
  section_id: string
  section_name: string
  date: string
  shift: string
  status: string
  operator_names: string[] | null
  supervisor_name: string | null
  submitted_at: string | null
}

interface MassBalance {
  session_id: string
  total_input_kg: number | null
  balance_kg: number | null
  within_tolerance: boolean | null
}

interface ChecklistRow {
  section_id: string
  shift: string
  submitted_at: string | null
}

// ── Section + shift config ─────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'sieving',     name: 'Sieving Tower', code: 'ST', color: 'bg-blue-500',    border: 'border-blue-200'    },
  { id: 'refining1',   name: 'Refining 1',    code: 'R1', color: 'bg-emerald-600', border: 'border-emerald-200' },
  { id: 'refining2',   name: 'Refining 2',    code: 'R2', color: 'bg-emerald-500', border: 'border-emerald-200' },
  { id: 'granule',     name: 'Granule Line',  code: 'GL', color: 'bg-amber-500',   border: 'border-amber-200'   },
  { id: 'blender',     name: 'Blender',       code: 'BL', color: 'bg-purple-500',  border: 'border-purple-200'  },
  { id: 'pasteuriser', name: 'Pasteuriser',   code: 'PR', color: 'bg-red-500',     border: 'border-red-200'     },
]

const SHIFTS = ['morning', 'night'] as const
type Shift = typeof SHIFTS[number]

// Detect current shift from time of day
function currentShift(): Shift {
  const h = new Date().getHours()
  return h >= 5 && h < 17 ? 'morning' : 'night'
}

// ── Status helpers ─────────────────────────────────────────────────────────────
function sessionStatus(status: string | null) {
  if (!status)                return { dot: 'bg-surface-rule',  label: 'Not started',    color: 'text-text-muted/50', bg: '' }
  if (status === 'draft')     return { dot: 'bg-warn',          label: 'In progress',    color: 'text-warn',          bg: 'bg-warn/5'   }
  if (status === 'submitted') return { dot: 'bg-info',          label: 'Needs sign-off', color: 'text-info',          bg: 'bg-info/5'   }
  if (status === 'approved')  return { dot: 'bg-ok',            label: 'Signed off',     color: 'text-ok',            bg: 'bg-ok/5'     }
  return { dot: 'bg-surface-rule', label: status, color: 'text-text-muted', bg: '' }
}

// ── Section card component ─────────────────────────────────────────────────────
function SectionCard({
  section, shift, session, mb, cleaning, hs, viewDate, isAdmin, role,
}: {
  section: typeof SECTIONS[0]
  shift: Shift
  session: ProdSession | null
  mb: MassBalance | null
  cleaning: ChecklistRow | null
  hs: ChecklistRow | null
  viewDate: string
  isAdmin: boolean
  role: string | null
}) {
  const st     = sessionStatus(session?.status ?? null)
  const mbFlag = mb?.within_tolerance === false
  const today  = format(new Date(), 'yyyy-MM-dd')
  const isToday = viewDate === today
  const href   = `/production/section?id=${section.id}&shift=${shift}&date=${viewDate}`

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition-all ${
      session?.status === 'submitted' ? 'border-info/40' :
      session?.status === 'approved'  ? 'border-ok/30'   :
      session?.status === 'draft'     ? 'border-warn/40'  :
      'border-surface-rule'
    } ${st.bg}`}>

      {/* Section header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-rule/60">
        <div className={`w-8 h-8 rounded-lg ${section.color} flex items-center justify-center shrink-0`}>
          <span className="font-mono font-bold text-[10px] text-white">{section.code}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[14px] text-text">{section.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            <span className={`font-mono text-[11px] ${st.color}`}>{st.label}</span>
          </div>
        </div>

        {/* Checklists */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${cleaning?.submitted_at ? 'bg-ok/10 text-ok' : 'bg-surface text-text-muted/40'}`}>
            Clean
          </span>
          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${hs?.submitted_at ? 'bg-ok/10 text-ok' : 'bg-surface text-text-muted/40'}`}>
            H&S
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">

        {/* Operators */}
        {session?.operator_names && session.operator_names.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Users size={11} className="text-text-muted shrink-0" />
            <span className="font-mono text-[11px] text-text-muted truncate">
              {session.operator_names.join(', ')}
            </span>
          </div>
        )}

        {/* Mass balance */}
        {mb && mb.total_input_kg != null && (
          <div className={`flex items-center gap-1.5 font-mono text-[11px] ${mbFlag ? 'text-warn font-bold' : 'text-text-muted'}`}>
            <Scale size={11} className="shrink-0" />
            {mb.total_input_kg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg in
            {mb.balance_kg != null && (
              <> · var {Math.abs(mb.balance_kg).toFixed(1)} kg
                {mbFlag && <AlertTriangle size={10} />}
              </>
            )}
          </div>
        )}

        {session?.submitted_at && (
          <div className="font-mono text-[10px] text-text-muted">
            Submitted {format(new Date(session.submitted_at), 'HH:mm')}
            {session.supervisor_name && ` · ${session.supervisor_name}`}
          </div>
        )}

        {/* Action button */}
        {isToday && (
          <Link
            href={href}
            className={`mt-1 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-display font-bold text-[13px] transition-all active:scale-[.98] ${
              !session
                ? 'bg-brand text-white'
                : session.status === 'draft'
                ? 'bg-warn/15 text-warn border border-warn/30'
                : session.status === 'submitted' && (role === 'supervisor' || isAdmin)
                ? 'bg-info/15 text-info border border-info/30'
                : session.status === 'approved'
                ? 'bg-ok/10 text-ok border border-ok/20'
                : 'bg-surface border border-surface-rule text-text-muted'
            }`}
          >
            {!session && <><Play size={13} className="ml-0.5" /> Start session</>}
            {session?.status === 'draft'     && <><Pen size={13} /> Continue</>}
            {session?.status === 'submitted' && (role === 'supervisor' || isAdmin) && <><CheckCircle2 size={13} /> Sign off</>}
            {session?.status === 'submitted' && role === 'operator' && <><Clock size={13} /> Awaiting sign-off</>}
            {session?.status === 'approved'  && <><CheckCircle2 size={13} /> Signed off</>}
          </Link>
        )}

        {/* Historical — just link to view */}
        {!isToday && session && (
          <Link
            href={href}
            className="mt-1 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-surface border border-surface-rule font-mono text-[11px] text-text-muted hover:text-text transition-colors"
          >
            View session <ChevronRight size={11} />
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Shift panel ────────────────────────────────────────────────────────────────
function ShiftPanel({
  shift, isCurrent, sessions, massBalances, cleaning, hs,
  viewDate, isAdmin, role, defaultOpen,
}: {
  shift: Shift
  isCurrent: boolean
  sessions: ProdSession[]
  massBalances: MassBalance[]
  cleaning: ChecklistRow[]
  hs: ChecklistRow[]
  viewDate: string
  isAdmin: boolean
  role: string | null
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  const shiftSessions  = sessions.filter(s => s.shift === shift)
  const submitted      = shiftSessions.filter(s => ['submitted','approved'].includes(s.status)).length
  const inProg         = shiftSessions.filter(s => s.status === 'draft').length
  const needsSignOff   = shiftSessions.filter(s => s.status === 'submitted').length

  const shiftLabel = shift.charAt(0).toUpperCase() + shift.slice(1)

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      {/* Shift header — always visible, tap to collapse/expand */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface transition-colors"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-[16px] text-text">{shiftLabel} shift</span>
            {isCurrent && (
              <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-brand text-white uppercase tracking-wide">
                Current
              </span>
            )}
          </div>
          {/* Shift summary */}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {submitted > 0 && (
              <span className="font-mono text-[11px] text-ok">{submitted}/{SECTIONS.length} submitted</span>
            )}
            {inProg > 0 && (
              <span className="font-mono text-[11px] text-warn">{inProg} in progress</span>
            )}
            {needsSignOff > 0 && (
              <span className="font-mono text-[11px] text-info font-bold">{needsSignOff} need sign-off</span>
            )}
            {shiftSessions.length === 0 && (
              <span className="font-mono text-[11px] text-text-muted/50">No sessions started</span>
            )}
          </div>
        </div>
        <div className="ml-auto">
          {open
            ? <ChevronDown size={18} className="text-text-muted" />
            : <ChevronRight size={18} className="text-text-muted" />
          }
        </div>
      </button>

      {/* Section grid — only shown when open */}
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-surface-rule pt-4">
          {SECTIONS.map(section => {
            const sess    = sessions.find(s => s.section_id === section.id && s.shift === shift) ?? null
            const mb      = massBalances.find(m => m.session_id === sess?.id) ?? null
            const clean   = cleaning.find(c => c.section_id === section.id && c.shift === shift) ?? null
            const hsRow   = hs.find(h => h.section_id === section.id && h.shift === shift) ?? null

            return (
              <SectionCard
                key={section.id}
                section={section}
                shift={shift}
                session={sess}
                mb={mb}
                cleaning={clean}
                hs={hsRow}
                viewDate={viewDate}
                isAdmin={isAdmin}
                role={role}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════════════════════════════
export default function ProductionPage() {
  const { role } = useAuth()

  const [tab, setTab]           = useState<'capture' | 'overview'>('capture')
  const [sessions, setSessions] = useState<ProdSession[]>([])
  const [massBalances, setMb]   = useState<MassBalance[]>([])
  const [cleaning, setCleaning] = useState<ChecklistRow[]>([])
  const [hs, setHs]             = useState<ChecklistRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [viewDate, setViewDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  const isAdmin    = role === 'admin'
  const today      = format(new Date(), 'yyyy-MM-dd')
  const active     = currentShift()

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    const db = getDb()

    const [sessRes, cleanRes, hsRes] = await Promise.all([
      db.from('prod_sessions')
        .select('id,section_id,section_name,date,shift,status,operator_names,supervisor_name,submitted_at')
        .eq('date', viewDate)
        .order('section_id'),
      db.from('cleaning_checklists')
        .select('section_id,shift,submitted_at')
        .eq('date', viewDate),
      db.from('hs_checklists')
        .select('section_id,shift,submitted_at')
        .eq('date', viewDate),
    ])

    const sess = (sessRes.data as ProdSession[]) ?? []
    setSessions(sess)
    setCleaning((cleanRes.data as ChecklistRow[]) ?? [])
    setHs((hsRes.data as ChecklistRow[]) ?? [])

    // Mass balances for all sessions
    if (sess.length > 0) {
      const { data: mb } = await db
        .from('prod_mass_balance')
        .select('session_id,total_input_kg,balance_kg,within_tolerance')
        .in('session_id', sess.map(s => s.id))
      setMb((mb as MassBalance[]) ?? [])
    } else {
      setMb([])
    }

    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [viewDate])
  useEffect(() => {
    const t = setInterval(() => load(true), 120_000)
    return () => clearInterval(t)
  }, [viewDate])

  // Summary stats
  const submitted   = sessions.filter(s => ['submitted','approved'].includes(s.status)).length
  const inProgress  = sessions.filter(s => s.status === 'draft').length
  const mbFlags     = massBalances.filter(m => m.within_tolerance === false).length
  const needSignOff = sessions.filter(s => s.status === 'submitted').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-5 max-w-[1100px]">

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">Production capture</h1>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {format(new Date(viewDate + 'T12:00:00'), 'EEEE d MMMM yyyy')}
            {viewDate === today && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-brand text-white text-[9px] font-bold uppercase tracking-wide">
                Today
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={viewDate}
            onChange={e => setViewDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-rule bg-surface-card font-mono text-[11px] text-text outline-none focus:border-brand"
          />
          <button
            onClick={() => load(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── ALERT STRIP ───────────────────────────────────────────────────── */}
      {(needSignOff > 0 || mbFlags > 0) && (
        <div className="space-y-2">
          {needSignOff > 0 && (role === 'supervisor' || isAdmin) && (
            <div className="flex items-center gap-3 px-4 py-3 bg-info/10 border border-info/30 rounded-xl">
              <Pen size={14} className="text-info shrink-0" />
              <span className="font-body font-semibold text-[13px] text-info">
                {needSignOff} session{needSignOff > 1 ? 's' : ''} submitted and waiting for your sign-off
              </span>
            </div>
          )}
          {mbFlags > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 bg-warn/10 border border-warn/30 rounded-xl">
              <AlertTriangle size={14} className="text-warn shrink-0" />
              <span className="font-body font-semibold text-[13px] text-warn">
                {mbFlags} mass balance{mbFlags > 1 ? 's' : ''} outside tolerance — review before signing off
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── TABS (admin only) ─────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="flex gap-1 p-1 bg-surface-card border border-surface-rule rounded-xl w-fit">
          {([
            { key: 'capture',  label: 'Capture & sign-off' },
            { key: 'overview', label: 'Live overview'       },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg font-body font-medium text-[13px] transition-colors ${
                tab === key ? 'bg-brand text-white' : 'text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── CAPTURE TAB ───────────────────────────────────────────────────── */}
      {(tab === 'capture' || !isAdmin) && (
        <div className="space-y-4">
          {/* Render current shift first, always open — then other shifts collapsed */}
          {SHIFTS.map(shift => (
            <ShiftPanel
              key={shift}
              shift={shift}
              isCurrent={shift === active}
              sessions={sessions}
              massBalances={massBalances}
              cleaning={cleaning}
              hs={hs}
              viewDate={viewDate}
              isAdmin={isAdmin}
              role={role}
              defaultOpen={shift === active}  // only current shift opens by default
            />
          ))}
        </div>
      )}

      {/* ── OVERVIEW TAB (admin only) ─────────────────────────────────────── */}
      {tab === 'overview' && isAdmin && (
        <div className="space-y-4">

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Submitted today',     value: `${submitted}/${SECTIONS.length * 3}`, icon: Activity,       color: 'text-ok'         },
              { label: 'In progress',         value: String(inProgress),                     icon: Clock,          color: 'text-warn'        },
              { label: 'Needs sign-off',      value: String(needSignOff),                    icon: Pen,            color: 'text-info'        },
              { label: 'Mass balance flags',  value: String(mbFlags),                        icon: AlertTriangle,  color: mbFlags > 0 ? 'text-warn' : 'text-text-muted/40' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-surface-card border border-surface-rule rounded-xl p-4">
                <Icon size={15} className={`${color} mb-2`} />
                <div className={`font-display font-bold text-[26px] ${color}`}>{value}</div>
                <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Section × shift grid overview */}
          <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-surface-rule">
              <span className="font-display font-bold text-[14px] text-text">All sections</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-rule bg-surface">
                    <th className="px-4 py-2.5 text-left font-mono text-[10px] text-text-muted uppercase tracking-wide">Section</th>
                    {SHIFTS.map(s => (
                      <th key={s} className="px-4 py-2.5 text-left font-mono text-[10px] text-text-muted uppercase tracking-wide capitalize">
                        {s}
                        {s === active && <span className="ml-1 text-brand">●</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-rule">
                  {SECTIONS.map(section => (
                    <tr key={section.id} className="hover:bg-surface transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-md ${section.color} flex items-center justify-center shrink-0`}>
                            <span className="font-mono font-bold text-[8px] text-white">{section.code}</span>
                          </div>
                          <span className="font-body font-medium text-[13px] text-text">{section.name}</span>
                        </div>
                      </td>
                      {SHIFTS.map(shift => {
                        const sess = sessions.find(s => s.section_id === section.id && s.shift === shift)
                        const st   = sessionStatus(sess?.status ?? null)
                        const mb   = massBalances.find(m => m.session_id === sess?.id)
                        return (
                          <td key={shift} className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${st.dot}`} />
                              <span className={`font-mono text-[11px] ${st.color}`}>{st.label}</span>
                            </div>
                            {mb?.within_tolerance === false && (
                              <div className="font-mono text-[10px] text-warn mt-0.5">
                                var {Math.abs(mb.balance_kg ?? 0).toFixed(1)} kg ⚠
                              </div>
                            )}
                            {sess?.operator_names && sess.operator_names.length > 0 && (
                              <div className="font-mono text-[10px] text-text-muted mt-0.5 truncate max-w-[120px]">
                                {sess.operator_names[0]}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2 border-t border-surface-rule font-mono text-[10px] text-text-muted">
              Auto-refreshes every 2 minutes · Last refreshed {format(new Date(), 'HH:mm')}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
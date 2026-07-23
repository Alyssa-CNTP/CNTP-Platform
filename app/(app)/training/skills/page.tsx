'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, isPast } from 'date-fns'
import { Search, Loader2, ChevronDown, ChevronRight, ChevronUp, AlertTriangle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { TrainingRecordsTabs } from '@/components/training/TrainingRecordsTabs'
import {
  sopAreaMeta,
  SECTION_CORE_SOPS,
} from '@/lib/production/competency-config'
import type { CompetencyStatus } from '@/lib/production/competency-config'
import { ROSTER_CATEGORIES, categoryMeta } from '@/lib/production/roster-config'

const db = () => getDb().schema('production')

interface Employee {
  id: string
  name: string
  display_name: string | null
  department: string
  position: string | null
  job_title: string | null
  active: boolean
}
interface Sop {
  id: string
  doc_no: string
  title: string
  area: string
  section_id: string | null
  active: boolean
}
interface Competency {
  employee_id: string
  sop_id: string
  status: CompetencyStatus
  next_review: string | null
}
// 'overview' is the org-wide rollup (the former, separate Competency Dashboard) —
// feature-gated on can_view_all_competency, since Skills Matrix itself is
// reachable more broadly (can_access_hr, same as it always was).
type ViewKey = 'overview' | 'person' | 'section' | 'gaps'

const DEPARTMENTS = [...ROSTER_CATEGORIES, { key: 'admin', label: 'Admin', colorHex: '#637056' }]

const SECTIONS: { key: string; label: string }[] = [
  { key: 'sieving',     label: 'Sieving Tower' },
  { key: 'refining1',   label: 'Refining 1' },
  { key: 'refining2',   label: 'Refining 2' },
  { key: 'granule',     label: 'Granule Line' },
  { key: 'blender',     label: 'Blender' },
  { key: 'pasteuriser', label: 'Pasteuriser' },
]

export default function SkillsMatrixPage() {
  const { p } = useAuth()
  const canViewAll = p('can_view_all_competency')

  const [employees, setEmployees] = useState<Employee[]>([])
  const [sops, setSops] = useState<Sop[]>([])
  const [competencies, setCompetencies] = useState<Competency[]>([])
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState<ViewKey>('person')
  const [query, setQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const [empRes, sopRes, compRes] = await Promise.all([
        db().from('employees').select('id,name,display_name,department,position,job_title,active').eq('active', true).order('name'),
        db().from('sops').select('id,doc_no,title,area,section_id,active').eq('active', true).order('doc_no'),
        db().from('employee_competencies').select('employee_id,sop_id,status,next_review'),
      ])
      setEmployees((empRes.data ?? []) as Employee[])
      setSops((sopRes.data ?? []) as Sop[])
      setCompetencies((compRes.data ?? []) as Competency[])
      setLoading(false)
    }
    load()
  }, [])

  // Default landing view: the org Overview if this person can see it, otherwise
  // the per-person grid (Skills Matrix proper).
  useEffect(() => {
    if (canViewAll) setView(v => (v === 'person' ? 'overview' : v))
  }, [canViewAll])

  const compMap = useMemo(() => {
    const m = new Map<string, CompetencyStatus>()
    competencies.forEach(c => m.set(`${c.employee_id}::${c.sop_id}`, c.status))
    return m
  }, [competencies])

  const coreSopByDocNo = useMemo(() => {
    const m = new Map<string, Sop>()
    sops.forEach(s => m.set(s.doc_no, s))
    return m
  }, [sops])

  const empCompetencies = useMemo(() => {
    const m = new Map<string, Competency[]>()
    competencies.forEach(c => {
      const arr = m.get(c.employee_id) ?? []
      arr.push(c)
      m.set(c.employee_id, arr)
    })
    return m
  }, [competencies])

  const empSectionStatus = useMemo(() => {
    const result = new Map<string, Map<string, CompetencyStatus | null>>()
    employees.forEach(emp => {
      const secMap = new Map<string, CompetencyStatus | null>()
      SECTIONS.forEach(sec => {
        const coreDocNo = SECTION_CORE_SOPS[sec.key]
        const coreSop = coreSopByDocNo.get(coreDocNo)
        if (!coreSop) { secMap.set(sec.key, null); return }
        const status = compMap.get(`${emp.id}::${coreSop.id}`) ?? null
        secMap.set(sec.key, status)
      })
      result.set(emp.id, secMap)
    })
    return result
  }, [employees, coreSopByDocNo, compMap])

  const empProgress = useMemo(() => {
    const m = new Map<string, { total: number; competent: number; assessed: number; training: number; tba: number }>()
    employees.forEach(emp => {
      const comps = empCompetencies.get(emp.id) ?? []
      const total = comps.length
      const competent = comps.filter(c => c.status === 'competent').length
      const assessed = comps.filter(c => c.status === 'assessed').length
      const training = comps.filter(c => c.status === 'training_done').length
      const tba = comps.filter(c => c.status === 'tba').length
      m.set(emp.id, { total, competent, assessed, training, tba })
    })
    return m
  }, [employees, empCompetencies])

  const summaryStats = useMemo(() => {
    let withAny = 0
    let fullyTrained = 0
    let withGaps = 0
    let withTba = 0
    employees.forEach(emp => {
      const prog = empProgress.get(emp.id)
      if (!prog || prog.total === 0) return
      withAny++
      if (prog.competent === prog.total) fullyTrained++
      else withGaps++
      if (prog.tba > 0) withTba++
    })
    return { withAny, fullyTrained, withGaps, withTba }
  }, [employees, empProgress])

  const filteredEmployees = useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees
      .filter(e => deptFilter === 'all' || e.department === deptFilter)
      .filter(e => q === '' || (e.display_name || e.name).toLowerCase().includes(q) || (e.position || e.job_title || '').toLowerCase().includes(q))
  }, [employees, deptFilter, query])

  const byDept = useMemo(() => {
    const groups = new Map<string, Employee[]>()
    filteredEmployees.forEach(emp => {
      const arr = groups.get(emp.department) ?? []
      arr.push(emp)
      groups.set(emp.department, arr)
    })
    const ordered: { dept: typeof DEPARTMENTS[0]; employees: Employee[] }[] = []
    DEPARTMENTS.forEach(d => {
      const emps = groups.get(d.key)
      if (emps && emps.length > 0) ordered.push({ dept: d, employees: emps })
    })
    return ordered
  }, [filteredEmployees])

  const sectionData = useMemo(() => {
    return SECTIONS.map(sec => {
      const coreDocNo = SECTION_CORE_SOPS[sec.key]
      const coreSop = coreSopByDocNo.get(coreDocNo)
      const qualified: Employee[] = []
      const trainingDone: Employee[] = []
      const notStarted: Employee[] = []
      employees.forEach(emp => {
        if (!coreSop) { notStarted.push(emp); return }
        const status = compMap.get(`${emp.id}::${coreSop.id}`)
        if (status === 'competent') qualified.push(emp)
        else if (status === 'training_done' || status === 'assessed') trainingDone.push(emp)
        else if (status) notStarted.push(emp)
      })
      return { sec, qualified, trainingDone, notStarted }
    })
  }, [employees, coreSopByDocNo, compMap])

  const sopGaps = useMemo(() => {
    return sops.map(sop => {
      const records = competencies.filter(c => c.sop_id === sop.id)
      const total = records.length
      const competent = records.filter(c => c.status === 'competent').length
      const assessed = records.filter(c => c.status === 'assessed').length
      const training = records.filter(c => c.status === 'training_done').length
      const notStarted = records.filter(c => c.status === 'not_started' || c.status === 'tba' || c.status === 'not_competent' || c.status === 'sop_created').length
      const pct = total > 0 ? competent / total : 0
      return { sop, total, competent, assessed, training, notStarted, pct }
    }).filter(g => g.total > 0).sort((a, b) => a.pct - b.pct)
  }, [sops, competencies])

  // ── Overview (formerly the separate Competency Dashboard) ──────────────────
  const overviewByDepartment = useMemo(() => {
    const empById = new Map(employees.map(e => [e.id, e]))
    const groups = new Map<string, { total: number; competent: number }>()
    for (const c of competencies) {
      const emp = empById.get(c.employee_id)
      if (!emp) continue
      const g = groups.get(emp.department) ?? { total: 0, competent: 0 }
      g.total += 1
      if (c.status === 'competent') g.competent += 1
      groups.set(emp.department, g)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [employees, competencies])

  const overviewOverallCompetent = competencies.filter(c => c.status === 'competent').length
  const overviewOverallTotal = competencies.length

  const overviewOverdue = useMemo(() => {
    const empById = new Map(employees.map(e => [e.id, e]))
    const sopById = new Map(sops.map(s => [s.id, s]))
    return competencies
      .filter(c => c.next_review && isPast(parseISO(c.next_review)))
      .map(c => ({ ...c, employee: empById.get(c.employee_id), sop: sopById.get(c.sop_id) }))
      .filter(c => c.employee && c.sop)
  }, [competencies, employees, sops])

  const overviewNotCompetent = useMemo(() => {
    const empById = new Map(employees.map(e => [e.id, e]))
    const sopById = new Map(sops.map(s => [s.id, s]))
    return competencies
      .filter(c => c.status === 'not_competent')
      .map(c => ({ ...c, employee: empById.get(c.employee_id), sop: sopById.get(c.sop_id) }))
      .filter(c => c.employee && c.sop)
  }, [competencies, employees, sops])

  function toggleCollapsed(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const VIEWS: { key: ViewKey; label: string }[] = [
    ...(canViewAll ? [{ key: 'overview' as ViewKey, label: 'Overview' }] : []),
    { key: 'person',  label: 'By Person' },
    { key: 'section', label: 'By Section' },
    { key: 'gaps',    label: 'SOP Gaps' },
  ]

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5">
      <div>
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="font-display font-bold text-[22px] text-text">Skills Matrix</h1>
            <p className="text-[12px] text-text-muted mt-0.5">
              Competency overview by person, floor section, and SOP coverage.
            </p>
          </div>
        </div>
        <TrainingRecordsTabs />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="With records" value={summaryStats.withAny} />
        <StatCard label="Fully trained" value={summaryStats.fullyTrained} accent="ok" />
        <StatCard label="With gaps" value={summaryStats.withGaps} accent="warn" />
        <StatCard label="TBA pending" value={summaryStats.withTba} accent="err" />
      </div>

      <div className="flex items-center gap-1 bg-surface-card border border-surface-rule rounded-2xl p-1 w-fit">
        {VIEWS.map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`px-4 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${
              view === v.key
                ? 'bg-brand text-white shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-stone-300" />
        </div>
      ) : (
        <>
          {view === 'overview' && canViewAll && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Staff" value={String(employees.length)} />
                <StatCard label="Competent" value={overviewOverallTotal > 0 ? `${Math.round((overviewOverallCompetent / overviewOverallTotal) * 100)}%` : '—'} />
                <StatCard label="Overdue reviews" value={String(overviewOverdue.length)} warn={overviewOverdue.length > 0} />
              </div>

              <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
                <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted">By department</h2>
                {overviewByDepartment.map(([dept, g]) => {
                  const meta = categoryMeta(dept)
                  const pct = g.total > 0 ? Math.round((g.competent / g.total) * 100) : 0
                  return (
                    <div key={dept} className="flex items-center gap-3">
                      <span className="text-[12px] text-text capitalize w-32 shrink-0">{meta.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.colorHex }} />
                      </div>
                      <span className="text-[11px] text-text-muted w-20 text-right shrink-0">{g.competent}/{g.total} ({pct}%)</span>
                    </div>
                  )
                })}
              </div>

              {overviewOverdue.length > 0 && (
                <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
                  <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1.5"><AlertTriangle size={11} className="text-warn" /> Overdue reviews</h2>
                  {overviewOverdue.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-[12px]">
                      <span className="text-text">{c.employee?.display_name || c.employee?.name} — {c.sop?.title}</span>
                      <span className="text-err">{format(parseISO(c.next_review!), 'd MMM yyyy')}</span>
                    </div>
                  ))}
                </div>
              )}

              {overviewNotCompetent.length > 0 && (
                <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
                  <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1.5"><AlertTriangle size={11} className="text-err" /> Not competent</h2>
                  {overviewNotCompetent.map((c, i) => (
                    <Link key={i} href={`/production/staff/${c.employee_id}`} className="flex items-center justify-between text-[12px] hover:text-brand">
                      <span className="text-text">{c.employee?.display_name || c.employee?.name} — {c.sop?.title}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === 'person' && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-[180px] px-3 rounded-xl border border-stone-200 bg-white focus-within:border-brand">
                  <Search size={14} className="text-stone-400 shrink-0" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search people…"
                    className="flex-1 py-2 text-[13px] outline-none bg-transparent"
                  />
                </div>
                <select
                  value={deptFilter}
                  onChange={e => setDeptFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand"
                >
                  <option value="all">All departments</option>
                  {DEPARTMENTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>

              {byDept.length === 0 ? (
                <p className="text-[13px] text-text-muted text-center py-12">No staff match this filter.</p>
              ) : byDept.map(({ dept, employees: emps }) => {
                const isOpen = !collapsed.has(dept.key)
                return (
                  <div key={dept.key} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
                    <button
                      onClick={() => toggleCollapsed(dept.key)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors"
                      style={{ borderLeft: `3px solid ${dept.colorHex}` }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: dept.colorHex }} />
                        <span className="font-display font-bold text-[13px] text-text">{dept.label}</span>
                        <span className="text-[11px] text-text-muted">{emps.length} people</span>
                      </div>
                      {isOpen
                        ? <ChevronUp size={14} className="text-stone-400" />
                        : <ChevronDown size={14} className="text-stone-400" />
                      }
                    </button>

                    {isOpen && emps.map(emp => {
                      const prog = empProgress.get(emp.id)
                      const pct = prog && prog.total > 0 ? prog.competent / prog.total : 0
                      const secStatuses = empSectionStatus.get(emp.id)
                      const qualifiedSections = SECTIONS.filter(sec => secStatuses?.get(sec.key) === 'competent')
                      const barColor = pct >= 0.8 ? '#1A7A3C' : pct >= 0.4 ? '#B85C0A' : '#9CA3AF'

                      return (
                        <div
                          key={emp.id}
                          className="flex items-center gap-3 px-4 py-2.5 border-t border-surface-rule hover:bg-surface transition-colors"
                          style={{ borderLeft: `3px solid ${dept.colorHex}` }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dept.colorHex }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-medium text-text truncate">
                                {emp.display_name || emp.name}
                              </span>
                              {(emp.position || emp.job_title) && (
                                <span className="text-[11px] text-text-muted truncate">
                                  {emp.position || emp.job_title}
                                </span>
                              )}
                            </div>
                            {prog && prog.total > 0 && (
                              <div className="flex items-center gap-2 mt-1">
                                <div className="h-1.5 w-24 bg-stone-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${Math.round(pct * 100)}%`, background: barColor }}
                                  />
                                </div>
                                <span className="text-[10px] text-text-muted font-mono">{prog.competent}/{prog.total}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                            {qualifiedSections.slice(0, 3).map(sec => (
                              <span
                                key={sec.key}
                                className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-ok/15 text-ok whitespace-nowrap"
                              >
                                {sec.label}
                              </span>
                            ))}
                            {qualifiedSections.length > 3 && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                                +{qualifiedSections.length - 3}
                              </span>
                            )}
                          </div>
                          <Link
                            href={`/production/staff/${emp.id}`}
                            className="text-stone-300 hover:text-brand transition-colors shrink-0 ml-1"
                          >
                            <ChevronRight size={16} />
                          </Link>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {view === 'section' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sectionData.map(({ sec, qualified, trainingDone, notStarted }) => {
                const total = qualified.length + trainingDone.length + notStarted.length
                const pct = total > 0 ? qualified.length / total : 0

                return (
                  <div key={sec.key} className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-display font-bold text-[14px] text-text">{sec.label}</span>
                      <span className="text-[11px] font-semibold text-text-muted font-mono">
                        {Math.round(pct * 100)}%
                      </span>
                    </div>

                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round(pct * 100)}%`,
                          background: pct >= 0.8 ? '#1A7A3C' : pct >= 0.4 ? '#B85C0A' : '#9CA3AF',
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-ok/10 rounded-xl py-2">
                        <div className="font-display font-bold text-[18px] text-ok">{qualified.length}</div>
                        <div className="text-[10px] text-ok/80">Qualified</div>
                      </div>
                      <div className="bg-warn/10 rounded-xl py-2">
                        <div className="font-display font-bold text-[18px] text-warn">{trainingDone.length}</div>
                        <div className="text-[10px] text-warn/80">In training</div>
                      </div>
                      <div className="bg-stone-50 rounded-xl py-2">
                        <div className="font-display font-bold text-[18px] text-stone-400">{notStarted.length}</div>
                        <div className="text-[10px] text-stone-400">Not started</div>
                      </div>
                    </div>

                    {qualified.length > 0 && (
                      <div>
                        <p className="text-[10px] text-text-muted uppercase tracking-wide font-semibold mb-1.5">Qualified</p>
                        <div className="flex flex-wrap gap-1">
                          {qualified.map(emp => (
                            <Link
                              key={emp.id}
                              href={`/production/staff/${emp.id}`}
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-ok/15 text-ok hover:bg-ok/25 transition-colors"
                            >
                              {emp.display_name || emp.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {trainingDone.length > 0 && (
                      <div>
                        <p className="text-[10px] text-text-muted uppercase tracking-wide font-semibold mb-1.5">In training</p>
                        <div className="flex flex-wrap gap-1">
                          {trainingDone.map(emp => (
                            <Link
                              key={emp.id}
                              href={`/production/staff/${emp.id}`}
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-warn/15 text-warn hover:bg-warn/25 transition-colors"
                            >
                              {emp.display_name || emp.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {view === 'gaps' && (
            <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
              {sopGaps.length === 0 ? (
                <p className="text-[13px] text-text-muted text-center py-12">No competency records yet.</p>
              ) : sopGaps.map(({ sop, total, competent, assessed, training, notStarted, pct }) => {
                const am = sopAreaMeta(sop.area)
                const isLow = pct < 0.3
                const isMid = pct >= 0.3 && pct < 0.6

                return (
                  <div
                    key={sop.id}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-surface-rule last:border-0 ${
                      isLow ? 'bg-err/5' : isMid ? 'bg-warn/5' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] font-bold text-text-muted">{sop.doc_no}</span>
                        <span className="text-[12px] font-medium text-text truncate">{sop.title}</span>
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: `${am.colorHex}18`, color: am.colorHex }}
                        >
                          {am.label}
                        </span>
                        {isLow && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-err/10 text-err">
                            Low coverage
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-32 bg-stone-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round(pct * 100)}%`,
                              background: pct >= 0.7 ? '#1A7A3C' : pct >= 0.3 ? '#B85C0A' : '#B81C1C',
                            }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-text-muted">{Math.round(pct * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="text-ok font-semibold">{competent} competent</span>
                        {assessed > 0 && <span className="text-azure">{assessed} assessed</span>}
                        {training > 0 && <span className="text-warn">{training} in training</span>}
                        {notStarted > 0 && <span className="text-stone-400">{notStarted} not started</span>}
                        <span className="text-stone-300">· {total} total</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, accent, warn }: { label: string; value: number | string; accent?: 'ok' | 'warn' | 'err'; warn?: boolean }) {
  const colorMap = {
    ok:   { val: 'text-ok',   bg: 'bg-ok/10'  },
    warn: { val: 'text-warn', bg: 'bg-warn/10' },
    err:  { val: 'text-err',  bg: 'bg-err/10'  },
  }
  const resolved = accent ? colorMap[accent] : warn ? colorMap.err : { val: 'text-text', bg: 'bg-surface-card' }
  return (
    <div className={`${resolved.bg} border border-surface-rule rounded-2xl px-4 py-3 text-center`}>
      <div className={`font-display font-bold text-[24px] ${resolved.val}`}>{value}</div>
      <div className="text-[11px] text-text-muted mt-0.5">{label}</div>
    </div>
  )
}

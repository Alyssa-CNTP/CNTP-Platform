'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Loader2, ChevronRight, Filter } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { StaffTabs } from '@/components/production/StaffTabs'
import { ROSTER_CATEGORIES, categoryMeta } from '@/lib/production/roster-config'
import { SOP_AREAS, sopAreaMeta, statusMeta, COMPETENCY_STATUSES } from '@/lib/production/competency-config'
import type { CompetencyStatus } from '@/lib/production/competency-config'

const db = () => getDb().schema('production')

interface Employee {
  id: string; name: string; display_name: string | null
  department: string; position: string | null; job_title: string | null; active: boolean
}
interface Sop {
  id: string; doc_no: string; title: string; area: string; sort_order: number
}
interface Competency {
  employee_id: string; sop_id: string; status: CompetencyStatus
}

const DEPARTMENTS = [...ROSTER_CATEGORIES, { key: 'admin', label: 'Admin', colorHex: '#637056' }]

export default function SkillsMatrixPage() {
  const { p } = useAuth()
  const canEdit = p('can_manage_competencies')

  const [employees, setEmployees] = useState<Employee[]>([])
  const [sops, setSops] = useState<Sop[]>([])
  const [competencies, setCompetencies] = useState<Competency[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [query, setQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')
  const [areaFilter, setAreaFilter] = useState('all')

  useEffect(() => {
    async function load() {
      const [empRes, sopRes, compRes] = await Promise.all([
        db().from('employees').select('id,name,display_name,department,position,job_title,active').eq('active', true).order('name'),
        db().from('sops').select('id,doc_no,title,area,sort_order').eq('active', true).order('sort_order'),
        db().from('employee_competencies').select('employee_id,sop_id,status'),
      ])
      setEmployees((empRes.data ?? []) as Employee[])
      setSops((sopRes.data ?? []) as Sop[])
      setCompetencies((compRes.data ?? []) as Competency[])
      setLoading(false)
    }
    load()
  }, [])

  const filteredEmployees = useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees
      .filter(e => deptFilter === 'all' || e.department === deptFilter)
      .filter(e => q === '' || (e.display_name || e.name).toLowerCase().includes(q) || (e.position || e.job_title || '').toLowerCase().includes(q))
  }, [employees, deptFilter, query])

  const filteredSops = useMemo(() =>
    sops.filter(s => areaFilter === 'all' || s.area === areaFilter)
  , [sops, areaFilter])

  const compMap = useMemo(() => {
    const m = new Map<string, CompetencyStatus>()
    competencies.forEach(c => m.set(`${c.employee_id}::${c.sop_id}`, c.status))
    return m
  }, [competencies])

  // Group sops by area for column headers
  const sopsByArea = useMemo(() => {
    const m = new Map<string, Sop[]>()
    filteredSops.forEach(s => {
      const arr = m.get(s.area) ?? []
      arr.push(s)
      m.set(s.area, arr)
    })
    return m
  }, [filteredSops])

  return (
    <div className="px-4 py-6 max-w-full mx-auto space-y-5">
      <div>
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="font-display font-bold text-[22px] text-text">Skills Matrix</h1>
            <p className="text-[12px] text-stone-400 mt-0.5">
              Full competency grid — every person × every SOP. Filter to focus. Click a person for their full profile.
            </p>
          </div>
        </div>
        <StaffTabs />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        {COMPETENCY_STATUSES.map(s => (
          <span key={s.status} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded ${s.bgClass} ${s.textClass}`}>
            <span className="font-mono">{s.short}</span> {s.label}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[180px] px-3 rounded-xl border border-stone-200 bg-white focus-within:border-brand">
            <Search size={14} className="text-stone-400" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search people…" className="flex-1 py-2 text-[13px] outline-none bg-transparent" />
          </div>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand">
            <option value="all">All departments</option>
            {DEPARTMENTS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand">
            <option value="all">All SOP areas</option>
            {SOP_AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <p className="text-[11px] text-stone-400">
          Showing {filteredEmployees.length} people × {filteredSops.length} SOPs
          {(deptFilter !== 'all' || areaFilter !== 'all' || query) ? ' (filtered)' : ''}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-stone-300" />
        </div>
      ) : filteredEmployees.length === 0 ? (
        <p className="text-[13px] text-text-muted text-center py-12">No staff match this filter.</p>
      ) : (
        <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                {/* Area header row */}
                <tr>
                  <th className="sticky left-0 bg-stone-50 border-b border-r border-surface-rule px-3 py-2 text-left text-[10px] font-semibold text-stone-400 uppercase tracking-wide min-w-[180px] z-10">
                    Person
                  </th>
                  {Array.from(sopsByArea.entries()).map(([area, areaSops]) => {
                    const am = sopAreaMeta(area)
                    return (
                      <th key={area} colSpan={areaSops.length}
                        className="border-b border-r border-surface-rule px-2 py-1.5 text-center font-semibold text-[10px] uppercase tracking-wide"
                        style={{ color: am.colorHex }}>
                        {am.label}
                      </th>
                    )
                  })}
                </tr>
                {/* SOP title row */}
                <tr>
                  <th className="sticky left-0 bg-stone-50 border-b border-r border-surface-rule z-10" />
                  {filteredSops.map(sop => (
                    <th key={sop.id} className="border-b border-r border-surface-rule px-1 py-2 min-w-[44px] max-w-[44px]">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-mono text-[8px] text-stone-400 rotate-[-60deg] origin-center whitespace-nowrap" title={sop.title}>
                          {sop.doc_no}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp, ri) => {
                  const deptMeta = categoryMeta(emp.department)
                  return (
                    <tr key={emp.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-stone-50/50'}>
                      <td className="sticky left-0 border-b border-r border-surface-rule px-3 py-2 z-10"
                        style={{ background: ri % 2 === 0 ? 'white' : '#FAFAF9' }}>
                        <Link href={`/production/staff/${emp.id}`}
                          className="flex items-center gap-2 hover:text-brand transition-colors group">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: deptMeta.colorHex }} />
                          <span className="text-[12px] font-medium text-text group-hover:text-brand truncate max-w-[140px]">
                            {emp.display_name || emp.name}
                          </span>
                          <ChevronRight size={11} className="text-stone-300 group-hover:text-brand shrink-0" />
                        </Link>
                        <div className="text-[10px] text-stone-400 ml-3.5 truncate max-w-[160px]">
                          {emp.position || emp.job_title || deptMeta.label}
                        </div>
                      </td>
                      {filteredSops.map(sop => {
                        const status = compMap.get(`${emp.id}::${sop.id}`) ?? 'not_started'
                        const sm = statusMeta(status)
                        return (
                          <td key={sop.id} className="border-b border-r border-surface-rule p-0 text-center">
                            <Link href={`/production/staff/${emp.id}`}
                              title={`${emp.display_name || emp.name} · ${sop.title} · ${sm.label}`}
                              className={`flex items-center justify-center h-8 w-full text-[9px] font-bold transition-opacity hover:opacity-75 ${sm.bgClass} ${sm.textClass}`}>
                              {sm.short}
                            </Link>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

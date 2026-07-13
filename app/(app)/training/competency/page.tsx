'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, isPast } from 'date-fns'
import { ArrowLeft, Loader2, BarChart3, AlertTriangle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { categoryMeta } from '@/lib/production/roster-config'

const db = () => getDb().schema('production')

interface Employee { id: string; name: string; display_name: string | null; department: string; active: boolean }
interface Sop { id: string; doc_no: string; title: string; active: boolean }
interface Competency { employee_id: string; sop_id: string; status: string; next_review: string | null }

export default function CompetencyDashboardPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [sops, setSops] = useState<Sop[]>([])
  const [comps, setComps] = useState<Competency[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [empRes, sopRes, compRes] = await Promise.all([
        db().from('employees').select('id,name,display_name,department,active').eq('active', true),
        db().from('sops').select('id,doc_no,title,active').eq('active', true),
        db().from('employee_competencies').select('employee_id,sop_id,status,next_review'),
      ])
      setEmployees((empRes.data ?? []) as Employee[])
      setSops((sopRes.data ?? []) as Sop[])
      setComps((compRes.data ?? []) as Competency[])
      setLoading(false)
    }
    load()
  }, [])

  const byDepartment = useMemo(() => {
    const empById = new Map(employees.map(e => [e.id, e]))
    const groups = new Map<string, { total: number; competent: number }>()
    for (const c of comps) {
      const emp = empById.get(c.employee_id)
      if (!emp) continue
      const g = groups.get(emp.department) ?? { total: 0, competent: 0 }
      g.total += 1
      if (c.status === 'competent') g.competent += 1
      groups.set(emp.department, g)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [employees, comps])

  const overallCompetent = comps.filter(c => c.status === 'competent').length
  const overallTotal = comps.length

  const overdue = useMemo(() => {
    const empById = new Map(employees.map(e => [e.id, e]))
    const sopById = new Map(sops.map(s => [s.id, s]))
    return comps
      .filter(c => c.next_review && isPast(parseISO(c.next_review)))
      .map(c => ({ ...c, employee: empById.get(c.employee_id), sop: sopById.get(c.sop_id) }))
      .filter(c => c.employee && c.sop)
  }, [comps, employees, sops])

  const notCompetent = useMemo(() => {
    const empById = new Map(employees.map(e => [e.id, e]))
    const sopById = new Map(sops.map(s => [s.id, s]))
    return comps
      .filter(c => c.status === 'not_competent')
      .map(c => ({ ...c, employee: empById.get(c.employee_id), sop: sopById.get(c.sop_id) }))
      .filter(c => c.employee && c.sop)
  }, [comps, employees, sops])

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>

  return (
    <div className="px-4 py-6 max-w-[800px] mx-auto space-y-5">
      <Link href="/training" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> Training
      </Link>
      <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2"><BarChart3 size={20} className="text-brand" /> Competency dashboard</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Staff" value={String(employees.length)} />
        <StatCard label="Competent" value={overallTotal > 0 ? `${Math.round((overallCompetent / overallTotal) * 100)}%` : '—'} />
        <StatCard label="Overdue reviews" value={String(overdue.length)} warn={overdue.length > 0} />
      </div>

      <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
        <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted">By department</h2>
        {byDepartment.map(([dept, g]) => {
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

      {overdue.length > 0 && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
          <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1.5"><AlertTriangle size={11} className="text-warn" /> Overdue reviews</h2>
          {overdue.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-[12px]">
              <span className="text-text">{c.employee?.display_name || c.employee?.name} — {c.sop?.title}</span>
              <span className="text-err">{format(parseISO(c.next_review!), 'd MMM yyyy')}</span>
            </div>
          ))}
        </div>
      )}

      {notCompetent.length > 0 && (
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-2">
          <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1.5"><AlertTriangle size={11} className="text-err" /> Not competent</h2>
          {notCompetent.map((c, i) => (
            <Link key={i} href={`/production/staff/${c.employee_id}`} className="flex items-center justify-between text-[12px] hover:text-brand">
              <span className="text-text">{c.employee?.display_name || c.employee?.name} — {c.sop?.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 text-center">
      <div className={`text-[24px] font-bold ${warn ? 'text-err' : 'text-text'}`}>{value}</div>
      <div className="text-[11px] text-text-muted mt-0.5">{label}</div>
    </div>
  )
}

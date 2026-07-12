'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, isPast } from 'date-fns'
import { ArrowLeft, Loader2, Users2, Check, Search } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'

interface Course { id: string; title: string; status: string }
interface Employee { id: string; name: string; display_name: string | null; department: string }
interface Assignment {
  id: string; employee_id: string; course_id: string; due_date: string | null; status: string; reason: string | null
  training_courses?: { title: string; slug: string } | null
  employee?: Employee | null
}

const STATUS_CLS: Record<string, string> = {
  completed: 'bg-ok/15 text-ok', in_progress: 'bg-azure/15 text-azure', assigned: 'bg-stone-100 text-stone-500',
}

export default function AssignmentsPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  const [courseId, setCourseId] = useState('')
  const [search, setSearch] = useState('')
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set())
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  async function loadAssignments() {
    const res = await fetch('/api/training/assignments')
    const data = await res.json()
    setAssignments(data.assignments ?? [])
  }

  useEffect(() => {
    async function load() {
      const [coursesRes, employeesRes] = await Promise.all([
        fetch('/api/training/courses?all=1').then(r => r.json()),
        getDb().schema('production').from('employees').select('id,name,display_name,department').eq('active', true).order('name'),
      ])
      setCourses(coursesRes.courses ?? [])
      setEmployees((employeesRes.data ?? []) as Employee[])
      await loadAssignments()
      setLoading(false)
    }
    load()
  }, [])

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(e => (e.display_name || e.name).toLowerCase().includes(q))
  }, [employees, search])

  function toggleEmployee(id: string) {
    setSelectedEmployees(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function assign() {
    if (!courseId || selectedEmployees.size === 0) { setError('Pick a course and at least one person'); return }
    setSaving(true); setError(null); setSavedMsg(null)
    try {
      const res = await fetch('/api/training/assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: courseId, employee_ids: [...selectedEmployees], due_date: dueDate || null, reason: reason || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not assign the course')
      setSavedMsg(`Assigned to ${selectedEmployees.size} ${selectedEmployees.size === 1 ? 'person' : 'people'}`)
      setSelectedEmployees(new Set()); setDueDate(''); setReason('')
      await loadAssignments()
    } catch (e: any) {
      setError(e?.message || 'Could not assign the course')
    }
    setSaving(false)
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>

  return (
    <div className="px-4 py-6 max-w-[800px] mx-auto space-y-5">
      <Link href="/training" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> Training
      </Link>
      <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2"><Users2 size={20} className="text-brand" /> Assignments</h1>

      <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-3">
        <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Assign a course</h2>
        <select value={courseId} onChange={e => setCourseId(e.target.value)} className={INP}>
          <option value="">Select a course…</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>

        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff…" className={`${INP} pl-8`} />
        </div>
        <div className="max-h-56 overflow-y-auto border border-stone-100 rounded-xl divide-y divide-stone-100">
          {filteredEmployees.map(e => (
            <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-[13px] text-text cursor-pointer hover:bg-surface">
              <input type="checkbox" checked={selectedEmployees.has(e.id)} onChange={() => toggleEmployee(e.id)} className="accent-brand" />
              {e.display_name || e.name} <span className="text-[11px] text-text-muted capitalize">· {e.department}</span>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={INP} />
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" className={INP} />
        </div>

        {error && <p className="text-[12px] text-err">{error}</p>}
        {savedMsg && <p className="text-[12px] text-ok flex items-center gap-1.5"><Check size={13} /> {savedMsg}</p>}

        <button onClick={assign} disabled={saving}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : 'Assign'}
        </button>
      </div>

      <div className="space-y-2">
        <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted">All assignments</h2>
        {assignments.length === 0 ? (
          <p className="text-[13px] text-text-muted py-4">No assignments yet.</p>
        ) : assignments.map(a => {
          const overdue = a.due_date && a.status !== 'completed' && isPast(parseISO(a.due_date))
          return (
            <div key={a.id} className="bg-surface-card border border-surface-rule rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-text truncate">{a.employee?.display_name || a.employee?.name || '—'} <span className="text-text-muted">— {a.training_courses?.title ?? '—'}</span></p>
                {a.due_date && <p className={`text-[11px] mt-0.5 ${overdue ? 'text-err font-medium' : 'text-text-muted'}`}>Due {format(parseISO(a.due_date), 'd MMM yyyy')}{overdue ? ' (overdue)' : ''}</p>}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 capitalize ${STATUS_CLS[a.status] ?? ''}`}>{a.status.replace('_', ' ')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const INP = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'

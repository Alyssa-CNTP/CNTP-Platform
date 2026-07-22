'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, isPast } from 'date-fns'
import { ArrowLeft, Loader2, UserCheck2, Check, ClipboardList, ChevronDown, ChevronUp } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SECTION_CORE_SOPS } from '@/lib/production/competency-config'

const db = () => getDb().schema('production')

type TabKey = 'awaiting' | 'tracker'

interface AwaitingRow {
  id: string; employee_id: string; sop_id: string
  score: number | null; training_completed: boolean; date_completed: string | null; notes: string | null
  employee_name: string; sop_title: string; sop_doc_no: string
}

interface Employee { id: string; name: string; display_name: string | null; department: string }
interface Sop { id: string; doc_no: string; title: string }
interface Competency { employee_id: string; sop_id: string; status: string; next_review: string | null }

const SECTIONS: { key: string; label: string }[] = [
  { key: 'sieving',     label: 'Sieving Tower' },
  { key: 'refining1',   label: 'Refining 1' },
  { key: 'refining2',   label: 'Refining 2' },
  { key: 'granule',     label: 'Granule Line' },
  { key: 'blender',     label: 'Blender' },
  { key: 'pasteuriser', label: 'Pasteuriser' },
]

// Never-engaged statuses — this person hasn't started the qualification
// process at all for this section's core SOP.
const NEW_STATUSES = new Set(['not_started', 'tba', 'sop_created'])

export default function PracticalSignoffPage() {
  const { displayName } = useAuth()
  const [tab, setTab] = useState<TabKey>('awaiting')

  const [rows, setRows] = useState<AwaitingRow[]>([])
  const [loadingAwaiting, setLoadingAwaiting] = useState(true)
  const [signingId, setSigningId] = useState<string | null>(null)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [sops, setSops] = useState<Sop[]>([])
  const [competencies, setCompetencies] = useState<Competency[]>([])
  const [loadingTracker, setLoadingTracker] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  async function loadAwaiting() {
    const { data: sopRows } = await db().from('sops').select('id,doc_no,title').eq('requires_practical_signoff', true)
    const sopIds = (sopRows ?? []).map((s: any) => s.id)
    if (sopIds.length === 0) { setRows([]); setLoadingAwaiting(false); return }

    const { data: comps } = await db().from('employee_competencies')
      .select('id,employee_id,sop_id,score,training_completed,date_completed,notes')
      .eq('status', 'assessed').in('sop_id', sopIds)

    const employeeIds = [...new Set((comps ?? []).map((c: any) => c.employee_id))]
    const { data: emps } = employeeIds.length
      ? await db().from('employees').select('id,name,display_name').in('id', employeeIds)
      : { data: [] }

    const sopById = new Map((sopRows ?? []).map((s: any) => [s.id, s]))
    const empById = new Map((emps ?? []).map((e: any) => [e.id, e]))

    setRows((comps ?? []).map((c: any) => ({
      ...c,
      employee_name: empById.get(c.employee_id)?.display_name || empById.get(c.employee_id)?.name || '—',
      sop_title: sopById.get(c.sop_id)?.title ?? '—',
      sop_doc_no: sopById.get(c.sop_id)?.doc_no ?? '',
    })))
    setLoadingAwaiting(false)
  }

  async function loadTracker() {
    const [empRes, sopRes, compRes] = await Promise.all([
      db().from('employees').select('id,name,display_name,department').eq('active', true).order('name'),
      db().from('sops').select('id,doc_no,title').in('doc_no', Object.values(SECTION_CORE_SOPS)),
      db().from('employee_competencies').select('employee_id,sop_id,status,next_review'),
    ])
    setEmployees((empRes.data ?? []) as Employee[])
    setSops((sopRes.data ?? []) as Sop[])
    setCompetencies((compRes.data ?? []) as Competency[])
    setLoadingTracker(false)
  }

  useEffect(() => { loadAwaiting(); loadTracker() }, [])

  async function signOff(row: AwaitingRow) {
    setSigningId(row.id)
    try {
      await fetch('/api/staff/competencies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: row.employee_id, sop_id: row.sop_id, status: 'competent',
          score: row.score, training_completed: row.training_completed, date_completed: row.date_completed,
          assessed_by: null, assessed_at: new Date().toISOString().slice(0, 10),
          notes: `${row.notes ?? ''}${row.notes ? ' — ' : ''}Practical sign-off by ${displayName}`.trim(),
        }),
      })
      setRows(rs => rs.filter(r => r.id !== row.id))
    } finally {
      setSigningId(null)
    }
  }

  const sopByDocNo = useMemo(() => {
    const m = new Map<string, Sop>()
    sops.forEach(s => m.set(s.doc_no, s))
    return m
  }, [sops])

  const compByKey = useMemo(() => {
    const m = new Map<string, Competency>()
    competencies.forEach(c => m.set(`${c.employee_id}::${c.sop_id}`, c))
    return m
  }, [competencies])

  // Per section: who still needs qualifying, split into New (never engaged)
  // vs Existing (has some history but isn't currently competent-and-current).
  // Fully competent, not-lapsed people need no action and are left out.
  const trackerData = useMemo(() => {
    return SECTIONS.map(sec => {
      const coreDocNo = SECTION_CORE_SOPS[sec.key]
      const coreSop = sopByDocNo.get(coreDocNo)
      const fresh: Employee[] = []
      const existing: { emp: Employee; reason: string }[] = []
      if (coreSop) {
        employees.forEach(emp => {
          const comp = compByKey.get(`${emp.id}::${coreSop.id}`)
          if (!comp || NEW_STATUSES.has(comp.status)) { fresh.push(emp); return }
          if (comp.status === 'competent') {
            if (comp.next_review && isPast(parseISO(comp.next_review))) {
              existing.push({ emp, reason: `Review overdue since ${format(parseISO(comp.next_review), 'd MMM yyyy')}` })
            }
            return // competent and current — nothing to action
          }
          // training_done / assessed / not_competent — started, not yet qualified
          existing.push({ emp, reason: comp.status === 'not_competent' ? 'Marked not competent' : 'In progress' })
        })
      }
      return { sec, coreSop, fresh, existing }
    })
  }, [employees, sopByDocNo, compByKey])

  function toggleCollapsed(key: string) {
    setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  const loading = tab === 'awaiting' ? loadingAwaiting : loadingTracker

  return (
    <div className="px-4 py-6 max-w-[760px] mx-auto space-y-5">
      <Link href="/training" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> Training
      </Link>
      <div>
        <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2"><UserCheck2 size={20} className="text-brand" /> Sign-off</h1>
        <p className="text-[12px] text-text-muted mt-1">Confirm hands-on competence, and see who&rsquo;s still awaiting qualification by section.</p>
      </div>

      <div className="flex items-center gap-1 bg-surface-card border border-surface-rule rounded-2xl p-1 w-fit">
        {([
          { key: 'awaiting', label: 'Awaiting sign-off', icon: UserCheck2 },
          { key: 'tracker',  label: 'Qualification tracker', icon: ClipboardList },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${
              tab === t.key ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text'
            }`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : tab === 'awaiting' ? (
        rows.length === 0 ? (
          <p className="text-[13px] text-text-muted py-8 text-center">Nothing waiting for sign-off.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-text-muted">These staff have passed the digital assessment for a hands-on SOP and are waiting for a supervisor to confirm practical competence on the floor.</p>
            {rows.map(r => (
              <div key={r.id} className="bg-surface-card border border-surface-rule rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-text">{r.employee_name} <span className="text-text-muted">— {r.sop_title} <span className="font-mono text-[10px] text-stone-400">{r.sop_doc_no}</span></span></p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {r.score != null && `Assessment score ${Math.round(r.score * 100)}%`}
                    {r.date_completed && ` · Completed ${format(parseISO(r.date_completed), 'd MMM yyyy')}`}
                  </p>
                </div>
                <button onClick={() => signOff(r)} disabled={signingId === r.id}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand text-white text-[12px] font-medium disabled:opacity-40 shrink-0">
                  {signingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirm competent
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-text-muted">Per floor section — who still needs qualifying, split into people who haven&rsquo;t started (new) and people with some history who aren&rsquo;t yet competent-and-current (existing).</p>
          {trackerData.map(({ sec, coreSop, fresh, existing }) => {
            const isOpen = !collapsed.has(sec.key)
            const total = fresh.length + existing.length
            return (
              <div key={sec.key} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
                <button onClick={() => toggleCollapsed(sec.key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-semibold text-[13px] text-text">{sec.label}</span>
                    {!coreSop ? (
                      <span className="text-[10px] text-stone-400">no core SOP configured</span>
                    ) : (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${total === 0 ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'}`}>
                        {total === 0 ? 'All qualified' : `${total} need${total === 1 ? 's' : ''} action`}
                      </span>
                    )}
                  </div>
                  {isOpen ? <ChevronUp size={14} className="text-stone-400" /> : <ChevronDown size={14} className="text-stone-400" />}
                </button>
                {isOpen && coreSop && (
                  <div className="border-t border-surface-rule px-4 py-3 space-y-3">
                    {fresh.length > 0 && (
                      <div>
                        <p className="text-[10px] text-text-muted uppercase tracking-wide font-semibold mb-1.5">New — not started ({fresh.length})</p>
                        <div className="flex flex-wrap gap-1">
                          {fresh.map(emp => (
                            <Link key={emp.id} href={`/production/staff/${emp.id}`}
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 hover:bg-stone-200 transition-colors">
                              {emp.display_name || emp.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {existing.length > 0 && (
                      <div>
                        <p className="text-[10px] text-text-muted uppercase tracking-wide font-semibold mb-1.5">Existing — needs qualifying ({existing.length})</p>
                        <div className="space-y-1">
                          {existing.map(({ emp, reason }) => (
                            <Link key={emp.id} href={`/production/staff/${emp.id}`}
                              className="flex items-center justify-between gap-2 text-[12px] px-2 py-1 rounded-lg hover:bg-surface transition-colors">
                              <span className="text-text">{emp.display_name || emp.name}</span>
                              <span className="text-[10px] text-warn">{reason}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {fresh.length === 0 && existing.length === 0 && (
                      <p className="text-[12px] text-text-muted">Everyone on record is qualified and current for {coreSop.doc_no}.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

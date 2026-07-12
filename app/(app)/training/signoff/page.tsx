'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, Loader2, UserCheck2, Check } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'

const db = () => getDb().schema('production')

interface Row {
  id: string; employee_id: string; sop_id: string
  score: number | null; training_completed: boolean; date_completed: string | null; notes: string | null
  employee_name: string; sop_title: string; sop_doc_no: string
}

export default function PracticalSignoffPage() {
  const { displayName } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [signingId, setSigningId] = useState<string | null>(null)

  async function load() {
    const { data: sops } = await db().from('sops').select('id,doc_no,title').eq('requires_practical_signoff', true)
    const sopIds = (sops ?? []).map((s: any) => s.id)
    if (sopIds.length === 0) { setRows([]); setLoading(false); return }

    const { data: comps } = await db().from('employee_competencies')
      .select('id,employee_id,sop_id,score,training_completed,date_completed,notes')
      .eq('status', 'assessed').in('sop_id', sopIds)

    const employeeIds = [...new Set((comps ?? []).map((c: any) => c.employee_id))]
    const { data: employees } = employeeIds.length
      ? await db().from('employees').select('id,name,display_name').in('id', employeeIds)
      : { data: [] }

    const sopById = new Map((sops ?? []).map((s: any) => [s.id, s]))
    const empById = new Map((employees ?? []).map((e: any) => [e.id, e]))

    setRows((comps ?? []).map((c: any) => ({
      ...c,
      employee_name: empById.get(c.employee_id)?.display_name || empById.get(c.employee_id)?.name || '—',
      sop_title: sopById.get(c.sop_id)?.title ?? '—',
      sop_doc_no: sopById.get(c.sop_id)?.doc_no ?? '',
    })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function signOff(row: Row) {
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

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>

  return (
    <div className="px-4 py-6 max-w-[700px] mx-auto space-y-5">
      <Link href="/training" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> Training
      </Link>
      <div>
        <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2"><UserCheck2 size={20} className="text-brand" /> Practical sign-off</h1>
        <p className="text-[12px] text-text-muted mt-1">These staff have passed the digital assessment for a hands-on SOP and are waiting for a supervisor to confirm practical competence on the floor.</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">Nothing waiting for sign-off.</p>
      ) : (
        <div className="space-y-2">
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
      )}
    </div>
  )
}

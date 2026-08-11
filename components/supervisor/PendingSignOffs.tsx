'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { PenLine, ChevronRight, Loader2, CheckCircle2 } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta } from '@/lib/production/capture-config'

// Shared "sessions waiting on your sign-off" widget — originally the right-hand
// column of /supervisor/signoff, now also embedded at the top of the Hub
// landing tab so it's the first bold thing a supervisor sees, before Roster's
// staffing grid or today's-sections view. One query, one component, rendered
// in both places so they can never disagree.
//
// Filters out soft-deleted sessions (.is('deleted_at', null)) — a session an
// IT/manager archived was previously still showing up here as "awaiting
// sign-off", which is what made this queue's count look wrong.

interface Pending { id: string; section_id: string; date: string; shift: string; operators: string[]; submitted_at: string | null }

export function PendingSignOffs() {
  const [pending, setPending] = useState<Pending[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await getDb().schema('production').from('prod_sessions')
      .select('id,section_id,date,shift,operator_names,submitted_at')
      .eq('status', 'submitted').is('deleted_at', null).order('submitted_at', { ascending: true })
    setPending(((data as any[]) ?? []).map(s => ({
      id: s.id, section_id: s.section_id, date: s.date, shift: s.shift,
      operators: s.operator_names ?? [], submitted_at: s.submitted_at,
    })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="bg-surface-card border border-surface-rule rounded-2xl p-6 flex items-center justify-center"><Loader2 size={18} className="animate-spin text-stone-300" /></div>
  }
  if (!pending.length) {
    return (
      <div className="flex items-center gap-2.5 bg-ok/5 border border-ok/25 rounded-2xl px-4 py-3">
        <CheckCircle2 size={18} className="text-ok shrink-0" />
        <div className="text-[13px] text-text"><span className="font-semibold">All caught up</span> <span className="text-text-muted">— nothing waiting for your sign-off.</span></div>
      </div>
    )
  }
  return (
    <div className="bg-info/5 border-2 border-info/40 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-info/20">
        <span className="w-7 h-7 rounded-full bg-info text-white flex items-center justify-center font-display font-bold text-[13px] shrink-0">{pending.length}</span>
        <PenLine size={16} className="text-info" />
        <span className="font-display font-bold text-[15px] text-info">Needs your sign-off today</span>
      </div>
      <div className="divide-y divide-info/15">
        {pending.map(s => {
          const m = sectionMeta(s.section_id)
          const href = `/production/capture/${s.section_id}?date=${s.date}&shift=${s.shift}&tab=signoff`
          return (
            <Link key={s.id} href={href} className="flex items-center gap-3 px-4 py-3 bg-white/40 hover:bg-white transition-colors group">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                <span className="font-mono font-bold text-[9px] text-white">{m.code}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-body font-bold text-[14px] text-text truncate">{m.name}</div>
                <div className="font-mono text-[11px] text-text-muted truncate">
                  {format(new Date(s.date + 'T12:00:00'), 'EEE d MMM')} · {s.shift}
                  {s.operators.length ? ` · ${s.operators.join(', ')}` : ''}
                </div>
              </div>
              <ChevronRight size={15} className="text-info shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

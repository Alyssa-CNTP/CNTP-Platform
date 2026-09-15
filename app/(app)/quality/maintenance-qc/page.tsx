'use client'

// app/(app)/quality/maintenance-qc/page.tsx
// Quality-module tab: maintenance job cards awaiting the post-maintenance QC check.
// When a technician finishes a job card / breakdown it moves to `qc_check` and lands
// here for the QC on duty. This is a READ-ONLY queue (client-side, no server change)
// — opening a card takes the QC into the existing job-card workflow where the actual
// YES / NO / N/A check is answered. A matching corner pop-up (MaintenanceAlerts) also
// notifies the on-duty QC live.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, ClipboardCheck, ArrowRight, Search } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { fmtDT, diffDays } from '@/lib/maintenance/helpers'

interface QcCard {
  id: number; card_no: string; area: string; machine: string | null
  description: string; workflow: 'breakdown' | 'planned'
  assigned_to: string | null; raised_by: string
  completed_at: string | null; qc_name: string | null; raised_at: string
}

export default function MaintenanceQcPage() {
  const auth = useAuth()
  const db = getDb()
  const [rows, setRows] = useState<QcCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: err } = await db.schema('maintenance').from('job_cards')
        .select('id, card_no, area, machine, description, workflow, assigned_to, raised_by, completed_at, qc_name, raised_at')
        .eq('status', 'qc_check')
        .order('completed_at', { ascending: true })
      if (err) { setError(err.message); setRows([]) }
      else { setRows((data ?? []) as QcCard[]); setError('') }
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the QC queue')
    } finally {
      setLoading(false)
      setLastFetch(new Date())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load on mount + poll every 20s so finished jobs appear without a manual refresh.
  useEffect(() => {
    load()
    const id = setInterval(load, 20_000)
    return () => clearInterval(id)
  }, [load])

  const ql = q.trim().toLowerCase()
  const shown = rows.filter(r => !ql || [r.card_no, r.area, r.machine, r.description, r.assigned_to, r.qc_name]
    .some(v => (v ?? '').toLowerCase().includes(ql)))

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-brand" /> Maintenance QC
          </h1>
          <p className="text-sm text-text-muted mt-1">Job cards finished by maintenance and awaiting the post-maintenance QC check. Open a card to answer YES / NO / N/A.</p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetch && <span className="text-[11px] text-text-faint">Updated {fmtTime(lastFetch)}</span>}
          <button onClick={load} disabled={loading} title="Refresh"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-surface-rule bg-surface-card text-text-muted hover:text-text hover:border-text/30 transition disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="relative mb-4 max-w-[360px]">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
        <input className="w-full rounded-lg border border-surface-rule bg-surface-card pl-8 pr-3 py-2 text-[13px]"
          placeholder="Search — card, machine, technician…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {error && <div className="card p-3 text-[12px] text-err border border-err/30 mb-3">{error}</div>}

      {/* One page, no sideways scroll.
          The QC-check button is the whole point of this screen and it used to
          be the ninth column of a nine-column table inside an overflow-x-auto —
          on any normal laptop it sat past the right edge, so the QC had to
          scroll the table sideways on every single card to reach it.
          `table-fixed` with explicit widths is what keeps it on screen: the
          description is the only elastic column, and it truncates instead of
          pushing the action off. The two columns that were only ever context —
          the technician and the QC who has the card — moved under the
          description, which is where they read naturally anyway. Nothing was
          dropped; the table just stopped being wider than the page. */}
      <div className="rounded-xl border border-surface-rule bg-surface-card overflow-hidden">
        <table className="data-table w-full table-fixed">
          <colgroup>
            <col className="w-[92px]" /><col className="w-[48px]" /><col className="w-[190px]" />
            <col /><col className="w-[130px]" /><col className="w-[64px]" /><col className="w-[104px]" />
          </colgroup>
          <thead><tr>{['#', 'Type', 'Area / machine', 'Description', 'Finished', 'Waiting', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{shown.map(r => {
            const waiting = diffDays(r.completed_at ?? r.raised_at, new Date().toISOString())
            return (
              <tr key={r.id}>
                <td className="font-semibold text-accent truncate">{r.card_no}</td>
                <td><span className={`badge ${r.workflow === 'breakdown' ? 'badge-err' : 'badge-info'}`}>{r.workflow === 'breakdown' ? 'BD' : 'PL'}</span></td>
                <td className="truncate" title={`${r.area}${r.machine ? ' · ' + r.machine : ''}`}>
                  {r.area}{r.machine ? <span className="text-text-faint"> · {r.machine}</span> : ''}
                </td>
                <td className="min-w-0">
                  <div className="truncate" title={r.description}>{r.description}</div>
                  <div className="truncate text-[11px] text-text-faint">
                    {r.assigned_to ?? 'unassigned'}{r.qc_name ? ` · QC ${r.qc_name}` : ''}
                  </div>
                </td>
                <td className="truncate text-text-muted">{r.completed_at ? fmtDT(r.completed_at) : '—'}</td>
                <td className={`tabular-nums ${waiting > 1 ? 'text-warn font-semibold' : 'text-text-muted'}`}>{waiting}d</td>
                <td>
                  <Link href={`/maintenance/job-cards/${r.id}`}
                    className="inline-flex items-center gap-1 bg-brand text-white rounded-lg px-2.5 py-1.5 text-[12px] font-semibold hover:brightness-110 transition whitespace-nowrap">
                    QC check <ArrowRight size={13} />
                  </Link>
                </td>
              </tr>
            )
          })}</tbody>
        </table>
        {!loading && shown.length === 0 && (
          <div className="p-6 text-center text-[13px] text-text-faint">
            {rows.length === 0 ? 'Nothing waiting for QC — all finished job cards have been checked.' : 'No cards match your search.'}
          </div>
        )}
      </div>
    </div>
  )
}

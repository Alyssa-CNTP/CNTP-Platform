'use client'

// Production → Shift Reports. A manager-facing list of generated shift
// reports (now auto-generated at shift end — see
// .github/workflows/shift-report-generate.yml), each linking into the
// existing (unmodified) /supervisor/report page.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { FileText, ArrowRight } from 'lucide-react'
import { ProductionTabs } from '@/components/production/ProductionTabs'
import { SHIFT_LABEL } from '@/lib/production/shifts'
import { STATUS_LABEL } from '@/lib/production/shift-report'

interface RecentReport {
  id: string; date: string; shift: string; status: string
  generatedAt: string | null; generatedByName: string | null
  submittedAt: string | null; approvedAt: string | null
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-surface-dim text-text-muted',
  submitted: 'bg-warn/10 text-warn',
  approved: 'bg-ok/10 text-ok',
}

export default function ProductionShiftReportsPage() {
  const [reports, setReports] = useState<RecentReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    fetch('/api/production/shift-report/recent?limit=20')
      .then(r => r.json())
      .then(j => j.error ? setError(j.error) : setReports(j.reports || []))
      .catch(() => setError('Could not load recent reports.'))
  }, [])

  return (
    <div className="px-4 pt-5 pb-10 max-w-[1400px] mx-auto">
      <div className="mb-5"><ProductionTabs /></div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={15} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text">Today's shift report</h3>
        </div>
        <Link href="/supervisor/report"
          className="flex items-center justify-between rounded-lg border border-surface-rule px-3 py-2.5 hover:border-brand/40 transition">
          <span className="text-[13px] text-text">Open today's report</span>
          <ArrowRight size={14} className="text-text-muted" />
        </Link>
      </div>

      <div className="card p-4 mt-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-text">Recent reports</h3>
        </div>
        {error ? (
          <div className="text-[12px] text-err py-4">{error}</div>
        ) : reports === null ? (
          <div className="text-[12px] text-text-muted py-4">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="text-[12px] text-text-muted py-4">No shift reports generated yet.</div>
        ) : (
          <div className="divide-y divide-surface-rule">
            {reports.map(r => (
              <Link key={r.id} href={`/supervisor/report?date=${r.date}&shift=${r.shift}`}
                className="flex items-center justify-between py-2.5 hover:bg-surface-dim/40 transition -mx-1 px-1 rounded">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[12px] text-text">
                    {r.date === today ? 'Today' : format(new Date(r.date + 'T12:00:00'), 'd MMM')}
                  </span>
                  <span className="text-[12px] text-text-muted">{SHIFT_LABEL[r.shift as keyof typeof SHIFT_LABEL] ?? r.shift}</span>
                  {r.generatedByName === 'System (cron)' && (
                    <span className="text-[10px] text-text-faint">auto-generated</span>
                  )}
                </div>
                <span className={`text-[10px] font-medium px-2 py-1 rounded-lg ${STATUS_CLASS[r.status] ?? 'bg-surface-dim text-text-muted'}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

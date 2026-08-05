'use client'

// Production → Shift Reports. A manager-facing list of generated shift
// reports, linking into the existing (unmodified) /supervisor/report page for
// each one. The "Recent Reports" list itself ships in a follow-on phase once
// reports start auto-generating at shift end — for now this links straight
// through to today's report, same as the Supervisor Hub already does.

import Link from 'next/link'
import { FileText, ArrowRight } from 'lucide-react'
import { ProductionTabs } from '@/components/production/ProductionTabs'

export default function ProductionShiftReportsPage() {
  return (
    <div className="px-4 pt-5 pb-10 max-w-[1400px] mx-auto">
      <div className="mb-5"><ProductionTabs /></div>
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={15} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text">Shift reports</h3>
        </div>
        <Link href="/supervisor/report"
          className="flex items-center justify-between rounded-lg border border-surface-rule px-3 py-2.5 hover:border-brand/40 transition">
          <span className="text-[13px] text-text">Today's shift report</span>
          <ArrowRight size={14} className="text-text-muted" />
        </Link>
        <p className="text-[11px] text-text-muted mt-3">
          A history of past reports will appear here once daily auto-generation ships.
        </p>
      </div>
    </div>
  )
}

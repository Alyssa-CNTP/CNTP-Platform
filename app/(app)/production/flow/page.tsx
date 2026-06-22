'use client'

/**
 * Production Section Flow
 * ─────────────────────────────────────────────────────────────────────────────
 * A guided 3-step process for non-technical operators.
 * Step 1: Timesheet (start of shift)
 * Step 2: Production capture
 * Step 3: H&S / Cleaning checklist
 *
 * Route: /production/flow?id=sieve|ref1|ref2|gran|blend|past
 */

import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { format } from 'date-fns'
import { CheckCircle2, Clock, ChevronRight, ArrowLeft } from 'lucide-react'
import clsx from 'clsx'

const SECTION_NAMES: Record<string, string> = {
  ref1:  'Refining 1',
  ref2:  'Refining 2',
  sieve: 'Sieving Tower',
  gran:  'Granule Line',
  blend: 'Blender',
  past:  'Pasteuriser',
}

const STEPS = [
  {
    id: 'timesheet',
    title: 'Timesheet',
    desc: 'Log your shift start time and breaks',
    icon: '🕐',
  },
  {
    id: 'capture',
    title: 'Production Capture',
    desc: 'Record debagging inputs, outputs and mass balance',
    icon: '📋',
  },
  {
    id: 'cleaning',
    title: 'Cleaning Checklist',
    desc: 'Complete and sign off the cleaning tasks for this section',
    icon: '✅',
  },
]

function FlowPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const { displayName } = useAuth()

  const sectionId   = searchParams.get('id') ?? 'ref1'
  const sectionName = SECTION_NAMES[sectionId] ?? sectionId
  const isRefining  = sectionId === 'ref1' || sectionId === 'ref2'

  // Map section to cleaning checklist type
  const cleaningType = sectionId === 'sieve' ? 'sieving_tower'
    : (sectionId === 'gran' || sectionId === 'blend') ? 'hammermill'
    : 'daily_plant'

  const steps = STEPS

  function goToStep(stepId: string) {
    if (stepId === 'timesheet') {
      router.push(`/timesheets?section=${encodeURIComponent(sectionName)}&from=flow&flowId=${sectionId}`)
    } else if (stepId === 'capture') {
      if (isRefining) {
        router.push(`/production/refining?line=${sectionId}&from=flow&flowId=${sectionId}`)
      } else {
        router.push(`/production/section?id=${sectionId}&from=flow&flowId=${sectionId}`)
      }
    } else if (stepId === 'cleaning') {
      router.push(`/cleaning?type=${cleaningType}&section=${encodeURIComponent(sectionName)}&from=flow&flowId=${sectionId}`)
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-6">

      {/* Back */}
      <button
        onClick={() => router.push('/production')}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors"
      >
        <ArrowLeft size={16} /> All sections
      </button>

      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[2px] text-text-muted mb-1">
          {format(new Date(), 'EEEE d MMMM')} · BHW
        </p>
        <h1 className="font-display font-extrabold text-3xl text-text">{sectionName}</h1>
        <p className="text-sm text-text-muted mt-1">Complete all three steps for this shift.</p>
      </div>

      {/* Step cards */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <button
            key={step.id}
            onClick={() => goToStep(step.id)}
            className="w-full text-left card p-5 flex items-center gap-4 hover:shadow-md transition-all group"
          >
            {/* Step number */}
            <div className="w-10 h-10 rounded-full bg-surface border-2 border-surface-rule flex items-center justify-center flex-shrink-0 font-display font-bold text-lg text-text-muted group-hover:border-brand group-hover:text-brand transition-colors">
              {i + 1}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-lg leading-none">{step.icon}</span>
                <span className="font-display font-bold text-[16px] text-text">{step.title}</span>
              </div>
              <p className="text-sm text-text-muted leading-snug">{step.desc}</p>
            </div>

            <ChevronRight size={18} className="text-text-faint group-hover:text-text transition-colors flex-shrink-0" />
          </button>
        ))}
      </div>

      {/* Note */}
      <div className="bg-surface rounded-xl p-4 border border-surface-rule">
        <p className="text-xs text-text-muted leading-relaxed">
          <strong className="text-text">Important:</strong> Complete all three steps every shift.
          The cleaning checklist must be signed off by the supervisor before the shift ends.
        </p>
      </div>
    </div>
  )
}

export default function FlowPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-full flex items-center justify-center">
        <div className="font-mono text-[11px] tracking-[2px] uppercase text-text-muted animate-pulse">Loading…</div>
      </div>
    }>
      <FlowPage />
    </Suspense>
  )
}
'use client'

import { useRouter } from 'next/navigation'
import { ChevronRight, ClipboardList, History, Printer, Tags } from 'lucide-react'

/**
 * The Pasteuriser hub.
 *
 * Four routes, not one page. The label chain crosses three roles at three
 * different times — sales design and approve, the production manager assigns,
 * the supervisor prints — and each step is guarded by its own permission. A
 * single page showing and hiding sections by role would enforce access by
 * hiding rather than by route guard, and would grow into the same 2,770-line
 * screen the capture module is being unwound from (ARCHITECTURE.md §1A).
 *
 * The hub exists so the chain is visible AS a chain. Everything under it is
 * reachable directly from the sidebar too.
 */

const STEPS = [
  {
    href: '/pasteuriser/labels',
    title: 'Labels',
    who: 'Sales',
    icon: Tags,
    color: 'bg-indigo-600',
    desc: 'Design a label, send a proof to Control Union and the customer, record the approval, assign a PO.',
  },
  {
    href: '/pasteuriser/job-cards',
    title: 'Job Cards',
    who: 'Production Manager',
    icon: ClipboardList,
    color: 'bg-purple-600',
    desc: 'Pick an approved label and its PO, and assign it to a day. Does not wait on the supply chain analyst.',
  },
  {
    href: '/pasteuriser/run',
    title: 'Run',
    who: 'Supervisor',
    icon: Printer,
    color: 'bg-emerald-700',
    desc: 'Capture debagging and bagging, and print the finished-product labels for the assigned job card.',
  },
  {
    href: '/pasteuriser/history',
    title: 'History',
    who: 'Everyone',
    icon: History,
    color: 'bg-slate-600',
    desc: 'Every label printed, which template version it came from, and the approval behind it.',
  },
]

export default function PasteuriserHubPage() {
  const router = useRouter()

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-text">Pasteuriser</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Finished product — label approval through to printing on the line
        </p>
      </div>

      <div className="space-y-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          return (
            <button key={s.href} onClick={() => router.push(s.href)}
              className="w-full text-left card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>
                <Icon size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="font-display font-bold text-[15px] text-text">{s.title}</p>
                  <p className="font-mono text-[10px] text-text-faint uppercase tracking-wide">
                    Step {i + 1} · {s.who}
                  </p>
                </div>
                <p className="text-xs text-text-muted mt-0.5">{s.desc}</p>
              </div>
              <ChevronRight size={18} className="text-text-faint flex-shrink-0" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

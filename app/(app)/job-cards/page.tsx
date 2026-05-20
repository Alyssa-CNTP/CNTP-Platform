'use client'

import { useRouter } from 'next/navigation'
import { FileText, ChevronRight } from 'lucide-react'

const CARDS = [
  { id: 'pasteuriser', title: 'Pasteuriser Line Job Card', ref: 'PR-FM-013/1', desc: 'Diamond blender ratio, batch details, plant settings, sign-offs', color: 'bg-purple-600' },
  { id: 'granule',     title: 'Granule Line Job Card',     ref: 'PR-FM-057/0', desc: 'Granule blend percentages, batch details, sign-offs',           color: 'bg-green-700' },
]

export default function JobCardsPage() {
  const router = useRouter()
  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-text">Job Cards</h1>
        <p className="text-sm text-text-muted mt-0.5">Select a job card to create or view</p>
      </div>
      <div className="space-y-3">
        {CARDS.map(c => (
          <button key={c.id} onClick={() => router.push(`/job-cards/${c.id}`)}
            className="w-full text-left card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.color}`}>
              <FileText size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-[15px] text-text">{c.title}</p>
              <p className="font-mono text-[10px] text-text-muted mt-0.5">{c.ref}</p>
              <p className="text-xs text-text-muted mt-0.5">{c.desc}</p>
            </div>
            <ChevronRight size={18} className="text-text-faint flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
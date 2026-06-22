'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ChevronRight, Lock, FlaskConical } from 'lucide-react'
import { SECTION_CONFIG } from '@/lib/production/live-types'
import type { LiveOperator, ShiftType, Variant } from '@/lib/production/live-types'
import SessionModal from '@/components/production/live/SessionModal'

const SECTIONS = ['sieving','refining1','refining2','granule','blender','smallblender','pasteuriser']

export default function LiveProductionPage() {
  const router = useRouter()
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const today = format(new Date(), 'EEEE, d MMMM yyyy')

  function handleModalConfirm(data: {
    primaryOperator: LiveOperator
    secondaryOperator: LiveOperator | null
    shift: ShiftType
    lotNumber: string
    variant: Variant | ''
  }) {
    if (!selectedSection) return
    const params = new URLSearchParams({
      section:              selectedSection,
      shift:                data.shift,
      date:                 format(new Date(), 'yyyy-MM-dd'),
      primaryOperatorId:    data.primaryOperator.id,
      primaryOperatorName:  data.primaryOperator.name,
      secondaryOperatorId:  data.secondaryOperator?.id   ?? '',
      secondaryOperatorName: data.secondaryOperator?.name ?? '',
      sessionId:            crypto.randomUUID(),
      ...(data.lotNumber ? { lot:     data.lotNumber } : {}),
      ...(data.variant   ? { variant: data.variant   } : {}),
    })
    setSelectedSection(null)
    router.push(`/production/live/capture?${params.toString()}`)
  }

  return (
    <div className="min-h-full" style={{ background: 'var(--color-surface)' }}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-semibold text-[22px] text-text leading-tight">Live Production</h1>
          <p className="text-[13px] text-text-muted mt-1">{today} · Select a section to start a capture session</p>
        </div>

        {/* Section grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SECTIONS.map(id => {
            const cfg = SECTION_CONFIG[id]
            const isPlaceholder = id === 'smallblender'
            return (
              <button
                key={id}
                onClick={() => !isPlaceholder && setSelectedSection(id)}
                disabled={isPlaceholder}
                className="relative flex items-center gap-4 p-4 rounded-2xl bg-white border border-stone-200 shadow-sm text-left transition-all hover:shadow-md hover:border-stone-300 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {/* Coloured section badge */}
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: cfg.colorHex + '18', border: `1.5px solid ${cfg.colorHex}40` }}
                >
                  <span
                    className="font-mono font-bold text-[13px]"
                    style={{ color: cfg.colorHex }}
                  >
                    {cfg.code}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[15px] text-text leading-tight">{cfg.name}</div>
                  <div className="text-[11px] text-stone-400 mt-0.5">
                    {isPlaceholder
                      ? 'Coming soon'
                      : `${cfg.outputTypes.length} output type${cfg.outputTypes.length !== 1 ? 's' : ''} · ${cfg.inputMode === 'register' ? 'Register incoming bags' : 'Scan in'}`
                    }
                  </div>
                </div>

                {isPlaceholder
                  ? <Lock size={15} className="text-stone-300 flex-shrink-0" />
                  : <ChevronRight size={18} className="text-stone-300 flex-shrink-0" />
                }
              </button>
            )
          })}
        </div>

        {/* FIFO/FEFO note */}
        <div className="mt-6 flex items-start gap-3 px-4 py-3.5 rounded-xl bg-info/5 border border-info/20">
          <FlaskConical size={15} className="text-info mt-0.5 flex-shrink-0" />
          <p className="text-[12px] text-info leading-relaxed">
            Sections run simultaneously. <strong>FIFO</strong> applies by default —
            switch to <strong>FEFO</strong> when a section is low on material.
            All captures are linked by lot/batch number across departments.
          </p>
        </div>
      </div>

      {/* Session modal */}
      {selectedSection && (
        <SessionModal
          sectionId={selectedSection}
          onConfirm={handleModalConfirm}
          onClose={() => setSelectedSection(null)}
        />
      )}
    </div>
  )
}

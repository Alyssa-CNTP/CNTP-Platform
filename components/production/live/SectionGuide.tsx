'use client'
// SectionGuide — inline collapsible step-by-step guide embedded directly in the
// Inputs tab. Replaces a dedicated "Section Info" tab.

import { useState } from 'react'
import { ChevronDown, ChevronUp, Package, PackageCheck, ClipboardCheck, Clock, CheckCircle2, ScanLine, FilePen } from 'lucide-react'

interface SectionGuideProps {
  sectionName: string
  colorHex: string
  inputMode: 'scan' | 'register'
  inputTypes: string[]
  outputTypes: string[]
  // Translated strings (falls back to English keys if missing)
  t: (key: string) => string
}

const STEPS = [
  { icon: <ScanLine size={14}/>,      key: 'step1' },
  { icon: <PackageCheck size={14}/>,  key: 'step2' },
  { icon: <ClipboardCheck size={14}/>, key: 'step3' },
  { icon: <Clock size={14}/>,         key: 'step4' },
  { icon: <CheckCircle2 size={14}/>,  key: 'step5' },
]

export default function SectionGuide({ sectionName, colorHex, inputMode, inputTypes, outputTypes, t }: SectionGuideProps) {
  const [open, setOpen] = useState(true)

  const step1Key = inputMode === 'register' ? 'step1_reg' : 'step1_scan'

  return (
    <div
      className="rounded-2xl border overflow-hidden shadow-sm"
      style={{ borderColor: colorHex + '40', background: colorHex + '08' }}
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span
          className="font-semibold text-[13px]"
          style={{ color: colorHex }}
        >
          {sectionName} — {t('guideTitle')}
        </span>
        <span style={{ color: colorHex + 'cc' }}>
          {open ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Steps */}
          <ol className="space-y-2">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex items-start gap-2.5">
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
                  style={{ background: colorHex }}
                >
                  {i + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="opacity-60" style={{ color: colorHex }}>{s.icon}</span>
                  <span className="text-[13px] text-stone-700">
                    {t(i === 0 ? step1Key : s.key)}
                  </span>
                </div>
              </li>
            ))}
          </ol>

          {/* Accepts / Produces */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Package size={12} style={{ color: colorHex }}/>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">{t('sectionAccepts')}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {inputTypes.map(t2 => (
                  <span key={t2} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-stone-200 text-stone-600">
                    {t2}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <PackageCheck size={12} style={{ color: colorHex }}/>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">{t('sectionProduces')}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {outputTypes.map(t2 => (
                  <span key={t2} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-stone-200 text-stone-600">
                    {t2}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

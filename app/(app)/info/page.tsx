'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, BookOpen, AlertTriangle, CheckCircle, Layers, Warehouse } from 'lucide-react'

interface Step { step: number; title: string; detail: string }

interface SectionGuide {
  id: string; name: string; code: string; color: string
  role: 'warehouse' | 'production'
  intro: string; steps: Step[]; tips: string[]; warnings: string[]
}

const GUIDES: SectionGuide[] = [
  // ── WAREHOUSE SUPERVISOR ──────────────────────────────────────────────────
  {
    id: 'morning-count', name: 'Morning Count', code: 'WH',
    color: 'bg-brand', role: 'warehouse',
    intro: 'The morning count is done every day by two people independently — the warehouse supervisor at 6am and the admin at 8am. You count all stock on the factory floor without seeing each other\'s numbers. The system compares the two counts automatically and flags any differences.',
    steps: [
      { step: 1, title: 'Open the Morning Count', detail: 'Tap "Morning count" in the menu. Check that the date shown is today\'s date. If it is wrong, tap the date and change it.' },
      { step: 2, title: 'Enter your name', detail: 'Type your name when asked. This tells the system which count is yours.' },
      { step: 3, title: 'Select Rooibos or Rosehip', detail: 'The count is split into Rooibos and Rosehip. Tap the one you want to count first. You can switch between them at any time.' },
      { step: 4, title: 'Work through each section', detail: 'The sections are listed one by one — Sieving Tower, Refining, Pasteuriser, Blender, Granule Line, and others. For each section, count the bags or stock on the floor and enter what you see.' },
      { step: 5, title: 'Enter batch numbers and weights', detail: 'Tap the item name. A keypad opens. Type the batch number from the bag tag (e.g. GS-0272), then the weight in kg. If there is more than one bag, tap "Add bag" to add another row.' },
      { step: 6, title: 'If there is nothing there', detail: 'If a section has no stock at all, tap the "Nothing here — no stock" button. This tells the system the section is empty, not forgotten.' },
      { step: 7, title: 'Pallet items', detail: 'Some items like finished product are counted by pallet. Tap the item and enter how many boxes, bags, or paper bags are on the pallet. The system calculates kg automatically.' },
      { step: 8, title: 'Review your total', detail: 'At the bottom you will see a summary showing your total kg and how many sections are completed. Make sure all sections show a tick before you confirm.' },
      { step: 9, title: 'Confirm your count', detail: 'When done, tap "Confirm count". This locks your count. You cannot edit after confirming — check your numbers first.' },
      { step: 10, title: 'Wait for the comparison', detail: 'Once the admin also confirms, the system compares the two counts. You will see a match percentage on your dashboard. If there are differences, you can submit a recount.' },
    ],
    tips: [
      'Count in the same order every day so you do not miss anything — start at Sieving Tower and work around the floor.',
      'If a bag tag is hard to read, enter your best reading and add a note.',
      'The count saves automatically as you go. If your tablet dies, your progress is still saved.',
      'You can change the language at the top of the count screen — Afrikaans, isiZulu, and isiXhosa are available.',
    ],
    warnings: [
      'Do not look at the admin\'s count while you are doing yours — the counts must be done independently.',
      'Once you tap "Confirm count" you cannot change your numbers. Check carefully first.',
      'If you see a section not on the list, use "Add item" at the bottom of that section.',
    ],
  },

  // ── PRODUCTION SECTIONS ───────────────────────────────────────────────────
  {
    id: 'sieving', name: 'Sieving Tower', code: 'ST',
    color: 'bg-blue-500', role: 'production',
    intro: 'The Sieving Tower separates raw rooibos by particle size. Inputs are raw bulk bags. Outputs are coarse leaf, fine leaf, and dust fractions.',
    steps: [
      { step: 1, title: 'Set up debagging station', detail: 'Check bag serial numbers match the job card. Record each input bag before tipping.' },
      { step: 2, title: 'Record input bags', detail: 'For each bag tipped: serial number, lot number, variant (CON/ORG/RA-CON/RA-ORG), and kg nett. This is Total A.' },
      { step: 3, title: 'Monitor sieve outputs', detail: 'Watch the output chutes. Do not mix output bags.' },
      { step: 4, title: 'Record output bags', detail: 'For each output bag filled: serial number, product type, and kg. Label immediately with the job card batch number.' },
      { step: 5, title: 'Mass balance check', detail: 'Total input minus total output = variance. Must be under 15 kg. If over, recheck before submitting.' },
      { step: 6, title: 'Submit', detail: 'Review totals. Tap "Submit" and confirm with supervisor sign-off.' },
    ],
    tips: [
      'Check serial numbers before tipping — you cannot correct the input record after tipping.',
      'Batch number from the job card must go on every output bag tag.',
    ],
    warnings: [
      'Do not tip a bag without recording it first.',
      'Never mix Conventional and Organic in the same output batch.',
    ],
  },
  {
    id: 'refining', name: 'Refining 1 & 2', code: 'R1/R2',
    color: 'bg-emerald-600', role: 'production',
    intro: 'Refining removes sticks and foreign material from leaf fractions. Outputs are Coarse Leaf (B), Fine Leaf (C), and Dust/Sticks (D).',
    steps: [
      { step: 1, title: 'Check job card', detail: 'Confirm product type, batch number, and variant. Job card must be signed before starting.' },
      { step: 2, title: 'Record debagging inputs', detail: 'Serial number, lot, product type, variant, kg gross and kg nett for each bag.' },
      { step: 3, title: 'Record Output B (Coarse Leaf)', detail: 'Each bag: serial number, batch number, kg.' },
      { step: 4, title: 'Record Output C (Fine Leaf)', detail: 'Same as Output B but tagged separately.' },
      { step: 5, title: 'Record Output D (Dust / Sticks)', detail: 'By-product. Goes to granule line or waste.' },
      { step: 6, title: 'Mass balance', detail: 'A − B − C − D = E. Target under 15 kg.' },
      { step: 7, title: 'Submit', detail: 'Both operator and supervisor confirm before submitting.' },
    ],
    tips: [
      'B, C, D are independent output groups — do not combine their totals.',
      'If serial number is illegible, enter "UNREADABLE-[number]" as placeholder.',
    ],
    warnings: [
      'Output D must never be mixed into Output B or C bags.',
      'Do not submit without supervisor sign-off.',
    ],
  },
  {
    id: 'granule', name: 'Granule Line', code: 'GL',
    color: 'bg-amber-500', role: 'production',
    intro: 'The Granule Line mills dust into granules. Inputs are various dust grades. Output is granule product.',
    steps: [
      { step: 1, title: 'Check job card (PR-FM-057/0)', detail: 'Confirm dust blend ratios — different dust types have specific % ratios per batch.' },
      { step: 2, title: 'Record each input type', detail: 'Record the actual kg used for each dust type.' },
      { step: 3, title: 'Record granule output bags', detail: 'Serial number, batch number, kg per bag.' },
      { step: 4, title: 'Check mass balance', detail: 'Total dust input vs total granule output. More than 5% loss should be noted.' },
      { step: 5, title: 'Submit', detail: 'Supervisor confirms and signs when all bags are tagged and stacked.' },
    ],
    tips: [
      'Record actual kg used, not the target from the job card.',
      'Granule bags must be double-tagged — one on the tie, one inside the bag.',
    ],
    warnings: [
      'Never mix Conventional and Organic dust batches.',
      'If output is off-colour or clumping, stop and notify the quality officer.',
    ],
  },
  {
    id: 'blender', name: 'Blender', code: 'BL',
    color: 'bg-purple-500', role: 'production',
    intro: 'The Blender combines multiple leaf grades into customer blends according to a job card with exact component ratios.',
    steps: [
      { step: 1, title: 'Confirm blend job card', detail: 'Check blend description, customer name, and target ratios.' },
      { step: 2, title: 'Weigh and record each component', detail: 'Weigh each component before adding. Record actual kg.' },
      { step: 3, title: 'Blend run', detail: 'Run the blender for the time specified on the job card.' },
      { step: 4, title: 'Record output bags', detail: 'Serial number, batch number, kg per bag.' },
      { step: 5, title: 'Mass balance', detail: 'Input total minus output total should be under 15 kg.' },
      { step: 6, title: 'Submit', detail: 'Supervisor and quality officer confirm before submitting.' },
    ],
    tips: [
      'Component weights must be within 0.5% of the target ratio.',
      'Retain a 100g sample from each blend output for QC.',
    ],
    warnings: [
      'Never add a component without weighing it first.',
      'Drum must be cleaned between different product types or variants.',
    ],
  },
  {
    id: 'pasteuriser', name: 'Pasteuriser', code: 'PR',
    color: 'bg-red-500', role: 'production',
    intro: 'The Pasteuriser is the final processing step before packaging. Four sign-offs are required.',
    steps: [
      { step: 1, title: 'Pre-start checks', detail: 'Confirm product temperature. Check hopper setting and plate size from job card.' },
      { step: 2, title: 'Debagging station', detail: 'Serial number, lot, product type, variant, kg nett for each input bag.' },
      { step: 3, title: 'Bagging station outputs', detail: 'Serial number, lot, product type, variant, kg, and bagging time for each output bag.' },
      { step: 4, title: 'Debagging summary', detail: 'Total input by product type. Cross-check against the debagging table.' },
      { step: 5, title: 'Mass balance', detail: 'A (input) − B (output) = E. Target under 15 kg.' },
      { step: 6, title: 'Sign off', detail: 'Four signatures required: Production Coordinator, Production Supervisor, Quality Officer, Production Manager.' },
    ],
    tips: [
      'Bagging time must be recorded for each bag — links to the chart recorder log.',
      'Lot number on output bags must match the job card batch number exactly.',
    ],
    warnings: [
      'Four sign-offs are required — missing any one means the session cannot be approved.',
      'Temperature readings outside spec must be recorded as a non-conformance.',
    ],
  },
]

function GuideCard({ guide }: { guide: SectionGuide }) {
  const [open, setOpen]         = useState(false)
  const [activeStep, setActive] = useState<number | null>(null)

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface transition-colors"
      >
        <div className={`w-10 h-10 rounded-xl ${guide.color} flex items-center justify-center shrink-0`}>
          {guide.id === 'morning-count'
            ? <Warehouse size={18} className="text-white" />
            : <span className="font-mono font-bold text-[10px] text-white">{guide.code}</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[15px] text-text">{guide.name}</div>
          <div className="font-body text-[12px] text-text-muted mt-0.5 line-clamp-1">{guide.intro}</div>
        </div>
        {open ? <ChevronDown size={16} className="text-text-muted shrink-0" /> : <ChevronRight size={16} className="text-text-muted shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-surface-rule space-y-5">
          <p className="font-body text-[13px] text-text-muted leading-relaxed pt-4">{guide.intro}</p>

          <div>
            <div className="font-display font-bold text-[11px] uppercase tracking-wide text-text-muted mb-3 flex items-center gap-2">
              <Layers size={12} /> Step by step
            </div>
            <div className="space-y-2">
              {guide.steps.map(s => (
                <div key={s.step}>
                  <button
                    onClick={() => setActive(activeStep === s.step ? null : s.step)}
                    className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg hover:bg-surface transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-brand/10 text-brand flex items-center justify-center shrink-0">
                      <span className="font-mono font-bold text-[11px]">{s.step}</span>
                    </div>
                    <span className="font-body font-semibold text-[13px] text-text flex-1">{s.title}</span>
                    {activeStep === s.step ? <ChevronDown size={13} className="text-text-muted shrink-0" /> : <ChevronRight size={13} className="text-text-muted shrink-0" />}
                  </button>
                  {activeStep === s.step && (
                    <div className="ml-10 mt-1 px-4 py-3 bg-surface rounded-lg font-body text-[13px] text-text-muted leading-relaxed">
                      {s.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="font-display font-bold text-[11px] uppercase tracking-wide text-ok mb-3 flex items-center gap-2">
              <CheckCircle size={12} /> Tips
            </div>
            <ul className="space-y-2">
              {guide.tips.map((t, i) => (
                <li key={i} className="flex gap-2.5 font-body text-[13px] text-text-muted leading-relaxed">
                  <span className="text-ok mt-0.5 shrink-0">·</span>{t}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="font-display font-bold text-[11px] uppercase tracking-wide text-warn mb-3 flex items-center gap-2">
              <AlertTriangle size={12} /> Watch out for
            </div>
            <ul className="space-y-2">
              {guide.warnings.map((w, i) => (
                <li key={i} className="flex gap-2.5 font-body text-[13px] text-text-muted leading-relaxed">
                  <span className="text-warn mt-0.5 shrink-0">·</span>{w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export default function InfoPage() {
  const warehouseGuides  = GUIDES.filter(g => g.role === 'warehouse')
  const productionGuides = GUIDES.filter(g => g.role === 'production')

  return (
    <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <BookOpen size={20} className="text-brand" />
        <div>
          <h1 className="font-display font-bold text-[22px] text-text">Section info</h1>
          <p className="font-body text-[13px] text-text-muted">Step-by-step guides. Tap a section to expand.</p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Warehouse size={14} className="text-brand" />
          <span className="font-display font-bold text-[12px] text-text uppercase tracking-wide">Warehouse Supervisor</span>
        </div>
        <div className="space-y-3">
          {warehouseGuides.map(g => <GuideCard key={g.id} guide={g} />)}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Layers size={14} className="text-text-muted" />
          <span className="font-display font-bold text-[12px] text-text uppercase tracking-wide">Production Sections</span>
        </div>
        <div className="space-y-3">
          {productionGuides.map(g => <GuideCard key={g.id} guide={g} />)}
        </div>
      </div>
    </div>
  )
}
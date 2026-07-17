'use client'

// app/(app)/stock-control/page.tsx
//
// Stock Control (Operations) — container for stock-control modules. Printers is
// the first module; more can be added to MODULES over time. Route access is
// gated in app/(app)/layout.tsx (Production + Management).

import { useState } from 'react'
import { Printer } from 'lucide-react'
import PrintersModule from '@/components/stock-control/PrintersModule'

const MODULES = [
  { id: 'printers', label: 'Printers', Icon: Printer, Component: PrintersModule },
] as const

export default function StockControlPage() {
  const [active, setActive] = useState<(typeof MODULES)[number]['id']>('printers')
  const Active = MODULES.find(m => m.id === active)!.Component

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-6">
        {/* Module nav */}
        <nav className="sm:w-52 shrink-0 flex sm:flex-col gap-1">
          {MODULES.map(m => {
            const on = m.id === active
            return (
              <button
                key={m.id}
                onClick={() => setActive(m.id)}
                className={`flex items-center gap-2 text-left rounded-xl px-3 py-2 text-[14px] transition-colors ${
                  on ? 'bg-brand text-white font-semibold' : 'text-text-muted hover:bg-surface-card hover:text-text'
                }`}
              >
                <m.Icon size={16} /> {m.label}
              </button>
            )
          })}
        </nav>

        {/* Active module */}
        <div className="flex-1 min-w-0">
          <Active />
        </div>
      </div>
    </div>
  )
}

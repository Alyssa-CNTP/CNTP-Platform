'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { format, subMonths } from 'date-fns'
import ProductionOrderMaintenance from '@/components/management/ProductionOrderMaintenance'
import OperationalTrends          from '@/components/management/OperationalTrends'

const TABS = [
  {
    key:   'orders',
    label: 'Production Order Maintenance',
    desc:  'Acumatica order refs · session capture · approval status',
  },
  {
    key:   'trends',
    label: 'Operational Trends',
    desc:  'Yield · count reliability · inventory velocity',
  },
] as const

export default function ProductionOperationsPage() {
  const { canAccessManagement } = useAuth()
  const [tab, setTab] = useState<'orders' | 'trends'>('orders')

  const dateFrom = format(subMonths(new Date(), 6), 'yyyy-MM-dd')
  const dateTo   = format(new Date(), 'yyyy-MM-dd')

  if (!canAccessManagement) {
    return (
      <div className="flex items-center justify-center min-h-full font-mono text-[12px] text-text-muted">
        Access restricted — Management only
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-0 border-b border-surface-rule bg-surface-card">
        <div className="max-w-6xl">
          <h2 className="font-display font-extrabold text-2xl text-text tracking-tight">Production Control</h2>
          <p className="text-[12px] text-text-muted mt-0.5">Blackheath · Order maintenance &amp; operational analytics</p>
        </div>

        {/* Module tabs */}
        <div className="flex gap-0 mt-5 -mb-px max-w-6xl">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                'px-5 py-2.5 font-display font-bold text-[13px] border-b-2 transition-colors whitespace-nowrap text-left',
                tab === t.key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-text-muted hover:text-text',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 max-w-6xl w-full">
        <div className="mb-4">
          <p className="text-[12px] text-text-muted">
            {TABS.find(t => t.key === tab)?.desc}
          </p>
        </div>

        {tab === 'orders' && <ProductionOrderMaintenance />}
        {tab === 'trends' && <OperationalTrends dateFrom={dateFrom} dateTo={dateTo} />}
      </div>
    </div>
  )
}

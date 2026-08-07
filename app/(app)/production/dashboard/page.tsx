'use client'

// Production dashboard — a filterable pivot/grid tool grouped by domain
// (Floor / Quality / Machine / Supply & demand / Solar), not a stacked
// report. Replaces the previous widget-stack dashboard (ProductionDashboard)
// per the 2026-08 redesign: aggregates + totals + a chart per domain, your
// own filters (date/shift/line/variant), drill-in via Needs action and the
// AI Analyst rather than scrolling the entire shift report.

import { ProductionTabs } from '@/components/production/ProductionTabs'
import PivotDashboard from '@/components/production/PivotDashboard'

export default function ProductionDashboardPage() {
  return (
    <div className="px-4 pt-5 pb-10 max-w-[1400px] mx-auto">
      <div className="mb-5"><ProductionTabs /></div>
      <PivotDashboard />
    </div>
  )
}

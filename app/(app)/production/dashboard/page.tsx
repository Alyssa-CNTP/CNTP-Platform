'use client'

// Production dashboard — the production manager's live cockpit. Real KPIs and
// interactive charts driven by the structured capture tables, plus factory
// weather, solar, open breakdowns and a Gemini analyst. Replaces the previous
// blank editable-widget board, which pulled no live data.

import { ProductionTabs } from '@/components/production/ProductionTabs'
import ProductionDashboard from '@/components/production/ProductionDashboard'

export default function ProductionDashboardPage() {
  return (
    <div className="px-4 pt-5 pb-10 max-w-[1400px] mx-auto">
      <div className="mb-5"><ProductionTabs /></div>
      <ProductionDashboard />
    </div>
  )
}

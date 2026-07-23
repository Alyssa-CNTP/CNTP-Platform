'use client'

// Production → Yield & Batch Analytics. The deep, interactive report built on the
// canonical batch spine + reporting views (20260721_002/003): output mix, yield
// trends, machine-parameter correlation, and batch-level links to quality.
// Distinct from the live Dashboard cockpit — this is the analysis surface.

import { ProductionTabs } from '@/components/production/ProductionTabs'
import YieldAnalytics from '@/components/production/YieldAnalytics'

export default function ProductionAnalyticsPage() {
  return (
    <div className="px-4 pt-5 pb-10 max-w-[1400px] mx-auto">
      <div className="mb-5"><ProductionTabs /></div>
      <YieldAnalytics />
    </div>
  )
}

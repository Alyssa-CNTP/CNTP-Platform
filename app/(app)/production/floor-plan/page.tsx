'use client'

// Production → Floor Plan. The accurate, dimensioned civil floor plan (storage
// bays to scale with capacities + live activity). The pretty isometric version
// lives on the home page.

import { ProductionTabs } from '@/components/production/ProductionTabs'
import { FactoryFloorPlan } from '@/components/production/FactoryFloorPlan'

export default function ProductionFloorPlanPage() {
  return (
    <div className="px-4 pt-5 pb-10 max-w-[1400px] mx-auto">
      <div className="mb-5"><ProductionTabs /></div>
      <FactoryFloorPlan />
    </div>
  )
}

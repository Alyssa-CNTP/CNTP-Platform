'use client'

// Production → Energy. Solar/grid usage today plus history — moved here from
// its previous spot embedded in the main dashboard, which duplicated it
// alongside the (also since-removed) embedded floor plan.

import { ProductionTabs } from '@/components/production/ProductionTabs'
import { EnergyWidget } from '@/components/maintenance/EnergyWidget'

export default function ProductionEnergyPage() {
  return (
    <div className="px-4 pt-5 pb-10 max-w-[1400px] mx-auto">
      <div className="mb-5"><ProductionTabs /></div>
      <EnergyWidget />
    </div>
  )
}

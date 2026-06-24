'use client'

// Production dashboard — the first department dashboard built on the editable
// dashboard engine (lib/dashboard + components/dashboard/editable). Users arrange
// their own widgets; layouts persist per-user in shared.dashboard_layouts, with a
// code-defined default for anyone who hasn't customized.

import EditableDashboard from '@/components/dashboard/editable/EditableDashboard'
import { ProductionTabs } from '@/components/production/ProductionTabs'

export default function ProductionDashboardPage() {
  return (
    <div>
      <div className="px-4 pt-5 max-w-[1400px]"><ProductionTabs /></div>
      <EditableDashboard
        dashboardKey="production"
        title="Production Dashboard"
      />
    </div>
  )
}

'use client'

// Production dashboard — the first department dashboard built on the editable
// dashboard engine (lib/dashboard + components/dashboard/editable). Users arrange
// their own widgets; layouts persist per-user in shared.dashboard_layouts, with a
// code-defined default for anyone who hasn't customized.

import EditableDashboard from '@/components/dashboard/editable/EditableDashboard'

export default function ProductionDashboardPage() {
  return (
    <EditableDashboard
      dashboardKey="production"
      title="Production Dashboard"
    />
  )
}

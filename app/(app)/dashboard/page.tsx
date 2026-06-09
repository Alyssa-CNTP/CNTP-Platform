'use client'

// Dashboard router
//   section_operator  → redirected at root page.tsx (never reaches here)
//   everyone else     → Command Centre (role/permission filtering is internal)
//
// The old operator/supervisor dashboards are preserved at their paths
// but are no longer the landing page.

import CommandCentre from '@/components/dashboard/CommandCentre'

export default function DashboardPage() {
  return <CommandCentre />
}

'use client'

import { useAuth } from '@/lib/auth/context'
import AdminDashboard           from './admin/page'
import WarehouseSupervisorDashboard from './supervisor/page'
import FactorySupervisorDashboard   from './operator/page'

// Role → Dashboard:
//   admin       → Admin analytics dashboard
//   supervisor  → Warehouse supervisor (morning count + production summary)
//   operator    → Factory supervisor (all sections live, sign-off)
//   section_operator → Never reaches here (redirected to their section in root page)

export default function DashboardPage() {
  const { role } = useAuth()
  if (role === 'supervisor') return <WarehouseSupervisorDashboard />
  if (role === 'operator')   return <FactorySupervisorDashboard />
  return <AdminDashboard />
}
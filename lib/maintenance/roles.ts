// lib/maintenance/roles.ts
// Derive the maintenance role flags from the REAL auth context.
// Replaces the old mock view-switcher.

export interface MaintRole {
  canManage: boolean
  isTech: boolean
  isQc: boolean
  isRaiser: boolean
  actorName: string
}

// Accepts the object returned by useAuth(). Typed loosely so we don't couple to
// the full AuthContextValue shape.
interface AuthLike {
  isFullAdmin?: boolean
  isManagement?: boolean
  isQuality?: boolean
  role?: string | null
  displayName?: string
}

export function deriveMaintRole(auth: AuthLike): MaintRole {
  const canManage = !!(auth.isFullAdmin || auth.isManagement || auth.role === 'maintenance_manager')
  const isTech = auth.role === 'maintenance_technician'
  const isQc = !!(auth.isQuality || auth.role === 'maintenance_qc')
  const isRaiser = true // any signed-in user can raise a job card
  const actorName = auth.displayName ?? ''
  return { canManage, isTech, isQc, isRaiser, actorName }
}

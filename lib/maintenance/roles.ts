// lib/maintenance/roles.ts
// Derive the maintenance role flags from the REAL auth context.
// Replaces the old mock view-switcher.

export interface MaintRole {
  canManage: boolean
  isTech: boolean
  isQc: boolean
  isRaiser: boolean
  actorName: string
  // Oversight profiles (IT / full admin / Management / the maintenance manager
  // / the production manager) see EVERY panel at once — manager board, the
  // technician view, the QC queue and the raiser dashboard — instead of being
  // shown only the one matching their own role. This is a VIEW concern only:
  // what they may *do* inside a card is still governed by canManage/isTech/isQc,
  // so the allocate → QC → originator → manager sign-off chain is unchanged.
  seesAll: boolean
}

// Accepts the object returned by useAuth(). Typed loosely so we don't couple to
// the full AuthContextValue shape.
interface AuthLike {
  isFullAdmin?: boolean
  isManagement?: boolean
  isQuality?: boolean
  isIT?: boolean
  role?: string | null
  displayName?: string
}

export function deriveMaintRole(auth: AuthLike): MaintRole {
  const canManage = !!(auth.isFullAdmin || auth.isManagement || auth.isIT || auth.role === 'maintenance_manager')
  const isTech = auth.role === 'maintenance_technician'
  const isQc = !!(auth.isQuality || auth.role === 'maintenance_qc')
  const isRaiser = true // any signed-in user can raise a job card
  // The production manager oversees the lines maintenance works on, so they get
  // the full read view. Scoped to the ROLE, not the whole Production department —
  // operators must not inherit manager-level visibility.
  const seesAll = canManage || auth.role === 'production_manager'
  const actorName = auth.displayName ?? ''
  return { canManage, isTech, isQc, isRaiser, actorName, seesAll }
}

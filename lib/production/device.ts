/**
 * Lightweight per-tablet device binding (testing aid).
 *
 * Binds a physical tablet to a SECTION (machine) or to the SUPERVISOR role —
 * NOT to a person — so the tablet opens straight to the right screen. Stored in
 * the browser's localStorage, so it's per-device and survives reloads. Operator
 * identity for sign-off still comes from the PIN entered (kept for the audit
 * trail); this only controls where the tablet lands.
 */
export type DeviceBinding =
  | { kind: 'section'; sectionId: string }
  | { kind: 'supervisor' }

const KEY = 'cntp_device_binding'

export function getDeviceBinding(): DeviceBinding | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (v?.kind === 'section' && typeof v.sectionId === 'string') return v
    if (v?.kind === 'supervisor') return v
    return null
  } catch { return null }
}

export function setDeviceBinding(b: DeviceBinding): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(KEY, JSON.stringify(b)) } catch { /* ignore */ }
}

export function clearDeviceBinding(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(KEY) } catch { /* ignore */ }
}

import { redirect } from 'next/navigation'

// Retired. The legacy guided capture flow has been superseded by the unified
// capture flow at /production/capture (see CHANGELOG 2026-06-24).
export default function RetiredFlow() {
  redirect('/production/capture')
}

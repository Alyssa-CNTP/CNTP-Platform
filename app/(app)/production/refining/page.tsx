import { redirect } from 'next/navigation'

// Retired. The legacy Refining 1/2 capture form has been superseded by the
// unified capture flow at /production/capture (see CHANGELOG 2026-06-24).
export default function RetiredRefining() {
  redirect('/production/capture')
}

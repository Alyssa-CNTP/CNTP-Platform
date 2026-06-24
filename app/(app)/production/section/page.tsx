import { redirect } from 'next/navigation'

// Retired. The legacy per-section capture form has been superseded by the
// unified capture flow at /production/capture (see CHANGELOG 2026-06-24).
// Any old links / bookmarks land on the new capture hub.
export default function RetiredSectionCapture() {
  redirect('/production/capture')
}

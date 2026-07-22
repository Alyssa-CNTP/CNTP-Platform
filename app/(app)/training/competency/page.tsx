import { redirect } from 'next/navigation'

// Merged into the Skills Matrix's "Overview" tab — see
// app/(app)/training/skills/page.tsx.
export default function CompetencyDashboardRedirect() {
  redirect('/training/skills')
}

// Command Centre has been retired — its live tiles are covered by the Home page
// and the Production dashboard. /dashboard now redirects to Home so old links and
// bookmarks keep working.
import { redirect } from 'next/navigation'

export default function DashboardPage() {
  redirect('/home')
}

import { redirect } from 'next/navigation'

// Timesheets moved onto the Team tab, next to the capture ratings — hours and
// scores are two views of the same subject, and the hub was a tab wider than it
// needed to be. Kept as a redirect so existing links and bookmarks still land in
// the right place.
export default function SupervisorTimesheetsRedirect() {
  redirect('/supervisor/team?view=timesheets')
}

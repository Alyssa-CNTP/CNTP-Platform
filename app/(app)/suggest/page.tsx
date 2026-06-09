// app/(app)/suggest/page.tsx
// Legacy route — Suggestions is now a tab inside /axis/request.
// Redirect old bookmarks to the suggestion tab.

import { redirect } from 'next/navigation'

export default function SuggestRedirect() {
  redirect('/axis/request?tab=suggestion')
}

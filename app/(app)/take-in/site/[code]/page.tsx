'use client'

// app/(app)/take-in/site/[code]/page.tsx
//
// One site's take-in overview. It is the SAME screen as the all-sites overview
// at /take-in — that screen reads the site code from the route and narrows
// itself, so there is one set of KPIs and one definition of "needs someone"
// rather than two that drift apart.

import TakeInOverview from '../../page'

export default function SiteOverviewPage() {
  return <TakeInOverview />
}

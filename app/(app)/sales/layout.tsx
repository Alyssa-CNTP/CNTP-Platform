'use client'

// app/(app)/sales/layout.tsx
// The app shell (app/(app)/layout.tsx) already renders the sales Topbar via
// ROUTE_META — this is just a passthrough wrapper so /sales sub-routes share it.

import { ReactNode } from 'react'

export default function SalesLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col h-full">{children}</div>
}

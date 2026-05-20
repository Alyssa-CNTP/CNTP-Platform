'use client'

// app/(app)/sales/layout.tsx
// Wraps all /sales routes with the sales-variant topbar.
// This is what was missing — without a layout, sub-routes have no topbar.

import { ReactNode, useState } from 'react'
import Topbar from '@/components/layout/Topbar'

export default function SalesLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <Topbar
        title="Sales Dashboard"
        onMobileMenu={() => setMobileOpen(o => !o)}
        variant="sales"
        ytdRevenue="R70.5M"
        chips={[
          { label: 'JAN–APR 2026', color: 'gray'  },
          { label: 'CONFIDENTIAL', color: 'amber' },
        ]}
      />
      {children}
    </div>
  )
}
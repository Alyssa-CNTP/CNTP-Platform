'use client'

// app/(app)/maintenance/layout.tsx
// Mounts useMaintenanceData() once in a React context so every maintenance
// sub-route shares one data load. This preserves cross-tab optimistic updates
// (e.g. logSpare on a job card decrementing the Stock & Spares register).

import { createContext, useContext } from 'react'
import { useMaintenanceData, type MaintenanceData } from '@/lib/maintenance/useMaintenanceData'

const MaintenanceDataContext = createContext<MaintenanceData | null>(null)

export function useMaintenanceContext(): MaintenanceData {
  const ctx = useContext(MaintenanceDataContext)
  if (!ctx) throw new Error('useMaintenanceContext must be used inside the maintenance layout')
  return ctx
}

export default function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  const value = useMaintenanceData()
  const { popup, setPopup } = value.ui
  return (
    <MaintenanceDataContext.Provider value={value}>
      {children}

      {/* Shared popup modal — token-styled */}
      {popup && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setPopup(null)}>
          <div className="card p-5 w-[420px] max-w-[90vw] whitespace-pre-wrap" onClick={e => e.stopPropagation()}>
            <div className="text-[13px] leading-relaxed text-text">{popup}</div>
            <button className="mt-3 bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-semibold" onClick={() => setPopup(null)}>Close</button>
          </div>
        </div>
      )}
    </MaintenanceDataContext.Provider>
  )
}

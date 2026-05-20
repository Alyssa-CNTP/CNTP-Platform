'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { format } from 'date-fns'

function currentShift(): 'morning' | 'night' {
  const h = new Date().getHours()
  return h >= 5 && h < 17 ? 'morning' : 'night'
}

export default function RootPage() {
  const { user, role, sectionId, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login')
      return
    }

    if (role === 'section_operator' && sectionId) {
      // Section logins land directly on their capture form — no dashboard
      const today = format(new Date(), 'yyyy-MM-dd')
      const shift = currentShift()
      router.replace(`/production/section?id=${sectionId}&shift=${shift}&date=${today}`)
      return
    }

    // All other roles go to their dashboard
    router.replace('/dashboard')
  }, [user, role, sectionId, loading, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand">
      <div className="font-display font-extrabold text-[28px] text-white tracking-[4px] uppercase animate-pulse">
        CNTP · Ops
      </div>
    </div>
  )
}
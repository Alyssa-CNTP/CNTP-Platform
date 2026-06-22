'use client'
// app/page.tsx — Root route. Redirects to /dashboard if signed in, otherwise /login.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getDefaultRoute } from '@/lib/auth/departments'

export default function RootPage() {
  const { user, loading, department, role, permissionsReady } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/login'); return }
    if (permissionsReady) router.replace(getDefaultRoute(department ?? '', role))
  }, [user, loading, department, role, permissionsReady, router])

  return null
}

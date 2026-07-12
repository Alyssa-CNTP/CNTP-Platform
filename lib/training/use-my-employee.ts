'use client'

import { useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'

// Resolves the Staff Directory person behind the signed-in session, via the
// soft link added in 20260709_001_people_links.sql (shared.app_roles.employee_id).
// Every login — office account or PIN-operator — gets this link.
export function useMyEmployee(userId: string | null) {
  const [employeeId, setEmployeeId]     = useState<string | null>(null)
  const [employeeName, setEmployeeName] = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    if (!userId) { setEmployeeId(null); setEmployeeName(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    getDb().schema('shared').from('app_roles').select('employee_id').eq('user_id', userId).maybeSingle()
      .then(async ({ data }: any) => {
        if (cancelled) return
        const empId = data?.employee_id ?? null
        setEmployeeId(empId)
        if (empId) {
          const { data: emp } = await getDb().schema('production').from('employees').select('name,display_name').eq('id', empId).maybeSingle()
          if (!cancelled) setEmployeeName(emp?.display_name || emp?.name || null)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [userId])

  return { employeeId, employeeName, loading }
}

// lib/hooks/useQcNames.ts
//
// Names for the QC-name autocomplete used across Quality (sieving,
// pasteuriser, granule). Single source of truth: production.employees,
// department='qc' — the same staff directory the shift roster reads from.

import { useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'

export function useQcNames(): string[] {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    getDb().schema('production').from('employees')
      .select('name,display_name')
      .eq('active', true).eq('department', 'qc')
      .order('name')
      .then(({ data }: { data: any[] | null }) => {
        setNames((data ?? []).map((e: any) => e.display_name || e.name).filter(Boolean))
      })
  }, [])

  return names
}

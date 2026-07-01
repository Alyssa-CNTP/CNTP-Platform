// lib/hooks/useQcNames.ts
//
// Names for the QC-name autocomplete used across Quality (sieving,
// pasteuriser, granule). Single source of truth: the shift roster's
// "Quality" (qc) category — production.roster_entries for role keys
// belonging to the qc category — so the dropdown always matches whoever
// is actually rostered onto QC/QC Supervisor/Lab Analyst/Incoming Goods
// QC roles, day or night shift.

import { useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { ROSTER_ROLE_SEED } from '@/lib/production/roster-config'

const FALLBACK_QC_ROLE_KEYS = ROSTER_ROLE_SEED.filter(r => r.category === 'qc').map(r => r.key)

export function useQcNames(): string[] {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    (async () => {
      const db = getDb().schema('production')
      let qcRoleKeys = FALLBACK_QC_ROLE_KEYS
      try {
        const { data, error } = await db.from('roster_roles').select('key,category').eq('category', 'qc')
        if (error) throw error
        if (data?.length) qcRoleKeys = data.map((r: any) => r.key)
      } catch { /* use fallback */ }

      const { data } = await db.from('roster_entries')
        .select('person_name,role_key')
        .in('role_key', qcRoleKeys)

      const uniq = Array.from(new Set(
        ((data as any[]) ?? []).map(e => (e.person_name || '').trim()).filter(Boolean)
      )).sort((a, b) => a.localeCompare(b))
      setNames(uniq)
    })()
  }, [])

  return names
}

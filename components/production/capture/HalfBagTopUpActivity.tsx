'use client'

// components/production/capture/HalfBagTopUpActivity.tsx
//
// Half-bag Top-up is a deliberate side-channel write (never touches a
// session's draft_data/value.outputs — see HalfBagTopUpModal), which means
// it's otherwise invisible on the capture page: an operator watching that
// screen would see no sign a top-up ever happened. This is a read-only
// activity list, scoped to the CURRENT session, so it's visible right where
// the operator is already looking, without touching the mass-balance-
// sensitive write path at all. (Overview folds the same events into each
// bag's own row instead of a separate panel — see CaptureOverview.)

import { useEffect, useState } from 'react'
import { Scale } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { fetchTopUpEventsForSession, type TopUpEvent } from '@/lib/production/scan-utils'

interface ActivityRow extends TopUpEvent {
  productType: string | null
  variant: string | null
}

export function HalfBagTopUpActivity({ sectionId, sessionId }: { sectionId: string; sessionId: string | null }) {
  const [rows, setRows] = useState<ActivityRow[]>([])

  useEffect(() => {
    if (!sessionId) { setRows([]); return }
    let cancelled = false
    ;(async () => {
      const bySerial = await fetchTopUpEventsForSession(sectionId, sessionId)
      const events = Array.from(bySerial.values()).flat().sort((a, b) => b.at.localeCompare(a.at))
      if (!events.length) { if (!cancelled) setRows([]); return }

      const serials = Array.from(new Set(events.map(e => e.serial)))
      const { data: tags } = await getDb().schema('production').from('bag_tags')
        .select('serial_number, product_type, variant').in('serial_number', serials)
      const tagBySerial = new Map(((tags as any[]) ?? []).map((t: any) => [t.serial_number, t]))

      const out: ActivityRow[] = events.map(e => {
        const tag = tagBySerial.get(e.serial)
        return { ...e, productType: tag?.product_type ?? null, variant: tag?.variant ?? null }
      })
      if (!cancelled) setRows(out)
    })()
    return () => { cancelled = true }
  }, [sectionId, sessionId])

  if (!rows.length) return null

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-100 bg-violet-50">
        <Scale size={14} className="text-violet-600" />
        <span className="font-semibold text-[13px] text-violet-700 flex-1">Half-bag top-ups this shift</span>
        <span className="font-mono text-[11px] text-violet-500">{rows.length}</span>
      </div>
      <ul className="divide-y divide-violet-100/70">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2 px-4 py-2 text-[12.5px] flex-wrap">
            <span className="font-mono text-text shrink-0">{r.serial}</span>
            <span className="text-text-muted truncate">{r.productType}{r.variant ? ` · ${r.variant}` : ''}</span>
            <span className="font-mono text-text-muted shrink-0 ml-auto">+{r.kg.toFixed(1)}kg</span>
            <span className="text-[11px] text-violet-600 shrink-0">
              {r.mode === 'production'
                ? (r.sourceOrBatch ? `today's production · ${r.sourceOrBatch}` : "today's production")
                : `from ${r.sourceOrBatch}`}
            </span>
            <span className="text-[10px] text-text-faint shrink-0">{new Date(r.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

'use client'

// components/production/capture/HalfBagTopUpActivity.tsx
//
// Half-bag Top-up is a deliberate side-channel write (never touches a
// session's draft_data/value.outputs — see HalfBagTopUpModal), which means
// it's otherwise invisible on the capture page and Overview: an operator or
// supervisor watching that screen would see no sign a top-up ever happened.
// This is a read-only activity list, scoped to the CURRENT session, so it's
// visible right where the operator is already looking, without touching the
// mass-balance-sensitive write path at all.
//
// Distinguishing a top-up event from an ordinary bag's own first-ever
// scan_events row:
//   - "From another bag" mode logs a distinct 'topped_up' action — never
//     ambiguous with anything else.
//   - "From today's production" mode logs a plain 'bagging_out' row (so it
//     counts toward today's output the same way a brand-new bag would), but
//     addFreshWeightToBag always marks its `notes` with the HALF_BAG_TOPUP
//     prefix — that's what separates it here from a normal new bag.

import { useEffect, useState } from 'react'
import { Scale } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'

interface ActivityRow {
  serial: string
  productType: string | null
  variant: string | null
  kg: number
  mode: 'production' | 'existing'
  sourceOrBatch: string | null
  at: string
}

export function HalfBagTopUpActivity({ sectionId, sessionId }: { sectionId: string; sessionId: string | null }) {
  const [rows, setRows] = useState<ActivityRow[]>([])

  useEffect(() => {
    if (!sessionId) { setRows([]); return }
    let cancelled = false
    ;(async () => {
      const { data } = await getDb().schema('production').from('scan_events')
        .select('serial_number, action, related_serial_number, weight_kg, notes, scanned_at')
        .eq('section_id', sectionId).eq('session_id', sessionId)
        .in('action', ['topped_up', 'bagging_out'])
        .order('scanned_at', { ascending: false })

      const qualifying = ((data as any[]) ?? []).filter(r =>
        r.action === 'topped_up' || (r.action === 'bagging_out' && String(r.notes ?? '').startsWith('HALF_BAG_TOPUP')))
      if (!qualifying.length) { if (!cancelled) setRows([]); return }

      const serials = Array.from(new Set(qualifying.map((r: any) => r.serial_number)))
      const { data: tags } = await getDb().schema('production').from('bag_tags')
        .select('serial_number, product_type, variant').in('serial_number', serials)
      const tagBySerial = new Map(((tags as any[]) ?? []).map((t: any) => [t.serial_number, t]))

      const out: ActivityRow[] = qualifying.map((r: any) => {
        const tag = tagBySerial.get(r.serial_number)
        const m = /^HALF_BAG_TOPUP:\s*(.+)$/.exec(String(r.notes ?? '').trim())
        return {
          serial: r.serial_number, productType: tag?.product_type ?? null, variant: tag?.variant ?? null,
          kg: Number(r.weight_kg) || 0, mode: r.action === 'topped_up' ? 'existing' : 'production',
          sourceOrBatch: r.action === 'topped_up' ? r.related_serial_number : (m ? m[1] : null),
          at: r.scanned_at,
        }
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

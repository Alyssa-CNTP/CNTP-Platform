'use client'

/**
 * BatchSelectModal — Task 4: Closed-loop batch selection
 * ─────────────────────────────────────────────────────────────────────────────
 * When an operator opens a debagging form, instead of typing batch numbers
 * from scratch, this modal queries prod_bagging for outputs produced in the
 * last 7 days that could be inputs for this section.
 *
 * THE FLOW LOGIC
 * Each section has known "input types" that come from specific prior sections.
 * e.g. Refining inputs sticks and dust that come from Sieving outputs.
 * We use this map to query only relevant recent batches.
 *
 * The operator can:
 *   A) Tap a recent batch → pre-fills lot_number, bag_serial_no, product_type, variant
 *   B) Tap "Enter manually" → opens the BatchKeypad for free-text entry
 *
 * This eliminates transcription errors — data entered at the point of
 * production flows forward automatically.
 */

import { useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import BottomSheet from '@/components/ui/BottomSheet'
import { format, subDays } from 'date-fns'
import { Package, ArrowRight, PenLine, Clock, Loader2, Database } from 'lucide-react'
import clsx from 'clsx'

// ── SECTION INPUT MAP ─────────────────────────────────────────────────────────
// Maps a section to the upstream sections whose outputs it consumes as inputs.
// This narrows the search to only relevant recent batches.
const SECTION_INPUTS: Record<string, string[]> = {
  ref1:  ['sieve'],           // Refining 1 takes Sieving outputs
  ref2:  ['sieve', 'ref1'],   // Refining 2 takes Sieving + Refining 1 outputs
  gran:  ['ref1', 'ref2'],    // Granule line takes Refining outputs
  blend: ['ref1', 'ref2', 'sieve'],
  past:  ['blend'],
  // Sieve has no upstream in this system
}

// ── TYPES ──────────────────────────────────────────────────────────────────────
export interface RecentBatch {
  id:           string   // prod_bagging.id
  session_id:   string
  bag_serial_no: string
  lot_number:   string
  product_type: string
  variant:      string
  kg:           number
  output_group: string
  bagging_date: string   // date of the session
  section_name: string
}

interface Props {
  open:       boolean
  sectionId:  string   // the section that's doing the debagging
  onSelect:   (batch: RecentBatch) => void
  onManual:   () => void
  onClose:    () => void
}

// ── COMPONENT ──────────────────────────────────────────────────────────────────
export default function BatchSelectModal({ open, sectionId, onSelect, onManual, onClose }: Props) {
  const db = getDb()
  const [batches, setBatches] = useState<RecentBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (open) loadRecentBatches()
  }, [open, sectionId])

  async function loadRecentBatches() {
    setLoading(true)
    setError(null)

    const upstreamSections = SECTION_INPUTS[sectionId] ?? []
    const since = format(subDays(new Date(), 7), 'yyyy-MM-dd')

    try {
      // Join prod_bagging → prod_sessions to get the date and section
      const { data, error: err } = await db
        .from('prod_bagging')
        .select(`
          id,
          session_id,
          bag_serial_no,
          lot_number,
          product_type,
          variant,
          kg,
          output_group,
          prod_sessions!inner (
            date,
            section_id,
            section_name
          )
        `)
        .gte('prod_sessions.date', since)
        .in(
          'prod_sessions.section_id',
          upstreamSections.length ? upstreamSections : ['__none__']
        )
        .order('created_at', { ascending: false })
        .limit(50)

      if (err) {
        setError(err.message)
        setBatches([])
      } else {
        const rows = (data ?? []) as any[]
        setBatches(rows.map(row => ({
          id:           row.id,
          session_id:   row.session_id,
          bag_serial_no: row.bag_serial_no ?? '',
          lot_number:   row.lot_number ?? '',
          product_type: row.product_type ?? '',
          variant:      row.variant ?? '',
          kg:           row.kg ?? 0,
          output_group: row.output_group,
          bagging_date: row.prod_sessions?.date ?? '',
          section_name: row.prod_sessions?.section_name ?? '',
        })))
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Group batches by date for display
  const byDate: Record<string, RecentBatch[]> = {}
  for (const b of batches) {
    const key = b.bagging_date
    if (!byDate[key]) byDate[key] = []
    byDate[key].push(b)
  }
  const dates = Object.keys(byDate).sort().reverse()

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="p-4 space-y-4">

        {/* Header */}
        <div className="flex items-center gap-2">
          <Database size={18} className="text-accent" />
          <span className="font-display font-bold text-[17px] text-text">Select recent batch</span>
          <span className="font-mono text-[9px] bg-surface-rule text-text-muted px-2 py-0.5 rounded uppercase tracking-wide ml-auto">
            last 7 days
          </span>
        </div>

        {/* What we're searching */}
        {SECTION_INPUTS[sectionId]?.length ? (
          <p className="text-xs text-text-muted">
            Showing outputs from:{' '}
            <span className="font-semibold text-text">
              {SECTION_INPUTS[sectionId].join(', ')}
            </span>
            {' '}that are ready to debag here.
          </p>
        ) : (
          <p className="text-xs text-text-muted">
            No upstream sections configured — showing all recent outputs.
          </p>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-text-muted">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading recent batches…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-status-error bg-err-bg border border-err/30 rounded-xl p-3">
            {error}
          </div>
        )}

        {/* Results */}
        {!loading && !error && batches.length > 0 && (
          <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-3">
            {dates.map(date => (
              <div key={date}>
                <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1.5 px-1">
                  {format(new Date(date + 'T12:00:00'), 'EEEE d MMM')}
                </div>
                <div className="space-y-1">
                  {byDate[date].map(b => (
                    <button
                      key={b.id}
                      onClick={() => onSelect(b)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface transition-colors text-left border border-transparent hover:border-surface-rule"
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-ok-bg border border-ok/20 flex items-center justify-center">
                        <Package size={14} className="text-status-ok" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[12px] font-bold text-text truncate">
                          {b.bag_serial_no || b.lot_number || 'No serial'}
                        </div>
                        <div className="text-[11px] text-text-muted truncate">
                          {b.product_type}
                          {b.variant && ` · ${b.variant}`}
                          {' · '}{b.section_name}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono text-[13px] font-bold text-text">{b.kg.toFixed(1)} kg</div>
                        <div className="font-mono text-[9px] text-text-muted">Group {b.output_group}</div>
                      </div>
                      <ArrowRight size={14} className="text-text-faint flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && batches.length === 0 && (
          <div className="text-center py-8">
            <Clock size={28} className="mx-auto mb-2 text-text-faint" />
            <p className="text-sm text-text-muted">No recent batches from upstream sections</p>
            <p className="text-xs text-text-faint mt-1">
              Data will appear here once Sieving and other upstream sections record their outputs.
            </p>
          </div>
        )}

        {/* Manual entry fallback */}
        <button
          onClick={onManual}
          className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-surface-rule rounded-xl font-display font-bold text-[14px] text-text-muted hover:text-text hover:border-accent/40 transition-colors"
        >
          <PenLine size={16} />
          Enter batch number manually
        </button>

        <button
          onClick={onClose}
          className="w-full py-2.5 text-sm text-text-muted border border-surface-rule rounded-xl hover:bg-surface transition-colors"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  )
}

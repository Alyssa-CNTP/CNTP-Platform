'use client'

/**
 * CountCompareView
 * ─────────────────────────────────────────────────────────────────────────────
 * Shown to the admin after they submit their count when a supervisor count also
 * exists for the same date. Displays every item where the two counts differ,
 * with variance in kg highlighted.
 *
 * Data flow:
 *   1. Query sc_entries for session_id where role = 'supervisor'
 *   2. Query sc_entries for session_id where role = 'admin'
 *   3. Build a map by inventory_code + entry_index → {sup_kg, adm_kg}
 *   4. Render three tabs: ALL · VARIANCES ONLY · AGREE
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

// ── TYPES ──────────────────────────────────────────────────────────────────────
interface EntryRow {
  inventory_code: string
  item_name:      string
  section_name:   string
  section_id:     string
  entry_type:     string
  is_no_stock:    boolean
  kg:             number
  boxes:          number
  bags_qty:       number
  paper_bags:     number
  role:           string
  batch_number:   string | null
  entry_index:    number
}

interface CompareLine {
  key:          string   // inventory_code + ':' + entry_index
  inventory_code: string
  item_name:    string
  section_name: string
  section_id:   string
  sup_kg:       number | null   // null = not counted by supervisor
  adm_kg:       number | null   // null = not counted by admin
  sup_ns:       boolean
  adm_ns:       boolean
  variance:     number          // adm - sup (or 0 if either side is missing)
}

type Tab = 'all' | 'diff' | 'match'

interface Props {
  sessionId:  string
  date:       string
  onClose?:   () => void
  onRecount?: (sectionName: string, date: string) => void
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function entryKg(row: EntryRow): number {
  if (row.is_no_stock) return 0
  if (row.entry_type === 'pallet') {
    return (row.boxes * 18) + (row.bags_qty * 18) + (row.paper_bags * 500)
  }
  return row.kg ?? 0
}

function buildKey(row: EntryRow): string {
  return `${row.inventory_code}:${row.entry_index}`
}

// ── COMPONENT ──────────────────────────────────────────────────────────────────
export default function CountCompareView({ sessionId, date, onClose, onRecount: onRecountProp }: Props) {
  const db     = getDb()
  const router = useRouter()

  // Default recount handler — navigate to count page with section pre-opened
  const onRecount = onRecountProp ?? ((sectionName: string, countDate: string) => {
    if (onClose) onClose()
    router.push(`/count?recount=1&section=${encodeURIComponent(sectionName)}&date=${countDate}`)
  })

  const [lines,   setLines]   = useState<CompareLine[]>([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<Tab>('diff')
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({})
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [sessionId])

  async function loadData() {
    setLoading(true)
    setError(null)

    const { data, error: err } = await db
      .from('sc_entries')
      .select(
        'inventory_code, item_name, section_name, section_id, entry_type, is_no_stock, ' +
        'kg, boxes, bags_qty, paper_bags, role, batch_number, entry_index'
      )
      .eq('session_id', sessionId)
      .order('section_id')
      .order('inventory_code')
      .order('entry_index')

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as EntryRow[]
    const supMap = new Map<string, EntryRow>()
    const admMap = new Map<string, EntryRow>()

    for (const row of rows) {
      const k = buildKey(row)
      if (row.role === 'supervisor') supMap.set(k, row)
      else if (row.role === 'admin') admMap.set(k, row)
    }

    // Merge all keys
    const allKeys = new Set([...supMap.keys(), ...admMap.keys()])
    const result: CompareLine[] = []

    for (const k of allKeys) {
      const sup = supMap.get(k)
      const adm = admMap.get(k)
      const supKg = sup ? entryKg(sup) : null
      const admKg = adm ? entryKg(adm) : null
      const variance = (admKg ?? 0) - (supKg ?? 0)

      result.push({
        key:           k,
        inventory_code: (sup ?? adm)!.inventory_code,
        item_name:      (sup ?? adm)!.item_name,
        section_name:   (sup ?? adm)!.section_name,
        section_id:     (sup ?? adm)!.section_id,
        sup_kg:         supKg,
        adm_kg:         admKg,
        sup_ns:         sup?.is_no_stock ?? false,
        adm_ns:         adm?.is_no_stock ?? false,
        variance,
      })
    }

    setLines(result)
    setLoading(false)

    // Auto-open first section that has diffs
    const firstDiffSec = result.find(l => Math.abs(l.variance) > 0 || l.sup_kg === null || l.adm_kg === null)
    if (firstDiffSec) {
      setOpenSec({ [firstDiffSec.section_id]: true })
    }
  }

  // ── Filter by tab ─────────────────────────────────────────────────────────
  const filtered = lines.filter(l => {
    if (tab === 'diff')  return Math.abs(l.variance) > 0 || l.sup_kg === null || l.adm_kg === null
    if (tab === 'match') return Math.abs(l.variance) === 0 && l.sup_kg !== null && l.adm_kg !== null
    return true
  })

  // Group by section
  const sections = [...new Set(filtered.map(l => l.section_id))]
  const sectionNames = Object.fromEntries(lines.map(l => [l.section_id, l.section_name]))

  // Stats
  const diffCount  = lines.filter(l => Math.abs(l.variance) > 0 || l.sup_kg === null || l.adm_kg === null).length
  const matchCount = lines.filter(l => Math.abs(l.variance) === 0 && l.sup_kg !== null && l.adm_kg !== null).length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-text-muted">
        <Loader2 size={20} className="animate-spin" />
        <span className="font-mono text-sm">Loading comparison…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle size={28} className="mx-auto mb-2 text-status-warn" />
        <p className="text-sm text-text-muted">{error}</p>
        <button onClick={loadData} className="mt-3 text-sm text-accent underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="font-display font-extrabold text-xl text-text">Count comparison</h2>
        <p className="font-mono text-[11px] text-text-muted mt-0.5">
          {format(new Date(date + 'T12:00:00'), 'd MMMM yyyy')} · {lines.length} items
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total items',  value: lines.length,  color: 'text-text' },
          { label: 'Variances',    value: diffCount,     color: diffCount > 0 ? 'text-status-warn' : 'text-status-ok' },
          { label: 'In agreement', value: matchCount,    color: 'text-status-ok' },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <div className={clsx('font-display font-extrabold text-2xl', s.color)}>{s.value}</div>
            <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-ok-bg border border-ok/30 inline-block" />
          Supervisor
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-info-bg border border-info/30 inline-block" />
          Admin
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-warn-bg border border-warn/30 inline-block" />
          Variance
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border border-surface-rule rounded-xl overflow-hidden w-fit">
        {([
          { key: 'diff',  label: `Variances (${diffCount})` },
          { key: 'match', label: `Agree (${matchCount})` },
          { key: 'all',   label: `All (${lines.length})` },
        ] as { key: Tab; label: string }[]).map((t, i) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2 font-display font-bold text-[13px] transition-colors',
              i !== 0 && 'border-l border-surface-rule',
              tab === t.key ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Section groups */}
      {sections.length === 0 ? (
        <div className="text-center py-10 text-text-muted">
          <CheckCircle size={28} className="mx-auto mb-2 text-status-ok" />
          <p className="text-sm">No items in this view</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sections.map(secId => {
            const secLines = filtered.filter(l => l.section_id === secId)
            const secName  = sectionNames[secId]
            const isOpen   = openSec[secId] ?? false
            const varCount = secLines.filter(l => Math.abs(l.variance) > 0).length

            return (
              <div key={secId} className="card overflow-hidden">
                <div className="w-full flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setOpenSec(s => ({ ...s, [secId]: !s[secId] }))}
                    className="flex-1 flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                  >
                    <span className="font-display font-bold text-[15px] text-text">{secName}</span>
                    {varCount > 0 && (
                      <span className="font-mono text-[10px] bg-warn-bg text-status-warn border border-warn/30 px-2 py-0.5 rounded-full">
                        {varCount} variance{varCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-text-muted ml-auto">{secLines.length} items</span>
                    {isOpen
                      ? <ChevronDown size={16} className="text-text-muted" />
                      : <ChevronRight size={16} className="text-text-muted" />
                    }
                  </button>
                  {varCount > 0 && onRecount && (
                    <button
                      onClick={() => onRecount(secName, date)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-warn-bg border border-warn/40 text-status-warn rounded-lg font-semibold text-[12px] hover:bg-warn-bg/70 transition-colors"
                    >
                      <RefreshCw size={12} /> Recount
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-surface-rule">
                    {secLines.map(l => (
                      <CompareLine key={l.key} line={l} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── SINGLE COMPARE LINE ───────────────────────────────────────────────────────
function CompareLine({ line }: { line: CompareLine }) {
  const hasDiff = Math.abs(line.variance) > 0 || line.sup_kg === null || line.adm_kg === null
  const missing = line.sup_kg === null || line.adm_kg === null

  return (
    <div className={clsx(
      'flex items-center gap-3 px-4 py-3 border-b border-surface-rule last:border-b-0',
      hasDiff ? 'bg-warn-bg/40' : ''
    )}>
      {/* Item info */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text truncate">{line.item_name}</div>
        <div className="font-mono text-[10px] text-text-muted">{line.inventory_code}</div>
      </div>

      {/* Supervisor value */}
      <div className="text-center w-20">
        <div className={clsx(
          'font-mono text-[12px] font-bold px-2 py-1 rounded-lg',
          line.sup_ns ? 'bg-warn-bg text-status-warn' :
          line.sup_kg === null ? 'text-text-faint' : 'bg-ok-bg text-status-ok'
        )}>
          {line.sup_ns ? 'No stock' : line.sup_kg === null ? '—' : `${Math.round(line.sup_kg)} kg`}
        </div>
        <div className="font-mono text-[9px] text-text-faint mt-0.5">Sup</div>
      </div>

      {/* Admin value */}
      <div className="text-center w-20">
        <div className={clsx(
          'font-mono text-[12px] font-bold px-2 py-1 rounded-lg',
          line.adm_ns ? 'bg-warn-bg text-status-warn' :
          line.adm_kg === null ? 'text-text-faint' : 'bg-info-bg text-status-info'
        )}>
          {line.adm_ns ? 'No stock' : line.adm_kg === null ? '—' : `${Math.round(line.adm_kg)} kg`}
        </div>
        <div className="font-mono text-[9px] text-text-faint mt-0.5">Admin</div>
      </div>

      {/* Variance */}
      <div className="text-right w-16">
        {missing ? (
          <span className="font-mono text-[10px] text-status-warn">missing</span>
        ) : Math.abs(line.variance) < 0.5 ? (
          <CheckCircle size={14} className="text-status-ok ml-auto" />
        ) : (
          <div className={clsx(
            'font-mono text-[12px] font-bold',
            line.variance > 0 ? 'text-status-info' : 'text-status-error'
          )}>
            {line.variance > 0 ? '+' : ''}{Math.round(line.variance)} kg
          </div>
        )}
      </div>
    </div>
  )
}
'use client'

import { useState, useEffect, useRef } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Sparkles, ChevronDown } from 'lucide-react'

interface BatchSuggestionProps {
  inventoryCode: string    // the full Acumatica code e.g. "10LGBLC-C"
  date: string             // yyyy-MM-dd — only show suggestions from THIS date
  currentValue: string
  onSelect: (batch: string) => void
  className?: string
}

interface Suggestion {
  batch: string
  count: number           // how many bags with this batch today
  totalKg: number
}

export default function BatchSuggestion({
  inventoryCode,
  date,
  currentValue,
  onSelect,
  className = '',
}: BatchSuggestionProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen]               = useState(false)
  const [loading, setLoading]         = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Load suggestions for this inventory code on this date
  useEffect(() => {
    if (!inventoryCode) return
    let cancelled = false

    async function fetch() {
      setLoading(true)
      const db = getDb()

      // Query sc_entries for bags with this inventory_code today
      // Group by batch_number, count bags and sum kg
      const { data } = await db
        .from('sc_entries')
        .select('batch_number, kg')
        .eq('inventory_code', inventoryCode)
        .not('batch_number', 'is', null)
        .not('batch_number', 'eq', '')
        .order('created_at', { ascending: false })

      if (cancelled) return

      // Aggregate by batch_number — today's only
      const map: Record<string, Suggestion> = {}
      for (const row of (data as any[]) ?? []) {
        const b = row.batch_number?.trim()
        if (!b) continue
        if (!map[b]) map[b] = { batch: b, count: 0, totalKg: 0 }
        map[b].count++
        map[b].totalKg += row.kg ?? 0
      }

      const list = Object.values(map)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)  // max 5 suggestions

      setSuggestions(list)
      setLoading(false)
    }

    fetch()
    return () => { cancelled = true }
  }, [inventoryCode, date])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (suggestions.length === 0) return null

  // Filter suggestions that don't match current typing
  const filtered = currentValue
    ? suggestions.filter(s => s.batch.toLowerCase().includes(currentValue.toLowerCase()))
    : suggestions

  if (filtered.length === 0) return null

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand/8 border border-brand/20 font-mono text-[10px] text-brand hover:bg-brand/12 transition-colors"
      >
        <Sparkles size={10} />
        {filtered.length} suggestion{filtered.length > 1 ? 's' : ''}
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface-card border border-surface-rule rounded-xl shadow-lg overflow-hidden min-w-[220px]">
          <div className="px-3 py-2 border-b border-surface-rule">
            <span className="font-mono text-[9px] text-text-muted uppercase tracking-wide">
              Today's batches for {inventoryCode}
            </span>
          </div>
          {filtered.map(s => (
            <button
              key={s.batch}
              type="button"
              onClick={() => {
                onSelect(s.batch)
                setOpen(false)
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-surface transition-colors text-left"
            >
              <div>
                <div className="font-mono text-[13px] text-text font-medium">{s.batch}</div>
                <div className="font-mono text-[10px] text-text-muted">
                  {s.count} bag{s.count > 1 ? 's' : ''} · {s.totalKg.toLocaleString('en-ZA', { maximumFractionDigits: 1 })} kg
                </div>
              </div>
              <Sparkles size={11} className="text-brand/40 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Search, ArrowUpRight, Factory, Loader2 } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { sectionMeta } from '@/lib/production/capture-config'

// Sales-facing visibility into what was actually produced — customer, blend,
// tonnage, date — pulled straight from approved job cards (Pasteuriser +
// Granule). This is deliberately visibility-only for now: the mass shown is
// the job card's own planned/target figure, not a verified actual yield, and
// there's no comparison against demand here (Acumatica only feeds already-
// invoiced sales in, never open orders — nothing to compare against yet).
// Every row links into /traceability?batch=, the app's existing batch/yield/
// QC history view, so this reuses rather than duplicates that data.

interface Row {
  id: string
  section: 'pasteuriser' | 'granule'
  customer: string | null
  item_no: string | null
  product_name: string | null
  batch_number: string | null
  date_of_card: string | null
  total_mass: string | null
  job_card_no: string | null
}

export default function ProductionBatchesTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const db = getDb()
    Promise.all([
      db.from('job_cards_pasteuriser')
        .select('id, customer, item_no, product_name, batch_number, date_of_card, total_mass, job_card_no')
        .eq('status', 'approved').order('date_of_card', { ascending: false }),
      db.from('job_cards_granule')
        .select('id, customer, item_no, product_name, batch_number, date_of_card, total_mass, job_card_no')
        .eq('status', 'approved').order('date_of_card', { ascending: false }),
    ]).then(([p, g]) => {
      if (cancelled) return
      const merged: Row[] = [
        ...((p.data as any[]) ?? []).map(r => ({ ...r, section: 'pasteuriser' as const })),
        ...((g.data as any[]) ?? []).map(r => ({ ...r, section: 'granule' as const })),
      ].sort((a, b) => (b.date_of_card ?? '').localeCompare(a.date_of_card ?? ''))
      setRows(merged)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r =>
      (r.customer ?? '').toLowerCase().includes(s) ||
      (r.product_name ?? '').toLowerCase().includes(s) ||
      (r.item_no ?? '').toLowerCase().includes(s) ||
      (r.batch_number ?? '').toLowerCase().includes(s))
  }, [rows, search])

  return (
    <>
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search customer, product, or batch…"
            className="w-full pl-8 pr-3 py-2 text-sm bg-surface-card border border-surface-rule rounded-lg focus:outline-none focus:border-brand"
          />
        </div>
        <span className="text-[12px] text-text-muted">{filtered.length} approved batches</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-text-muted" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-surface-card border border-surface-rule rounded-xl">
          <Factory size={24} className="mx-auto mb-3 text-text-faint" />
          <p className="text-[13px] text-text-muted">No approved job cards yet{search ? ' matching that search' : ''}.</p>
        </div>
      ) : (
        <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
          <div className="divide-y divide-surface-rule">
            {filtered.map(r => {
              const meta = sectionMeta(r.section)
              const href = r.batch_number ? `/traceability?batch=${encodeURIComponent(r.batch_number)}` : null
              const content = (
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: meta.colorHex }}>
                    <span className="font-mono font-bold text-[9px] text-white">{meta.code}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[13px] text-text truncate">{r.customer || 'No customer'}</span>
                      <span className="font-mono text-[11px] text-text-muted truncate">{r.product_name || r.item_no || '—'}</span>
                    </div>
                    <div className="font-mono text-[11px] text-text-muted mt-0.5">
                      Batch {r.batch_number || '—'}
                      {r.job_card_no ? ` · ${r.job_card_no}` : ''}
                      {r.date_of_card ? ` · ${format(parseISO(r.date_of_card + 'T12:00:00'), 'd MMM yyyy')}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-[13px] text-text">{r.total_mass ? `${r.total_mass} kg` : '—'}</div>
                    <div className="font-mono text-[9px] text-text-muted uppercase">planned mass</div>
                  </div>
                  {href && <ArrowUpRight size={15} className="text-text-faint shrink-0" />}
                </div>
              )
              return href
                ? <Link key={r.id} href={href}>{content}</Link>
                : <div key={r.id}>{content}</div>
            })}
          </div>
        </div>
      )}
    </>
  )
}

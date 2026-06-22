'use client'

/**
 * BatchReconciliationPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Universal batch tracing panel. Give it a batch/lot number and it assembles
 * a complete picture of that batch across all schemas:
 *
 *   Daily stock counts  →  Bag tags  →  Scan events  →  Quality records
 *
 * Drop it anywhere in the app — Operations, Quality, Logistics, Bag Tracking.
 * Self-contained: all queries run client-side via Supabase.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO } from 'date-fns'
import {
  X, Package, Activity, FlaskConical, ClipboardList,
  CheckCircle2, AlertTriangle, Loader2, ExternalLink,
  Calendar, MapPin,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface CountOccurrence {
  count_date:   string
  section_name: string
  item_name:    string
  role:         string
  counted_by:   string | null
  kg:           number
  session_id:   string
}

interface BagTagRecord {
  serial_number:        string
  section_id:           string
  section_name:         string | null
  weight_kg:            number | null
  tag_date:             string
  destination:          string | null
  consumed_at_section:  string | null
  consumed_weight_kg:   number | null
  acumatica_id:         string | null
}

interface ScanEvent {
  serial_number: string
  section_id:    string
  action:        string | null
  weight_kg:     number | null
  scanned_at:    string
}

interface QualityRecord {
  source:      'Pasteuriser' | 'Lab Result' | 'Sieving' | 'Granule Line' | 'Raw Material'
  ref:         string
  date:        string
  description: string
  url?:        string
}

interface BatchReconciliation {
  batch_number:     string
  daily_counts:     CountOccurrence[]
  monthly_counts:   CountOccurrence[]
  total_counted_kg: number
  bags:             BagTagRecord[]
  total_bag_kg:     number
  scans:            ScanEvent[]
  quality:          QualityRecord[]
  status:           'reconciled' | 'variance' | 'unlinked' | 'loading'
}

// ── Timeline event ────────────────────────────────────────────────────────────
type TimelineEvent =
  | { kind: 'count';   date: string; label: string; detail: string; icon: React.ReactNode }
  | { kind: 'bag';     date: string; label: string; detail: string; icon: React.ReactNode }
  | { kind: 'scan';    date: string; label: string; detail: string; icon: React.ReactNode }
  | { kind: 'quality'; date: string; label: string; detail: string; icon: React.ReactNode; url?: string }

function buildTimeline(data: BatchReconciliation): TimelineEvent[] {
  const events: TimelineEvent[] = []

  data.daily_counts.forEach(c => {
    events.push({
      kind: 'count',
      date: c.count_date + 'T08:00:00',
      label: `Counted — ${c.section_name}`,
      detail: `${c.role === 'admin' ? 'Admin' : 'Supervisor'} · ${c.counted_by ?? 'Unknown'} · ${c.kg.toFixed(1)} kg · ${c.item_name}`,
      icon: <ClipboardList size={12} className="text-brand" />,
    })
  })

  data.monthly_counts.forEach(c => {
    events.push({
      kind: 'count',
      date: c.count_date + 'T08:00:00',
      label: `Monthly Count — ${c.section_name}`,
      detail: `${c.role === 'admin' ? 'Admin' : 'Supervisor'} · ${c.kg.toFixed(1)} kg · ${c.item_name}`,
      icon: <ClipboardList size={12} className="text-info" />,
    })
  })

  data.bags.forEach(b => {
    events.push({
      kind: 'bag',
      date: b.tag_date + 'T07:00:00',
      label: `Bag Tagged — ${b.serial_number}`,
      detail: [b.section_name ?? b.section_id, b.weight_kg != null ? `${b.weight_kg.toFixed(1)} kg` : null, b.acumatica_id].filter(Boolean).join(' · '),
      icon: <Package size={12} className="text-ok" />,
    })
    if (b.consumed_at_section) {
      events.push({
        kind: 'bag',
        date: b.tag_date + 'T09:00:00',
        label: `Consumed → ${b.consumed_at_section}`,
        detail: b.consumed_weight_kg != null ? `${b.consumed_weight_kg.toFixed(1)} kg` : '',
        icon: <Activity size={12} className="text-warn" />,
      })
    }
  })

  data.scans.forEach(s => {
    events.push({
      kind: 'scan',
      date: s.scanned_at,
      label: `Scan — ${s.action?.replace(/_/g, ' ') ?? 'Event'} · ${s.serial_number}`,
      detail: [s.section_id, s.weight_kg != null ? `${s.weight_kg.toFixed(1)} kg` : null].filter(Boolean).join(' · '),
      icon: <Activity size={12} className="text-text-muted" />,
    })
  })

  data.quality.forEach(q => {
    events.push({
      kind: 'quality',
      date: q.date + 'T12:00:00',
      label: `${q.source} — ${q.ref}`,
      detail: q.description,
      icon: <FlaskConical size={12} className="text-purple-500" />,
      url: q.url,
    })
  })

  return events.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Quick stats ───────────────────────────────────────────────────────────────
function QuickStats({ data }: { data: BatchReconciliation }) {
  const varPct = data.total_bag_kg > 0 && data.total_counted_kg > 0
    ? Math.abs(data.total_counted_kg - data.total_bag_kg) / Math.max(data.total_counted_kg, data.total_bag_kg) * 100
    : null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {[
        { label: 'Counted',      value: data.total_counted_kg > 0 ? `${data.total_counted_kg.toFixed(1)} kg` : '—', color: 'text-text' },
        { label: 'Bags Tracked', value: data.bags.length > 0 ? `${data.bags.length} (${data.total_bag_kg.toFixed(0)} kg)` : '—', color: 'text-text' },
        { label: 'Scan Events',  value: data.scans.length || '—', color: 'text-text' },
        {
          label: varPct != null ? 'Variance' : 'Quality Flags',
          value: varPct != null ? `${varPct.toFixed(1)}%` : data.quality.length || '—',
          color: varPct == null
            ? (data.quality.length > 0 ? 'text-purple-500' : 'text-text')
            : varPct <= 2 ? 'text-ok' : varPct <= 10 ? 'text-warn' : 'text-err',
        },
      ].map(s => (
        <div key={s.label} className="bg-surface rounded-xl px-3 py-2.5">
          <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide">{s.label}</div>
          <div className={`font-display font-bold text-[18px] mt-0.5 ${s.color}`}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: BatchReconciliation['status'] }) {
  if (status === 'reconciled') return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-ok/10 text-ok font-bold">
      <CheckCircle2 size={9} /> Reconciled
    </span>
  )
  if (status === 'variance') return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-warn/10 text-warn font-bold">
      <AlertTriangle size={9} /> Variance
    </span>
  )
  if (status === 'unlinked') return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-err/10 text-err font-bold">
      Unlinked
    </span>
  )
  return null
}

// ═════════════════════════════════════════════════════════════════════════════
// BATCH RECONCILIATION PANEL
// ═════════════════════════════════════════════════════════════════════════════
interface Props {
  batchNumber:   string
  onClose?:      () => void
  monthContext?: string
  mode?:         'panel' | 'inline'
}

export default function BatchReconciliationPanel({
  batchNumber,
  onClose,
  monthContext,
  mode = 'panel',
}: Props) {
  const db = getDb()
  const [data,          setData]          = useState<BatchReconciliation | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [activeSection, setActiveSection] = useState<'timeline' | 'counts' | 'bags' | 'quality'>('timeline')

  useEffect(() => { if (batchNumber) load() }, [batchNumber])

  async function load() {
    setLoading(true)
    const bn = batchNumber.trim().toUpperCase()

    // ── Daily counts ──────────────────────────────────────────────────────────
    const { data: scData } = await db
      .from('sc_entries')
      .select('section_id,section_name,item_name,role,kg,session_id')
      .eq('batch_number', bn)
      .eq('is_no_stock', false)
      .order('session_id')

    const sessionIds = [...new Set((scData ?? []).map((e: any) => e.session_id))]
    let sessionDates: Record<string, { date: string; sup_name: string | null; adm_name: string | null }> = {}
    if (sessionIds.length) {
      const { data: sessions } = await db
        .from('sc_sessions')
        .select('id,count_date,sup_name,adm_name')
        .in('id', sessionIds)
      ;(sessions ?? []).forEach((s: any) => {
        sessionDates[s.id] = { date: s.count_date, sup_name: s.sup_name, adm_name: s.adm_name }
      })
    }

    const dailyCounts: CountOccurrence[] = (scData ?? []).map((e: any) => {
      const sess = sessionDates[e.session_id]
      return {
        count_date:   sess?.date ?? '',
        section_name: e.section_name ?? e.section_id,
        item_name:    e.item_name ?? e.inventory_code,
        role:         e.role,
        counted_by:   e.role === 'supervisor' ? sess?.sup_name : sess?.adm_name,
        kg:           e.kg ?? 0,
        session_id:   e.session_id,
      }
    }).filter((c: CountOccurrence) => c.count_date)

    // ── Monthly counts ────────────────────────────────────────────────────────
    let mcQuery = db
      .from('mc_entries')
      .select('section_id,section_name,item_name,role,kg,session_id')
      .eq('batch_number', bn)
      .eq('is_no_stock', false)

    if (monthContext) {
      const { data: mcSess } = await db
        .from('mc_sessions')
        .select('id')
        .eq('count_month', `${monthContext}-01`)
        .maybeSingle()
      if (mcSess?.id) mcQuery = mcQuery.eq('session_id', mcSess.id)
    }

    const { data: mcData } = await mcQuery
    const mcSessionIds = [...new Set((mcData ?? []).map((e: any) => e.session_id))]
    let mcSessionDates: Record<string, { date: string; sup_name: string | null; adm_name: string | null }> = {}
    if (mcSessionIds.length) {
      const { data: mcSessions } = await db
        .from('mc_sessions')
        .select('id,count_month,sup_name,adm_name')
        .in('id', mcSessionIds)
      ;(mcSessions ?? []).forEach((s: any) => {
        mcSessionDates[s.id] = { date: s.count_month, sup_name: s.sup_name, adm_name: s.adm_name }
      })
    }

    const monthlyCounts: CountOccurrence[] = (mcData ?? []).map((e: any) => {
      const sess = mcSessionDates[e.session_id]
      return {
        count_date:   sess?.date ?? '',
        section_name: e.section_name ?? e.section_id,
        item_name:    e.item_name ?? '',
        role:         e.role,
        counted_by:   e.role === 'supervisor' ? sess?.sup_name : sess?.adm_name,
        kg:           e.kg ?? 0,
        session_id:   e.session_id,
      }
    }).filter((c: CountOccurrence) => c.count_date)

    const allCountKg  = [...dailyCounts, ...monthlyCounts]
    const supKg       = allCountKg.filter(c => c.role === 'supervisor').reduce((s, c) => s + c.kg, 0)
    const admKg       = allCountKg.filter(c => c.role === 'admin').reduce((s, c) => s + c.kg, 0)
    const hasBothRoles = allCountKg.some(c => c.role === 'supervisor') && allCountKg.some(c => c.role === 'admin')
    const totalCountedKg = hasBothRoles ? (supKg + admKg) / 2 : supKg + admKg

    // ── Bags ──────────────────────────────────────────────────────────────────
    const { data: bagData } = await db
      .schema('production')
      .from('bag_tags')
      .select('serial_number,section_id,section_name,weight_kg,tag_date,destination,consumed_at_section,consumed_weight_kg,acumatica_id')
      .eq('lot_number', bn)
      .order('tag_date', { ascending: false })
      .limit(100)

    const bags        = (bagData ?? []) as BagTagRecord[]
    const totalBagKg  = bags.reduce((s, b) => s + (b.weight_kg ?? 0), 0)

    // ── Scans ─────────────────────────────────────────────────────────────────
    let scans: ScanEvent[] = []
    if (bags.length > 0) {
      const serials = bags.map(b => b.serial_number)
      const { data: scanData } = await db
        .schema('production')
        .from('scan_events')
        .select('serial_number,section_id,action,weight_kg,scanned_at')
        .in('serial_number', serials)
        .order('scanned_at', { ascending: false })
        .limit(200)
      scans = (scanData ?? []) as ScanEvent[]
    }

    // ── Quality ───────────────────────────────────────────────────────────────
    const quality: QualityRecord[] = []
    const [{ data: pastData }, { data: labData }, { data: rawData }] = await Promise.all([
      db.from('pasteuriser_runs').select('id,run_date,batch_ref,status').ilike('batch_ref', bn).limit(5),
      db.from('lab_results').select('id,sample_date,batch_number,result_status').ilike('batch_number', bn).limit(5),
      db.from('raw_material_entries').select('id,received_date,lot_number,grade').ilike('lot_number', bn).limit(5),
    ])
    ;(pastData ?? []).forEach((r: any) => quality.push({ source: 'Pasteuriser', ref: r.id?.slice(0,8) ?? '—', date: r.run_date ?? '', description: `Status: ${r.status ?? 'unknown'}`, url: '/quality/pasteuriser' }))
    ;(labData  ?? []).forEach((r: any) => quality.push({ source: 'Lab Result',  ref: r.id?.slice(0,8) ?? '—', date: r.sample_date ?? '', description: `Result: ${r.result_status ?? 'pending'}`, url: '/quality/lab-results' }))
    ;(rawData  ?? []).forEach((r: any) => quality.push({ source: 'Raw Material',ref: r.id?.slice(0,8) ?? '—', date: r.received_date ?? '', description: `Grade ${r.grade ?? '—'}`, url: '/quality/raw-material' }))

    // ── Status ────────────────────────────────────────────────────────────────
    let status: BatchReconciliation['status'] = 'unlinked'
    if (bags.length > 0 && totalCountedKg > 0) {
      const diff = Math.abs(totalCountedKg - totalBagKg)
      const pct  = Math.max(totalCountedKg, totalBagKg) > 0 ? diff / Math.max(totalCountedKg, totalBagKg) * 100 : 0
      status = pct <= 5 ? 'reconciled' : 'variance'
    }

    setData({ batch_number: bn, daily_counts: dailyCounts, monthly_counts: monthlyCounts, total_counted_kg: totalCountedKg, bags, total_bag_kg: totalBagKg, scans, quality, status })
    setLoading(false)
  }

  const containerCls = mode === 'panel'
    ? 'flex flex-col h-full bg-surface'
    : 'bg-surface-card border border-surface-rule rounded-2xl overflow-hidden'

  return (
    <div className={containerCls}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-rule bg-surface-card flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-[15px] text-text">{batchNumber}</span>
            {!loading && data && <StatusBadge status={data.status} />}
          </div>
          <p className="font-mono text-[10px] text-text-muted mt-0.5">Cross-schema reconciliation · All linked records</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface transition-colors flex-shrink-0">
            <X size={16} className="text-text-muted" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2 font-mono text-[12px] text-text-muted">
          <Loader2 size={14} className="animate-spin" /> Reconciling records…
        </div>
      ) : !data ? (
        <div className="flex-1 flex items-center justify-center font-mono text-[12px] text-text-muted">
          No records found for this batch number.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <QuickStats data={data} />

          {/* Section nav */}
          <div className="flex gap-0.5 p-1 bg-surface rounded-xl w-fit">
            {([
              { key: 'timeline', label: 'Timeline' },
              { key: 'counts',   label: `Counts (${data.daily_counts.length + data.monthly_counts.length})` },
              { key: 'bags',     label: `Bags (${data.bags.length})` },
              { key: 'quality',  label: `Quality (${data.quality.length})` },
            ] as const).map(s => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`px-3 py-1.5 rounded-lg font-mono text-[11px] transition-colors ${
                  activeSection === s.key ? 'bg-surface-card text-text shadow-sm font-bold' : 'text-text-muted hover:text-text'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Timeline */}
          {activeSection === 'timeline' && (() => {
            const timeline = buildTimeline(data)
            if (!timeline.length) return <p className="font-mono text-[12px] text-text-muted text-center py-8">No timeline events found.</p>
            return (
              <div className="space-y-1">
                {timeline.map((ev, i) => (
                  <div key={i} className="flex gap-3 py-2 px-3 rounded-xl hover:bg-surface transition-colors group">
                    <div className="flex-shrink-0 w-4 flex items-start justify-center pt-1">{ev.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-body font-semibold text-[12px] text-text">{ev.label}</span>
                        {'url' in ev && ev.url && (
                          <a href={ev.url} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ExternalLink size={10} className="text-brand" />
                          </a>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-text-muted">{ev.detail}</div>
                    </div>
                    <div className="flex-shrink-0 font-mono text-[10px] text-text-faint">
                      {ev.date ? format(new Date(ev.date), 'd MMM yyyy') : ''}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Counts */}
          {activeSection === 'counts' && (
            <div className="space-y-2">
              {!data.daily_counts.length && !data.monthly_counts.length && (
                <p className="font-mono text-[12px] text-text-muted text-center py-8">No count records found for this batch.</p>
              )}
              {data.daily_counts.length > 0 && (
                <div>
                  <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-2">Daily Stock Counts</p>
                  {data.daily_counts.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 bg-surface rounded-xl mb-1.5">
                      <Calendar size={13} className="text-brand flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-body font-semibold text-[12px] text-text">{c.section_name} · {c.item_name}</div>
                        <div className="font-mono text-[10px] text-text-muted">{c.role === 'supervisor' ? 'Supervisor' : 'Admin'}{c.counted_by ? ` · ${c.counted_by}` : ''}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono text-[12px] font-bold text-text">{c.kg.toFixed(1)} kg</div>
                        <div className="font-mono text-[10px] text-text-muted">{c.count_date ? format(new Date(c.count_date + 'T12:00:00'), 'd MMM yyyy') : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {data.monthly_counts.length > 0 && (
                <div>
                  <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-2 mt-3">Monthly Counts</p>
                  {data.monthly_counts.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 bg-info/5 border border-info/20 rounded-xl mb-1.5">
                      <Calendar size={13} className="text-info flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-body font-semibold text-[12px] text-text">{c.section_name}</div>
                        <div className="font-mono text-[10px] text-text-muted">{c.role === 'supervisor' ? 'Supervisor' : 'Admin'}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono text-[12px] font-bold text-text">{c.kg.toFixed(1)} kg</div>
                        <div className="font-mono text-[10px] text-text-muted">{format(new Date(c.count_date.slice(0,7) + '-01T12:00:00'), 'MMM yyyy')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bags */}
          {activeSection === 'bags' && (
            <div className="space-y-2">
              {!data.bags.length ? (
                <p className="font-mono text-[12px] text-text-muted text-center py-8">No bag tags found for this lot number.</p>
              ) : data.bags.map(b => (
                <div key={b.serial_number} className="px-4 py-3 bg-surface rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Package size={13} className="text-ok flex-shrink-0" />
                    <span className="font-mono font-bold text-[12px] text-text">{b.serial_number}</span>
                    {b.acumatica_id && <span className="font-mono text-[10px] text-text-muted">{b.acumatica_id}</span>}
                    {b.weight_kg != null && <span className="font-mono text-[11px] font-bold text-ok ml-auto">{b.weight_kg.toFixed(1)} kg</span>}
                  </div>
                  <div className="flex items-center gap-4 font-mono text-[10px] text-text-muted">
                    <span className="flex items-center gap-1"><MapPin size={9}/>{b.section_name ?? b.section_id}</span>
                    <span className="flex items-center gap-1"><Calendar size={9}/>{format(new Date(b.tag_date + 'T12:00:00'), 'd MMM yyyy')}</span>
                    {b.consumed_at_section && <span className="flex items-center gap-1 text-warn"><Activity size={9}/>→ {b.consumed_at_section}</span>}
                    {b.destination && !b.consumed_at_section && <span>{b.destination}</span>}
                  </div>
                  {data.scans.filter(s => s.serial_number === b.serial_number).slice(0, 4).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 pl-4 font-mono text-[10px] text-text-faint">
                      <Activity size={9}/>
                      <span>{s.action?.replace(/_/g, ' ') ?? 'Scan'}</span>
                      <span>· {s.section_id}</span>
                      {s.weight_kg != null && <span>· {s.weight_kg.toFixed(1)} kg</span>}
                      <span className="ml-auto">{format(parseISO(s.scanned_at), 'd MMM HH:mm')}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Quality */}
          {activeSection === 'quality' && (
            <div className="space-y-2">
              {!data.quality.length ? (
                <div className="py-8 text-center space-y-2">
                  <CheckCircle2 size={24} className="text-ok mx-auto" />
                  <p className="font-mono text-[12px] text-text-muted">No quality records found for this batch.</p>
                </div>
              ) : data.quality.map((q, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 bg-surface rounded-xl">
                  <FlaskConical size={14} className="text-purple-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-body font-semibold text-[12px] text-text">{q.source}</span>
                      <span className="font-mono text-[10px] text-text-muted">Ref: {q.ref}</span>
                    </div>
                    <div className="font-mono text-[10px] text-text-muted">{q.description}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {q.date && <span className="font-mono text-[10px] text-text-faint">{format(new Date(q.date + 'T12:00:00'), 'd MMM yyyy')}</span>}
                    {q.url && <a href={q.url} className="text-brand hover:underline"><ExternalLink size={12} /></a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

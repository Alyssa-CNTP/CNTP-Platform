'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  FileSpreadsheet, Upload, CheckCircle2, AlertCircle,
  Loader2, ChevronDown, ChevronUp, Search,
  RefreshCw, Truck, Package,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormalisedRow {
  purchaser: string; supplier: string; country: string; product: string
  value_usd: number; weight_kg: number; date: string; datasource: string; hs_code: string
}
interface ImportResult {
  ok: boolean; rows_parsed: number; companies: number; created: number; updated: number
  filename: string; error?: string
}
interface PastImport {
  id: string; filename: string; row_count: number | null; company_count: number | null
  notes: string | null; created_at: string
}
interface OverviewStats { total_companies: number; total_value_usd: number; total_shipments: number }
interface CountryRow   { country: string; count: number; value_usd: number }
interface TopBuyer     { name: string; country: string; value_usd: number; shipments: number }
interface Shipment     {
  date: string; datasource: string; supplier: string
  hs_code: string; product: string; value_usd: number; weight_kg: number
}
interface CompanyProfile {
  company_name: string; country: string; pitch_angle: string; last_enriched: string
  panjiva_data: {
    shipments: Shipment[]; total_value_usd: number
    shipment_count: number; current_supplier: string
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60)   return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}
function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${Math.round(v)}`
}
function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-accent" />
}

const DS_COLORS: Record<string, string> = {
  'US Customs':      'bg-accent/15 text-accent border-accent/25',
  'Global Shipping': 'bg-info/15 text-info border-info/25',
  'Rooibos':         'bg-ok/15 text-ok border-ok/25',
}
function dsChip(name: string) {
  const cls = DS_COLORS[name] ?? 'bg-surface-rule text-text-muted border-surface-rule'
  return (
    <span key={name} className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-wide ${cls}`}>
      {name}
    </span>
  )
}

// ── xlsx parsing ──────────────────────────────────────────────────────────────

function normHscode(rows: any[], ds: string): NormalisedRow[] {
  return rows.filter(r => r['PURCHASER'] && String(r['PURCHASER']).trim()).map(r => ({
    purchaser:  String(r['PURCHASER']           ?? '').trim(),
    supplier:   String(r['SUPPLIER']            ?? '').trim(),
    country:    String(r['PURCHASING COUNTRY']  ?? r['COUNTRY OF ORIGIN'] ?? '').trim(),
    product:    String(r['PRODUCT DESCRIPTION'] ?? '').trim().slice(0, 300),
    value_usd:  Number(r['TOTAL VALUE($)']      ?? 0),
    weight_kg:  Number(r['WEIGHT(KG)']          ?? 0),
    date:       r['DATES'] ? String(r['DATES']).slice(0, 10) : '',
    datasource: ds || String(r['DATASOURCE'] ?? '').trim(),
    hs_code:    String(r['HS CODE'] ?? '').trim(),
  }))
}
function normUs(rows: any[]): NormalisedRow[] {
  return rows.filter(r => r['CONSIGNEE'] && String(r['CONSIGNEE']).trim().toUpperCase() !== 'NONE').map(r => ({
    purchaser:  String(r['CONSIGNEE']               ?? '').trim(),
    supplier:   String(r['SHIPPER']                 ?? '').trim(),
    country:    'UNITED STATES',
    product:    String(r['PRODUCT DESCRIPTION']     ?? '').trim().slice(0, 300),
    value_usd:  Number(r['KILO WEIGHT PER PRODUCT'] ?? 0),
    weight_kg:  Number(r['KILO WEIGHT PER PRODUCT'] ?? 0),
    date:       r['ACT ARRIVAL DATE '] ? String(r['ACT ARRIVAL DATE ']).slice(0, 10) : '',
    datasource: 'US Customs', hs_code: '',
  }))
}
function normGlobal(rows: any[]): NormalisedRow[] {
  return rows.filter(r => r['CONSIGNEE'] && String(r['CONSIGNEE']).trim()).map(r => ({
    purchaser:  String(r['CONSIGNEE']           ?? '').trim(),
    supplier:   String(r['SHIPPER']             ?? '').trim(),
    country:    String(r['DESTINATION COUNTRY'] ?? '').trim(),
    product:    String(r['PRODUCT DESCRIPTION'] ?? '').trim().slice(0, 300),
    value_usd:  Number(r['GROSS WEIGHT']        ?? 0),
    weight_kg:  Number(r['GROSS WEIGHT']        ?? 0),
    date:       r['MONTHS'] ? String(r['MONTHS']) : '',
    datasource: 'Global Shipping', hs_code: '',
  }))
}
async function parseXlsx(file: File): Promise<NormalisedRow[]> {
  const XLSX = await import('xlsx')
  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { type: 'array', cellDates: true })
  const out: NormalisedRow[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const data  = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    const low   = name.toLowerCase()
    if (low.includes('hscode') || low.includes('rooibos'))
      out.push(...normHscode(data, low.includes('rooibos') ? 'Rooibos' : ''))
    else if (low === 'us')
      out.push(...normUs(data))
    else if (low.includes('global') || low.includes('shipping'))
      out.push(...normGlobal(data))
  }
  return out
}

// ── Shipment Timeline ─────────────────────────────────────────────────────────

function ShipmentTimeline({ shipments }: { shipments: Shipment[] }) {
  const sorted = useMemo(() =>
    [...shipments]
      .filter(s => s.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [shipments]
  )
  if (!sorted.length) return <p className="text-[11px] text-text-faint py-2">No dated shipments.</p>

  const timestamps = sorted.map(s => new Date(s.date).getTime())
  const minT   = Math.min(...timestamps)
  const maxT   = Math.max(...timestamps)
  const range  = maxT - minT || 1
  const maxVal = Math.max(...sorted.map(s => s.value_usd), 1)

  const sources = [...new Set(sorted.map(s => s.datasource))]

  return (
    <div className="mt-1">
      {/* Legend */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {sources.map(s => (
          <span key={s}>{dsChip(s)}</span>
        ))}
        <span className="text-[10px] text-text-faint ml-auto">Dot size = shipment value</span>
      </div>

      {/* Timeline track */}
      <div className="relative overflow-x-auto pb-6" style={{ minHeight: 64 }}>
        {/* Baseline */}
        <div className="absolute left-0 right-0 bg-surface-rule" style={{ top: 28, height: 1 }} />
        {/* Start / end date labels */}
        <span className="absolute font-mono text-[9px] text-text-faint" style={{ left: 0, top: 38 }}>
          {sorted[0]?.date?.slice(0, 7)}
        </span>
        {sorted.length > 1 && (
          <span className="absolute font-mono text-[9px] text-text-faint" style={{ right: 0, top: 38 }}>
            {sorted[sorted.length - 1]?.date?.slice(0, 7)}
          </span>
        )}

        {/* Dots */}
        {sorted.map((s, i) => {
          const pct   = range > 0 ? ((timestamps[i] - minT) / range) * 96 + 2 : 50
          const diam  = 6 + Math.round((s.value_usd / maxVal) * 14) // 6–20px
          const dsKey = s.datasource
          const dotCls =
            dsKey === 'US Customs'      ? 'bg-accent'       :
            dsKey === 'Global Shipping' ? 'bg-info'         :
            dsKey === 'Rooibos'         ? 'bg-ok'           : 'bg-text-muted'
          return (
            <div
              key={i}
              title={`${s.date} — ${fmtUsd(s.value_usd)}\n${s.product || ''}\n${s.supplier || ''}`}
              className={`absolute rounded-full ${dotCls} opacity-80 hover:opacity-100 cursor-pointer transition-opacity`}
              style={{
                left:      `calc(${pct}% - ${diam / 2}px)`,
                top:       28 - diam / 2,
                width:     diam,
                height:    diam,
              }}
            />
          )
        })}
      </div>

      {/* Monthly summary bar chart */}
      {sorted.length > 2 && <MonthlyBars shipments={sorted} />}
    </div>
  )
}

function MonthlyBars({ shipments }: { shipments: Shipment[] }) {
  const months = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of shipments) {
      const key = s.date?.slice(0, 7) ?? 'unknown'
      m[key] = (m[key] ?? 0) + s.value_usd
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
  }, [shipments])

  if (months.length < 2) return null
  const maxV = Math.max(...months.map(([, v]) => v), 1)

  return (
    <div className="mt-3 pt-3 border-t border-surface-rule">
      <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-2">Monthly value</p>
      <div className="flex items-end gap-1" style={{ height: 40 }}>
        {months.map(([month, val]) => (
          <div key={month} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${month}: ${fmtUsd(val)}`}>
            <div
              className="w-full bg-accent/40 group-hover:bg-accent/70 rounded-sm transition-colors"
              style={{ height: `${Math.max(3, (val / maxV) * 36)}px` }}
            />
            <span className="font-mono text-[7px] text-text-faint rotate-90 origin-left" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 7 }}>
              {month.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Expanded Buyer Row ────────────────────────────────────────────────────────

function ExpandedBuyer({ name }: { name: string }) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/global-wits?company=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(d => { setProfile(d.profile ?? null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [name])

  if (loading) return (
    <div className="flex items-center gap-2 py-4 px-5 text-[12px] text-text-faint">
      <Spinner /> Loading shipment history…
    </div>
  )
  if (!profile) return <div className="py-3 px-5 text-[12px] text-text-muted">No profile found.</div>

  const pd = profile.panjiva_data
  const sources = [...new Set((pd?.shipments ?? []).map(s => s.datasource))]

  return (
    <div className="px-5 pb-5 pt-3 bg-background border-t border-surface-rule space-y-4">
      {/* Stats strip */}
      <div className="flex items-center gap-6 flex-wrap">
        <div>
          <p className="font-display font-bold text-[20px] text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtUsd(pd?.total_value_usd ?? 0)}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint">Total value</p>
        </div>
        <div>
          <p className="font-display font-bold text-[20px] text-text">{pd?.shipment_count ?? 0}</p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint">Shipments</p>
        </div>
        {pd?.current_supplier && (
          <div className="min-w-0">
            <p className="text-[13px] text-text font-medium flex items-center gap-1 truncate">
              <Truck size={11} className="text-text-muted shrink-0" />{pd.current_supplier}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint">Current supplier</p>
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {sources.map(s => <span key={s}>{dsChip(s)}</span>)}
        </div>
      </div>

      {/* Shipment timeline */}
      <div className="bg-surface-card rounded-lg border border-surface-rule p-3">
        <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-2">Shipment timeline</p>
        <ShipmentTimeline shipments={pd?.shipments ?? []} />
      </div>

      {/* Pitch angle */}
      {profile.pitch_angle && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/5 border border-accent/15">
          <div className="w-1 self-stretch rounded-full bg-accent/40 shrink-0" />
          <div>
            <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-1">Sales pitch</p>
            <p className="text-[12px] text-text leading-relaxed">{profile.pitch_angle}</p>
          </div>
        </div>
      )}

      {/* Recent shipment detail */}
      {(pd?.shipments?.length ?? 0) > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-2">Recent shipments</p>
          <div className="space-y-1.5">
            {[...(pd?.shipments ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((s, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-2 px-3 rounded-lg border border-surface-rule bg-surface-card/50 text-[11px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[9px] text-text-faint">{s.date}</span>
                    {dsChip(s.datasource)}
                    {s.hs_code && (
                      <span className="font-mono text-[9px] text-text-faint flex items-center gap-0.5">
                        <Package size={8} />HS {s.hs_code}
                      </span>
                    )}
                  </div>
                  {s.product && <p className="text-text-muted truncate">{s.product}</p>}
                  {s.supplier && <p className="text-text-faint text-[10px] flex items-center gap-1 mt-0.5"><Truck size={8} />{s.supplier}</p>}
                </div>
                <span className="font-mono font-semibold text-accent shrink-0">{fmtUsd(s.value_usd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Buyers Grid ───────────────────────────────────────────────────────────────

type SortKey = 'value' | 'name' | 'shipments'

function BuyersGrid({ buyers }: { buyers: TopBuyer[] }) {
  const [sort,     setSort]     = useState<SortKey>('value')
  const [query,    setQuery]    = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const maxVal = Math.max(...buyers.map(b => b.value_usd), 1)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return buyers
      .filter(b => !q || b.name.toLowerCase().includes(q) || b.country.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === 'value'    ? b.value_usd - a.value_usd :
        sort === 'shipments'? b.shipments - a.shipments  :
        a.name.localeCompare(b.name)
      )
  }, [buyers, sort, query])

  function toggle(name: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(name) ? s.delete(name) : s.add(name)
      return s
    })
  }

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => setSort(k)}
      className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wide transition-colors
        ${sort === k ? 'bg-accent text-white' : 'text-text-muted hover:text-text hover:bg-surface-rule'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-rule flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[160px] bg-background border border-surface-rule rounded-lg px-3 py-1.5">
          <Search size={12} className="text-text-faint shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search buyers…"
            className="bg-transparent text-[12px] text-text placeholder-text-faint outline-none w-full"
          />
        </div>
        <div className="flex items-center gap-1 bg-background border border-surface-rule rounded-lg p-1">
          <SortBtn k="value"     label="$ Value" />
          <SortBtn k="shipments" label="Shipments" />
          <SortBtn k="name"      label="A–Z" />
        </div>
        <span className="font-mono text-[10px] text-text-faint">{filtered.length} buyers</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-surface-rule">
        {filtered.map(b => {
          const open   = expanded.has(b.name)
          const barPct = (b.value_usd / maxVal) * 100
          return (
            <div key={b.name}>
              <button
                onClick={() => toggle(b.name)}
                className="w-full flex items-center gap-4 px-5 py-3 hover:bg-background/60 transition-colors text-left group"
              >
                {/* Name + country */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text truncate">{b.name}</p>
                  <p className="text-[10px] text-text-faint mt-0.5">{b.country}</p>
                </div>

                {/* Value bar */}
                <div className="hidden sm:flex items-center gap-2 w-36">
                  <div className="flex-1 h-1.5 bg-surface-rule rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent/50 rounded-full group-hover:bg-accent/70 transition-colors"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>

                {/* Value */}
                <span className="font-mono text-[13px] font-semibold text-accent w-14 text-right shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtUsd(b.value_usd)}
                </span>

                {/* Shipments */}
                <span className="font-mono text-[10px] text-text-muted w-16 text-right shrink-0">
                  {b.shipments} ship{b.shipments !== 1 ? 's' : ''}
                </span>

                {/* Chevron */}
                <div className="shrink-0 text-text-faint group-hover:text-text transition-colors">
                  {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {/* Expanded detail */}
              {open && <ExpandedBuyer name={b.name} />}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-muted">No buyers match "{query}"</div>
        )}
      </div>
    </div>
  )
}

// ── Country Chart (SVG) ───────────────────────────────────────────────────────

function CountryChart({ countries }: { countries: CountryRow[] }) {
  const maxCount = Math.max(...countries.map(c => c.count), 1)
  const rowH = 28
  const labelW = 130
  const barAreaW = 320
  const totalW = labelW + barAreaW + 100
  const totalH = countries.length * rowH + 16

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-rule">
        <p className="font-display font-semibold text-[13px] text-text">Buyers by country</p>
        <p className="text-[10px] text-text-faint mt-0.5">{countries.length} markets · bar width = buyer count</p>
      </div>
      <div className="overflow-x-auto p-4">
        <svg width={totalW} height={totalH} className="block">
          {countries.map((c, i) => {
            const y       = i * rowH + 8
            const barW    = (c.count / maxCount) * barAreaW
            const opacity = 0.35 + 0.65 * (1 - i / countries.length)
            return (
              <g key={c.country}>
                {/* Country label */}
                <text
                  x={labelW - 8} y={y + 10}
                  textAnchor="end"
                  className="fill-current text-text"
                  style={{ fontSize: 11, fontFamily: 'inherit' }}
                >
                  {c.country || 'Unknown'}
                </text>

                {/* Bar track */}
                <rect x={labelW} y={y} width={barAreaW} height={16} rx={3}
                  className="fill-current text-surface-rule" />

                {/* Bar fill */}
                <rect x={labelW} y={y} width={barW} height={16} rx={3}
                  className="fill-current text-accent"
                  style={{ opacity }} />

                {/* Count */}
                <text x={labelW + barW + 8} y={y + 11}
                  className="fill-current text-text-muted"
                  style={{ fontSize: 10, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}
                >
                  {c.count}
                </text>

                {/* Value */}
                <text x={labelW + barAreaW + 60} y={y + 11}
                  textAnchor="end"
                  className="fill-current text-accent"
                  style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {fmtUsd(c.value_usd)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ── Stats Strip ───────────────────────────────────────────────────────────────

function StatsStrip({ stats }: { stats: OverviewStats }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {([
        { label: 'Trade buyers',     value: stats.total_companies.toLocaleString(),              sub: 'unique companies'    },
        { label: 'Total trade value',value: fmtUsd(stats.total_value_usd),                       sub: 'across all shipments' },
        { label: 'Shipment records', value: stats.total_shipments.toLocaleString(),              sub: 'individual imports'  },
      ] as const).map(s => (
        <div key={s.label} className="bg-surface-card border border-surface-rule rounded-xl px-4 py-4">
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-1">{s.label}</p>
          <p className="font-display font-bold text-[28px] text-text leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {s.value}
          </p>
          <p className="text-[10px] text-text-faint mt-1">{s.sub}</p>
        </div>
      ))}
    </div>
  )
}

// ── Import History Grid ───────────────────────────────────────────────────────

function ImportGrid({ imports, onRefresh }: { imports: PastImport[]; onRefresh: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (!imports.length) return null

  function toggle(id: string) {
    setOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-rule">
        <p className="font-display font-semibold text-[13px] text-text">Import history</p>
        <button onClick={onRefresh} className="p-1 text-text-faint hover:text-text rounded transition-colors">
          <RefreshCw size={11} />
        </button>
      </div>
      <div className="divide-y divide-surface-rule">
        {imports.map(imp => (
          <div key={imp.id}>
            <button
              onClick={() => toggle(imp.id)}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-background/60 transition-colors text-left group"
            >
              <FileSpreadsheet size={14} className="text-text-muted shrink-0" />
              <span className="flex-1 font-mono text-[12px] text-text truncate">{imp.filename}</span>
              {imp.company_count != null && (
                <span className="font-mono text-[11px] font-medium text-accent shrink-0">
                  {imp.company_count.toLocaleString()} companies
                </span>
              )}
              {imp.row_count != null && (
                <span className="font-mono text-[10px] text-text-muted shrink-0 hidden sm:block">
                  {imp.row_count.toLocaleString()} rows
                </span>
              )}
              <span className="font-mono text-[10px] text-text-faint shrink-0">{timeAgo(imp.created_at)}</span>
              <div className="shrink-0 text-text-faint group-hover:text-text transition-colors">
                {open.has(imp.id) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </div>
            </button>
            {open.has(imp.id) && imp.notes && (
              <div className="px-4 pb-3 pt-1 bg-background border-t border-surface-rule">
                <p className="text-[11px] text-text-muted">{imp.notes}</p>
                <p className="text-[10px] text-text-faint mt-1 font-mono">{imp.created_at?.slice(0, 16).replace('T', ' ')} UTC</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────

function DropZone({ onFile, loading, status, hasData }: {
  onFile: (f: File) => void; loading: boolean; status: string; hasData: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) onFile(f)
  }, [onFile])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !loading && ref.current?.click()}
      className={`rounded-xl border-2 border-dashed transition-all cursor-pointer select-none
        ${hasData ? 'p-4' : 'p-10'}
        ${dragging ? 'border-accent bg-accent/5' : 'border-surface-rule hover:border-accent/40 hover:bg-surface-card'}
        ${loading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      <div className={`flex items-center ${hasData ? 'gap-3' : 'flex-col gap-3 text-center'}`}>
        {loading
          ? <Loader2 size={hasData ? 16 : 24} className="animate-spin text-accent shrink-0" />
          : <FileSpreadsheet size={hasData ? 16 : 24} className="text-accent shrink-0" />}
        <div className={hasData ? 'flex-1 min-w-0' : ''}>
          <p className="font-display font-semibold text-[13px] text-text">
            {loading ? status : 'Import a new Global Wits file'}
          </p>
          {!hasData && <p className="text-[11px] text-text-muted mt-1">hscode · US customs · global shipping · rooibos sheets</p>}
        </div>
        {!loading && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[11px] font-semibold shrink-0">
            <Upload size={11} /> Choose file
          </div>
        )}
      </div>
    </div>
  )
}

// ── Result Banner ─────────────────────────────────────────────────────────────

function ResultBanner({ result, onDismiss }: { result: ImportResult; onDismiss: () => void }) {
  if (!result.ok) return (
    <div className="flex items-start gap-3 p-4 bg-danger/5 border border-danger/20 rounded-xl">
      <AlertCircle size={15} className="text-danger shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-semibold text-[13px] text-danger">Import failed</p>
        <p className="text-[11px] text-text-muted mt-0.5">{result.error}</p>
      </div>
      <button onClick={onDismiss} className="text-text-faint hover:text-text shrink-0"><span className="text-[16px]">×</span></button>
    </div>
  )
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-ok/5 border border-ok/20 rounded-xl">
      <CheckCircle2 size={15} className="text-ok shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] text-ok">Import complete — {result.filename}</p>
        <p className="text-[11px] text-text-muted mt-0.5">
          {result.rows_parsed.toLocaleString()} rows · {result.companies.toLocaleString()} buyers saved as leads, profiles &amp; signals
        </p>
      </div>
      <button onClick={onDismiss} className="text-text-faint hover:text-text shrink-0"><span className="text-[16px]">×</span></button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GlobalWitsPage() {
  const [loading,      setLoading]      = useState(false)
  const [status,       setStatus]       = useState('')
  const [result,       setResult]       = useState<ImportResult | null>(null)
  const [overLoading,  setOverLoading]  = useState(true)
  const [stats,        setStats]        = useState<OverviewStats | null>(null)
  const [topCountries, setTopCountries] = useState<CountryRow[]>([])
  const [topBuyers,    setTopBuyers]    = useState<TopBuyer[]>([])
  const [imports,      setImports]      = useState<PastImport[]>([])

  const hasData = !!stats && stats.total_companies > 0

  const fetchOverview = useCallback(async () => {
    setOverLoading(true)
    try {
      const r = await fetch('/api/global-wits'); const d = await r.json()
      setStats(d.stats ?? null)
      setTopCountries(d.top_countries ?? [])
      setTopBuyers(d.top_buyers ?? [])
      setImports(d.imports ?? [])
    } catch {}
    setOverLoading(false)
  }, [])

  useEffect(() => { fetchOverview() }, [fetchOverview])

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setResult(null)
    try {
      setStatus('Parsing spreadsheet…')
      const rows = await parseXlsx(file)
      if (!rows.length) {
        setResult({ ok: false, error: 'No purchaser/consignee rows found.', rows_parsed: 0, companies: 0, created: 0, updated: 0, filename: file.name })
        setLoading(false); return
      }
      setStatus(`Saving ${rows.length} rows…`)
      const r = await fetch('/api/global-wits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, filename: file.name }),
      })
      const d = await r.json()
      setResult(d.error
        ? { ok: false, error: d.error, rows_parsed: 0, companies: 0, created: 0, updated: 0, filename: file.name }
        : { ...d, ok: true })
      if (!d.error) fetchOverview()
    } catch (e: any) {
      setResult({ ok: false, error: e.message ?? 'Upload failed', rows_parsed: 0, companies: 0, created: 0, updated: 0, filename: file.name })
    }
    setLoading(false)
  }, [fetchOverview])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="bg-surface-card border-b border-surface-rule px-6 py-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet size={17} className="text-accent" />
          <h1 className="font-display font-bold text-[19px] text-text">Global Wits</h1>
          <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent">
            Trade intelligence
          </span>
        </div>
        <p className="text-[11px] text-text-muted mt-1">
          Trade file imports — each buyer becomes a lead, a company profile, and a market signal.
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[920px] mx-auto p-6 space-y-5">

          {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}

          {overLoading && !hasData && (
            <div className="flex items-center gap-2 py-8 justify-center text-[12px] text-text-faint">
              <Spinner size={16} /> Loading trade data…
            </div>
          )}

          {hasData && (
            <>
              <StatsStrip stats={stats!} />
              {topCountries.length > 0 && <CountryChart countries={topCountries} />}
              {topBuyers.length > 0    && <BuyersGrid buyers={topBuyers} />}
              <ImportGrid imports={imports} onRefresh={fetchOverview} />
            </>
          )}

          <DropZone onFile={handleFile} loading={loading} status={status} hasData={hasData} />

          {!overLoading && !hasData && (
            <div className="text-center py-10 text-[13px] text-text-muted">
              No trade data yet — drop a Global Wits .xlsx file above to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

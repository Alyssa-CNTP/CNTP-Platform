'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  FileSpreadsheet, Upload, CheckCircle2, AlertCircle,
  Loader2, ChevronDown, ChevronUp, Search,
  Truck, Package, Building2, DollarSign, Clock,
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
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
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-wide ${cls}`}>
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

// ── Drop Zone ─────────────────────────────────────────────────────────────────

function DropZone({ onFile, loading, status }: {
  onFile: (f: File) => void; loading: boolean; status: string
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
      className={`rounded-xl border-2 border-dashed p-10 text-center transition-all cursor-pointer select-none
        ${dragging ? 'border-accent bg-accent/5' : 'border-surface-rule hover:border-accent/40 hover:bg-surface-card'}
        ${loading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      <div className="flex flex-col items-center gap-4">
        {loading
          ? <Loader2 size={32} className="animate-spin text-accent" />
          : <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center">
              <FileSpreadsheet size={26} className="text-accent" />
            </div>}
        <div>
          <p className="font-display font-semibold text-[15px] text-text">
            {loading ? status : 'Drop a Global Wits .xlsx here'}
          </p>
          <p className="text-[12px] text-text-muted mt-1">
            {loading ? 'This may take a moment…' : 'hscode · US customs · global shipping · rooibos sheets'}
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-[12px] font-semibold">
            <Upload size={13} /> Choose file
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
      <button onClick={onDismiss} className="text-text-faint hover:text-text text-[18px] leading-none shrink-0">×</button>
    </div>
  )
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-ok/5 border border-ok/20 rounded-xl">
      <CheckCircle2 size={15} className="text-ok shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] text-ok">Saved — {result.filename}</p>
        <p className="text-[11px] text-text-muted mt-0.5">
          {result.rows_parsed.toLocaleString()} rows · {result.companies.toLocaleString()} buyers added to leads, profiles &amp; signals
        </p>
      </div>
      <button onClick={onDismiss} className="text-text-faint hover:text-text text-[18px] leading-none shrink-0">×</button>
    </div>
  )
}

// ── Shipment Timeline ─────────────────────────────────────────────────────────

function ShipmentTimeline({ shipments }: { shipments: Shipment[] }) {
  const sorted = useMemo(() =>
    [...shipments].filter(s => s.date).sort((a, b) => a.date.localeCompare(b.date)),
    [shipments]
  )
  if (!sorted.length) return <p className="text-[11px] text-text-faint py-2">No dated shipments.</p>
  const timestamps = sorted.map(s => new Date(s.date).getTime())
  const minT = Math.min(...timestamps); const maxT = Math.max(...timestamps)
  const range = maxT - minT || 1
  const maxVal = Math.max(...sorted.map(s => s.value_usd), 1)
  const sources = [...new Set(sorted.map(s => s.datasource))]
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {sources.map(s => <span key={s}>{dsChip(s)}</span>)}
        <span className="text-[10px] text-text-faint ml-auto">Dot size = shipment value</span>
      </div>
      <div className="relative overflow-x-auto pb-6" style={{ minHeight: 64 }}>
        <div className="absolute left-0 right-0 bg-surface-rule" style={{ top: 28, height: 1 }} />
        <span className="absolute font-mono text-[9px] text-text-faint" style={{ left: 0, top: 38 }}>{sorted[0]?.date?.slice(0, 7)}</span>
        {sorted.length > 1 && <span className="absolute font-mono text-[9px] text-text-faint" style={{ right: 0, top: 38 }}>{sorted[sorted.length - 1]?.date?.slice(0, 7)}</span>}
        {sorted.map((s, i) => {
          const pct = range > 0 ? ((timestamps[i] - minT) / range) * 96 + 2 : 50
          const diam = 6 + Math.round((s.value_usd / maxVal) * 14)
          const dotCls = s.datasource === 'US Customs' ? 'bg-accent' : s.datasource === 'Global Shipping' ? 'bg-info' : s.datasource === 'Rooibos' ? 'bg-ok' : 'bg-text-muted'
          return <div key={i} title={`${s.date} — ${fmtUsd(s.value_usd)}\n${s.product || ''}`}
            className={`absolute rounded-full ${dotCls} opacity-80 hover:opacity-100 cursor-pointer transition-opacity`}
            style={{ left: `calc(${pct}% - ${diam / 2}px)`, top: 28 - diam / 2, width: diam, height: diam }} />
        })}
      </div>
      {sorted.length > 2 && <MonthlyBars shipments={sorted} />}
    </div>
  )
}

function MonthlyBars({ shipments }: { shipments: Shipment[] }) {
  const months = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of shipments) { const k = s.date?.slice(0, 7) ?? 'x'; m[k] = (m[k] ?? 0) + s.value_usd }
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
            <div className="w-full bg-accent/40 group-hover:bg-accent/70 rounded-sm transition-colors" style={{ height: `${Math.max(3, (val / maxV) * 36)}px` }} />
            <span className="font-mono text-text-faint" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 7 }}>{month.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Expanded Buyer ────────────────────────────────────────────────────────────

function ExpandedBuyer({ name }: { name: string }) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch(`/api/global-wits?company=${encodeURIComponent(name)}`)
      .then(r => r.json()).then(d => { setProfile(d.profile ?? null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [name])
  if (loading) return <div className="flex items-center gap-2 py-4 px-6 text-[12px] text-text-faint"><Spinner /> Loading…</div>
  if (!profile) return <div className="py-3 px-6 text-[12px] text-text-muted">No profile found.</div>
  const pd = profile.panjiva_data
  const sources = [...new Set((pd?.shipments ?? []).map(s => s.datasource))]
  return (
    <div className="px-6 pb-5 pt-4 bg-background border-t border-surface-rule space-y-4">
      <div className="flex items-center gap-8 flex-wrap">
        <div>
          <p className="font-display font-bold text-[22px] text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(pd?.total_value_usd ?? 0)}</p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint">Total value</p>
        </div>
        <div>
          <p className="font-display font-bold text-[22px] text-text">{pd?.shipment_count ?? 0}</p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint">Shipments</p>
        </div>
        {pd?.current_supplier && (
          <div className="min-w-0">
            <p className="text-[13px] text-text font-medium flex items-center gap-1 truncate"><Truck size={11} className="text-text-muted shrink-0" />{pd.current_supplier}</p>
            <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint">Current supplier</p>
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">{sources.map(s => <span key={s}>{dsChip(s)}</span>)}</div>
      </div>
      <div className="bg-surface-card rounded-lg border border-surface-rule p-4">
        <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-3">Shipment timeline</p>
        <ShipmentTimeline shipments={pd?.shipments ?? []} />
      </div>
      {profile.pitch_angle && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/5 border border-accent/15">
          <div className="w-1 self-stretch rounded-full bg-accent/40 shrink-0" />
          <div>
            <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-1">Sales pitch</p>
            <p className="text-[12px] text-text leading-relaxed">{profile.pitch_angle}</p>
          </div>
        </div>
      )}
      {(pd?.shipments?.length ?? 0) > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-2">Recent shipments</p>
          <div className="overflow-x-auto rounded-lg border border-surface-rule">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-surface-rule bg-surface-card">
                  {['Date','Source','Product','Supplier','Value'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-text-faint ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {[...(pd?.shipments ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((s, i) => (
                  <tr key={i} className="hover:bg-surface-card/40 transition-colors">
                    <td className="px-3 py-2 font-mono text-text-faint whitespace-nowrap">{s.date}</td>
                    <td className="px-3 py-2">{dsChip(s.datasource)}</td>
                    <td className="px-3 py-2 text-text-muted max-w-[220px] truncate">{s.product || '—'}</td>
                    <td className="px-3 py-2 text-text-faint max-w-[160px] truncate">{s.supplier || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-accent whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(s.value_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Buyers Grid ───────────────────────────────────────────────────────────────

type SortKey = 'value' | 'name' | 'shipments'

function BuyersGrid({ buyers }: { buyers: TopBuyer[] }) {
  const [sort, setSort] = useState<SortKey>('value')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const maxVal = Math.max(...buyers.map(b => b.value_usd), 1)
  const filtered = useMemo(() =>
    buyers
      .filter(b => !query || b.name.toLowerCase().includes(query.toLowerCase()) || b.country.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => sort === 'value' ? b.value_usd - a.value_usd : sort === 'shipments' ? b.shipments - a.shipments : a.name.localeCompare(b.name)),
    [buyers, sort, query]
  )
  function toggle(name: string) { setExpanded(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s }) }
  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => setSort(k)} className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wide transition-colors ${sort === k ? 'bg-accent text-white' : 'text-text-muted hover:text-text hover:bg-surface-rule'}`}>{label}</button>
  )
  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-rule flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[160px] bg-background border border-surface-rule rounded-lg px-3 py-1.5">
          <Search size={12} className="text-text-faint shrink-0" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search buyers…" className="bg-transparent text-[12px] text-text placeholder-text-faint outline-none w-full" />
        </div>
        <div className="flex items-center gap-1 bg-background border border-surface-rule rounded-lg p-1">
          <SortBtn k="value" label="$ Value" /><SortBtn k="shipments" label="Shipments" /><SortBtn k="name" label="A–Z" />
        </div>
        <span className="font-mono text-[10px] text-text-faint">{filtered.length} buyers</span>
      </div>
      <div className="grid grid-cols-[1fr_120px_80px_80px_32px] px-5 py-2 border-b border-surface-rule bg-background/50">
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint">Company</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint hidden sm:block">Value</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint text-right">Amount</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint text-right">Ships</span>
        <span />
      </div>
      <div className="divide-y divide-surface-rule">
        {filtered.map(b => {
          const open = expanded.has(b.name)
          return (
            <div key={b.name}>
              <button onClick={() => toggle(b.name)} className="w-full grid grid-cols-[1fr_120px_80px_80px_32px] items-center px-5 py-3 hover:bg-background/60 transition-colors group">
                <div className="text-left min-w-0 pr-4">
                  <p className="text-[12px] font-medium text-text truncate">{b.name}</p>
                  <p className="text-[10px] text-text-faint mt-0.5">{b.country}</p>
                </div>
                <div className="hidden sm:flex items-center pr-3">
                  <div className="flex-1 h-1.5 bg-surface-rule rounded-full overflow-hidden">
                    <div className="h-full bg-accent/50 rounded-full group-hover:bg-accent/70 transition-colors" style={{ width: `${(b.value_usd / maxVal) * 100}%` }} />
                  </div>
                </div>
                <span className="font-mono text-[12px] font-semibold text-accent text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(b.value_usd)}</span>
                <span className="font-mono text-[10px] text-text-muted text-right">{b.shipments}</span>
                <div className="flex justify-end text-text-faint group-hover:text-text transition-colors">{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</div>
              </button>
              {open && <ExpandedBuyer name={b.name} />}
            </div>
          )
        })}
        {!filtered.length && <div className="py-10 text-center text-[13px] text-text-muted">No buyers match "{query}"</div>}
      </div>
    </div>
  )
}

// ── Country Chart ─────────────────────────────────────────────────────────────

function CountryChart({ countries }: { countries: CountryRow[] }) {
  const maxCount = Math.max(...countries.map(c => c.count), 1)
  const rowH = 28; const labelW = 130; const barAreaW = 300; const totalW = labelW + barAreaW + 90
  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-rule">
        <p className="font-display font-semibold text-[13px] text-text">Buyers by country</p>
        <p className="text-[10px] text-text-faint mt-0.5">{countries.length} markets · bar = buyer count</p>
      </div>
      <div className="overflow-x-auto p-4">
        <svg width={totalW} height={countries.length * rowH + 8} className="block">
          {countries.map((c, i) => {
            const y = i * rowH + 4; const barW = (c.count / maxCount) * barAreaW
            const opacity = 0.35 + 0.65 * (1 - i / countries.length)
            return (
              <g key={c.country}>
                <text x={labelW - 8} y={y + 11} textAnchor="end" className="fill-current text-text" style={{ fontSize: 11, fontFamily: 'inherit' }}>{c.country || 'Unknown'}</text>
                <rect x={labelW} y={y} width={barAreaW} height={16} rx={3} className="fill-current text-surface-rule" />
                <rect x={labelW} y={y} width={barW} height={16} rx={3} className="fill-current text-accent" style={{ opacity }} />
                <text x={labelW + barW + 8} y={y + 11} className="fill-current text-text-muted" style={{ fontSize: 10, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}>{c.count}</text>
                <text x={labelW + barAreaW + 80} y={y + 11} textAnchor="end" className="fill-current text-accent" style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(c.value_usd)}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ stats, topCountries, topBuyers, loading }: {
  stats: OverviewStats | null; topCountries: CountryRow[]; topBuyers: TopBuyer[]; loading: boolean
}) {
  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-text-faint"><Spinner size={16} /> Loading…</div>
  if (!stats || stats.total_companies === 0) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center text-[13px] text-text-muted">
      No trade data yet — drop a file above to get started.
    </div>
  )
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {([
          { icon: Building2,  label: 'Trade buyers',      value: stats.total_companies.toLocaleString(),  sub: 'unique companies'     },
          { icon: DollarSign, label: 'Total trade value', value: fmtUsd(stats.total_value_usd),           sub: 'across all shipments' },
          { icon: Package,    label: 'Shipment records',  value: stats.total_shipments.toLocaleString(),  sub: 'individual rows'      },
        ] as const).map(s => (
          <div key={s.label} className="bg-surface-card border border-surface-rule rounded-xl px-4 py-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-1">{s.label}</p>
            <p className="font-display font-bold text-[26px] text-text leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
            <p className="text-[10px] text-text-faint mt-1">{s.sub}</p>
          </div>
        ))}
      </div>
      {topCountries.length > 0 && <CountryChart countries={topCountries} />}
      {topBuyers.length > 0    && <BuyersGrid buyers={topBuyers} />}
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab({ imports, loading }: { imports: PastImport[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  function toggle(id: string) { setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-text-faint"><Spinner size={16} /> Loading history…</div>
  if (!imports.length) return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
      <Clock size={28} className="text-text-faint" />
      <p className="text-[13px] text-text-muted">No files imported yet</p>
      <p className="text-[11px] text-text-faint">Switch to Overview and drop a file to get started</p>
    </div>
  )

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_150px_110px_110px_32px] px-5 py-2.5 border-b border-surface-rule bg-background/50">
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint">File name</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint">Imported</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint text-right">Companies</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint text-right">Rows</span>
        <span />
      </div>
      <div className="divide-y divide-surface-rule">
        {imports.map(imp => {
          const open = expanded.has(imp.id)
          return (
            <div key={imp.id}>
              <button onClick={() => toggle(imp.id)}
                className="w-full grid grid-cols-[1fr_150px_110px_110px_32px] items-center px-5 py-3.5 hover:bg-background/60 transition-colors group text-left">
                <div className="flex items-center gap-2.5 min-w-0 pr-4">
                  <div className="w-7 h-7 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                    <FileSpreadsheet size={13} className="text-accent" />
                  </div>
                  <span className="font-mono text-[12px] font-medium text-text truncate">{imp.filename}</span>
                </div>
                <div>
                  <p className="text-[11px] text-text">{fmtDate(imp.created_at)}</p>
                  <p className="font-mono text-[10px] text-text-faint mt-0.5">{fmtTime(imp.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px] font-semibold text-accent" style={{ fontVariantNumeric: 'tabular-nums' }}>{imp.company_count?.toLocaleString() ?? '—'}</p>
                  <p className="font-mono text-[9px] text-text-faint mt-0.5">buyers</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px] font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>{imp.row_count?.toLocaleString() ?? '—'}</p>
                  <p className="font-mono text-[9px] text-text-faint mt-0.5">shipments</p>
                </div>
                <div className="flex justify-end text-text-faint group-hover:text-text transition-colors">
                  {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </div>
              </button>
              {open && (
                <div className="px-5 py-4 border-t border-surface-rule bg-background space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'File',      value: imp.filename,                                          mono: true  },
                      { label: 'Imported',  value: `${fmtDate(imp.created_at)} ${fmtTime(imp.created_at)}`, mono: false },
                      { label: 'Companies', value: imp.company_count?.toLocaleString() ?? '—',            mono: true  },
                      { label: 'Rows',      value: imp.row_count?.toLocaleString() ?? '—',                mono: true  },
                    ].map(s => (
                      <div key={s.label} className="px-3 py-2.5 bg-surface-card border border-surface-rule rounded-lg">
                        <p className="font-mono text-[9px] uppercase tracking-widest text-text-faint mb-1">{s.label}</p>
                        <p className={`text-[12px] font-semibold text-text truncate ${s.mono ? 'font-mono' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  {imp.notes && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-card border border-surface-rule">
                      <div className="w-1 self-stretch rounded-full bg-surface-rule shrink-0" />
                      <p className="text-[11px] text-text-muted leading-relaxed">{imp.notes}</p>
                    </div>
                  )}
                  <p className="text-[10px] text-text-faint">
                    All {imp.company_count?.toLocaleString()} buyers from this file are saved as leads and signals —
                    <a href="/sales" className="text-accent hover:underline ml-1">view in Sales →</a>
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'history'

export default function GlobalWitsPage() {
  const [tab,          setTab]          = useState<Tab>('overview')
  const [loading,      setLoading]      = useState(false)
  const [status,       setStatus]       = useState('')
  const [result,       setResult]       = useState<ImportResult | null>(null)
  const [overLoading,  setOverLoading]  = useState(true)
  const [stats,        setStats]        = useState<OverviewStats | null>(null)
  const [topCountries, setTopCountries] = useState<CountryRow[]>([])
  const [topBuyers,    setTopBuyers]    = useState<TopBuyer[]>([])
  const [imports,      setImports]      = useState<PastImport[]>([])

  const fetchOverview = useCallback(async () => {
    setOverLoading(true)
    try {
      const r = await fetch('/api/global-wits'); const d = await r.json()
      setStats(d.stats ?? null); setTopCountries(d.top_countries ?? []); setTopBuyers(d.top_buyers ?? []); setImports(d.imports ?? [])
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
      const r = await fetch('/api/global-wits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, filename: file.name }) })
      const d = await r.json()
      setResult(d.error ? { ok: false, error: d.error, rows_parsed: 0, companies: 0, created: 0, updated: 0, filename: file.name } : { ...d, ok: true })
      if (!d.error) { fetchOverview(); setTab('history') }
    } catch (e: any) {
      setResult({ ok: false, error: e.message ?? 'Upload failed', rows_parsed: 0, companies: 0, created: 0, updated: 0, filename: file.name })
    }
    setLoading(false)
  }, [fetchOverview])

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="bg-surface-card border-b border-surface-rule px-6 py-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet size={17} className="text-accent" />
          <h1 className="font-display font-bold text-[19px] text-text">Global Wits</h1>
          <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent">Trade intelligence</span>
        </div>
        <p className="text-[11px] text-text-muted mt-1">Import trade files — each buyer becomes a lead, a company profile, and a market signal.</p>
        <div className="flex items-center gap-1 mt-4">
          {([
            { key: 'overview' as Tab, label: 'Overview' },
            { key: 'history'  as Tab, label: 'History', count: imports.length || null },
          ]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors
                ${tab === t.key ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text hover:bg-surface-rule'}`}>
              {t.label}
              {t.count != null && (
                <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-accent/20 text-accent' : 'bg-surface-rule text-text-faint'}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[960px] mx-auto p-6 space-y-5">
          {tab === 'overview' && (
            <>
              <DropZone onFile={handleFile} loading={loading} status={status} />
              {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}
              <OverviewTab stats={stats} topCountries={topCountries} topBuyers={topBuyers} loading={overLoading} />
            </>
          )}
          {tab === 'history' && <HistoryTab imports={imports} loading={overLoading} />}
        </div>
      </div>
    </div>
  )
}

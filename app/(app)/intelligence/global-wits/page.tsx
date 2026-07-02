'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  FileSpreadsheet, Upload, CheckCircle2, AlertCircle,
  Loader2, Building2, Globe2, TrendingUp, FileText,
  ArrowRight, RefreshCw, X, ChevronRight, DollarSign,
  Package, MapPin, Truck,
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
interface Shipment     { date: string; datasource: string; supplier: string; hs_code: string; product: string; value_usd: number; weight_kg: number }
interface CompanyProfile {
  company_name: string; country: string; pitch_angle: string; last_enriched: string
  panjiva_data: { shipments: Shipment[]; total_value_usd: number; shipment_count: number; current_supplier: string }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m ago`; if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}
function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}
function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-accent" />
}

// ── xlsx parsing (browser only) ───────────────────────────────────────────────

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
    if (low.includes('hscode') || low.includes('rooibos')) out.push(...normHscode(data, low.includes('rooibos') ? 'Rooibos' : ''))
    else if (low === 'us')                                  out.push(...normUs(data))
    else if (low.includes('global') || low.includes('shipping')) out.push(...normGlobal(data))
  }
  return out
}

// ── DropZone ──────────────────────────────────────────────────────────────────

function DropZone({ onFile, loading, status }: { onFile: (f: File) => void; loading: boolean; status: string }) {
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
      className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all select-none
        ${dragging ? 'border-accent bg-accent/5' : 'border-surface-rule hover:border-accent/50 hover:bg-surface-card'}
        ${loading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      <div className="flex items-center justify-center gap-4">
        {loading
          ? <Loader2 size={22} className="animate-spin text-accent shrink-0" />
          : <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0"><FileSpreadsheet size={20} className="text-accent" /></div>}
        <div className="text-left">
          <p className="font-display font-semibold text-[14px] text-text">{loading ? status : 'Drop a Global Wits .xlsx here'}</p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {loading ? 'This may take a moment…' : 'hscode · US customs · global shipping · rooibos sheets'}
          </p>
        </div>
        {!loading && (
          <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[11px] font-semibold shrink-0">
            <Upload size={11} /> Choose file
          </div>
        )}
      </div>
    </div>
  )
}

// ── ResultBanner ──────────────────────────────────────────────────────────────

function ResultBanner({ result }: { result: ImportResult }) {
  if (!result.ok) return (
    <div className="flex items-start gap-3 p-4 bg-danger/5 border border-danger/20 rounded-xl">
      <AlertCircle size={15} className="text-danger shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-[13px] text-danger">Import failed</p>
        <p className="text-[12px] text-text-muted mt-0.5">{result.error}</p>
      </div>
    </div>
  )
  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-ok/5 border border-ok/20 rounded-xl">
      <CheckCircle2 size={16} className="text-ok shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] text-ok truncate">Import complete — {result.filename}</p>
        <p className="text-[11px] text-text-muted mt-0.5">
          {result.rows_parsed.toLocaleString()} shipment rows · {result.companies.toLocaleString()} unique buyers → leads, profiles &amp; signals
        </p>
      </div>
      <a href="/sales" className="shrink-0 flex items-center gap-1 text-[11px] text-accent font-medium hover:underline">
        View Sales <ArrowRight size={11} />
      </a>
    </div>
  )
}

// ── Company Drill-down Panel ──────────────────────────────────────────────────

function CompanyPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/global-wits?company=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(d => { setProfile(d.profile ?? null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [name])

  const pd = profile?.panjiva_data

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative w-full max-w-[560px] h-full bg-surface-card border-l border-surface-rule flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-surface-rule flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="font-display font-bold text-[16px] text-text truncate">{name}</p>
            {profile && <p className="text-[11px] text-text-muted mt-0.5 flex items-center gap-1"><MapPin size={10} />{profile.country}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-rule transition-colors shrink-0">
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size={20} />
          </div>
        )}

        {!loading && !profile && (
          <div className="flex-1 flex items-center justify-center text-[13px] text-text-muted">No profile found.</div>
        )}

        {!loading && profile && pd && (
          <div className="flex-1 overflow-y-auto">
            {/* Stats */}
            <div className="grid grid-cols-3 divide-x divide-surface-rule border-b border-surface-rule">
              {[
                { label: 'Shipments', value: pd.shipment_count?.toLocaleString() ?? '—' },
                { label: 'Total value', value: fmtUsd(pd.total_value_usd ?? 0) },
                { label: 'Supplier', value: pd.current_supplier || '—' },
              ].map(s => (
                <div key={s.label} className="px-4 py-3">
                  <p className="font-display font-bold text-[18px] text-text truncate">{s.value}</p>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-text-muted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Pitch angle */}
            {profile.pitch_angle && (
              <div className="mx-4 mt-4 p-3 bg-accent/5 border border-accent/20 rounded-lg">
                <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-1">Pitch angle</p>
                <p className="text-[12px] text-text leading-relaxed">{profile.pitch_angle}</p>
              </div>
            )}

            {/* Shipment table */}
            <div className="px-4 mt-4 pb-6">
              <p className="font-display font-semibold text-[12px] text-text mb-2">Shipment history</p>
              <div className="space-y-2">
                {(pd.shipments ?? []).map((s, i) => (
                  <div key={i} className="px-3 py-2.5 bg-background border border-surface-rule rounded-lg">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[9px] text-text-faint shrink-0">{s.date || '—'}</span>
                        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-surface-rule text-text-muted shrink-0">{s.datasource}</span>
                      </div>
                      <span className="font-mono text-[11px] font-semibold text-accent shrink-0">{fmtUsd(s.value_usd)}</span>
                    </div>
                    {s.product && <p className="text-[11px] text-text-muted mt-1 leading-snug truncate">{s.product}</p>}
                    {s.supplier && <p className="text-[10px] text-text-faint mt-0.5 flex items-center gap-1"><Truck size={9} />{s.supplier}</p>}
                    {s.hs_code  && <p className="text-[10px] text-text-faint mt-0.5 flex items-center gap-1"><Package size={9} />HS {s.hs_code}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Trade Overview (loaded from DB) ──────────────────────────────────────────

function TradeOverview({
  stats, topCountries, topBuyers, imports, loading, onRefresh, onSelectCompany,
}: {
  stats: OverviewStats | null
  topCountries: CountryRow[]
  topBuyers: TopBuyer[]
  imports: PastImport[]
  loading: boolean
  onRefresh: () => void
  onSelectCompany: (name: string) => void
}) {
  if (loading) return (
    <div className="flex items-center gap-2 py-6 text-[12px] text-text-faint"><Spinner /> Loading trade overview…</div>
  )
  if (!stats || stats.total_companies === 0) return null

  const maxCount = Math.max(...topCountries.map(c => c.count), 1)

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Building2,  color: 'text-accent', label: 'Trade buyers',    value: stats.total_companies.toLocaleString() },
          { icon: DollarSign, color: 'text-ok',     label: 'Total value',     value: fmtUsd(stats.total_value_usd) },
          { icon: Package,    color: 'text-info',   label: 'Shipment records', value: stats.total_shipments.toLocaleString() },
        ].map(({ icon: Icon, color, label, value }) => (
          <div key={label} className="p-4 bg-surface-card border border-surface-rule rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={13} className={color} />
              <span className="font-mono text-[9px] uppercase tracking-widest text-text-muted">{label}</span>
            </div>
            <p className={`font-display font-bold text-[22px] ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Country breakdown */}
        <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-rule flex items-center gap-2">
            <Globe2 size={13} className="text-text-muted" />
            <span className="font-display font-semibold text-[12px] text-text">By country</span>
          </div>
          <div className="p-3 space-y-1.5">
            {topCountries.map(c => (
              <div key={c.country}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] text-text truncate max-w-[160px]">{c.country || 'Unknown'}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] text-text-muted">{c.count} buyers</span>
                    <span className="font-mono text-[10px] text-accent">{fmtUsd(c.value_usd)}</span>
                  </div>
                </div>
                <div className="h-1 bg-surface-rule rounded-full overflow-hidden">
                  <div className="h-full bg-accent/40 rounded-full" style={{ width: `${(c.count / maxCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top buyers */}
        <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-rule flex items-center gap-2">
            <TrendingUp size={13} className="text-text-muted" />
            <span className="font-display font-semibold text-[12px] text-text">Top buyers by value</span>
          </div>
          <div className="divide-y divide-surface-rule">
            {topBuyers.map(b => (
              <button
                key={b.name}
                onClick={() => onSelectCompany(b.name)}
                className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-background transition-colors text-left group"
              >
                <div className="min-w-0">
                  <p className="text-[12px] text-text font-medium truncate">{b.name}</p>
                  <p className="text-[10px] text-text-faint mt-0.5">{b.country} · {b.shipments} shipment{b.shipments !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="font-mono text-[11px] font-semibold text-accent">{fmtUsd(b.value_usd)}</span>
                  <ChevronRight size={11} className="text-text-faint group-hover:text-accent transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Import history */}
      {imports.length > 0 && (
        <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-rule flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={13} className="text-text-muted" />
              <span className="font-display font-semibold text-[12px] text-text">Import history</span>
            </div>
            <button onClick={onRefresh} className="text-text-faint hover:text-text"><RefreshCw size={11} /></button>
          </div>
          <div className="divide-y divide-surface-rule">
            {imports.map(imp => (
              <div key={imp.id} className="px-4 py-2.5 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-text font-medium truncate">{imp.filename}</p>
                  <p className="text-[10px] text-text-faint mt-0.5">{imp.notes}</p>
                </div>
                <div className="text-right shrink-0 ml-4">
                  {imp.company_count != null && <p className="font-mono text-[10px] text-accent font-medium">{imp.company_count} companies</p>}
                  <p className="font-mono text-[10px] text-text-faint">{timeAgo(imp.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
  const [selected,     setSelected]     = useState<string | null>(null)

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet size={17} className="text-accent" />
              <h1 className="font-display font-bold text-[19px] text-text">Global Wits</h1>
              <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent">Trade intelligence</span>
            </div>
            <p className="text-[11px] text-text-muted mt-1">Drop a trade file — buyers become leads, profiles, and signals automatically.</p>
          </div>
          <a href="/sales" className="hidden sm:flex items-center gap-1.5 text-[11px] text-text-muted hover:text-accent transition-colors">
            Sales pipeline <ArrowRight size={11} />
          </a>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[900px] mx-auto p-6 space-y-5">
          <DropZone onFile={handleFile} loading={loading} status={status} />
          {result && <ResultBanner result={result} />}
          <TradeOverview
            stats={stats} topCountries={topCountries} topBuyers={topBuyers}
            imports={imports} loading={overLoading}
            onRefresh={fetchOverview} onSelectCompany={setSelected}
          />
        </div>
      </div>

      {/* Company drill-down panel */}
      {selected && <CompanyPanel name={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

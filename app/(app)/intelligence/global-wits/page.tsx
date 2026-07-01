'use client'

// app/(app)/intelligence/global-wits/page.tsx
// Drop a Global Wits trade .xlsx → parse buyers → save as leads, company profiles, trade signals

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  FileSpreadsheet, Upload, CheckCircle2, AlertCircle,
  Loader2, Building2, Globe2, TrendingUp, FileText,
  ArrowRight, RefreshCw,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImportResult {
  ok:          boolean
  rows_parsed: number
  companies:   number
  created:     number
  updated:     number
  filename:    string
  error?:      string
}

interface PastImport {
  id:            string
  filename:      string
  row_count:     number | null
  company_count: number | null
  notes:         string | null
  created_at:    string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60)   return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

function Spinner() {
  return <Loader2 size={14} className="animate-spin text-accent" />
}

// ─── Drop zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile, loading }: { onFile: (f: File) => void; loading: boolean }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
      className={`relative rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all select-none ${
        dragging
          ? 'border-accent bg-accent/5'
          : 'border-surface-rule hover:border-accent/50 hover:bg-surface-card'
      } ${loading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
      <div className="flex flex-col items-center gap-3">
        {loading ? (
          <Loader2 size={32} className="animate-spin text-accent" />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center">
            <FileSpreadsheet size={26} className="text-accent" />
          </div>
        )}
        <div>
          <p className="font-display font-semibold text-[15px] text-text">
            {loading ? 'Importing…' : 'Drop a Global Wits .xlsx here'}
          </p>
          <p className="text-[12px] text-text-muted mt-1">
            {loading
              ? 'Parsing shipment rows, creating leads and trade signals…'
              : 'Or click to browse — supports hscode, US customs, global shipping, and rooibos sheets'}
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-[12px] font-semibold">
            <Upload size={13} /> Choose file
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Result banner ────────────────────────────────────────────────────────────

function ResultBanner({ result }: { result: ImportResult }) {
  if (!result.ok) {
    return (
      <div className="flex items-start gap-3 p-4 bg-danger/5 border border-danger/20 rounded-xl">
        <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[13px] text-danger">Import failed</p>
          <p className="text-[12px] text-text-muted mt-0.5">{result.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-surface-rule flex items-center gap-2 bg-ok/5">
        <CheckCircle2 size={15} className="text-ok" />
        <span className="font-semibold text-[13px] text-ok">Import complete — {result.filename}</span>
      </div>
      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Shipment rows" value={result.rows_parsed} />
        <Stat label="Unique buyers" value={result.companies} />
        <Stat label="New leads" value={result.created} accent />
        <Stat label="Updated" value={result.updated} />
      </div>
      <div className="px-5 pb-4">
        <p className="text-[12px] text-text-muted">
          Each buyer now has a company profile, an account at <strong>Lead</strong> stage, and a trade signal in the signal feed.
          {' '}<a href="/sales" className="text-accent hover:underline">View in Sales →</a>
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <p className={`font-display font-bold text-[24px] ${accent ? 'text-accent' : 'text-text'}`}>
        {value.toLocaleString()}
      </p>
      <p className="font-mono text-[10px] text-text-muted uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  )
}

// ─── Past imports list ────────────────────────────────────────────────────────

function PastImports({ imports, loading, onRefresh }: { imports: PastImport[]; loading: boolean; onRefresh: () => void }) {
  if (loading) return <div className="text-[12px] text-text-faint flex items-center gap-2"><Spinner /> Loading import history…</div>
  if (imports.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-[13px] text-text">Previous imports</h3>
        <button onClick={onRefresh} className="text-text-faint hover:text-text">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="space-y-2">
        {imports.map(imp => (
          <div key={imp.id} className="flex items-center justify-between px-4 py-3 bg-surface-card border border-surface-rule rounded-xl">
            <div className="flex items-center gap-3">
              <FileText size={14} className="text-text-muted shrink-0" />
              <div>
                <p className="font-mono text-[12px] text-text font-medium">{imp.filename}</p>
                <p className="text-[11px] text-text-faint mt-0.5">{imp.notes}</p>
              </div>
            </div>
            <div className="text-right shrink-0 ml-4">
              {imp.company_count != null && (
                <p className="font-mono text-[11px] text-accent font-medium">{imp.company_count} companies</p>
              )}
              <p className="font-mono text-[10px] text-text-faint">{timeAgo(imp.created_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── What this does explainer ─────────────────────────────────────────────────

function Explainer() {
  const items = [
    { icon: FileSpreadsheet, color: 'text-accent',   label: 'Parse all sheets',    desc: 'Reads hscode, US customs, global shipping, and rooibos sheets automatically' },
    { icon: Building2,       color: 'text-info',     label: 'Company profiles',    desc: 'Each unique PURCHASER / CONSIGNEE becomes a company profile with shipment history (Panjiva layer)' },
    { icon: TrendingUp,      color: 'text-ok',       label: 'Sales leads',         desc: 'Every buyer lands in your accounts pipeline at Lead stage with current supplier and a suggested pitch angle' },
    { icon: Globe2,          color: 'text-warn',     label: 'Trade signals',       desc: 'A trade signal per company flows into the signal feed so they surface alongside news and social intel' },
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map(({ icon: Icon, color, label, desc }) => (
        <div key={label} className="flex items-start gap-3 p-4 bg-surface-card border border-surface-rule rounded-xl">
          <Icon size={16} className={`${color} shrink-0 mt-0.5`} />
          <div>
            <p className="font-semibold text-[13px] text-text">{label}</p>
            <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">{desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GlobalWitsPage() {
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<ImportResult | null>(null)
  const [imports,  setImports]  = useState<PastImport[]>([])
  const [histLoad, setHistLoad] = useState(true)

  const fetchHistory = useCallback(async () => {
    setHistLoad(true)
    try {
      const r = await fetch('/api/global-wits')
      const d = await r.json()
      setImports(d.imports ?? [])
    } catch {}
    setHistLoad(false)
  }, [])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/global-wits', { method: 'POST', body: fd })
      const d = await r.json()
      setResult(d.error ? { ok: false, error: d.error, rows_parsed: 0, companies: 0, created: 0, updated: 0, filename: file.name } : { ...d, ok: true })
      if (!d.error) fetchHistory()
    } catch (e: any) {
      setResult({ ok: false, error: e.message ?? 'Upload failed', rows_parsed: 0, companies: 0, created: 0, updated: 0, filename: file.name })
    }
    setLoading(false)
  }, [fetchHistory])

  return (
    <div className="flex flex-col h-full bg-background">

      {/* Header */}
      <div className="bg-surface-card border-b border-surface-rule px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet size={18} className="text-accent" />
              <h1 className="font-display font-bold text-[20px] text-text">Global Wits</h1>
              <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent">
                Trade intelligence
              </span>
            </div>
            <p className="text-[12px] text-text-muted mt-1">
              Drop a Global Wits trade file — buyers become leads, profiles, and trade signals automatically.
            </p>
          </div>
          <a
            href="/sales"
            className="hidden sm:flex items-center gap-1.5 text-[12px] text-text-muted hover:text-accent transition-colors"
          >
            View Sales pipeline <ArrowRight size={12} />
          </a>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[860px] mx-auto p-6 space-y-6">

          <DropZone onFile={handleFile} loading={loading} />

          {result && <ResultBanner result={result} />}

          <Explainer />

          <PastImports imports={imports} loading={histLoad} onRefresh={fetchHistory} />

        </div>
      </div>
    </div>
  )
}

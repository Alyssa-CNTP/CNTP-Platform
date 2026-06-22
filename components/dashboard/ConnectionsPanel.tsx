'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { Database, Server, Link as LinkIcon, RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

interface HealthData {
  supabase: {
    ok:        boolean
    latencyMs: number | null
    message:   string
  }
  vps: {
    ok:        boolean
    latencyMs: number | null
    message:   string
  }
  acumatica: {
    ok:        boolean
    lastSync:  string | null
    itemCount: number | null
    message:   string
  }
}

// ── Latency bar ───────────────────────────────────────────────────────────────
function LatencyBar({ ms }: { ms: number }) {
  // 0–50ms: green, 50–150ms: amber, 150+: red
  const pct   = Math.min(ms / 500 * 100, 100)
  const color = ms < 50 ? 'bg-ok' : ms < 150 ? 'bg-amber-400' : 'bg-err'
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-text-muted w-12 text-right">{ms} ms</span>
    </div>
  )
}

// ── Status dot ─────────────────────────────────────────────────────────────────
function StatusDot({ ok, loading }: { ok: boolean; loading: boolean }) {
  if (loading) return <span className="w-2.5 h-2.5 rounded-full bg-text-faint animate-pulse" />
  return ok
    ? <span className="relative flex w-2.5 h-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-40" />
        <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-ok" />
      </span>
    : <span className="w-2.5 h-2.5 rounded-full bg-err" />
}

// ── Single connection card ────────────────────────────────────────────────────
interface CardProps {
  icon:     React.ReactNode
  title:    string
  ok:       boolean | null
  latency?: number | null
  details:  string
  sub?:     string
  loading:  boolean
  accent:   string   // tailwind bg color class
}

function ConnectionCard({ icon, title, ok, latency, details, sub, loading, accent }: CardProps) {
  return (
    <div className={`
      rounded-xl border p-4 flex flex-col gap-3
      ${ok === true  ? 'border-ok/20 bg-ok/3'   :
        ok === false ? 'border-err/20 bg-err/3'  :
                       'border-surface-rule bg-surface'}
    `}>
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg ${accent} flex items-center justify-center`}>
            {icon}
          </div>
          <span className="font-display font-bold text-[13px] text-text">{title}</span>
        </div>
        <StatusDot ok={ok ?? false} loading={loading} />
      </div>

      {/* Details */}
      <div>
        <div className="font-mono text-[12px] text-text">
          {loading ? <span className="animate-pulse">Checking…</span> : details}
        </div>
        {sub && !loading && (
          <div className="font-mono text-[10px] text-text-muted mt-0.5">{sub}</div>
        )}
      </div>

      {/* Latency bar */}
      {latency != null && !loading && ok && (
        <LatencyBar ms={latency} />
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ConnectionsPanel() {
  const [data,        setData]        = useState<HealthData | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const check = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/health/connections', { cache: 'no-store' })
      if (r.ok) {
        setData(await r.json())
        setLastChecked(new Date())
      }
    } catch {
      // network error — keep existing data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    check()
    const interval = setInterval(check, 60_000)
    return () => clearInterval(interval)
  }, [check])

  const d = data

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-surface-rule flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LinkIcon size={14} className="text-indigo-500" />
          <span className="font-display font-bold text-[14px] text-text">System Connections</span>
        </div>
        <div className="flex items-center gap-3">
          {lastChecked && (
            <span className="font-mono text-[10px] text-text-faint hidden sm:block">
              Last checked {format(lastChecked, 'HH:mm:ss')}
            </span>
          )}
          <button
            onClick={check}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surface-raised border border-surface-rule font-mono text-[10px] text-text-muted transition-colors"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            Check now
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* Supabase */}
        <ConnectionCard
          icon={<Database size={15} className="text-emerald-600" />}
          title="Supabase"
          ok={d?.supabase.ok ?? null}
          latency={d?.supabase.latencyMs}
          details={
            d?.supabase.ok
              ? `Connected · ${d.supabase.latencyMs ?? '?'}ms`
              : d?.supabase.message ?? 'Checking…'
          }
          sub="PostgreSQL · Row-level security active"
          loading={loading}
          accent="bg-emerald-50"
        />

        {/* VPS / Research Engine */}
        <ConnectionCard
          icon={<Server size={15} className="text-indigo-600" />}
          title="VPS · Research Engine"
          ok={d?.vps.ok ?? null}
          latency={d?.vps.latencyMs}
          details={
            d?.vps.ok
              ? `Online · ${d.vps.latencyMs ?? '?'}ms`
              : d?.vps.message ?? 'Checking…'
          }
          sub="154.65.97.200 · ChromaDB + Ollama"
          loading={loading}
          accent="bg-indigo-50"
        />

        {/* Acumatica */}
        <ConnectionCard
          icon={<LinkIcon size={15} className="text-amber-600" />}
          title="Acumatica ERP"
          ok={d?.acumatica.ok ?? null}
          details={
            d?.acumatica.ok
              ? d?.acumatica.message ?? 'Synced'
              : d?.acumatica.message ?? 'Checking…'
          }
          sub={
            d?.acumatica.lastSync
              ? `Last sync: ${format(parseISO(d.acumatica.lastSync), 'd MMM yyyy HH:mm')} · ${d.acumatica.itemCount?.toLocaleString('en-ZA')} inventory items`
              : d?.acumatica.itemCount != null
                ? `${d.acumatica.itemCount.toLocaleString('en-ZA')} inventory items synced`
                : 'Inventory integration active'
          }
          loading={loading}
          accent="bg-amber-50"
        />
      </div>

      {/* Status summary bar */}
      {!loading && d && (
        <div className={`
          mx-4 mb-4 px-4 py-2.5 rounded-xl flex items-center gap-2
          ${d.supabase.ok && d.acumatica.ok
            ? 'bg-ok/6 border border-ok/15'
            : 'bg-warn/6 border border-warn/15'}
        `}>
          {d.supabase.ok && d.acumatica.ok
            ? <CheckCircle2 size={13} className="text-ok shrink-0" />
            : <AlertCircle  size={13} className="text-warn shrink-0" />
          }
          <span className="font-mono text-[11px] text-text-muted">
            {[
              d.supabase.ok  ? 'Database online' : 'Database offline',
              d.vps.ok       ? 'Research engine online' : 'Research engine offline',
              d.acumatica.ok ? 'Acumatica synced' : 'Acumatica: check required',
            ].join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}

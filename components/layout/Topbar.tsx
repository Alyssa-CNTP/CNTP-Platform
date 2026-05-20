'use client'

// components/layout/Topbar.tsx
//
// Department-aware topbar.
// variant='default'     — Operations / Admin pages (unchanged, matches existing style)
// variant='management'  — Management pages (purple tint on status chip)
// variant='sales'       — Sales pages (amber accent, live data indicator, Acumatica sync status)
// variant='research'    — Research engine (green, engine status, feed count)
//
// Adding 'sales' as a first-class variant means:
// - Sales reps who log in see a topbar styled to their context
// - Acumatica sync status shows inline (last sync time + ok/error)
// - Works identically on VPS — no static assets, pure React + CSS vars

import { Menu, Beaker, RefreshCw, TrendingUp, BarChart2, Database } from 'lucide-react'
import { format } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

type Chip = { label: string; color: 'green' | 'amber' | 'gray' | 'blue' | 'red' | 'purple' }

interface TopbarProps {
  title:           string
  onMobileMenu:    () => void
  chips?:          Chip[]
  variant?:        'default' | 'research' | 'sales' | 'management'
  // Research props
  engineState?:    'ready' | 'processing' | 'offline'
  signalCount?:    number
  onRefreshFeed?:  () => void
  feedRefreshing?: boolean
  // Sales props
  acumaticaSync?:  'ok' | 'error' | 'syncing' | null   // Acumatica last sync status
  lastSyncTime?:   string                               // e.g. "2 min ago"
  ytdRevenue?:     string                               // e.g. "R70.5M" — shows in sales topbar
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const chipColors: Record<string, string> = {
  green:  'bg-status-okBg text-status-ok border border-status-ok/30',
  amber:  'bg-status-warnBg text-status-warn border border-status-warn/30',
  blue:   'bg-status-infoBg text-status-info border border-status-info/30',
  red:    'bg-red-50 text-red-600 border border-red-200',
  purple: 'bg-purple-50 text-purple-600 border border-purple-200',
  gray:   'bg-surface text-text-muted border border-surface-rule',
}

const engineStatusConfig = {
  ready:      { label: 'Engine ready',  dot: 'bg-green-400',               text: 'text-green-600'  },
  processing: { label: 'Processing…',   dot: 'bg-amber-400 animate-ping',  text: 'text-amber-600'  },
  offline:    { label: 'Brain offline', dot: 'bg-red-400',                 text: 'text-red-600'    },
}

const syncStatusConfig = {
  ok:      { label: 'Acumatica synced', dot: 'bg-green-400',  text: 'text-green-600'  },
  syncing: { label: 'Syncing…',         dot: 'bg-amber-400 animate-ping', text: 'text-amber-500' },
  error:   { label: 'Sync error',       dot: 'bg-red-400',    text: 'text-red-600'    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function Topbar({
  title, onMobileMenu, chips = [],
  variant      = 'default',
  engineState  = 'ready',
  signalCount  = 0,
  onRefreshFeed,
  feedRefreshing = false,
  acumaticaSync  = null,
  lastSyncTime,
  ytdRevenue,
}: TopbarProps) {
  const today = format(new Date(), 'EEE d MMM yyyy')

  // ── Mobile trigger (shared) ──────────────────────────────────────────────
  const MobileBtn = () => (
    <button
      onClick={onMobileMenu}
      className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg
        text-text-muted hover:text-text hover:bg-surface transition-colors"
      aria-label="Open menu"
    >
      <Menu size={18} />
    </button>
  )

  // ── Divider ─────────────────────────────────────────────────────────────
  const Div = () => <div className="w-px h-4 bg-gray-100" />

  // ════════════════════════════════════════════════════════════════════════
  // RESEARCH variant
  // ════════════════════════════════════════════════════════════════════════
  if (variant === 'research') {
    const status = engineStatusConfig[engineState]
    return (
      <header className="h-[52px] bg-white border-b border-gray-100 flex items-center px-4 gap-3 flex-shrink-0">
        <MobileBtn />

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
            <Beaker size={14} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 leading-none">Research Engine</h1>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">Rooibos · Rosehip Intelligence</p>
          </div>
        </div>

        <div className="flex-1" />

        <div className="hidden sm:flex items-center gap-3">
          {signalCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">{signalCount} signals</span>
              {onRefreshFeed && (
                <button onClick={onRefreshFeed} disabled={feedRefreshing}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400
                    hover:text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-30">
                  <RefreshCw size={11} className={feedRefreshing ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
          )}
          <Div />
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
            <span className={`text-[11px] font-medium ${status.text}`}>{status.label}</span>
          </div>
          <Div />
          <span className="font-mono text-[11px] text-gray-400">{today}</span>
        </div>
      </header>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // SALES variant
  // ════════════════════════════════════════════════════════════════════════
  if (variant === 'sales') {
    const syncMeta = acumaticaSync ? syncStatusConfig[acumaticaSync] : null

    return (
      <header className="h-[52px] bg-white border-b border-amber-100/60 flex items-center px-4 gap-3 flex-shrink-0">
        <MobileBtn />

        {/* Icon + title */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
            <TrendingUp size={14} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 leading-none">{title}</h1>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">
              CNTP · Sales Intelligence Portal
            </p>
          </div>
        </div>

        <div className="flex-1" />

        <div className="hidden sm:flex items-center gap-3">

          {/* YTD Revenue pill — shows your real number */}
          {ytdRevenue && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-100">
              <span className="text-[10px] text-amber-500 font-mono">YTD</span>
              <span className="text-[11px] font-semibold text-amber-700">{ytdRevenue}</span>
            </div>
          )}

          <Div />

          {/* Acumatica sync status — shown when wired up */}
          {syncMeta && (
            <>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
                <Database size={10} className="text-gray-400" />
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${syncMeta.dot}`} />
                <span className={`text-[11px] font-medium ${syncMeta.text}`}>{syncMeta.label}</span>
                {lastSyncTime && <span className="text-[10px] text-gray-400 ml-1">{lastSyncTime}</span>}
              </div>
              <Div />
            </>
          )}

          {/* Static data indicator when Acumatica not yet wired */}
          {!syncMeta && (
            <>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-50 border border-gray-100">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-[10px] font-mono text-gray-400">STATIC DATA</span>
              </div>
              <Div />
            </>
          )}

          {/* Chips */}
          {chips.map((chip, i) => (
            <span key={i} className={`font-mono text-[10px] tracking-[.5px] px-2.5 py-1 rounded-md ${chipColors[chip.color]}`}>
              {chip.label}
            </span>
          ))}

          <span className="font-mono text-[11px] text-gray-400">{today}</span>
        </div>
      </header>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // MANAGEMENT variant
  // ════════════════════════════════════════════════════════════════════════
  if (variant === 'management') {
    return (
      <header className="h-[52px] bg-white border-b border-purple-100/60 flex items-center px-4 gap-3 flex-shrink-0">
        <MobileBtn />

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center">
            <BarChart2 size={14} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 leading-none">{title}</h1>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">CNTP · Management</p>
          </div>
        </div>

        <div className="flex-1" />

        <div className="hidden sm:flex items-center gap-3">
          {chips.map((chip, i) => (
            <span key={i} className={`font-mono text-[10px] tracking-[.5px] px-2.5 py-1 rounded-md ${chipColors[chip.color]}`}>
              {chip.label}
            </span>
          ))}
          <span className="font-mono text-[11px] text-gray-400">{today}</span>
        </div>
      </header>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // DEFAULT variant — Operations / Admin (unchanged from original)
  // ════════════════════════════════════════════════════════════════════════
  return (
    <header className="h-[52px] bg-surface-card border-b border-surface-rule flex items-center px-4 gap-3 flex-shrink-0">
      <MobileBtn />

      <h1 className="font-display font-bold text-xl text-text tracking-[0.3px]">
        {title}
      </h1>

      <div className="flex-1" />

      <div className="hidden sm:flex items-center gap-2">
        {chips.map((chip, i) => (
          <span key={i} className={`font-mono text-[10px] tracking-[.5px] px-2.5 py-1 rounded-md ${chipColors[chip.color]}`}>
            {chip.label}
          </span>
        ))}
        <span className="font-mono text-[10px] tracking-[.5px] px-2.5 py-1 rounded-md bg-surface text-text-muted border border-surface-rule">
          {today}
        </span>
      </div>
    </header>
  )
}
'use client'

// components/layout/Topbar.tsx
// Unified topbar — same base shell across all variants, departmental accent layer on top.
// Height: 52px fixed. Background: warm #FAFAF9 glass. Dark sidebar complement.
// variant='default'     — Operations / Quality / Admin
// variant='research'    — Research / Intelligence (teal accent)
// variant='sales'       — Sales pages (amber, Acumatica status, YTD)
// variant='management'  — Management (violet accent)

import { Menu, Beaker, RefreshCw, TrendingUp, BarChart2, Database, Activity } from 'lucide-react'
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
  acumaticaSync?:  'ok' | 'error' | 'syncing' | null
  lastSyncTime?:   string
  ytdRevenue?:     string
  // Extra right-side slot (e.g. NotificationBell)
  rightSlot?:      React.ReactNode
}

// ─── Shared shell ─────────────────────────────────────────────────────────────

// Accent definitions per variant
const VARIANT_ACCENT = {
  default:    { iconBg: 'rgba(14,32,14,0.08)',  iconBorder: 'rgba(14,32,14,0.12)',  dot: '#2E7D32', dotBg: 'rgba(46,125,50,0.08)',  sub: 'Operations' },
  research:   { iconBg: 'rgba(45,212,191,0.10)', iconBorder: 'rgba(45,212,191,0.2)', dot: '#0d9488', dotBg: 'rgba(13,148,136,0.08)', sub: 'Market Intelligence' },
  sales:      { iconBg: 'rgba(251,191,36,0.10)', iconBorder: 'rgba(251,191,36,0.2)', dot: '#d97706', dotBg: 'rgba(217,119,6,0.08)',  sub: 'Sales Intelligence' },
  management: { iconBg: 'rgba(167,139,250,0.10)', iconBorder: 'rgba(167,139,250,0.2)', dot: '#7c3aed', dotBg: 'rgba(124,58,237,0.08)', sub: 'Management' },
}

const VARIANT_ICON = {
  default:    Activity,
  research:   Beaker,
  sales:      TrendingUp,
  management: BarChart2,
}

const engineStatusConfig = {
  ready:      { label: 'Engine ready',  color: '#059669', bg: 'rgba(5,150,105,0.08)',  border: 'rgba(5,150,105,0.2)',  pulse: false },
  processing: { label: 'Processing',    color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.2)',  pulse: true  },
  offline:    { label: 'Brain offline', color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.2)',  pulse: false },
}

const syncStatusConfig = {
  ok:      { label: 'Synced',    color: '#059669', bg: 'rgba(5,150,105,0.08)',  border: 'rgba(5,150,105,0.2)'  },
  syncing: { label: 'Syncing…',  color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.2)'  },
  error:   { label: 'Sync error',color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.2)'  },
}

// Chip token → inline style
function chipStyle(color: string): React.CSSProperties {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    green:  { bg: 'rgba(5,150,105,0.08)',   text: '#059669', border: 'rgba(5,150,105,0.2)'   },
    amber:  { bg: 'rgba(217,119,6,0.08)',   text: '#d97706', border: 'rgba(217,119,6,0.2)'   },
    blue:   { bg: 'rgba(29,78,216,0.08)',   text: '#1d4ed8', border: 'rgba(29,78,216,0.2)'   },
    red:    { bg: 'rgba(220,38,38,0.08)',   text: '#dc2626', border: 'rgba(220,38,38,0.2)'   },
    purple: { bg: 'rgba(124,58,237,0.08)',  text: '#7c3aed', border: 'rgba(124,58,237,0.2)'  },
    gray:   { bg: 'rgba(120,113,108,0.07)', text: '#78716c', border: 'rgba(120,113,108,0.15)'},
  }
  const t = map[color] ?? map.gray
  return {
    background: t.bg,
    color: t.text,
    border: `1px solid ${t.border}`,
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 500,
    letterSpacing: '0.06em',
    padding: '3px 9px',
    borderRadius: '5px',
    textTransform: 'uppercase' as const,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Topbar({
  title,
  onMobileMenu,
  chips = [],
  variant      = 'default',
  engineState  = 'ready',
  signalCount  = 0,
  onRefreshFeed,
  feedRefreshing = false,
  acumaticaSync  = null,
  lastSyncTime,
  ytdRevenue,
  rightSlot,
}: TopbarProps) {
  const today = format(new Date(), 'EEE d MMM yyyy')
  const accent = VARIANT_ACCENT[variant]
  const IconComp = VARIANT_ICON[variant]

  // ── Mobile hamburger ──────────────────────────────────────────────────────
  const MobileBtn = () => (
    <button
      onClick={onMobileMenu}
      className="xl:hidden flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
      style={{ color: 'rgba(28,25,23,0.45)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLElement).style.color = 'rgba(28,25,23,0.8)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(28,25,23,0.45)' }}
      aria-label="Open menu"
    >
      <Menu size={17} />
    </button>
  )

  // ── Rule divider ─────────────────────────────────────────────────────────
  const Rule = () => (
    <div style={{ width: 1, height: 18, background: 'rgba(28,25,23,0.08)', flexShrink: 0 }} />
  )

  // ── Status pill ───────────────────────────────────────────────────────────
  const StatusPill = ({
    dot, label, pulse, bg, border, color, extra,
  }: { dot: string; label: string; pulse?: boolean; bg: string; border: string; color: string; extra?: React.ReactNode }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 6, background: bg, border: `1px solid ${border}` }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0,
        boxShadow: pulse ? `0 0 0 0 ${dot}` : undefined,
        animation: pulse ? 'topbar-pulse 1.8s ease-in-out infinite' : undefined,
      }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.05em', color }}>{label}</span>
      {extra}
    </div>
  )

  // ════════════════════════════════════════════════════════════════════════
  // SHELL — identical across all variants, just accent swaps
  // ════════════════════════════════════════════════════════════════════════
  return (
    <>
      {/* Pulse animation for processing/syncing states */}
      <style>{`
        @keyframes topbar-pulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(1.25); }
        }
      `}</style>

      <header style={{
        height: 52,
        background: 'rgba(250,250,249,0.88)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid rgba(220,215,210,0.7)',
        boxShadow: '0 1px 12px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.8) inset',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        flexShrink: 0,
        position: 'relative',
      }}>

        {/* Left edge accent line */}
        <div style={{
          position: 'absolute', left: 0, top: '20%', bottom: '20%',
          width: 2, borderRadius: '0 2px 2px 0',
          background: accent.dot, opacity: 0.7,
        }} />

        <MobileBtn />

        {/* ── Brand / title block ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: accent.iconBg,
            border: `1px solid ${accent.iconBorder}`,
          }}>
            <IconComp size={14} style={{ color: accent.dot }} />
          </div>

          <div>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 14,
              color: '#1C1917',
              letterSpacing: '-0.01em',
              lineHeight: 1,
              margin: 0,
            }}>
              {title}
            </h1>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: '#A8A29E',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              margin: '3px 0 0',
              lineHeight: 1,
            }}>
              {accent.sub}
            </p>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* ── Right side — variant-specific indicators ─────────────────────── */}
        <div className="hidden sm:flex" style={{ alignItems: 'center', gap: 10 }}>

          {/* RESEARCH: signal count + refresh + engine state */}
          {variant === 'research' && (
            <>
              {signalCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#78716C', letterSpacing: '0.04em' }}>
                    {signalCount.toLocaleString()} signals
                  </span>
                  {onRefreshFeed && (
                    <button
                      onClick={onRefreshFeed}
                      disabled={feedRefreshing}
                      style={{
                        width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', border: '1px solid rgba(0,0,0,0.08)',
                        background: feedRefreshing ? 'rgba(13,148,136,0.06)' : 'transparent',
                        color: '#78716C', cursor: feedRefreshing ? 'not-allowed' : 'pointer',
                        opacity: feedRefreshing ? 0.5 : 1,
                      }}
                    >
                      <RefreshCw size={10} style={{ animation: feedRefreshing ? 'spin 1s linear infinite' : undefined }} />
                    </button>
                  )}
                </div>
              )}
              <Rule />
              {(() => {
                const s = engineStatusConfig[engineState]
                return <StatusPill dot={s.color} label={s.label} pulse={s.pulse} bg={s.bg} border={s.border} color={s.color} />
              })()}
              <Rule />
            </>
          )}

          {/* SALES: YTD revenue + Acumatica sync */}
          {variant === 'sales' && (
            <>
              {ytdRevenue && (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 10px', borderRadius: 6,
                    background: 'rgba(217,119,6,0.08)',
                    border: '1px solid rgba(217,119,6,0.2)',
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#d97706', letterSpacing: '0.06em', textTransform: 'uppercase' }}>YTD</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: '#92400e' }}>{ytdRevenue}</span>
                  </div>
                  <Rule />
                </>
              )}
              {acumaticaSync ? (() => {
                const s = syncStatusConfig[acumaticaSync]
                return (
                  <>
                    <StatusPill
                      dot={s.color} label={s.label} bg={s.bg} border={s.border} color={s.color}
                      pulse={acumaticaSync === 'syncing'}
                      extra={lastSyncTime ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A8A29E', marginLeft: 2 }}>{lastSyncTime}</span>
                      ) : undefined}
                    />
                    <Rule />
                  </>
                )
              })() : (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '3px 8px', borderRadius: 5,
                    background: 'rgba(120,113,108,0.06)',
                    border: '1px solid rgba(120,113,108,0.12)',
                  }}>
                    <Database size={9} style={{ color: '#A8A29E' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#A8A29E', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Static</span>
                  </div>
                  <Rule />
                </>
              )}
            </>
          )}

          {/* Chips — all variants */}
          {chips.map((chip, i) => (
            <span key={i} style={chipStyle(chip.color)}>{chip.label}</span>
          ))}

          {/* Right slot (e.g. NotificationBell) */}
          {rightSlot}

          {/* Date — all variants */}
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: '#A8A29E',
            letterSpacing: '0.05em',
          }}>
            {today}
          </span>
        </div>
      </header>
    </>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { format, startOfMonth, subDays, subMonths } from 'date-fns'
import {
  ChevronDown, ChevronRight, TrendingUp, TrendingDown,
  RotateCcw, ExternalLink, SlidersHorizontal, X,
} from 'lucide-react'
import Link from 'next/link'
import AnnouncementBoard from '@/components/management/AnnouncementBoard'

// ── Types ─────────────────────────────────────────────────────────────────────
interface KpiData {
  tonsThisMonth:      number
  tonsLastMonth:      number
  activeSectionsToday: number
  totalSections:      number
  qualityPassRate:    number
  qualityTotal:       number
  bagsTaggedToday:    number
  bagsKgToday:        number
}

interface ProdSection {
  id:       string
  label:    string
  sessions: { shift: string; status: string; variant?: string; lotNumber?: string; kg?: number }[]
}

interface QualityStream {
  label: string
  pass:  number
  fail:  number
  open:  number
}

// ── Period options ─────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'today',  label: 'Today'       },
  { key: 'week',   label: 'This week'   },
  { key: 'month',  label: 'This month'  },
  { key: '3m',     label: 'Last 3 mo'  },
] as const
type Period = typeof PERIODS[number]['key']

function periodRange(p: Period): { from: string; to: string } {
  const today = format(new Date(), 'yyyy-MM-dd')
  if (p === 'today')  return { from: today, to: today }
  if (p === 'week')   return { from: format(subDays(new Date(), 6), 'yyyy-MM-dd'), to: today }
  if (p === 'month')  return { from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: today }
  return { from: format(subMonths(new Date(), 3), 'yyyy-MM-dd'), to: today }
}

// ── Section config ─────────────────────────────────────────────────────────────
const KNOWN_SECTIONS = [
  { id: 'sieving',      label: 'Sieving Tower', color: '#0d9488' },
  { id: 'refining1',    label: 'Refining 1',    color: '#2563eb' },
  { id: 'refining2',    label: 'Refining 2',    color: '#3b82f6' },
  { id: 'pasteuriser',  label: 'Pasteuriser',   color: '#dc2626' },
  { id: 'blender',      label: 'Blender',       color: '#7c3aed' },
  { id: 'granule',      label: 'Granule Line',  color: '#d97706' },
  { id: 'smallblender', label: 'Sm. Blender',   color: '#8b5cf6' },
]

// ── SVG Donut ─────────────────────────────────────────────────────────────────
function Donut({ pct, color, size = 64 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const filled = circ * Math.min(pct / 100, 1)
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={6} />
      <circle
        cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  )
}

// ── Collapsible section card ───────────────────────────────────────────────────
function Section({ title, children, storageKey, defaultOpen = true }: {
  title:       string
  children:    React.ReactNode
  storageKey:  string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? defaultOpen }
    catch { return defaultOpen }
  })

  function toggle() {
    setOpen((o: boolean) => {
      const next = !o
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface transition-colors"
      >
        <span className="font-display font-bold text-[15px] text-text">{title}</span>
        {open ? <ChevronDown size={15} className="text-text-muted" /> : <ChevronRight size={15} className="text-text-muted" />}
      </button>
      {open && <div className="border-t border-surface-rule">{children}</div>}
    </div>
  )
}

// ── KPI strip ─────────────────────────────────────────────────────────────────
function KpiStrip({ data, period }: { data: KpiData; period: Period }) {
  const tonsDelta = data.tonsLastMonth > 0
    ? ((data.tonsThisMonth - data.tonsLastMonth) / data.tonsLastMonth) * 100
    : 0
  const tonsUp = tonsDelta >= 0

  const kpis = [
    {
      label:    period === 'today' ? 'Kg tagged today' : 'Kg produced',
      value:    data.tonsThisMonth >= 1000
        ? `${(data.tonsThisMonth / 1000).toFixed(1)}t`
        : `${Math.round(data.tonsThisMonth).toLocaleString()} kg`,
      sub:      data.tonsLastMonth > 0 ? (tonsUp ? `+${tonsDelta.toFixed(0)}% vs prev` : `${tonsDelta.toFixed(0)}% vs prev`) : 'first period',
      trend:    tonsDelta,
      graphic: (
        <div style={{ width: 56, height: 56, flexShrink: 0 }}>
          <svg width={56} height={56} viewBox="0 0 56 56">
            {/* Stacked bars — last month vs this month */}
            <rect x={6} y={56 - 42} width={16} height={42} rx={4} fill="rgba(26,58,14,0.15)" />
            <rect
              x={6}
              y={56 - Math.max(4, Math.min(42, (data.tonsThisMonth / Math.max(data.tonsLastMonth, data.tonsThisMonth, 1)) * 42))}
              width={16}
              height={Math.max(4, Math.min(42, (data.tonsThisMonth / Math.max(data.tonsLastMonth, data.tonsThisMonth, 1)) * 42))}
              rx={4}
              fill="#1A3A0E"
            />
            <rect x={30} y={56 - 42} width={16} height={42} rx={4} fill="rgba(26,58,14,0.08)" />
            <rect
              x={30}
              y={56 - Math.max(4, Math.min(42, (data.tonsLastMonth / Math.max(data.tonsLastMonth, data.tonsThisMonth, 1)) * 42))}
              width={16}
              height={Math.max(4, Math.min(42, (data.tonsLastMonth / Math.max(data.tonsLastMonth, data.tonsThisMonth, 1)) * 42))}
              rx={4}
              fill="rgba(26,58,14,0.3)"
            />
            <text x={6}  y={52} fontSize={6} fill="#9CA3AF" fontFamily="monospace">Now</text>
            <text x={30} y={52} fontSize={6} fill="#9CA3AF" fontFamily="monospace">Prev</text>
          </svg>
        </div>
      ),
      color: '#1A3A0E',
    },
    {
      label:   'Active sections today',
      value:   `${data.activeSectionsToday}/${data.totalSections}`,
      sub:     data.activeSectionsToday > 0 ? `${data.activeSectionsToday} running` : 'None active',
      trend:   0,
      graphic: (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, width: 52, flexShrink: 0 }}>
          {KNOWN_SECTIONS.map((s, i) => {
            const active = i < data.activeSectionsToday
            return (
              <div key={s.id} style={{
                width: 10, height: 10, borderRadius: 3,
                background: active ? s.color : 'rgba(0,0,0,0.08)',
                transition: 'background 0.3s',
              }} />
            )
          })}
        </div>
      ),
      color: data.activeSectionsToday >= 5 ? '#1A7A3C' : data.activeSectionsToday >= 2 ? '#B85C0A' : '#B81C1C',
    },
    {
      label:   'Quality pass rate',
      value:   data.qualityTotal > 0 ? `${data.qualityPassRate.toFixed(0)}%` : '—',
      sub:     data.qualityTotal > 0 ? `${data.qualityTotal} records reviewed` : 'No records',
      trend:   0,
      graphic: (
        <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
          <Donut
            pct={data.qualityPassRate}
            color={data.qualityPassRate >= 90 ? '#1A7A3C' : data.qualityPassRate >= 75 ? '#B85C0A' : '#B81C1C'}
            size={56}
          />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: '#1A2415' }}>
              {data.qualityTotal > 0 ? `${Math.round(data.qualityPassRate)}%` : '—'}
            </span>
          </div>
        </div>
      ),
      color: data.qualityPassRate >= 90 ? '#1A7A3C' : data.qualityPassRate >= 75 ? '#B85C0A' : '#B81C1C',
    },
    {
      label:   'Bags tagged today',
      value:   data.bagsTaggedToday.toString(),
      sub:     data.bagsKgToday > 0 ? `${Math.round(data.bagsKgToday).toLocaleString()} kg total` : 'No bags today',
      trend:   0,
      graphic: (
        <div style={{ width: 52, flexShrink: 0 }}>
          <svg width={52} height={52} viewBox="0 0 52 52">
            {/* Bag icon outline */}
            <rect x={8} y={16} width={36} height={28} rx={5} fill="none" stroke="rgba(26,58,14,0.2)" strokeWidth={2} />
            <path d="M18 16 Q18 8 26 8 Q34 8 34 16" fill="none" stroke="rgba(26,58,14,0.2)" strokeWidth={2} strokeLinecap="round" />
            {/* Fill based on count */}
            <clipPath id="bag-fill">
              <rect x={8} y={16} width={36} height={28} rx={5} />
            </clipPath>
            <rect
              x={8}
              y={44 - Math.min(28, Math.max(0, (data.bagsTaggedToday / Math.max(data.bagsTaggedToday, 20)) * 28))}
              width={36} height={28}
              fill="rgba(26,58,14,0.15)"
              clipPath="url(#bag-fill)"
            />
            <text x={26} y={34} fontSize={10} textAnchor="middle" fill="#1A3A0E" fontWeight={700} fontFamily="monospace">
              {data.bagsTaggedToday}
            </text>
          </svg>
        </div>
      ),
      color: data.bagsTaggedToday > 0 ? '#1A3A0E' : '#637056',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map(k => (
        <div
          key={k.label}
          className="bg-surface-card border border-surface-rule rounded-2xl px-5 py-4 flex items-start gap-4"
          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
        >
          {k.graphic}
          <div className="flex-1 min-w-0">
            <div className="font-display font-extrabold text-[26px] leading-tight" style={{ color: k.color }}>
              {k.value}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-0.5">{k.label}</div>
            <div className="flex items-center gap-1 mt-1.5">
              {k.trend !== 0 && (
                k.trend > 0
                  ? <TrendingUp size={10} className="text-ok flex-shrink-0" />
                  : <TrendingDown size={10} className="text-err flex-shrink-0" />
              )}
              <span className="font-mono text-[10px] text-text-faint">{k.sub}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Production pulse ──────────────────────────────────────────────────────────
function ProductionPulse({ sections }: { sections: ProdSection[] }) {
  return (
    <div className="px-5 py-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {KNOWN_SECTIONS.map(cfg => {
          const sec     = sections.find(s => s.id === cfg.id)
          const active  = (sec?.sessions ?? []).some(s => s.status === 'submitted' || s.status === 'approved' || s.status === 'draft')
          const morning = sec?.sessions.find(s => s.shift === 'morning')
          const arvo    = sec?.sessions.find(s => s.shift === 'afternoon')
          const variant = morning?.variant ?? arvo?.variant
          const lotNum  = morning?.lotNumber ?? arvo?.lotNumber

          return (
            <div
              key={cfg.id}
              className="rounded-xl border overflow-hidden"
              style={{
                borderColor: active ? cfg.color + '40' : 'rgba(0,0,0,0.08)',
                background:  active ? cfg.color + '08' : 'rgba(0,0,0,0.02)',
              }}
            >
              {/* Coloured top bar */}
              <div style={{ height: 3, background: active ? cfg.color : 'rgba(0,0,0,0.08)' }} />

              <div className="px-3 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-[12px] text-text">{cfg.label}</span>
                  {/* Active pulse */}
                  <div style={{ position: 'relative', width: 8, height: 8 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: active ? cfg.color : 'rgba(0,0,0,0.15)',
                    }} />
                    {active && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        borderRadius: '50%',
                        background: cfg.color,
                        animation: 'pulse-ring 2s ease-in-out infinite',
                        opacity: 0.4,
                      }} />
                    )}
                  </div>
                </div>

                {active ? (
                  <div className="space-y-1">
                    {variant && (
                      <span className="inline-block font-mono text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: cfg.color + '18', color: cfg.color }}>
                        {variant}
                      </span>
                    )}
                    {lotNum && (
                      <div className="font-mono text-[9px] text-text-muted truncate">Lot: {lotNum}</div>
                    )}
                    <div className="flex gap-1.5 mt-1.5">
                      {morning && (
                        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded bg-surface text-text-muted">AM</span>
                      )}
                      {arvo && (
                        <span className="font-mono text-[8px] px-1.5 py-0.5 rounded bg-surface text-text-muted">PM</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="font-mono text-[10px] text-text-faint">No activity today</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 0.4; }
          60%  { transform: scale(2.2); opacity: 0;   }
          100% { transform: scale(2.2); opacity: 0;   }
        }
      `}</style>
    </div>
  )
}

// ── Quality snapshot ──────────────────────────────────────────────────────────
function QualitySnapshot({ streams }: { streams: QualityStream[] }) {
  return (
    <div className="px-5 py-4 space-y-4">
      {streams.map(s => {
        const total    = s.pass + s.fail + s.open
        const passPct  = total > 0 ? (s.pass / total) * 100 : 0
        const failPct  = total > 0 ? (s.fail / total) * 100 : 0
        const openPct  = total > 0 ? (s.open / total) * 100 : 0
        const color    = passPct >= 90 ? '#1A7A3C' : passPct >= 70 ? '#B85C0A' : total === 0 ? '#9CA3AF' : '#B81C1C'
        return (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-body font-semibold text-[13px] text-text">{s.label}</span>
              <div className="flex items-center gap-3">
                {total === 0 ? (
                  <span className="font-mono text-[10px] text-text-faint">No records</span>
                ) : (
                  <>
                    {s.pass > 0 && <span className="font-mono text-[10px] text-ok">{s.pass} pass</span>}
                    {s.fail > 0 && <span className="font-mono text-[10px] text-err">{s.fail} fail</span>}
                    {s.open > 0 && <span className="font-mono text-[10px] text-info">{s.open} open</span>}
                  </>
                )}
              </div>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-surface gap-px">
              {s.pass > 0 && <div style={{ width: `${passPct}%`, background: '#1A7A3C', transition: 'width 0.5s ease', borderRadius: 999 }} />}
              {s.open > 0 && <div style={{ width: `${openPct}%`, background: '#2A7CB8', transition: 'width 0.5s ease' }} />}
              {s.fail > 0 && <div style={{ width: `${failPct}%`, background: '#B81C1C', transition: 'width 0.5s ease', borderRadius: 999 }} />}
            </div>
          </div>
        )
      })}
      <Link
        href="/quality/pasteuriser"
        className="flex items-center gap-1 font-mono text-[11px] text-brand hover:underline mt-2"
      >
        View quality records <ExternalLink size={10} />
      </Link>
    </div>
  )
}

// ── Notes pad ─────────────────────────────────────────────────────────────────
function NotesPad({ userId }: { userId: string | null }) {
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(`management-notes-${userId ?? 'anon'}`) ?? '' }
    catch { return '' }
  })

  function handleChange(val: string) {
    setText(val)
    try { localStorage.setItem(`management-notes-${userId ?? 'anon'}`, val) }
    catch {}
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder="Your private notes — saved to this device…"
        rows={5}
        className="w-full px-4 py-3 font-body text-[13px] text-text bg-transparent outline-none resize-none placeholder:text-text-faint leading-relaxed"
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MANAGEMENT PAGE
// ═════════════════════════════════════════════════════════════════════════════
export default function ManagementPage() {
  const db = getDb()
  const { displayName, userId, canAccessManagement, canAccessSales, isIT } = useAuth()

  const [period,         setPeriod]        = useState<Period>('month')
  const [kpi,            setKpi]           = useState<KpiData | null>(null)
  const [sections,       setSections]      = useState<ProdSection[]>([])
  const [qualityStreams,  setQualityStreams] = useState<QualityStream[]>([])
  const [loading,        setLoading]       = useState(true)
  const [customiseOpen,  setCustomiseOpen] = useState(false)
  const [visibleCards,   setVisibleCards]  = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('mgmt-cards') ?? '{}') }
    catch { return {} }
  })

  const isVisible = (key: string) => visibleCards[key] !== false

  function toggleCard(key: string) {
    setVisibleCards(prev => {
      const next = { ...prev, [key]: !isVisible(key) }
      try { localStorage.setItem('mgmt-cards', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { from, to } = periodRange(period)
    const today        = format(new Date(), 'yyyy-MM-dd')
    const prevFrom     = format(subMonths(new Date(from + 'T12:00:00'), 1), 'yyyy-MM-dd')
    const prevTo       = from

    const [
      { data: bagsNow },
      { data: bagsPrev },
      { data: bagsToday },
      { data: sessionsToday },
      { data: pastRuns },
      { data: labResults },
    ] = await Promise.all([
      db.schema('production').from('bag_tags').select('weight_kg').gte('tag_date', from).lte('tag_date', to),
      db.schema('production').from('bag_tags').select('weight_kg').gte('tag_date', prevFrom).lte('tag_date', prevTo),
      db.schema('production').from('bag_tags').select('weight_kg').eq('tag_date', today),
      db.schema('production').from('prod_sessions').select('section_id,section_name,shift,status,notes').eq('date', today),
      db.from('pasteuriser_runs').select('status').gte('run_date', from).lte('run_date', to),
      db.from('lab_results').select('result_status').gte('sample_date', from).lte('sample_date', to),
    ])

    const tonsNow  = (bagsNow  ?? []).reduce((s: number, b: any) => s + (b.weight_kg ?? 0), 0)
    const tonsPrev = (bagsPrev ?? []).reduce((s: number, b: any) => s + (b.weight_kg ?? 0), 0)

    const bToday = bagsToday ?? []
    const bagsKg = bToday.reduce((s: number, b: any) => s + (b.weight_kg ?? 0), 0)

    // Active sections today
    const activeSectionIds = new Set((sessionsToday ?? []).map((s: any) => s.section_id))

    // Quality — pasteuriser
    const pastPass = (pastRuns ?? []).filter((r: any) => (r.status ?? '').toLowerCase().includes('pass')).length
    const pastFail = (pastRuns ?? []).filter((r: any) => (r.status ?? '').toLowerCase().includes('fail')).length
    const pastOpen = (pastRuns ?? []).filter((r: any) => !['pass','fail'].some(x => (r.status ?? '').toLowerCase().includes(x))).length

    // Quality — lab results
    const labPass = (labResults ?? []).filter((r: any) => (r.result_status ?? '').toLowerCase() === 'pass').length
    const labFail = (labResults ?? []).filter((r: any) => (r.result_status ?? '').toLowerCase() === 'fail').length
    const labOpen = (labResults ?? []).filter((r: any) => !['pass','fail'].includes((r.result_status ?? '').toLowerCase())).length

    const totalPass  = pastPass + labPass
    const totalRecs  = totalPass + pastFail + labFail + pastOpen + labOpen
    const passRate   = totalRecs > 0 ? (totalPass / (totalPass + pastFail + labFail)) * 100 : 0

    setKpi({
      tonsThisMonth:       tonsNow,
      tonsLastMonth:       tonsPrev,
      activeSectionsToday: activeSectionIds.size,
      totalSections:       KNOWN_SECTIONS.length,
      qualityPassRate:     passRate,
      qualityTotal:        totalRecs,
      bagsTaggedToday:     bToday.length,
      bagsKgToday:         bagsKg,
    })

    // Build production section list
    const sectionMap: Record<string, ProdSection> = {}
    for (const s of sessionsToday ?? []) {
      const formData = (() => {
        try { return typeof s.notes === 'string' ? JSON.parse(s.notes) : (s.notes ?? {}) } catch { return {} }
      })()
      if (!sectionMap[s.section_id]) {
        sectionMap[s.section_id] = { id: s.section_id, label: s.section_name ?? s.section_id, sessions: [] }
      }
      sectionMap[s.section_id].sessions.push({
        shift:     s.shift,
        status:    s.status,
        variant:   formData.variant ?? formData.product_variant ?? undefined,
        lotNumber: formData.lot_number ?? formData.lot ?? undefined,
        kg:        formData.total_kg ?? undefined,
      })
    }
    setSections(Object.values(sectionMap))

    setQualityStreams([
      { label: 'Pasteuriser Runs', pass: pastPass, fail: pastFail, open: pastOpen },
      { label: 'Lab Results',      pass: labPass,  fail: labFail,  open: labOpen  },
    ])

    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  if (!canAccessManagement && !isIT) {
    return (
      <div className="flex items-center justify-center min-h-full font-mono text-[12px] text-text-muted">
        Access restricted
      </div>
    )
  }

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="min-h-full bg-surface">

      {/* ── Page greeting ──────────────────────────────────────────────────── */}
      <div className="bg-surface-card border-b border-surface-rule">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display font-extrabold text-[22px] text-text tracking-tight">
                {greeting}, {displayName.split(' ')[0]}
              </h2>
              <p className="font-mono text-[11px] text-text-muted mt-0.5">
                {format(new Date(), 'EEEE, d MMMM yyyy')} · Cape Natural Tea Products
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Period selector */}
              <div className="flex border border-surface-rule rounded-xl overflow-hidden">
                {PERIODS.map((p, i) => (
                  <button key={p.key} onClick={() => setPeriod(p.key)}
                    className={`px-3 py-1.5 font-mono text-[11px] transition-colors ${i > 0 ? 'border-l border-surface-rule' : ''} ${period === p.key ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'}`}>
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Refresh */}
              <button
                onClick={load}
                disabled={loading}
                className="w-8 h-8 flex items-center justify-center rounded-xl border border-surface-rule bg-surface-card hover:border-brand/40 transition-colors disabled:opacity-40"
              >
                <RotateCcw size={13} className={`text-text-muted ${loading ? 'animate-spin' : ''}`} />
              </button>

              {/* Customise */}
              <button
                onClick={() => setCustomiseOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-surface-rule bg-surface-card font-mono text-[11px] text-text-muted hover:border-brand/40 hover:text-text transition-colors"
              >
                <SlidersHorizontal size={12} /> Customise
              </button>
            </div>
          </div>

          {/* Customise drawer */}
          {customiseOpen && (
            <div className="mt-4 p-4 bg-surface border border-surface-rule rounded-xl flex flex-wrap items-center gap-4">
              <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Toggle sections:</span>
              {[
                { key: 'kpi',     label: 'KPI Strip'          },
                { key: 'pulse',   label: 'Production Pulse'   },
                { key: 'quality', label: 'Quality Snapshot'   },
                { key: 'sales',   label: 'Sales Overview'     },
                { key: 'notes',   label: 'Notes Pad'          },
              ].map(c => (
                <button key={c.key} onClick={() => toggleCard(c.key)}
                  className={`px-3 py-1.5 rounded-lg font-mono text-[11px] border transition-colors ${
                    isVisible(c.key) ? 'bg-brand text-white border-brand' : 'bg-surface-card text-text-muted border-surface-rule'
                  }`}>
                  {c.label}
                </button>
              ))}
              <button onClick={() => setCustomiseOpen(false)} className="ml-auto">
                <X size={14} className="text-text-muted" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Dashboard body ─────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* KPI strip */}
        {isVisible('kpi') && (
          <div>
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="bg-surface-card border border-surface-rule rounded-2xl px-5 py-4 h-[100px] animate-pulse" />
                ))}
              </div>
            ) : kpi ? (
              <KpiStrip data={kpi} period={period} />
            ) : null}
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">

          {/* Left column */}
          <div className="space-y-5 min-w-0">

            {/* Production Pulse */}
            {isVisible('pulse') && (
              <Section title="Production Pulse" storageKey="mgmt-pulse" defaultOpen={true}>
                <ProductionPulse sections={sections} />
              </Section>
            )}

            {/* Quality Snapshot */}
            {isVisible('quality') && (
              <Section title="Quality Snapshot" storageKey="mgmt-quality" defaultOpen={true}>
                <QualitySnapshot streams={qualityStreams} />
              </Section>
            )}

            {/* Sales Overview — permission gated */}
            {isVisible('sales') && canAccessSales && (
              <Section title="Sales Overview" storageKey="mgmt-sales" defaultOpen={false}>
                <div className="px-5 py-4 flex items-center justify-between">
                  <p className="font-body text-[13px] text-text-muted">
                    Sales intelligence, pipeline, and follow-ups live in the Sales module.
                  </p>
                  <Link
                    href="/sales"
                    className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-xl font-semibold text-[13px] hover:bg-brand-hover transition-colors whitespace-nowrap"
                  >
                    Open Sales <ExternalLink size={12} />
                  </Link>
                </div>
              </Section>
            )}

            {/* Notes Pad */}
            {isVisible('notes') && (
              <Section title="My Notes" storageKey="mgmt-notes" defaultOpen={false}>
                <NotesPad userId={userId} />
              </Section>
            )}
          </div>

          {/* Right column — Announcements */}
          <div className="xl:sticky xl:top-4 xl:self-start">
            <div className="bg-surface-card border border-surface-rule rounded-2xl p-5" style={{ minHeight: 400 }}>
              <AnnouncementBoard />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

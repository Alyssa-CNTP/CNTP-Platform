'use client'

// Shared visual kit for the Supervisor Hub, Production Orders and the Shift
// Report — so those three surfaces read as one product instead of three people's
// idea of a card.
//
// Three rules it exists to enforce:
//
//  1. LIGHT. Hairline rules at 60% opacity, no drop shadows, generous padding,
//     one weight of border. The previous pass leaned on `shadow-sm` + full-
//     strength borders on every box, which stacks into visual noise the moment
//     you put four of them on a page.
//
//  2. ACTION FIRST. `ActionPanel` is the top of every surface: what you have to
//     DO, in priority order, before any figure. Everything else is reference and
//     is allowed to be quieter — or hidden behind `Collapse` until asked for.
//
//  3. GRAPHS, NOT TABLE WALLS. `Spark`, `BarRow`, `ShareBar` and `Meter` cover
//     the shapes these pages actually need, with exact numbers still available
//     under a disclosure. Nine consecutive tables is a data dump, not a report.
//
// Colour discipline (validated, see the note on RAMP): magnitude is a single
// hue; part-to-whole uses the ordered ramp with labels; identity is carried by
// axis labels and legends, never by colour alone. Reserved status colours
// (ok/warn/err) never double as a series colour.

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'

// ── Sequential ramp ──────────────────────────────────────────────────────────
// One hue, light→dark, stepped off the Cape Natural brand green. Verified
// monotonic in relative luminance (0.027 → 0.614), which is what makes it safe
// for every kind of colour vision: the ordering itself carries the magnitude, so
// no pair of steps has to be told apart by hue. Steps 5–7 fall below 3:1 against
// white, so anything painted with them must carry a visible label — every
// consumer here pairs the ramp with a labelled list, which is that relief.
export const RAMP = ['#16340C', '#24501A', '#356E24', '#478C2E', '#5AA83A', '#86C169', '#B4D8A0'] as const
/** Ramp step for item i of n, darkest first — largest share reads heaviest. */
export const rampStep = (i: number, n: number) =>
  RAMP[Math.min(RAMP.length - 1, Math.round((i / Math.max(1, n - 1)) * (RAMP.length - 1)))]

/** The single hue for plain magnitude marks (bars, areas, sparklines). */
export const MARK = '#356E24'
export const MARK_SOFT = 'rgba(53,110,36,0.12)'

// ── Panel ────────────────────────────────────────────────────────────────────

export function Panel({ children, className = '', tone = 'plain', flush = false }: {
  children: React.ReactNode
  className?: string
  tone?: 'plain' | 'attention' | 'good'
  flush?: boolean
}) {
  const tones = {
    plain:     'bg-surface-card border-surface-rule/60',
    attention: 'bg-warn-bg border-warn/25',
    good:      'bg-ok-bg border-ok/20',
  }
  return (
    <div className={`border rounded-2xl overflow-hidden ${tones[tone]} ${flush ? '' : ''} ${className}`}>
      {children}
    </div>
  )
}

/** Panel header. Deliberately no background fill — a tinted header bar on every
 *  card is most of what made the old pass feel heavy. */
export function PanelHead({ icon: Icon, title, meta, action, children }: {
  icon?: React.ElementType
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 pt-4 pb-3 flex-wrap">
      {Icon && <Icon size={15} className="text-text-faint shrink-0" />}
      <h3 className="font-display font-semibold text-[14px] text-text tracking-[-0.01em] truncate min-w-0">{title}</h3>
      {meta && <span className="font-mono text-[11px] text-text-faint truncate">{meta}</span>}
      {(action || children) && <div className="ml-auto flex items-center gap-2 shrink-0">{children}{action}</div>}
    </div>
  )
}

export const PanelBody = ({ children, className = '' }: { children: React.ReactNode; className?: string }) =>
  <div className={`px-5 pb-5 ${className}`}>{children}</div>

// ── Stat ─────────────────────────────────────────────────────────────────────
// A number, its label, an optional unit, and an optional sparkline underneath.
// Big and quiet: one strong figure, everything around it faint.

export function Stat({ value, label, unit, hint, tone = 'plain', spark, href }: {
  value: string
  label: string
  unit?: string
  hint?: string
  tone?: 'plain' | 'warn' | 'good' | 'muted'
  spark?: number[]
  href?: string
}) {
  const tones = {
    plain: 'text-text', warn: 'text-warn', good: 'text-ok', muted: 'text-text-faint',
  }
  const inner = (
    <>
      <div className="flex items-baseline gap-1">
        <span className={`font-display font-semibold text-[26px] leading-none tracking-[-0.02em] ${tones[tone]}`}>{value}</span>
        {unit && <span className="font-mono text-[11px] text-text-faint">{unit}</span>}
      </div>
      <div className="text-[11px] text-text-muted mt-1.5">{label}</div>
      {hint && <div className="text-[10px] text-text-faint mt-0.5">{hint}</div>}
      {spark && spark.length > 1 && <div className="mt-2.5"><Spark values={spark} /></div>}
    </>
  )
  if (!href) return <div className="min-w-0">{inner}</div>
  return (
    <Link href={href} className="min-w-0 group block">
      {inner}
      <span className="sr-only">View detail</span>
    </Link>
  )
}

/** A row of Stats on one hairline-separated strip. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-5 px-5 py-5">
      {children}
    </div>
  )
}

// ── Spark ────────────────────────────────────────────────────────────────────
// A tiny inline area chart. Hand-rolled SVG rather than a chart library: at this
// size a library's axes, margins and responsive container are all overhead, and
// a sparkline has no axis to read — it exists to show shape next to a number.

export function Spark({ values, height = 26, showLast = true }: {
  values: number[]; height?: number; showLast?: boolean
}) {
  if (values.length < 2) return null
  const w = 100, h = height
  const max = Math.max(...values), min = Math.min(...values)
  const span = max - min || 1
  const x = (i: number) => (i / (values.length - 1)) * w
  const y = (v: number) => h - 2 - ((v - min) / span) * (h - 4)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  const lastX = x(values.length - 1), lastY = y(values[values.length - 1])
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true"
      className="overflow-visible block">
      <path d={area} fill={MARK_SOFT} />
      <path d={line} fill="none" stroke={MARK} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />
      {showLast && <circle cx={lastX} cy={lastY} r={2.5} fill={MARK} vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

// ── BarRow ───────────────────────────────────────────────────────────────────
// A labelled horizontal bar. The label sits on the row, so identity never
// depends on the bar's colour — which is why one hue is enough and the chart
// stays readable in print, in greyscale and to a colourblind reader.

export function BarRow({ label, sublabel, value, max, display, badge, href }: {
  label: string
  sublabel?: string
  value: number
  max: number
  display: string
  badge?: React.ReactNode
  href?: string
}) {
  const pct = max > 0 ? Math.max(1.5, (value / max) * 100) : 0
  const body = (
    <>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[12.5px] text-text truncate">{label}</span>
        {sublabel && <span className="font-mono text-[10px] text-text-faint truncate">{sublabel}</span>}
        <span className="ml-auto font-mono text-[12px] text-text tabular-nums shrink-0">{display}</span>
        {badge}
      </div>
      <div className="h-2 rounded-full bg-surface-dim overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: MARK }} />
      </div>
    </>
  )
  if (!href) return <div className="py-2">{body}</div>
  return <Link href={href} className="block py-2 group hover:opacity-80 transition-opacity">{body}</Link>
}

// ── ShareBar ─────────────────────────────────────────────────────────────────
// Ordered part-to-whole: one bar, segments largest-first, painted down the
// sequential ramp so the ordering itself is the encoding. A 2px surface gap
// between segments keeps adjacent fills from reading as one block. The legend
// below is not optional — it is what makes the light ramp steps legible.

export interface Share { label: string; value: number; display?: string }

export function ShareBar({ items, total, max = 6 }: { items: Share[]; total?: number; max?: number }) {
  const sum = total ?? items.reduce((t, i) => t + i.value, 0)
  if (sum <= 0) return null
  const sorted = [...items].sort((a, b) => b.value - a.value)
  // Anything past the cut folds into one "Other" slice rather than generating
  // more colours — a ramp step past the end of the ramp is not a new category.
  const head = sorted.slice(0, max)
  const tailValue = sorted.slice(max).reduce((t, i) => t + i.value, 0)
  const shown: Share[] = tailValue > 0
    ? [...head, { label: `Other (${sorted.length - max})`, value: tailValue }]
    : head

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]">
        {shown.map((s, i) => (
          <div key={s.label} title={`${s.label} — ${Math.round((s.value / sum) * 100)}%`}
            style={{ width: `${(s.value / sum) * 100}%`, background: rampStep(i, shown.length) }} />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {shown.map((s, i) => (
          <div key={s.label} className="flex items-baseline gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0 translate-y-0.5" style={{ background: rampStep(i, shown.length) }} />
            <span className="text-[12px] text-text truncate">{s.label}</span>
            <span className="ml-auto font-mono text-[11px] text-text-muted tabular-nums shrink-0">
              {s.display ?? Math.round(s.value).toLocaleString()}
            </span>
            <span className="font-mono text-[11px] text-text-faint tabular-nums w-9 text-right shrink-0">
              {Math.round((s.value / sum) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Meter ────────────────────────────────────────────────────────────────────
// Two-part proportion with the shortfall named. Used for attendance and
// sign-off progress, where "17 of 19" matters more than either number alone.

export function Meter({ value, of, label, shortfallLabel, tone = 'good' }: {
  value: number; of: number; label: string; shortfallLabel?: string
  tone?: 'good' | 'warn'
}) {
  const pct = of > 0 ? (value / of) * 100 : 0
  const complete = of > 0 && value >= of
  const fill = complete ? 'var(--color-ok)' : tone === 'warn' ? 'var(--color-warn)' : MARK
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-display font-semibold text-[20px] text-text leading-none tabular-nums">{value}</span>
        <span className="font-mono text-[12px] text-text-faint">/ {of}</span>
        <span className="text-[11px] text-text-muted ml-1">{label}</span>
        {!complete && shortfallLabel && (
          <span className="ml-auto text-[11px] text-warn shrink-0">{shortfallLabel}</span>
        )}
      </div>
      <div className="h-2 rounded-full bg-surface-dim overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, pct)}%`, background: fill }} />
      </div>
    </div>
  )
}

// ── ActionPanel ──────────────────────────────────────────────────────────────
// The top of every surface: what you have to do, worst first, each row a link to
// the place you do it. When there is nothing to do it collapses to a single
// reassuring line rather than an empty card — "nothing to do" is information.

export interface Action {
  label: string
  detail?: string
  href: string
  severity: 'critical' | 'warn' | 'info'
  count?: number
}

export function ActionPanel({ actions, allClearLabel = 'Nothing needs you right now', title = 'What needs you' }: {
  actions: Action[]
  allClearLabel?: string
  title?: string
}) {
  const rank = { critical: 0, warn: 1, info: 2 }
  const sorted = [...actions].sort((a, b) => rank[a.severity] - rank[b.severity])

  if (sorted.length === 0) {
    return (
      <Panel tone="good">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <CheckCircle2 size={17} className="text-ok shrink-0" />
          <span className="text-[13.5px] text-text">{allClearLabel}</span>
        </div>
      </Panel>
    )
  }

  const tones = {
    critical: 'text-err',
    warn: 'text-warn',
    info: 'text-info',
  }

  return (
    <Panel tone="attention">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-1">
        <AlertTriangle size={15} className="text-warn shrink-0" />
        <h3 className="font-display font-semibold text-[14px] text-text tracking-[-0.01em]">{title}</h3>
        <span className="font-mono text-[11px] text-warn">{sorted.length}</span>
      </div>
      <div className="px-2 pb-2">
        {sorted.map((a, i) => (
          <Link key={`${a.href}-${i}`} href={a.href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-card/70 transition-colors group">
            {a.count !== undefined && (
              <span className={`font-mono font-semibold text-[13px] tabular-nums w-6 text-right shrink-0 ${tones[a.severity]}`}>{a.count}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-text">{a.label}</div>
              {a.detail && <div className="text-[11px] text-text-muted mt-0.5">{a.detail}</div>}
            </div>
            <ArrowRight size={14} className="text-text-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        ))}
      </div>
    </Panel>
  )
}

// ── Collapse ─────────────────────────────────────────────────────────────────
// "Show the exact numbers." Every graph on these pages has a table under it, but
// closed by default — that is how the report stays a report and still answers a
// precise question, and it satisfies the accessibility requirement for a table
// alternative to every chart.

export function Collapse({ label, count, children, defaultOpen = false, printOpen = true }: {
  label?: string
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
  /** Print always shows the detail — paper has no disclosure triangle. */
  printOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="no-print flex items-center gap-1.5 text-[11.5px] text-text-muted hover:text-brand transition-colors">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {label ?? (open ? 'Hide the numbers' : 'Show the numbers')}
        {count !== undefined && <span className="font-mono text-text-faint">({count})</span>}
      </button>
      <div className={`${open ? 'block' : 'hidden'} ${printOpen ? 'print:block' : ''} mt-3`}>
        {children}
      </div>
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────────────────
// Plain, hairline, tabular-nums. Identical on screen and on paper.

export function Table({ head, children, align }: {
  head: string[]
  children: React.ReactNode
  /** Column indexes to right-align (numeric columns). Defaults to all but the first. */
  align?: number[]
}) {
  const right = (i: number) => (align ? align.includes(i) : i > 0)
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-1 pb-2 font-mono text-[9px] font-semibold text-text-faint uppercase tracking-[0.06em] whitespace-nowrap border-b border-surface-rule/60 ${right(i) ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export const Tr = ({ children }: { children: React.ReactNode }) =>
  <tr className="border-b border-surface-rule/40 last:border-0">{children}</tr>

export const Td = ({ children, right, mono, tone, className = '' }: {
  children: React.ReactNode
  right?: boolean
  mono?: boolean
  tone?: 'warn' | 'err' | 'muted'
  className?: string
}) => {
  const tones = { warn: 'text-warn font-medium', err: 'text-err font-medium', muted: 'text-text-faint' }
  return (
    <td className={`px-1 py-2 text-[12px] align-top ${mono ? 'font-mono tabular-nums' : ''} ${right ? 'text-right' : ''} ${tone ? tones[tone] : 'text-text'} ${className}`}>
      {children}
    </td>
  )
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export const Empty = ({ children }: { children: React.ReactNode }) =>
  <p className="text-[12px] text-text-faint py-1">{children}</p>

export function Pill({ children, tone = 'neutral' }: {
  children: React.ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'err' | 'info'
}) {
  const tones = {
    neutral: 'bg-surface-dim text-text-muted',
    ok:   'bg-ok-bg text-ok',
    warn: 'bg-warn-bg text-warn',
    err:  'bg-err-bg text-err',
    info: 'bg-info-bg text-info',
  }
  return (
    <span className={`inline-flex items-center gap-1 font-medium text-[10.5px] px-2 py-0.5 rounded-full whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  )
}

/** Section code chip — the app-wide identity marker for a production line. */
export function SectionChip({ code, colorHex, size = 20 }: { code: string; colorHex: string; size?: number }) {
  return (
    <span className="rounded-md inline-flex items-center justify-center shrink-0"
      style={{ background: colorHex, width: size, height: size }}>
      <span className="font-mono font-bold text-white" style={{ fontSize: size * 0.36 }}>{code}</span>
    </span>
  )
}

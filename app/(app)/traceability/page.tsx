'use client'

/**
 * Traceability & QR — Roadmap + Foundation Page
 * ─────────────────────────────────────────────────────────────────────────────
 * This page serves two purposes:
 * 1. Shows operators/management what is live vs coming
 * 2. Is the entry point for QR scan actions once scanning is built
 *
 * PLANNED FEATURES (per session notes)
 * Phase 1 — Bag identity: every bag gets a QR on filling. Scan = open record.
 * Phase 2 — Dispatch: scan bags out, auto-generate dispatch note.
 * Phase 3 — Receiving: scan incoming bags, auto-create GRN.
 * Phase 4 — Full chain: scan any bag → see full history from field to dispatch.
 */

import { useRouter } from 'next/navigation'
import {
  QrCode, Truck, PackageCheck, GitBranch,
  CheckCircle2, Clock, Lock, ArrowRight, Scan,
  Package, ClipboardList, Zap,
} from 'lucide-react'
import clsx from 'clsx'

// ── ROADMAP DATA ───────────────────────────────────────────────────────────────

interface RoadmapItem {
  phase:    number
  title:    string
  status:   'live' | 'building' | 'planned' | 'future'
  icon:     React.ReactNode
  what:     string
  how:      string
  benefit:  string
}

const ROADMAP: RoadmapItem[] = [
  {
    phase:   1,
    title:   'Bag identity — QR on every bag',
    status:  'building',
    icon:    <QrCode size={20} />,
    what:    'Every bag filled during production gets a unique QR code printed at the bagging station.',
    how:     'Operator taps "Print QR" after entering bag weight. Label printer outputs a sticker with batch number, product, date, operator, and QR code.',
    benefit: 'Any bag can be scanned at any point — on the floor, in the warehouse, at dispatch — to instantly pull up its full record.',
  },
  {
    phase:   2,
    title:   'Scan to confirm production',
    status:  'planned',
    icon:    <Scan size={20} />,
    what:    'Instead of typing bag serial numbers during production capture, operator scans the QR on the bag.',
    how:     'Camera scan fills in serial, lot, product, and weight automatically. Reduces typing errors to zero.',
    benefit: 'Faster data entry, no serial number typos, full audit trail from bag creation.',
  },
  {
    phase:   3,
    title:   'Dispatch — scan bags out',
    status:  'planned',
    icon:    <Truck size={20} />,
    what:    'When loading a truck, the dispatch operator scans each bag. The system auto-generates the dispatch note with bag count, total weight, and destination.',
    how:     'Scan → bag added to active dispatch. Confirm load → dispatch note PDF generated and stored. Driver signs digitally.',
    benefit: 'No manual dispatch notes. Every outgoing bag is traceable. Integrates with Acumatica in future phase.',
  },
  {
    phase:   4,
    title:   'Receiving — scan bags in',
    status:  'planned',
    icon:    <PackageCheck size={20} />,
    what:    'When raw material bags arrive, receiving scans each bag. System creates a GRN (Goods Received Note) automatically.',
    how:     'Scan supplier bag QR (or enter manually if no QR) → quantity and product confirmed → GRN auto-generated.',
    benefit: 'Receiving is logged digitally the moment it happens. Links to production when those bags are later debagged.',
  },
  {
    phase:   5,
    title:   'Full traceability chain',
    status:  'future',
    icon:    <GitBranch size={20} />,
    what:    'Scan any bag and see its complete journey: received → stored → debagged → processed → filled → dispatched.',
    how:     'Every scan event is stored against the bag\'s QR identity. One lookup shows the entire chain.',
    benefit: 'Full batch recall capability. If a quality issue is found, you can instantly identify every downstream bag made from that input.',
  },
  {
    phase:   6,
    title:   'Acumatica sync',
    status:  'future',
    icon:    <Zap size={20} />,
    what:    'Production orders, dispatch notes, and GRNs push directly to Acumatica without manual re-entry.',
    how:     'API integration between this platform and Acumatica ERP. Events trigger automatic record creation.',
    benefit: 'Eliminates double-entry. Finance and operations see the same data in real time.',
  },
]

// ── STATUS CONFIG ──────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  live:     { label: 'Live',     color: 'badge-ok',   icon: <CheckCircle2 size={11} /> },
  building: { label: 'Building', color: 'badge-info',  icon: <Package size={11} /> },
  planned:  { label: 'Planned',  color: 'badge-warn',  icon: <Clock size={11} /> },
  future:   { label: 'Future',   color: 'badge-gray',  icon: <Lock size={11} /> },
}

// ── COMPONENT ──────────────────────────────────────────────────────────────────

export default function TraceabilityPage() {
  const router = useRouter()

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">

      {/* ── HEADER ── */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center flex-shrink-0">
          <QrCode size={22} className="text-accent-light" />
        </div>
        <div>
          <h1 className="font-display font-bold text-2xl text-text">Traceability & QR</h1>
          <p className="text-sm text-text-muted mt-0.5 max-w-xl">
            Full batch traceability from raw material receiving through production to dispatch.
            Every bag gets a QR identity — scan it anywhere to see its complete history.
          </p>
        </div>
      </div>

      {/* ── STATUS SUMMARY STRIP ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Production capture', status: 'Live',     color: 'bg-ok-bg border-ok/20 text-status-ok' },
          { label: 'Bag QR identity',    status: 'Building', color: 'bg-info-bg border-info/20 text-status-info' },
          { label: 'Dispatch scanning',  status: 'Planned',  color: 'bg-warn-bg border-warn/20 text-status-warn' },
          { label: 'Full chain trace',   status: 'Future',   color: 'bg-surface border-surface-rule text-text-muted' },
        ].map((item, i) => (
          <div key={i} className={clsx('rounded-xl border p-3 text-center', item.color.split(' ')[0], item.color.split(' ')[1])}>
            <div className={clsx('font-semibold text-sm mb-0.5', item.color.split(' ')[2])}>{item.status}</div>
            <div className="text-[11px] text-text-muted">{item.label}</div>
          </div>
        ))}
      </div>

      {/* ── QR SCAN ENTRY POINT (placeholder for when scanning is built) ── */}
      <div className="card p-5 border-2 border-dashed border-surface-rule">
        <div className="flex items-center gap-3 mb-3">
          <Scan size={18} className="text-text-muted" />
          <p className="font-semibold text-base text-text">Scan a bag QR code</p>
          <span className="badge badge-warn ml-auto">Coming soon</span>
        </div>
        <p className="text-sm text-text-muted mb-4">
          Once bag QR printing is live, tap here to open your camera and scan any bag
          to instantly pull up its production record, batch details, and full trace history.
        </p>
        <button
          disabled
          className="w-full py-3 bg-surface border border-surface-rule rounded-xl text-sm font-semibold text-text-faint cursor-not-allowed flex items-center justify-center gap-2"
        >
          <QrCode size={16} /> Open scanner
        </button>
      </div>

      {/* ── ROADMAP ── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-4">Build roadmap</p>
        <div className="space-y-3">
          {ROADMAP.map((item, i) => {
            const sc = STATUS_CONFIG[item.status]
            return (
              <div key={i} className="card overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Phase number + icon */}
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface border border-surface-rule flex items-center justify-center text-text-muted">
                      {item.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-mono text-[10px] text-text-faint uppercase tracking-wide">Phase {item.phase}</span>
                        <h3 className="font-semibold text-[14px] text-text">{item.title}</h3>
                        <span className={clsx('badge ml-auto flex-shrink-0 flex items-center gap-1', sc.color)}>
                          {sc.icon} {sc.label}
                        </span>
                      </div>

                      {/* What */}
                      <p className="text-[13px] text-text leading-relaxed mb-2">{item.what}</p>

                      {/* How + Benefit in a subtle grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        <div className="bg-surface rounded-lg p-2.5">
                          <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-1">How it works</p>
                          <p className="text-[12px] text-text-muted leading-relaxed">{item.how}</p>
                        </div>
                        <div className="bg-ok-bg/50 rounded-lg p-2.5">
                          <p className="font-mono text-[9px] uppercase tracking-wide text-text-faint mb-1">Benefit</p>
                          <p className="text-[12px] text-text-muted leading-relaxed">{item.benefit}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── WHAT'S NEEDED ── */}
      <div className="card p-5 bg-brand text-white border-0">
        <p className="font-semibold text-base mb-3">What we need to get started with QR</p>
        <div className="space-y-2">
          {[
            { item: 'Bluetooth label printer at each bagging station (e.g. Zebra ZD220)', done: false },
            { item: 'QR label template designed (50×25mm, includes batch, product, date, QR)', done: false },
            { item: 'Camera-enabled tablet at each scan point (already have these)', done: true },
            { item: 'Production capture forms completed and live (in progress)', done: true },
          ].map((r, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className={clsx('w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center', r.done ? 'bg-accent' : 'bg-white/20')}>
                {r.done && <CheckCircle2 size={11} className="text-white" />}
              </div>
              <p className={clsx('text-sm leading-relaxed', r.done ? 'text-white/70 line-through' : 'text-white/90')}>{r.item}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
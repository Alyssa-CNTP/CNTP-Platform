'use client'

// app/(app)/production/orders/[id]/page.tsx
// Full production ORDER = one whole production day (both shifts of a section on
// one date, 07h00–01h00, rolled up). Everything about the day's activity in one
// place: combined mass balance, inputs and outputs each grouped by type with
// their own totals (the same at-a-glance shape as the capture Overview), the AI
// machine-checks summary, and per-shift sign-offs. Reads output bags live from
// the bag_tags ledger, so nothing captured on the floor is ever missing.
//
// Doubles as the printable record: globals.css hides app chrome under @media
// print and everything renders un-collapsed, so Print produces the full report.

import { useEffect, useState, useRef, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, Printer, Loader2, CheckCircle2, Clock, Pen, Play, Radio, Sparkles, MessageSquare, ArrowRightLeft } from 'lucide-react'
import { loadOrderDay, type OrderDay, type OrderBagRow, type OrderRebagRow, type OrderDebagRow, type OrderShiftBlock, type OrderMassBalance, type OrderTimesheet } from '@/lib/production/order-detail'
import { sectionMeta } from '@/lib/production/capture-config'
import { getDb } from '@/lib/supabase/db'
import { Panel, PanelHead, PanelBody, Table, Tr, Td, Empty, Pill } from '@/components/production/ui/kit'

const fmtBagTime = (ts: string | null) =>
  ts ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '—'

const fmtHrs = (min: number | null) => {
  if (min == null) return '—'
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

const SHIFT_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' }

const STATUS: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'info'; icon: any }> = {
  draft:     { label: 'In progress',       tone: 'warn', icon: Pen },
  submitted: { label: 'Awaiting sign-off', tone: 'info', icon: Clock },
  approved:  { label: 'Signed off',        tone: 'ok',   icon: CheckCircle2 },
  new:       { label: 'Not started',       tone: 'neutral', icon: Play },
}

const num = (v: number | null | undefined) => v ?? 0

// Mass balance on this page reads OUTPUT − INPUT (not input − output): a
// shortfall (the normal case — moisture, dust, spillage) is then a NEGATIVE
// number that reads as "material lost" at a glance, instead of an ambiguous
// positive figure whichever way round it's framed. Flagged once it's outside
// ±1% of total input — the tolerance a real run is expected to close within.
const MASS_BALANCE_TOLERANCE_PCT = 0.01
function massBalanceInfo(totalOutput: number, totalInput: number) {
  const balance = totalOutput - totalInput
  const pct = totalInput > 0 ? (balance / totalInput) * 100 : 0
  const toleranceKg = totalInput * MASS_BALANCE_TOLERANCE_PCT
  const within = totalInput > 0 ? Math.abs(balance) <= toleranceKg : true
  const tone: 'ok' | 'warn' | 'err' = within ? 'ok' : balance < 0 ? 'err' : 'warn'
  const text = within
    ? `${balance >= 0 ? '+' : ''}${balance.toFixed(1)} kg (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) · within ±1%`
    : balance < 0
      ? `${balance.toFixed(1)} kg (${pct.toFixed(1)}%) · material lost, outside ±1% tolerance`
      : `+${balance.toFixed(1)} kg (+${pct.toFixed(1)}%) · outside ±1% tolerance`
  return { balance, pct, within, tone, text }
}
// Tailwind needs the full class name literally in source to generate it —
// `text-${tone}` at runtime would silently produce no styling.
const TONE_TEXT_CLASS: Record<'ok' | 'warn' | 'err', string> = { ok: 'text-ok', warn: 'text-warn', err: 'text-err' }

// A debag row's material as it should READ on the order: the farm's 500kg bag
// is a "Bulk Bag"; Bucket Elevator / Machine Spillage carry their own type.
function inputType(d: OrderDebagRow): string {
  const pt = (d.product_type || '').trim()
  if (!pt || /500\s*kg\s*farm\s*bag/i.test(pt)) return 'Bulk Bag'
  return pt
}

export default function ProductionOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [day, setDay] = useState<OrderDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  const loadedOnceRef = useRef(false)
  const idsRef = useRef<Set<string>>(new Set())
  const scopeRef = useRef<{ section_id: string; date: string } | null>(null)

  // Live, independent read straight from the database. Reloads whenever a bag /
  // bagging / mass-balance / signature row changes for ANY of the day's shift
  // sessions, or a NEW shift session for this (section, date) is inserted — so a
  // bag captured on the floor (or the afternoon shift opening) appears here
  // within a tick without anyone opening the capture page. A 20s poll backstops
  // the socket.
  useEffect(() => {
    let alive = true
    const reload = () =>
      loadOrderDay(id)
        .then(d => {
          if (!alive) return
          setDay(d); loadedOnceRef.current = true; setLoading(false)
          if (d) { idsRef.current = new Set(d.shifts.map(s => s.session.id)); scopeRef.current = { section_id: d.section_id, date: d.date } }
        })
        .catch(() => { if (alive && !loadedOnceRef.current) { setError('Could not load this production order'); setLoading(false) } })
    reload()

    const db = getDb()
    const inScopeSession = (p: any) => idsRef.current.has(p?.new?.session_id ?? p?.old?.session_id)
    const inScopeDay = (p: any) => {
      const r = p?.new ?? p?.old
      return !!r && scopeRef.current?.section_id === r.section_id && scopeRef.current?.date === r.date
    }
    const channel = db.channel(`order-day-${id}`)
      .on('postgres_changes', { event: '*', schema: 'production', table: 'bag_tags' },          (p: any) => { if (inScopeSession(p)) reload() })
      .on('postgres_changes', { event: '*', schema: 'production', table: 'prod_bagging' },       (p: any) => { if (inScopeSession(p)) reload() })
      .on('postgres_changes', { event: '*', schema: 'production', table: 'prod_mass_balance' },  (p: any) => { if (inScopeSession(p)) reload() })
      .on('postgres_changes', { event: '*', schema: 'production', table: 'session_signatures' }, (p: any) => { if (inScopeSession(p)) reload() })
      .on('postgres_changes', { event: '*', schema: 'production', table: 'prod_sessions' },      (p: any) => { if (inScopeSession(p) || inScopeDay(p)) reload() })
      .subscribe((s: string) => { if (alive) setLive(s === 'SUBSCRIBED') })
    const poll = setInterval(reload, 20_000)

    return () => { alive = false; clearInterval(poll); db.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-text-faint" /></div>
  if (error || !day) return <div className="p-6 text-center text-text-muted">{error ?? 'Production order not found.'}</div>

  const { section_id, date, status, grade, poItems, shifts, bags, bagsOutputKg, rebagRows, debags, massBalance: mb, timesheets, takeovers } = day
  const meta = sectionMeta(section_id)
  const st = STATUS[status] ?? STATUS.new
  const operators = Array.from(new Set(shifts.flatMap(s => s.session.operator_names ?? [])))
  const variant = shifts.map(s => s.session.variant).find(Boolean) ?? null
  const supervisor = shifts.map(s => s.session.sup_name_signoff || s.session.supervisor_name).find(Boolean) ?? null
  const submittedAt = shifts.map(s => s.session.submitted_at).filter(Boolean).sort().slice(-1)[0] ?? null
  const variantGrade = [variant, grade ? `Grade ${grade}` : null].filter(Boolean).join(' · ') || '—'
  const poText = poItems.length
    ? poItems.map(p => p.description ? `${p.code} — ${p.description}` : p.code).join('; ')
    : '—'

  // The bucket elevator is WIP that carries across the day: the afternoon/night
  // shift LEAVES it in the tower for tomorrow, so it's an OUTPUT (carry-over),
  // not a bagged product and not an input. It's captured as a debag row, so
  // pull it out of the inputs and state it on the output side — that 's exactly
  // the gap between the bagged-bag total and the mass-balance output total.
  const isBucketCarryOut = (d: OrderDebagRow) =>
    /bucket elevator/i.test(d.product_type || '') && (d.shift === 'afternoon' || d.shift === 'night')
  const inputRows = debags.filter(d => !isBucketCarryOut(d))
  const bucketCarryOverKg = debags.filter(isBucketCarryOut).reduce((s, d) => s + (Number(d.kg_nett) || 0), 0)
  // Total output = physical bagged product (the reliable ledger) + the bucket
  // elevator carried over. Derived from the ledger, so it always agrees with
  // the Bagging section below instead of the race-prone mass-balance snapshot.
  const totalOutput = bagsOutputKg + bucketCarryOverKg
  const yieldPct = mb && mb.total_input_kg ? Math.round((totalOutput / num(mb.total_input_kg)) * 1000) / 10 : null
  const wholeRunBalance = massBalanceInfo(totalOutput, num(mb?.total_input_kg))

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5 print-full-width">
      <div className="no-print flex items-center justify-between">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-3">
          {live && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ok" title="Reading live from the database — updates as bags are captured">
              <Radio size={12} className="animate-pulse" /> Live
            </span>
          )}
          <button onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[13px] font-medium hover:opacity-90">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {/* Day header */}
      <Panel>
        <PanelHead title={`${meta.name} — Production Order`}
          meta={`${format(new Date(date), 'd MMM yyyy')} · ${shifts.map(s => SHIFT_LABEL[s.session.shift] ?? s.session.shift).join(' + ')}`}
          action={<Pill tone={st.tone}><st.icon size={11} /> {st.label}</Pill>} />
        <PanelBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Date" value={format(new Date(date), 'd MMM yyyy')} bold />
            <Field label="Shift" value={shifts.map(s => SHIFT_LABEL[s.session.shift] ?? s.session.shift).join(' + ')} bold />
            <Field label="Variant & grade" value={variantGrade} strong />
            <Field label="Operators" value={operators.join(', ') || '—'} bold />
            <Field label="Supervisor" value={supervisor || '—'} bold />
            <Field label="Submitted" value={submittedAt ? format(new Date(submittedAt), 'd MMM HH:mm') : '—'} bold />
            <Field label="Production order" value={poText} bold className="col-span-2 sm:col-span-4" />
          </div>
        </PanelBody>
      </Panel>

      {/* Whole-run mass balance */}
      {mb && (
        <Panel>
          <PanelHead title="Mass balance — full run (07h00–01h00)" />
          <PanelBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Total input"  value={`${num(mb.total_input_kg).toFixed(1)} kg`} />
              <Field label="Bagged output" value={`${bagsOutputKg.toFixed(1)} kg`} />
              {bucketCarryOverKg > 0 && <Field label="Bucket elevator (carried over)" value={`${bucketCarryOverKg.toFixed(1)} kg`} />}
              <Field label="Total output" value={`${totalOutput.toFixed(1)} kg`} />
              <Field label="Balance"      value={<span className={TONE_TEXT_CLASS[wholeRunBalance.tone]}>{wholeRunBalance.text}</span>} />
              <Field label="Yield"        value={yieldPct != null ? `${yieldPct}%` : '—'} />
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* Debagging (inputs) — grouped by type with per-type totals */}
      <Panel>
        <PanelHead title="Debagging — inputs" meta={`${inputRows.length} row${inputRows.length === 1 ? '' : 's'}`} />
        <PanelBody>
          {inputRows.length === 0 ? <Empty>No inputs recorded.</Empty> : (
            <div className="space-y-4">
              {groupBy(inputRows, inputType).map(g => (
                <InputTypeGroup key={g.type} type={g.type} rows={g.rows} multiShift={shifts.length > 1} />
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Bagging (outputs) — grouped by product type with per-type totals */}
      <Panel>
        <PanelHead title="Bagging — outputs"
          meta={`${bags.length} bag${bags.length === 1 ? '' : 's'} · ${bagsOutputKg.toFixed(1)} kg`} />
        <PanelBody>
          {bags.length === 0 && bucketCarryOverKg === 0 ? <Empty>No output bags recorded.</Empty> : (
            <div className="space-y-4">
              {groupBy(bags, b => b.product_type || 'Other').map(g => (
                <OutputTypeGroup key={g.type} type={g.type} rows={g.rows} multiShift={shifts.length > 1} />
              ))}
              {bucketCarryOverKg > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-surface-rule px-3 py-2.5 text-[12.5px]">
                  <span className="text-text-muted">Bucket elevator — carried to next day <span className="text-text-faint">(WIP left in the tower, not bagged)</span></span>
                  <span className="font-mono text-text tabular-nums whitespace-nowrap">{bucketCarryOverKg.toFixed(1)} kg</span>
                </div>
              )}
              {bucketCarryOverKg > 0 && (
                <div className="flex items-center justify-between gap-2 px-3 pt-1 text-[13px] font-semibold border-t border-surface-rule/60">
                  <span className="text-text pt-2">Total output</span>
                  <span className="font-mono text-text tabular-nums pt-2">{bags.length} bags bagged + {bucketCarryOverKg.toFixed(0)} kg carry-over = {totalOutput.toFixed(1)} kg</span>
                </div>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Re-bagged in — bags born from an existing bag via re-bagging, not
          fresh production. Informational only: its kg is deliberately NOT
          part of bagsOutputKg/totalOutput above, since it was already
          counted as output on whatever earlier day its source bag was
          first bagged — showing it again here under any total would
          double-count it. */}
      {rebagRows.length > 0 && (
        <Panel>
          <PanelHead title="Re-bagged in"
            meta={`${rebagRows.length} bag${rebagRows.length === 1 ? '' : 's'} · ${rebagRows.reduce((s, r) => s + r.kg, 0).toFixed(1)} kg`} />
          <PanelBody>
            <div className="space-y-4">
              {groupBy(rebagRows, r => r.productType || 'Other').map(g => (
                <RebagTypeGroup key={g.type} type={g.type} rows={g.rows} multiShift={shifts.length > 1} />
              ))}
              <p className="text-[11px] text-text-faint">Already counted as output on an earlier day — not included in Bagged output or Total output above.</p>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* Per-shift: AI check summary + sign-off */}
      {shifts.map(block => (
        <ShiftBlock key={block.session.id} block={block} />
      ))}

      {/* ── Later pages: handover notes + timesheet ── */}
      {(shifts.some(s => s.session.comments) || takeovers.length > 0) && (
        <div className="print-page-break">
          <Panel>
            <PanelHead title="Handover & operator notes" />
            <PanelBody>
              <div className="space-y-3">
                {takeovers.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12.5px] text-text">
                    <ArrowRightLeft size={14} className="text-text-faint shrink-0 mt-0.5" />
                    <span>
                      <span className="capitalize">{t.from_shift}</span> → <span className="capitalize">{t.to_shift}</span> handed over to <span className="font-medium">{t.operator_name}</span>
                      {!t.rostered && <span className="text-warn"> (not rostered)</span>}
                      <span className="text-text-faint"> · {format(new Date(t.taken_over_at), 'd MMM HH:mm')}</span>
                    </span>
                  </div>
                ))}
                {shifts.filter(s => s.session.comments).map(s => (
                  <div key={s.session.id} className="flex items-start gap-2">
                    <MessageSquare size={14} className="text-text-faint shrink-0 mt-0.5" />
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">{SHIFT_LABEL[s.session.shift] ?? s.session.shift}</span>
                      <p className="text-[12.5px] text-text whitespace-pre-wrap leading-relaxed">{s.session.comments}</p>
                    </div>
                  </div>
                ))}
              </div>
            </PanelBody>
          </Panel>
        </div>
      )}

      {timesheets.length > 0 && (
        <div className="print-page-break">
          <Panel>
            <PanelHead title="Timesheet — hours worked" meta={`${timesheets.length} operator${timesheets.length === 1 ? '' : 's'}`} />
            <PanelBody>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[520px]">
                  <thead>
                    <tr>
                      {['Operator', 'Shift', 'Start', 'End', 'Breaks', 'Worked', ''].map((h, i) => (
                        <th key={i} className={`px-3 py-1.5 font-mono text-[9px] font-semibold text-text-faint uppercase tracking-[0.06em] whitespace-nowrap ${h === 'Worked' ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-rule/60">
                    {timesheets.map((t, i) => {
                      const brk = (t.breaks ?? []).reduce((m, b) => {
                        if (b.start && b.end) return m + Math.max(0, (Date.parse(b.end) - Date.parse(b.start)) / 60000)
                        return m
                      }, 0)
                      return (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-[12.5px] text-text">{t.operator_name}</td>
                          <td className="px-3 py-1.5 text-[11px] text-text-muted capitalize">{t.shift}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted">{fmtBagTime(t.shift_start)}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted">{fmtBagTime(t.shift_end)}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-text-faint">{brk > 0 ? fmtHrs(brk) : '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-[12.5px] text-text text-right tabular-nums">{fmtHrs(t.worked_minutes)}</td>
                          <td className="px-3 py-1.5">{t.confirmed ? <CheckCircle2 size={13} className="text-ok" /> : <span className="text-[10px] text-text-faint">unconfirmed</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </PanelBody>
          </Panel>
        </div>
      )}
    </div>
  )
}

// ── grouping helper: preserve first-seen order, one entry per type ────────────
function groupBy<T>(rows: T[], key: (r: T) => string): { type: string; rows: T[] }[] {
  const order: string[] = []
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const t = key(r)
    if (!map.has(t)) { map.set(t, []); order.push(t) }
    map.get(t)!.push(r)
  }
  return order.map(type => ({ type, rows: map.get(type)! }))
}

// One input type's rows. Columns per the agreed layout: farm bag number (from
// notes), lot, and nett kg — no gross, no delivery date, no org/conv (variant
// is stated on the order). Compact list, mobile-friendly, with a per-type total.
function InputTypeGroup({ type, rows, multiShift }: { type: string; rows: OrderDebagRow[]; multiShift: boolean }) {
  const kg = rows.reduce((s, r) => s + (Number(r.kg_nett) || 0), 0)
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">{type}</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {rows.length} · {kg.toFixed(1)} kg
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[380px]">
          <thead>
            <tr>
              {['Farm bag', 'Lot', multiShift ? 'Shift' : null, 'kg'].filter(Boolean).map(h => (
                <th key={h as string} className={`px-3 py-1.5 font-mono text-[9px] font-semibold text-text-faint uppercase tracking-[0.06em] whitespace-nowrap ${h === 'kg' ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-rule/60">
            {rows.map(d => (
              <tr key={d.id}>
                <td className="px-3 py-1.5 font-mono text-[12px] text-text">{d.notes || d.bag_serial_no || '—'}</td>
                <td className="px-3 py-1.5 text-[12px] text-text-muted">{d.lot_number || '—'}</td>
                {multiShift && <td className="px-3 py-1.5 text-[11px] text-text-faint capitalize">{d.shift}</td>}
                <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{Number(d.kg_nett).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// One output product type's bags — compact per-bag lines with a per-type total.
function OutputTypeGroup({ type, rows, multiShift }: { type: string; rows: OrderBagRow[]; multiShift: boolean }) {
  const kg = rows.reduce((s, r) => s + (r.kg || 0), 0)
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">{type}</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {rows.length} bag{rows.length === 1 ? '' : 's'} · {kg.toFixed(1)} kg
        </span>
      </div>
      <ul className="divide-y divide-surface-rule/60">
        {rows.map((b, i) => (
          <li key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span className="font-mono text-text-faint w-6 shrink-0 text-right">{i + 1}</span>
            <span className="font-mono text-text flex-1 min-w-0 truncate">{b.bag_serial_no || '—'}</span>
            {multiShift && <span className="text-[10px] text-text-faint shrink-0 capitalize">{b.shift}</span>}
            {b.output_group && <span className="font-mono text-[10px] text-text-faint shrink-0">grp {b.output_group}</span>}
            <span className="font-mono text-text-muted shrink-0 tabular-nums w-16 text-right">{b.kg.toFixed(1)} kg</span>
            <span className="font-mono text-text-faint shrink-0 w-10 text-right">{fmtBagTime(b.bagging_time)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// One re-bag product type's bags — same compact per-bag shape as
// OutputTypeGroup, plus the source bag each one drew from and its item ID.
function RebagTypeGroup({ type, rows, multiShift }: { type: string; rows: OrderRebagRow[]; multiShift: boolean }) {
  const kg = rows.reduce((s, r) => s + (r.kg || 0), 0)
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">{type}</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {rows.length} bag{rows.length === 1 ? '' : 's'} · {kg.toFixed(1)} kg
        </span>
      </div>
      <ul className="divide-y divide-surface-rule/60">
        {rows.map((r, i) => (
          <li key={`${r.targetSerial}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span className="font-mono text-text-faint w-6 shrink-0 text-right">{i + 1}</span>
            <span className="font-mono text-text flex-1 min-w-0 truncate">
              {r.targetSerial}
              {r.sourceSerial && (
                <span className="text-text-faint"> <ArrowRightLeft size={10} className="inline -mt-px" /> {r.sourceSerial}</span>
              )}
            </span>
            {multiShift && <span className="text-[10px] text-text-faint shrink-0 capitalize">{r.shift}</span>}
            {r.acumaticaId && <span className="font-mono text-[10px] text-text-faint shrink-0">{r.acumaticaId}</span>}
            <span className="font-mono text-text-muted shrink-0 tabular-nums w-16 text-right">{r.kg.toFixed(1)} kg</span>
            <span className="font-mono text-text-faint shrink-0 w-10 text-right">{fmtBagTime(r.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// One shift's block: its AI machine-checks summary, its own mass balance, and
// its sign-off.
function ShiftBlock({ block }: { block: OrderShiftBlock }) {
  const { session: s, massBalance: mb, signatures, aiSummary } = block
  const opSig  = signatures.find(x => x.signer_role === 'operator')
  const supSig = signatures.find(x => x.signer_role === 'supervisor')
  const label = SHIFT_LABEL[s.shift] ?? s.shift
  return (
    <Panel>
      <PanelHead title={`${label} shift`} meta={s.record_no ?? undefined}
        action={<span className="font-mono text-[10.5px] text-text-faint">{block.bagCount} bags · {block.bagsOutputKg.toFixed(1)} kg</span>} />
      <PanelBody>
        <div className="space-y-4">
          {aiSummary && (
            <div className="rounded-xl border border-ok/30 bg-ok/5 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-semibold text-ok uppercase tracking-[0.06em]"><Sparkles size={12} /> Checks summary</div>
              <p className="text-[12.5px] text-text leading-relaxed">{aiSummary}</p>
            </div>
          )}
          {mb && (() => {
            const shiftOutput = num(mb.total_output_a_kg) + num(mb.total_output_b_kg) + num(mb.total_output_c_kg) + num(mb.total_output_d_kg)
            const shiftBalance = massBalanceInfo(shiftOutput, num(mb.total_input_kg))
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Input"   value={`${num(mb.total_input_kg).toFixed(1)} kg`} />
                <Field label="Output"  value={`${shiftOutput.toFixed(1)} kg`} />
                <Field label="Balance" value={<span className={TONE_TEXT_CLASS[shiftBalance.tone]}>{shiftBalance.text}</span>} />
                <Field label="Operators" value={s.operator_names?.join(', ') || '—'} />
              </div>
            )
          })()}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SignoffBlock label="Operator"   name={s.op_name_signoff}  signedAt={s.op_signed_at}  image={opSig?.signature_b64} />
            <SignoffBlock label="Supervisor" name={s.sup_name_signoff} signedAt={s.sup_signed_at} image={supSig?.signature_b64} />
          </div>
          {s.comments && <p className="text-[12.5px] text-text whitespace-pre-wrap border-t border-surface-rule/60 pt-3">{s.comments}</p>}
        </div>
      </PanelBody>
    </Panel>
  )
}

function Field({ label, value, bold, strong, className }: { label: string; value: ReactNode; bold?: boolean; strong?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-faint">{label}</div>
      <div className={`mt-0.5 ${strong ? 'text-[13.5px] font-bold text-text' : bold ? 'text-[12.5px] font-semibold text-text' : 'text-[12.5px] text-text'} ${className?.includes('col-span') ? '' : 'truncate'}`}>{value}</div>
    </div>
  )
}

function SignoffBlock({ label, name, signedAt, image }: { label: string; name: string | null; signedAt: string | null; image?: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-faint mb-1">{label}</div>
      {!name ? (
        <p className="text-[12px] text-text-faint">Not yet signed</p>
      ) : (
        <>
          <p className="text-[13px] text-text font-medium">{name}</p>
          {signedAt && <p className="text-[11px] text-text-muted">{format(new Date(signedAt), 'd MMM yyyy HH:mm')}</p>}
          {image && (
            <div className="mt-1.5 rounded-lg border border-surface-rule bg-white px-3 py-2 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt={`${name}'s signature`} style={{ height: 40 }} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

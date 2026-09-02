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
import { ArrowLeft, Printer, Loader2, CheckCircle2, Clock, Pen, Play, Radio, Sparkles, MessageSquare, MessageSquarePlus, ArrowRightLeft, AlertTriangle } from 'lucide-react'
import { loadOrderDay, type OrderDay, type OrderBagRow, type OrderRebagRow, type OrderFreshTopUpRow, type OrderDebagRow, type OrderShiftBlock, type OrderMassBalance, type OrderTimesheet, type OrderNote } from '@/lib/production/order-detail'
import { sectionMeta, GRADE_TO_LOCAL_EXPORT } from '@/lib/production/capture-config'
import { formatSAST } from '@/lib/production/shifts'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
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

// Mass balance on this page reads OUTPUT − INPUT (not input − output): a
// shortfall (the normal case — moisture, dust, spillage) is then a NEGATIVE
// number that reads as "material lost" at a glance, instead of an ambiguous
// positive figure whichever way round it's framed. Flagged once it's outside
// ±1% of total input — the tolerance a real run is expected to close within.
// Derived production figures are HIDDEN — see SHOW_DERIVED_FIGURES in
// CaptureOverview.tsx. A changeover bug was multiplying the captured debagging
// rows, so this page's whole-run balance read 91 036 kg in against 4 704 kg out
// and printed "-86 332 kg (-94.8%) material lost" beside it. The debagging and
// bagging rows below are correct and stay; only the balance derived from them is
// hidden.
//
// Flip to true to bring it back.
const SHOW_DERIVED_FIGURES = false

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
  if (!pt || /farm\s*bag/i.test(pt)) return 'Bulk Bag'
  return pt
}

export default function ProductionOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { displayName } = useAuth()
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
      .on('postgres_changes', { event: '*', schema: 'production', table: 'po_notes' },           (p: any) => { if (inScopeSession(p)) reload() })
      .on('postgres_changes', { event: '*', schema: 'production', table: 'prod_sessions' },      (p: any) => { if (inScopeSession(p) || inScopeDay(p)) reload() })
      .subscribe((s: string) => { if (alive) setLive(s === 'SUBSCRIBED') })
    const poll = setInterval(reload, 20_000)

    return () => { alive = false; clearInterval(poll); db.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-text-faint" /></div>
  if (error || !day) return <div className="p-6 text-center text-text-muted">{error ?? 'Production order not found.'}</div>

  const { section_id, date, status, grade, gradeLetters, poItems, shifts, bags, bagsOutputKg, rebagRows, freshTopUps, debags, debagDuplicatesHidden, duplicateOutputsHidden, massBalance: mb, timesheets, takeovers, notes, representativeSessionId } = day
  const meta = sectionMeta(section_id)
  const st = STATUS[status] ?? STATUS.new
  const operators = Array.from(new Set(shifts.flatMap(s => s.session.operator_names ?? [])))
  const variant = shifts.map(s => s.session.variant).find(Boolean) ?? null
  const supervisor = shifts.map(s => s.session.sup_name_signoff || s.session.supervisor_name).find(Boolean) ?? null
  const submittedAt = shifts.map(s => s.session.submitted_at).filter(Boolean).sort().slice(-1)[0] ?? null
  // Every grade the day actually ran, not just the first batch's. A changeover
  // run (Export, then Export Blend after it) has two, and reporting the first
  // one made 2026-08-31 read as a pure Export order with no Export Blend
  // anywhere on it -- the bags were captured, the grade just was not shown.
  const gradeNames = (gradeLetters ?? []).map(g => GRADE_TO_LOCAL_EXPORT[g] ?? `Grade ${g}`)
  const gradeText = gradeNames.length > 1
    ? gradeNames.join(' + ')
    : (gradeNames[0] ?? (grade ? `Grade ${grade}` : null))
  const variantGrade = [variant, gradeText].filter(Boolean).join(' · ') || '—'
  const changedOver = gradeNames.length > 1
  const poText = poItems.length
    ? poItems.map(p => p.description ? `${p.code} — ${p.description}` : p.code).join('; ')
    : '—'

  // The bucket elevator is WIP that carries across the day: the afternoon/night
  // shift LEAVES it in the tower for tomorrow, unprocessed — it hasn't become
  // bagged product yet, so it's excluded from BOTH sides of the balance (not
  // an input today, and not an output today either). It's captured as a debag
  // row, so pull it out of the input total and show it purely as an
  // informational carry-over figure, not summed into anything.
  // ── Mass balance: Total Output − Total Input ──────────────────────────────
  // Total Input  = farm bags debagged + machine spillage
  //                + bucket elevator carried in from the previous day, ONLY when
  //                  it is the same variant as this run. Conventional and organic
  //                  are separate physical pools that never mix, so last night's
  //                  carry-over is only this run's input if it is the same
  //                  material. A row with no variant recorded is counted rather
  //                  than dropped — legacy rows predate the column, and silently
  //                  losing real input is worse than counting an unprovable one.
  // Total Output = bags bagged out + the half-bag TOP-UP INCREMENTS (the weight
  //                added into an older bag today, not that bag's whole weight —
  //                bagsOutputKg already sums only the increments)
  //                MINUS nothing for the bucket elevator left for tomorrow: that
  //                is work in progress, not product, so it is excluded from
  //                output entirely rather than counted on either side.
  const isBucketRow   = (d: OrderDebagRow) => /bucket elevator/i.test(d.product_type || '')
  const isCarriedOut  = (d: OrderDebagRow) => isBucketRow(d) && (d.shift === 'afternoon' || d.shift === 'night')
  const sameVariant   = (d: OrderDebagRow) => !d.variant || !variant || d.variant === variant
  // Carried IN from yesterday, and only if it is this run's material.
  const bucketInExcluded = debags.filter(d => isBucketRow(d) && !isCarriedOut(d) && !sameVariant(d))
  const bucketInExcludedKg = bucketInExcluded.reduce((t, d) => t + (Number(d.kg_nett) || 0), 0)

  const inputRows = debags.filter(d => !isCarriedOut(d) && sameVariant(d))
  const bucketCarryOverKg = debags.filter(isCarriedOut).reduce((s, d) => s + (Number(d.kg_nett) || 0), 0)
  const totalInput  = inputRows.reduce((s, d) => s + (Number(d.kg_nett) || 0), 0)
  const totalOutput = bagsOutputKg
  const yieldPct = totalInput > 0 ? Math.round((totalOutput / totalInput) * 1000) / 10 : null
  const wholeRunBalance = massBalanceInfo(totalOutput, totalInput)

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
            {changedOver && (
              <p className="col-span-2 sm:col-span-4 text-[11.5px] text-text-muted leading-relaxed">
                This run changed grade mid-shift, so it covers {gradeNames.join(' and ')}. The
                Grade column on the tables below is per bag -- that is what says which bag belongs
                to which grade.
              </p>
            )}
          </div>
        </PanelBody>
      </Panel>

      {/* Notes — a timestamped log, separate from the per-shift handover
          comments below. Anyone can add one; author + SAST time are stamped
          server-side. */}
      <div className="no-print">
        <NotesPanel sessionId={representativeSessionId} notes={notes} requestedByName={displayName} />
      </div>

      {/* Whole-run mass balance — computed from actual debag/bag rows */}
      {(totalInput > 0 || totalOutput > 0) && (
        <Panel>
          <PanelHead title="Mass balance — full run (07h00–01h00)" />
          <PanelBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Total input"  value={`${totalInput.toFixed(1)} kg`} />
              <Field label="Total output" value={`${totalOutput.toFixed(1)} kg`} />
              <Field label="Balance (out − in)" value={<span className={TONE_TEXT_CLASS[wholeRunBalance.tone]}>{wholeRunBalance.text}</span>} />
              <Field label="Yield"        value={yieldPct != null ? `${yieldPct}%` : '—'} />
            </div>
            {/* What the two totals are made of, and anything held out of them —
                so the figure can be checked rather than taken on trust. */}
            <p className="mt-3 pt-3 border-t border-surface-rule/60 text-[11.5px] text-text-muted leading-relaxed">
              Input is farm bags debagged plus machine spillage, plus the bucket elevator carried in
              from the previous day when it is the same variant. Output is bags bagged out plus the
              weight added into older bags by half-bag top-up — the top-up amount only, not those
              bags&apos; full weight.
              {bucketCarryOverKg > 0 && (
                <> Bucket elevator left for tomorrow ({bucketCarryOverKg.toFixed(1)} kg) is work in
                progress and counts on neither side.</>
              )}
              {bucketInExcludedKg > 0 && (
                <> {bucketInExcludedKg.toFixed(1)} kg of carried-in bucket elevator is excluded as a
                different variant from this run.</>
              )}
              {(debagDuplicatesHidden > 0 || duplicateOutputsHidden > 0) && (
                <> Excludes {debagDuplicatesHidden > 0 ? `${debagDuplicatesHidden} duplicate debagging row${debagDuplicatesHidden === 1 ? '' : 's'}` : ''}
                {debagDuplicatesHidden > 0 && duplicateOutputsHidden > 0 ? ' and ' : ''}
                {duplicateOutputsHidden > 0 ? `${duplicateOutputsHidden} duplicate output row${duplicateOutputsHidden === 1 ? '' : 's'}` : ''} left by the changeover fault.</>
              )}
            </p>
          </PanelBody>
        </Panel>
      )}

      {/* Debagging (inputs) — grouped by type with per-type totals */}
      <Panel>
        <PanelHead title="Debagging — inputs"
          meta={`${inputRows.length} bag${inputRows.length === 1 ? '' : 's'}${
            debagDuplicatesHidden > 0 ? ` · ${debagDuplicatesHidden} duplicate row${debagDuplicatesHidden === 1 ? '' : 's'} hidden` : ''
          }`} />
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
          meta={`${bags.length} bag${bags.length === 1 ? '' : 's'} · ${bagsOutputKg.toFixed(1)} kg${
            duplicateOutputsHidden > 0 ? ` · ${duplicateOutputsHidden} duplicate row${duplicateOutputsHidden === 1 ? '' : 's'} hidden` : ''
          }`} />
        <PanelBody>
          {bags.length === 0 && bucketCarryOverKg === 0 ? <Empty>No output bags recorded.</Empty> : (
            <div className="space-y-4">
              {groupBy(bags, b => b.product_type || 'Other').map(g => (
                <OutputTypeGroup key={g.type} type={g.type} rows={g.rows} multiShift={shifts.length > 1} />
              ))}
              {bucketCarryOverKg > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-surface-rule px-3 py-2.5 text-[12.5px]">
                  <span className="text-text-muted">Bucket elevator — carried to next day <span className="text-text-faint">(WIP left in the tower, not bagged — excluded from mass balance)</span></span>
                  <span className="font-mono text-text tabular-nums whitespace-nowrap">{bucketCarryOverKg.toFixed(1)} kg</span>
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

      {/* Topped up from today's production — a Half-bag Top-up adding
          freshly produced weight into a bag first bagged on an EARLIER day,
          instead of starting a new bag. This genuinely IS new output, so —
          unlike Re-bagged in above — its kg IS already folded into Bagged
          output/Total output; shown here just for visibility into which
          older bag received it and from what batch. */}
      {freshTopUps.length > 0 && (
        <Panel>
          <PanelHead title="Topped up from today's production"
            meta={`${freshTopUps.length} bag${freshTopUps.length === 1 ? '' : 's'} · ${freshTopUps.reduce((s, r) => s + r.kg, 0).toFixed(1)} kg`} />
          <PanelBody>
            <div className="space-y-4">
              {groupBy(freshTopUps, r => r.productType || 'Other').map(g => (
                <FreshTopUpTypeGroup key={g.type} type={g.type} rows={g.rows} multiShift={shifts.length > 1} />
              ))}
              <p className="text-[11px] text-text-faint">Already included in Bagged output and Total output above — this is new production, not a transfer.</p>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* Per-shift: AI check summary + sign-off. Input/output computed from
          the same ledger rows as the whole-run total above (bags/debags
          filtered to this session), not the prod_mass_balance snapshot —
          that snapshot goes stale under the exact same conditions the
          whole-run total used to (persist() failing, or a submitted
          session), so it needs the same fix. */}
      {shifts.map(block => {
        const sid = block.session.id
        const shiftInput = inputRows.filter(d => d.session_id === sid)
          .reduce((s, d) => s + (Number(d.kg_nett) || 0), 0)
        const shiftOutput = bags.filter(b => b.session_id === sid && !b.bornViaRebag)
          .reduce((s, b) => s + (b.kg || 0), 0)
          + freshTopUps.filter(r => r.sessionId === sid).reduce((s, r) => s + r.kg, 0)
        return <ShiftBlock key={sid} block={block} shiftInput={shiftInput} shiftOutput={shiftOutput} />
      })}

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
  // Per-grade subtotals, shown on the header only when this type actually holds
  // more than one grade -- which is the whole point on a changeover run: the
  // total alone cannot say how much of it was Export Blend.
  const byGrade = gradeSplit(rows.map(r => ({ grade: r.grade, kg: Number(r.kg_nett) || 0 })))
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">{type}</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {byGrade && <span className="mr-2 text-text-faint">{byGrade}</span>}
          {rows.length} · {kg.toFixed(1)} kg
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[440px]">
          <thead>
            <tr>
              {['Farm bag', 'Lot', 'Grade', multiShift ? 'Shift' : null, 'kg'].filter(Boolean).map(h => (
                <th key={h as string} className={`px-3 py-1.5 font-mono text-[9px] font-semibold text-text-faint uppercase tracking-[0.06em] whitespace-nowrap ${h === 'kg' ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-rule/60">
            {rows.map(d => (
              <tr key={d.id}>
                <td className="px-3 py-1.5 font-mono text-[12px] text-text">{d.notes || d.bag_serial_no || '—'}</td>
                <td className="px-3 py-1.5 text-[12px] text-text-muted">{d.lot_number || '—'}</td>
                <td className="px-3 py-1.5 text-[12px] text-text-muted whitespace-nowrap">{d.grade || '—'}</td>
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

// "Export 4550 · Export Blend 2800" -- null when there is only one grade (or
// none recorded), so a single-grade run gains no noise.
function gradeSplit(rows: { grade: string | null; kg: number }[]): string | null {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = (r.grade || '').trim()
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + r.kg)
  }
  if (m.size < 2) return null
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([g, kg]) => `${g} ${kg.toFixed(0)}`)
    .join(' · ')
}

// One output product type's bags — compact per-bag lines with a per-type total.
function OutputTypeGroup({ type, rows, multiShift }: { type: string; rows: OrderBagRow[]; multiShift: boolean }) {
  const kg = rows.reduce((s, r) => s + (r.kg || 0), 0)
  // Per-grade split, shown only on a mixed group -- see gradeSplit.
  const byGrade = gradeSplit(rows.map(r => ({ grade: r.grade, kg: r.kg || 0 })))
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">{type}</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {byGrade && <span className="mr-2 text-text-faint">{byGrade}</span>}
          {rows.length} bag{rows.length === 1 ? '' : 's'} · {kg.toFixed(1)} kg
        </span>
      </div>
      <ul className="divide-y divide-surface-rule/60">
        {rows.map((b, i) => (
          <li key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span className="font-mono text-text-faint w-6 shrink-0 text-right">{i + 1}</span>
            <span className="font-mono text-text flex-1 min-w-0 truncate">{b.bag_serial_no || '—'}</span>
            {/* The grade this bag was TAGGED for. On a changeover run this is
                the only thing that says which bag is Export and which is
                Export Blend -- the order header cannot, it covers both. */}
            <span className="text-[11px] text-text-muted shrink-0 whitespace-nowrap">{b.grade || '—'}</span>
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

// One product type's "topped up from today's production" rows — same
// compact shape as RebagTypeGroup, showing the batch added instead of a
// source serial (there is no source bag for this path).
function FreshTopUpTypeGroup({ type, rows, multiShift }: { type: string; rows: OrderFreshTopUpRow[]; multiShift: boolean }) {
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
            <span className="font-mono text-text flex-1 min-w-0 truncate">{r.targetSerial}</span>
            {multiShift && <span className="text-[10px] text-text-faint shrink-0 capitalize">{r.shift}</span>}
            {r.batch && <span className="font-mono text-[10px] text-text-faint shrink-0">{r.batch}</span>}
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
function ShiftBlock({ block, shiftInput, shiftOutput }: { block: OrderShiftBlock; shiftInput: number; shiftOutput: number }) {
  const { session: s, signatures, aiSummary } = block
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
          {(shiftInput > 0 || shiftOutput > 0) && (() => {
            const shiftBalance = massBalanceInfo(shiftOutput, shiftInput)
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Input"   value={`${shiftInput.toFixed(1)} kg`} />
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

// ── Notes — a timestamped log on the order ─────────────────────────────────
// Separate from a shift's single "Handover & operator notes" field (which the
// next save overwrites): every note here stays, with its own author and SAST
// timestamp, server-stamped rather than client-supplied. New notes are
// attached to the day's representative session; the realtime channel above
// (po_notes) picks up the insert and refreshes this list automatically.
function NotesPanel({ sessionId, notes, requestedByName }: {
  sessionId: string; notes: OrderNote[]; requestedByName: string
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!note.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/production/orders/${sessionId}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setNote('')
    } catch (e: any) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <Panel>
      <PanelHead title="Notes" meta={notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : undefined} />
      <PanelBody>
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Add a note for anyone else looking at this order…"
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-surface-rule bg-surface-card text-[13px] text-text outline-none focus:border-brand resize-none placeholder:text-text-faint" />
            <button onClick={submit} disabled={busy || !note.trim()}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-brand text-white text-[12.5px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors shrink-0">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquarePlus size={14} />} Add
            </button>
          </div>
          <p className="text-[10.5px] text-text-faint -mt-1.5">Adding as {requestedByName || 'you'}</p>
          {error && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> {error}</p>}
          {notes.length === 0 ? <Empty>No notes yet.</Empty> : (
            <div className="space-y-2.5 pt-1">
              {notes.map(n => (
                <div key={n.id} className="flex items-start gap-2">
                  <MessageSquare size={14} className="text-text-faint shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-text whitespace-pre-wrap leading-relaxed">{n.note}</p>
                    <span className="text-[10.5px] text-text-faint">
                      {n.created_by_name || 'Unknown'} · {formatSAST(n.created_at)} SAST
                      {n.shift && <span className="capitalize"> · {n.shift}</span>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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

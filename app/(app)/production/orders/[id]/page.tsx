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
import { sectionMeta, GRADE_TO_LOCAL_EXPORT, isOrganicVariant } from '@/lib/production/capture-config'
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

// One (variant, grade) run within the day, while it is being built up.
interface MutableRun {
  key: string
  variant: string | null
  grade: string | null
  inputs: OrderDebagRow[]
  outputs: OrderBagRow[]
}

// A run's title: what was made, in the words the floor uses. Either half can be
// missing, and a missing half says so rather than quietly disappearing — a run
// reading "Conventional" alone would look like a complete label, and the reader
// would have no way to tell it apart from one where the grade is genuinely
// known.
function runTitle(variant: string | null, grade: string | null): string {
  return `${variant || 'Variant not recorded'} · ${grade || 'grade not recorded'}`
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
  // Carried IN from yesterday, and only if it is this run's material.
  //
  // Two things were wrong with the guard this replaces, and together they cost
  // 5 950 kg off a printed order.
  //
  //   1. It was applied to EVERY debagging row, not just the bucket elevator —
  //      which is the only thing the comment above it ever described.
  //   2. It compared the raw variant STRING against the day's variant, and the
  //      day's variant is whatever the FIRST shift recorded.
  //
  // On 2026-09-07 the Sieving tower ran Conventional in the morning and
  // RA-Conventional in the afternoon. Every one of the afternoon's 18 farm-bag
  // rows failed `d.variant === variant` and was dropped — from the inputs
  // panel, from Total Input, and from the afternoon's own block, which printed
  // INPUT 0.0 kg. Output has no such filter, so all 47 bags still counted: the
  // order read 6 577 kg in against 12 892 kg out, +96.0%, 196% yield. Nothing
  // on the page said anything had been held back, because the sentence that
  // would have said so (bucketInExcludedKg) only ever covered bucket rows.
  //
  // Now: bucket rows only, compared by variant FAMILY. Conventional and
  // RA-Conventional are one physical pool and blend freely; organic is the
  // segregated one (ARCHITECTURE §5 — lib/production/inventory.ts already
  // matches carry-over this way).
  const family = (v: string | null | undefined) =>
    v ? (isOrganicVariant(v) ? 'organic' : 'conventional') : null
  const isCarriedInBucket = (d: OrderDebagRow) => isBucketRow(d) && !isCarriedOut(d)
  const bucketInExcluded = debags.filter(d =>
    isCarriedInBucket(d) && !!d.variant && !!variant && family(d.variant) !== family(variant))
  const bucketInExcludedKg = bucketInExcluded.reduce((t, d) => t + (Number(d.kg_nett) || 0), 0)
  const bucketExcludedIds = new Set(bucketInExcluded.map(d => d.id))

  const inputRows = debags.filter(d => !isCarriedOut(d) && !bucketExcludedIds.has(d.id))
  const bucketCarryOverKg = debags.filter(isCarriedOut).reduce((s, d) => s + (Number(d.kg_nett) || 0), 0)
  const totalInput  = inputRows.reduce((s, d) => s + (Number(d.kg_nett) || 0), 0)
  // Total output has TWO parts — bags bagged out, and the half-bag top-up
  // increments added into bags from an earlier day. The old Bagging panel
  // asserted the combined figure over a list containing only the bags, so the
  // top-ups appeared to be counted twice or not at all depending on which
  // number you read. The arithmetic is now in view instead: each run shows its
  // own bags, the top-ups are listed under "Not attributable to one run" with
  // their weight, and the two add up to this total.
  const totalOutput = bagsOutputKg
  const yieldPct = totalInput > 0 ? Math.round((totalOutput / totalInput) * 1000) / 10 : null
  const wholeRunBalance = massBalanceInfo(totalOutput, totalInput)

  // ── The order, divided into RUNS ─────────────────────────────────────────
  // A production order covers one section for one day, and a day can run more
  // than one thing. 2026-09-07 on the Sieving tower was Conventional in the
  // morning and RA-Conventional in the afternoon, both Domestic/Local, rolled
  // into one pair of totals that read as a single 12.5 t run of nothing in
  // particular. 31-08 was the same shape with grades: 14 385 kg in and
  // 14 103 kg out, correct to the kilogram, with nothing on the page
  // distinguishing Export from Export Blend.
  //
  // So the division here is (VARIANT, GRADE) — WHAT was made. The shift is only
  // WHEN it happened: it is carried on every row and named in each run's
  // header, but it does not divide the order, because one run routinely spans
  // the changeover and a changeover routinely happens mid-shift.
  //
  // Attribution needs a grade, and a grade is captured per bag on both sides —
  // the farm bag's grade at debagging, the bag's own destination at bagging —
  // so a run's input and output are measured figures, not an apportionment.
  //
  // A run DOES get a balance, which the by-grade table this replaces
  // deliberately withheld. The reasoning for withholding it was sound and is
  // kept, not discarded: the tower is one physical stream, so material sitting
  // in the machine when the variant or grade changed was fed by one run and
  // bagged by the next. What changed is that hiding the per-run balance did not
  // make that go away — it just left one whole-day figure that was wrong in a
  // way nobody could decompose. The balance is shown, and everything that
  // belongs to no run is listed under it with its weight, so the reader can see
  // exactly how much slack sits between the runs and the day.
  const runOrder: string[] = []
  const runMap = new Map<string, MutableRun>()
  const runFor = (v: string | null, g: string | null) => {
    const key = `${v ?? ''}|${g ?? ''}`
    let r = runMap.get(key)
    if (!r) { r = { key, variant: v, grade: g, inputs: [], outputs: [] }; runMap.set(key, r); runOrder.push(key) }
    return r
  }
  // The bucket elevator and machine spillage belong to no run by nature: the
  // elevator carries across the changeover and spillage is loss off the machine.
  // They are held out whatever else they carry.
  const belongsToNoRun = (d: OrderDebagRow) => d.is_spillage || isBucketRow(d)

  // Which grades each variant actually ran today, taken only from rows that
  // carry one. This places a row that has a variant but NO grade — which on the
  // Blender is most of them, because a bag whose bag_tags row was never written
  // has no destination to read. That is a gap in the record, not a fact about
  // the material, and filing 6 650 kg of blend under "not attributable" would
  // state the opposite. So it joins its variant's run when that variant ran
  // exactly ONE grade today. Where the variant ran two, nothing can be inferred
  // and it gets its own labelled block rather than being folded into either —
  // an Export bag quietly counted as Export Blend is the failure this whole
  // division exists to prevent.
  const gradesByVariant = new Map<string, Set<string>>()
  const noteGrade = (v: string | null, g: string | null) => {
    const grade = (g || '').trim()
    if (!grade) return
    const key = v ?? ''
    const set = gradesByVariant.get(key) ?? new Set<string>()
    set.add(grade)
    gradesByVariant.set(key, set)
  }
  for (const d of inputRows) if (!belongsToNoRun(d)) noteGrade(d.variant, d.grade)
  for (const b of bags) noteGrade(b.variant, b.grade)
  const soleGradeFor = (v: string | null): string | null => {
    const set = gradesByVariant.get(v ?? '')
    return set && set.size === 1 ? Array.from(set)[0] : null
  }

  const unattributedInputs: OrderDebagRow[] = []
  const unattributedOutputs: OrderBagRow[] = []
  // Inputs first, and `debags` arrives time-ordered, so the morning's run is
  // named before the afternoon's and the sections read down the day.
  for (const d of inputRows) {
    if (belongsToNoRun(d)) { unattributedInputs.push(d); continue }
    const g = (d.grade || '').trim() || soleGradeFor(d.variant)
    if (!g && !d.variant) { unattributedInputs.push(d); continue }
    runFor(d.variant, g).inputs.push(d)
  }
  for (const b of bags) {
    const g = (b.grade || '').trim() || soleGradeFor(b.variant)
    if (!g && !b.variant) { unattributedOutputs.push(b); continue }
    runFor(b.variant, g).outputs.push(b)
  }
  const runs = runOrder.map(key => {
    const r = runMap.get(key)!
    const shiftsInRun: string[] = []
    for (const row of [...r.inputs, ...r.outputs]) {
      if (row.shift && !shiftsInRun.includes(row.shift)) shiftsInRun.push(row.shift)
    }
    shiftsInRun.sort((a, b) => (a === 'morning' ? 0 : 1) - (b === 'morning' ? 0 : 1))
    const inKg = r.inputs.reduce((t, d) => t + (Number(d.kg_nett) || 0), 0)
    // Re-bagged-in bags are listed with the run but never summed into it —
    // their kg was counted as output on whatever earlier day the source bag was
    // first bagged. Same rule as the whole-day total.
    const outKg = r.outputs.filter(b => !b.bornViaRebag).reduce((t, b) => t + (b.kg || 0), 0)
    return { ...r, shifts: shiftsInRun, inKg, outKg }
  })
  // Half-bag top-ups add weight to a bag first bagged on an earlier day; the
  // increment carries no grade of its own, so it belongs to no run either.
  const topUpUnattributedKg = freshTopUps.reduce((t, r) => t + r.kg, 0)
  const unattributedInKg  = unattributedInputs.reduce((t, d) => t + (Number(d.kg_nett) || 0), 0)
  const unattributedOutKg = unattributedOutputs.filter(b => !b.bornViaRebag).reduce((t, b) => t + (b.kg || 0), 0)
    + topUpUnattributedKg
  const hasUnattributed = unattributedInputs.length > 0 || unattributedOutputs.length > 0
    || topUpUnattributedKg > 0 || bucketCarryOverKg > 0
  // The header names every run the day actually held, not just the first
  // shift's — which is what made 07-09 read as a plain Conventional order when
  // half of it was RA-Conventional.
  const runsLabel = runs.length ? runs.map(r => runTitle(r.variant, r.grade)).join('  +  ') : variantGrade

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
            <Field label="Variant & grade" value={runsLabel} strong className="col-span-2" />
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

      {/* ── The runs ─────────────────────────────────────────────────────────
          One section per (variant, grade): what went in, what came out, and its
          own balance. The shift is a column on every row and a label in each
          header — it says WHEN, not WHAT, and one run routinely spans the
          changeover. */}
      {runs.length === 0 && (totalInput > 0 || totalOutput > 0) && (
        <Panel>
          <PanelHead title="Runs" />
          <PanelBody>
            <Empty>Nothing captured against a variant and grade — see the day totals below.</Empty>
          </PanelBody>
        </Panel>
      )}
      {runs.map(run => (
        <RunSection key={run.key} run={run} multiShift={shifts.length > 1} />
      ))}

      {/* Everything that belongs to no single run. Listed rather than spread
          across the runs, because spreading it would be an apportionment and
          every other figure on this page is a measurement. */}
      {hasUnattributed && (
        <Panel>
          <PanelHead title="Not attributable to one run"
            meta={`${unattributedInKg.toFixed(1)} kg in · ${unattributedOutKg.toFixed(1)} kg out`} />
          <PanelBody>
            <div className="space-y-4">
              <p className="text-[11.5px] text-text-muted leading-relaxed">
                The bucket elevator carries across the changeover, machine spillage is loss off the
                machine, and a half-bag top-up adds weight to a bag first bagged on an earlier day.
                None of them carries a grade, so none of them belongs to a run above — but all of
                them are real and all of them are in the day totals below. This is the slack between
                the runs and the day.
              </p>
              {unattributedInputs.length > 0 && (
                <>
                  <BatchTotals rows={unattributedInputs} />
                  {groupBy(unattributedInputs, inputType).map(g => (
                    <InputTypeGroup key={`u-in-${g.type}`} type={g.type} rows={g.rows} multiShift={shifts.length > 1} />
                  ))}
                </>
              )}
              {groupBy(unattributedOutputs, b => b.product_type || 'Other').map(g => (
                <OutputTypeGroup key={`u-out-${g.type}`} type={g.type} rows={g.rows} multiShift={shifts.length > 1} />
              ))}
              {bucketCarryOverKg > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-surface-rule px-3 py-2.5 text-[12.5px]">
                  <span className="text-text-muted">Bucket elevator — carried to next day <span className="text-text-faint">(WIP left in the tower, not bagged — counts on neither side)</span></span>
                  <span className="font-mono text-text tabular-nums whitespace-nowrap">{bucketCarryOverKg.toFixed(1)} kg</span>
                </div>
              )}
              {topUpUnattributedKg > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-surface-rule px-3 py-2.5 text-[12.5px]">
                  <span className="text-text-muted">Half-bag top-ups into older bags <span className="text-text-faint">(the increment only — listed in full further down)</span></span>
                  <span className="font-mono text-text tabular-nums whitespace-nowrap">+{topUpUnattributedKg.toFixed(1)} kg</span>
                </div>
              )}
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* Whole day — the check that the runs and the unattributed add up, not
          the headline. It sits under them deliberately: one pair of totals for
          a day that ran two different materials is the figure that made this
          page unreadable in the first place. */}
      {(totalInput > 0 || totalOutput > 0) && (
        <Panel>
          <PanelHead title="Whole day — all runs combined (07h00–01h00)"
            meta={runs.length > 1 ? `${runs.length} runs` : undefined} />
          <PanelBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Total input"  value={`${totalInput.toFixed(1)} kg`} />
              <Field label="Total output" value={`${totalOutput.toFixed(1)} kg`} />
              <Field label="Balance (out − in)" value={<span className={TONE_TEXT_CLASS[wholeRunBalance.tone]}>{wholeRunBalance.text}</span>} />
              <Field label="Yield"        value={yieldPct != null ? `${yieldPct}%` : '—'} />
            </div>

            {runs.length > 1 && (
              <div className="mt-4 rounded-xl border border-surface-rule overflow-hidden">
                <div className="px-3 py-2 bg-surface-dim text-[12.5px] font-semibold text-text">Per run</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[560px]">
                    <thead>
                      <tr>
                        {['Run', 'Shift', 'Input', 'Output', 'Balance', 'Bags'].map((h, i) => (
                          <th key={h} className={`px-3 py-1.5 font-mono text-[9px] font-semibold text-text-faint uppercase tracking-[0.06em] whitespace-nowrap ${i > 1 ? 'text-right' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-rule/60">
                      {runs.map(r => {
                        const bal = massBalanceInfo(r.outKg, r.inKg)
                        return (
                          <tr key={r.key}>
                            <td className="px-3 py-1.5 text-[12.5px] font-medium text-text whitespace-nowrap">{runTitle(r.variant, r.grade)}</td>
                            <td className="px-3 py-1.5 text-[11.5px] text-text-muted whitespace-nowrap">{r.shifts.map(s => SHIFT_LABEL[s] ?? s).join(' + ') || '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{r.inKg.toFixed(1)} kg</td>
                            <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{r.outKg.toFixed(1)} kg</td>
                            <td className={`px-3 py-1.5 font-mono text-[12px] text-right tabular-nums whitespace-nowrap ${TONE_TEXT_CLASS[bal.tone]}`}>
                              {bal.balance >= 0 ? '+' : ''}{bal.balance.toFixed(1)} kg
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{r.outputs.length}</td>
                          </tr>
                        )
                      })}
                      {(unattributedInKg > 0 || unattributedOutKg > 0) && (
                        <tr>
                          <td className="px-3 py-1.5 text-[12.5px] text-text-muted" colSpan={2}>
                            Not attributable to one run
                            <span className="block text-[10.5px] text-text-faint">
                              bucket elevator across the changeover, machine spillage, half-bag top-ups
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{unattributedInKg > 0 ? `${unattributedInKg.toFixed(1)} kg` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{unattributedOutKg > 0 ? `${unattributedOutKg.toFixed(1)} kg` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-text-faint text-right tabular-nums">—</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-text-faint text-right tabular-nums">{unattributedOutputs.length || '—'}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="px-3 py-2 border-t border-surface-rule/60 bg-surface-dim/40 text-[11px] text-text-muted leading-relaxed">
                  A run&apos;s balance covers its own material only. The tower is one physical stream,
                  so material sitting in the machine when the variant or the grade changed was fed by
                  one run and bagged by the next — that reads as a shortfall on the first and a
                  surplus on the second. The row above holds what belongs to neither. Read the run
                  balances together with the day figure, not instead of it.
                </p>
              </div>
            )}

            {/* What the two totals are made of, and anything held out of them —
                so the figure can be checked rather than taken on trust. */}
            <p className="mt-3 pt-3 border-t border-surface-rule/60 text-[11.5px] text-text-muted leading-relaxed">
              Input is farm bags debagged plus machine spillage, plus the bucket elevator carried in
              from the previous day when it is the same variant family. Output is bags bagged out
              plus the weight added into older bags by half-bag top-up — the top-up amount only, not
              those bags&apos; full weight.
              {bucketCarryOverKg > 0 && (
                <> Bucket elevator left for tomorrow ({bucketCarryOverKg.toFixed(1)} kg) is work in
                progress and counts on neither side.</>
              )}
              {bucketInExcludedKg > 0 && (
                <> {bucketInExcludedKg.toFixed(1)} kg of carried-in bucket elevator is excluded as a
                different variant family from this run.</>
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

// ── One run: one (variant, grade) within the day ─────────────────────────────
// Complete on its own — its inputs per batch and per type, its output bags per
// product, and its own balance. This is the unit the floor and the certifier
// both think in: RA-Conventional Domestic/Local is a different thing from
// Conventional Domestic/Local and always was, whichever shift made it.
//
// The shift is shown, never used to divide: a run spans the changeover whenever
// the tower keeps running the same material past 16h00, which is most days.
interface RunView extends MutableRun {
  shifts: string[]
  inKg: number
  outKg: number
}

function RunSection({ run, multiShift }: { run: RunView; multiShift: boolean }) {
  const bal = massBalanceInfo(run.outKg, run.inKg)
  const runYield = run.inKg > 0 ? Math.round((run.outKg / run.inKg) * 1000) / 10 : null
  const shiftText = run.shifts.map(s => SHIFT_LABEL[s] ?? s).join(' + ') || '—'
  const fromLot = run.outputs.filter(b => b.gradeSource === 'lot').length
  return (
    <Panel>
      <PanelHead
        title={runTitle(run.variant, run.grade)}
        meta={`${shiftText} · ${run.inputs.length} bag${run.inputs.length === 1 ? '' : 's'} in · ${run.outputs.length} bag${run.outputs.length === 1 ? '' : 's'} out`} />
      <PanelBody>
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Input"  value={`${run.inKg.toFixed(1)} kg`} />
            <Field label="Output" value={`${run.outKg.toFixed(1)} kg`} />
            <Field label="Balance (out − in)" value={<span className={TONE_TEXT_CLASS[bal.tone]}>{bal.text}</span>} />
            <Field label="Yield"  value={runYield != null ? `${runYield}%` : '—'} />
          </div>

          <div>
            <SubHead label="Debagging — inputs"
              meta={`${run.inputs.length} bag${run.inputs.length === 1 ? '' : 's'} · ${run.inKg.toFixed(1)} kg`} />
            {run.inputs.length === 0 ? <Empty>No inputs recorded for this run.</Empty> : (
              <div className="space-y-4">
                <BatchTotals rows={run.inputs} />
                {groupBy(run.inputs, inputType).map(g => (
                  <InputTypeGroup key={g.type} type={g.type} rows={g.rows} multiShift={multiShift} />
                ))}
              </div>
            )}
          </div>

          <div>
            <SubHead label="Bagging — outputs"
              meta={`${run.outputs.length} bag${run.outputs.length === 1 ? '' : 's'} · ${run.outKg.toFixed(1)} kg`} />
            {fromLot > 0 && (
              <p className="mb-3 text-[11.5px] text-text-muted leading-relaxed">
                {fromLot} bag{fromLot === 1 ? '' : 's'} below take their grade from the lot they were
                sieved from, not from the bag&apos;s own tag — marked{' '}
                <span className="text-warn font-medium">from lot</span>. A lot&apos;s grade is settled
                when it is debagged, so a bag off an Export Blend lot is Export Blend even if the tag
                still said Export. The printed label on those bags is wrong and needs reprinting.
              </p>
            )}
            {run.outputs.length === 0 ? <Empty>No output bags recorded for this run.</Empty> : (
              <div className="space-y-4">
                {groupBy(run.outputs, b => b.product_type || 'Other').map(g => (
                  <OutputTypeGroup key={g.type} type={g.type} rows={g.rows} multiShift={multiShift} />
                ))}
              </div>
            )}
          </div>
        </div>
      </PanelBody>
    </Panel>
  )
}

// A heading inside a run, one step down from PanelHead — the run is the panel,
// so inputs and outputs cannot each be one too without the page becoming a
// stack of identical boxes.
function SubHead({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-2">
      <span className="text-[12.5px] font-semibold text-text">{label}</span>
      {meta && <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">{meta}</span>}
    </div>
  )
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

// Totals per batch number, biggest first. A blank key collapses into one
// "(no batch)" line rather than being dropped, so the figures still add up --
// which is right for an OUTPUT bag that genuinely has no batch. Debagging's
// lot-less rows are named for what they are instead; see BatchTotals.
function batchTotals(rows: { lot: string | null; kg: number }[]): { lot: string; kg: number; n: number }[] {
  const m = new Map<string, { lot: string; kg: number; n: number }>()
  for (const r of rows) {
    const lot = (r.lot || '').trim() || '(no batch)'
    const cur = m.get(lot)
    if (cur) { cur.kg += r.kg; cur.n++ }
    else m.set(lot, { lot, kg: r.kg, n: 1 })
  }
  return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
}

// Debagging, totalled per batch number. The per-type tables below it list every
// bag; this answers "how much of each batch went in" without counting by eye.
//
// The bucket elevator and machine spillage carry no lot, and lumping them under
// a row called "(no batch)" read as though the elevator were a batch by that
// name. They are not batches at all -- the elevator is yesterday's carry-over
// and spillage is loss off the machine -- so they are named for what they are,
// below the batches, under a heading that says so. Still shown, because they
// are real input and the totals have to add up.
function BatchTotals({ rows }: { rows: OrderDebagRow[] }) {
  const batched = rows.filter(r => (r.lot_number || '').trim())
  const unbatched = rows.filter(r => !(r.lot_number || '').trim())
  const batches = batchTotals(batched.map(r => ({ lot: r.lot_number, kg: Number(r.kg_nett) || 0 })))
  // Grouped by what they are (Bucket Elevator / Machine Spillage), via the same
  // naming the tables below use.
  const others = batchTotals(unbatched.map(r => ({ lot: inputType(r), kg: Number(r.kg_nett) || 0 })))
  if (batches.length === 0 && others.length === 0) return null
  const batchedKg = batches.reduce((s, b) => s + b.kg, 0)
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">Per batch</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {batches.length} batch{batches.length === 1 ? '' : 'es'} · {batchedKg.toFixed(1)} kg
        </span>
      </div>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr>
            {['Batch', 'Bags', 'kg'].map((h, i) => (
              <th key={h} className={`px-3 py-1.5 font-mono text-[9px] font-semibold text-text-faint uppercase tracking-[0.06em] whitespace-nowrap ${i > 0 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-rule/60">
          {batches.map(b => (
            <tr key={b.lot}>
              <td className="px-3 py-1.5 text-[12.5px] font-medium text-text whitespace-nowrap">{b.lot}</td>
              <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{b.n}</td>
              <td className="px-3 py-1.5 font-mono text-[12px] text-text text-right tabular-nums">{b.kg.toFixed(1)}</td>
            </tr>
          ))}
          {others.length > 0 && (
            <tr>
              <td colSpan={3} className="px-3 pt-2.5 pb-1 text-[10px] font-mono font-semibold text-text-faint uppercase tracking-[0.06em]">
                No batch of its own
              </td>
            </tr>
          )}
          {others.map(o => (
            <tr key={o.lot}>
              <td className="px-3 py-1.5 text-[12.5px] text-text-muted whitespace-nowrap">{o.lot}</td>
              <td className="px-3 py-1.5 font-mono text-[12px] text-text-faint text-right tabular-nums">—</td>
              <td className="px-3 py-1.5 font-mono text-[12px] text-text-muted text-right tabular-nums">{o.kg.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {others.length > 0 && (
        <p className="px-3 py-2 border-t border-surface-rule/60 bg-surface-dim/40 text-[11px] text-text-muted leading-relaxed">
          The bucket elevator is yesterday&apos;s carry-over and machine spillage is loss off the
          machine — neither belongs to a batch, and neither is a bag, so no bag count is shown. Both
          are counted in Total input.
        </p>
      )}
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
  // Per batch, for this product. Fine Leaf and Coarse Leaf are each bagged
  // against a batch number and the per-batch total is what gets reconciled.
  const batches = batchTotals(rows.map(r => ({ lot: r.lot_number, kg: r.kg || 0 })))
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">{type}</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {byGrade && <span className="mr-2 text-text-faint">{byGrade}</span>}
          {rows.length} bag{rows.length === 1 ? '' : 's'} · {kg.toFixed(1)} kg
        </span>
      </div>
      {batches.length > 1 && (
        <div className="px-3 py-2 border-b border-surface-rule/60 bg-surface-dim/40 flex flex-wrap gap-x-4 gap-y-1">
          {batches.map(b => (
            <span key={b.lot} className="text-[11.5px] text-text-muted whitespace-nowrap">
              {b.lot} <span className="font-mono text-text tabular-nums">{b.kg.toFixed(1)} kg</span>
              <span className="text-text-faint"> · {b.n} bag{b.n === 1 ? '' : 's'}</span>
            </span>
          ))}
        </div>
      )}
      <ul className="divide-y divide-surface-rule/60">
        {rows.map((b, i) => (
          <li key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span className="font-mono text-text-faint w-6 shrink-0 text-right">{i + 1}</span>
            <span className="font-mono text-text flex-1 min-w-0 truncate">{b.bag_serial_no || '—'}</span>
            {/* The batch this bag was bagged under. Fine Leaf and Coarse Leaf
                are both bagged against a batch number, and a serial alone does
                not say which material it came from. */}
            <span className="text-[11px] text-text-muted shrink-0 whitespace-nowrap">{b.lot_number || '—'}</span>
            {/* The grade, and where it came from. On a changeover run this is
                the only thing that says which bag is Export and which is
                Export Blend -- the order header cannot, it covers both.
                A grade taken from the lot rather than the bag's own tag is
                marked, with what the tag said, so the override is never
                silent: someone reading a label that says Export needs to see
                why the report says Export Blend. */}
            <span className="text-[11px] shrink-0 whitespace-nowrap">
              <span className={b.gradeSource === 'lot' ? 'text-warn font-medium' : 'text-text-muted'}>
                {b.grade || '—'}
              </span>
              {b.gradeSource === 'lot' && (
                <span className="text-[9.5px] text-text-faint"> from lot{b.gradeTagged ? ` (tagged ${b.gradeTagged})` : ''}</span>
              )}
              {b.gradeSource === 'ambiguous' && (
                <span className="text-[9.5px] text-text-faint" title="This lot was debagged under more than one grade, so the bag's own tag stands."> lot mixed</span>
              )}
            </span>
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
      {/* block.bagsOutputKg includes this shift's top-up increments while
          bagCount counts only bags, so the two are labelled rather than run
          together as though the kg belonged to the bags. */}
      <PanelHead title={`${label} shift`} meta={s.record_no ?? undefined}
        action={<span className="font-mono text-[10.5px] text-text-faint">
          {block.bagCount} bags · {block.bagsOutputKg.toFixed(1)} kg out
        </span>} />
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

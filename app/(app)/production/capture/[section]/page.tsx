'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter, useParams } from 'next/navigation'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import {
  ChevronLeft, Loader2, CheckCircle2, AlertTriangle, Users, Lock,
  ClipboardList, PenLine, Save, Sparkles, Info, Plus, Gauge, HelpCircle,
  FileText, Check, ArrowRight, RefreshCw, Scale,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SignaturePad } from '@/components/production/capture/SignaturePad'
import { TimesheetConfirm } from '@/components/production/capture/TimesheetConfirm'
import {
  SievingCapture, emptySievingData, sievingTotals,
  type SievingData, type Shift,
} from '@/components/production/capture/SievingCapture'
import { MassBalanceTable, BalanceBadge, type BalanceRow } from '@/components/production/capture/MassBalanceTable'
import {
  RefiningCapture, emptyRefiningData, refiningTotals,
  type RefiningData,
} from '@/components/production/capture/RefiningCapture'
import {
  GranuleCapture, emptyGranuleData, granuleTotals, dustProductType,
  type GranuleData,
} from '@/components/production/capture/GranuleCapture'
import {
  BlenderCapture, emptyBlenderData, blenderTotals, blenderCapturedCodes, resolveExistingBlendRunNo,
  type BlenderData, type CapturedCode,
} from '@/components/production/capture/BlenderCapture'
import {
  PasteuriserCapture, emptyPasteuriserData, pasteuriserTotals,
  type PasteuriserData,
} from '@/components/production/capture/PasteuriserCapture'
import { HalfBagTopUpModal } from '@/components/production/capture/HalfBagTopUpModal'
import { HalfBagTopUpActivity } from '@/components/production/capture/HalfBagTopUpActivity'
import { fetchTopUpEventsForSession } from '@/lib/production/scan-utils'
import { sectionKindFor, assertNever, type SectionKind } from '@/lib/core/types/capture'
import { productionTotals, sumProductionTotals, withTopUp,
  type ProductionTotals, type AnyBalanceData } from '@/lib/core/mass-balance'
import { outstandingBucketElevator, variantFamily } from '@/lib/production/bucket-elevator'
import { upperCode } from '@/lib/production/normalize-code'
import { dbDate } from '@/lib/production/db-date'
import { CleaningPanel } from '@/components/production/capture/CleaningPanel'
import { ChecksPanel } from '@/components/production/capture/ChecksPanel'
import { ChecksStatusStrip } from '@/components/production/capture/ChecksStatusStrip'
import { HourlyVsdPrompt } from '@/components/production/capture/HourlyVsdPrompt'
import { CaptureOverview, type BlenderRatioGroup } from '@/components/production/capture/CaptureOverview'
import { getBlendComponents, groupComponentsByItem, type BlendIngredientGroup } from '@/lib/production/bom'
import { normalizeBatch } from '@/lib/production/batch-key'
import { ensureCheckRecord, appendCheckEvent, loadCheckRecord } from '@/lib/production/checks-db'
import { machineChecksFor } from '@/lib/production/checks-config'
import { cleanersOnDuty } from '@/lib/production/cleaner-roster'
import { sectionMeta, makeSerial, massBalanceToleranceFor, VARIANT_OPTIONS, variantToShort, DESTINATION_OPTIONS, isOrganicVariant } from '@/lib/production/capture-config'
import { LineChat } from '@/components/production/capture/LineChat'
import { getMySignatureStatus, type MySignatureStatus } from '@/lib/production/employee-signature'
import type { Operator, ShiftAssignment } from '@/lib/supabase/database.types'
import { MessageSquare } from 'lucide-react'
import { productionShiftNow, SHIFT_LABEL } from '@/lib/production/shifts'
import { ShiftBagLog } from '@/components/production/capture/ShiftBagLog'
import { n } from '@/lib/core/num'

type Tab = 'production' | 'checks' | 'cleaning' | 'overview' | 'signoff' | 'messages'

// What the operator copies to IT when a structured row write fails. Postgres puts
// the constraint name in `message` but the offending key in `details` ("Key
// (session_id, bag_no)=(…, 3) already exists"), and without that second half a
// duplicate-key report can't be traced to the row that caused it.
const rowErrText = (e: { message?: string; details?: string | null; code?: string | null }) =>
  [e.message, e.details, e.code ? `[${e.code}]` : null].filter(Boolean).join(' — ')

// The capture screen reads as the real-world process the operators follow:
// machine checks → capture (debag/bag) → cleaning → overview → sign-off.
// Messages sits outside the flow (header icon) since it isn't a production step.
const STEPS: { id: Tab; label: string; icon: typeof Gauge }[] = [
  { id: 'checks',     label: 'Checks',   icon: Gauge },
  { id: 'production', label: 'Capture',  icon: ClipboardList },
  { id: 'cleaning',   label: 'Cleaning', icon: Sparkles },
  { id: 'overview',   label: 'Overview', icon: FileText },
  { id: 'signoff',    label: 'Sign-off', icon: PenLine },
]

// Big Blender and Small Blender share one capture component (BlenderCapture) —
// they just run different work centres' blends (lib/production/bom.ts's
// WORK_CENTRE_FOR_SECTION keys off this same pair).
const isBlenderSection = (id: string) => id === 'blender' || id === 'smallblender'
const isPasteuriser = (id: string) => id === 'pasteuriser'
// prod_bagging.bagging_time is a timestamptz holding the exact moment each
// output bag was created — every section captures this client-side as the bag's
// logged_at (a UTC ISO instant) when it's secured. We store that instant
// verbatim so the timestamp reflects when the bag was actually bagged, immune to
// persist()'s delete+reinsert (which restamps created_at on every save). The
// SAST wall-clock conversion happens at read/display time, not here.

// A shift can contain several productions, each its own variant/destination/lot.
interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData | RefiningData | GranuleData | BlenderData | PasteuriserData }

// A production's "what am I actually running" identity — the key two sibling
// sessions must share before their mass balances are allowed to combine.
// Blender/smallblender have no grade, but DO have a blend code (bomId) that
// grade would otherwise stand in for — mixing two different blends' balances
// together is exactly as wrong as mixing two different grades'.
function productionMatchKey(p: Production, sectionId: string): string {
  if (isBlenderSection(sectionId)) {
    const bomId = (p.data as BlenderData | undefined)?.bomId ?? ''
    return `${p.variant ?? ''}::${bomId}`
  }
  return `${p.variant ?? ''}::${p.grade ?? ''}`
}
// Variant comes from the assignment when a supervisor set one; grade is always a
// deliberate choice on the floor. Both start blank when unknown so the operator
// must pick them — capture never silently defaults to Export / Conventional.
const emptyProduction = (sectionId: string, variant?: string | null, lot?: string | null, grade: string = ''): Production =>
  ({ id: crypto.randomUUID(), variant: variant || '', grade, lot: lot || '',
     data: emptyDataFor(sectionKindFor(sectionId)) })

// The blank data shape for a section. Exhaustive on the section kind, so adding
// a section without giving it a starting shape fails the build rather than
// silently handing it Sieving's.
function emptyDataFor(kind: SectionKind): Production['data'] {
  switch (kind) {
    case 'refining':    return emptyRefiningData()
    case 'granule':     return emptyGranuleData()
    case 'blender':     return emptyBlenderData()
    case 'pasteuriser': return emptyPasteuriserData()
    case 'sieving':     return emptySievingData()
    default:            return assertNever(kind, 'section kind')
  }
}

// True only when a production actually has weighed capture (any section type).
// Used to gate session creation so opening a section — or starting a new batch
// record and then abandoning it — never leaves an empty "No data" session behind.
function hasCaptureData(prods: Production[]): boolean {
  const num = (v: any) => parseFloat(String(v ?? '').replace(',', '.')) || 0
  return (prods ?? []).some((p: any) => {
    const d = p?.data ?? {}
    if (Array.isArray(d.debag)   && d.debag.some((r: any) => num(r.nett) > 0))    return true   // sieving in
    if (Array.isArray(d.outputs) && d.outputs.some((b: any) => num(b.weight) > 0)) return true   // sieving/granule out
    if (Array.isArray(d.spillage)&& d.spillage.some((r: any) => num(r.kg) > 0))   return true   // bucket/machine
    if (Array.isArray(d.inputs)  && d.inputs.some((r: any) => num(r.weight) > 0)) return true   // refining in
    for (const g of [d.outputA, d.outputB, d.outputC, d.outputD]) {                              // refining out
      if (g && Array.isArray(g.bags) && g.bags.some((b: any) => num(b.weight) > 0)) return true
    }
    if (Array.isArray(d.blends) && d.blends.some((bl: any) => Array.isArray(bl.rows) && bl.rows.some((r: any) => num(r.weight) > 0))) return true // granule in
    if (Array.isArray(d.dustOutputs) && d.dustOutputs.some((r: any) => num(r.weight) > 0)) return true // granule dust out
    // Blender's { inputs, outputs } shape is already covered by the refining `d.inputs`
    // check and the sieving/granule `d.outputs` check above — no extra branch needed.
    // Pasteuriser: debag rows carry `weight` (not `nett`) and output lines carry a
    // bag count (not a single `weight`), so neither is caught above — check both.
    if (Array.isArray(d.debag)   && d.debag.some((r: any) => num(r.weight) > 0))    return true   // pasteuriser in
    if (Array.isArray(d.outputs) && d.outputs.some((l: any) => num(l.bagCount) > 0)) return true   // pasteuriser out
    return false
  })
}

function CaptureScreen() {
  const params = useParams()
  const sp     = useSearchParams()
  const router = useRouter()
  const { user, role, isSupervisor, isIT, signOut, displayName, p: hasPerm } = useAuth()

  const sectionId = (params.section as string) ?? ''
  // Refining 1/2 and Blender have no machine checks configured (nothing on the
  // paper form to check) — the Checks step is deactivated for them rather than
  // showing an empty panel that still demands a PIN sign-off for nothing.
  const hasChecks = machineChecksFor(sectionId).length > 0
  const visibleSteps = hasChecks ? STEPS : STEPS.filter(s => s.id !== 'checks')
  // Grade-driven sections (Sieving) need a grade chosen per batch; Refining and
  // Granule are variant-only — traceability there comes from the system serials.
  // Blender's Export/Export Blend/Domestic field lives per input row (matching the
  // paper form), not as one whole-production Grade like Sieving — so it's gradeless too.
  // Pasteuriser is gradeless in the per-batch UI: the grade is baked into the
  // finished-product item code (30FP…) picked from the job card, not chosen as a
  // separate A/B/C dropdown.
  const gradeless = sectionId.startsWith('refining') || sectionId === 'granule' || isBlenderSection(sectionId) || isPasteuriser(sectionId)
  // Reached with ?date=&shift= from the capture landing page in the normal
  // flow — this fallback only matters for a stale bookmark/reload/PWA
  // shortcut that dropped the query params. It used to hardcode shift to
  // 'morning' and date to today regardless of the actual time, which is
  // wrong for exactly the reason productionShiftNow() exists: after midnight
  // the still-running night shift's rows are filed under yesterday's date.
  const nowFallback = productionShiftNow()
  const shift     = sp.get('shift') ?? nowFallback.shift
  const sessionParam = sp.get('session')   // edit a specific record opened from Production Orders
  // Which shift the bucket elevator carryover belongs to (afternoon = output,
  // otherwise input), and the opposite shift whose capture we merge for the run.
  const shiftBal: Shift   = shift === 'afternoon' ? 'afternoon' : 'morning'
  // Which kind of line this is. From the route, so it is authoritative — the
  // five data shapes are never told apart by guessing at their fields.
  const kind = sectionKindFor(sectionId)
  const otherShiftBal: Shift = shiftBal === 'morning' ? 'afternoon' : 'morning'
  const dateParam = sp.get('date')  ?? nowFallback.date
  const meta      = sectionMeta(sectionId)
  const canApprove = isSupervisor || isIT || role === 'admin'
  // Same permission the reopen endpoints check (app/api/production/orders/[id]).
  // Whoever may reopen a signed-off record is also trusted to edit it after
  // 16h00 without PINning in as the incoming operator — see the changeover gate.
  const canReopen = hasPerm('can_edit_session')

  // Where "back" goes. Capture is reached from several places — the capture
  // landing page, Production Orders (with filters applied), the Supervisor Hub's
  // Sign-off queue and Shift Report — and it used to always return to the capture
  // landing page, dumping a supervisor reviewing a filtered order list back to
  // the operator's start screen. Callers pass their own URL as `return`, and only
  // an app-internal path is honoured so the parameter can't be used to bounce
  // someone off-site.
  const returnParam = sp.get('return')
  const backHref = returnParam && returnParam.startsWith('/') && !returnParam.startsWith('//')
    ? returnParam
    : '/production/capture'
  const goBack = () => router.push(backHref)

  const [loading, setLoading]     = useState(true)
  const [assignment, setAssignment] = useState<ShiftAssignment | null>(null)
  const [opNames, setOpNames]     = useState<string[]>([])
  const [rosterOps, setRosterOps] = useState<{ id: string; name: string; pin: string }[]>([])
  const [verifiedOp, setVerifiedOp] = useState<Operator | null>(null)

  // ── Cleaner sign-in — a dedicated cleaner can sign into the Cleaning tab's
  // cleaner-only tasks without touching the operator's own identity/session.
  // While cleanerActor is set, the whole screen is restricted to Cleaning
  // (nothing else is reachable), and it clears itself once they sign off,
  // handing the tablet straight back to the operator's still-running capture.
  const [cleanerActor, setCleanerActor] = useState<{ id: string; name: string } | null>(null)
  const [cleanerGateOpen, setCleanerGateOpen] = useState(false)
  const [cleanerCandidates, setCleanerCandidates] = useState<{ id: string; name: string; pin: string }[]>([])
  const [cleanerPin, setCleanerPin] = useState('')
  const [cleanerError, setCleanerError] = useState<string | null>(null)

  useEffect(() => {
    cleanersOnDuty(dateParam, shift).then(setCleanerCandidates).catch(() => setCleanerCandidates([]))
  }, [dateParam, shift])

  function verifyCleanerPin() {
    setCleanerError(null)
    const c = cleanerCandidates.find(c => c.pin && c.pin === cleanerPin)
    if (!c) { setCleanerError('PIN not recognised — check the roster'); return }
    setCleanerActor({ id: c.id, name: c.name })
    setCleanerGateOpen(false)
    setCleanerPin('')
    setTab('cleaning')
  }

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus]       = useState<'new' | 'draft' | 'submitted' | 'approved'>('new')
  const [productions, setProductions] = useState<Production[]>([])
  // Half-bag top-ups made from THIS shift's own loose production. They are a
  // side-channel write (see HalfBagTopUpModal) that never reaches draft_data, so
  // without this the material they came from is counted as input with nothing on
  // the output side to balance it. Session-scoped, so added once — not per
  // production, since a session can hold several runs.
  const [sessionTopUpKg, setSessionTopUpKg] = useState(0)
  // Bucket-elevator carry-over left by a previous day and consumed by this
  // shift, read from the ledger and matched on VARIANT FAMILY — conventional
  // and organic are separate physical pools and never mix. Undefined until
  // loaded, which makes the balance fall back to the figure typed on screen.
  const [carryOverInKg, setCarryOverInKg] = useState<number | undefined>(undefined)
  const [activeIdx, setActiveIdx]     = useState(0)
  const [otherShiftProductions, setOtherShiftProductions] = useState<Production[]>([])
  // Other prod_sessions rows for this EXACT section+date+shift — e.g. an earlier
  // batch that got submitted (with errors, or just finished) before "Start new
  // batch record" opened a fresh session row. Only the newest such row is ever
  // the active/editable `productions`; without also loading its siblings here,
  // Overview and the on-screen mass balance silently dropped everything the
  // earlier record captured — invisible unless the operator happened to link
  // both to the same production run (an optional, easy-to-skip banner).
  const [siblingProductions, setSiblingProductions] = useState<Production[]>([])
  // The same sibling rows WITHOUT the variant/grade match filter — every other
  // batch record this shift opened on this line, whatever it was running. Only
  // the "Bags this shift" reference list uses these: it answers "what has this
  // shift put in and taken out", which a record on a different grade is still
  // part of, while a mass balance is only ever allowed to combine records
  // running the same thing (hence the filtered set above).
  const [shiftOtherProductions, setShiftOtherProductions] = useState<Production[]>([])
  const [blenderRatios, setBlenderRatios] = useState<BlenderRatioGroup[]>([])
  const bomGroupsCacheRef = useRef<Map<string, BlendIngredientGroup[]>>(new Map())
  const [runId, setRunId]         = useState<string | null>(null)   // this session's production run
  const [continueRun, setContinueRun] = useState<{ id: string; production_order: string | null; variant: string | null; grade: string | null } | null>(null)
  const [endOfRun, setEndOfRun]   = useState(false)       // supervisor: close the run on approval
  // 16h00 shift-changeover: block a still-open morning session until the incoming
  // afternoon operator confirms by PIN — audit trail of who captured after 16h00.
  const [afternoonOps, setAfternoonOps]     = useState<{ id: string; name: string; pin: string }[]>([])
  const [takenOver, setTakenOver]           = useState(false)
  const [changeoverNeeded, setChangeoverNeeded] = useState(false)
  // A draft that still carries submitted_at was signed off and then REOPENED
  // (the reopen endpoints only flip status back to 'draft'). That is somebody
  // fixing a finished record, not a live shift being handed over, so it must
  // not be treated the same as a morning session still open on the floor.
  const [reopened, setReopened]             = useState(false)
  const [comments, setComments]   = useState('')          // operator handover note → prod_sessions.comments
  const [prevNote, setPrevNote]   = useState<{ note: string; shift: string; date: string } | null>(null)
  // Whether the last production_runs full-day rollup write failed — surfaced so
  // a supervisor never trusts a full-day total that may be stale with zero
  // visible sign anything went wrong (see persist()'s run-rollup try/catch).
  const [runRollupStale, setRunRollupStale] = useState(false)
  // Set when a structured input/output row write failed. Those writes are
  // separate statements from draft_data and the mass balance, so they can fail
  // on their own and leave a production order reading "No inputs recorded"
  // against a perfectly correct total — which is what happened, three
  // different ways, until it was surfaced. See persist().
  const [rowWriteError, setRowWriteError] = useState<string | null>(null)
  const [tab, setTab]             = useState<Tab>(() => {
    const t = sp.get('tab')
    if (t === 'checks' && !hasChecks) return 'production'   // stale ?tab=checks on a section with no checks
    return (['production', 'checks', 'cleaning', 'overview', 'signoff', 'messages'] as const).includes(t as Tab) ? (t as Tab) : 'production'
  })
  const [variantMismatch, setVariantMismatch] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checksSigned, setChecksSigned] = useState(false)   // start-up/checks done for this shift
  const [changeoverAsk, setChangeoverAsk] = useState(false) // early-submit "is there a changeover?" prompt
  const [gradeChangeover, setGradeChangeover] = useState(false) // Sieving: mid-shift grade/variant changeover confirm
  const [topUpOpen, setTopUpOpen] = useState(false) // Half-bag top-up: add weight to an existing bag from another existing bag
  const [error, setError]         = useState<string | null>(null)

  // Serial counter, seeded from existing tags for this section+date
  const seqRef = useRef(0)
  const productionsRef = useRef<Production[]>(productions); productionsRef.current = productions
  const sessionRef = useRef<string | null>(null); sessionRef.current = sessionId
  const runIdRef   = useRef<string | null>(null); runIdRef.current = runId
  const continueRunRef = useRef<typeof continueRun>(null); continueRunRef.current = continueRun
  const creatingSessionRef = useRef<Promise<string> | null>(null)  // in-flight guard: never double-insert a session
  const lastActivityRef = useRef(0)  // throttle the timesheet heartbeat (ms epoch)
  const persistRef = useRef<((p: Production[], sid: string) => Promise<void>) | null>(null)
  const ensureRef  = useRef<(() => Promise<string>) | null>(null)
  // Serializes every persist() call (debounce, hide-flush, backstop can all fire
  // within moments of each other). Without this, two overlapping calls each run
  // their own delete-then-insert against prod_debagging/prod_bagging, and the
  // second one's insert can land on a row the first one's insert only just wrote
  // — a duplicate-key failure on prod_bagging_session_serial_uniq observed live,
  // plus repeated "Failed to fetch" from the resulting pile-up of concurrent
  // writes. Chaining onto this ref means a queued call always waits for the
  // previous one to finish, then runs with productionsRef.current read fresh at
  // that later moment — never a stale snapshot from when it was queued.
  const persistChainRef = useRef<Promise<void>>(Promise.resolve())

  const active = productions[activeIdx]
  const updateActiveData = (d: SievingData | RefiningData | GranuleData | BlenderData | PasteuriserData) =>
    setProductions(ps => ps.map((p, i) => i === activeIdx ? { ...p, data: d } : p))

  // Sieving: once any bulk bag has been locked ("Done — lock this bag") under
  // this batch's variant/grade, that choice is what's on record for it — the
  // Variant/Grade selects must stop being live-editable, or a change here
  // after the fact silently relabels an already-locked bag at save time
  // (buildDebag reads prod.variant fresh, not a per-row snapshot). Changing
  // variant/grade mid-shift is still possible, just only through Changeover,
  // which opens a new batch record instead of mutating this one.
  const sievingHasSecuredDebag = sectionId === 'sieving'
    && Array.isArray((active?.data as any)?.debag)
    && ((active.data as any).debag as Array<{ secured?: boolean }>).some(r => r.secured)

  // ── Load assignment + operators + existing session ───────────────────────
  useEffect(() => {
    async function load() {
      const db = getDb()
      const { data: assign } = await db.schema('production').from('shift_assignments')
        .select('*').eq('date', dateParam).eq('shift', shift).eq('section_id', sectionId).maybeSingle()

      if (assign) {
        setAssignment(assign as ShiftAssignment)
        const ids = (assign as any).operator_ids ?? []
        if (ids.length > 0) {
          const { data: ops } = await db.schema('production').from('operators')
            .select('id,name,display_name,pin').in('id', ids)
          setOpNames((ops as Operator[] ?? []).map(o => o.display_name || o.name))
          setRosterOps((ops as Operator[] ?? []).map(o => ({ id: o.id, name: o.display_name || o.name, pin: o.pin ?? '' })))
        }
      }

      // Resolve the signed-in floor operator (for sign-off attribution) — no PIN re-entry.
      if (user?.id) {
        const { data: me } = await db.schema('production').from('operators')
          .select('*').eq('user_id', user.id).maybeSingle()
        if (me) setVerifiedOp(me as Operator)
      }

      // Keep run_id OUT of this core select: if the run migration hasn't been
      // applied to a database yet, selecting a missing column 400s the whole load
      // and takes capture down. run_id is fetched best-effort below instead.
      // A specific record can be opened for editing from Production Orders via
      // ?session=<id> (there can be several sessions per section/shift once a batch
      // is signed off and a new one starts); otherwise load this shift's latest.
      // Every session row for this exact section+date+shift — not just the
      // newest. A shift can have more than one (a batch submitted, then "Start
      // new batch record" opens another): the newest/named-by-?session one is
      // the active, editable record; every other one is a sibling whose data
      // still needs to count in Overview/mass balance even though it isn't
      // being edited right now — but ONLY if it's genuinely the same blend/
      // variant/grade. Two Blender sessions running different blends (or two
      // Sieving sessions on different grades) are different production runs
      // that happen to share a shift; their balances must never be summed
      // together just because of that coincidence.
      const { data: shiftSess } = await db.schema('production').from('prod_sessions')
        .select('id,status,draft_data,comments,created_at,submitted_at')
        .eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift)
        .order('created_at', { ascending: false })
      const shiftRows = (shiftSess as any[]) ?? []
      const sess = sessionParam ? (shiftRows.find(r => r.id === sessionParam) ?? null) : (shiftRows[0] ?? null)
      const siblingRows = shiftRows.filter(r => r.id !== sess?.id)
      const activeMatchKeys = new Set(
        (((sess as any)?.draft_data?.productions ?? []) as Production[]).map(p => productionMatchKey(p, sectionId))
      )
      const siblingProds = siblingRows.flatMap(r => (r.draft_data?.productions ?? []) as Production[])
      setSiblingProductions(siblingProds.filter(p => activeMatchKeys.has(productionMatchKey(p, sectionId))))
      setShiftOtherProductions(siblingProds)
      if ((sess as any)?.comments) setComments((sess as any).comments)

      // Surface the most recent handover note left on this line (previous shift).
      const { data: prev } = await db.schema('production').from('prod_sessions')
        .select('comments,shift,date').eq('section_id', sectionId).not('comments', 'is', null)
        .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(5)
      const prevRow = ((prev as any[]) ?? []).find(r => !(r.date === dateParam && r.shift === shift) && (r.comments ?? '').trim())
      // Only surface a genuinely recent handover (last 7 days). Anything older is
      // stale (e.g. seed/demo notes) and just adds noise — don't show it.
      if (prevRow && Math.abs(differenceInCalendarDays(parseISO(dateParam), parseISO(prevRow.date))) <= 7) {
        setPrevNote({ note: prevRow.comments, shift: prevRow.shift, date: prevRow.date })
      }
      const aVariant = (assign as any)?.variant ?? ''
      const aLot     = (assign as any)?.lot_number ?? ''
      const d = (sess as any)?.draft_data
      const dbHasData = d?.productions?.length > 0 &&
        (d.productions as any[]).some((p: any) =>
          p?.data?.debag?.length > 0 || p?.data?.outputs?.length > 0 ||
          p?.data?.inputs?.length > 0 || p?.data?.outputA != null || p?.data?.outputB != null
        )
      if (d?.productions?.length) {
        setProductions(d.productions as Production[])
      } else if (d?.outputs) {
        // legacy single-production draft → wrap as one production
        setProductions([{ id: crypto.randomUUID(), variant: aVariant, grade: 'A', lot: aLot, data: d as SievingData }])
      } else {
        // DB draft is empty — check localStorage recovery before defaulting to blank
        let recovered = false
        try {
          const lsRaw = localStorage.getItem(`capture_draft_${sectionId}_${dateParam}_${shift}`)
          if (lsRaw) {
            const ls = JSON.parse(lsRaw)
            if (ls?.productions?.length) { setProductions(ls.productions); recovered = true }
          }
        } catch {}
        if (!recovered) setProductions([emptyProduction(sectionId, null, aLot)])
      }
      // If DB has no capture data but localStorage does, prefer localStorage —
      // this covers the case where the tablet lost the async Supabase write.
      if (!dbHasData && d?.productions?.length) {
        try {
          const lsRaw = localStorage.getItem(`capture_draft_${sectionId}_${dateParam}_${shift}`)
          if (lsRaw) {
            const ls = JSON.parse(lsRaw)
            if (ls?.productions?.length && ls.productions.some((p: any) => p?.data?.debag?.length > 0 || p?.data?.outputs?.length > 0 || p?.data?.inputs?.length > 0 || p?.data?.outputA != null || p?.data?.outputB != null)) {
              setProductions(ls.productions)
            }
          }
        } catch {}
      }
      let resolvedSid: string | null = null
      if (sess) {
        resolvedSid = (sess as any).id
        setSessionId(resolvedSid)
        sessionRef.current = resolvedSid   // so autosave targets this row, never creates a duplicate
        setStatus((sess as any).status)
        setReopened((sess as any).status === 'draft' && !!(sess as any).submitted_at)
        // Best-effort run link — isolated so a missing run_id column can't break load.
        try {
          const { data: rr } = await db.schema('production').from('prod_sessions')
            .select('run_id').eq('id', resolvedSid).maybeSingle()
          if ((rr as any)?.run_id) setRunId((rr as any).run_id)
        } catch { /* run_id optional */ }
      }
      // No eager creation on open. The session is created lazily on first real
      // capture via ensureSession(). Creating a draft just by opening a section
      // previously raced with the first autosave (open-insert not yet committed
      // when ensureSession's select ran), producing duplicate empty "No data"
      // sessions. localStorage still backs up any typing before the row exists.

      // Log page-open as shift start — written only if no prior stamps exist so
      // the first timestamp always reflects actual login time, not data-entry time.
      if (resolvedSid) {
        try {
          const { data: existingStamps } = await db.schema('production').from('capture_activity')
            .select('id').eq('session_id', resolvedSid).limit(1)
          if (!existingStamps?.length) {
            await db.schema('production').from('capture_activity').insert({
              session_id: resolvedSid, section_id: sectionId,
              operator_id: user?.id ?? null,
            } as any)
          }
        } catch { /* shift-start stamp is best-effort */ }
      }

      // Seed serial counter from today's bags only — each date restarts at 001.
      const dp = dateParam.split('-')
      const ddmmyy = dp.length === 3 ? `${dp[2]}${dp[1]}${dp[0].slice(2)}` : '000000'
      const prefix = `${meta.code}-${ddmmyy}-`
      const { data: tags } = await db.schema('production').from('bag_tags')
        .select('serial_number').like('serial_number', `${prefix}%`)
      let maxSeq = 0
      ;(tags ?? []).forEach((t: any) => {
        const m = String(t.serial_number).match(/-(\d{3,})$/)
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10))
      })
      seqRef.current = maxSeq

      // Guide the routine: a fresh shift opens on Checks (start-up) before
      // Capture, so the operator does checks first instead of jumping straight in.
      try {
        const { record } = await loadCheckRecord(sectionId, dateParam, shift)
        const signed = !!record && record.status !== 'in_progress'
        setChecksSigned(signed)
        const sessStatus = (sess as any)?.status ?? 'new'
        const hasCapture = !!(
          ((d?.productions ?? []) as any[]).some(p => (p?.data?.debag?.length || 0) > 0 || (p?.data?.outputs?.length || 0) > 0)
          || (Array.isArray(d?.outputs) && d.outputs.length > 0)
        )
        const fresh = (sessStatus === 'new' || sessStatus === 'draft') && !hasCapture
        if (hasChecks && !sp.get('tab') && fresh && !signed) setTab('checks')
      } catch { /* routing is best-effort */ }

      // Load the other shift's session(s) so the overview can show combined
      // cross-shift totals — every row for that shift, not just the newest,
      // for the same reason siblingProductions loads every row for this one.
      try {
        const otherShift = shift === 'morning' ? 'afternoon' : 'morning'
        const { data: otherSess } = await db.schema('production').from('prod_sessions')
          .select('draft_data').eq('section_id', sectionId).eq('date', dateParam).eq('shift', otherShift)
          .order('created_at', { ascending: false })
        const otherProds = ((otherSess as any[]) ?? []).flatMap(r => (r.draft_data?.productions ?? []) as Production[])
        if (otherProds.length > 0) setOtherShiftProductions(otherProds)
      } catch { /* cross-shift load is best-effort */ }

      setLoading(false)
    }
    load()
  }, [sectionId, dateParam, shift])

  // ── Keep cross-session context live ───────────────────────────────────────
  // `productions` is this screen's OWN in-progress capture — never overwritten
  // by a background refresh, or an operator's mid-sentence typing would vanish
  // under them. Everything else here is read-only reference from OTHER
  // sessions (siblings on this shift, the other shift, or every session
  // sharing this run) that the operator only ever *views*, never edits on this
  // screen, plus this session's own `status` in case a supervisor
  // approves/reopens it elsewhere — all safe to refresh without touching a
  // single keystroke of local state. Was previously loaded once on open, so a
  // bag captured on another tablet/shift stayed invisible until reload.
  const refreshCrossSessionContextRef = useRef<() => Promise<void>>(async () => {})
  refreshCrossSessionContextRef.current = async () => {
    const sid = sessionRef.current
    try {
      const db = getDb()
      const { data: shiftSess } = await db.schema('production').from('prod_sessions')
        .select('id,status,draft_data,comments,created_at,submitted_at')
        .eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift)
        .order('created_at', { ascending: false })
      const shiftRows = (shiftSess as any[]) ?? []
      const sess = sid ? (shiftRows.find(r => r.id === sid) ?? null) : (shiftRows[0] ?? null)
      const siblingRows = shiftRows.filter(r => r.id !== sess?.id)
      const activeMatchKeys = new Set(
        (((sess as any)?.draft_data?.productions ?? []) as Production[]).map(p => productionMatchKey(p, sectionId))
      )
      const siblingProds = siblingRows.flatMap(r => (r.draft_data?.productions ?? []) as Production[])
      setSiblingProductions(siblingProds.filter(p => activeMatchKeys.has(productionMatchKey(p, sectionId))))
      setShiftOtherProductions(siblingProds)

      // Mirror whichever source last populated otherShiftProductions: once a run
      // is linked, that effect (below) widens it to every session sharing the
      // run — repeating the plain "other shift" query here would fight it and
      // flicker the combined total back down every 30s.
      if (runIdRef.current) {
        const { data } = await db.schema('production').from('prod_sessions')
          .select('id,draft_data').eq('run_id', runIdRef.current)
        setOtherShiftProductions((((data as any[]) ?? []).filter(r => r.id !== sid))
          .flatMap(r => (r.draft_data?.productions ?? []) as Production[]))
      } else {
        const otherShift = shift === 'morning' ? 'afternoon' : 'morning'
        const { data: otherSess } = await db.schema('production').from('prod_sessions')
          .select('draft_data').eq('section_id', sectionId).eq('date', dateParam).eq('shift', otherShift)
          .order('created_at', { ascending: false })
        setOtherShiftProductions(((otherSess as any[]) ?? []).flatMap(r => (r.draft_data?.productions ?? []) as Production[]))
      }

      // Own session's status only — a supervisor approving/reopening this exact
      // record from Production Orders or the Supervisor Hub while it's open here.
      if (sess && sid && sess.id === sid && sess.status && sess.status !== status) {
        setStatus(sess.status)
      }
    } catch { /* live refresh is best-effort — never blocks capture */ }
  }

  // Realtime push (instant) with a 30s poll backstop, matching the pattern
  // already used on Production Orders — resubscribes only on a section change
  // (a real navigation), since the handler always reads the latest
  // date/shift/session via the ref above rather than a stale closure.
  useEffect(() => {
    const db = getDb()
    const channel = db.channel(`capture-context-${sectionId}`)
      .on('postgres_changes', { event: '*', schema: 'production', table: 'prod_sessions', filter: `section_id=eq.${sectionId}` },
        () => { refreshCrossSessionContextRef.current() })
      .subscribe()
    const poll = setInterval(() => { refreshCrossSessionContextRef.current() }, 30_000)
    return () => { clearInterval(poll); db.removeChannel(channel) }
  }, [sectionId])

  // Keep the checks-done signal fresh as the operator moves between tabs — after
  // they sign checks (in the Checks tab) the Capture gate and stepper tick update.
  useEffect(() => {
    loadCheckRecord(sectionId, dateParam, shift)
      .then(({ record }) => setChecksSigned(!!record && record.status !== 'in_progress'))
      .catch(() => {})
  }, [tab, sectionId, dateParam, shift])

  // Half-bag top-ups made from THIS shift's own loose production. They are a
  // side-channel write that never reaches draft_data, so without pulling them in
  // the material they came from is counted as input with nothing on the output
  // side to balance it. Restricted to mode==='production': a mode==='existing'
  // bag-to-bag transfer moves weight out of a source bag already counted as
  // output when IT was bagged, so counting it again would double-count.
  useEffect(() => {
    let cancelled = false
    if (!sessionId) { setSessionTopUpKg(0); return }
    fetchTopUpEventsForSession(sectionId, sessionId)
      .then(map => {
        const kg = Array.from(map.values()).flat()
          .filter(t => t.mode === 'production').reduce((s, t) => s + t.kg, 0)
        if (!cancelled) setSessionTopUpKg(kg)
      })
      .catch(() => { /* best-effort — balance falls back to captured output only */ })
    return () => { cancelled = true }
  }, [sectionId, sessionId, tab])

  // Bucket-elevator carry-over is Sieving-only, and only the shift that CONSUMES
  // it counts it as input — the afternoon shift LEAVES a new one for tomorrow
  // instead. Matched on variant FAMILY: conventional and organic are separate
  // physical pools that never mix (see production.bucket_elevator_log).
  useEffect(() => {
    let cancelled = false
    if (kind !== 'sieving' || shiftBal === 'afternoon') { setCarryOverInKg(undefined); return }
    const variant = active?.variant ?? productions[0]?.variant ?? null
    if (!variant) { setCarryOverInKg(undefined); return }
    outstandingBucketElevator(sectionId, variantFamily(variant))
      .then(kg => { if (!cancelled) setCarryOverInKg(kg) })
      .catch(() => { /* leave undefined — falls back to the figure typed on screen */ })
    return () => { cancelled = true }
  }, [kind, sectionId, shiftBal, active?.variant, productions.length])


  // Reliable save — ensures a session exists (in case the open-time create
  // failed) then persists. Used by the debounce, the hide-flush, and the backstop.
  async function flushSave() {
    // A submitted/approved session is read-only — nothing to save, and creating a
    // row for it (via ensureSession) is exactly how empty duplicates appeared when
    // a second person opened an already-signed-off shift.
    if (status === 'submitted' || status === 'approved') return
    let sid = sessionRef.current
    if (!sid) {
      // Never create a session with no captured data — this is the core guard that
      // stops empty "No data" sessions from opening a section or an abandoned "start
      // new batch record". A row is created only once real weights are entered.
      if (!hasCaptureData(productionsRef.current)) return
      if (ensureRef.current) { try { sid = await ensureRef.current() } catch { return } }
    }
    if (sid && persistRef.current) {
      const sidFinal = sid
      const run = persistChainRef.current
        .catch(() => {})
        .then(() => persistRef.current!(productionsRef.current, sidFinal))
      persistChainRef.current = run.catch(() => {})
      try { await run } catch {}
    }
  }
  const flushRef = useRef(flushSave); flushRef.current = flushSave

  // Timesheet heartbeat — append an activity timestamp on real edits, throttled to
  // once/60s per session, so timesheets can be auto-derived from capture activity.
  // Fire-and-forget (matches the save resilience); never blocks the operator.
  async function logActivity() {
    const sid = sessionRef.current
    if (!sid) return
    const now = Date.now()
    if (now - lastActivityRef.current < 60_000) return
    lastActivityRef.current = now
    try {
      await getDb().schema('production').from('capture_activity').insert({
        session_id: sid, section_id: sectionId,
        operator_id: verifiedOp?.user_id ?? user?.id ?? null,
      } as any)
    } catch { /* heartbeat is best-effort */ }
  }
  const logActivityRef = useRef(logActivity); logActivityRef.current = logActivity

  // ── Heartbeat on ANY real interaction, not just edits to `productions` ────
  // The debounced effect below only fires when the bag/batch data itself
  // changes, so a shift spent mostly in Checks, Cleaning, Overview or
  // Sign-off — or just doing physical floor work between edits — left gaps
  // in `capture_activity` with nothing to distinguish "operator present but
  // not touching bag data" from "operator on a break", so deriveTimesheet()
  // misread ordinary working gaps as tea/lunch. Any tap/keypress anywhere in
  // the app is a presence signal; logActivity's own 60s throttle keeps this
  // cheap.
  useEffect(() => {
    if (loading || status === 'submitted' || status === 'approved') return
    const onInteract = () => logActivityRef.current()
    document.addEventListener('pointerdown', onInteract)
    document.addEventListener('keydown', onInteract)
    return () => {
      document.removeEventListener('pointerdown', onInteract)
      document.removeEventListener('keydown', onInteract)
    }
  }, [loading, status])

  // ── Synchronous localStorage write on every change — safety net for tablet
  //    browsers that kill async DB writes on screen-lock / tab exit. Recovered
  //    automatically on next load if DB draft is empty.
  useEffect(() => {
    if (loading || status === 'approved') return
    try {
      localStorage.setItem(
        `capture_draft_${sectionId}_${dateParam}_${shift}`,
        JSON.stringify({ productions, savedAt: new Date().toISOString() }),
      )
    } catch { /* storage full — best-effort */ }
  }, [productions, loading, status])

  // ── Blend component ratio for Overview — target vs actual per ingredient,
  // summed across every Blender production sharing a blend code (both shifts,
  // same as the rest of Overview's totals). BOM lookups are cached per bomId
  // so retyping a weight doesn't refetch the recipe on every keystroke.
  useEffect(() => {
    if (!isBlenderSection(sectionId)) { setBlenderRatios([]); return }
    const allProds = [...productions, ...siblingProductions, ...otherShiftProductions]
    const byBom = new Map<string, Production[]>()
    allProds.forEach(p => {
      const bomId = (p.data as BlenderData)?.bomId
      if (!bomId) return
      const arr = byBom.get(bomId) ?? []
      arr.push(p)
      byBom.set(bomId, arr)
    })
    if (byBom.size === 0) { setBlenderRatios([]); return }
    let cancelled = false
    Promise.all(Array.from(byBom.entries()).map(async ([bomId, prods]) => {
      let groups = bomGroupsCacheRef.current.get(bomId)
      if (!groups) {
        groups = groupComponentsByItem(await getBlendComponents(bomId))
        bomGroupsCacheRef.current.set(bomId, groups)
      }
      const byItem: Record<string, number> = {}
      let totalIn = 0
      prods.forEach(p => {
        ;((p.data as BlenderData).inputs ?? []).forEach(r => {
          const kg = parseFloat(String(r.weight).replace(',', '.')) || 0
          byItem[r.itemKey] = (byItem[r.itemKey] ?? 0) + kg
          totalIn += kg
        })
      })
      return {
        bomId,
        rows: groups!.map(g => ({
          label: g.label, kg: byItem[g.key] ?? 0,
          actualPct: totalIn > 0 ? ((byItem[g.key] ?? 0) / totalIn) * 100 : 0,
          targetPct: g.targetPct * 100,
        })),
      }
    })).then(ratios => { if (!cancelled) setBlenderRatios(ratios) })
    return () => { cancelled = true }
  }, [sectionId, productions, siblingProductions, otherShiftProductions])

  // ── Save ~2.5s after each change (timers fire while the tab is active) ────
  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => { flushRef.current(); logActivityRef.current() }, 2500)
    return () => clearTimeout(t)
  }, [productions, loading])

  // ── Flush on tab hide / app background / page close (tablet screen-lock) ──
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushRef.current() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide) }
  }, [])

  // ── Backstop interval (active tabs) ───────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => { flushRef.current() }, 20_000)
    return () => clearInterval(t)
  }, [])

  function genSerial(): string {
    seqRef.current += 1
    return makeSerial(meta.code, dateParam, seqRef.current)
  }

  async function ensureSession(): Promise<string> {
    // Fast path off the ref (updated synchronously below) so back-to-back callers
    // in the same tick don't each start a create.
    if (sessionRef.current) return sessionRef.current
    // Coalesce concurrent callers onto one in-flight create — the root cause of
    // duplicate sessions was two callers both passing the select-first check
    // before either insert committed.
    if (creatingSessionRef.current) return creatingSessionRef.current
    const p = (async (): Promise<string> => {
      // Recover an existing session first (select-then-insert; the in-flight guard
      // above prevents the same-client race, this handles a prior committed row).
      // Only reuse a still-editable DRAFT — if the most recent session for this
      // shift is already submitted/approved, this capture is a NEW batch record
      // and must get its own row rather than writing back into the signed-off one.
      const { data: existing } = await getDb().schema('production').from('prod_sessions')
        .select('id,status').eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (existing && (existing as any).status === 'draft') {
        const id = (existing as any).id
        sessionRef.current = id; setSessionId(id)
        return id
      }
      const { data: row, error: e } = await getDb().schema('production').from('prod_sessions').insert({
        section_id: sectionId, date: dateParam, shift, status: 'draft',
        operator_names:    opNames.length ? opNames : null,
        supervisor_name:   verifiedOp?.role === 'production_supervisor' ? (verifiedOp.display_name || verifiedOp.name) : null,
        lot_number:        productions[0]?.lot || assignment?.lot_number || null,
        variant:           productions[0]?.variant || assignment?.variant || null,
        production_orders: assignment?.production_orders ?? null,
        created_by:        user?.id ?? null,
      } as any).select('id').single()
      if (e) throw new Error(e.message)
      const id = (row as any).id
      sessionRef.current = id; setSessionId(id)
      return id
    })()
    creatingSessionRef.current = p
    try { return await p } finally { creatingSessionRef.current = null }
  }
  ensureRef.current = ensureSession

  // ── Production runs (cross-shift continuity) ─────────────────────────────
  // A run = one production order (PO + variant + grade) that can span several
  // shifts of the same production day. The production day is the session's own
  // date: the afternoon shift (16h00–01h00) is opened once on that date, so its
  // post-midnight tail rolls up under the same day.
  // Grade must be chosen per batch on grade-driven sections (Sieving); Refining
  // and Granule are variant-only, so no grade pick is required.
  const needsGrade = !gradeless
  const isGranule = sectionId === 'granule'
  const isBlenderRun = isBlenderSection(sectionId)
  const isPasteuriserRun = isPasteuriser(sectionId)
  // The run discriminator stored in the run's `grade` column: the chosen grade on
  // grade-driven sections, the product item (SG / SF / Export) for Granule, or the
  // blend code for Blender/Small Blender (BlenderData.bomId — owned by the
  // production, not the shift assignment). A run therefore continues across
  // shifts/batches while variant + item/blend stay the same, and forks the moment
  // the operator switches product/blend — exactly as the paper works, and exactly
  // what lets an operator pick a *different* blend mid-shift and get a genuinely
  // separate, separately-tracked production run instead of silently merging into
  // whatever run happened to be open.
  // Pasteuriser: the run discriminator is the final-product batch number — a run
  // continues across shifts while the same batch is produced (matching the paper's
  // carry-over), and forks when the operator starts a different batch/blend.
  const runGrade = (p?: Production) =>
    isGranule ? ((p?.data as GranuleData)?.item || '')
    : isBlenderRun ? ((p?.data as BlenderData)?.bomId || '')
    : isPasteuriserRun ? ((p?.data as PasteuriserData)?.batchNo || (p?.data as PasteuriserData)?.blendCode || '')
    : (p?.grade || '')
  // The PO anchor: the assignment's planned production orders, joined so it
  // compares identically across shifts (supervisor sets the same POs each shift).
  const poKey = (assignment?.production_orders ?? []).join(',') || null

  async function findOpenRun(po: string | null, variant: string, grade: string) {
    const gradeKey = (needsGrade || isGranule || isBlenderRun || isPasteuriserRun) ? (grade || null) : null
    const { data } = await getDb().schema('production').from('production_runs')
      .select('*').eq('section_id', sectionId).eq('production_day', dateParam)
      .eq('status', 'open').order('opened_at', { ascending: false })
    return ((data as any[]) ?? []).find(r =>
      (r.variant ?? null) === (variant || null) &&
      (r.production_order ?? null) === (po ?? null) &&
      (r.grade ?? null) === gradeKey) ?? null
  }

  async function openRun(po: string | null, variant: string, grade: string): Promise<string | null> {
    const { data: row } = await getDb().schema('production').from('production_runs').insert({
      section_id: sectionId, production_day: dateParam,
      production_order: po, variant: (variant || null) as any,
      grade: (needsGrade || isGranule || isBlenderRun || isPasteuriserRun) ? (grade || null) : null,
      lot_number: assignment?.lot_number ?? null,
      status: 'open', created_by: user?.id ?? null,
    } as any).select('id').maybeSingle()
    return (row as any)?.id ?? null
  }

  async function linkSessionToRun(rid: string) {
    const sid = sessionRef.current ?? (ensureRef.current ? await ensureRef.current() : null)
    if (!sid) return
    await getDb().schema('production').from('prod_sessions').update({ run_id: rid } as any).eq('id', sid)
    setRunId(rid)
  }

  async function acceptContinueRun() {
    const cr = continueRun; setContinueRun(null)
    if (!cr) return
    await linkSessionToRun(cr.id)
    // Blender's run number is embedded in the bag serial (…/1-01…/1-13), a
    // separate mechanism from `production_runs` — linking the session alone
    // doesn't touch it. Without seeding it here, the new shift's BlenderData
    // still starts with outputRunNo null, and genBlendSerial() would derive
    // its OWN next run (existing max + 1) the first time a bag is added —
    // silently forking to …/2-01 even though the operator just said this is
    // the same continuing blend, not a new one.
    if (isBlenderRun && cr.grade) {
      // The run being continued was necessarily opened on this same
      // production_day (findOpenRun matches on it), so dateParam is the
      // correct scope for "today's runs" here too.
      const existingRunNo = await resolveExistingBlendRunNo(cr.grade, dateParam)
      if (existingRunNo) {
        const idx = activeIdx
        const p = productionsRef.current[idx]
        const bd = p?.data as BlenderData | undefined
        if (bd && !bd.outputRunNo) updateActiveData({ ...bd, outputRunNo: existingRunNo })
      }
    }
  }

  async function declineContinueRun() {
    // Not a continuation: close the previous shift's run so this shift can open
    // a fresh one on the same product (one open run per key is enforced in DB).
    const cr = continueRun; setContinueRun(null)
    const p = productionsRef.current[activeIdx]
    if (cr) {
      await getDb().schema('production').from('production_runs')
        .update({ status: 'closed', closed_at: new Date().toISOString() } as any).eq('id', cr.id)
    }
    if (p?.variant && (!needsGrade || p.grade) && (!isBlenderRun || runGrade(p))) {
      const rid = await openRun(poKey, p.variant, runGrade(p))
      if (rid) await linkSessionToRun(rid)
    }
  }

  // Detection only: once variant (+ grade for non-refining, + blend code for
  // Blender) are chosen, look for an open run from an earlier shift/batch matching
  // PO + variant + grade and, if found, raise the continue prompt. Re-runs on
  // selection changes so a grade/blend correction updates/clears the prompt. The
  // run itself is opened lazily on first capture (persist), using the settled
  // grade — so a last-second change never mislabels it.
  useEffect(() => {
    if (loading || status === 'approved' || runId || runIdRef.current) return
    const p = productions[activeIdx]
    const variant = p?.variant ?? '', grade = runGrade(p)
    if (!variant || (needsGrade && !grade) || (isBlenderRun && !grade)) { if (continueRun) setContinueRun(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const found = await findOpenRun(poKey, variant, grade)
        if (cancelled) return
        setContinueRun(found
          ? { id: found.id, production_order: found.production_order, variant: found.variant, grade: found.grade }
          : null)
      } catch { /* detection is best-effort */ }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productions, activeIdx, runId, status, loading])

  // Widen the Overview to the whole run once linked — pull every shift session
  // sharing this run so combined totals span morning + afternoon (+ night).
  useEffect(() => {
    if (!runId) return
    getDb().schema('production').from('prod_sessions').select('id,draft_data').eq('run_id', runId)
      .then(({ data }: any) => {
        const merged = ((data as any[]) ?? [])
          .filter(s => s.id !== sessionRef.current)
          .flatMap(s => (s.draft_data?.productions ?? []) as Production[])
        setOtherShiftProductions(merged)
      }, () => {})
  }, [runId])

  // ── 16h00 shift changeover (audit) ───────────────────────────────────────
  // Only a morning session on today's date can hit the hand-over. Two shifts:
  // Morning 07h00–16h00, Afternoon/Night 16h00–01h00.
  function pastChangeover(): boolean {
    const now = new Date()
    return shift === 'morning' && dateParam === format(now, 'yyyy-MM-dd') && now.getHours() >= 16
  }

  // Load the afternoon roster for this section — their PINs unlock the hand-over.
  useEffect(() => {
    if (shift !== 'morning') return
    const db = getDb()
    db.schema('production').from('shift_assignments')
      .select('operator_ids,shift').eq('date', dateParam).in('shift', ['afternoon', 'night']).eq('section_id', sectionId)
      .then(async ({ data }: any) => {
        const ids = [...new Set((data ?? []).flatMap((r: any) => r.operator_ids ?? []))] as string[]
        if (!ids.length) { setAfternoonOps([]); return }
        const { data: ops } = await db.schema('production').from('operators').select('id,name,display_name,pin').in('id', ids)
        setAfternoonOps((ops as Operator[] ?? []).map(o => ({ id: o.id, name: o.display_name || o.name, pin: o.pin ?? '' })))
      }, () => setAfternoonOps([]))
  }, [shift, dateParam, sectionId])

  // Already handed over on this session? Don't prompt again.
  useEffect(() => {
    if (!sessionId) return
    getDb().schema('production').from('shift_takeovers').select('id').eq('session_id', sessionId).limit(1)
      .then(({ data }: any) => { if (data?.length) setTakenOver(true) }, () => {})
  }, [sessionId])

  // Flip the block on at 16h00 while the session is still being captured. The
  // modal is a full-screen overlay that can land mid-gesture (typing a weight,
  // tapping "Add"), so flush any pending change to the DB the instant it fires
  // — a bag already in local state must not be left sitting on the 2.5s/20s
  // autosave timer while the operator is stuck behind the PIN prompt.
  useEffect(() => {
    if (takenOver) { setChangeoverNeeded(false); return }
    const check = () => {
      const done = status === 'submitted' || status === 'approved'
      // Reopened records are exempt for anyone who could have reopened them:
      // demanding an operator PIN from a manager fixing a weight after 16h00
      // recorded a hand-over that never happened. A floor operator without the
      // permission still PINs in, so the audit trail keeps its real cases.
      const reopenExempt = reopened && canReopen
      const needed = pastChangeover() && !done && !reopenExempt
      setChangeoverNeeded(was => {
        if (needed && !was) flushRef.current()
        return needed
      })
    }
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, dateParam, status, takenOver, reopened, canReopen])

  // Confirm the incoming operator by PIN and stamp the audit trail.
  async function recordTakeover(op: { id: string; name: string }, rostered: boolean) {
    const sid = await ensureSession()
    await getDb().schema('production').from('shift_takeovers').insert({
      session_id: sid, section_id: sectionId, date: dateParam,
      from_shift: shift, to_shift: 'afternoon',
      operator_id: op.id, operator_name: op.name, rostered,
    } as any)
    // Attribute subsequent capture + sign-off to whoever took over.
    try {
      const { data: full } = await getDb().schema('production').from('operators').select('*').eq('id', op.id).maybeSingle()
      if (full) setVerifiedOp(full as Operator)
    } catch { /* attribution is best-effort */ }
    setTakenOver(true)
    setChangeoverNeeded(false)
  }

  // Validate a PIN at the hand-over: afternoon-rostered operators first, then a
  // flagged fallback to any active operator so capture is never fully blocked.
  async function confirmChangeover(pin: string): Promise<boolean> {
    let match = afternoonOps.find(o => o.pin && o.pin === pin) ?? null
    let rostered = true
    if (!match) {
      const { data } = await getDb().schema('production').from('operators')
        .select('id,name,display_name,pin').eq('active', true)
      const found = ((data as Operator[]) ?? []).find(o => o.pin && String(o.pin) === pin)
      if (found) { match = { id: found.id, name: found.display_name || found.name, pin: String(found.pin) }; rostered = false }
    }
    if (!match) return false
    await recordTakeover({ id: match.id, name: match.name }, rostered)
    return true
  }

  // ── Build structured rows from SievingData or RefiningData ───────────────
  function buildDebag(prods: Production[], sid: string) {
    const rows: any[] = []
    let bagNo = 1
    prods.forEach(prod => {
      if (kind === 'refining') {
        const rd = prod.data as RefiningData
        ;(rd.inputs ?? []).forEach(r => {
          if (n(r.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++,
            // bag_serial_no is a FK to bag_tags — only set for scan/system bags
            // guaranteed to exist there. Manual serials go in notes to avoid FK failure.
            bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
            notes: r.inputMode === 'manual' ? r.serial || null : null,
            lot_number: r.lot || prod.lot || null,
            product_type: r.productType || null, variant: r.variant || prod.variant || null,
            kg_nett: n(r.weight),
            delivery_date: r.deliveryDate || null, is_spillage: false,
          })
        })
      } else if (kind === 'granule') {
        const gd = prod.data as GranuleData
        ;(gd.blends ?? []).forEach(bl => {
          (bl.rows ?? []).forEach(r => {
            if (n(r.weight) === 0) return
            rows.push({
              session_id: sid, bag_no: bagNo++,
              // bag_serial_no is a FK to bag_tags — only set for scan/system bags.
              // Manual serials go in notes to avoid an FK failure.
              bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
              notes: [`blend ${bl.blendNo}`, r.inputMode === 'manual' ? r.serial : null].filter(Boolean).join(' · ') || null,
              lot_number: r.lot || prod.lot || null,
              product_type: dustProductType(r.dustKey), variant: r.variant || prod.variant || null,
              kg_nett: n(r.weight), is_spillage: false,
            })
          })
        })
      } else if (kind === 'blender') {
        const bd = prod.data as BlenderData
        ;(bd.inputs ?? []).forEach(r => {
          if (n(r.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++,
            bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
            grade: r.destination || null,
            notes: r.inputMode === 'manual' ? r.serial : null,
            lot_number: r.lot || prod.lot || null,
            product_type: r.productType || null, variant: r.variant || prod.variant || null,
            kg_nett: n(r.weight), is_spillage: false,
          })
        })
      } else if (kind === 'pasteuriser') {
        const pd = prod.data as PasteuriserData
        ;(pd.debag ?? []).forEach(r => {
          if (n(r.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++,
            // bag_serial_no is a FK to bag_tags — only set for scan/system bags
            // guaranteed to be there; a manual serial goes in notes to avoid an FK failure.
            bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
            notes: [r.stream === 'postsieve' ? 'post-sieve' : null, r.inputMode === 'manual' ? r.serial : null].filter(Boolean).join(' · ') || null,
            lot_number: r.lot || pd.batchNo || prod.lot || null,
            product_type: r.productType || null, variant: r.variant || prod.variant || null,
            kg_nett: n(r.weight), is_spillage: false,
          })
        })
      } else if (kind === 'sieving') {
        const sd = prod.data as SievingData
        // spillage[0] is the bucket-elevator carry-over; spillage[1..] are
        // machine spillage — they're different inputs and must read as their
        // own type on the production order, not both as "Bucket Elevator".
        sd.spillage.forEach((r, idx) => {
          if (n(r.kg) === 0) return
          rows.push({ session_id: sid, bag_no: bagNo++, product_type: idx === 0 ? 'Bucket Elevator' : 'Machine Spillage', variant: prod.variant, kg_nett: n(r.kg), is_spillage: true })
        })
        sd.debag.forEach(r => {
          if (n(r.nett) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++,
            // bag_serial_no is a FK to bag_tags — farm bags aren't in bag_tags, so null it.
            // Preserve the operator's physical bag number in notes for traceability.
            bag_serial_no: null, notes: r.bag_no || null,
            lot_number: r.lot || prod.lot || null,
            // Was '500kg Farm Bag' — kept unchanged on historical rows (Acumatica
            // actually reads batch numbers + total weight, not this string, so the
            // rename is safe going forward without a backfill).
            product_type: 'Farm Bag', variant: prod.variant,
            kg_gross: n(r.gross) || null, kg_nett: n(r.nett),
            delivery_date: r.delivery_date || null, grade: r.grade || null,
            // Real capture instant, immune to persist()'s delete+reinsert restamping
            // created_at on every save — same pattern as output bags' bagging_time.
            bagging_time: r.logged_at || null,
            is_spillage: false,
          })
        })
      } else { assertNever(kind, 'section kind') }
    })
    return rows
  }
  function buildBag(prods: Production[], sid: string) {
    const rows: any[] = []
    let bagNo = 1
    prods.forEach(prod => {
      if (kind === 'refining') {
        const rd = prod.data as RefiningData
        const groups: Array<[string, typeof rd.outputB]> = [['A', rd.outputA], ['B', rd.outputB], ['C', rd.outputC], ['D', rd.outputD]]
        groups.forEach(([grp, g]) => {
          ;(g?.bags ?? []).forEach(b => {
            if (n(b.weight) === 0) return
            rows.push({
              session_id: sid, bag_no: bagNo++, output_group: grp,
              bag_serial_no: b.serial, lot_number: prod.lot || null,
              product_type: b.productType, acumatica_id: b.code || null,
              variant: prod.variant,
              kg: n(b.weight),
              // The exact moment this bag was added on the Refining (sieving
              // tower) screen — set client-side as RefiningOutputBag.logged_at
              // when the operator adds it. Carried through so downstream
              // consumers (Quality's Final QC picker) show the true bagging
              // time instead of when the whole session was last saved — every
              // other output section already does this via its own b.time.
              bagging_time: b.logged_at || null,
            })
          })
        })
      } else if (kind === 'granule') {
        const gd = prod.data as GranuleData
        ;(gd.outputs ?? []).forEach(b => {
          if (n(b.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: null,
            bag_serial_no: b.serial, lot_number: b.lot || prod.lot || null,
            product_type: b.item, acumatica_id: b.code || null, variant: prod.variant,
            kg: n(b.weight), bagging_time: b.logged_at || null,
          })
        })
        ;(gd.dustOutputs ?? []).forEach(r => {
          if (n(r.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: null,
            bag_serial_no: r.serial, lot_number: prod.lot || null,
            product_type: r.dustType, acumatica_id: r.code || null, variant: prod.variant,
            kg: n(r.weight),
          })
        })
      } else if (kind === 'blender') {
        const bd = prod.data as BlenderData
        const bomId = bd.bomId
        ;(bd.outputs ?? []).forEach(b => {
          if (n(b.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: null,
            bag_serial_no: b.serial, lot_number: prod.lot || null,
            product_type: bomId ? `Blend ${bomId}` : null, acumatica_id: bomId || null, variant: prod.variant,
            kg: n(b.weight), bagging_time: b.logged_at || null,
          })
        })
      } else if (kind === 'pasteuriser') {
        const pd = prod.data as PasteuriserData
        const perBag = n(pd.weightPerBag) || 0
        // Final-product pallet lines (A): one bagging row per line, kg = bags × kg/bag.
        ;(pd.outputs ?? []).forEach(l => {
          const kg = n(l.bagCount) * (n(l.bagWeight) || perBag)
          if (kg === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: null,
            bag_serial_no: l.serial, lot_number: l.lot || pd.batchNo || prod.lot || null,
            product_type: l.item || l.kind || null, acumatica_id: l.itemCode || null, variant: prod.variant,
            kg, bagging_time: l.logged_at || null,
          })
        })
        // By-products (B) — recorded as bagging rows so they count in the output total.
        ;(pd.byProducts ?? []).forEach(r => {
          if (n(r.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: null,
            bag_serial_no: r.serial || null, lot_number: pd.batchNo || prod.lot || null,
            product_type: r.type || null, variant: prod.variant, kg: n(r.weight),
          })
        })
      } else if (kind === 'sieving') {
        const sd = prod.data as SievingData
        sd.outputs.forEach(b => {
          if (n(b.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: 'B',
            bag_serial_no: b.serial, lot_number: b.batch || prod.lot || null, product_type: b.productType,
            acumatica_id: b.code || null, variant: prod.variant,
            kg: n(b.weight),
            bagging_time: b.logged_at || null,   // see bagging_time note above
          })
        })
      } else { assertNever(kind, 'section kind') }
    })
    // Stamp the work centre (Sieving Tower / Refining 1 / … / Pasteuriser) on
    // every output bag so prod_bagging carries the producing line directly,
    // without having to join back through prod_sessions.section_id.
    rows.forEach(r => { r.work_centre = meta.name })
    return rows
  }
  // Per-production totals — dispatches by section type. `sh` is the shift the
  // production belongs to; Sieving uses it to place the bucket elevator on the
  // input (morning) or output (afternoon) side of the balance.
  // One balance, from lib/core/mass-balance. The screen, the persisted
  // prod_mass_balance row and the production-order summaries all read it, so
  // they can no longer disagree — and they did: the screen ignored half-bag
  // top-ups entirely while the persisted row counted them, for Sieving only.
  function prodTotals(p: Production, sh: Shift = shiftBal): ProductionTotals {
    return productionTotals(kind, p.data as AnyBalanceData, { shift: sh, carryOverInKg })
  }
  // Session totals — summed across all productions on one shift, with the
  // session half-bag top-ups added once at the end (withTopUp knows which way
  // each section balance sign runs).
  function sessionTotals(prods: Production[], sh: Shift = shiftBal): ProductionTotals {
    return withTopUp(kind, sumProductionTotals(prods.map(p => prodTotals(p, sh))), sessionTopUpKg)
  }

  // Resolve canonical batch ids for a set of raw lot strings: upsert any new
  // batches into production.batches (keyed on the normalized batch_key) and
  // return a batch_key -> id map. Best-effort — a failure returns an empty map
  // so batch_id is simply left null rather than blocking the core save.
  async function resolveBatchIds(
    db: any,
    lots: Array<{ lot: string | null | undefined; variant?: string | null }>,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const byKey = new Map<string, { batch_key: string; display_lot: string; variant: string | null; first_section: string }>()
    for (const { lot, variant } of lots) {
      const key = normalizeBatch(lot)
      if (!key || byKey.has(key)) continue
      byKey.set(key, { batch_key: key, display_lot: String(lot), variant: variant ?? null, first_section: sectionId })
    }
    if (byKey.size === 0) return map
    const keys = [...byKey.keys()]
    try {
      await db.schema('production').from('batches')
        .upsert([...byKey.values()] as any, { onConflict: 'batch_key', ignoreDuplicates: true })
      const { data } = await db.schema('production').from('batches').select('id,batch_key').in('batch_key', keys)
      for (const row of ((data as any[]) ?? [])) map.set(row.batch_key, row.id)
    } catch { /* leave map partial/empty — batch_id stays null */ }
    return map
  }

  // Core persistence — writes draft_data + structured rows + mass balance.
  // Used by the explicit Save, the 30s autosave, and submit, so prod_debagging /
  // prod_bagging are always current and nothing is lost on the inactivity sign-out.
  async function persist(prods: Production[], sid: string) {
    const { totalIn } = sessionTotals(prods, shiftBal)
    const db = getDb()

    const debag = buildDebag(prods, sid)
    const bag = buildBag(prods, sid)

    // Central lot/batch capitalisation — the one write-layer chokepoint that
    // guarantees every stored lot number is upper-cased regardless of which
    // capture UI (or none) produced it, so "gs-0271" and "GS-0271" never read as
    // two different lots in traceability/consumed-before-output checks. Only
    // lot_number is touched (never bag_serial_no — that's a bag_tags FK whose
    // exact stored case must be preserved to match).
    for (const r of debag) r.lot_number = upperCode(r.lot_number)
    for (const r of bag)   r.lot_number = upperCode(r.lot_number)

    // A serial column holds a real bag serial or nothing — never ''. An output
    // bag that's been added but not tagged yet starts life as serial: '' on the
    // Refining and Granule-dust screens, and the 30s autosave happily stores
    // that blank as a *value*: the "clear the no-serial rows" delete below is an
    // IS NULL and never matches it again, while prod_bagging's
    // (session_id, bag_serial_no) uniqueness reads two blank bags as the same
    // bag. On the input side a blank fails the bag_serial_no FK outright.
    const blankSerialToNull = (r: any) => {
      if (!r.bag_serial_no || !String(r.bag_serial_no).trim()) r.bag_serial_no = null
    }
    debag.forEach(blankSerialToNull)
    bag.forEach(blankSerialToNull)

    // The same serial on two output rows is one physical bag captured twice.
    // Inserting both breaks the (session_id, bag_serial_no) uniqueness and takes
    // the whole row list down with it, so the first row keeps the serial and the
    // duplicate keeps only its weight — draft_data counts that weight in the
    // mass balance, so the row list has to carry it too.
    const seenSerials = new Set<string>()
    for (const r of bag as any[]) {
      if (!r.bag_serial_no) continue
      if (seenSerials.has(r.bag_serial_no)) {
        console.warn('duplicate output serial in one session, saved without the serial', r.bag_serial_no)
        r.bag_serial_no = null
        continue
      }
      seenSerials.add(r.bag_serial_no)
    }

    // Canonical batch identity — one batch_id shared across the session, its
    // input/output rows and the run, so quality/bags/orders all join on it.
    const sessionLot = prods[0]?.lot || assignment?.lot_number || null
    const sessionVariant = prods[0]?.variant || assignment?.variant || null
    const batchIds = await resolveBatchIds(db, [
      { lot: sessionLot, variant: sessionVariant },
      ...debag.map(r => ({ lot: r.lot_number, variant: r.variant })),
      ...bag.map(r => ({ lot: r.lot_number, variant: r.variant })),
    ])
    const bidFor = (lot: any) => batchIds.get(normalizeBatch(lot) ?? '') ?? null
    const sessionBatchId = bidFor(sessionLot)
    debag.forEach(r => { r.batch_id = bidFor(r.lot_number) })
    bag.forEach(r => { r.batch_id = bidFor(r.lot_number) })

    await db.schema('production').from('prod_sessions').update({
      draft_data: { productions: prods } as any, batch_id: sessionBatchId, updated_at: new Date().toISOString(),
    } as any).eq('id', sid)

    // ── Input rows: normalise, then write with the result checked ───────────
    // These rows travel as ONE multi-row insert, so a single unacceptable value
    // in any of them loses every input row for the session — and since the mass
    // balance below is computed from draft_data, not from these rows, the
    // production order then shows "No inputs recorded" under a correct total,
    // with nothing anywhere saying why. Two real causes, both fixed here at the
    // write layer rather than in each capture screen:
    //
    //   • delivery_date arriving as the floor writes it on a bag tag, DD-MM-YY.
    //     Postgres rejects that on a `date` column (22008 date/time field value
    //     out of range) — this silently emptied every Refining order's
    //     debagging panel.
    //   • bag_serial_no carrying a serial that isn't in bag_tags, which the FK
    //     prod_debagging_bag_serial_no_fkey rejects with 23503. Only manual
    //     entry was assumed to produce untagged serials, but Blender's scan
    //     rows routinely hold the date written on an untagged bag, so Blender
    //     orders lost their inputs the same way.
    for (const r of debag) r.delivery_date = dbDate(r.delivery_date)

    const claimedSerials = [...new Set(debag.map((r: any) => r.bag_serial_no).filter(Boolean))]
    if (claimedSerials.length) {
      const { data: knownTags } = await db.schema('production').from('bag_tags')
        .select('serial_number').in('serial_number', claimedSerials)
      const tagged = new Set(((knownTags as any[]) ?? []).map(t => t.serial_number))
      for (const r of debag as any[]) {
        if (r.bag_serial_no && !tagged.has(r.bag_serial_no)) {
          // Keep what the operator entered — for an untagged bag it's the only
          // identifier it has — just not in the FK column.
          r.notes = [r.notes, r.bag_serial_no].filter(Boolean).join(' · ')
          r.bag_serial_no = null
        }
      }
    }

    const rowErrors: string[] = []

    // Insert-then-delete for prod_debagging: write new rows first so a failed
    // insert never wipes existing data.  prod_debagging has no unique constraint
    // on (session_id, bag_no), so temporary duplicates are harmless — the old
    // rows are removed once the insert succeeds.
    const { data: prevDebagRows } = await db.schema('production').from('prod_debagging')
      .select('id').eq('session_id', sid)
    const prevDebagIds = ((prevDebagRows as any[]) ?? []).map((r: any) => r.id as string)

    if (debag.length) {
      let insDebag = await db.schema('production').from('prod_debagging').insert(debag as any)
      if (insDebag.error && /PGRST204|schema cache/i.test(`${insDebag.error.code} ${insDebag.error.message}`)) {
        // PostgREST schema cache is stale after the local_or_export→grade rename
        // and/or bagging_time addition. Strip those columns and retry so the
        // rest of the row still lands; the data lives in draft_data until the
        // cache catches up.
        const fallback = (debag as any[]).map(r => {
          const { grade, bagging_time, ...rest } = r
          return rest
        })
        insDebag = await db.schema('production').from('prod_debagging').insert(fallback as any)
      }
      if (insDebag.error) {
        rowErrors.push(`inputs: ${rowErrText(insDebag.error)}`)
      } else if (prevDebagIds.length) {
        await db.schema('production').from('prod_debagging').delete().in('id', prevDebagIds)
      }
    } else if (prevDebagIds.length) {
      await db.schema('production').from('prod_debagging').delete().in('id', prevDebagIds)
    }

    // Serialed bags are physical, already-tagged bags (bag_tags has the same
    // serial) — never blanket-delete those, or a save that races the bag being
    // dropped from this instant's draft_data permanently loses a real bag from
    // Quality's QC queue (this is exactly how 44% of Fine/Coarse Leaf bags went
    // missing from prod_bagging). So only the rows this payload is about to
    // rewrite are cleared: the no-serial ones (which have no stable identity)
    // and the specific serials being written. Anything saved earlier under this
    // session but absent from draft_data right now is left alone.
    //
    // Deliberately NOT an upsert-on-conflict: that resolves the target index
    // through PostgREST's cached constraint metadata, so a stale cache makes
    // the whole write fail with nothing in the UI to show for it — which is
    // what emptied Sieving Tower's bagging rows on production for a full day
    // (draft_data kept saving, the bagging write behind it did not). Plain
    // delete-then-insert depends on no such metadata.
    const bagNoSerial   = bag.filter((r: any) => !r.bag_serial_no)
    const bagWithSerial = bag.filter((r: any) =>  r.bag_serial_no)
    await db.schema('production').from('prod_bagging')
      .delete().eq('session_id', sid).is('bag_serial_no', null)
    if (bagWithSerial.length) {
      await db.schema('production').from('prod_bagging')
        .delete().eq('session_id', sid)
        .in('bag_serial_no', bagWithSerial.map((r: any) => r.bag_serial_no))
    }
    // bag_no is numbered 1..N straight off this instant's draft_data, but the
    // deletes above deliberately leave earlier rows standing — a bag the
    // operator has since removed from the screen keeps both its row and its
    // bag_no. Renumbering from 1 then walks right onto that number, which
    // production rejects (unique index prod_bagging_session_bag_uidx over
    // (session_id, bag_no)): remove bag 3 of 5 and every save from then on dies
    // with `duplicate key value violates unique constraint`, leaving the row
    // list frozen behind a mass balance that keeps updating correctly. So hand
    // out the numbers that are actually free once the deletes have run, keeping
    // the rows in their captured order — bag_no is a per-session label, nothing
    // reads it as a dense 1..N sequence (the production order renumbers rows
    // for display in lib/production/order-detail.ts).
    const { data: heldRows } = await db.schema('production').from('prod_bagging')
      .select('bag_no').eq('session_id', sid)
    const heldBagNos = new Set(((heldRows as any[]) ?? []).map(r => Number(r.bag_no)))
    let nextBagNo = 1
    for (const r of bag as any[]) {
      while (heldBagNos.has(nextBagNo)) nextBagNo++
      r.bag_no = nextBagNo++
    }

    if (bagNoSerial.length) {
      const ins = await db.schema('production').from('prod_bagging').insert(bagNoSerial as any)
      if (ins.error) rowErrors.push(`bags: ${rowErrText(ins.error)}`)
    }
    if (bagWithSerial.length) {
      const ins = await db.schema('production').from('prod_bagging').insert(bagWithSerial as any)
      if (ins.error) rowErrors.push(`bags: ${rowErrText(ins.error)}`)
    }
    // Same failure class as the input rows above: prod_bagging has emptied out
    // on production before with the capture screen showing no sign of it.
    setRowWriteError(rowErrors.length ? rowErrors.join(' · ') : null)
    if (rowErrors.length) console.error('structured row write failed', rowErrors)

    // ── Pasteuriser finished-product bags ──────────────────────────────────────
    // Every other section registers each output bag in bag_tags at bagging time,
    // so it can be scanned/tracked downstream. Pasteuriser output is captured as
    // bag *ranges* (a count + optional start/end number), so we expand each range
    // into individual bag_tags rows here — one scannable finished bag per unit.
    // Serial carries the batch/lot number + the physical bag number:
    // "{LOT}-{NNN}" (e.g. 26244-CON-SFC-001). Rebuilt on every save: upsert the
    // current set, then prune only still-in_stock rows that dropped out (e.g. the
    // operator lowered the count) — anything already moved/dispatched downstream
    // is left untouched.
    if (isPasteuriser(sectionId)) {
      const outBags: any[] = []
      const seen = new Set<string>()
      prods.forEach(p => {
        const pd = p.data as PasteuriserData
        ;(pd.outputs ?? []).forEach(line => {
          const count = Math.max(0, Math.floor(n(line.bagCount)))
          const lot   = upperCode(line.lot || pd.batchNo || '')
          if (count === 0 || !lot) return
          const startNo = parseInt(line.startBag, 10)
          const bagW    = n(line.bagWeight) || n(pd.weightPerBag) || null
          for (let i = 0; i < count; i++) {
            const physicalNo = Number.isFinite(startNo) ? startNo + i : i + 1
            const serial = `${lot}-${String(physicalNo).padStart(3, '0')}`
            if (seen.has(serial)) continue   // overlapping ranges within a batch — keep first
            seen.add(serial)
            outBags.push({
              serial_number: serial, section_id: 'pasteuriser', session_id: sid,
              product_type: line.item || pd.item || 'Rooibos Final Product',
              variant: p.variant || null, weight_kg: bagW, lot_number: lot,
              acumatica_id: line.itemCode || pd.itemCode || null,
              status: 'in_stock', consumed: false,
              batch_id: bidFor(lot) ?? sessionBatchId,
            })
          }
        })
      })
      if (outBags.length) {
        await db.schema('production').from('bag_tags').upsert(outBags as any, { onConflict: 'serial_number' })
      }
      const { data: existingOut } = await db.schema('production').from('bag_tags')
        .select('serial_number').eq('session_id', sid).eq('section_id', 'pasteuriser').eq('status', 'in_stock')
      const stale = ((existingOut as any[]) ?? []).map(r => r.serial_number as string).filter(s => !seen.has(s))
      if (stale.length) await db.schema('production').from('bag_tags').delete().in('serial_number', stale)
    }

    let mbA = 0, mbB = 0, mbC = 0, mbD = 0
    if (kind === 'refining') {
      // The only section reporting four separate output streams; everywhere else
      // a single produced figure goes in B.
      prods.forEach(p => {
        const t = refiningTotals(p.data as RefiningData)
        mbA += t.totalA; mbB += t.totalB; mbC += t.totalC; mbD += t.totalD
      })
    } else {
      // Same core balance the screen uses, so the persisted row cannot drift
      // from what the operator was looking at. Blender previously fell through
      // to sievingTotals here and only produced the right number by accident,
      // because both shapes happen to have an `outputs` array keyed on weight.
      mbB += sumProductionTotals(
        prods.map(p => productionTotals(kind, p.data as AnyBalanceData, { shift: shiftBal, carryOverInKg })),
      ).totalOut
      // Half-bag Top-up weight added into an existing bag THIS session —
      // never in p.data.outputs (side-channel write, see HalfBagTopUpModal),
      // so it has to be pulled in here too or the debagged material it came
      // from is counted as input with nothing on the output side to balance
      // it. Session-scoped, added once (not per-production — prods can hold
      // more than one run within this one session). Restricted to
      // mode==='production' — a mode==='existing' (bag-to-bag) transfer
      // moves weight OUT of a source bag already counted as output when IT
      // was first bagged, so adding it again here would double-count.
      const topUpMap = await fetchTopUpEventsForSession(sectionId, sid)
      mbB += Array.from(topUpMap.values()).flat().filter(t => t.mode === 'production').reduce((s, t) => s + t.kg, 0)
    }
    await db.schema('production').from('prod_mass_balance').upsert({
      session_id: sid, total_input_kg: totalIn,
      total_output_a_kg: mbA, total_output_b_kg: mbB, total_output_c_kg: mbC, total_output_d_kg: mbD,
      calculated_at: new Date().toISOString(),
    } as any, { onConflict: 'session_id' })

    const serials = bag.map(b => b.bag_serial_no).filter(Boolean)
    if (serials.length) {
      await db.schema('production').from('bag_tags').update({ session_id: sid } as any).in('serial_number', serials)
    }

    // Run linking + rollup is wrapped so it can NEVER affect the core save above:
    // the draft_data + structured rows + per-session mass balance are already
    // committed by this point. A run schema/write hiccup must not lose capture.
    try {
      // Lazily open + link a run on the first real capture, using the settled
      // variant/grade. Skipped while a continue prompt is pending — the operator
      // must choose Continue / Start new rather than auto-forking a new run.
      if (!runIdRef.current && !continueRunRef.current) {
        const p0 = prods[0]
        const variant = p0?.variant ?? ''
        const grade   = runGrade(p0)
        const hasData = totalIn > 0 || mbA > 0 || mbB > 0 || mbC > 0 || mbD > 0
        // Blender is gradeless for the UI's per-batch Grade dropdown, but its run
        // discriminator (the blend code, via runGrade) is just as real as Sieving's
        // grade — a run must not open before a blend is actually chosen.
        if (hasData && variant && (gradeless && !isBlenderRun && !isPasteuriserRun ? true : !!grade)) {
          const found = await findOpenRun(poKey, variant, grade)
          const newRid = found?.id ?? await openRun(poKey, variant, grade)
          if (newRid) {
            await db.schema('production').from('prod_sessions').update({ run_id: newRid } as any).eq('id', sid)
            runIdRef.current = newRid
            setRunId(newRid)
          }
        }
      }

      // Roll the run-level mass balance up across every shift session in this run,
      // so production_runs holds the durable full-day figure. Each session's own
      // prod_mass_balance row (above) stays the per-shift record.
      const rid = runIdRef.current
      if (rid) {
        const { data: runSess } = await db.schema('production').from('prod_sessions').select('id').eq('run_id', rid)
        const ids = ((runSess as any[]) ?? []).map(s => s.id)
        if (ids.length) {
          const { data: mbs } = await db.schema('production').from('prod_mass_balance')
            .select('total_input_kg,total_output_a_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg').in('session_id', ids)
          let tin = 0, tout = 0
          ;((mbs as any[]) ?? []).forEach(m => {
            tin  += Number(m.total_input_kg) || 0
            tout += (Number(m.total_output_a_kg) || 0) + (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0)
          })
          await db.schema('production').from('production_runs')
            .update({ total_input_kg: tin, total_output_kg: tout, batch_id: sessionBatchId, updated_at: new Date().toISOString() } as any).eq('id', rid)
        }
      }
      setRunRollupStale(false)
    } catch (e) {
      // Never let a run-linking/rollup hiccup lose the capture already committed
      // above — but silently swallowing it left the full-day total able to go
      // stale with zero indication to whoever's about to trust it at sign-off.
      console.warn('production_runs rollup failed — full-day total may be stale', e)
      setRunRollupStale(true)
    }
  }
  persistRef.current = persist

  async function saveDraft() {
    setSaving(true); setError(null)
    try {
      // Don't materialise an empty session on an explicit save either — only create
      // once there's real capture. Edits to an existing session still save.
      let sid = sessionRef.current
      if (!sid) {
        if (!hasCaptureData(productions)) { setSaving(false); return }
        sid = await ensureSession()
      }
      await persist(productions, sid)
      setStatus(s => s === 'new' ? 'draft' : s)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function storeSignature(signerRole: 'operator' | 'supervisor', name: string, sig: string) {
    const sid = await ensureSession()
    await getDb().schema('production').from('session_signatures').insert({
      session_id: sid, signer_role: signerRole, signer_name: name,
      signer_user_id: user?.id ?? null, signature_b64: sig,
    } as any)
    await getDb().schema('production').from('prod_sessions').update(
      signerRole === 'operator'
        ? { op_signed: true, op_name_signoff: name, op_signed_at: new Date().toISOString() }
        : { sup_signed: true, sup_name_signoff: name, sup_signed_at: new Date().toISOString() }
    ).eq('id', sid)
  }

  // How many production orders/batches this shift actually captured (this
  // session + any siblings). Two or more before an early submit means the
  // operator switched product mid-shift — the signal for a changeover.
  function capturedProductionCount(): number {
    return [...productions, ...siblingProductions].filter(p => hasCaptureData([p])).length
  }

  // Prompt "is there a changeover?" only on an EARLY morning submit (before
  // 15h30 SAST — the tablet runs on SAST, same convention as pastChangeover)
  // that already captured 2+ POs. A normal end-of-morning submit near 16h00 is
  // not a changeover, so it never nags. The afternoon operator's own login
  // records their shift start on a fresh session/timesheet.
  function earlyChangeoverLikely(): boolean {
    if (shift !== 'morning') return false
    const now = new Date()
    if (dateParam !== format(now, 'yyyy-MM-dd')) return false
    const beforeCutoff = now.getHours() < 15 || (now.getHours() === 15 && now.getMinutes() < 30)
    return beforeCutoff && capturedProductionCount() >= 2
  }

  async function handleSubmit() {
    // Intercept an early multi-PO morning submit to ask about a changeover; the
    // modal's buttons call submitSession() directly with the answer.
    if (earlyChangeoverLikely()) { setChangeoverAsk(true); return }
    await submitSession(false)
  }

  async function submitSession(changeover: boolean) {
    setChangeoverAsk(false)
    // On a confirmed changeover, log it as a structured handover note so it
    // shows in Productions history and the next shift's handover banner. We
    // don't write shift_takeovers here — the incoming operator isn't known yet;
    // they're recorded when they log in and open the afternoon record.
    const note = changeover
      ? `⇄ Shift changeover at ${format(new Date(), 'HH:mm')} — handed over mid-shift; the afternoon/night shift continues on a new record.`
      : null
    const finalComments = note
      ? (comments.trim() ? `${comments.trim()}\n${note}` : note)
      : (comments.trim() || null)
    if (note) setComments(finalComments!)   // reflect in the UI immediately
    await saveDraft()
    setSubmitting(true)
    try {
      const sid = await ensureSession()
      await getDb().schema('production').from('prod_sessions').update({
        status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        comments: finalComments,
      } as any).eq('id', sid)
      setStatus('submitted')
      // A floor operator submitting = end of their shift on this tablet: sign
      // them out so the next shift's operator has to sign in fresh. Supervisors
      // / IT capturing on a shared device are not signed out. Short delay lets
      // the "Submitted" confirmation render before the redirect to /login.
      if (role === 'floor_operator') {
        setTimeout(() => { signOut() }, 1500)
      }
    } catch (e: any) { setError(e.message) }
    setSubmitting(false)
  }

  // Approving IS the supervisor's "Verify & Sign" — their signature is
  // resolved server-side from their own Staff Directory record, same as job
  // cards, never accepted from the client. See app/api/production/sessions/[id]/approve.
  async function handleApprove() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/production/sessions/${sessionId}/approve`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endOfRun }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not approve')
      setStatus('approved')
    } catch (e: any) { setError(e.message) }
    setSubmitting(false)
  }

  // ── Render gates ─────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>
  }

  if (!assignment) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 px-4 text-center">
        <AlertTriangle size={24} className="text-warn" />
        <p className="text-[14px] font-medium text-text">No assignment for this section</p>
        <p className="text-[12px] text-text-muted max-w-sm">A supervisor needs to roster operators onto {meta.name} for the {shift} shift before capture can start.</p>
        <button onClick={goBack} className="text-[12px] text-brand hover:underline">← Back</button>
      </div>
    )
  }

  if (!meta.built) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 px-4 text-center">
        <ClipboardList size={24} className="text-stone-400" />
        <p className="text-[14px] font-medium text-text">{meta.name} capture is coming soon</p>
        <p className="text-[12px] text-text-muted max-w-sm">The Sieving Tower flow is the proven template; this section will follow the same pattern.</p>
        <button onClick={goBack} className="text-[12px] text-brand hover:underline">← Back</button>
      </div>
    )
  }

  const locked = status === 'approved'
  const at = active ? prodTotals(active) : { totalIn: 0, totalOut: 0, carryOverIn: 0, carryOverOut: 0, balance: 0 }
  const totalIn = at.totalIn   // active batch — only used for the "machine running" cue
  // This shift's own contribution, and the other shift's (each with its own
  // bucket-elevator direction), so the balance can be shown per shift and totalled.
  const st = sessionTotals([...productions, ...siblingProductions], shiftBal)
  const ot = sessionTotals(otherShiftProductions, otherShiftBal)
  const morningTotals   = shiftBal === 'morning'   ? st : ot
  const afternoonTotals = shiftBal === 'afternoon' ? st : ot
  const runSpansShifts = runId != null && otherShiftProductions.length > 0
  // The single mass balance everyone sees: the whole production run (07h00–01h00,
  // every shift + batch), so operators across shifts read one unified figure.
  // Falls back to this session when the run isn't linked across shifts yet.
  const rt = runSpansShifts ? sumProductionTotals([st, ot]) : st
  // Material left in the elevator for tomorrow is work in progress, not a
  // shortfall — it comes out of Total Output and off the variance, and is shown
  // in its own column instead.
  const rtVariance  = rt.balance
  const rtWithinTol = Math.abs(rtVariance) <= massBalanceToleranceFor(sectionId)
  const multi = productions.length > 1
  // Rows for the tabular balance — only shifts that actually captured material.
  const balanceRows = [
    (morningTotals.totalIn > 0 || morningTotals.totalOut > 0) ? { shift: 'Morning' as const, ...morningTotals } : null,
    (afternoonTotals.totalIn > 0 || afternoonTotals.totalOut > 0) ? { shift: 'Afternoon' as const, ...afternoonTotals } : null,
  ].filter(Boolean) as { shift: 'Morning' | 'Afternoon'; totalIn: number; totalOut: number; carryOverOut: number }[]
  // The bucket-elevator note only applies to Sieving; Granule shows its custom
  // PR-FM-026/7 decomposition (G = C* + carry-over/waste, and % yield); other
  // lines get a generic run note.
  let balanceNote: string | undefined =
    sectionId === 'sieving'
      ? undefined
      : 'One balance for the whole production run (07h00–01h00), combined across every shift.'
  if (sectionId === 'granule') {
    const runProds = runSpansShifts ? [...productions, ...siblingProductions, ...otherShiftProductions] : [...productions, ...siblingProductions]
    let A = 0, cStar = 0, carry = 0
    runProds.forEach(p => {
      const g = granuleTotals(p.data as GranuleData)
      A += g.totalA; cStar += g.cStar; carry += g.D + g.E + g.wasteF
    })
    const G = cStar + carry
    const yieldPct = A > 0 ? (G / A) * 100 : 0
    balanceNote = `Granules produced (C*) ${cStar.toFixed(0)} kg + carry-over/waste ${carry.toFixed(0)} kg = ${G.toFixed(0)} kg produced (G), from ${A.toFixed(0)} kg dust mixed (A). Yield ${yieldPct.toFixed(0)}%.`
  }
  // A batch record this shift running a genuinely different variant/grade is
  // deliberately kept out of the combined balance above (two different runs
  // must never have their balances summed just because they share a shift) —
  // but a SILENT exclusion reads to the operator as "this shift's whole
  // story", making an already-bagged batch look like it's still owed. Surface
  // it instead of hiding it, without changing what actually gets combined.
  const siblingIds = new Set(siblingProductions.map(p => p.id))
  const excludedThisShift = shiftOtherProductions.filter(p => !siblingIds.has(p.id) && hasCaptureData([p]))
  if (excludedThisShift.length > 0) {
    const ex = sessionTotals(excludedThisShift, shiftBal)
    const exLabels = Array.from(new Set(excludedThisShift.map(p =>
      (VARIANT_OPTIONS.find(v => v.value === p.variant)?.label ?? p.variant) || 'unspecified'
    ))).join(', ')
    const exNote = `Also on this shift, under a different variant/grade (${exLabels}): ${ex.totalIn.toFixed(0)} kg in, ${ex.totalOut.toFixed(0)} kg out — its own separate balance, not part of the total above.`
    balanceNote = balanceNote ? `${balanceNote} ${exNote}` : exNote
  }

  // Sign-off candidates: a person-logged-in tablet has a single verified operator;
  // a section/machine tablet resolves the signer from the rostered operators by PIN.
  const candidateOps = verifiedOp
    ? [{ id: verifiedOp.id, name: verifiedOp.display_name || verifiedOp.name, pin: verifiedOp.pin ?? '' }]
    : rosterOps

  function updateActiveMeta(key: 'variant' | 'lot' | 'grade', val: string) {
    // Belt-and-braces: the Variant/Grade selects are already disabled once a
    // bulk bag is locked (see sievingHasSecuredDebag), but block it here too
    // in case anything else ever calls updateActiveMeta directly.
    if ((key === 'variant' || key === 'grade') && sievingHasSecuredDebag) return
    setProductions(ps => ps.map((p, i) => i === activeIdx ? { ...p, [key]: val } : p))
    if (key === 'variant') {
      const assigned = assignment?.variant ?? ''
      if (assigned && val && val !== assigned) {
        const assignedLabel = VARIANT_OPTIONS.find(v => v.value === assigned)?.label ?? assigned
        const chosenLabel   = VARIANT_OPTIONS.find(v => v.value === val)?.label ?? val
        setVariantMismatch(`Supervisor assigned ${assignedLabel} — you selected ${chosenLabel}.`)
        const noteText = `⚠ Variant mismatch: supervisor assigned "${assignedLabel}", operator captured "${chosenLabel}".`
        setComments(prev => prev.includes('Variant mismatch') ? prev : prev.trim() ? `${prev}\n${noteText}` : noteText)
      } else {
        setVariantMismatch(null)
      }
    }
  }
  async function addProduction() {
    // Change-over: snapshot the closing mass balance of the production we're
    // leaving into the append-only checks trail (auto-derived, no typing).
    try {
      const prev = prodTotals(active!)
      const recId = await ensureCheckRecord(sectionId, dateParam, shift, sessionId)
      if (recId) await appendCheckEvent(recId, {
        phase: 'shutdown', check_key: 'mass_balance', check_label: 'Mass balance (change-over)', kind: 'massbalance',
        value_num: prev.totalIn - prev.totalOut, value_text: `${prev.totalIn.toFixed(1)} in / ${prev.totalOut.toFixed(1)} out`,
        unit: 'kg', status: Math.abs(prev.totalIn - prev.totalOut) <= massBalanceToleranceFor(sectionId) ? 'ok' : 'flagged',
        production_idx: activeIdx, source: 'auto',
      })
    } catch { /* snapshot is best-effort */ }
    setProductions(ps => [...ps, emptyProduction(sectionId, null, assignment?.lot_number)])
    setActiveIdx(productions.length)
    setTab('production')
  }

  // Mid-shift grade/variant changeover (Sieving): the closing batch's leftover
  // mass balance is still part of the SAME production run and can go out as
  // Blocks/Sticks under the new grade — so it stays in the same session
  // (addProduction, combined mass balance) rather than a hard reset, UNLESS the
  // closing batch is organic, which must never share a balance with anything
  // else and gets a fully separate session (startNewProduction).
  function confirmGradeChangeover() {
    setGradeChangeover(false)
    if (isOrganicVariant(active?.variant)) startNewProduction()
    else addProduction()
  }

  // Start a fresh batch record for the next variant/grade after the current one is
  // submitted/locked. LAZY — reset local state only; the new prod_sessions row is
  // created on the first real capture (ensureSession, gated by hasCaptureData). This
  // is what stops an abandoned "start new batch record" from leaving an empty
  // "No data" session behind (the duplicate-orders bug).
  function startNewProduction() {
    const aL = assignment?.lot_number ?? ''
    // The record being closed is still part of this shift, so hand it to the
    // whole-shift bag log before the local state is cleared — otherwise "Bags
    // this shift" drops to zero the moment a new batch record opens, since the
    // sibling prod_sessions rows are only re-read on a page load. Deliberately
    // NOT added to siblingProductions: that set feeds the mass balance, which
    // may only ever combine records running the same variant/grade.
    const closing = productionsRef.current.filter(p => hasCaptureData([p]))
    if (closing.length) setShiftOtherProductions(prev => [...prev, ...closing])
    sessionRef.current = null
    setSessionId(null)
    setStatus('new')
    setProductions([emptyProduction(sectionId, null, aL)])
    setActiveIdx(0)
    // Fresh session → resolve a run anew once variant/grade are picked.
    runIdRef.current = null
    continueRunRef.current = null
    setRunId(null)
    setContinueRun(null)
    setEndOfRun(false)
    setComments('')
    setTab('production')
  }

  const statusLabel = status === 'approved' ? 'Signed off' : status === 'submitted' ? 'Awaiting sign-off' : status === 'draft' ? 'Draft' : 'New'
  const statusColor = status === 'approved' ? 'bg-ok/10 text-ok' : status === 'submitted' ? 'bg-info/10 text-info' : status === 'draft' ? 'bg-warn/10 text-warn' : 'bg-stone-100 text-stone-500'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* 16h00 hand-over — blocks capture until the incoming operator PINs in */}
      {changeoverNeeded && !takenOver && (
        <ChangeoverModal
          sectionName={meta.name}
          hasRoster={afternoonOps.length > 0}
          onConfirm={confirmChangeover}
          onBack={goBack}
        />
      )}

      {/* Early-submit changeover check — asked when a morning operator submits
          before 15h30 having already run 2+ POs. */}
      {changeoverAsk && (
        <ChangeoverSubmitModal
          sectionName={meta.name}
          onAnswer={submitSession}
          onCancel={() => setChangeoverAsk(false)}
        />
      )}

      {/* Half-bag top-up — add material to an existing bag (typically a
          half-filled bag left open from a previous shift), either from
          today's own production (the common case, mainly Sieving) or from
          another existing tracked bag (mainly Blender). Deliberately
          narrow beyond that: no brand-new bag creation, no registering
          untracked stock — those are warehouse-management functions, not
          built here. Pasteuriser is excluded, same reason as always (no
          per-bag records today). */}
      {topUpOpen && !locked && (
        <HalfBagTopUpModal
          sectionId={sectionId} sessionId={sessionId}
          operatorId={verifiedOp?.user_id ?? user?.id ?? null}
          date={dateParam} shift={shift}
          onDone={() => setTopUpOpen(false)}
          onClose={() => setTopUpOpen(false)}
        />
      )}

      {/* Mid-shift grade/variant changeover confirm — shows the leftover mass
          balance before switching, since it's the operator's cue to bag it out
          as Blocks/Sticks under the new grade (or, if organic, that it must be
          closed off on its own). */}
      {gradeChangeover && active && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9997, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-stone-100">
              <RefreshCw size={18} className="text-brand shrink-0" />
              <div className="font-semibold text-[15px] text-text">Changeover — switch grade/variant</div>
            </div>
            <div className="p-5 space-y-3">
              {isOrganicVariant(active.variant) ? (
                <p className="text-[13px] text-text-muted">
                  This batch is <strong className="text-text">{VARIANT_OPTIONS.find(v => v.value === active.variant)?.label ?? active.variant}</strong> — organic material must stay segregated, so this closes it off as its own record. The new grade/variant starts a fresh batch with its own mass balance.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-text-muted">Current mass balance:</span>
                    <BalanceBadge variance={rtVariance} tolerance={massBalanceToleranceFor(sectionId)} />
                  </div>
                  <p className="text-[13px] text-text-muted">
                    This carries into the new batch — leftover raw material is still part of the same run and can be bagged out as Blocks / Rolsiev Sticks / Indent Sticks under the new grade.
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 px-5 pb-5">
              <button onClick={() => setGradeChangeover(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 text-stone-600 text-[13px] font-medium hover:bg-stone-50">
                Cancel
              </button>
              <button onClick={confirmGradeChangeover}
                className="flex-1 px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-brand-mid transition-colors">
                Confirm changeover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hourly infeed-VSD prompt — auto-pops every hour while the line runs,
          and stays available after checks are signed (page-level, not in the
          Checks tab). Only sections with an hourly VSD check surface it.
          Suppressed (not unmounted) on the Overview tab — that's a "just
          reading" view (often reached from a supervisor's production-order
          review), and a modal popping up over someone reading the AI summary
          rather than actually operating the line reads as a bug, not a
          reminder. Kept mounted across tab switches via `visible` rather than
          conditionally rendered — unmounting reset its "last reading"
          fetch and hour timer on every switch, so it kept popping up
          immediately regardless of when a reading was last logged. */}
      {!cleanerActor && (
        <HourlyVsdPrompt
          sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId}
          running={totalIn > 0}
          active={status !== 'submitted' && status !== 'approved'}
          operator={verifiedOp ? { id: verifiedOp.id, name: verifiedOp.display_name || verifiedOp.name } : null}
          visible={tab !== 'overview'}
        />
      )}

      {/* Header — section-tinted band */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 flex-shrink-0 border-b border-stone-100"
        style={{ background: `linear-gradient(180deg, ${meta.colorHex}12, transparent)` }}>
        <button onClick={goBack} className="p-2 -ml-1 rounded-lg hover:bg-black/5 text-stone-500"><ChevronLeft size={18} /></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm" style={{ background: meta.colorHex }}>
          <span className="font-mono font-bold text-[12px] text-white">{meta.code}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[20px] text-text leading-tight">{meta.name}</h1>
          <p className="text-[11px] text-text-muted mt-0.5 truncate">
            {cleanerActor ? (
              <>Signed in as <strong className="text-text">{cleanerActor.name}</strong> · Cleaner</>
            ) : (
              <><span className="capitalize">{shift} shift</span> · {format(parseISO(dateParam + 'T12:00:00'), 'd MMM')}
              {opNames.length ? <> · {opNames.join(', ')}</> : null}</>
            )}
          </p>
        </div>
        {!cleanerActor && (
          <button onClick={() => setCleanerGateOpen(true)} title="Cleaner sign-in"
            className="p-2 rounded-lg shrink-0 text-stone-400 hover:bg-black/5 hover:text-stone-600">
            <Sparkles size={18} />
          </button>
        )}
        {!cleanerActor && (
          <button onClick={() => setTab('messages')} title="Line messages"
            className={`p-2 rounded-lg shrink-0 transition-colors ${tab === 'messages' ? 'bg-brand/10 text-brand' : 'text-stone-400 hover:bg-black/5 hover:text-stone-600'}`}>
            <MessageSquare size={18} />
          </button>
        )}
        {cleanerActor ? (
          <span className="text-[10px] font-semibold px-2.5 py-1.5 rounded-full shrink-0 bg-ok/10 text-ok">Cleaner mode</span>
        ) : (
          <span className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-full shrink-0 ${statusColor}`}>{statusLabel}</span>
        )}
      </div>

      {/* Cleaner sign-in gate — PIN-matched against whoever the whole-site Shift
          Roster has on cleaning duty for this date/shift (not the section's own
          operators). Deliberately separate from the operator's own identity so
          a cleaner task can only ever be signed by an actual cleaner. */}
      {cleanerGateOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setCleanerGateOpen(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center"><Sparkles size={22} className="text-brand" /></div>
              <h2 className="font-semibold text-[17px] text-text">Cleaner sign-in</h2>
              <p className="text-[12px] text-text-muted leading-relaxed">
                Enter your PIN to open this section's cleaning tasks. The operator's capture stays saved — you'll sign out once you're done.
              </p>
            </div>
            {cleanerCandidates.length === 0 ? (
              <p className="text-[12px] text-amber-600 text-center">No cleaner rostered for this shift.</p>
            ) : (
              <>
                <input type="password" inputMode="numeric" maxLength={4} value={cleanerPin} autoFocus
                  onChange={e => { setCleanerPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setCleanerError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') verifyCleanerPin() }}
                  placeholder="••••"
                  className="w-full px-3 py-3 rounded-xl border border-stone-200 bg-white text-center font-mono tracking-[0.5em] text-[22px] outline-none focus:border-brand" />
                {cleanerError && <p className="text-[11px] text-err text-center">{cleanerError}</p>}
                <button onClick={verifyCleanerPin} disabled={cleanerPin.length !== 4}
                  className="w-full py-3 rounded-xl bg-brand text-white font-semibold text-[13px] disabled:opacity-40">
                  Sign in
                </button>
              </>
            )}
            <button onClick={() => { setCleanerGateOpen(false); setCleanerPin(''); setCleanerError(null) }}
              className="w-full text-[12px] text-stone-400 hover:text-text">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Process stepper — the steps the operators actually work through, in order.
          Clickable so they can jump around; current step is highlighted, earlier
          steps read as done. Messages lives in the header, not the flow.
          Hidden entirely in cleaner mode — a signed-in cleaner has nowhere else
          to go but Cleaning, so there's nothing to step through. */}
      {!cleanerActor && (
      <div className="flex items-center px-3 sm:px-4 py-3 flex-shrink-0 bg-white border-b border-stone-200 overflow-x-auto">
        {visibleSteps.map((s, i) => {
          const activeIdxStep = visibleSteps.findIndex(x => x.id === tab)
          const isActive = tab === s.id
          // Checks reflects real state (signed?) so its tick means "checks done",
          // not just "we've moved past this tab".
          const isDone   = s.id === 'checks' ? checksSigned : activeIdxStep > i
          const Icon = s.icon
          return (
            <div key={s.id} className="flex items-center shrink-0">
              <button onClick={() => setTab(s.id)} className="flex items-center gap-2 group">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold border-2 transition-colors
                  ${isActive ? 'bg-brand text-white border-brand'
                    : isDone ? 'bg-brand/10 text-brand border-brand/40'
                    : 'bg-white text-stone-400 border-stone-300 group-hover:border-stone-400'}`}>
                  {isDone ? <Check size={15} strokeWidth={3} /> : i + 1}
                </span>
                <span className={`text-[14px] font-bold hidden sm:inline transition-colors
                  ${isActive ? 'text-brand' : isDone ? 'text-stone-700' : 'text-stone-400 group-hover:text-stone-600'}`}>
                  {s.label}
                </span>
                <Icon size={15} className={`sm:hidden ${isActive ? 'text-brand' : isDone ? 'text-stone-700' : 'text-stone-400'}`} />
              </button>
              {i < visibleSteps.length - 1 && (
                <div className={`w-6 sm:w-10 h-px mx-1.5 sm:mx-2.5 ${activeIdxStep > i ? 'bg-brand/40' : 'bg-stone-200'}`} />
              )}
            </div>
          )
        })}
      </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-surface)' }}>
        <div className="px-4 py-5 max-w-[800px] space-y-5">
          {rowWriteError && tab !== 'messages' && !cleanerActor && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-[12px] text-red-800">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                <strong>Your weights are saved, but the input/output row list didn&apos;t save</strong> — the
                production order and shift report will show this record as having no
                debagging or bagging rows even though the mass balance above is right.
                Try Save draft again; if it keeps failing, send this to IT: <span className="font-mono">{rowWriteError}</span>
              </span>
            </div>
          )}
          {/* The full-day rollup write failed on the last save — the per-shift
              mass balance above is still correct and safely saved, but the
              combined full-day total (production_runs) may be stale until the
              next successful save. Non-blocking: capture continues normally. */}
          {runRollupStale && runId && tab !== 'messages' && !cleanerActor && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-800">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span><strong>Full-day total may be out of date</strong> — the last save couldn't update the combined run total. Your per-shift figures above are still correct and saved; try Save draft again to refresh the full-day total.</span>
            </div>
          )}
          {/* Handover note from the previous shift on this line */}
          {prevNote && tab !== 'messages' && !cleanerActor && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-800">
              <MessageSquare size={14} className="shrink-0 mt-0.5" />
              <span>
                <strong>Handover note</strong> ({format(parseISO(prevNote.date + 'T12:00:00'), 'd MMM')} · <span className="capitalize">{prevNote.shift}</span> shift): {prevNote.note}
              </span>
            </div>
          )}
          {tab === 'production' && active && (
            <>
              {locked && (
                <div className="bg-ok/5 border border-ok/30 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-ok"><Lock size={16} /> This batch record is signed off &amp; locked.</div>
                  <p className="text-[12px] text-text-muted">To capture a different variant or grade on this line, create a <strong>new batch record</strong> — same steps as before. The locked record above stays saved.</p>
                  <button onClick={startNewProduction}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white font-medium text-[14px] hover:bg-brand-mid transition-colors">
                    <Plus size={16} /> Create new batch record
                  </button>
                </div>
              )}

              {status === 'submitted' && !locked && (
                <div className="bg-info/5 border border-info/30 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-info"><CheckCircle2 size={16} /> Submitted — awaiting supervisor sign-off.</div>
                  <p className="text-[12px] text-text-muted">You don't need to wait. Start capturing the next production order now — the supervisor can approve this one from their dashboard.</p>
                  <button onClick={startNewProduction}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-info text-white font-medium text-[14px] hover:opacity-90 transition-opacity">
                    <Plus size={16} /> Start new batch record
                  </button>
                </div>
              )}

              {/* Routine guide: until start-up checks are done, lead with a clear
                  "do checks first" gate. Strong but not blocking — capture is still
                  below for the cases where they must proceed. */}
              {hasChecks && !locked && !checksSigned && (
                <button onClick={() => setTab('checks')}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-warn/8 border-2 border-warn/30 rounded-2xl text-left hover:bg-warn/12 transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-warn/15 flex items-center justify-center shrink-0"><Gauge size={18} className="text-warn" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-text">Start with your machine checks</div>
                    <div className="text-[12px] text-text-muted">Step 1 of the shift — tap to do your start-up checks. You can still capture below if you must.</div>
                  </div>
                  <span className="text-[12px] font-semibold text-warn shrink-0">Do checks →</span>
                </button>
              )}

              {hasChecks && !locked && checksSigned && (
                <ChecksStatusStrip sectionId={sectionId} date={dateParam} shift={shift}
                  running={totalIn > 0} onOpen={() => setTab('checks')} />
              )}

              {/* Continue the previous shift's run? Fires once variant (+ grade)
                  are chosen and an open run from an earlier shift matches PO +
                  variant + grade. Continue carries the mass balance forward. */}
              {continueRun && !locked && (
                <div className="bg-info/5 border-2 border-info/30 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-info">
                    <ArrowRight size={16} /> Continue the production run from the previous shift?
                  </div>
                  <p className="text-[12px] text-text-muted">
                    {meta.name} is mid-run
                    {continueRun.production_order ? <> on <span className="font-mono">PO {continueRun.production_order}</span></> : ' on this order'}
                    {' — '}
                    <strong>{VARIANT_OPTIONS.find(v => v.value === continueRun.variant)?.label ?? continueRun.variant}</strong>
                    {continueRun.grade ? <> · {isBlenderRun ? <>blend <span className="font-mono">{continueRun.grade}</span></> : (DESTINATION_OPTIONS.find(o => o.value === continueRun.grade)?.label ?? continueRun.grade)}</> : null}.
                    {' '}Continue so the mass balance carries over into a full-day total.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={acceptContinueRun}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl bg-info text-white font-medium text-[14px] hover:opacity-90 transition-opacity">
                      <CheckCircle2 size={16} /> Continue run
                    </button>
                    <button onClick={declineContinueRun}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-white text-text font-medium text-[14px] hover:bg-stone-50 transition-colors">
                      <Plus size={16} /> Start new run
                    </button>
                  </div>
                </div>
              )}

              {/* Batch set-up + live mass balance — one card. Variant and grade
                  are a mandatory, deliberate choice (no Export/Conventional
                  default); the balance appears here once material goes in. The
                  per-bag batch/lot is captured below, not duplicated here. */}
              <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">
                    Batch{multi ? ` · P${activeIdx + 1}` : ''}
                  </span>
                  {!gradeless && <GradeHelp />}
                </div>
                <div className={`grid gap-2.5 ${gradeless ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Variant</label>
                    <select value={active.variant} disabled={locked || sievingHasSecuredDebag} onChange={e => updateActiveMeta('variant', e.target.value)}
                      className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-brand cursor-pointer disabled:cursor-not-allowed disabled:opacity-70 ${active.variant ? 'border-stone-200 text-text' : 'border-amber-300 text-stone-400'}`}>
                      <option value="" disabled>Select variant…</option>
                      {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                  {!gradeless && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Grade</label>
                      <select value={active.grade} disabled={locked || sievingHasSecuredDebag} onChange={e => updateActiveMeta('grade', e.target.value)}
                        className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-brand cursor-pointer disabled:cursor-not-allowed disabled:opacity-70 ${active.grade ? 'border-stone-200 text-text' : 'border-amber-300 text-stone-400'}`}>
                        <option value="" disabled>Select grade…</option>
                        {DESTINATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                {sievingHasSecuredDebag && !locked && (
                  <p className="text-[11px] text-stone-400">Bulk bags are locked in under this variant/grade — use <strong className="text-stone-500">Changeover</strong> below to switch.</p>
                )}

                {/* Per-batch breakdown — a changeover (addProduction) keeps the
                    run's mass balance combined, but that combined figure alone
                    doesn't show a changeover ever happened. Each batch's own
                    numbers stay visible here so one can be sanity-checked
                    without waiting for the combined total to explain itself. */}
                {multi && (
                  <div className="pt-3 border-t border-stone-100 space-y-1.5">
                    <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Batches this run ({productions.length})</span>
                    {productions.map((p, i) => {
                      const pt = prodTotals(p, shiftBal)
                      const pVariance = pt.totalIn - pt.totalOut
                      const isActive = i === activeIdx
                      const variantLabel = VARIANT_OPTIONS.find(v => v.value === p.variant)?.label ?? p.variant ?? '—'
                      const gradeLabel = p.grade ? DESTINATION_OPTIONS.find(o => o.value === p.grade)?.label ?? p.grade : ''
                      return (
                        <div key={p.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border text-[12px] ${isActive ? 'border-brand/40 bg-brand/5' : 'border-stone-200'}`}>
                          <span className="font-semibold text-text shrink-0">P{i + 1}</span>
                          <span className="text-stone-500 truncate flex-1">{variantLabel}{gradeLabel ? ` · ${gradeLabel}` : ''}</span>
                          <span className="font-mono text-stone-600 shrink-0">{pt.totalIn.toFixed(1)} → {pt.totalOut.toFixed(1)} kg</span>
                          <BalanceBadge variance={pVariance} tolerance={massBalanceToleranceFor(sectionId)} />
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${isActive ? 'bg-brand/10 text-brand' : 'bg-stone-100 text-stone-500'}`}>
                            {isActive ? 'current' : 'done'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Granule's balance is custom and lives in one place only — the
                    Overview. Other sections show the quick balance here too. */}
                {rt.totalIn > 0 && sectionId !== 'granule' && (
                  <div className="pt-3 border-t border-stone-100">
                    <MassBalanceTable rows={balanceRows} tolerance={massBalanceToleranceFor(sectionId)} note={balanceNote} />
                  </div>
                )}

                {/* Mid-shift grade/variant changeover — the leftover mass balance
                    stays visible and part of the run (can still go out as Blocks/
                    Sticks under the new grade) unless the closing batch is
                    organic, which must be segregated into its own session. */}
                {sectionId === 'sieving' && !locked && active.variant && (
                  <div className="pt-3 border-t border-stone-100">
                    <button onClick={() => setGradeChangeover(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-stone-200 text-stone-600 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors">
                      <RefreshCw size={14} /> Changeover — switch grade/variant
                    </button>
                  </div>
                )}
              </div>

              {/* Whole-shift bag reference — collapsed to a one-line in/out
                  summary, expandable to every bag. Sits between the batch card
                  and the capture form because it is context for what you are
                  about to capture, not an action: the shift's own running list
                  of what went in and what came out, across every batch record
                  it opened (the capture form below only ever shows the record
                  open on screen). Asked for by the afternoon shift. */}
              <ShiftBagLog
                sectionId={sectionId}
                shiftLabel={SHIFT_LABEL[shiftBal]}
                records={[
                  ...productions.map((p, i) => ({ ...p, label: multi ? `P${i + 1}` : 'This record', current: true })),
                  ...shiftOtherProductions.map((p, i) => ({ ...p, label: `Earlier record ${i + 1}`, current: false })),
                ]}
              />

              {variantMismatch && (
                <div className="flex items-start gap-2.5 px-4 py-3 bg-warn/8 border border-warn/30 rounded-2xl text-[13px] text-amber-800">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-warn" />
                  <div>
                    <span className="font-semibold">Variant mismatch — </span>
                    {variantMismatch} Your selection will be used. A note has been added to the supervisor sign-off.
                  </div>
                </div>
              )}

              {/* Capture opens once variant is chosen; grade is only needed on grade-driven
                  sections (Sieving). Refining and Granule are variant-only. */}
              {(gradeless ? !!active.variant : !!(active.variant && active.grade)) || locked ? (
                <>
                  {sectionId.startsWith('refining')
                    ? <RefiningCapture
                        key={active.id}
                        sectionId={sectionId}
                        assignment={assignment}
                        variantWord={active.variant}
                        locked={locked}
                        value={active.data as RefiningData}
                        onChange={updateActiveData}
                        genSerial={genSerial}
                        operatorId={verifiedOp?.user_id ?? user?.id ?? null}
                      />
                    : isBlenderSection(sectionId)
                    ? <BlenderCapture
                        key={active.id}
                        sectionId={sectionId}
                        assignment={assignment}
                        variantWord={active.variant}
                        locked={locked}
                        value={active.data as BlenderData}
                        onChange={updateActiveData}
                        genSerial={genSerial}
                        operatorId={verifiedOp?.user_id ?? user?.id ?? null}
                        date={dateParam}
                      />
                    : sectionId === 'granule'
                    ? <GranuleCapture
                        key={active.id}
                        sectionId={sectionId}
                        assignment={assignment}
                        variantWord={active.variant}
                        locked={locked}
                        value={active.data as GranuleData}
                        onChange={updateActiveData}
                        genSerial={genSerial}
                        operatorId={verifiedOp?.user_id ?? user?.id ?? null}
                        date={dateParam}
                        shift={shift}
                        sessionId={sessionId}
                      />
                    : isPasteuriser(sectionId)
                    ? <PasteuriserCapture
                        key={active.id}
                        sectionId={sectionId}
                        assignment={assignment}
                        variantWord={active.variant}
                        onVariantSuggestion={v => { if (!active.variant) updateActiveMeta('variant', v) }}
                        date={dateParam}
                        locked={locked}
                        value={active.data as PasteuriserData}
                        onChange={updateActiveData}
                        genSerial={genSerial}
                        operatorId={verifiedOp?.user_id ?? user?.id ?? null}
                      />
                    : <SievingCapture
                        key={active.id}
                        assignment={assignment}
                        variantWord={active.variant}
                        gradeLetter={active.grade || 'A'}
                        shift={shiftBal}
                        locked={locked}
                        value={active.data as SievingData}
                        onChange={updateActiveData}
                        genSerial={genSerial}
                        operatorId={verifiedOp?.user_id ?? user?.id ?? null}
                        date={dateParam}
                        sectionId={sectionId}
                        sessionId={sessionId}
                      />
                  }
                  {!locked && !isPasteuriser(sectionId) && (
                    <button onClick={() => setTopUpOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 text-white font-medium text-[14px] hover:bg-violet-700 transition-colors">
                      <Scale size={16} /> Half-bag top-up
                    </button>
                  )}
                  {!isPasteuriser(sectionId) && <HalfBagTopUpActivity sectionId={sectionId} sessionId={sessionId} />}
                  {!locked && (
                    <button onClick={saveDraft} disabled={saving}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-stone-200 bg-white font-medium text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
                      {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle2 size={15} className="text-ok" /> : <Save size={15} />}
                      {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
                    </button>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-2.5 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-[13px] text-amber-800">
                  <Info size={16} className="shrink-0 mt-0.5" />
                  <span>Choose a <strong>variant</strong>{gradeless ? '' : ' and grade'} above to start capturing this batch.</span>
                </div>
              )}
            </>
          )}

          {tab === 'checks' && hasChecks && (
            <ChecksPanel
              sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId} locked={locked}
              operators={candidateOps}
              variant={active?.variant ?? ''} grade={active?.grade ?? 'A'}
              massBalance={{ totalIn: rt.totalIn, totalOut: rt.totalOut, variance: rtVariance, withinTol: rtWithinTol }}
              running={totalIn > 0} active={status !== 'submitted' && status !== 'approved'}
            />
          )}

          {tab === 'cleaning' && (
            <CleaningPanel
              sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId} locked={locked}
              operators={candidateOps}
              viewer={cleanerActor ? 'cleaner' : 'operator'}
              presignedActor={cleanerActor}
              onSigned={cleanerActor ? () => { setCleanerActor(null); setTab('production') } : undefined}
            />
          )}

          {tab === 'overview' && (
            <>
              <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
                <Info size={14} className="shrink-0 mt-0.5" />
                <span>{runId ? 'Totals are combined across the whole production run (all shifts), grouped by product, variant and grade.' : 'Totals are grouped and combined across both shifts where variant and grade match.'} Copy or print for Acumatica data entry.</span>
              </div>
              <CaptureOverview
                productions={[
                  // Tagged with which shift each batch belongs to — Sieving's
                  // bucket-elevator figure means opposite things on the two
                  // shifts (morning consumes last night's carry-over, afternoon
                  // leaves a new one for tomorrow) and must never be summed as
                  // if it were one figure. See CaptureOverview's debag grouping.
                  ...productions.map(p => ({ ...p, shift: shiftBal })),
                  ...siblingProductions.map(p => ({ ...p, shift: shiftBal })),
                  ...otherShiftProductions.map(p => ({ ...p, shift: otherShiftBal })),
                ]}
                sectionId={sectionId}
                sectionName={meta.name}
                sectionColor={meta.colorHex}
                date={dateParam}
                shift={shift}
                showSerials={isIT}
                productionOrders={assignment?.production_orders}
                locked={locked}
                balanceRows={balanceRows}
                balanceNote={balanceNote}
                blenderRatios={blenderRatios}
              />
            </>
          )}

          {tab === 'signoff' && (
            <SignOff
              status={status} locked={locked} canApprove={canApprove}
              operatorName={verifiedOp ? (verifiedOp.display_name || verifiedOp.name) : (opNames[0] ?? '')}
              balanceRows={balanceRows} balanceTolerance={massBalanceToleranceFor(sectionId)} balanceNote={balanceNote}
              sessionId={sessionId} operatorId={verifiedOp?.user_id ?? user?.id ?? null}
              sectionId={sectionId} date={dateParam} shift={shift}
              comments={comments} onComments={setComments}
              hasRun={!!runId} endOfRun={endOfRun} onEndOfRun={setEndOfRun}
              onSign={storeSignature} onSubmit={handleSubmit} onApprove={handleApprove} submitting={submitting}
              // Every distinct item code this session actually captured — Blender's
              // ingredient/product-type fields are searched from Master Inventory
              // rather than picked off a fixed list, so a typo or a wrong pick is a
              // real possibility. Non-empty only for Blender/Small Blender.
              capturedCodes={isBlenderRun
                ? Array.from(new Map(
                    productions.flatMap(p => blenderCapturedCodes(p.data as BlenderData).map(c => [c.code || c.label, c] as const))
                  ).values())
                : []}
            />
          )}

          {tab === 'messages' && (
            <LineChat
              channel={sectionId}
              // Author is always whoever is SIGNED IN (not the section's assigned
              // operator) — a message is attributed to the person who actually
              // typed it, matching every other notification in the app.
              meName={displayName || user?.email?.split('@')[0] || 'Unknown'}
              meId={user?.id ?? null}
              meRole={role ? role.replace(/_/g, ' ') : null}
              title={`${meta.name} · line messages`}
            />
          )}

          {error && <p className="text-[12px] text-err px-1">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ── Sign-off tab ──────────────────────────────────────────────────────────────
function SignOff({ status, locked, canApprove, operatorName, balanceRows, balanceTolerance, balanceNote, sessionId, operatorId, sectionId, date, shift, comments, onComments, hasRun, endOfRun, onEndOfRun, onSign, onSubmit, onApprove, submitting, capturedCodes }: {
  status: string; locked: boolean; canApprove: boolean; operatorName: string
  balanceRows: BalanceRow[]; balanceTolerance: number; balanceNote?: string
  sessionId: string | null; operatorId: string | null; sectionId: string; date: string; shift: string
  comments: string; onComments: (v: string) => void
  hasRun: boolean; endOfRun: boolean; onEndOfRun: (v: boolean) => void
  onSign: (role: 'operator' | 'supervisor', name: string, sig: string) => Promise<void>
  onSubmit: () => void; onApprove: () => void; submitting: boolean
  capturedCodes: CapturedCode[]
}) {
  const [opName, setOpName]   = useState(operatorName)
  const [opSig, setOpSig]     = useState(false)
  const [tsConfirmed, setTsConfirmed] = useState(false)
  const [codesConfirmed, setCodesConfirmed] = useState(false)
  const needsCodeConfirm = capturedCodes.length > 0

  // Supervisor approval is "Verify & Sign" against their own Staff Directory
  // signature (same as job cards) — no name field, no hand-drawn signature.
  const [sigStatus, setSigStatus] = useState<MySignatureStatus | null>(null)
  useEffect(() => { if (canApprove) getMySignatureStatus().then(setSigStatus) }, [canApprove])

  return (
    <div className="space-y-5">
      {(status === 'new' || status === 'draft') && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>Check your totals below, then sign your name and tap submit. Your supervisor approves and locks it after.</span>
        </div>
      )}
      {/* Mass balance — same table as the Production tab, so sign-off never
          shows this figure in a different shape than what was already seen
          while capturing. */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4">
        <MassBalanceTable rows={balanceRows} tolerance={balanceTolerance} note={balanceNote} />
      </div>

      {/* Auto-derived timesheet — operator confirms (with light edits) at sign-off */}
      <TimesheetConfirm
        sessionId={sessionId} operatorName={opName || operatorName} operatorId={operatorId}
        sectionId={sectionId} date={date} shift={shift}
        locked={locked || status === 'submitted' || status === 'approved'}
        onConfirmedChange={setTsConfirmed}
      />

      {/* Operator sign-off — only while still being captured (draft/new) */}
      {(status === 'new' || status === 'draft') && (
        <>
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Handover note for the next shift</span>
            <textarea value={comments} onChange={e => onComments(e.target.value)} disabled={locked} rows={2}
              placeholder="Anything the next operator or supervisor should know (optional)…"
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none" />
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Operator sign-off</span>
            <input value={opName} onChange={e => setOpName(e.target.value)} placeholder="Operator name" disabled={locked}
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand" />
            <SignaturePad label="Operator signature" signed={opSig} disabled={locked || !opName.trim()}
              onSign={async sig => { await onSign('operator', opName.trim(), sig); setOpSig(true) }} />
          </div>
          {opSig && !tsConfirmed && (
            <p className="text-[12px] text-warn flex items-center gap-1.5 px-1"><AlertTriangle size={13} /> Confirm your timesheet above before submitting.</p>
          )}
          {opSig && tsConfirmed && (
            <button onClick={onSubmit} disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} Submit for supervisor sign-off
            </button>
          )}
        </>
      )}

      {/* Submitted — operator's view */}
      {status === 'submitted' && !canApprove && (
        <div className="flex items-center gap-3 px-4 py-3 bg-info/5 border border-info/20 rounded-2xl text-[13px] text-info">
          <CheckCircle2 size={16} className="flex-shrink-0" />
          <span>Submitted — waiting for the supervisor to approve and lock from their dashboard.</span>
        </div>
      )}

      {/* Item codes captured this session — Blender's product-type fields are
          searched from Master Inventory rather than picked off a fixed list,
          so the supervisor reviews every distinct code before it's treated as
          ground truth in the database. Empty (and thus invisible) elsewhere. */}
      {needsCodeConfirm && (status === 'submitted' || status === 'new' || status === 'draft') && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2.5">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Item codes captured this session</span>
          <div className="space-y-1.5">
            {capturedCodes.map(c => (
              <div key={c.code || c.label} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-[12px] ${c.resolved ? 'border-stone-100 bg-stone-50' : 'border-amber-200 bg-amber-50'}`}>
                <span className="text-text truncate">{c.label}</span>
                {c.resolved
                  ? <span className="font-mono text-[11px] text-text-muted shrink-0">{c.code}</span>
                  : <span className="flex items-center gap-1 text-[11px] text-amber-700 font-medium shrink-0"><AlertTriangle size={12} /> code not resolved</span>}
              </div>
            ))}
          </div>
          {status === 'submitted' && canApprove && (
            <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 cursor-pointer">
              <input type="checkbox" checked={codesConfirmed} onChange={e => setCodesConfirmed(e.target.checked)} className="mt-0.5 accent-brand" />
              <span className="text-[12px] text-text-muted"><strong className="text-text">I've checked these item codes are correct.</strong> Once approved, they're treated as the true record.</span>
            </label>
          )}
        </div>
      )}

      {/* Submitted — supervisor approval: "Verify & Sign" against their own
          Staff Directory signature, same pattern as job cards — no name
          field, no hand-drawn signature. */}
      {status === 'submitted' && canApprove && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Supervisor approval</span>
          {hasRun && (
            <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 cursor-pointer">
              <input type="checkbox" checked={endOfRun} onChange={e => onEndOfRun(e.target.checked)} className="mt-0.5 accent-brand" />
              <span className="text-[12px] text-text-muted">
                <strong className="text-text">End of production run.</strong> Tick if this shift finishes the order — the run is closed and won't offer to continue on the next shift. Leave unticked if the same order carries on.
              </span>
            </label>
          )}
          {needsCodeConfirm && !codesConfirmed && (
            <p className="text-[12px] text-warn flex items-center gap-1.5 px-1"><AlertTriangle size={13} /> Confirm the item codes above before approving.</p>
          )}
          {sigStatus && !sigStatus.hasSignature ? (
            <p className="text-[12px] text-warn flex items-start gap-1.5 px-1">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>No signature on file — {sigStatus.employeeId
                ? <Link href={`/production/staff/${sigStatus.employeeId}`} className="underline">set one up on your Staff Directory profile</Link>
                : 'ask IT to link your login to your Staff Directory profile'} before you can approve.</span>
            </p>
          ) : (
            <button onClick={onApprove} disabled={submitting || !sigStatus?.hasSignature || (needsCodeConfirm && !codesConfirmed)}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] disabled:opacity-40">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
              {submitting ? 'Signing…' : `Verify & Sign as ${sigStatus?.employeeName ?? 'you'} to Approve`}
            </button>
          )}
        </div>
      )}

      {locked && (
        <div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl">
          <Lock size={20} className="text-ok" /><span className="font-semibold text-[14px] text-ok">Session signed off and locked.</span>
        </div>
      )}
    </div>
  )
}

// Small help cue mapping grade letters to destinations.
function GradeHelp() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="p-1.5 text-stone-400 hover:text-brand" title="What do A / B / C mean?">
        <HelpCircle size={16} />
      </button>
      {open && (
        <div className="absolute z-20 right-0 mt-1 w-52 bg-white border border-stone-200 rounded-xl shadow-lg p-3 text-[12px] text-text space-y-1">
          <div><span className="font-mono font-semibold">A</span> — Export</div>
          <div><span className="font-mono font-semibold">B</span> — Export Blend</div>
          <div><span className="font-mono font-semibold">C</span> — Domestic / Local</div>
        </div>
      )}
    </div>
  )
}

// ── 16h00 shift-changeover PIN gate ─────────────────────────────────────────────
// Blocks capture on a still-open morning session until the incoming operator
// confirms by PIN, so the audit trail records who captured after the hand-over.
function ChangeoverModal({ sectionName, hasRoster, onConfirm, onBack }: {
  sectionName: string
  hasRoster: boolean
  onConfirm: (pin: string) => Promise<boolean>
  onBack: () => void
}) {
  const [pin, setPin]   = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)

  async function submit() {
    if (pin.length < 4) return
    setBusy(true); setErr(null)
    try {
      const ok = await onConfirm(pin)
      if (!ok) { setErr('PIN not recognised. Check you are rostered for the afternoon shift.'); setPin('') }
    } catch (e: any) { setErr(e?.message || 'Something went wrong — try again.') }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><Lock size={18} className="text-brand" /></div>
          <div className="min-w-0">
            <div className="font-semibold text-[16px] text-text leading-tight">Shift changed — confirm who’s capturing</div>
            <div className="text-[12px] text-text-muted mt-0.5">It’s past 16h00 on {sectionName}.</div>
          </div>
        </div>
        <p className="text-[12px] text-text-muted">
          {hasRoster
            ? 'Enter your operator PIN to take over capture. This records who captured from now on.'
            : 'No afternoon operators are rostered for this section yet — any active operator’s PIN will be recorded.'}
        </p>
        <input
          type="password" inputMode="numeric" maxLength={6} autoFocus
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(null) }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Enter PIN"
          className="w-full px-3 py-3 rounded-xl border border-stone-200 bg-white text-center font-mono tracking-[0.4em] text-[18px] outline-none focus:border-brand"
        />
        {err && <p className="text-[12px] text-err flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> {err}</p>}
        <button onClick={submit} disabled={busy || pin.length < 4}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white font-semibold text-[14px] disabled:opacity-40 hover:bg-brand-mid transition-colors">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Confirm &amp; continue
        </button>
        <button onClick={onBack} className="w-full text-[12px] text-stone-400 hover:text-stone-600">Back to sections</button>
      </div>
    </div>
  )
}

// ── Early-submit changeover prompt ──────────────────────────────────────────────
// Shown when a morning operator submits before 15h30 having already run 2+ POs.
// "Yes" logs the changeover as a handover note and submits; "No" just submits
// (a genuine early end of shift). Either way the operator is signed out and the
// incoming afternoon/night operator starts fresh on a new record.
function ChangeoverSubmitModal({ sectionName, onAnswer, onCancel }: {
  sectionName: string
  onAnswer: (changeover: boolean) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const answer = (v: boolean) => { setBusy(true); onAnswer(v) }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><ArrowRight size={18} className="text-brand" /></div>
          <div className="min-w-0">
            <div className="font-semibold text-[16px] text-text leading-tight">Is there a changeover?</div>
            <div className="text-[12px] text-text-muted mt-0.5">Submitting {sectionName} early, with more than one order run.</div>
          </div>
        </div>
        <p className="text-[12px] text-text-muted">
          Is the afternoon/night shift taking over this line, or is this the end of production for the day?
        </p>
        <button onClick={() => answer(true)} disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white font-semibold text-[14px] disabled:opacity-40 hover:bg-brand-mid transition-colors">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} Yes — the next shift takes over
        </button>
        <button onClick={() => answer(false)} disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-white text-text font-medium text-[14px] disabled:opacity-40 hover:bg-stone-50 transition-colors">
          <CheckCircle2 size={16} /> No — production finished for today
        </button>
        <button onClick={onCancel} disabled={busy} className="w-full text-[12px] text-stone-400 hover:text-stone-600 disabled:opacity-40">Keep capturing</button>
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>}>
      <CaptureScreen />
    </Suspense>
  )
}

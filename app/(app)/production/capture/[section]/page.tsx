'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, useParams } from 'next/navigation'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import {
  ChevronLeft, Loader2, CheckCircle2, AlertTriangle, Users, Lock,
  ClipboardList, PenLine, Save, Sparkles, Info, Plus, Gauge, HelpCircle,
  FileText, Check, ArrowRight,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SignaturePad } from '@/components/production/capture/SignaturePad'
import { TimesheetConfirm } from '@/components/production/capture/TimesheetConfirm'
import {
  SievingCapture, emptySievingData, sievingTotals,
  type SievingData, type Shift,
} from '@/components/production/capture/SievingCapture'
import { MassBalanceTable } from '@/components/production/capture/MassBalanceTable'
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
import { CleaningPanel } from '@/components/production/capture/CleaningPanel'
import { ChecksPanel } from '@/components/production/capture/ChecksPanel'
import { ChecksStatusStrip } from '@/components/production/capture/ChecksStatusStrip'
import { HourlyVsdPrompt } from '@/components/production/capture/HourlyVsdPrompt'
import { CaptureOverview, type BlenderRatioGroup } from '@/components/production/capture/CaptureOverview'
import { getBlendComponents, groupComponentsByItem, type BlendIngredientGroup } from '@/lib/production/bom'
import { ensureCheckRecord, appendCheckEvent, loadCheckRecord } from '@/lib/production/checks-db'
import { sectionMeta, makeSerial, MASS_BALANCE_TOLERANCE_KG, VARIANT_OPTIONS, variantToShort, DESTINATION_OPTIONS } from '@/lib/production/capture-config'
import { LineChat } from '@/components/production/capture/LineChat'
import type { Operator, ShiftAssignment } from '@/lib/supabase/database.types'
import { MessageSquare } from 'lucide-react'

type Tab = 'production' | 'checks' | 'cleaning' | 'overview' | 'signoff' | 'messages'
// Comma decimals (SA devices) normalised to a period so the DB stores a real decimal.
const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0

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

// A shift can contain several productions, each its own variant/destination/lot.
interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData | RefiningData | GranuleData | BlenderData }
// Variant comes from the assignment when a supervisor set one; grade is always a
// deliberate choice on the floor. Both start blank when unknown so the operator
// must pick them — capture never silently defaults to Export / Conventional.
const emptyProduction = (sectionId: string, variant?: string | null, lot?: string | null, grade: string = ''): Production =>
  ({ id: crypto.randomUUID(), variant: variant || '', grade, lot: lot || '',
     data: sectionId.startsWith('refining') ? emptyRefiningData()
       : sectionId === 'granule' ? emptyGranuleData()
       : isBlenderSection(sectionId) ? emptyBlenderData()
       : emptySievingData() })

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
    return false
  })
}

function CaptureScreen() {
  const params = useParams()
  const sp     = useSearchParams()
  const router = useRouter()
  const { user, role, isSupervisor, isIT, signOut } = useAuth()

  const sectionId = (params.section as string) ?? ''
  // Grade-driven sections (Sieving) need a grade chosen per batch; Refining and
  // Granule are variant-only — traceability there comes from the system serials.
  // Blender's Export/Export Blend/Domestic field lives per input row (matching the
  // paper form), not as one whole-production Grade like Sieving — so it's gradeless too.
  const gradeless = sectionId.startsWith('refining') || sectionId === 'granule' || isBlenderSection(sectionId)
  const shift     = sp.get('shift') ?? 'morning'
  const sessionParam = sp.get('session')   // edit a specific record opened from Production Orders
  // Which shift the bucket elevator carryover belongs to (afternoon = output,
  // otherwise input), and the opposite shift whose capture we merge for the run.
  const shiftBal: Shift   = shift === 'afternoon' ? 'afternoon' : 'morning'
  const otherShiftBal: Shift = shiftBal === 'morning' ? 'afternoon' : 'morning'
  const dateParam = sp.get('date')  ?? format(new Date(), 'yyyy-MM-dd')
  const meta      = sectionMeta(sectionId)
  const canApprove = isSupervisor || isIT || role === 'admin'

  const [loading, setLoading]     = useState(true)
  const [assignment, setAssignment] = useState<ShiftAssignment | null>(null)
  const [opNames, setOpNames]     = useState<string[]>([])
  const [rosterOps, setRosterOps] = useState<{ id: string; name: string; pin: string }[]>([])
  const [verifiedOp, setVerifiedOp] = useState<Operator | null>(null)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus]       = useState<'new' | 'draft' | 'submitted' | 'approved'>('new')
  const [productions, setProductions] = useState<Production[]>([])
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
  const [comments, setComments]   = useState('')          // operator handover note → prod_sessions.comments
  const [prevNote, setPrevNote]   = useState<{ note: string; shift: string; date: string } | null>(null)
  const [tab, setTab]             = useState<Tab>(() => {
    const t = sp.get('tab')
    return (['production', 'checks', 'cleaning', 'overview', 'signoff', 'messages'] as const).includes(t as Tab) ? (t as Tab) : 'production'
  })
  const [variantMismatch, setVariantMismatch] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checksSigned, setChecksSigned] = useState(false)   // start-up/checks done for this shift
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

  const active = productions[activeIdx]
  const updateActiveData = (d: SievingData | RefiningData | GranuleData | BlenderData) =>
    setProductions(ps => ps.map((p, i) => i === activeIdx ? { ...p, data: d } : p))

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
      // being edited right now.
      const { data: shiftSess } = await db.schema('production').from('prod_sessions')
        .select('id,status,draft_data,comments,created_at')
        .eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift)
        .order('created_at', { ascending: false })
      const shiftRows = (shiftSess as any[]) ?? []
      const sess = sessionParam ? (shiftRows.find(r => r.id === sessionParam) ?? null) : (shiftRows[0] ?? null)
      const siblingRows = shiftRows.filter(r => r.id !== sess?.id)
      setSiblingProductions(siblingRows.flatMap(r => (r.draft_data?.productions ?? []) as Production[]))
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
        if (!sp.get('tab') && fresh && !signed) setTab('checks')
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

  // Keep the checks-done signal fresh as the operator moves between tabs — after
  // they sign checks (in the Checks tab) the Capture gate and stepper tick update.
  useEffect(() => {
    loadCheckRecord(sectionId, dateParam, shift)
      .then(({ record }) => setChecksSigned(!!record && record.status !== 'in_progress'))
      .catch(() => {})
  }, [tab, sectionId, dateParam, shift])

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
    if (sid && persistRef.current) { try { await persistRef.current(productionsRef.current, sid) } catch {} }
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
  // The run discriminator stored in the run's `grade` column: the chosen grade on
  // grade-driven sections, the product item (SG / SF / Export) for Granule, or the
  // blend code for Blender/Small Blender (BlenderData.bomId — owned by the
  // production, not the shift assignment). A run therefore continues across
  // shifts/batches while variant + item/blend stay the same, and forks the moment
  // the operator switches product/blend — exactly as the paper works, and exactly
  // what lets an operator pick a *different* blend mid-shift and get a genuinely
  // separate, separately-tracked production run instead of silently merging into
  // whatever run happened to be open.
  const runGrade = (p?: Production) =>
    isGranule ? ((p?.data as GranuleData)?.item || '')
    : isBlenderRun ? ((p?.data as BlenderData)?.bomId || '')
    : (p?.grade || '')
  // The PO anchor: the assignment's planned production orders, joined so it
  // compares identically across shifts (supervisor sets the same POs each shift).
  const poKey = (assignment?.production_orders ?? []).join(',') || null

  async function findOpenRun(po: string | null, variant: string, grade: string) {
    const gradeKey = (needsGrade || isGranule || isBlenderRun) ? (grade || null) : null
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
      grade: (needsGrade || isGranule || isBlenderRun) ? (grade || null) : null,
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
      const existingRunNo = await resolveExistingBlendRunNo(cr.grade)
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

  // Flip the block on at 16h00 while the session is still being captured.
  useEffect(() => {
    if (takenOver) { setChangeoverNeeded(false); return }
    const check = () => {
      const done = status === 'submitted' || status === 'approved'
      setChangeoverNeeded(pastChangeover() && !done)
    }
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, dateParam, status, takenOver])

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
      if (sectionId.startsWith('refining')) {
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
      } else if (sectionId === 'granule') {
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
      } else if (isBlenderSection(sectionId)) {
        const bd = prod.data as BlenderData
        ;(bd.inputs ?? []).forEach(r => {
          if (n(r.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++,
            bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
            production_ref: bd.bomId || null,
            local_or_export: r.destination || null,
            notes: r.inputMode === 'manual' ? r.serial : null,
            lot_number: r.lot || prod.lot || null,
            product_type: r.productType || null, variant: r.variant || prod.variant || null,
            kg_nett: n(r.weight), is_spillage: false,
          })
        })
      } else {
        const sd = prod.data as SievingData
        sd.spillage.forEach(r => {
          if (n(r.kg) === 0) return
          rows.push({ session_id: sid, bag_no: bagNo++, product_type: 'Bucket Elevator', variant: prod.variant, kg_nett: n(r.kg), is_spillage: true })
        })
        sd.debag.forEach(r => {
          if (n(r.nett) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++,
            // bag_serial_no is a FK to bag_tags — farm bags aren't in bag_tags, so null it.
            // Preserve the operator's physical bag number in notes for traceability.
            bag_serial_no: null, notes: r.bag_no || null,
            lot_number: r.lot || prod.lot || null,
            product_type: '500kg Farm Bag', variant: prod.variant, grade: prod.grade || null,
            kg_gross: n(r.gross) || null, kg_nett: n(r.nett),
            delivery_date: r.delivery_date || null, local_or_export: r.local_export || null,
            is_spillage: false,
          })
        })
      }
    })
    return rows
  }
  function buildBag(prods: Production[], sid: string) {
    const rows: any[] = []
    let bagNo = 1
    prods.forEach(prod => {
      if (sectionId.startsWith('refining')) {
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
            })
          })
        })
      } else if (sectionId === 'granule') {
        const gd = prod.data as GranuleData
        ;(gd.outputs ?? []).forEach(b => {
          if (n(b.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: null,
            bag_serial_no: b.serial, lot_number: b.lot || prod.lot || null,
            product_type: b.item, acumatica_id: b.code || null, variant: prod.variant,
            kg: n(b.weight), bagging_time: b.time || null,
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
      } else if (isBlenderSection(sectionId)) {
        const bd = prod.data as BlenderData
        const bomId = bd.bomId
        ;(bd.outputs ?? []).forEach(b => {
          if (n(b.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: null,
            bag_serial_no: b.serial, lot_number: prod.lot || null,
            production_ref: bomId || null,
            product_type: bomId ? `Blend ${bomId}` : null, acumatica_id: bomId || null, variant: prod.variant,
            kg: n(b.weight), bagging_time: b.time || null,
          })
        })
      } else {
        const sd = prod.data as SievingData
        sd.outputs.forEach(b => {
          if (n(b.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: 'B',
            bag_serial_no: b.serial, lot_number: b.batch || prod.lot || null, product_type: b.productType,
            acumatica_id: b.code || null, variant: prod.variant,
            kg: n(b.weight),
          })
        })
      }
    })
    return rows
  }
  // Per-production totals — dispatches by section type. `sh` is the shift the
  // production belongs to; Sieving uses it to place the bucket elevator on the
  // input (morning) or output (afternoon) side of the balance.
  function prodTotals(p: Production, sh: Shift = shiftBal): { totalIn: number; totalOut: number } {
    if (sectionId.startsWith('refining')) {
      const r = refiningTotals(p.data as RefiningData)
      return { totalIn: r.totalIn, totalOut: r.totalA + r.totalB + r.totalC + r.totalD }
    }
    if (sectionId === 'granule') {
      const g = granuleTotals(p.data as GranuleData)
      // A (raw dust mixed) vs G (total produced) — mirrors the PR-FM-026/7 balance H − G.
      return { totalIn: g.totalA, totalOut: g.G }
    }
    if (isBlenderSection(sectionId)) {
      const b = blenderTotals(p.data as BlenderData)
      return { totalIn: b.totalIn, totalOut: b.totalOut }
    }
    return sievingTotals(p.data as SievingData, sh)
  }
  // Session totals — summed across all productions on one shift.
  function sessionTotals(prods: Production[], sh: Shift = shiftBal) {
    return prods.reduce((acc, p) => {
      const t = prodTotals(p, sh)
      return { totalIn: acc.totalIn + t.totalIn, totalOut: acc.totalOut + t.totalOut }
    }, { totalIn: 0, totalOut: 0 })
  }

  // Core persistence — writes draft_data + structured rows + mass balance.
  // Used by the explicit Save, the 30s autosave, and submit, so prod_debagging /
  // prod_bagging are always current and nothing is lost on the inactivity sign-out.
  async function persist(prods: Production[], sid: string) {
    const { totalIn } = sessionTotals(prods, shiftBal)
    const db = getDb()

    await db.schema('production').from('prod_sessions').update({
      draft_data: { productions: prods } as any, updated_at: new Date().toISOString(),
    } as any).eq('id', sid)

    const debag = buildDebag(prods, sid)
    await db.schema('production').from('prod_debagging').delete().eq('session_id', sid)
    if (debag.length) await db.schema('production').from('prod_debagging').insert(debag as any)

    const bag = buildBag(prods, sid)
    await db.schema('production').from('prod_bagging').delete().eq('session_id', sid)
    if (bag.length) await db.schema('production').from('prod_bagging').insert(bag as any)

    let mbB = 0, mbC = 0, mbD = 0
    if (sectionId.startsWith('refining')) {
      prods.forEach(p => {
        const t = refiningTotals(p.data as RefiningData)
        mbB += t.totalB; mbC += t.totalC; mbD += t.totalD
      })
    } else if (sectionId === 'granule') {
      // Total produced (G) is the single output figure — balance = A − G matches PR-FM-026/7.
      prods.forEach(p => { mbB += granuleTotals(p.data as GranuleData).G })
    } else {
      prods.forEach(p => { mbB += sievingTotals(p.data as SievingData, shiftBal).totalOut })
    }
    await db.schema('production').from('prod_mass_balance').upsert({
      session_id: sid, total_input_kg: totalIn,
      total_output_b_kg: mbB, total_output_c_kg: mbC, total_output_d_kg: mbD,
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
        const hasData = totalIn > 0 || mbB > 0 || mbC > 0 || mbD > 0
        // Blender is gradeless for the UI's per-batch Grade dropdown, but its run
        // discriminator (the blend code, via runGrade) is just as real as Sieving's
        // grade — a run must not open before a blend is actually chosen.
        if (hasData && variant && (gradeless && !isBlenderRun ? true : !!grade)) {
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
            .select('total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg').in('session_id', ids)
          let tin = 0, tout = 0
          ;((mbs as any[]) ?? []).forEach(m => {
            tin  += Number(m.total_input_kg) || 0
            tout += (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0)
          })
          await db.schema('production').from('production_runs')
            .update({ total_input_kg: tin, total_output_kg: tout, updated_at: new Date().toISOString() } as any).eq('id', rid)
        }
      }
    } catch { /* run linking/rollup is best-effort — never blocks the core save */ }
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

  async function handleSubmit() {
    await saveDraft()
    setSubmitting(true)
    try {
      const sid = await ensureSession()
      await getDb().schema('production').from('prod_sessions').update({
        status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        comments: comments.trim() || null,
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

  async function handleApprove() {
    setSubmitting(true)
    try {
      await getDb().schema('production').from('prod_sessions').update({
        status: 'approved', updated_at: new Date().toISOString(),
      } as any).eq('id', sessionId)
      // Close the run if the supervisor marked this as the end of the production run.
      if (endOfRun && runId) {
        await getDb().schema('production').from('production_runs')
          .update({ status: 'closed', closed_at: new Date().toISOString() } as any).eq('id', runId)
      }
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
        <button onClick={() => router.push('/production/capture')} className="text-[12px] text-brand hover:underline">← Back</button>
      </div>
    )
  }

  if (!meta.built) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 px-4 text-center">
        <ClipboardList size={24} className="text-stone-400" />
        <p className="text-[14px] font-medium text-text">{meta.name} capture is coming soon</p>
        <p className="text-[12px] text-text-muted max-w-sm">The Sieving Tower flow is the proven template; this section will follow the same pattern.</p>
        <button onClick={() => router.push('/production/capture')} className="text-[12px] text-brand hover:underline">← Back</button>
      </div>
    )
  }

  const locked = status === 'approved'
  const at = active ? prodTotals(active) : { totalIn: 0, totalOut: 0 }
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
  const rt = runSpansShifts
    ? { totalIn: st.totalIn + ot.totalIn, totalOut: st.totalOut + ot.totalOut }
    : st
  const rtVariance  = rt.totalIn - rt.totalOut
  const rtWithinTol = Math.abs(rtVariance) <= MASS_BALANCE_TOLERANCE_KG
  const multi = productions.length > 1
  // Rows for the tabular balance — only shifts that actually captured material.
  const balanceRows = [
    (morningTotals.totalIn > 0 || morningTotals.totalOut > 0) ? { shift: 'Morning' as const, ...morningTotals } : null,
    (afternoonTotals.totalIn > 0 || afternoonTotals.totalOut > 0) ? { shift: 'Afternoon' as const, ...afternoonTotals } : null,
  ].filter(Boolean) as { shift: 'Morning' | 'Afternoon'; totalIn: number; totalOut: number }[]
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

  // Sign-off candidates: a person-logged-in tablet has a single verified operator;
  // a section/machine tablet resolves the signer from the rostered operators by PIN.
  const candidateOps = verifiedOp
    ? [{ id: verifiedOp.id, name: verifiedOp.display_name || verifiedOp.name, pin: verifiedOp.pin ?? '' }]
    : rosterOps

  function updateActiveMeta(key: 'variant' | 'lot' | 'grade', val: string) {
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
        unit: 'kg', status: Math.abs(prev.totalIn - prev.totalOut) <= MASS_BALANCE_TOLERANCE_KG ? 'ok' : 'flagged',
        production_idx: activeIdx, source: 'auto',
      })
    } catch { /* snapshot is best-effort */ }
    setProductions(ps => [...ps, emptyProduction(sectionId, null, assignment?.lot_number)])
    setActiveIdx(productions.length)
    setTab('production')
  }

  // Start a fresh batch record for the next variant/grade after the current one is
  // submitted/locked. LAZY — reset local state only; the new prod_sessions row is
  // created on the first real capture (ensureSession, gated by hasCaptureData). This
  // is what stops an abandoned "start new batch record" from leaving an empty
  // "No data" session behind (the duplicate-orders bug).
  function startNewProduction() {
    const aL = assignment?.lot_number ?? ''
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
          onBack={() => router.push('/production/capture')}
        />
      )}

      {/* Hourly infeed-VSD prompt — auto-pops every hour while the line runs,
          and stays available after checks are signed (page-level, not in the
          Checks tab). Only sections with an hourly VSD check surface it.
          Suppressed on the Overview tab — that's a "just reading" view (often
          reached from a supervisor's production-order review), and a modal
          popping up over someone reading the AI summary rather than actually
          operating the line reads as a bug, not a reminder. */}
      {tab !== 'overview' && (
        <HourlyVsdPrompt
          sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId}
          running={totalIn > 0}
          active={status !== 'submitted' && status !== 'approved'}
          operator={verifiedOp ? { id: verifiedOp.id, name: verifiedOp.display_name || verifiedOp.name } : null}
        />
      )}

      {/* Header — section-tinted band */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 flex-shrink-0 border-b border-stone-100"
        style={{ background: `linear-gradient(180deg, ${meta.colorHex}12, transparent)` }}>
        <button onClick={() => router.push('/production/capture')} className="p-2 -ml-1 rounded-lg hover:bg-black/5 text-stone-500"><ChevronLeft size={18} /></button>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm" style={{ background: meta.colorHex }}>
          <span className="font-mono font-bold text-[12px] text-white">{meta.code}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[20px] text-text leading-tight">{meta.name}</h1>
          <p className="text-[11px] text-text-muted mt-0.5 truncate">
            <span className="capitalize">{shift} shift</span> · {format(parseISO(dateParam + 'T12:00:00'), 'd MMM')}
            {opNames.length ? <> · {opNames.join(', ')}</> : null}
          </p>
        </div>
        <button onClick={() => setTab('messages')} title="Line messages"
          className={`p-2 rounded-lg shrink-0 transition-colors ${tab === 'messages' ? 'bg-brand/10 text-brand' : 'text-stone-400 hover:bg-black/5 hover:text-stone-600'}`}>
          <MessageSquare size={18} />
        </button>
        <span className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-full shrink-0 ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Process stepper — the steps the operators actually work through, in order.
          Clickable so they can jump around; current step is highlighted, earlier
          steps read as done. Messages lives in the header, not the flow. */}
      <div className="flex items-center px-3 sm:px-4 py-3 flex-shrink-0 bg-white border-b border-stone-200 overflow-x-auto">
        {STEPS.map((s, i) => {
          const activeIdxStep = STEPS.findIndex(x => x.id === tab)
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
              {i < STEPS.length - 1 && (
                <div className={`w-6 sm:w-10 h-px mx-1.5 sm:mx-2.5 ${activeIdxStep > i ? 'bg-brand/40' : 'bg-stone-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-surface)' }}>
        <div className="px-4 py-5 max-w-[800px] space-y-5">
          {/* Handover note from the previous shift on this line */}
          {prevNote && tab !== 'messages' && (
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
              {!locked && !checksSigned && (
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

              {!locked && checksSigned && (
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
                    <select value={active.variant} disabled={locked} onChange={e => updateActiveMeta('variant', e.target.value)}
                      className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-brand cursor-pointer ${active.variant ? 'border-stone-200 text-text' : 'border-amber-300 text-stone-400'}`}>
                      <option value="" disabled>Select variant…</option>
                      {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                  {!gradeless && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Grade</label>
                      <select value={active.grade} disabled={locked} onChange={e => updateActiveMeta('grade', e.target.value)}
                        className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-brand cursor-pointer ${active.grade ? 'border-stone-200 text-text' : 'border-amber-300 text-stone-400'}`}>
                        <option value="" disabled>Select grade…</option>
                        {DESTINATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/* Granule's balance is custom and lives in one place only — the
                    Overview. Other sections show the quick balance here too. */}
                {rt.totalIn > 0 && sectionId !== 'granule' && (
                  <div className="pt-3 border-t border-stone-100">
                    <MassBalanceTable rows={balanceRows} tolerance={MASS_BALANCE_TOLERANCE_KG} note={balanceNote} />
                  </div>
                )}
              </div>

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
                      />
                  }
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

          {tab === 'checks' && (
            <ChecksPanel
              sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId} locked={locked}
              operators={candidateOps}
              variant={active?.variant ?? ''} grade={active?.grade ?? 'A'}
              massBalance={{ totalIn: rt.totalIn, totalOut: rt.totalOut, variance: rtVariance, withinTol: rtWithinTol }}
            />
          )}

          {tab === 'cleaning' && (
            <CleaningPanel
              sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId} locked={locked}
              operators={candidateOps}
            />
          )}

          {tab === 'overview' && (
            <>
              <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
                <Info size={14} className="shrink-0 mt-0.5" />
                <span>{runId ? 'Totals are combined across the whole production run (all shifts), grouped by product, variant and grade.' : 'Totals are grouped and combined across both shifts where variant and grade match.'} Copy or print for Acumatica data entry.</span>
              </div>
              <CaptureOverview
                productions={[...productions, ...siblingProductions, ...otherShiftProductions]}
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
              variance={rtVariance} withinTol={rtWithinTol} totalIn={rt.totalIn} totalOut={rt.totalOut}
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
              meName={verifiedOp ? (verifiedOp.display_name || verifiedOp.name) : (opNames[0] ?? 'Operator')}
              meId={verifiedOp?.user_id ?? user?.id ?? null}
              meRole="Operator"
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
function SignOff({ status, locked, canApprove, operatorName, variance, withinTol, totalIn, totalOut, sessionId, operatorId, sectionId, date, shift, comments, onComments, hasRun, endOfRun, onEndOfRun, onSign, onSubmit, onApprove, submitting, capturedCodes }: {
  status: string; locked: boolean; canApprove: boolean; operatorName: string
  variance: number; withinTol: boolean; totalIn: number; totalOut: number
  sessionId: string | null; operatorId: string | null; sectionId: string; date: string; shift: string
  comments: string; onComments: (v: string) => void
  hasRun: boolean; endOfRun: boolean; onEndOfRun: (v: boolean) => void
  onSign: (role: 'operator' | 'supervisor', name: string, sig: string) => Promise<void>
  onSubmit: () => void; onApprove: () => void; submitting: boolean
  capturedCodes: CapturedCode[]
}) {
  const [opName, setOpName]   = useState(operatorName)
  const [supName, setSupName] = useState('')
  const [opSig, setOpSig]     = useState(false)
  const [supSig, setSupSig]   = useState(false)
  const [tsConfirmed, setTsConfirmed] = useState(false)
  const [codesConfirmed, setCodesConfirmed] = useState(false)
  const needsCodeConfirm = capturedCodes.length > 0

  return (
    <div className="space-y-5">
      {(status === 'new' || status === 'draft') && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>Check your totals below, then sign your name and tap submit. Your supervisor approves and locks it after.</span>
        </div>
      )}
      {/* Mass balance summary */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
        <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Mass balance{hasRun ? ' · whole production run' : ''}</span>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="font-mono font-bold text-[18px] text-text">{totalIn.toFixed(1)}</div><div className="text-[10px] text-text-muted">kg in</div></div>
          <div><div className="font-mono font-bold text-[18px] text-text">{totalOut.toFixed(1)}</div><div className="text-[10px] text-text-muted">kg out</div></div>
          <div><div className={`font-mono font-bold text-[18px] ${withinTol ? 'text-ok' : 'text-warn'}`}>{variance > 0 ? '+' : ''}{variance.toFixed(1)}</div><div className="text-[10px] text-text-muted">variance</div></div>
        </div>
        {!withinTol && (
          <p className="text-[11px] text-warn flex items-center gap-1.5"><AlertTriangle size={12} /> Outside {MASS_BALANCE_TOLERANCE_KG} kg tolerance — review before submitting</p>
        )}
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

      {/* Submitted — supervisor approval (signature + lock) */}
      {status === 'submitted' && canApprove && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Supervisor approval</span>
          <input value={supName} onChange={e => setSupName(e.target.value)} placeholder="Supervisor name"
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand" />
          {hasRun && (
            <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-stone-200 bg-stone-50 cursor-pointer">
              <input type="checkbox" checked={endOfRun} onChange={e => onEndOfRun(e.target.checked)} className="mt-0.5 accent-brand" />
              <span className="text-[12px] text-text-muted">
                <strong className="text-text">End of production run.</strong> Tick if this shift finishes the order — the run is closed and won't offer to continue on the next shift. Leave unticked if the same order carries on.
              </span>
            </label>
          )}
          <SignaturePad label="Supervisor signature" signed={supSig} disabled={!supName.trim()}
            onSign={async sig => { await onSign('supervisor', supName.trim(), sig); setSupSig(true) }} />
          {supSig && needsCodeConfirm && !codesConfirmed && (
            <p className="text-[12px] text-warn flex items-center gap-1.5 px-1"><AlertTriangle size={13} /> Confirm the item codes above before approving.</p>
          )}
          {supSig && (!needsCodeConfirm || codesConfirmed) && (
            <button onClick={onApprove} disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] disabled:opacity-40">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />} Approve &amp; lock
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

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>}>
      <CaptureScreen />
    </Suspense>
  )
}

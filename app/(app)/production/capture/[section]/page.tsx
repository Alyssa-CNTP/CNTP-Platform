'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, useParams } from 'next/navigation'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import {
  ChevronLeft, Loader2, CheckCircle2, AlertTriangle, Users, Lock,
  ClipboardList, PenLine, Save, Sparkles, Info, Plus, Gauge, HelpCircle,
  FileText, Check, Scale, ArrowRight,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SignaturePad } from '@/components/production/capture/SignaturePad'
import { TimesheetConfirm } from '@/components/production/capture/TimesheetConfirm'
import {
  SievingCapture, emptySievingData, sievingTotals,
  type SievingData,
} from '@/components/production/capture/SievingCapture'
import { CleaningPanel } from '@/components/production/capture/CleaningPanel'
import { ChecksPanel } from '@/components/production/capture/ChecksPanel'
import { ChecksStatusStrip } from '@/components/production/capture/ChecksStatusStrip'
import { CaptureOverview } from '@/components/production/capture/CaptureOverview'
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

// A shift can contain several productions, each its own variant/destination/lot.
interface Production { id: string; variant: string; grade: string; lot: string; data: SievingData }
// Variant comes from the assignment when a supervisor set one; grade is always a
// deliberate choice on the floor. Both start blank when unknown so the operator
// must pick them — capture never silently defaults to Export / Conventional.
const emptyProduction = (variant?: string | null, lot?: string | null, grade: string = ''): Production =>
  ({ id: crypto.randomUUID(), variant: variant || '', grade, lot: lot || '', data: emptySievingData() })

function CaptureScreen() {
  const params = useParams()
  const sp     = useSearchParams()
  const router = useRouter()
  const { user, role, isSupervisor, isIT } = useAuth()

  const sectionId = (params.section as string) ?? ''
  const shift     = sp.get('shift') ?? 'morning'
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
  const [comments, setComments]   = useState('')          // operator handover note → prod_sessions.comments
  const [prevNote, setPrevNote]   = useState<{ note: string; shift: string; date: string } | null>(null)
  const [tab, setTab]             = useState<Tab>(() => {
    const t = sp.get('tab')
    return (['production', 'checks', 'cleaning', 'overview', 'signoff', 'messages'] as const).includes(t as Tab) ? (t as Tab) : 'production'
  })
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checksSigned, setChecksSigned] = useState(false)   // start-up/checks done for this shift
  const [error, setError]         = useState<string | null>(null)

  // Serial counter, seeded from existing tags for this section+date
  const seqRef = useRef(0)
  const productionsRef = useRef<Production[]>(productions); productionsRef.current = productions
  const sessionRef = useRef<string | null>(null); sessionRef.current = sessionId
  const lastActivityRef = useRef(0)  // throttle the timesheet heartbeat (ms epoch)
  const persistRef = useRef<((p: Production[], sid: string) => Promise<void>) | null>(null)
  const ensureRef  = useRef<(() => Promise<string>) | null>(null)

  const active = productions[activeIdx]
  const updateActiveData = (d: SievingData) =>
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

      const { data: sess } = await db.schema('production').from('prod_sessions')
        .select('id,status,draft_data,comments').eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
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
        (d.productions as any[]).some((p: any) => p?.data?.debag?.length > 0 || p?.data?.outputs?.length > 0)
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
        if (!recovered) setProductions([emptyProduction(aVariant, aLot)])
      }
      // If DB has no capture data but localStorage does, prefer localStorage —
      // this covers the case where the tablet lost the async Supabase write.
      if (!dbHasData && d?.productions?.length) {
        try {
          const lsRaw = localStorage.getItem(`capture_draft_${sectionId}_${dateParam}_${shift}`)
          if (lsRaw) {
            const ls = JSON.parse(lsRaw)
            if (ls?.productions?.length && ls.productions.some((p: any) => p?.data?.debag?.length > 0 || p?.data?.outputs?.length > 0)) {
              setProductions(ls.productions)
            }
          }
        } catch {}
      }
      if (sess) {
        setSessionId((sess as any).id)
        setStatus((sess as any).status)
      } else if (assign) {
        // Create the draft session immediately so autosave always has a target —
        // nothing is lost if the inactivity timeout signs the operator out.
        const ids = (assign as any).operator_ids ?? []
        let opNm: string[] = []
        if (ids.length) {
          const { data: ops } = await db.schema('production').from('operators').select('id,name,display_name').in('id', ids)
          opNm = (ops as Operator[] ?? []).map(o => o.display_name || o.name)
        }
        const { data: row } = await db.schema('production').from('prod_sessions').insert({
          section_id: sectionId, date: dateParam, shift, status: 'draft',
          operator_names: opNm.length ? opNm : null,
          lot_number: aLot || null, variant: aVariant || null,
          production_orders: (assign as any).production_orders ?? null,
          created_by: user?.id ?? null,
        } as any).select('id').maybeSingle()
        if (row) { setSessionId((row as any).id); setStatus('draft') }
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

      // Load other shift's session so the overview can show combined cross-shift totals.
      try {
        const otherShift = shift === 'morning' ? 'afternoon' : 'morning'
        const { data: otherSess } = await db.schema('production').from('prod_sessions')
          .select('draft_data').eq('section_id', sectionId).eq('date', dateParam).eq('shift', otherShift)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        const otherProds = (otherSess as any)?.draft_data?.productions
        if (Array.isArray(otherProds) && otherProds.length > 0) {
          setOtherShiftProductions(otherProds as Production[])
        }
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
    let sid = sessionRef.current
    if (!sid && ensureRef.current) { try { sid = await ensureRef.current() } catch { return } }
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
    if (sessionId) return sessionId
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
    setSessionId(id)
    return id
  }
  ensureRef.current = ensureSession

  // ── Build structured rows from SievingData ───────────────────────────────
  function buildDebag(prods: Production[], sid: string) {
    const rows: any[] = []
    let bagNo = 1
    prods.forEach(prod => {
      prod.data.spillage.forEach(r => {
        if (n(r.kg) === 0) return
        rows.push({ session_id: sid, bag_no: bagNo++, product_type: 'Bucket Elevator', variant: prod.variant, kg_nett: n(r.kg), is_spillage: true })
      })
      prod.data.debag.forEach(r => {
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
          is_spillage: false, logged_at: r.logged_at || null,
        })
      })
    })
    return rows
  }
  function buildBag(prods: Production[], sid: string) {
    const rows: any[] = []
    let bagNo = 1
    prods.forEach(prod => {
      prod.data.outputs.forEach(b => {
        if (n(b.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++, output_group: 'B',
          bag_serial_no: b.serial, lot_number: b.batch || prod.lot || null, product_type: b.productType,
          acumatica_id: b.code || null, variant: prod.variant, grade: prod.grade || null,
          kg: n(b.weight), logged_at: b.logged_at || null,
        })
      })
    })
    return rows
  }
  // Session totals — summed across all productions.
  function sessionTotals(prods: Production[]) {
    return prods.reduce((acc, p) => {
      const t = sievingTotals(p.data)
      return { totalIn: acc.totalIn + t.totalIn, totalOut: acc.totalOut + t.totalOut }
    }, { totalIn: 0, totalOut: 0 })
  }

  // Core persistence — writes draft_data + structured rows + mass balance.
  // Used by the explicit Save, the 30s autosave, and submit, so prod_debagging /
  // prod_bagging are always current and nothing is lost on the inactivity sign-out.
  async function persist(prods: Production[], sid: string) {
    const { totalIn, totalOut } = sessionTotals(prods)
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

    await db.schema('production').from('prod_mass_balance').upsert({
      session_id: sid, total_input_kg: totalIn, total_output_b_kg: totalOut,
      total_output_c_kg: 0, total_output_d_kg: 0, calculated_at: new Date().toISOString(),
    } as any, { onConflict: 'session_id' })

    const serials = bag.map(b => b.bag_serial_no).filter(Boolean)
    if (serials.length) {
      await db.schema('production').from('bag_tags').update({ session_id: sid } as any).in('serial_number', serials)
    }
  }
  persistRef.current = persist

  async function saveDraft() {
    setSaving(true); setError(null)
    try {
      const sid = await ensureSession()
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
    } catch (e: any) { setError(e.message) }
    setSubmitting(false)
  }

  async function handleApprove() {
    setSubmitting(true)
    try {
      await getDb().schema('production').from('prod_sessions').update({
        status: 'approved', updated_at: new Date().toISOString(),
      } as any).eq('id', sessionId)
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
  const at = active ? sievingTotals(active.data) : { totalIn: 0, totalOut: 0 }
  const totalIn = at.totalIn, totalOut = at.totalOut
  const variance  = totalIn - totalOut
  const withinTol = Math.abs(variance) <= MASS_BALANCE_TOLERANCE_KG
  const st = sessionTotals(productions)
  const stVariance = st.totalIn - st.totalOut
  const stWithinTol = Math.abs(stVariance) <= MASS_BALANCE_TOLERANCE_KG
  const multi = productions.length > 1

  // Sign-off candidates: a person-logged-in tablet has a single verified operator;
  // a section/machine tablet resolves the signer from the rostered operators by PIN.
  const candidateOps = verifiedOp
    ? [{ id: verifiedOp.id, name: verifiedOp.display_name || verifiedOp.name, pin: verifiedOp.pin ?? '' }]
    : rosterOps

  function updateActiveMeta(key: 'variant' | 'lot' | 'grade', val: string) {
    setProductions(ps => ps.map((p, i) => i === activeIdx ? { ...p, [key]: val } : p))
  }
  async function addProduction() {
    // Change-over: snapshot the closing mass balance of the production we're
    // leaving into the append-only checks trail (auto-derived, no typing).
    try {
      const prev = sievingTotals(active!.data)
      const recId = await ensureCheckRecord(sectionId, dateParam, shift, sessionId)
      if (recId) await appendCheckEvent(recId, {
        phase: 'shutdown', check_key: 'mass_balance', check_label: 'Mass balance (change-over)', kind: 'massbalance',
        value_num: prev.totalIn - prev.totalOut, value_text: `${prev.totalIn.toFixed(1)} in / ${prev.totalOut.toFixed(1)} out`,
        unit: 'kg', status: Math.abs(prev.totalIn - prev.totalOut) <= MASS_BALANCE_TOLERANCE_KG ? 'ok' : 'flagged',
        production_idx: activeIdx, source: 'auto',
      })
    } catch { /* snapshot is best-effort */ }
    setProductions(ps => [...ps, emptyProduction(assignment?.variant, assignment?.lot_number)])
    setActiveIdx(productions.length)
    setTab('production')
  }

  // After a session is locked, start a fresh session for the next variant/grade.
  async function startNewProduction() {
    const aV = assignment?.variant ?? ''
    const aL = assignment?.lot_number ?? ''
    const { data: row } = await getDb().schema('production').from('prod_sessions').insert({
      section_id: sectionId, date: dateParam, shift, status: 'draft',
      operator_names: opNames.length ? opNames : null,
      lot_number: aL || null, variant: aV || null,
      production_orders: assignment?.production_orders ?? null, created_by: user?.id ?? null,
    } as any).select('id').maybeSingle()
    if (row) {
      setSessionId((row as any).id)
      setStatus('draft')
      setProductions([emptyProduction(aV, aL)])
      setActiveIdx(0)
      setTab('production')
    }
  }

  const statusLabel = status === 'approved' ? 'Signed off' : status === 'submitted' ? 'Awaiting sign-off' : status === 'draft' ? 'Draft' : 'New'
  const statusColor = status === 'approved' ? 'bg-ok/10 text-ok' : status === 'submitted' ? 'bg-info/10 text-info' : status === 'draft' ? 'bg-warn/10 text-warn' : 'bg-stone-100 text-stone-500'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

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

              {/* Batch set-up + live mass balance — one card. Variant and grade
                  are a mandatory, deliberate choice (no Export/Conventional
                  default); the balance appears here once material goes in. The
                  per-bag batch/lot is captured below, not duplicated here. */}
              <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">
                    Batch{multi ? ` · P${activeIdx + 1}` : ''}
                  </span>
                  <GradeHelp />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Variant</label>
                    <select value={active.variant} disabled={locked} onChange={e => updateActiveMeta('variant', e.target.value)}
                      className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-brand cursor-pointer ${active.variant ? 'border-stone-200 text-text' : 'border-amber-300 text-stone-400'}`}>
                      <option value="" disabled>Select variant…</option>
                      {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Grade</label>
                    <select value={active.grade} disabled={locked} onChange={e => updateActiveMeta('grade', e.target.value)}
                      className={`w-full px-3 py-2.5 rounded-xl border bg-white text-[13px] outline-none focus:border-brand cursor-pointer ${active.grade ? 'border-stone-200 text-text' : 'border-amber-300 text-stone-400'}`}>
                      <option value="" disabled>Select grade…</option>
                      {DESTINATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                {totalIn > 0 && (
                  <div className="pt-3 border-t border-stone-100">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
                        <Scale size={13} /> Mass balance
                      </span>
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${withinTol ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
                        {withinTol ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                        {withinTol ? `Within ±${MASS_BALANCE_TOLERANCE_KG}` : `Outside ±${MASS_BALANCE_TOLERANCE_KG}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <div className="text-center flex-1">
                        <div className="font-mono font-bold text-[20px] text-text leading-none">{totalIn.toFixed(1)}</div>
                        <div className="text-[10px] text-text-muted mt-1">kg in</div>
                      </div>
                      <ArrowRight size={16} className="text-stone-300 shrink-0" />
                      <div className="text-center flex-1">
                        <div className="font-mono font-bold text-[20px] text-text leading-none">{totalOut.toFixed(1)}</div>
                        <div className="text-[10px] text-text-muted mt-1">kg out</div>
                      </div>
                      <span className="text-stone-300 font-bold text-[16px] shrink-0">=</span>
                      <div className="text-center flex-1">
                        <div className={`font-mono font-bold text-[20px] leading-none ${withinTol ? 'text-ok' : 'text-warn'}`}>{variance > 0 ? '+' : ''}{variance.toFixed(1)}</div>
                        <div className="text-[10px] text-text-muted mt-1">variance</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Capture only opens once a variant and grade are chosen. */}
              {(active.variant && active.grade) || locked ? (
                <>
                  <SievingCapture
                    key={active.id}
                    assignment={assignment}
                    variantWord={active.variant}
                    gradeLetter={active.grade || 'A'}
                    locked={locked}
                    value={active.data}
                    onChange={updateActiveData}
                    genSerial={genSerial}
                    operatorId={verifiedOp?.user_id ?? user?.id ?? null}
                  />
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
                  <span>Choose a <strong>variant</strong> and <strong>grade</strong> above to start capturing this batch.</span>
                </div>
              )}
            </>
          )}

          {tab === 'checks' && (
            <ChecksPanel
              sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId} locked={locked}
              operators={candidateOps}
              variant={active?.variant ?? ''} grade={active?.grade ?? 'A'}
              massBalance={{ totalIn: st.totalIn, totalOut: st.totalOut, variance: stVariance, withinTol: stWithinTol }}
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
                <span>Totals are grouped and combined across both shifts where variant and grade match. Copy or print for Acumatica data entry.</span>
              </div>
              <CaptureOverview
                productions={[...productions, ...otherShiftProductions]}
                sectionName={meta.name}
                sectionColor={meta.colorHex}
                date={dateParam}
                shift={shift}
                showSerials={isIT}
                productionOrders={assignment?.production_orders}
                locked={locked}
              />
            </>
          )}

          {tab === 'signoff' && (
            <SignOff
              status={status} locked={locked} canApprove={canApprove}
              operatorName={verifiedOp ? (verifiedOp.display_name || verifiedOp.name) : (opNames[0] ?? '')}
              variance={stVariance} withinTol={stWithinTol} totalIn={st.totalIn} totalOut={st.totalOut}
              sessionId={sessionId} operatorId={verifiedOp?.user_id ?? user?.id ?? null}
              sectionId={sectionId} date={dateParam} shift={shift}
              comments={comments} onComments={setComments}
              onSign={storeSignature} onSubmit={handleSubmit} onApprove={handleApprove} submitting={submitting}
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
function SignOff({ status, locked, canApprove, operatorName, variance, withinTol, totalIn, totalOut, sessionId, operatorId, sectionId, date, shift, comments, onComments, onSign, onSubmit, onApprove, submitting }: {
  status: string; locked: boolean; canApprove: boolean; operatorName: string
  variance: number; withinTol: boolean; totalIn: number; totalOut: number
  sessionId: string | null; operatorId: string | null; sectionId: string; date: string; shift: string
  comments: string; onComments: (v: string) => void
  onSign: (role: 'operator' | 'supervisor', name: string, sig: string) => Promise<void>
  onSubmit: () => void; onApprove: () => void; submitting: boolean
}) {
  const [opName, setOpName]   = useState(operatorName)
  const [supName, setSupName] = useState('')
  const [opSig, setOpSig]     = useState(false)
  const [supSig, setSupSig]   = useState(false)
  const [tsConfirmed, setTsConfirmed] = useState(false)

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
        <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Mass balance</span>
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

      {/* Submitted — supervisor approval (signature + lock) */}
      {status === 'submitted' && canApprove && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Supervisor approval</span>
          <input value={supName} onChange={e => setSupName(e.target.value)} placeholder="Supervisor name"
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand" />
          <SignaturePad label="Supervisor signature" signed={supSig} disabled={!supName.trim()}
            onSign={async sig => { await onSign('supervisor', supName.trim(), sig); setSupSig(true) }} />
          {supSig && (
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

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>}>
      <CaptureScreen />
    </Suspense>
  )
}

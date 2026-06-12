'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, useParams } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import {
  ChevronLeft, Loader2, CheckCircle2, AlertTriangle, Users, Lock,
  ClipboardList, PenLine, Save, Sparkles, Info, Plus,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SignaturePad } from '@/components/production/capture/SignaturePad'
import {
  SievingCapture, emptySievingData, sievingTotals,
  type SievingData,
} from '@/components/production/capture/SievingCapture'
import { CleaningPanel } from '@/components/production/capture/CleaningPanel'
import { sectionMeta, makeSerial, MASS_BALANCE_TOLERANCE_KG, VARIANT_OPTIONS, variantToShort } from '@/lib/production/capture-config'
import type { Operator, ShiftAssignment } from '@/lib/supabase/database.types'

type Tab = 'production' | 'cleaning' | 'signoff'
const n = (v: string) => parseFloat(v) || 0

// A shift can contain several productions, each its own variant/lot.
interface Production { id: string; variant: string; lot: string; data: SievingData }
const emptyProduction = (variant?: string | null, lot?: string | null): Production =>
  ({ id: crypto.randomUUID(), variant: variant || 'Conventional', lot: lot || '', data: emptySievingData() })

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
  const [verifiedOp, setVerifiedOp] = useState<Operator | null>(null)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus]       = useState<'new' | 'draft' | 'submitted' | 'approved'>('new')
  const [productions, setProductions] = useState<Production[]>([])
  const [activeIdx, setActiveIdx]     = useState(0)
  const [tab, setTab]             = useState<Tab>('production')
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Serial counter, seeded from existing tags for this section+date
  const seqRef = useRef(0)
  const productionsRef = useRef<Production[]>(productions); productionsRef.current = productions
  const sessionRef = useRef<string | null>(null); sessionRef.current = sessionId
  const persistRef = useRef<((p: Production[], sid: string) => Promise<void>) | null>(null)

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
            .select('id,name,display_name').in('id', ids)
          setOpNames((ops as Operator[] ?? []).map(o => o.display_name || o.name))
        }
      }

      // Resolve the signed-in floor operator (for sign-off attribution) — no PIN re-entry.
      if (user?.id) {
        const { data: me } = await db.schema('production').from('operators')
          .select('*').eq('user_id', user.id).maybeSingle()
        if (me) setVerifiedOp(me as Operator)
      }

      const { data: sess } = await db.schema('production').from('prod_sessions')
        .select('id,status,draft_data').eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      const aVariant = (assign as any)?.variant ?? 'Conventional'
      const aLot     = (assign as any)?.lot_number ?? ''
      const d = (sess as any)?.draft_data
      if (d?.productions?.length) {
        setProductions(d.productions as Production[])
      } else if (d?.outputs) {
        // legacy single-production draft → wrap as one production
        setProductions([{ id: crypto.randomUUID(), variant: aVariant, lot: aLot, data: d as SievingData }])
      } else {
        setProductions([emptyProduction(aVariant, aLot)])
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

      // Seed serial counter from the highest existing NNN for section+date
      const prefix = `${meta.code}-`
      const { data: tags } = await db.schema('production').from('bag_tags')
        .select('serial_number').like('serial_number', `${prefix}%`)
      let maxSeq = 0
      ;(tags ?? []).forEach((t: any) => {
        const m = String(t.serial_number).match(/-(\d{3,})$/)
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10))
      })
      seqRef.current = maxSeq

      setLoading(false)
    }
    load()
  }, [sectionId, dateParam, shift])

  // ── Auto-save every 20s — full persist (draft + structured rows) ─────────
  useEffect(() => {
    const t = setInterval(() => {
      const sid = sessionRef.current
      if (!sid || !persistRef.current) return
      persistRef.current(productionsRef.current, sid).catch(() => {})
    }, 20_000)
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
          session_id: sid, bag_no: bagNo++, bag_serial_no: r.bag_no || null, lot_number: r.lot || prod.lot || null,
          product_type: '500kg Farm Bag', variant: prod.variant,
          kg_gross: n(r.gross) || null, kg_nett: n(r.nett),
          delivery_date: r.delivery_date || null, local_or_export: r.local_export || null,
          is_spillage: false,
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
          acumatica_id: b.code || null, variant: prod.variant,
          kg: n(b.weight),
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

  function updateActiveMeta(key: 'variant' | 'lot', val: string) {
    setProductions(ps => ps.map((p, i) => i === activeIdx ? { ...p, [key]: val } : p))
  }
  function addProduction() {
    setProductions(ps => [...ps, emptyProduction(assignment?.variant, assignment?.lot_number)])
    setActiveIdx(productions.length)
    setTab('production')
  }

  // After a session is locked, start a fresh session for the next variant/grade.
  async function startNewProduction() {
    const aV = assignment?.variant ?? 'Conventional'
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
        <span className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-full shrink-0 ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Mass balance meter */}
      {totalIn > 0 && (
        <div className="mx-4 mt-3 mb-1 bg-white border border-stone-200 rounded-2xl p-3.5 flex-shrink-0 shadow-sm">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
              Mass balance{multi ? ` · P${activeIdx + 1}` : ''}
            </span>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${withinTol ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
              {withinTol ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {withinTol ? 'Within tolerance' : `Outside ±${MASS_BALANCE_TOLERANCE_KG}`}
            </span>
          </div>
          <div className="flex items-end gap-3 mb-2.5">
            <div className="flex-1"><div className="font-mono font-bold text-[20px] text-text leading-none">{totalIn.toFixed(1)}</div><div className="text-[10px] text-text-muted mt-1">kg in</div></div>
            <div className="flex-1"><div className="font-mono font-bold text-[20px] text-text leading-none">{totalOut.toFixed(1)}</div><div className="text-[10px] text-text-muted mt-1">kg out</div></div>
            <div className="flex-1"><div className={`font-mono font-bold text-[20px] leading-none ${withinTol ? 'text-ok' : 'text-warn'}`}>{variance > 0 ? '+' : ''}{variance.toFixed(1)}</div><div className="text-[10px] text-text-muted mt-1">variance</div></div>
          </div>
          <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${withinTol ? 'bg-ok' : 'bg-warn'}`}
              style={{ width: `${totalIn > 0 ? Math.min(100, Math.max(4, (totalOut / totalIn) * 100)) : 0}%` }} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-200 px-4 flex-shrink-0 bg-white">
        {([['production', 'Production', ClipboardList], ['cleaning', 'Cleaning', Sparkles], ['signoff', 'Sign-off', PenLine]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors ${tab === id ? 'border-brand text-brand' : 'border-transparent text-stone-400 hover:text-stone-700'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-surface)' }}>
        <div className="px-4 py-5 max-w-[800px] space-y-5">
          {tab === 'production' && active && (
            <>
              {locked ? (
                <div className="bg-ok/5 border border-ok/30 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-ok"><Lock size={16} /> This batch record is signed off &amp; locked.</div>
                  <p className="text-[12px] text-text-muted">To capture a different variant or grade on this line, create a <strong>new batch record</strong> — same steps as before. The locked record above stays saved.</p>
                  <button onClick={startNewProduction}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white font-medium text-[14px] hover:bg-brand-mid transition-colors">
                    <Plus size={16} /> Create new batch record
                  </button>
                </div>
              ) : (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-info">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <span><strong>Debagging</strong> = what goes in. <strong>Bagging</strong> = what comes out (each bag prints a barcode). Totals add up for you.</span>
                </div>
              )}

              {/* Production switcher — a shift can run several productions / variants */}
              <div className="flex items-center gap-2 flex-wrap">
                {productions.map((p, i) => (
                  <button key={p.id} onClick={() => setActiveIdx(i)}
                    className={`px-3 py-1.5 rounded-xl border text-[12px] font-medium transition-colors ${i === activeIdx ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200'}`}>
                    P{i + 1} · {variantToShort(p.variant as any)}
                  </button>
                ))}
                {!locked && (
                  <button onClick={addProduction} className="px-3 py-1.5 rounded-xl border border-dashed border-stone-300 text-stone-500 text-[12px] font-medium hover:border-brand hover:text-brand">
                    + Production
                  </button>
                )}
              </div>

              {/* Active production's variant + lot (editable — each production can differ) */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-text-muted">Production {activeIdx + 1}:</span>
                <select value={active.variant} disabled={locked} onChange={e => updateActiveMeta('variant', e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-stone-200 bg-white text-[12px] outline-none focus:border-brand cursor-pointer">
                  {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
                <input value={active.lot} disabled={locked} onChange={e => updateActiveMeta('lot', e.target.value)} placeholder="Lot / batch"
                  className="px-3 py-1.5 rounded-xl border border-stone-200 bg-white text-[12px] outline-none focus:border-brand w-36" />
                {multi && !locked && productions.length > 1 && (
                  <button onClick={() => { setProductions(ps => ps.filter((_, i) => i !== activeIdx)); setActiveIdx(0) }}
                    className="text-[11px] text-stone-400 hover:text-err">Remove</button>
                )}
              </div>

              <SievingCapture
                key={active.id}
                assignment={assignment}
                variantWord={active.variant}
                locked={locked}
                value={active.data}
                onChange={updateActiveData}
                genSerial={genSerial}
              />
              {!locked && (
                <button onClick={saveDraft} disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-stone-200 bg-white font-medium text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle2 size={15} className="text-ok" /> : <Save size={15} />}
                  {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
                </button>
              )}
            </>
          )}

          {tab === 'cleaning' && (
            <CleaningPanel
              sectionId={sectionId} date={dateParam} shift={shift} sessionId={sessionId} locked={locked}
              operator={verifiedOp ? { id: verifiedOp.id, name: verifiedOp.display_name || verifiedOp.name, pin: verifiedOp.pin } : null}
            />
          )}

          {tab === 'signoff' && (
            <SignOff
              status={status} locked={locked} canApprove={canApprove}
              operatorName={verifiedOp ? (verifiedOp.display_name || verifiedOp.name) : (opNames[0] ?? '')}
              variance={stVariance} withinTol={stWithinTol} totalIn={st.totalIn} totalOut={st.totalOut}
              onSign={storeSignature} onSubmit={handleSubmit} onApprove={handleApprove} submitting={submitting}
            />
          )}

          {error && <p className="text-[12px] text-err px-1">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ── Sign-off tab ──────────────────────────────────────────────────────────────
function SignOff({ status, locked, canApprove, operatorName, variance, withinTol, totalIn, totalOut, onSign, onSubmit, onApprove, submitting }: {
  status: string; locked: boolean; canApprove: boolean; operatorName: string
  variance: number; withinTol: boolean; totalIn: number; totalOut: number
  onSign: (role: 'operator' | 'supervisor', name: string, sig: string) => Promise<void>
  onSubmit: () => void; onApprove: () => void; submitting: boolean
}) {
  const [opName, setOpName]   = useState(operatorName)
  const [supName, setSupName] = useState('')
  const [opSig, setOpSig]     = useState(false)
  const [supSig, setSupSig]   = useState(false)

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

      {/* Operator sign-off — only while still being captured (draft/new) */}
      {(status === 'new' || status === 'draft') && (
        <>
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Operator sign-off</span>
            <input value={opName} onChange={e => setOpName(e.target.value)} placeholder="Operator name" disabled={locked}
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand" />
            <SignaturePad label="Operator signature" signed={opSig} disabled={locked || !opName.trim()}
              onSign={async sig => { await onSign('operator', opName.trim(), sig); setOpSig(true) }} />
          </div>
          {opSig && (
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

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>}>
      <CaptureScreen />
    </Suspense>
  )
}

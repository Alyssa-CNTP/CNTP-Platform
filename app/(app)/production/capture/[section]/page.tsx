'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, useParams } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import {
  ChevronLeft, Loader2, CheckCircle2, AlertTriangle, Users, Lock,
  ClipboardList, PenLine, Save, Sparkles,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SignaturePad } from '@/components/production/capture/SignaturePad'
import {
  SievingCapture, emptySievingData, sievingTotals,
  type SievingData,
} from '@/components/production/capture/SievingCapture'
import { CleaningPanel } from '@/components/production/capture/CleaningPanel'
import { sectionMeta, makeSerial, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'
import type { Operator, ShiftAssignment } from '@/lib/supabase/database.types'

type Tab = 'production' | 'cleaning' | 'signoff'
const n = (v: string) => parseFloat(v) || 0

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
  const [data, setData]           = useState<SievingData>(emptySievingData())
  const [tab, setTab]             = useState<Tab>('production')
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Serial counter, seeded from existing tags for this section+date
  const seqRef = useRef(0)
  const dataRef = useRef<SievingData>(data); dataRef.current = data
  const sessionRef = useRef<string | null>(null); sessionRef.current = sessionId

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
        .select('id,status,draft_data').eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift).maybeSingle()
      if (sess) {
        setSessionId((sess as any).id)
        setStatus((sess as any).status)
        const d = (sess as any).draft_data
        if (d && typeof d === 'object' && d.outputs) setData(d as SievingData)
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

  // ── Auto-save draft_data ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const sid = sessionRef.current
      if (!sid) return
      getDb().schema('production').from('prod_sessions')
        .update({ draft_data: dataRef.current as any, updated_at: new Date().toISOString() } as any)
        .eq('id', sid).catch(() => {})
    }, 30_000)
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
      lot_number:        assignment?.lot_number ?? null,
      variant:           assignment?.variant ?? null,
      production_orders: assignment?.production_orders ?? null,
      created_by:        user?.id ?? null,
    } as any).select('id').single()
    if (e) throw new Error(e.message)
    const id = (row as any).id
    setSessionId(id)
    return id
  }

  // ── Build structured rows from SievingData ───────────────────────────────
  function buildDebag(sid: string) {
    const rows: any[] = []
    let bagNo = 1
    data.spillage.forEach(r => {
      if (n(r.kg) === 0) return
      rows.push({ session_id: sid, bag_no: bagNo++, product_type: 'Bucket Elevator', kg_nett: n(r.kg), is_spillage: true })
    })
    data.debag.forEach(r => {
      if (n(r.nett) === 0) return
      rows.push({
        session_id: sid, bag_no: bagNo++, bag_serial_no: r.bag_no || null, lot_number: r.lot || null,
        product_type: '500kg Farm Bag', variant: assignment?.variant ?? null,
        kg_gross: n(r.gross) || null, kg_nett: n(r.nett),
        delivery_date: r.delivery_date || null, local_or_export: r.local_export || null,
        is_spillage: false,
      })
    })
    return rows
  }
  function buildBag(sid: string) {
    const rows: any[] = []
    let bagNo = 1
    data.outputs.forEach(b => {
      if (n(b.weight) === 0) return
      rows.push({
        session_id: sid, bag_no: bagNo++, output_group: 'B',
        bag_serial_no: b.serial, lot_number: b.batch || null, product_type: b.productType,
        acumatica_id: b.code || null, variant: assignment?.variant ?? null,
        kg: n(b.weight),
      })
    })
    return rows
  }

  async function saveDraft() {
    setSaving(true); setError(null)
    try {
      const sid = await ensureSession()
      const { totalIn, totalOut } = sievingTotals(data)

      await getDb().schema('production').from('prod_sessions').update({
        status: 'draft', draft_data: data as any, updated_at: new Date().toISOString(),
      } as any).eq('id', sid)

      const debag = buildDebag(sid)
      await getDb().schema('production').from('prod_debagging').delete().eq('session_id', sid)
      if (debag.length) await getDb().schema('production').from('prod_debagging').insert(debag as any)

      const bag = buildBag(sid)
      await getDb().schema('production').from('prod_bagging').delete().eq('session_id', sid)
      if (bag.length) await getDb().schema('production').from('prod_bagging').insert(bag as any)

      await getDb().schema('production').from('prod_mass_balance').upsert({
        session_id: sid, total_input_kg: totalIn, total_output_b_kg: totalOut,
        total_output_c_kg: 0, total_output_d_kg: 0, calculated_at: new Date().toISOString(),
      } as any, { onConflict: 'session_id' })

      // Link tags created during capture to this session
      const serials = bag.map(b => b.bag_serial_no).filter(Boolean)
      if (serials.length) {
        await getDb().schema('production').from('bag_tags')
          .update({ session_id: sid } as any).in('serial_number', serials)
      }

      setStatus('draft'); setSaved(true); setTimeout(() => setSaved(false), 2500)
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
  const { totalIn, totalOut } = sievingTotals(data)
  const variance  = totalIn - totalOut
  const withinTol = Math.abs(variance) <= MASS_BALANCE_TOLERANCE_KG

  const statusLabel = status === 'approved' ? 'Signed off' : status === 'submitted' ? 'Awaiting sign-off' : status === 'draft' ? 'Draft' : 'New'
  const statusColor = status === 'approved' ? 'bg-ok/10 text-ok' : status === 'submitted' ? 'bg-info/10 text-info' : status === 'draft' ? 'bg-warn/10 text-warn' : 'bg-stone-100 text-stone-500'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 flex-shrink-0">
        <button onClick={() => router.push('/production/capture')} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400"><ChevronLeft size={18} /></button>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: meta.colorHex }}>
          <span className="font-mono font-bold text-[11px] text-white">{meta.code}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[20px] text-text leading-tight">{meta.name}</h1>
          <p className="text-[11px] text-text-muted capitalize">{shift} shift · {format(parseISO(dateParam + 'T12:00:00'), 'd MMM yyyy')}</p>
        </div>
        <span className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg shrink-0 ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Autofilled header card */}
      <div className="mx-4 mb-2 px-4 py-3 bg-white border border-stone-200 rounded-xl flex flex-wrap items-center gap-x-4 gap-y-1.5 flex-shrink-0">
        <span className="flex items-center gap-1.5 text-[12px] text-text-muted font-mono"><Users size={12} />{opNames.join(', ') || '—'}</span>
        {assignment.variant    && <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-50 border border-stone-100">{assignment.variant}</span>}
        {assignment.lot_number && <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-50 border border-stone-100">Lot {assignment.lot_number}</span>}
        {verifiedOp && <span className="ml-auto flex items-center gap-1 text-[11px] text-ok"><CheckCircle2 size={12} />{verifiedOp.display_name || verifiedOp.name}</span>}
      </div>

      {/* Mass balance strip */}
      {totalIn > 0 && (
        <div className={`mx-4 mb-2 px-4 py-2.5 rounded-xl border text-[12px] font-mono flex items-center gap-3 flex-shrink-0 ${withinTol ? 'bg-ok/5 border-ok/20 text-ok' : 'bg-warn/10 border-warn/30 text-warn font-bold'}`}>
          {!withinTol && <AlertTriangle size={13} />}
          <span>In {totalIn.toFixed(1)}</span><span className="opacity-40">·</span>
          <span>Out {totalOut.toFixed(1)}</span><span className="opacity-40">·</span>
          <span>Var {variance > 0 ? '+' : ''}{variance.toFixed(1)} kg</span>
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
          {tab === 'production' && (
            <>
              <SievingCapture
                assignment={assignment}
                variantWord={assignment.variant ?? 'Conventional'}
                locked={locked}
                value={data}
                onChange={setData}
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
              variance={variance} withinTol={withinTol} totalIn={totalIn} totalOut={totalOut}
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

      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Operator sign-off</span>
        <input value={opName} onChange={e => setOpName(e.target.value)} placeholder="Operator name" disabled={locked}
          className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand" />
        <SignaturePad label="Operator signature" signed={opSig} disabled={locked || !opName.trim()}
          onSign={async sig => { await onSign('operator', opName.trim(), sig); setOpSig(true) }} />
      </div>

      {opSig && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Supervisor sign-off</span>
          <input value={supName} onChange={e => setSupName(e.target.value)} placeholder="Supervisor name" disabled={locked}
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand" />
          <SignaturePad label="Supervisor signature" signed={supSig} disabled={locked || !supName.trim()}
            onSign={async sig => { await onSign('supervisor', supName.trim(), sig); setSupSig(true) }} />
        </div>
      )}

      {!locked && opSig && supSig && status !== 'submitted' && status !== 'approved' && (
        <button onClick={onSubmit} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40">
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} Submit shift record
        </button>
      )}

      {canApprove && status === 'submitted' && (
        <button onClick={onApprove} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] disabled:opacity-40">
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />} Approve &amp; lock
        </button>
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

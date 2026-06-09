'use client'

// app/(app)/logistics/dispatch/[id]/page.tsx
// Dispatch detail with 4 tabs: Pick, Load, Checklist, Seal.
// One file so the whole workflow is visible at a glance.

import { useEffect, useMemo, useState, use } from 'react'
import Link from 'next/link'
import { logisticsDb } from '@/lib/logistics/db'
import { recordEvent, setUnitStage } from '@/lib/logistics/actions'
import ScanInput from '@/components/logistics/ScanInput'
import { useAuth } from '@/lib/auth/context'
import type {
  Dispatch, DispatchDocument, DispatchDocCode, Unit, SalesOrder,
} from '@/lib/logistics/types'
import { DISPATCH_DOC_CODES, DISPATCH_DOC_LABELS, UNIT_STAGE_LABELS } from '@/lib/logistics/types'
import {
  ArrowLeft, Loader2, CheckCircle2, AlertCircle, Truck, ClipboardList,
  Lock, ShieldCheck, Package, Hash, MapPin,
} from 'lucide-react'
import { format } from 'date-fns'

type Tab = 'pick' | 'load' | 'checklist' | 'seal'

interface DispatchFull extends Dispatch {
  so: (SalesOrder & { customer: { name: string; language_pref: string } | null }) | null
}

interface PickedUnit {
  event_id:     number
  unit:         Unit & { batch?: { expiry_date: string | null; batch_code: string | null } | null }
  picked_at:    string
  loaded_at?:   string | null
  load_slot?:   string | null
}

export default function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: dispatchId } = use(params)
  const { user, displayName } = useAuth()

  const [tab, setTab]   = useState<Tab>('pick')
  const [dsp, setDsp]   = useState<DispatchFull | null>(null)
  const [docs, setDocs] = useState<DispatchDocument[]>([])
  const [picked, setPicked] = useState<PickedUnit[]>([])
  const [fefoSuggestions, setFefoSuggestions] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => { void load() }, [dispatchId])

  async function load() {
    setLoading(true)
    try {
      const db = logisticsDb()
      const [dspRes, docsRes] = await Promise.all([
        db.from('dispatches').select(`
          *,
          so:so_id ( *, customer:customer_id ( name, language_pref ) )
        `).eq('id', dispatchId).maybeSingle(),
        db.from('dispatch_documents').select('*').eq('dispatch_id', dispatchId),
      ])

      const d = dspRes.data as DispatchFull | null
      setDsp(d)
      // Ensure all 10 doc rows exist even for old dispatches
      const existing = ((docsRes.data as DispatchDocument[]) ?? [])
      const have = new Set(existing.map(x => x.doc_code))
      const missing = DISPATCH_DOC_CODES.filter(c => !have.has(c))
      if (missing.length) {
        await db.from('dispatch_documents').insert(missing.map(c => ({ dispatch_id: dispatchId, doc_code: c, status: 'pending' })))
        const reload = await db.from('dispatch_documents').select('*').eq('dispatch_id', dispatchId)
        setDocs((reload.data as DispatchDocument[]) ?? [])
      } else {
        setDocs(existing)
      }

      // Picked units = unit_events of type pick_for_order for this dispatch
      const { data: pickEvs } = await db
        .from('unit_events')
        .select(`id, scanned_at, notes, payload, unit:unit_id ( *, batch:batch_id ( expiry_date, batch_code ) )`)
        .eq('dispatch_id', dispatchId)
        .eq('event_type', 'pick_for_order')
        .order('scanned_at', { ascending: true })

      const { data: loadEvs } = await db
        .from('unit_events')
        .select('unit_id, scanned_at, payload')
        .eq('dispatch_id', dispatchId)
        .eq('event_type', 'load_to_container')

      const loadByUnit = new Map<string, { at: string; slot: string | null }>()
      for (const e of (loadEvs ?? []) as any[]) {
        loadByUnit.set(e.unit_id, { at: e.scanned_at, slot: e.payload?.slot ?? null })
      }

      setPicked(((pickEvs ?? []) as any[]).map(e => ({
        event_id:   e.id,
        unit:       e.unit,
        picked_at:  e.scanned_at,
        loaded_at:  loadByUnit.get(e.unit.id)?.at ?? null,
        load_slot:  loadByUnit.get(e.unit.id)?.slot ?? null,
      })))

      // FEFO suggestions: active, in-stock units ordered by expiry asc then arrived_at asc.
      // Sorted client-side because supabase-js foreign-table ordering is finicky.
      const { data: fefo } = await db
        .from('units')
        .select(`*, batch:batch_id ( expiry_date )`)
        .eq('status', 'active')
        .in('current_stage', ['received','finished'])
        .order('arrived_at', { ascending: true })
        .limit(100)
      const sorted = (((fefo ?? []) as any[]).slice()).sort((a, b) => {
        const ae = a.batch?.expiry_date ?? '9999-12-31'
        const be = b.batch?.expiry_date ?? '9999-12-31'
        if (ae !== be) return ae < be ? -1 : 1
        return a.arrived_at < b.arrived_at ? -1 : 1
      })
      setFefoSuggestions(sorted.slice(0, 20) as Unit[])
    } catch (e: any) {
      setError(e?.message ?? 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  const isSealed       = dsp?.status === 'sealed' || dsp?.status === 'dispatched'
  const isDispatched   = dsp?.status === 'dispatched'

  // Per-stage validation helpers
  const docsByCode  = useMemo(() => new Map(docs.map(d => [d.doc_code, d])), [docs])
  const docsComplete = docs.length > 0 && docs.every(d => d.status === 'verified' || d.status === 'na')
  const allPickedLoaded = picked.length > 0 && picked.every(p => p.loaded_at)
  const canSeal = !isSealed && picked.length > 0 && allPickedLoaded && docsComplete && dsp?.records_confirmed

  // ─── PICK actions ───────────────────────────────────────────────────
  async function pickScan(barcode: string) {
    setError(null)
    if (isSealed) { setError('Dispatch is sealed — cannot pick'); return }
    const db = logisticsDb()
    const { data: u } = await db.from('units').select('*').eq('barcode', barcode).maybeSingle()
    const unit = u as Unit | null
    if (!unit)              { setError(`No unit with barcode "${barcode}"`); return }
    if (unit.status !== 'active')
                            { setError(`Unit ${barcode} has status "${unit.status}" — cannot pick`); return }
    // Reject if already picked into any non-cancelled dispatch
    const { data: existing } = await db
      .from('unit_events')
      .select('id, dispatch_id')
      .eq('unit_id', unit.id)
      .eq('event_type', 'pick_for_order')
      .limit(1)
    if (existing && existing.length > 0 && (existing as any)[0].dispatch_id !== dispatchId) {
      setError(`Unit ${barcode} is already picked into another dispatch`); return
    }
    if (existing && existing.length > 0) {
      setError(`Unit ${barcode} is already picked for this dispatch`); return
    }

    await recordEvent({
      unitId: unit.id,
      eventType: 'pick_for_order',
      fromStage: unit.current_stage,
      toStage: 'picked',
      dispatchId,
      operatorId: user?.id ?? null,
      operatorName: displayName ?? null,
    })
    await setUnitStage({ unitId: unit.id, toStage: 'picked', dispatchId, operatorId: user?.id ?? null, operatorName: displayName ?? null })
    if (dsp?.status === 'planning') {
      await db.from('dispatches').update({ status: 'picking' }).eq('id', dispatchId)
    }
    await load()
  }

  async function unpick(eventId: number, unitId: string) {
    if (!confirm('Remove this unit from the dispatch?')) return
    const db = logisticsDb()
    // Delete the pick event; revert stage
    await db.from('unit_events').delete().eq('id', eventId)
    await setUnitStage({ unitId, toStage: 'finished', dispatchId, operatorId: user?.id ?? null, operatorName: displayName ?? null })
    await load()
  }

  // ─── LOAD actions ───────────────────────────────────────────────────
  async function loadScan(barcode: string) {
    setError(null)
    if (isSealed) { setError('Dispatch is sealed — cannot load'); return }
    const pickedUnit = picked.find(p => p.unit.barcode === barcode)
    if (!pickedUnit) { setError(`Unit ${barcode} is not picked for this dispatch — pick it first`); return }
    if (pickedUnit.loaded_at) { setError(`Unit ${barcode} is already loaded`); return }

    const slot = prompt('Container slot (e.g. A1, B2). Leave blank for none.') ?? ''
    await recordEvent({
      unitId: pickedUnit.unit.id,
      eventType: 'load_to_container',
      fromStage: 'picked',
      toStage: 'loaded',
      dispatchId,
      operatorId: user?.id ?? null,
      operatorName: displayName ?? null,
      payload: { slot: slot.trim() || null },
    })
    await setUnitStage({ unitId: pickedUnit.unit.id, toStage: 'loaded', dispatchId, operatorId: user?.id ?? null, operatorName: displayName ?? null })
    if (dsp?.status === 'picking') {
      await logisticsDb().from('dispatches').update({ status: 'loading' }).eq('id', dispatchId)
    }
    await load()
  }

  // ─── CHECKLIST actions ─────────────────────────────────────────────
  async function patchDoc(code: DispatchDocCode, patch: Partial<DispatchDocument>) {
    const db = logisticsDb()
    await db.from('dispatch_documents').update(patch).eq('dispatch_id', dispatchId).eq('doc_code', code)
    await load()
  }

  async function toggleRecordsConfirmed() {
    const db = logisticsDb()
    await db.from('dispatches').update({ records_confirmed: !dsp?.records_confirmed }).eq('id', dispatchId)
    await load()
  }

  async function saveComments(text: string) {
    const db = logisticsDb()
    await db.from('dispatches').update({ comments: text || null }).eq('id', dispatchId)
  }

  // ─── SEAL + DISPATCH OUT ───────────────────────────────────────────
  async function seal() {
    setError(null)
    if (!canSeal) { setError('Cannot seal yet — every unit must be loaded and every checklist item verified, with records confirmed.'); return }
    const sealNo = dsp?.seal_no ?? prompt('Container seal number?') ?? ''
    if (!sealNo.trim()) { setError('Seal number required'); return }
    const db = logisticsDb()
    await db.from('dispatches').update({
      status: 'sealed',
      seal_no: sealNo.trim(),
      verified_by: user?.id ?? null,
      verified_at: new Date().toISOString(),
    }).eq('id', dispatchId)
    await load()
  }

  async function dispatchOut() {
    if (!confirm('Mark this dispatch as Dispatched? This is final.')) return
    const db = logisticsDb()
    const nowIso = new Date().toISOString()
    // Bulk: stamp every picked unit as dispatched + emit dispatch_out events
    for (const p of picked) {
      await setUnitStage({ unitId: p.unit.id, toStage: 'dispatched', dispatchId, operatorId: user?.id ?? null, operatorName: displayName ?? null })
      await recordEvent({
        unitId: p.unit.id,
        eventType: 'dispatch_out',
        fromStage: 'loaded',
        toStage: 'dispatched',
        dispatchId,
        operatorId: user?.id ?? null,
        operatorName: displayName ?? null,
      })
      await db.from('units').update({
        status: 'dispatched',
        departed_at: nowIso,
        customer_id: dsp?.so?.customer_id ?? null,
      }).eq('id', p.unit.id)
    }
    await db.from('dispatches').update({
      status: 'dispatched',
      dispatched_at: nowIso,
      dispatched_by: user?.id ?? null,
    }).eq('id', dispatchId)
    await load()
  }

  if (loading) return <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
  if (!dsp)    return <div className="p-6 text-center text-text-muted">Dispatch not found.</div>

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <Link href="/logistics/dispatch" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to dispatches
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-surface-rule bg-white p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold text-text font-mono">{dsp.dispatch_code}</h1>
              <StatusBadge status={dsp.status} />
              {isSealed && !isDispatched && <span className="inline-flex items-center gap-1 text-xs text-purple-700"><Lock className="w-3 h-3" /> Sealed</span>}
              {isDispatched && <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Truck className="w-3 h-3" /> Dispatched</span>}
            </div>
            <div className="text-sm text-text-muted mt-1">
              {dsp.so?.so_code ?? 'No SO'} → {dsp.so?.customer?.name ?? 'No customer'}
              {dsp.container_no && <> · <span className="font-mono">{dsp.container_no}</span> ({dsp.container_size})</>}
              {dsp.seal_no && <> · seal <span className="font-mono">{dsp.seal_no}</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ProgressDot ok={picked.length > 0} label={`${picked.length} picked`} />
            <ProgressDot ok={allPickedLoaded && picked.length > 0} label={`${picked.filter(p => p.loaded_at).length}/${picked.length} loaded`} />
            <ProgressDot ok={docsComplete} label={`${docs.filter(d => d.status === 'verified' || d.status === 'na').length}/${docs.length} docs`} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-surface-rule overflow-x-auto">
        {([
          { id: 'pick',      label: 'Pick',      icon: Package },
          { id: 'load',      label: 'Load',      icon: Truck },
          { id: 'checklist', label: 'Checklist', icon: ClipboardList },
          { id: 'seal',      label: 'Seal',      icon: ShieldCheck },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition whitespace-nowrap
              ${tab === t.id ? 'border-text text-text font-medium' : 'border-transparent text-text-muted hover:text-text'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-err/20 bg-err/5 px-4 py-2.5 flex items-center gap-2 text-sm text-err">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* ─── PICK TAB ────────────────────────────────────────────── */}
      {tab === 'pick' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-surface-rule bg-white p-5">
              <ScanInput
                label="Scan unit to pick"
                placeholder="Scan a unit barcode"
                onScan={pickScan}
                disabled={isSealed}
                hint="Only active, in-stock units can be picked. Pre-picked units are blocked."
              />
            </div>

            <div className="rounded-xl border border-surface-rule bg-white p-5">
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">
                Picked units ({picked.length})
              </div>
              {picked.length === 0 ? (
                <div className="text-sm text-text-muted py-6 text-center">No units picked yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="text-left py-1.5">Barcode</th>
                      <th className="text-left">Product</th>
                      <th className="text-right">kg</th>
                      <th className="text-left">Expiry</th>
                      <th className="text-left">Picked</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {picked.map(p => (
                      <tr key={p.event_id} className="border-t border-surface-rule">
                        <td className="py-2 font-mono text-xs">
                          <Link href={`/logistics/warehouse/units/${p.unit.id}`} className="hover:underline">{p.unit.barcode}</Link>
                        </td>
                        <td>{p.unit.product_type ?? '—'}</td>
                        <td className="text-right tabular-nums">{p.unit.weight_kg ?? '—'}</td>
                        <td className="text-text-muted">{p.unit.batch?.expiry_date ?? '—'}</td>
                        <td className="text-text-muted text-xs">{format(new Date(p.picked_at), 'd MMM HH:mm')}</td>
                        <td className="text-right">
                          {!isSealed && (
                            <button onClick={() => unpick(p.event_id, p.unit.id)}
                              className="text-xs text-text-muted hover:text-err">Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="lg:col-span-1 rounded-xl border border-surface-rule bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">FEFO suggestions</div>
            {fefoSuggestions.length === 0 ? (
              <div className="text-sm text-text-muted py-4 text-center">No suggestions.</div>
            ) : (
              <ul className="space-y-1">
                {fefoSuggestions.map(u => (
                  <li key={u.id}>
                    <button onClick={() => pickScan(u.barcode)}
                      className="w-full text-left p-2 rounded-md hover:bg-surface text-sm">
                      <div className="font-mono text-xs">{u.barcode}</div>
                      <div className="text-text-muted text-xs">
                        {u.product_type ?? '—'} · {u.weight_kg ?? '—'} kg
                        {(u as any).batch?.expiry_date && <> · exp {(u as any).batch.expiry_date}</>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ─── LOAD TAB ────────────────────────────────────────────── */}
      {tab === 'load' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-rule bg-white p-5">
            <ScanInput
              label="Scan unit to load into container"
              placeholder="Scan a picked unit barcode"
              onScan={loadScan}
              disabled={isSealed || picked.length === 0}
              hint={picked.length === 0 ? 'Pick units first.' : 'You will be asked for the container slot after each scan.'}
            />
          </div>

          <div className="rounded-xl border border-surface-rule bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">
              Load progress ({picked.filter(p => p.loaded_at).length} / {picked.length})
            </div>
            {picked.length === 0 ? (
              <div className="text-sm text-text-muted py-6 text-center">Nothing to load.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="text-left py-1.5">Barcode</th>
                    <th className="text-left">Product</th>
                    <th className="text-right">kg</th>
                    <th className="text-left">Slot</th>
                    <th className="text-left">Loaded</th>
                  </tr>
                </thead>
                <tbody>
                  {picked.map(p => (
                    <tr key={p.event_id} className="border-t border-surface-rule">
                      <td className="py-2 font-mono text-xs">{p.unit.barcode}</td>
                      <td>{p.unit.product_type ?? '—'}</td>
                      <td className="text-right tabular-nums">{p.unit.weight_kg ?? '—'}</td>
                      <td className="text-text-muted font-mono">{p.load_slot ?? '—'}</td>
                      <td className="text-text-muted text-xs">
                        {p.loaded_at
                          ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> {format(new Date(p.loaded_at), 'HH:mm:ss')}</span>
                          : <span className="text-amber-700">pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ─── CHECKLIST TAB ──────────────────────────────────────── */}
      {tab === 'checklist' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-rule bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Dispatch documents (10)</div>
            <ul className="space-y-2">
              {DISPATCH_DOC_CODES.map(code => {
                const d = docsByCode.get(code)
                if (!d) return null
                return (
                  <li key={code} className="rounded-lg border border-surface-rule p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text">{DISPATCH_DOC_LABELS[code]}</div>
                        <div className="text-xs text-text-muted font-mono">{code}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select value={d.status} disabled={isSealed}
                          onChange={e => patchDoc(code, {
                            status: e.target.value as any,
                            verified_at: e.target.value === 'verified' ? new Date().toISOString() : null,
                            verified_by: e.target.value === 'verified' ? (user?.id ?? null) : null,
                          })}
                          className="px-2 py-1 border border-surface-rule rounded-md text-xs bg-white">
                          <option value="pending">Pending</option>
                          <option value="uploaded">Uploaded</option>
                          <option value="signed">Signed</option>
                          <option value="verified">Verified</option>
                          <option value="na">N/A</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input value={d.file_url ?? ''} placeholder="File URL (paste a link to the signed PDF)"
                        disabled={isSealed}
                        onChange={e => patchDoc(code, { file_url: e.target.value || null })}
                        className="px-2 py-1 border border-surface-rule rounded-md text-xs font-mono w-full" />
                      <input value={d.notes ?? ''} placeholder="Notes (optional)"
                        disabled={isSealed}
                        onChange={e => patchDoc(code, { notes: e.target.value || null })}
                        className="px-2 py-1 border border-surface-rule rounded-md text-xs w-full" />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="rounded-xl border border-surface-rule bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Confirmation</div>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" disabled={isSealed}
                checked={dsp.records_confirmed} onChange={toggleRecordsConfirmed} />
              All records are scanned in and saved on server
            </label>
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">Comments</div>
              <textarea defaultValue={dsp.comments ?? ''} rows={3} disabled={isSealed}
                onBlur={e => saveComments(e.target.value)}
                className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm" />
            </div>
          </div>
        </div>
      )}

      {/* ─── SEAL TAB ──────────────────────────────────────────── */}
      {tab === 'seal' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-rule bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Pre-flight check</div>
            <ul className="space-y-1.5 text-sm">
              <CheckRow ok={picked.length > 0}              label={`At least one unit picked (${picked.length})`} />
              <CheckRow ok={allPickedLoaded}                label={`Every picked unit is loaded (${picked.filter(p => p.loaded_at).length}/${picked.length})`} />
              <CheckRow ok={docsComplete}                   label={`All 10 documents verified or N/A (${docs.filter(d => d.status === 'verified' || d.status === 'na').length}/${docs.length})`} />
              <CheckRow ok={dsp.records_confirmed}          label="All records confirmed saved on server" />
              <CheckRow ok={!!dsp.container_no || !!dsp.seal_no} label="Container # or seal # set (will prompt at seal time if missing)" />
            </ul>
          </div>

          <div className="rounded-xl border border-surface-rule bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Sign-off</div>
            <div className="text-sm text-text-muted">Verified by: <strong className="text-text">{displayName ?? '—'}</strong></div>
            <div className="flex items-center gap-2 mt-4">
              {!isSealed && (
                <button onClick={seal} disabled={!canSeal}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-text text-white text-sm hover:bg-text/90 disabled:opacity-50">
                  <ShieldCheck className="w-4 h-4" /> Seal dispatch
                </button>
              )}
              {dsp.status === 'sealed' && (
                <button onClick={dispatchOut}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700">
                  <Truck className="w-4 h-4" /> Dispatch out
                </button>
              )}
              {isDispatched && (
                <div className="text-sm text-emerald-700 inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Dispatched on {dsp.dispatched_at && format(new Date(dsp.dispatched_at), 'd MMM yyyy HH:mm')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    planning:   'bg-amber-100 text-amber-700 border-amber-200',
    picking:    'bg-blue-100 text-blue-700 border-blue-200',
    loading:    'bg-blue-100 text-blue-700 border-blue-200',
    sealed:     'bg-purple-100 text-purple-700 border-purple-200',
    dispatched: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    cancelled:  'bg-stone-100 text-stone-600 border-stone-200',
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded-md border ${map[status] ?? 'bg-stone-100 text-stone-600'}`}>{status}</span>
}

function ProgressDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs
      ${ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {label}
    </span>
  )
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-amber-600" />}
      <span className={ok ? 'text-text' : 'text-text-muted'}>{label}</span>
    </li>
  )
}

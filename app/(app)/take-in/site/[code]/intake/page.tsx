'use client'

// app/(app)/take-in/intake/page.tsx
//
// Intake — the weighbridge, the QC receiving inspection, the lands, and the GRN.
//
// Three rules here exist because getting them wrong is expensive:
//
//  1. BEGIN IS THE LOADED READING. The truck arrives full and leaves empty, so
//     begin > end always. A reversed pair is a typing error, not a negative
//     delivery, and the database refuses it too (a CHECK constraint) — this
//     screen just says so before the save fails.
//
//  2. THE GRN NUMBER COMES FROM THE DATABASE. takein.next_doc_no() under a row
//     lock. Never max+1 in app code — that is the documented cause of 44 % of
//     Fine/Coarse Leaf bags lost from prod_bagging (ARCHITECTURE.md §5).
//
//  3. A VOIDED NUMBER IS BURNT. Voiding sets columns on the row; it never
//     deletes it and never frees the number. Two signed documents carrying one
//     number could not be told apart.

import type { LabRow, PanelOutcome } from '@/lib/takein/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { takeinDb, loadSites, allocateDocNo, logBatchEvent, releaseBatchNo, errMsg, scopedSites, siteCodeFrom } from '@/lib/takein/db'
import { RECEIVING_CHECKS, type Site } from '@/lib/takein/types'
import { grossKg, nettKg, weighbridgeReversed, isFinalised, stageOf } from '@/lib/core/takein/grading'
import { Loader2, AlertTriangle, Lock, FileText, Undo2, Plus, X } from 'lucide-react'

interface Land { ordinal: number; name: string }
interface Doc {
  id: string; kind: string; doc_no: string; issued_at: string; issued_by_name: string | null
  signed_by: string | null; signed_at: string | null
  voided_at: string | null; voided_by_name: string | null
  void_category: string | null; void_reason: string | null
}
interface Row {
  id: string; batch_no: string; location_code: string; contract_id: string
  delivered_on: string; begin_kg: number | null; end_kg: number | null; bags: number
  weighbridge_no: string | null; driver: string | null; vehicle: string | null
  producer_lot: string | null; tea_court: string | null; harvest_year: number | null
  checks_json: boolean[]; qc_comment: string | null
  returned_at: string | null; returned_reason: string | null
  panel_outcome: PanelOutcome | null; panel_grade: string | null; panel_reason: string | null
  panel_covered: string[] | null
  contract: { contract_no: string; variant: string; contracted_kg: number
              producer: { name: string } | null } | null
  batch_lands: Land[]
  batch_bags: { bag_no: number; land_ordinal: number | null }[]
  documents: Doc[]
  lab_results: LabRow[]
}

const VOID_REASONS = [
  { v: 'wrong_weight',   t: 'Wrong weight' },
  { v: 'wrong_producer', t: 'Wrong producer or contract' },
  { v: 'wrong_bags',     t: 'Wrong bag count' },
  { v: 'duplicate',      t: 'Duplicate' },
  { v: 'other',          t: 'Other' },
]
const RETURN_REASONS = [
  { v: 'checklist',     t: 'Checklist non-conformance' },
  { v: 'contamination', t: 'Contamination' },
  { v: 'wrong_product', t: 'Wrong product' },
  { v: 'other',         t: 'Other' },
]
const LAND_TONE = ['bg-ok-bg text-ok', 'bg-info-bg text-info', 'bg-warn-bg text-warn',
                   'bg-err-bg text-err', 'bg-surface-dim text-text-muted']

export default function IntakePage() {
  const { p, fullName, user, depotCodes } = useAuth()
  // This screen is always working on one site — the code is in the route.
  const routeCode = useParams<{ code: string }>().code
  const siteParam = siteCodeFrom(routeCode, useSearchParams().get('site'))
  const canCapture = p('can_capture_takein_intake')
  const canVoid    = p('can_void_takein_document')
  const canReturn  = p('can_return_takein_load')
  const actor = { id: user?.id ?? null, name: fullName ?? 'Unknown' }

  const [sites, setSites] = useState<Site[]>([])
  const [rows, setRows]     = useState<Row[]>([])
  const [selId, setSelId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [dialog, setDialog] = useState<null | { mode: 'void' | 'return' }>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const all = await loadSites()
      const mine = scopedSites(all, depotCodes, siteParam)
      setSites(mine)
      if (!mine.length) { setRows([]); return }
      const { data, error } = await takeinDb().from('batches')
        .select(`
          id, batch_no, location_code, contract_id, delivered_on, begin_kg, end_kg, bags,
          weighbridge_no, driver, vehicle, producer_lot, tea_court, harvest_year,
          checks_json, qc_comment, returned_at, returned_reason,
          panel_outcome, panel_grade, panel_reason, panel_covered,
          contract:contract_id ( contract_no, variant, contracted_kg, producer:producer_id ( name ) ),
          batch_lands ( ordinal, name ),
          batch_bags ( bag_no, land_ordinal ),
          documents ( id, kind, doc_no, issued_at, issued_by_name, signed_by, signed_at,
                      voided_at, voided_by_name, void_category, void_reason ),
          lab_results ( source, sieve_json, moisture, density, shade, aroma, colour, taste,
                        agrees, residue_group, pa_group )
        `)
        .in('location_code', mine.map(d => d.code))
        .order('delivered_on', { ascending: false })
        .limit(300)
      if (error) throw error
      const list = (data as unknown as Row[]) ?? []
      setRows(list)
      setSelId(cur => cur && list.some(r => r.id === cur) ? cur : (list[0]?.id ?? null))
    } catch (e: unknown) { setErr(errMsg(e, 'Could not load deliveries.')) }
    finally { setLoading(false) }
  }, [depotCodes.join(','), siteParam])

  useEffect(() => { void load() }, [load])

  const open = useMemo(() => rows.filter(r => {
    const lab = (s: string) => r.lab_results?.find((l: LabRow) => l.source === s) ?? null
    const st = stageOf({ mini: lab('mini'), internal: lab('internal'), external: lab('external'),
                         organic: /organic/i.test(r.contract?.variant ?? ''), binding: {},
                         returned: !!r.returned_at,
                         panel: r.panel_outcome ? { outcome: r.panel_outcome, grade: r.panel_grade,
                                reason: r.panel_reason ?? '', covered: r.panel_covered ?? [] } : null })
    const hasCoa = r.documents?.some(d => d.kind === 'coa' && !d.voided_at) ?? false
    return !isFinalised(st.stage, hasCoa) || r.id === selId
  }), [rows, selId])

  const b = useMemo(() => rows.find(r => r.id === selId) ?? null, [rows, selId])
  const site = useMemo(() => sites.find(d => d.code === b?.location_code) ?? null, [sites, b])

  const grn      = b?.documents?.find(d => d.kind === 'grn' && !d.voided_at) ?? null
  const voided   = b?.documents?.filter(d => !!d.voided_at) ?? []
  const gross    = b ? grossKg(b.begin_kg, b.end_kg) : 0
  const nett     = b ? nettKg(b.begin_kg, b.end_kg, b.bags) : 0
  const reversed = b ? weighbridgeReversed(b.begin_kg, b.end_kg) : false
  const checks   = b?.checks_json ?? []
  const ticked   = checks.filter(Boolean).length
  const allTicked = ticked === RECEIVING_CHECKS.length
  const wbMissing = !String(b?.weighbridge_no ?? '').trim()
  const locked   = !!b?.documents?.some(d => d.kind === 'afleweringsbewys' && !d.voided_at)
  const ready    = !!b && allTicked && nett > 0 && !wbMissing && !reversed && !b.returned_at && !locked

  async function patch(fields: Record<string, unknown>) {
    if (!b || !canCapture || locked) return
    const { error } = await takeinDb().from('batches').update(fields).eq('id', b.id)
    if (error) { setErr(error.message); return }
    setRows(rs => rs.map(r => r.id === b.id ? { ...r, ...fields } as Row : r))
  }

  async function issueGrn() {
    if (!b || !site || !ready) return
    setBusy(true)
    try {
      const no = await allocateDocNo(site.code, 'grn')
      const { error } = await takeinDb().from('documents').insert({
        batch_id: b.id, kind: 'grn', doc_no: no,
        issued_by: user?.id ?? null, issued_by_name: actor.name,
      })
      if (error) throw error
      await logBatchEvent(b.id, 'grn_issued',
        `GRN ${no} made out on the system — ${nett.toLocaleString('en-ZA')} kg nett over ${b.bags} bags`, actor)
      await load()
    } catch (e: unknown) { setErr(errMsg(e, 'Could not make out the GRN.')) }
    finally { setBusy(false) }
  }

  async function signGrn(name: string) {
    if (!b || !grn || !name.trim()) return
    setBusy(true)
    try {
      const { error } = await takeinDb().from('documents')
        .update({ signed_by: name.trim(), signed_at: new Date().toISOString() }).eq('id', grn.id)
      if (error) throw error
      await logBatchEvent(b.id, 'grn_signed', `GRN ${grn.doc_no} signed on the platform by ${name.trim()}`, actor)
      await load()
    } catch (e: unknown) { setErr(errMsg(e, 'Could not record the signature.')) }
    finally { setBusy(false) }
  }

  async function confirmDialog(category: string, reason: string) {
    if (!b || !dialog) return
    setBusy(true)
    try {
      if (grn) {
        const { error } = await takeinDb().from('documents').update({
          voided_at: new Date().toISOString(), voided_by: user?.id ?? null,
          voided_by_name: actor.name,
          void_category: dialog.mode === 'return' ? 'returned' : category,
          void_reason: reason,
        }).eq('id', grn.id)
        if (error) throw error
        await logBatchEvent(b.id, 'grn_voided',
          `GRN ${grn.doc_no} VOIDED (${(dialog.mode === 'return' ? 'returned' : category).replace(/_/g, ' ')}) — ${reason}`
          + (grn.signed_at ? ` · had been signed by ${grn.signed_by}` : ''), actor)
      }
      if (dialog.mode === 'return') {
        const { error } = await takeinDb().from('batches').update({
          returned_at: new Date().toISOString(), returned_by: user?.id ?? null,
          returned_stage: 'grn', returned_category: category, returned_reason: reason,
        }).eq('id', b.id)
        if (error) throw error
        if (site) await releaseBatchNo(site.code, b.batch_no)
        await logBatchEvent(b.id, 'load_returned',
          `RETURNED to producer at receiving (${category.replace(/_/g, ' ')}) — ${reason}`
          + ` · batch number ${b.batch_no} released`, actor)
      }
      setDialog(null)
      await load()
    } catch (e: unknown) { setErr(errMsg(e, 'Could not complete that.')) }
    finally { setBusy(false) }
  }

  const kg = (n: number) => n.toLocaleString('en-ZA', { maximumFractionDigits: 0 })

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries…
    </div>
  )

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{err}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-2xl border border-surface-rule bg-surface-card">
          <header className="border-b border-surface-rule px-4 py-3">
            <span className="font-display text-[14px] font-semibold text-text">Deliveries</span>
            <span className="ml-2 font-mono text-[11px] text-text-muted">{open.length} open</span>
          </header>
          <ul className="max-h-[620px] overflow-y-auto">
            {open.map(r => (
              <li key={r.id}>
                <button onClick={() => setSelId(r.id)}
                  className={`w-full border-b border-surface-rule px-4 py-3 text-left last:border-0 ${
                    r.id === selId ? 'bg-accent-bg' : 'hover:bg-surface-raised'}`}>
                  <div className="font-mono text-[12px] font-semibold text-text">{r.batch_no}</div>
                  <div className="text-[11px] text-text-muted">{r.contract?.producer?.name ?? '—'}</div>
                  <div className="font-mono text-[10px] text-text-faint">
                    {kg(nettKg(r.begin_kg, r.end_kg, r.bags))} kg
                    {!r.documents?.some(d => d.kind === 'grn' && !d.voided_at) && ' · no GRN'}
                    {r.returned_at && ' · returned'}
                  </div>
                </button>
              </li>
            ))}
            {!open.length && (
              <li className="px-4 py-8 text-center text-[12px] text-text-muted">
                Nothing open. A delivery is opened from the Schedule when the load arrives.
              </li>
            )}
          </ul>
        </aside>

        <div className="space-y-4">
          {!b ? (
            <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-8 text-center text-[12px] text-text-muted">
              Select a delivery.
            </div>
          ) : (
            <>
              {b.returned_at && (
                <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
                  <strong>⚑ Returned to the producer.</strong> {b.returned_reason}
                  <div className="mt-1 text-[11px]">
                    The load never became stock. It does not count against {b.contract?.contract_no},
                    no COA is issued, and batch number {b.batch_no} has been released back to the site.
                  </div>
                </div>
              )}
              {locked && (
                <div className="rounded-xl border border-info/25 bg-info-bg px-4 py-3 text-[12px] text-info">
                  <Lock className="mr-1.5 inline h-4 w-4" />
                  <strong>Frozen by the Afleweringsbewys.</strong> Payment is built off that document
                  and the producer holds a copy, so the weights and bag count cannot move. Withdraw it
                  on Documents to correct something.
                </div>
              )}

              {/* KPIs */}
              <div className="grid gap-3 sm:grid-cols-4">
                <Kpi label="Gross"  value={kg(gross)} unit="kg · weighbridge" />
                <Kpi label="Per bag" value={b.bags ? kg(nett / b.bags) : '—'} unit={`kg · ${b.bags} bags`} />
                <Kpi label="Nett"   value={kg(nett)} unit="kg" tone="ok" />
                <Kpi label="Contract" value={kg(Number(b.contract?.contracted_kg ?? 0))} unit="kg contracted" />
              </div>

              {/* weighbridge */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">
                    Weighbridge{grn ? ` — locked by ${grn.doc_no}` : ''}
                  </span>
                </header>
                <div className="px-4 py-4">
                  {reversed && (
                    <div className="mb-3 rounded-xl border border-err/25 bg-err-bg px-3 py-2.5 text-[12px] text-err">
                      ⚠ <strong>The readings are the wrong way round.</strong> The truck arrives loaded,
                      so the begin weight must be higher than the end weight.
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumField label="Begin weight kg — truck loaded, on arrival"
                      hint="always the higher of the two" value={b.begin_kg}
                      bad={reversed} disabled={!canCapture || !!grn || locked}
                      onCommit={v => void patch({ begin_kg: v })} />
                    <NumField label="End weight kg — truck empty, after offload"
                      hint={`gross = begin − end = ${kg(gross)} kg`} value={b.end_kg}
                      bad={reversed} disabled={!canCapture || !!grn || locked}
                      onCommit={v => void patch({ end_kg: v })} />
                    <NumField label="Number of bags" value={b.bags}
                      disabled={!canCapture || !!grn || locked}
                      onCommit={v => void patch({ bags: Math.max(0, Math.round(v ?? 0)) })} />
                    <TextField label={`Weighbridge no.${wbMissing && !grn ? ' *' : ''}`}
                      hint={wbMissing && !grn ? 'Required — prints on the GRN' : 'Typed by the operator'}
                      value={b.weighbridge_no} bad={wbMissing && !grn}
                      disabled={!canCapture || !!grn || locked}
                      onCommit={v => void patch({ weighbridge_no: v })} />
                    <TextField label="Driver / transporter" value={b.driver}
                      disabled={!canCapture} onCommit={v => void patch({ driver: v })} />
                    <TextField label="Vehicle registration" value={b.vehicle}
                      disabled={!canCapture} onCommit={v => void patch({ vehicle: v })} />
                  </div>
                </div>
              </section>

              {/* QC receiving inspection */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">QC receiving inspection</span>
                  <span className="font-mono text-[11px] text-text-muted">{ticked} / {RECEIVING_CHECKS.length} ticked</span>
                </header>
                <div className="divide-y divide-surface-rule px-4">
                  {RECEIVING_CHECKS.map((c, i) => (
                    <label key={c} className="flex cursor-pointer items-start gap-3 py-2.5">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                        checked={!!checks[i]} disabled={!canCapture || !!grn || locked}
                        onChange={e => {
                          const next = [...Array(RECEIVING_CHECKS.length)].map((_, j) =>
                            j === i ? e.target.checked : !!checks[j])
                          void patch({ checks_json: next })
                        }} />
                      <span className="text-[13px] text-text">{c}</span>
                    </label>
                  ))}
                </div>
                <div className="border-t border-surface-rule px-4 py-3">
                  <TextField label="Comment" value={b.qc_comment} disabled={!canCapture}
                    onCommit={v => void patch({ qc_comment: v })} />
                </div>
              </section>

              {/* lands */}
              <LandsPanel batch={b} disabled={!canCapture || locked} onChanged={load} onError={setErr} />

              {/* the GRN */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">Goods Received Note</span>
                </header>
                <div className="space-y-3 px-4 py-4">
                  {grn ? (
                    <>
                      <div className="rounded-xl border border-ok/25 bg-ok-bg px-3 py-2.5 text-[12px] text-ok">
                        <strong>{grn.doc_no}</strong> made out {new Date(grn.issued_at).toLocaleString('en-ZA')} by {grn.issued_by_name}
                      </div>
                      {grn.signed_at ? (
                        <div className="rounded-xl border border-ok/25 bg-ok-bg px-3 py-2.5 text-[12px] text-ok">
                          ✓ Signed on the platform by <strong>{grn.signed_by}</strong> —{' '}
                          {new Date(grn.signed_at).toLocaleString('en-ZA')}
                        </div>
                      ) : (
                        <SignBox disabled={!canCapture || busy} onSign={signGrn} />
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setDialog({ mode: 'void' })} disabled={!canVoid || busy}
                          className="rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px] font-semibold text-text disabled:opacity-40">
                          Void GRN…
                        </button>
                        <button onClick={() => setDialog({ mode: 'return' })} disabled={!canReturn || busy}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px] font-semibold text-text disabled:opacity-40">
                          <Undo2 className="h-3.5 w-3.5" /> Return load…
                        </button>
                      </div>
                      {!canVoid && <p className="text-[11px] text-text-faint">Voiding a GRN needs the supervisor override.</p>}
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] leading-relaxed text-text-muted">
                        The material is received and weighed <strong className="text-text">now</strong>; the
                        grade is not known for weeks. The GRN is made out on the system and the deliverer
                        signs it here before leaving. The next number at {site?.name} is{' '}
                        <span className="font-mono font-semibold text-text">
                          {site?.grn_prefix}{(site?.grn_seq ?? 0) + 1}
                        </span>.
                        {!ready && (
                          <><br /><br /><strong className="text-text">Blocked until:</strong>{' '}
                          {[!allTicked && 'every checklist item is ticked', nett <= 0 && 'a nett weight exists',
                            wbMissing && 'the weighbridge number is entered', reversed && 'the readings are the right way round',
                            b.returned_at && 'n/a — the load was returned']
                            .filter(Boolean).join(', ')}.</>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => void issueGrn()} disabled={!canCapture || !ready || busy}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
                          <FileText className="h-3.5 w-3.5" /> Make out the GRN
                        </button>
                        {!allTicked && !b.returned_at && (
                          <button onClick={() => setDialog({ mode: 'return' })} disabled={!canReturn || busy}
                            className="rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px] font-semibold text-text disabled:opacity-40">
                            Return load — non-conformance…
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* voided documents */}
              {!!voided.length && (
                <section className="rounded-2xl border border-surface-rule bg-surface-card">
                  <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
                    <span className="font-display text-[14px] font-semibold text-text">Voided documents</span>
                    <span className="text-[11px] text-text-muted">{voided.length} · numbers are not reissued</span>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead><tr className="border-b border-surface-rule bg-surface-raised">
                        {['Document', 'Why', 'Voided by'].map(h => (
                          <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {voided.map(v => (
                          <tr key={v.id} className="border-b border-surface-rule last:border-0">
                            <td className="px-4 py-2.5">
                              <span className="font-mono text-[12px] text-text">{v.doc_no}</span>
                              <span className="block text-[10px] text-text-faint">{v.void_category?.replace(/_/g, ' ')}</span>
                            </td>
                            <td className="px-4 py-2.5 text-[12px] text-text">{v.void_reason}</td>
                            <td className="px-4 py-2.5 text-[12px] text-text-muted">
                              {v.voided_by_name}
                              <span className="block text-[10px] text-text-faint">
                                {v.voided_at && new Date(v.voided_at).toLocaleString('en-ZA')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {dialog && b && (
        <ReasonDialog
          title={dialog.mode === 'void' ? `Void GRN ${grn?.doc_no ?? ''}` : `Return ${b.batch_no} to the producer`}
          sub={`${site?.name ?? ''} · ${b.contract?.producer?.name ?? ''}`}
          body={dialog.mode === 'void'
            ? `This cannot be undone. The GRN is withdrawn and the weighbridge readings unlock.${
                grn?.signed_at ? ` It has already been signed by ${grn.signed_by} — the producer holds a copy, so tell them.` : ''
              } ${grn?.doc_no} is NOT reissued; the next GRN takes ${site?.grn_prefix}${(site?.grn_seq ?? 0) + 1}.`
            : `The material goes back on the truck. It is not graded, it never counts against ${b.contract?.contract_no}, and no COA is issued.${
                grn ? ` GRN ${grn.doc_no} is voided with the same reason.` : ''
              } Batch number ${b.batch_no} is released and goes to the next delivery at ${site?.name}.`}
          options={dialog.mode === 'void' ? VOID_REASONS : RETURN_REASONS}
          confirmLabel={dialog.mode === 'void' ? 'Void the GRN' : 'Return the load'}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={confirmDialog}
        />
      )}
    </div>
  )
}

// ── lands, and which bag came off which one ─────────────────────────────────
function LandsPanel({ batch, disabled, onChanged, onError }: {
  batch: Row; disabled: boolean; onChanged: () => Promise<void>; onError: (m: string) => void
}) {
  const lands = [...(batch.batch_lands ?? [])].sort((a, b) => a.ordinal - b.ordinal)
  const bagLand = (n: number) =>
    batch.batch_bags?.find(x => x.bag_no === n)?.land_ordinal ?? null
  const counts = lands.map(l => batch.batch_bags?.filter(x => x.land_ordinal === l.ordinal).length ?? 0)
  const untagged = batch.bags > 0 && lands.length > 1
    ? Array.from({ length: batch.bags }, (_, i) => bagLand(i + 1)).filter(v => v == null).length : 0

  async function addLand() {
    const next = (lands.at(-1)?.ordinal ?? 0) + 1
    const { error } = await takeinDb().from('batch_lands')
      .insert({ batch_id: batch.id, ordinal: next, name: '' })
    if (error) onError(error.message); else await onChanged()
  }
  async function renameLand(ordinal: number, name: string) {
    const { error } = await takeinDb().from('batch_lands')
      .update({ name }).eq('batch_id', batch.id).eq('ordinal', ordinal)
    if (error) onError(error.message); else await onChanged()
  }
  async function removeLand(ordinal: number) {
    const db = takeinDb()
    await db.from('batch_bags').update({ land_ordinal: null })
      .eq('batch_id', batch.id).eq('land_ordinal', ordinal)
    const { error } = await db.from('batch_lands')
      .delete().eq('batch_id', batch.id).eq('ordinal', ordinal)
    if (error) onError(error.message); else await onChanged()
  }
  async function cycleBag(bagNo: number) {
    const cur = bagLand(bagNo)
    const idx = cur == null ? -1 : lands.findIndex(l => l.ordinal === cur)
    const next = idx + 1 >= lands.length ? null : lands[idx + 1].ordinal
    const { error } = await takeinDb().from('batch_bags')
      .upsert({ batch_id: batch.id, bag_no: bagNo, land_ordinal: next },
              { onConflict: 'batch_id,bag_no' })
    if (error) onError(error.message); else await onChanged()
  }

  return (
    <section className="rounded-2xl border border-surface-rule bg-surface-card">
      <header className="border-b border-surface-rule px-4 py-3">
        <span className="font-display text-[14px] font-semibold text-text">Lands on this load</span>
      </header>
      <div className="space-y-2 px-4 py-4">
        {lands.map((l, i) => (
          <div key={l.ordinal} className="flex items-center gap-2">
            <span className={`inline-flex h-6 w-7 items-center justify-center rounded-md font-mono text-[11px] font-semibold ${LAND_TONE[i % LAND_TONE.length]}`}>
              {i + 1}
            </span>
            <input defaultValue={l.name} placeholder="land or field name" disabled={disabled}
              onBlur={e => { if (e.target.value !== l.name) void renameLand(l.ordinal, e.target.value) }}
              className="flex-1 rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[12px] text-text disabled:opacity-60" />
            <span className="w-16 text-right font-mono text-[11px] text-text-muted">
              {counts[i]} bag{counts[i] === 1 ? '' : 's'}
            </span>
            {!disabled && lands.length > 1 && (
              <button onClick={() => void removeLand(l.ordinal)}
                className="rounded-md p-1 text-text-faint hover:text-err"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        ))}
        {!disabled && (
          <button onClick={() => void addLand()}
            className="inline-flex items-center gap-1 rounded-lg border border-surface-rule px-2.5 py-1.5 text-[11px] font-semibold text-text-muted hover:text-text">
            <Plus className="h-3 w-3" /> add a land
          </button>
        )}
        <p className="font-mono text-[11px] text-text-faint">
          Printed on the documents in this order — {lands.map(l => l.name).filter(Boolean).join(',') || 'N/A'}
        </p>

        {batch.bags > 0 && lands.length > 1 && (
          <div className="pt-2">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Which bag came off which land
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: batch.bags }, (_, i) => {
                const n = i + 1
                const ord = bagLand(n)
                const idx = ord == null ? -1 : lands.findIndex(l => l.ordinal === ord)
                return (
                  <button key={n} onClick={() => void cycleBag(n)} disabled={disabled}
                    title={ord == null ? 'not tagged' : lands[idx]?.name || `land ${idx + 1}`}
                    className={`h-8 w-8 rounded-lg border font-mono text-[11px] font-semibold disabled:cursor-not-allowed ${
                      ord == null
                        ? 'border-dashed border-surface-rule bg-surface-card text-text-muted'
                        : `border-transparent ${LAND_TONE[idx % LAND_TONE.length]}`}`}>
                    {n}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-text-faint">
              {untagged > 0 && <strong className="text-warn">{untagged} of {batch.bags} bags not tagged. </strong>}
              Click a bag to move it to the next land.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

// ── small pieces ────────────────────────────────────────────────────────────
function Kpi({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: 'ok' }) {
  return (
    <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`font-display text-[22px] font-bold ${tone === 'ok' ? 'text-ok' : 'text-text'}`}>{value}</div>
      <div className="text-[11px] text-text-faint">{unit}</div>
    </div>
  )
}

const inputCls = (bad?: boolean) =>
  `w-full rounded-lg border bg-surface-card px-2.5 py-1.5 text-[13px] text-text disabled:opacity-60 ${
    bad ? 'border-err' : 'border-surface-rule'}`

function NumField({ label, hint, value, bad, disabled, onCommit }: {
  label: string; hint?: string; value: number | null; bad?: boolean; disabled?: boolean
  onCommit: (v: number | null) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <input type="text" inputMode="decimal" defaultValue={value ?? ''} disabled={disabled}
        className={`${inputCls(bad)} font-mono`}
        onBlur={e => {
          const raw = e.target.value.replace(/[^\d.-]/g, '')
          onCommit(raw === '' ? null : Number(raw))
        }} />
      {hint && <span className="mt-0.5 block text-[10px] text-text-faint">{hint}</span>}
    </label>
  )
}

function TextField({ label, hint, value, bad, disabled, onCommit }: {
  label: string; hint?: string; value: string | null; bad?: boolean; disabled?: boolean
  onCommit: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <input type="text" defaultValue={value ?? ''} disabled={disabled} className={inputCls(bad)}
        onBlur={e => { if (e.target.value !== (value ?? '')) onCommit(e.target.value) }} />
      {hint && <span className="mt-0.5 block text-[10px] text-text-faint">{hint}</span>}
    </label>
  )
}

function SignBox({ disabled, onSign }: { disabled: boolean; onSign: (n: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="rounded-xl border border-surface-rule bg-surface-raised px-3 py-3">
      <p className="mb-2 text-[12px] text-text-muted">
        The GRN is made out but <strong className="text-text">not yet signed</strong>. The deliverer
        signs it here, on this device, before leaving the site.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Name of deliverer
          </span>
          <input value={name} onChange={e => setName(e.target.value)} disabled={disabled}
            placeholder="as it appears on their ID" className={inputCls()} />
        </label>
        <button onClick={() => onSign(name)} disabled={disabled || !name.trim()}
          className="rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
          Sign GRN on the platform
        </button>
      </div>
    </div>
  )
}

function ReasonDialog({ title, sub, body, options, confirmLabel, busy, onCancel, onConfirm }: {
  title: string; sub: string; body: string
  options: { v: string; t: string }[]; confirmLabel: string; busy: boolean
  onCancel: () => void; onConfirm: (category: string, reason: string) => void
}) {
  const [cat, setCat]       = useState(options[0].v)
  const [reason, setReason] = useState('')
  const ok = reason.trim().length > 2
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/45" onClick={onCancel} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-surface-rule bg-surface-card shadow-2xl">
        <header className="flex items-start justify-between border-b border-surface-rule px-4 py-3">
          <div>
            <div className="font-display text-[15px] font-bold text-text">{title}</div>
            <div className="text-[11px] text-text-muted">{sub}</div>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-text-faint hover:text-text">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-3 px-4 py-4">
          <div className="rounded-xl border border-warn/25 bg-warn-bg px-3 py-2.5 text-[12px] text-warn">{body}</div>
          <div className="flex flex-wrap gap-1.5">
            {options.map(o => (
              <button key={o.v} onClick={() => setCat(o.v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                  cat === o.v ? 'border-brand bg-accent-bg text-brand'
                              : 'border-surface-rule bg-surface-card text-text-muted'}`}>
                {o.t}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Reason <span className="text-err">*</span>
            </span>
            <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
              placeholder="what happened, in the operator's words" className={inputCls()} />
            <span className="mt-0.5 block text-[10px] text-text-faint">
              Written to the audit trail against your name and cannot be edited afterwards.
            </span>
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-surface-rule px-4 py-3">
          <button onClick={onCancel}
            className="rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px] font-semibold text-text">
            Cancel
          </button>
          <button onClick={() => onConfirm(cat, reason.trim())} disabled={!ok || busy}
            className="rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Working…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

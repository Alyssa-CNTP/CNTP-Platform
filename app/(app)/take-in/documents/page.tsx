'use client'

// app/(app)/take-in/documents/page.tsx
//
// The two producer documents, in the order they are made out:
//
//   AFLEWERINGSBEWYS — after the mini lab. Purchasing works from it, so it is
//     issued the day the load arrives, on mini-lab numbers alone. It says so on
//     its own face: "Finale Sertifikaat van Analise Volg".
//
//     ISSUING IT FREEZES PAYMENT. The sieve fractions, weights, bag count and
//     scores are snapshotted onto the document row, and settlement reads the
//     snapshot rather than the live batch — so a later correction cannot
//     silently move what a producer was paid. To change one, withdraw the
//     document; that is logged and it unfreezes the batch.
//
//   COA — after the confirming lab AND the third-party residue/PA result,
//     because those figures are on the face of it. Issuing without them would
//     be certifying nothing. It carries the SAME Ontvangsnota number as the
//     Afleweringsbewys: two documents about one delivery, not two receipts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { takeinDb, loadDepots, visibleDepots, allocateDocNo, logBatchEvent } from '@/lib/takein/db'
import type { Depot, FrozenFigures } from '@/lib/takein/types'
import {
  sieveTable, nettKg, grossKg, stageOf, prelimGroup, prelimPanel, panelBinding,
  isFinalised, shadeScore,
} from '@/lib/core/takein/grading'
import { Loader2, AlertTriangle, Lock, FileText, X } from 'lucide-react'

interface Doc {
  id: string; kind: string; doc_no: string; issued_at: string; issued_by_name: string | null
  frozen: FrozenFigures | null; voided_at: string | null
}
interface Row {
  id: string; batch_no: string; warehouse_id: string; contract_id: string
  begin_kg: number | null; end_kg: number | null; bags: number
  returned_at: string | null; returned_reason: string | null
  panel_outcome: string | null; panel_grade: string | null
  panel_reason: string | null; panel_covered: string[] | null
  contract: { contract_no: string; variant: string; producer: { name: string } | null } | null
  documents: Doc[]
  lab_results: any[]
}

const WITHDRAW_AFL = [
  { v: 'wrong_weight',   t: 'Wrong weight' }, { v: 'wrong_sieve', t: 'Sieve re-run' },
  { v: 'wrong_scores',   t: 'Scores corrected' }, { v: 'wrong_producer', t: 'Wrong producer' },
  { v: 'other',          t: 'Other' },
]

export default function DocumentsPage() {
  const { p, fullName, user, depotCodes } = useAuth()
  const canIssue = p('can_issue_takein_documents')
  const canVoid  = p('can_void_takein_document')
  const actor = { id: user?.id ?? null, name: fullName ?? 'Unknown' }

  const [depots, setDepots] = useState<Depot[]>([])
  const [rows, setRows]     = useState<Row[]>([])
  const [terms, setTerms]   = useState<Record<string, Record<string, boolean>>>({})
  const [selId, setSelId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [withdraw, setWithdraw] = useState<null | { doc: Doc; kind: 'afleweringsbewys' | 'coa' }>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const all = await loadDepots()
      const mine = visibleDepots(all, depotCodes)
      setDepots(mine)
      if (!mine.length) { setRows([]); return }
      const db = takeinDb()
      const { data, error } = await db.from('batches')
        .select(`
          id, batch_no, warehouse_id, contract_id, begin_kg, end_kg, bags,
          returned_at, returned_reason, panel_outcome, panel_grade, panel_reason, panel_covered,
          contract:contract_id ( contract_no, variant, producer:producer_id ( name ) ),
          documents ( id, kind, doc_no, issued_at, issued_by_name, frozen, voided_at ),
          lab_results ( source, sieve_json, moisture, density, shade, aroma, colour, taste,
                        agrees, residue_group, pa_group, residue_name, residue_level, pa_level )
        `)
        .in('warehouse_id', mine.map(d => d.id))
        .order('delivered_on', { ascending: false })
        .limit(300)
      if (error) throw error
      const list = (data as unknown as Row[]) ?? []
      setRows(list)
      setSelId(cur => cur && list.some(r => r.id === cur) ? cur : (list[0]?.id ?? null))

      const { data: t } = await db.from('contract_panel_terms').select('*')
      const map: Record<string, Record<string, boolean>> = {}
      for (const r of (t as any[]) ?? []) (map[r.contract_id] ??= {})[r.term_key] = r.binding
      setTerms(map)
    } catch (e: any) { setErr(e?.message ?? 'Could not load documents.') }
    finally { setLoading(false) }
  }, [depotCodes.join(',')])

  useEffect(() => { void load() }, [load])

  const b = useMemo(() => rows.find(r => r.id === selId) ?? null, [rows, selId])
  const depot = useMemo(() => depots.find(d => d.id === b?.warehouse_id) ?? null, [depots, b])
  const live = (k: string) => b?.documents?.find(d => d.kind === k && !d.voided_at) ?? null
  const grn = live('grn'), afl = live('afleweringsbewys'), coa = live('coa')

  const lab = (s: string) => b?.lab_results?.find((l: any) => l.source === s) ?? null
  const gradingInput = b ? {
    mini: lab('mini'), internal: lab('internal'), external: lab('external'),
    organic: /organic/i.test(b.contract?.variant ?? ''),
    binding: terms[b.contract_id] ?? {},
    returned: !!b.returned_at,
    panel: b.panel_outcome ? { outcome: b.panel_outcome as any, grade: b.panel_grade,
           reason: b.panel_reason ?? '', covered: b.panel_covered ?? [] } : null,
  } : null

  const st = gradingInput ? stageOf(gradingInput) : null
  const table = sieveTable(lab('mini')?.sieve_json ?? null)

  const aflReady = !!b && !!grn && !b.returned_at && !!lab('mini') && table.complete
  const coaReady = !!b && !!afl && !!lab('internal') && lab('internal')?.agrees !== false
                   && !!lab('external') && !!st && ['approved', 'rejected'].includes(st.stage)

  function snapshot(): FrozenFigures | null {
    if (!b) return null
    const m = lab('mini'); if (!m) return null
    return {
      sieve: m.sieve_json ?? {}, moisture: m.moisture ?? 0, density: m.density ?? 0,
      shade: m.shade ?? 0, aroma: m.aroma ?? 0, colour: m.colour ?? 0, taste: m.taste ?? 0,
      begin_kg: b.begin_kg ?? 0, end_kg: b.end_kg ?? 0, bags: b.bags,
      gross_kg: grossKg(b.begin_kg, b.end_kg), nett_kg: nettKg(b.begin_kg, b.end_kg, b.bags),
      pct: table.contribTotal, group: gradingInput ? prelimGroup(gradingInput) : '—',
      panel: gradingInput ? prelimPanel(gradingInput) : false,
    }
  }

  async function issueAfl() {
    if (!b || !depot || !aflReady) return
    setBusy(true)
    try {
      const no = await allocateDocNo(depot.id, 'doc')
      const frozen = snapshot()
      const { error } = await takeinDb().from('documents').insert({
        batch_id: b.id, kind: 'afleweringsbewys', doc_no: no,
        issued_by: user?.id ?? null, issued_by_name: actor.name, frozen,
      })
      if (error) throw error
      await logBatchEvent(b.id, 'afleweringsbewys_issued',
        `Afleweringsbewys ${no} made out — ${frozen?.group}, Verpligte Paneel Besluit `
        + `${frozen?.panel ? 'Ja' : 'Nee'} · figures FROZEN at ${frozen?.nett_kg.toLocaleString('en-ZA')} kg nett, `
        + `${frozen?.pct.toFixed(2)} % sieving`, actor, frozen as any)
      await load()
    } catch (e: any) { setErr(e?.message ?? 'Could not make out the Afleweringsbewys.') }
    finally { setBusy(false) }
  }

  async function issueCoa() {
    if (!b || !afl || !coaReady) return
    setBusy(true)
    try {
      // The SAME Ontvangsnota number — one delivery, two documents.
      const e = lab('external')
      const { error } = await takeinDb().from('documents').insert({
        batch_id: b.id, kind: 'coa', doc_no: afl.doc_no,
        issued_by: user?.id ?? null, issued_by_name: actor.name,
      })
      if (error) throw error
      await logBatchEvent(b.id, 'coa_issued',
        `COA ${afl.doc_no} made out — residue ${e?.residue_group ?? '—'}, PA ${e?.pa_group ?? '—'}`, actor)
      await load()
    } catch (e: any) { setErr(e?.message ?? 'Could not make out the COA.') }
    finally { setBusy(false) }
  }

  async function doWithdraw(category: string, reason: string) {
    if (!b || !withdraw) return
    setBusy(true)
    try {
      const db = takeinDb()
      const { error } = await db.from('documents').update({
        voided_at: new Date().toISOString(), voided_by: user?.id ?? null,
        voided_by_name: actor.name, void_category: category, void_reason: reason,
      }).eq('id', withdraw.doc.id)
      if (error) throw error
      await logBatchEvent(b.id,
        withdraw.kind === 'coa' ? 'coa_withdrawn' : 'afleweringsbewys_withdrawn',
        `${withdraw.kind === 'coa' ? 'COA' : 'Afleweringsbewys'} ${withdraw.doc.doc_no} WITHDRAWN `
        + `(${category.replace(/_/g, ' ')}) — ${reason}`
        + (withdraw.kind === 'afleweringsbewys' ? ' · payment figures unfrozen' : ''), actor)

      // Withdrawing the Afleweringsbewys takes any COA issued off it with it —
      // the COA's numbers came from a document that no longer stands.
      if (withdraw.kind === 'afleweringsbewys' && coa) {
        await db.from('documents').update({
          voided_at: new Date().toISOString(), voided_by: user?.id ?? null,
          voided_by_name: actor.name, void_category: 'afl_withdrawn', void_reason: reason,
        }).eq('id', coa.id)
        await logBatchEvent(b.id, 'coa_withdrawn',
          `COA ${coa.doc_no} VOIDED — Afleweringsbewys withdrawn`, actor)
      }
      setWithdraw(null)
      await load()
    } catch (e: any) { setErr(e?.message ?? 'Could not withdraw the document.') }
    finally { setBusy(false) }
  }

  const kg = (n: number) => n.toLocaleString('en-ZA', { maximumFractionDigits: 0 })

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
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
          </header>
          <ul className="max-h-[620px] overflow-y-auto">
            {rows.map(r => {
              const a = r.documents?.find(d => d.kind === 'afleweringsbewys' && !d.voided_at)
              const c = r.documents?.find(d => d.kind === 'coa' && !d.voided_at)
              return (
                <li key={r.id}>
                  <button onClick={() => setSelId(r.id)}
                    className={`w-full border-b border-surface-rule px-4 py-3 text-left last:border-0 ${
                      r.id === selId ? 'bg-accent-bg' : 'hover:bg-surface-raised'}`}>
                    <div className="font-mono text-[12px] font-semibold text-text">{r.batch_no}</div>
                    <div className="text-[11px] text-text-muted">{r.contract?.producer?.name ?? '—'}</div>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      r.returned_at ? 'bg-err-bg text-err' : c ? 'bg-ok-bg text-ok'
                      : a ? 'bg-warn-bg text-warn' : 'bg-surface-dim text-text-muted'}`}>
                      {r.returned_at ? 'Returned' : c ? 'COA issued' : a ? 'Afl. made out' : 'Awaiting'}
                    </span>
                  </button>
                </li>
              )
            })}
            {!rows.length && (
              <li className="px-4 py-8 text-center text-[12px] text-text-muted">Nothing received yet.</li>
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
                  <strong>⚑ This load was returned to the producer.</strong> {b.returned_reason} — no
                  document is issued for material that never became stock.
                </div>
              )}

              {/* Afleweringsbewys */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">
                    {b.batch_no} · Afleweringsbewys
                  </span>
                  <span className="text-[11px] text-text-muted">after the mini lab · for purchasing</span>
                </header>
                <div className="space-y-3 px-4 py-4">
                  {afl ? (
                    <>
                      <div className="rounded-xl border border-ok/25 bg-ok-bg px-3 py-2.5 text-[12px] text-ok">
                        ✓ <strong>{afl.doc_no}</strong> made out{' '}
                        {new Date(afl.issued_at).toLocaleString('en-ZA')} by {afl.issued_by_name}
                        {afl.frozen && (
                          <div className="mt-1">
                            <Lock className="mr-1 inline h-3.5 w-3.5" />
                            Payment figures frozen at <strong>{kg(afl.frozen.nett_kg)} kg</strong> nett over{' '}
                            {afl.frozen.bags} bags · {afl.frozen.pct.toFixed(2)} % sieving ·{' '}
                            {afl.frozen.group} · Verpligte Paneel Besluit {afl.frozen.panel ? 'Ja' : 'Nee'}
                          </div>
                        )}
                      </div>
                      <button onClick={() => setWithdraw({ doc: afl, kind: 'afleweringsbewys' })}
                        disabled={!canVoid || busy}
                        className="rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px] font-semibold text-text disabled:opacity-40">
                        Withdraw…
                      </button>
                      {!canVoid && <p className="text-[11px] text-text-faint">Withdrawing needs the supervisor override — it unfreezes the payment figures.</p>}
                    </>
                  ) : aflReady ? (
                    <>
                      <p className="text-[12px] leading-relaxed text-text-muted">
                        The mini lab has its numbers, so this can be made out now — purchasing works from
                        it. It carries no residue or PA figure; the COA follows with those.
                        <strong className="text-text"> Making it out freezes the payment figures.</strong>
                      </p>
                      <button onClick={() => void issueAfl()} disabled={!canIssue || busy}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
                        <FileText className="h-3.5 w-3.5" /> Make out the Afleweringsbewys
                      </button>
                    </>
                  ) : (
                    <p className="rounded-xl border border-surface-rule bg-surface-dim px-3 py-2.5 text-[12px] text-text-muted">
                      Waiting on{' '}
                      {[!grn && 'a signed GRN', !lab('mini') && 'the mini lab',
                        lab('mini') && !table.complete && 'a complete 400 g sieve sample',
                        b.returned_at && 'nothing — the load went back']
                        .filter(Boolean).join(', ') || 'the mini lab'}.
                    </p>
                  )}
                </div>
              </section>

              {/* COA */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">
                    {b.batch_no} · Sertifikaat van Analise
                  </span>
                  <span className="text-[11px] text-text-muted">{coa ? coa.doc_no : 'not made out'}</span>
                </header>
                <div className="space-y-3 px-4 py-4">
                  {coa ? (
                    <>
                      <div className="rounded-xl border border-ok/25 bg-ok-bg px-3 py-2.5 text-[12px] text-ok">
                        ✓ <strong>{coa.doc_no}</strong> made out{' '}
                        {new Date(coa.issued_at).toLocaleString('en-ZA')} by {coa.issued_by_name}
                        <div className="mt-1">
                          Paneel Betrokke: <strong>{gradingInput && panelBinding(gradingInput) ? 'Ja' : 'Nee'}</strong>
                          {' · '}Leaf Shade (1–11): <strong>{lab('internal')?.shade ?? lab('mini')?.shade ?? '—'}</strong>
                        </div>
                      </div>
                      <button onClick={() => setWithdraw({ doc: coa, kind: 'coa' })} disabled={!canVoid || busy}
                        className="rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px] font-semibold text-text disabled:opacity-40">
                        Withdraw…
                      </button>
                    </>
                  ) : coaReady ? (
                    <>
                      <p className="text-[12px] leading-relaxed text-text-muted">
                        Both labs have reported and the grade is final. The certificate carries the same
                        Ontvangsnota number as the Afleweringsbewys — two documents about one delivery.
                      </p>
                      <button onClick={() => void issueCoa()} disabled={!canIssue || busy}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
                        <FileText className="h-3.5 w-3.5" /> Make out the COA
                      </button>
                    </>
                  ) : (
                    <p className="rounded-xl border border-surface-rule bg-surface-dim px-3 py-2.5 text-[12px] text-text-muted">
                      Waiting on{' '}
                      {[!afl && 'the Afleweringsbewys', !lab('internal') && 'the confirming lab',
                        lab('internal')?.agrees === false && 'a panel decision on the dispute',
                        !lab('external') && 'the third-party residue and PA result',
                        st?.stage === 'panel' && 'the panel decision']
                        .filter(Boolean).join(', ') || 'a final grade'}.
                      <br /><br />
                      The COA waits for the third-party result because those figures are on the face of it —
                      issuing without them would be certifying nothing. The producer is not left
                      empty-handed: they hold the GRN{afl ? ` and Afleweringsbewys ${afl.doc_no}` : ''}.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {withdraw && b && (
        <WithdrawDialog kind={withdraw.kind} docNo={withdraw.doc.doc_no}
          hasCoa={withdraw.kind === 'afleweringsbewys' && !!coa} busy={busy}
          onCancel={() => setWithdraw(null)} onConfirm={doWithdraw} />
      )}
    </div>
  )
}

function WithdrawDialog({ kind, docNo, hasCoa, busy, onCancel, onConfirm }: {
  kind: 'afleweringsbewys' | 'coa'; docNo: string; hasCoa: boolean; busy: boolean
  onCancel: () => void; onConfirm: (category: string, reason: string) => void
}) {
  const [cat, setCat] = useState(WITHDRAW_AFL[0].v)
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/45" onClick={onCancel} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-surface-rule bg-surface-card shadow-2xl">
        <header className="flex items-start justify-between border-b border-surface-rule px-4 py-3">
          <div className="font-display text-[15px] font-bold text-text">
            Withdraw {kind === 'coa' ? 'COA' : 'Afleweringsbewys'} {docNo}
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-text-faint hover:text-text"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-3 px-4 py-4">
          <div className="rounded-xl border border-warn/25 bg-warn-bg px-3 py-2.5 text-[12px] text-warn">
            <strong>The producer may already hold a copy.</strong>{' '}
            {kind === 'afleweringsbewys'
              ? `Withdrawing unfreezes the sieve fractions, weights, bag count and scores so they can be corrected — and the payment built off them changes with it.${hasCoa ? ' The COA issued off this is withdrawn too.' : ''}`
              : 'Withdrawing removes it from the batch and logs it.'}
            {' '}The number <span className="font-mono">{docNo}</span> is <strong>not</strong> reissued.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WITHDRAW_AFL.map(o => (
              <button key={o.v} onClick={() => setCat(o.v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                  cat === o.v ? 'border-brand bg-accent-bg text-brand'
                              : 'border-surface-rule bg-surface-card text-text-muted'}`}>{o.t}</button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Reason <span className="text-err">*</span>
            </span>
            <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
              className="w-full rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[13px] text-text" />
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-surface-rule px-4 py-3">
          <button onClick={onCancel} className="rounded-xl border border-surface-rule px-3.5 py-2 text-[12px] font-semibold text-text">Cancel</button>
          <button onClick={() => onConfirm(cat, reason.trim())} disabled={reason.trim().length < 3 || busy}
            className="rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Working…' : 'Withdraw'}
          </button>
        </footer>
      </div>
    </div>
  )
}

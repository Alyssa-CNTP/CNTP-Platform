'use client'

// app/(app)/take-in/mini-lab/page.tsx
//
// The site mini lab — Graafwater and Vanrhynsdorp. Sieve analysis, moisture,
// density and the sensory reading, against a batch.
//
// LEAF SHADE IS NOT REBUILT HERE. The Canon CR3 → ML classifier already exists
// on Quality → Raw Material and writes qms.quality_records (workflow =
// 'leaf_shade'). This page:
//
//   * reads THAT table, filtered to this batch's site, and offers the shade it
//     already predicted so the operator does not retype it;
//   * links the row it used onto takein.lab_results.quality_record_id, so the
//     photo and the grading number stay tied together;
//   * leaves BLACKHEATH's leaf shade exactly where it is. That is the
//     confirming reading on a different screen for a different team, and
//     duplicating it here would create two places to look for one answer.
//
// The classifier itself stays in one place. If it moves, it moves once.

import type { LabRow, PanelOutcome } from '@/lib/takein/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { takeinDb, loadSites, logBatchEvent, releaseBatchNo, errMsg, scopedSites, siteCodeFrom } from '@/lib/takein/db'
import { SIEVE_FRACTIONS, type Site } from '@/lib/takein/types'
import {
  sieveTable, shadeScore, stageOf, prelimGroup, panelTriggers, isFinalised,
} from '@/lib/core/takein/grading'
import { Loader2, AlertTriangle, Leaf, Lock, Undo2, ExternalLink, X } from 'lucide-react'

interface ShadeRecord {
  id: number; batch_number: string; created_at: string
  data_json: { location?: string; predicted_shade?: string | number
               physical_shade?: string | number; confidence_pct?: number
               observation?: string | null }
}
interface Row {
  id: string; batch_no: string; location_code: string; delivered_on: string
  returned_at: string | null; returned_reason: string | null
  panel_outcome: PanelOutcome | null; panel_grade: string | null
  panel_reason: string | null; panel_covered: string[] | null
  contract: { contract_no: string; variant: string; producer: { name: string } | null } | null
  documents: { kind: string; doc_no: string; voided_at: string | null }[]
  lab_results: LabRow[]
}

const RETURN_REASONS = [
  { v: 'moisture', t: 'Moisture too high' }, { v: 'density', t: 'Mass density' },
  { v: 'sensory',  t: 'Sensory failure' },   { v: 'foreign', t: 'Foreign matter' },
  { v: 'other',    t: 'Other' },
]

/** An all-null lab row. Lets a partial capture merge into a complete LabRow
 *  instead of being spread over an untyped object literal. */
function blankLabRow(source: LabRow['source']): LabRow {
  return {
    source, sieve_json: null, moisture: null, density: null, shade: null,
    aroma: null, colour: null, taste: null,
    residue_name: null, residue_level: null, residue_group: null,
    pa_level: null, pa_group: null,
    agrees: null, variance_note: null, dispute_note: null,
    quality_record_id: null, captured_by_name: null, captured_at: '',
  }
}

export default function MiniLabPage() {
  const { p, fullName, user, depotCodes } = useAuth()
  // This screen is always working on one site — the code is in the route.
  const routeCode = useParams<{ code: string }>().code
  const siteParam = siteCodeFrom(routeCode, useSearchParams().get('site'))
  const canCapture = p('can_capture_takein_minilab')
  const canReturn  = p('can_return_takein_load')
  const actor = { id: user?.id ?? null, name: fullName ?? 'Unknown' }

  const [sites, setSites] = useState<Site[]>([])
  const [rows, setRows]     = useState<Row[]>([])
  const [shades, setShades] = useState<ShadeRecord[]>([])
  const [selId, setSelId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [returning, setReturning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const all = await loadSites()
      // Only the sites that actually take a farmer delivery run a mini lab.
      const mine = scopedSites(all, depotCodes, siteParam).filter(d => d.takes_farmer_delivery)
      setSites(mine)
      if (!mine.length) { setRows([]); return }

      const { data, error } = await takeinDb().from('batches')
        .select(`
          id, batch_no, location_code, delivered_on, returned_at, returned_reason,
          panel_outcome, panel_grade, panel_reason, panel_covered,
          contract:contract_id ( contract_no, variant, producer:producer_id ( name ) ),
          documents ( kind, doc_no, voided_at ),
          lab_results ( source, sieve_json, moisture, density, shade, aroma, colour, taste,
                        agrees, residue_group, pa_group, quality_record_id )
        `)
        .in('location_code', mine.map(d => d.code))
        .order('delivered_on', { ascending: false })
        .limit(300)
      if (error) throw error
      const list = (data as unknown as Row[]) ?? []
      setRows(list)
      setSelId(cur => cur && list.some(r => r.id === cur) ? cur : (list[0]?.id ?? null))

      // The classifier's own records — the existing store, not a copy of it.
      const { data: sh } = await getDb().schema('qms' as never)
        .from('quality_records')
        .select('id, batch_number, created_at, data_json')
        .eq('workflow', 'leaf_shade')
        .order('created_at', { ascending: false })
        .limit(400)
      setShades((sh as unknown as ShadeRecord[]) ?? [])
    } catch (e: unknown) { setErr(errMsg(e, 'Could not load the mini lab.')) }
    finally { setLoading(false) }
  }, [depotCodes.join(','), siteParam])

  useEffect(() => { void load() }, [load])

  const b = useMemo(() => rows.find(r => r.id === selId) ?? null, [rows, selId])
  const site = useMemo(() => sites.find(d => d.code === b?.location_code) ?? null, [sites, b])
  const mini  = b?.lab_results?.find((l: LabRow) => l.source === 'mini') ?? null
  const grn   = b?.documents?.find(d => d.kind === 'grn' && !d.voided_at) ?? null
  const afl   = b?.documents?.find(d => d.kind === 'afleweringsbewys' && !d.voided_at) ?? null
  const locked = !!afl

  // Only batches with a signed GRN and still in play.
  const queue = useMemo(() => rows.filter(r => {
    const g = r.documents?.some(d => d.kind === 'grn' && !d.voided_at)
    if (!g) return false
    const lab = (s: string) => r.lab_results?.find((l: LabRow) => l.source === s) ?? null
    const st = stageOf({ mini: lab('mini'), internal: lab('internal'), external: lab('external'),
                         organic: /organic/i.test(r.contract?.variant ?? ''), binding: {},
                         returned: !!r.returned_at,
                         panel: r.panel_outcome ? { outcome: r.panel_outcome, grade: r.panel_grade,
                                reason: r.panel_reason ?? '', covered: r.panel_covered ?? [] } : null })
    const hasCoa = r.documents?.some(d => d.kind === 'coa' && !d.voided_at) ?? false
    return !isFinalised(st.stage, hasCoa) || r.id === selId
  }), [rows, selId])

  // Classifier rows for this batch, at this site.
  const shadeForBatch = useMemo(() => {
    if (!b || !site) return [] as ShadeRecord[]
    const depotName = site.name.replace(/\s*Site$/i, '').trim()
    return shades.filter(s =>
      s.batch_number?.trim().toUpperCase() === b.batch_no.toUpperCase()
      && (s.data_json?.location ?? '').toLowerCase().includes(depotName.toLowerCase()))
  }, [shades, b, site])

  const table = sieveTable(mini?.sieve_json ?? null)
  const gradingInput = b ? {
    mini, internal: b.lab_results?.find((l: LabRow) => l.source === 'internal') ?? null,
    external: b.lab_results?.find((l: LabRow) => l.source === 'external') ?? null,
    organic: /organic/i.test(b.contract?.variant ?? ''), binding: {},
  } : null

  async function saveMini(fields: Partial<LabRow>) {
    if (!b || !canCapture || locked) return
    // Merged onto a blank row rather than spread over `{}`, so `next` is a
    // complete LabRow and the same value can go to the upsert AND into state
    // without a cast — a cast here is what would let a stray field through.
    const next: LabRow = {
      ...blankLabRow('mini'), ...(mini ?? {}), ...fields,
      captured_by_name: actor.name, captured_at: new Date().toISOString(),
    }
    const { error } = await takeinDb().from('lab_results')
      .upsert({ ...next, batch_id: b.id, captured_by: user?.id ?? null },
              { onConflict: 'batch_id,source' })
    if (error) { setErr(error.message); return }
    setRows(rs => rs.map(r => r.id !== b.id ? r : {
      ...r, lab_results: [...(r.lab_results ?? []).filter((l: LabRow) => l.source !== 'mini'), next],
    }))
  }

  async function startMini() {
    if (!b) return
    setBusy(true)
    await saveMini({ sieve_json: { '>10': 0, '>12': 0, '>18': 0, '>20': 0, '>40': 0, '<40': 0 },
                     moisture: null, density: null, shade: null, aroma: null, colour: null, taste: null })
    await logBatchEvent(b.id, 'minilab_started', 'Mini lab opened', actor)
    setBusy(false)
  }

  async function applyShadeRecord(rec: ShadeRecord) {
    const v = Number(rec.data_json?.physical_shade ?? rec.data_json?.predicted_shade)
    if (!Number.isFinite(v)) return
    await saveMini({ shade: v, quality_record_id: rec.id })
    if (b) await logBatchEvent(b.id, 'minilab_shade_linked',
      `Leaf shade ${v} taken from classifier record #${rec.id}`, actor)
  }

  async function doReturn(category: string, reason: string) {
    if (!b || !site) return
    setBusy(true)
    try {
      const db = takeinDb()
      if (grn) {
        await db.from('documents').update({
          voided_at: new Date().toISOString(), voided_by: user?.id ?? null,
          voided_by_name: actor.name, void_category: 'returned', void_reason: reason,
        }).eq('batch_id', b.id).eq('kind', 'grn').is('voided_at', null)
        await logBatchEvent(b.id, 'grn_voided', `GRN ${grn.doc_no} VOIDED — load returned`, actor)
      }
      const { error } = await db.from('batches').update({
        returned_at: new Date().toISOString(), returned_by: user?.id ?? null,
        returned_stage: 'mini', returned_category: category, returned_reason: reason,
      }).eq('id', b.id)
      if (error) throw error
      await releaseBatchNo(site.code, b.batch_no)
      await logBatchEvent(b.id, 'load_returned',
        `RETURNED to producer at the mini lab (${category.replace(/_/g, ' ')}) — ${reason}`
        + ` · batch number ${b.batch_no} released`, actor)
      setReturning(false)
      await load()
    } catch (e: unknown) { setErr(errMsg(e, 'Could not return the load.')) }
    finally { setBusy(false) }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading the mini lab…
    </div>
  )

  if (!sites.length) return (
    <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-8 text-center text-[12px] text-text-muted">
      No mini-lab site is in scope for your account. The mini lab runs at Graafwater and
      Vanrhynsdorp; Blackheath&rsquo;s confirming reading lives on Quality → Raw Material.
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
            <span className="font-display text-[14px] font-semibold text-text">Awaiting the lab</span>
            <span className="ml-2 font-mono text-[11px] text-text-muted">{queue.length}</span>
          </header>
          <ul className="max-h-[620px] overflow-y-auto">
            {queue.map(r => (
              <li key={r.id}>
                <button onClick={() => setSelId(r.id)}
                  className={`w-full border-b border-surface-rule px-4 py-3 text-left last:border-0 ${
                    r.id === selId ? 'bg-accent-bg' : 'hover:bg-surface-raised'}`}>
                  <div className="font-mono text-[12px] font-semibold text-text">{r.batch_no}</div>
                  <div className="text-[11px] text-text-muted">{r.contract?.producer?.name ?? '—'}</div>
                  <div className="font-mono text-[10px] text-text-faint">
                    {r.lab_results?.some((l: LabRow) => l.source === 'mini') ? 'in progress' : 'not started'}
                  </div>
                </button>
              </li>
            ))}
            {!queue.length && (
              <li className="px-4 py-8 text-center text-[12px] text-text-muted">
                Nothing waiting. A batch appears here once its GRN is made out.
              </li>
            )}
          </ul>
        </aside>

        <div className="space-y-4">
          {!b ? (
            <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-8 text-center text-[12px] text-text-muted">
              Select a batch.
            </div>
          ) : !mini ? (
            <section className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-6 text-center">
              <p className="mb-3 text-[13px] text-text-muted">
                No mini-lab result captured for <strong className="text-text">{b.batch_no}</strong> yet.
              </p>
              <button onClick={() => void startMini()} disabled={!canCapture || busy}
                className="rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
                Capture mini lab
              </button>
            </section>
          ) : (
            <>
              {locked && (
                <div className="rounded-xl border border-info/25 bg-info-bg px-4 py-3 text-[12px] text-info">
                  <Lock className="mr-1.5 inline h-4 w-4" />
                  <strong>Frozen by Afleweringsbewys {afl?.doc_no}.</strong> Payment is built off that
                  document and the producer holds a copy, so the sieve fractions, weights and scores
                  cannot move. Withdraw it on Documents to correct something.
                </div>
              )}
              {b.returned_at && (
                <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
                  <strong>⚑ Returned to the producer.</strong> {b.returned_reason}
                </div>
              )}

              {/* sieve */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">
                    {b.batch_no} · sieving analysis
                  </span>
                  <span className="text-[11px] text-text-muted">{site?.name} · 400 g sample</span>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-surface-rule bg-surface-raised">
                      {['Fraction', 'Grams', '% Verdeling', 'Faktor', 'Contribution'].map(h => (
                        <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {table.rows.map(r => (
                        <tr key={r.key} className="border-b border-surface-rule last:border-0">
                          <td className="px-4 py-2 text-[12px] text-text">{r.label}</td>
                          <td className="px-4 py-2">
                            <input type="text" inputMode="numeric" defaultValue={r.grams}
                              disabled={!canCapture || locked}
                              className="w-20 rounded-lg border border-surface-rule bg-surface-card px-2 py-1 font-mono text-[12px] text-text disabled:opacity-60"
                              onBlur={e => {
                                const v = Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)
                                void saveMini({ sieve_json: { ...(mini.sieve_json ?? {}), [r.key]: v } })
                              }} />
                          </td>
                          <td className="px-4 py-2 font-mono text-[12px] text-text-muted">{r.pct.toFixed(2)} %</td>
                          <td className="px-4 py-2 font-mono text-[12px] text-text-muted">{r.factor.toFixed(2)}</td>
                          <td className="px-4 py-2 font-mono text-[12px] text-text">{r.contrib.toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr className="bg-surface-raised">
                        <td className="px-4 py-2 text-[12px] font-semibold text-text">Total</td>
                        <td className={`px-4 py-2 font-mono text-[12px] font-semibold ${table.complete ? 'text-ok' : 'text-err'}`}>
                          {table.totalGrams} g
                        </td>
                        <td className="px-4 py-2 font-mono text-[12px] text-text">{table.pctTotal.toFixed(2)} %</td>
                        <td className="px-4 py-2 text-[11px] text-text-muted">{table.complete ? '399–401 g ✓' : 'must be 399–401 g'}</td>
                        <td className="px-4 py-2 font-mono text-[12px] font-bold text-brand">{table.contribTotal.toFixed(2)} %</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {table.contribTotal !== table.contribOnce && (
                  <p className="border-t border-surface-rule px-4 py-2.5 text-[11px] text-text-muted">
                    Totalling method matters here: <strong className="text-text">{table.contribTotal.toFixed(2)} %</strong>{' '}
                    summing the rounded rows versus <strong className="text-text">{table.contribOnce.toFixed(2)} %</strong>{' '}
                    rounding the exact sum. All ten signed delivery notes use the first.
                  </p>
                )}
              </section>

              {/* physical + sensory */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">Physical &amp; sensory</span>
                </header>
                <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
                  <Num label="Moisture %" value={mini.moisture} disabled={!canCapture || locked}
                    hint="≥ 10 % rejects immediately" onCommit={v => void saveMini({ moisture: v })} />
                  <Num label="Massadigtheid" value={mini.density} disabled={!canCapture || locked}
                    onCommit={v => void saveMini({ density: v })} />
                  <Num label="Leaf Shade (1–11)" value={mini.shade} disabled={!canCapture || locked}
                    hint={mini.shade == null ? 'from the classifier, or typed'
                      : shadeScore(mini.shade) == null
                        ? 'carries no score — outside the curve'
                        : `maps to score ${shadeScore(mini.shade)}`}
                    onCommit={v => void saveMini({ shade: v })} />
                  <Num label="Cup Aroma"  value={mini.aroma}  disabled={!canCapture || locked} onCommit={v => void saveMini({ aroma: v })} />
                  <Num label="Cup Colour" value={mini.colour} disabled={!canCapture || locked} onCommit={v => void saveMini({ colour: v })} />
                  <Num label="Cup Taste"  value={mini.taste}  disabled={!canCapture || locked} onCommit={v => void saveMini({ taste: v })} />
                </div>
              </section>

              {/* leaf shade — the EXISTING classifier */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 font-display text-[14px] font-semibold text-text">
                    <Leaf className="h-4 w-4 text-accent" /> Leaf shade — {site?.name}
                  </span>
                  <Link href="/quality/raw-material"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline">
                    Open the classifier <ExternalLink className="h-3 w-3" />
                  </Link>
                </header>
                <div className="px-4 py-4">
                  <p className="mb-3 text-[12px] leading-relaxed text-text-muted">
                    The Canon CR3 classifier lives on <strong className="text-text">Quality → Raw Material</strong>{' '}
                    and writes <span className="font-mono">qms.quality_records</span>. This panel reads that
                    same store — it is not a second copy. Upload the photo there against batch{' '}
                    <span className="font-mono text-text">{b.batch_no}</span> at{' '}
                    <span className="font-mono text-text">{site?.name.replace(/\s*Site$/i, '')}</span>, then
                    take the reading across.
                  </p>
                  {shadeForBatch.length ? (
                    <ul className="divide-y divide-surface-rule">
                      {shadeForBatch.map(rec => {
                        const shown = rec.data_json?.physical_shade ?? rec.data_json?.predicted_shade
                        const used  = mini.quality_record_id === rec.id
                        return (
                          <li key={rec.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                            <span className="text-[12px] text-text">
                              Shade <strong className="font-mono">{String(shown ?? '—')}</strong>
                              {rec.data_json?.confidence_pct != null && (
                                <span className="ml-1.5 text-[11px] text-text-muted">
                                  {Number(rec.data_json.confidence_pct).toFixed(0)} % confidence
                                </span>
                              )}
                              <span className="ml-1.5 font-mono text-[10px] text-text-faint">
                                #{rec.id} · {new Date(rec.created_at).toLocaleDateString('en-ZA')}
                              </span>
                            </span>
                            {used ? (
                              <span className="rounded-full bg-ok-bg px-2.5 py-1 text-[10px] font-semibold text-ok">
                                ✓ used for this batch
                              </span>
                            ) : (
                              <button onClick={() => void applyShadeRecord(rec)} disabled={!canCapture || locked}
                                className="rounded-lg border border-surface-rule px-2.5 py-1 text-[11px] font-semibold text-text disabled:opacity-40">
                                Use this reading
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="rounded-xl border border-surface-rule bg-surface-dim px-3 py-2.5 text-[12px] text-text-muted">
                      No classifier record for {b.batch_no} at this site yet. The shade can still be typed
                      above — the classifier is an aid, not a gate.
                    </p>
                  )}
                </div>
              </section>

              {/* where it stands */}
              {gradingInput && (
                <section className={`rounded-2xl border px-4 py-3 ${
                  table.complete ? 'border-ok/25 bg-ok-bg' : 'border-surface-rule bg-surface-card'}`}>
                  <div className="text-[12px] text-text">
                    Preliminary raw material group: <strong>{prelimGroup(gradingInput)}</strong>
                    {' · '}Sieving <strong>{table.contribTotal.toFixed(2)} %</strong>
                  </div>
                  {panelTriggers(gradingInput).filter(t => t.when === 'mini').map(t => (
                    <div key={t.why} className="mt-1 text-[11px] text-warn">• {t.why}</div>
                  ))}
                  <p className="mt-1.5 text-[11px] text-text-muted">
                    Known from the mini lab&rsquo;s own numbers — it does not wait on the residue result.
                    Whether a finding reaches the producer is decided by the contract&rsquo;s panel terms.
                  </p>
                </section>
              )}

              {!b.returned_at && (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setReturning(true)} disabled={!canReturn || busy}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px] font-semibold text-text disabled:opacity-40">
                    <Undo2 className="h-3.5 w-3.5" /> Return to producer…
                  </button>
                  <Link href="/take-in/documents"
                    className="rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white">
                    Documents →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {returning && b && (
        <MiniReturnDialog batchNo={b.batch_no} contractNo={b.contract?.contract_no ?? ''}
          depotName={site?.name ?? ''} grnNo={grn?.doc_no ?? null} busy={busy}
          onCancel={() => setReturning(false)} onConfirm={doReturn} />
      )}
    </div>
  )
}

function Num({ label, value, hint, disabled, onCommit }: {
  label: string; value: number | null; hint?: string; disabled?: boolean
  onCommit: (v: number | null) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <input type="text" inputMode="decimal" defaultValue={value ?? ''} disabled={disabled}
        className="w-full rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 font-mono text-[13px] text-text disabled:opacity-60"
        onBlur={e => {
          const raw = e.target.value.replace(/[^\d.-]/g, '')
          onCommit(raw === '' ? null : Number(raw))
        }} />
      {hint && <span className="mt-0.5 block text-[10px] text-text-faint">{hint}</span>}
    </label>
  )
}

function MiniReturnDialog({ batchNo, contractNo, depotName, grnNo, busy, onCancel, onConfirm }: {
  batchNo: string; contractNo: string; depotName: string; grnNo: string | null; busy: boolean
  onCancel: () => void; onConfirm: (category: string, reason: string) => void
}) {
  const [cat, setCat] = useState(RETURN_REASONS[0].v)
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/45" onClick={onCancel} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-surface-rule bg-surface-card shadow-2xl">
        <header className="flex items-start justify-between border-b border-surface-rule px-4 py-3">
          <div>
            <div className="font-display text-[15px] font-bold text-text">Return {batchNo} to the producer</div>
            <div className="text-[11px] text-text-muted">{depotName}</div>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-text-faint hover:text-text"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-3 px-4 py-4">
          <div className="rounded-xl border border-warn/25 bg-warn-bg px-3 py-2.5 text-[12px] text-warn">
            The material goes back on the truck. It is not graded, it never counts against {contractNo},
            and no COA is issued.{grnNo && ` GRN ${grnNo} is voided with the same reason.`} Batch number{' '}
            {batchNo} is released and goes to the next delivery at {depotName}.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RETURN_REASONS.map(o => (
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
            {busy ? 'Working…' : 'Return the load'}
          </button>
        </footer>
      </div>
    </div>
  )
}

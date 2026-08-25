'use client'

/**
 * PalletPanel — turns one Pasteuriser bagging line into pallets and tags.
 * ─────────────────────────────────────────────────────────────────────────────
 * A bagging line on PR-FM-005 is a BAG RANGE ("40 bags, 281→320, 18kg each").
 * What physically leaves the factory is a pallet, and every box on it needs its
 * own tag. This panel is the bridge:
 *
 *   1. proposes a split of the range into pallets (from the packaging spec),
 *   2. lets the operator adjust boxes-per-pallet and confirm it,
 *   3. prints the pallet tag, and the box tags, or records that they were
 *      hand-written.
 *
 * Its own file because PasteuriserCapture is already large and this is a
 * self-contained step of the process; and because the split is the part most
 * likely to need floor-driven tweaking, which is easier when it isn't buried
 * inside a 1500-line capture screen.
 *
 * WHY THE OPERATOR CONFIRMS RATHER THAN THE SYSTEM DECIDING
 * The last pallet of a batch is nearly always short, pallets get consolidated,
 * and a paper-bag order palletises differently from a box order. An automatic
 * split that can't be corrected would be wrong often enough that operators
 * would stop trusting it — so the system proposes and the operator commits.
 * Until they commit, nothing is written and nothing is printed.
 */

import { useState } from 'react'
import { Layers, Printer, PenLine, Check, AlertTriangle, RotateCcw, Loader2 } from 'lucide-react'
import {
  splitIntoPallets, boxesPerPalletFor, makePalletSerial, makeBoxSerial,
  DEFAULT_BOXES_PER_PALLET,
} from '@/lib/production/pallet'
import { printFinalLabelsAuto, type FinalProductLabel } from '@/lib/production/label-final'

const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const n = (v: string | number | null | undefined) => parseFloat(String(v ?? '').replace(',', '.')) || 0

/** One committed pallet on a bagging line. */
export interface PastPallet {
  id: string
  serial: string
  index: number
  startBagNo: number
  endBagNo: number
  boxCount: number
  totalKg: number
  /** How the PALLET's own tag was produced. */
  tagMethod: 'printed' | 'handwritten' | null
  /** How the individual BOX tags on it were produced. */
  boxTagMethod: 'printed' | 'handwritten' | null
  logged_at?: string
}

export interface PalletContext {
  item: string
  itemCode: string | null
  lot: string
  variant: string
  packaging: string | null
  markings?: string | null
  customerPo?: string | null
  /** Total bags in the whole batch — the "of 315" on each box tag. */
  batchBagTotal?: number | null
}

export function PalletPanel({
  boxCount, startBagNo, boxWeightKg, boxesPerPallet, pallets, ctx, locked,
  onChange,
}: {
  boxCount: number
  startBagNo: number | null
  boxWeightKg: number
  /** Operator override; blank/null means derive from the packaging spec. */
  boxesPerPallet: string
  pallets: PastPallet[]
  ctx: PalletContext
  locked: boolean
  onChange: (patch: { boxesPerPallet?: string; pallets?: PastPallet[] }) => void
}) {
  const [printing, setPrinting] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const specPer = boxesPerPalletFor(ctx.packaging)
  const per = n(boxesPerPallet) || specPer || DEFAULT_BOXES_PER_PALLET
  const proposal = splitIntoPallets({ boxCount, startBagNo, boxesPerPallet: per, boxWeightKg })
  const committed = pallets ?? []

  // The committed split can go stale — the operator raises the bag count, or
  // corrects the starting bag number, after committing. Rather than silently
  // re-splitting behind them (which would renumber pallets whose tags are
  // already stuck on physical stock), we flag it and let them re-propose.
  const stale = committed.length > 0 && (
    committed.length !== proposal.length ||
    committed.some((c, i) => proposal[i] &&
      (c.startBagNo !== proposal[i].startBagNo || c.boxCount !== proposal[i].boxCount))
  )

  function commit() {
    const now = new Date().toISOString()
    onChange({
      pallets: proposal.map(p => {
        // Preserve an already-committed pallet's tag state across a re-split —
        // but ONLY when it still covers exactly the same bags. Matching on
        // index alone would carry a "printed" record onto a pallet that now
        // holds different stock, so the audit would claim tags exist for boxes
        // that were never tagged. Same range = same physical pallet; anything
        // else starts untagged and has to be printed again.
        const prev = committed.find(c =>
          c.startBagNo === p.startBagNo && c.endBagNo === p.endBagNo)
        return {
          id: prev?.id ?? crypto.randomUUID(),
          serial: makePalletSerial(ctx.lot, p.index),
          index: p.index,
          startBagNo: p.startBagNo,
          endBagNo: p.endBagNo,
          boxCount: p.boxCount,
          totalKg: p.totalKg,
          tagMethod: prev?.tagMethod ?? null,
          boxTagMethod: prev?.boxTagMethod ?? null,
          logged_at: prev?.logged_at ?? now,
        }
      }),
    })
  }

  function patchPallet(id: string, p: Partial<PastPallet>) {
    onChange({ pallets: committed.map(c => (c.id === id ? { ...c, ...p } : c)) })
  }

  function palletLabel(p: PastPallet): FinalProductLabel {
    return {
      kind: 'pallet', serial: p.serial,
      item: ctx.item, itemCode: ctx.itemCode, variant: ctx.variant,
      lot: ctx.lot, weightKg: p.totalKg, date: p.logged_at ?? new Date().toISOString(),
      packaging: ctx.packaging, markings: ctx.markings, customerPo: ctx.customerPo,
      boxCount: p.boxCount, startBagNo: p.startBagNo, endBagNo: p.endBagNo,
    }
  }

  function boxLabels(p: PastPallet): FinalProductLabel[] {
    const out: FinalProductLabel[] = []
    for (let bagNo = p.startBagNo; bagNo <= p.endBagNo; bagNo++) {
      out.push({
        kind: 'box', serial: makeBoxSerial(ctx.lot, bagNo),
        item: ctx.item, itemCode: ctx.itemCode, variant: ctx.variant,
        lot: ctx.lot, weightKg: boxWeightKg, date: p.logged_at ?? new Date().toISOString(),
        packaging: ctx.packaging, markings: ctx.markings, customerPo: ctx.customerPo,
        bagNo, bagTotal: ctx.batchBagTotal ?? null,
      })
    }
    return out
  }

  async function print(p: PastPallet, what: 'pallet' | 'boxes') {
    const key = `${p.id}:${what}`
    setPrinting(key); setNote(null)
    const labels = what === 'pallet' ? [palletLabel(p)] : boxLabels(p)
    const res = await printFinalLabelsAuto(labels)
    setPrinting(null)
    // Never silently fall back: an operator who thinks 45 box tags went to the
    // Argox will walk to the printer and find nothing.
    setNote(res.via === 'browser'
      ? `${res.count} ${what === 'pallet' ? 'pallet tag' : 'box tags'} opened in a print window — the label printer wasn't reachable${res.error ? ` (${res.error})` : ''}.`
      : `${res.count} ${what === 'pallet' ? 'pallet tag' : 'box tags'} sent to the label printer.`)
    patchPallet(p.id, what === 'pallet' ? { tagMethod: 'printed' } : { boxTagMethod: 'printed' })
  }

  if (boxCount <= 0) return null

  const lotMissing = !ctx.lot.trim()

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-stone-400" />
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Pallets &amp; tags</span>
        </div>
        <span className="text-[11px] font-mono text-stone-500">
          {boxCount} {boxCount === 1 ? 'unit' : 'units'} · {proposal.length} pallet{proposal.length === 1 ? '' : 's'}
        </span>
      </div>

      {lotMissing ? (
        <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Set the batch number on this line first — every pallet and box serial is built from it.</span>
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 items-end">
            <div className="space-y-1">
              <label className={LBL}>Units per pallet</label>
              <input
                type="text" inputMode="numeric" disabled={locked}
                value={boxesPerPallet}
                placeholder={String(specPer ?? DEFAULT_BOXES_PER_PALLET)}
                onChange={e => onChange({ boxesPerPallet: e.target.value.replace(/[^0-9]/g, '') })}
                className="w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand"
              />
              <p className="text-[10px] text-stone-400">
                {specPer != null
                  ? `${specPer} from "${ctx.packaging}" — change it if this order palletises differently.`
                  : 'No packaging spec matched — confirm the pallet size for this order.'}
              </p>
            </div>
            {!locked && (
              <button
                onClick={commit}
                className={`inline-flex items-center justify-center gap-1.5 px-3 min-h-[42px] rounded-xl border-2 text-[13px] font-semibold transition-colors ${
                  stale || committed.length === 0
                    ? 'border-brand bg-brand text-white'
                    : 'border-stone-200 text-stone-500'
                }`}>
                {committed.length === 0
                  ? <><Check size={15} /> Confirm split</>
                  : <><RotateCcw size={15} /> Re-split</>}
              </button>
            )}
          </div>

          {stale && (
            <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                The bag count or pallet size changed since these pallets were confirmed.
                Re-split to match — tags already printed stay recorded.
              </span>
            </p>
          )}

          {/* Uncommitted proposal — shown so the operator sees the shape before committing */}
          {committed.length === 0 && (
            <div className="space-y-1">
              {proposal.map(p => (
                <div key={p.index} className="flex items-center justify-between px-3 py-2 rounded-xl bg-stone-50 border border-stone-100 text-[12px]">
                  <span className="font-semibold text-stone-600">
                    Pallet {p.index}
                    {p.short && <span className="ml-1.5 text-[10px] font-medium text-stone-400 uppercase tracking-wide">short</span>}
                  </span>
                  <span className="font-mono text-stone-500">
                    #{p.startBagNo}–{p.endBagNo} · {p.boxCount} · {p.totalKg.toFixed(1)} kg
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-stone-400 px-1">Confirm the split to generate pallet serials and enable tag printing.</p>
            </div>
          )}

          {/* Committed pallets — serials exist, tags can be printed or written */}
          {committed.length > 0 && (
            <div className="space-y-2">
              {committed.map(p => (
                <div key={p.id} className="rounded-xl border border-stone-200 px-3 py-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-text">
                        Pallet {p.index}
                        {p.boxCount < per && <span className="ml-1.5 text-[10px] font-medium text-stone-400 uppercase tracking-wide">short</span>}
                      </div>
                      <div className="font-mono text-[11px] text-stone-500 truncate">
                        #{p.startBagNo}–{p.endBagNo} · {p.boxCount} units · {p.totalKg.toFixed(1)} kg
                      </div>
                    </div>
                    <span className="inline-flex items-center font-mono text-[12px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2 py-0.5 shrink-0">
                      {p.serial}
                    </span>
                  </div>

                  {/* Two independent tag actions: the pallet's own tag, and the
                      box tags on it. They're separate because they physically
                      happen at different moments — boxes get tagged as they come
                      off the line, the pallet is tagged once it's built. */}
                  <div className="grid grid-cols-2 gap-2">
                    <TagAction
                      title="Pallet tag" count={1} method={p.tagMethod} locked={locked}
                      busy={printing === `${p.id}:pallet`}
                      onPrint={() => print(p, 'pallet')}
                      onWrite={() => patchPallet(p.id, { tagMethod: 'handwritten' })}
                      onReset={() => patchPallet(p.id, { tagMethod: null })}
                    />
                    <TagAction
                      title="Box tags" count={p.boxCount} method={p.boxTagMethod} locked={locked}
                      busy={printing === `${p.id}:boxes`}
                      onPrint={() => print(p, 'boxes')}
                      onWrite={() => patchPallet(p.id, { boxTagMethod: 'handwritten' })}
                      onReset={() => patchPallet(p.id, { boxTagMethod: null })}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {note && <p className="text-[11px] text-stone-500 px-1">{note}</p>}
        </>
      )}
    </div>
  )
}

/** Print / write-on-tag pair for one kind of tag, with its recorded outcome. */
function TagAction({ title, count, method, locked, busy, onPrint, onWrite, onReset }: {
  title: string
  count: number
  method: 'printed' | 'handwritten' | null
  locked: boolean
  busy: boolean
  onPrint: () => void
  onWrite: () => void
  onReset: () => void
}) {
  if (method) {
    return (
      <div className="flex items-center justify-between gap-1 px-2.5 py-2 rounded-xl bg-ok/5 border border-ok/20">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-stone-600 min-w-0">
          {method === 'printed' ? <Printer size={12} className="shrink-0" /> : <PenLine size={12} className="shrink-0" />}
          <span className="truncate">{title} · {method}</span>
        </span>
        {!locked && (
          <button onClick={onReset} title="Undo" className="text-stone-300 hover:text-stone-600 shrink-0">
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide px-0.5">
        {title}{count > 1 ? ` · ${count}` : ''}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={onPrint} disabled={locked || busy}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />} Print
        </button>
        <button
          onClick={onWrite} disabled={locked || busy}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand disabled:opacity-50">
          <PenLine size={12} /> Write
        </button>
      </div>
    </div>
  )
}

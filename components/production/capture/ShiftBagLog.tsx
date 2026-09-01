'use client'

// ShiftBagLog — read-only reference of every bag this SHIFT has debagged in and
// bagged out on this line.
//
// Why it exists: the Capture tab only ever shows the batch record that is open
// on screen, and Overview merges both shifts into one grouped total. So an
// operator part-way through a shift had nowhere to read back "what has this
// shift put in and taken out so far" — the question asked before every
// changeover, handover and stock check. Requested by the afternoon shift; the
// panel is shift-agnostic, so the morning shift reads its own shift the same way.
//
// Scope is deliberately the WHOLE shift on this section: the live batch record
// plus every other record the shift opened (a submitted record followed by
// "Start new batch record" is several prod_sessions rows), regardless of
// variant/grade. That is wider than the mass balance above it, which only
// combines records running the same variant/grade — so every record is listed
// under its own heading, and this panel deliberately shows no in-vs-out
// variance that could be misread as a balance.
//
// Each section's shapes are read through an explicit sectionId switch, never by
// duck-typing shared field names: the lines are independent processes that
// happen to reuse field names (`inputs`, `outputs`, `debag`), and conflating
// them is how Blender rows once turned up as Refining ones.

import { useState, useMemo } from 'react'
import { Package, PackageCheck, ChevronDown, ChevronRight, ListOrdered } from 'lucide-react'
import { type SievingData } from '@/components/production/capture/SievingCapture'
import { type RefiningData } from '@/components/production/capture/RefiningCapture'
import { dustProductType, type GranuleData } from '@/components/production/capture/GranuleCapture'
import { type BlenderData } from '@/components/production/capture/BlenderCapture'
import { type PasteuriserData } from '@/components/production/capture/PasteuriserCapture'
import { VARIANT_OPTIONS, DESTINATION_OPTIONS } from '@/lib/production/capture-config'
import { n as num } from '@/lib/core/num'

const DEBAG_BLUE = '#1d4ed8'
const BAG_ORANGE = '#d97706'

// Bag timestamps are stored as UTC instants (logged_at); older rows carry only
// the HH:mm the operator typed. Both display in SAST — never device-local.
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''
const timeOf = (loggedAt?: string, clock?: string) => fmtTime(loggedAt) || (clock ?? '').trim()

export type CaptureData = SievingData | RefiningData | GranuleData | BlenderData | PasteuriserData

export interface ShiftLogRecord {
  id: string
  variant: string
  grade: string
  lot: string
  data: CaptureData
  label?: string      // 'P2', 'Earlier record 1', … — supplied by the caller, which owns the numbering
  current?: boolean   // part of the record open on screen right now
}

interface LogRow {
  key: string
  label: string       // what the bag holds — product type / material / blend
  ref: string         // serial, or the physical bag number for an untagged farm bag
  lot: string
  kg: number
  bags: number        // physical bags this row represents (pallet lines and dust rows hold many)
  time: string
  note?: string
}

interface BuiltRecord extends ShiftLogRecord {
  inputs: LogRow[]
  outputs: LogRow[]
}

// ── Flattening ────────────────────────────────────────────────────────────────

function buildRecords(sectionId: string, records: ShiftLogRecord[]): BuiltRecord[] {
  return records.map(rec => {
    const inputs: LogRow[] = []
    const outputs: LogRow[] = []
    const add = (into: LogRow[], r: Omit<LogRow, 'key' | 'bags'> & { bags?: number }) => {
      if (r.kg <= 0) return
      into.push({ ...r, bags: r.bags ?? 1, key: `${rec.id}-${into === inputs ? 'i' : 'o'}-${into.length}` })
    }
    const lot = (v?: string | null) => (v || rec.lot || '').trim()

    if (sectionId.startsWith('refining')) {
      const d = rec.data as RefiningData
      ;(d.inputs ?? []).forEach(r => add(inputs, {
        label: r.productType || 'Input bag', ref: r.serial, lot: lot(r.lot), kg: num(r.weight),
        time: timeOf(r.logged_at), note: r.variant || undefined,
      }))
      ;([['A', d.outputA], ['B', d.outputB], ['C', d.outputC], ['D', d.outputD]] as const).forEach(([grp, g]) => {
        ;(g?.bags ?? []).forEach(b => add(outputs, {
          label: b.productType || g?.productType || 'Output bag', ref: b.serial, lot: lot(null), kg: num(b.weight),
          time: timeOf(b.logged_at), note: grp,
        }))
      })

    } else if (sectionId === 'granule') {
      const d = rec.data as GranuleData
      ;(d.blends ?? []).forEach(bl => {
        ;(bl.rows ?? []).forEach(r => add(inputs, {
          label: dustProductType(r.dustKey), ref: r.serial, lot: lot(r.lot), kg: num(r.weight),
          time: timeOf(r.logged_at), note: bl.blendNo ? `blend ${bl.blendNo}` : undefined,
        }))
      })
      ;(d.outputs ?? []).forEach(b => add(outputs, {
        label: b.item || 'Granules', ref: b.serial, lot: lot(b.lot), kg: num(b.weight),
        time: timeOf(b.logged_at, b.time),
      }))
      ;(d.dustOutputs ?? []).forEach(r => add(outputs, {
        label: r.dustType || 'Dust', ref: r.serial, lot: lot(null), kg: num(r.weight),
        bags: Math.max(1, Math.round(num(r.bags))), time: timeOf(r.logged_at), note: 'dust out',
      }))

    } else if (sectionId === 'blender' || sectionId === 'smallblender') {
      const d = rec.data as BlenderData
      ;(d.inputs ?? []).forEach(r => add(inputs, {
        label: r.productType || 'Ingredient', ref: r.serial, lot: lot(r.lot), kg: num(r.weight),
        time: timeOf(r.logged_at), note: r.variant || undefined,
      }))
      ;(d.outputs ?? []).forEach(b => add(outputs, {
        label: d.bomId ? `Blend ${d.bomId}` : 'Blend', ref: b.serial, lot: lot(b.lot), kg: num(b.weight),
        time: timeOf(b.logged_at, b.time),
      }))

    } else if (sectionId === 'pasteuriser') {
      const d = rec.data as PasteuriserData
      const perBag = num(d.weightPerBag)
      ;(d.debag ?? []).forEach(r => add(inputs, {
        label: r.productType || d.blendCode || 'Blend bag', ref: r.serial, lot: lot(r.lot) || d.batchNo, kg: num(r.weight),
        time: timeOf(r.logged_at, r.time), note: r.stream === 'postsieve' ? 'post-sieve' : undefined,
      }))
      // A pallet line is many physical bags of one product — kg is bags × kg/bag,
      // the same figure the output total and prod_bagging are built from.
      ;(d.outputs ?? []).forEach(l => {
        const count = Math.max(1, Math.round(num(l.bagCount)))
        add(outputs, {
          label: l.item || l.kind || 'Final product', ref: l.serial, lot: lot(l.lot) || d.batchNo,
          kg: num(l.bagCount) * (num(l.bagWeight) || perBag), bags: count,
          time: timeOf(l.logged_at, l.time), note: `${count} bag${count !== 1 ? 's' : ''}`,
        })
      })
      ;(d.byProducts ?? []).forEach(r => add(outputs, {
        label: r.type || 'By-product', ref: r.serial, lot: lot(null), kg: num(r.weight), time: '', note: 'by-product',
      }))

    } else {
      // Sieving Tower. Bucket-elevator and machine spillage are deliberately
      // absent: they are loss/carry-over figures, not bags, and they already
      // read on the mass balance.
      const d = rec.data as SievingData
      ;(d.debag ?? []).forEach((r, i) => add(inputs, {
        label: 'Farm bag', ref: r.bag_no || `Bulk bag ${i + 1}`, lot: lot(r.lot), kg: num(r.nett),
        time: timeOf(r.logged_at), note: r.grade || undefined,
      }))
      ;(d.outputs ?? []).forEach(b => add(outputs, {
        label: b.productType || 'Output bag', ref: b.serial, lot: lot(b.batch), kg: num(b.weight),
        time: timeOf(b.logged_at),
      }))
    }

    return { ...rec, inputs, outputs }
  })
}

const tally = (rows: LogRow[]) => rows.reduce(
  (a, r) => ({ bags: a.bags + r.bags, kg: a.kg + r.kg }), { bags: 0, kg: 0 })

function recordSubtitle(rec: ShiftLogRecord, sectionId: string): string {
  const variant = VARIANT_OPTIONS.find(v => v.value === rec.variant)?.label ?? rec.variant
  const blend = (sectionId === 'blender' || sectionId === 'smallblender')
    ? ((rec.data as BlenderData)?.bomId ?? '') : ''
  const grade = blend || (rec.grade ? (DESTINATION_OPTIONS.find(o => o.value === rec.grade)?.label ?? rec.grade) : '')
  return [variant, grade].filter(Boolean).join(' · ')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShiftBagLog({ sectionId, shiftLabel, records }: {
  sectionId: string
  shiftLabel: string
  records: ShiftLogRecord[]
}) {
  const [open, setOpen] = useState(false)
  const built = useMemo(() => buildRecords(sectionId, records), [sectionId, records])

  const withInputs  = built.filter(r => r.inputs.length > 0)
  const withOutputs = built.filter(r => r.outputs.length > 0)
  const totalIn  = tally(built.flatMap(r => r.inputs))
  const totalOut = tally(built.flatMap(r => r.outputs))
  const multiRecord = built.filter(r => r.inputs.length > 0 || r.outputs.length > 0).length > 1

  // Nothing captured on this line all shift — the panel would say nothing the
  // empty capture screen behind it doesn't already.
  if (totalIn.bags === 0 && totalOut.bags === 0) return null

  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Wraps rather than squeezes: on a narrow tablet the in/out chips drop
          to their own line instead of compressing until "1 997.4 kg" breaks
          across three lines inside its own pill. */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left hover:bg-stone-50 transition-colors">
        <div className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
          <ListOrdered size={17} className="text-stone-500" />
        </div>
        <div className="min-w-[9rem] flex-1">
          <div className="text-[13px] font-semibold text-text">Bags this shift</div>
          <div className="text-[11px] text-text-muted truncate">
            Everything in &amp; out on this line — {shiftLabel} shift, all batch records
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <Chip color={DEBAG_BLUE} icon={<Package size={11} />} bags={totalIn.bags} kg={totalIn.kg} />
          <Chip color={BAG_ORANGE} icon={<PackageCheck size={11} />} bags={totalOut.bags} kg={totalOut.kg} />
          {open ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 grid gap-3 lg:grid-cols-2">
          <Side
            title="Debagged in" color={DEBAG_BLUE} icon={<Package size={14} />}
            total={totalIn} records={withInputs} pick={r => r.inputs}
            sectionId={sectionId} showRecordHeadings={multiRecord}
            empty="Nothing debagged yet this shift."
          />
          <Side
            title="Bagged out" color={BAG_ORANGE} icon={<PackageCheck size={14} />}
            total={totalOut} records={withOutputs} pick={r => r.outputs}
            sectionId={sectionId} showRecordHeadings={multiRecord}
            empty="Nothing bagged yet this shift."
          />
        </div>
      )}
    </div>
  )
}

export default ShiftBagLog

function Chip({ color, icon, bags, kg }: { color: string; icon: React.ReactNode; bags: number; kg: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap"
      style={{ background: color + '12', color }}>
      {icon}{bags} · <span className="font-mono">{kg.toFixed(1)} kg</span>
    </span>
  )
}

function Side({ title, color, icon, total, records, pick, sectionId, showRecordHeadings, empty }: {
  title: string
  color: string
  icon: React.ReactNode
  total: { bags: number; kg: number }
  records: BuiltRecord[]
  pick: (r: BuiltRecord) => LogRow[]
  sectionId: string
  showRecordHeadings: boolean
  empty: string
}) {
  return (
    <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: color + '40' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ background: color + '12' }}>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color }}>
          {icon} {title}
        </span>
        <span className="text-[11px] font-semibold" style={{ color }}>
          {total.bags} bag{total.bags !== 1 ? 's' : ''} · <span className="font-mono">{total.kg.toFixed(1)} kg</span>
        </span>
      </div>

      {records.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-stone-400">{empty}</p>
      ) : (
        // Capped and scrollable: a full shift on a busy line runs to dozens of
        // bags, and this is a reference — it must never push the capture form
        // it sits above off the screen.
        <div className="max-h-[19rem] overflow-y-auto divide-y divide-stone-100">
          {records.map(rec => {
            const rows = pick(rec)
            const t = tally(rows)
            return (
              <div key={rec.id}>
                {showRecordHeadings && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-50">
                    <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest shrink-0">
                      {rec.label ?? 'Batch record'}
                    </span>
                    <span className="text-[11px] text-stone-400 truncate flex-1">{recordSubtitle(rec, sectionId)}</span>
                    {rec.current && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand shrink-0">current</span>}
                    <span className="font-mono text-[11px] text-stone-500 shrink-0">{t.kg.toFixed(1)} kg</span>
                  </div>
                )}
                <div className="divide-y divide-stone-50">
                  {rows.map(r => (
                    <div key={r.key} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                      <span className="text-[10px] text-stone-400 w-9 shrink-0 tabular-nums">{r.time}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-stone-800 truncate">{r.label}</span>
                        <span className="block text-[10px] text-stone-400 truncate">
                          {[r.ref, r.lot, r.note].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="font-mono text-stone-700 shrink-0 text-right">{r.kg.toFixed(1)} kg</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

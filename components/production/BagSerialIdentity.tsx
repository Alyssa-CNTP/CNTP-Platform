'use client'

// components/production/BagSerialIdentity.tsx
//
// The "unique serial identity" half of a bag record: everything true of THIS
// physical bag and no other one. Its own QC numbers, what it was made from,
// what was made from it, and its event history.
//
// The distinction against the batch half matters and is not cosmetic. A batch
// answers "how did this production run go" — yield, output mix, machine
// settings, the lot's quality. A serial answers "what is in this bag" — and
// those diverge constantly: one lot becomes dozens of bags, each with its own
// weight, its own QC stamp, its own onward journey. Reading a batch figure off
// a bag record is how a 300 kg grade gets reported as 900 kg.
//
// ── Where the per-bag numbers come from ────────────────────────────────────
//
// `qms.v_bag_qc_status`, keyed on bag_serial_no. It carries the FINAL QC run
// for the bag (bulk density, leaf shade, who signed it, when) plus the
// in-process sieving run that was on the tower when the bag was filled, with
// that run's spec violations. Every bag is in this view — 100% coverage
// measured on staging across all five sections — so a bag with no numbers
// here genuinely has no QC, rather than being missing from the join.
//
// Only Fine Leaf and Coarse Leaf require a final QC stamp
// (qms.sd_product_needs_qc), so a Granule or Blender bag showing no bulk
// density is correct and says so, rather than rendering an empty row that
// reads as a fault.
//
// bag_tags does NOT hold bulk density or leaf shade. Do not add them there:
// they are quality's record, captured per run, and copying them onto the tag
// would create a second source that drifts (ARCHITECTURE.md §5).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import {
  Activity, AlertTriangle, ArrowRight, FlaskConical, History,
  Loader2, CheckCircle2, ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SerialIdentityTag {
  serial_number:       string
  section_id:          string
  section_name:        string
  product_type:        string
  lot_number:          string | null
  variant:             string | null
  consumed_at_section: string | null
  consumed_weight_kg:  number | null
}

interface ScanEvent {
  id:            string
  serial_number: string
  section_id:    string
  action:        string | null
  weight_kg:     number | null
  notes:         string | null
  scanned_at:    string
  related_serial_number: string | null
}

interface LineageRow {
  parent_serial:       string
  child_serial:        string
  relation:            string
  section_id:          string
  parent_kg:           number | null
  parent_product_type: string | null
  parent_variant:      string | null
  parent_grade:        string | null
  parent_lot:          string | null
  parent_weight_kg:    number | null
  parent_section_id:   string | null
  child_product_type:  string | null
  child_lot:           string | null
}

interface BagQc {
  product:               string | null
  qc_required:           boolean | null
  qc_done:               boolean | null
  final_bulk_density:    string | number | null
  final_leaf_shade:      string | number | null
  final_qc_name:         string | null
  final_qc_at:           string | null
  inprocess_run_id:      string | number | null
  inprocess_at:          string | null
  inprocess_qc_name:     string | null
  inprocess_pass_status: string | null
  inprocess_violations:  unknown
  inprocess_out_of_spec: boolean | null
}

// ── Shared presentational bits (mirrors /tags' own pills) ────────────────────

const SECTION_DOT: Record<string, string> = {
  sieving: 'bg-blue-500', refining1: 'bg-emerald-600', refining2: 'bg-emerald-500',
  granule: 'bg-amber-500', blender: 'bg-purple-500', smallblender: 'bg-purple-400',
  pasteuriser: 'bg-red-500',
}
const SECTION_PILL: Record<string, string> = {
  sieving: 'bg-blue-100 text-blue-700 border-blue-200',
  refining1: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  refining2: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  granule: 'bg-amber-100 text-amber-700 border-amber-200',
  blender: 'bg-purple-100 text-purple-700 border-purple-200',
  smallblender: 'bg-purple-100 text-purple-700 border-purple-200',
  pasteuriser: 'bg-red-100 text-red-700 border-red-200',
}
const SECTION_DISPLAY: Record<string, string> = {
  sieving: 'Sieving Tower', refining1: 'Refining 1', refining2: 'Refining 2',
  granule: 'Granule Line', blender: 'Blender', smallblender: 'Small Blender',
  pasteuriser: 'Pasteuriser',
}

function Pill({ sectionId, label }: { sectionId: string; label?: string }) {
  return (
    <span className={`inline-flex items-center font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border ${SECTION_PILL[sectionId] ?? 'bg-stone-100 text-stone-500 border-stone-200'}`}>
      {label ?? SECTION_DISPLAY[sectionId] ?? sectionId}
    </span>
  )
}

function Heading({ icon, children, count }: { icon: React.ReactNode; children: React.ReactNode; count?: number }) {
  return (
    <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
      {icon} {children}{count != null ? ` (${count})` : ''}
    </p>
  )
}

const Spinner = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 text-[11px] text-stone-400 py-2">
    <Loader2 size={12} className="animate-spin" /> {label}
  </div>
)

/** A bag row inside the genealogy chain. */
function ChainBag({ serial, sectionId, productType, kg, grade, lot, note, onOpen }: {
  serial: string; sectionId: string | null; productType: string | null
  kg: number | null; grade?: string | null; lot?: string | null; note?: string | null
  onOpen?: (serial: string) => void
}) {
  const inner = (
    <>
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${SECTION_DOT[sectionId ?? ''] ?? 'bg-stone-400'}`} />
      <span className="font-mono text-[11px] font-bold text-stone-800 tracking-wider">{serial}</span>
      {sectionId && <Pill sectionId={sectionId} />}
      {productType && <span className="text-[11px] text-stone-600 truncate">{productType}</span>}
      {grade && <span className="font-mono text-[10px] text-stone-500">{grade}</span>}
      {lot && <span className="font-mono text-[10px] text-stone-400 truncate">lot {lot}</span>}
      {note && <span className="text-[10px] text-stone-400 italic">{note}</span>}
      {kg != null && <span className="font-mono text-[10px] text-stone-500 ml-auto shrink-0">{kg} kg</span>}
    </>
  )
  const cls = 'w-full flex items-center gap-2 bg-stone-50 rounded-lg px-3 py-2 border border-stone-100 text-left'
  return onOpen
    ? <button onClick={() => onOpen(serial)} className={`${cls} hover:border-stone-300 hover:bg-stone-100 transition-colors`}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

// ── The panel ────────────────────────────────────────────────────────────────

export default function BagSerialIdentity({ tag, onOpenSerial }: {
  tag: SerialIdentityTag
  /** Jump the record to another bag — makes the chain walkable. */
  onOpenSerial?: (serial: string) => void
}) {
  const [events,   setEvents]   = useState<ScanEvent[]>([])
  const [parents,  setParents]  = useState<LineageRow[]>([])
  const [children, setChildren] = useState<LineageRow[]>([])
  const [qc,       setQc]       = useState<BagQc | null>(null)

  const [loadingEvents,  setLoadingEvents]  = useState(true)
  const [loadingLineage, setLoadingLineage] = useState(true)
  const [loadingQc,      setLoadingQc]      = useState(true)
  const [qcUnavailable,  setQcUnavailable]  = useState(false)

  const serial = tag.serial_number

  // ── Events ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true
    setLoadingEvents(true)
    getDb().schema('production').from('scan_events')
      .select('*').eq('serial_number', serial).order('scanned_at', { ascending: true })
      .then(({ data }: { data: ScanEvent[] | null }) => {
        if (!live) return
        setEvents(data ?? [])
        setLoadingEvents(false)
      }, () => { if (live) { setEvents([]); setLoadingEvents(false) } })
    return () => { live = false }
  }, [serial])

  // ── Genealogy, both directions ────────────────────────────────────────────
  // Reads production.v_bag_lineage (migration 20260915_003), which already
  // filters voided links and joins each side's bag_tags row, so this needs one
  // round trip per direction and no client-side stitching.
  useEffect(() => {
    let live = true
    setLoadingLineage(true)
    const db = getDb()
    Promise.all([
      db.schema('production').from('v_bag_lineage').select('*').eq('child_serial', serial),
      db.schema('production').from('v_bag_lineage').select('*').eq('parent_serial', serial),
    ]).then(([up, down]: any[]) => {
      if (!live) return
      setParents((up?.data ?? []) as LineageRow[])
      setChildren((down?.data ?? []) as LineageRow[])
      setLoadingLineage(false)
    }).catch(() => { if (live) { setParents([]); setChildren([]); setLoadingLineage(false) } })
    return () => { live = false }
  }, [serial])

  // ── Per-bag QC ────────────────────────────────────────────────────────────
  // qms, not production — getDb() is pinned to the production schema, so this
  // must say so explicitly. Reaching for production.* here is exactly how this
  // record's old quality block ended up querying three tables that do not
  // exist and swallowing all three 404s.
  useEffect(() => {
    let live = true
    setLoadingQc(true); setQcUnavailable(false)
    getDb().schema('qms').from('v_bag_qc_status')
      .select('product,qc_required,qc_done,final_bulk_density,final_leaf_shade,final_qc_name,final_qc_at,inprocess_run_id,inprocess_at,inprocess_qc_name,inprocess_pass_status,inprocess_violations,inprocess_out_of_spec')
      .eq('bag_serial_no', serial).limit(1).maybeSingle()
      .then(({ data, error }: any) => {
        if (!live) return
        // A read error is NOT "no QC" — it means the view could not be reached
        // (grant, migration, schema cache). Saying "no QC recorded" then would
        // be a lie an operator could act on.
        if (error) { setQcUnavailable(true); setQc(null) } else setQc((data ?? null) as BagQc | null)
        setLoadingQc(false)
      }, () => { if (live) { setQcUnavailable(true); setLoadingQc(false) } })
    return () => { live = false }
  }, [serial])

  const violations = Array.isArray(qc?.inprocess_violations) ? (qc!.inprocess_violations as any[]) : []
  const hasFinalQc = qc?.qc_done && (qc.final_bulk_density != null || qc.final_leaf_shade != null)

  return (
    <div className="space-y-5">

      {/* ── This bag's own quality ── */}
      <div>
        <Heading icon={<FlaskConical size={11} />}>Quality — this bag</Heading>

        {loadingQc ? <Spinner label="Loading quality…" /> : qcUnavailable ? (
          <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Could not reach the QC record for this bag — this is a connection or permissions problem, not an empty result.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                ['Bulk density', qc?.final_bulk_density != null ? String(qc.final_bulk_density) : '—'],
                ['Leaf shade',   qc?.final_leaf_shade   != null ? String(qc.final_leaf_shade)   : '—'],
                ['QC by',        qc?.final_qc_name || '—'],
                ['QC at',        qc?.final_qc_at ? format(parseISO(qc.final_qc_at), 'dd MMM yyyy HH:mm') : '—'],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                  <div className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide mb-1">{l}</div>
                  <div className="font-mono text-[11px] font-bold text-stone-800 break-all">{v}</div>
                </div>
              ))}
            </div>

            {/* Why there is no stamp, in the bag's own terms. "No QC" and "no
                QC is required for this product" are different facts and an
                operator chasing a missing stamp needs to know which. */}
            {!hasFinalQc && (
              <p className="text-[11px] text-stone-400 italic mt-2">
                {qc == null
                  ? 'This bag has no bagging record in Quality yet.'
                  : qc.qc_required
                  ? `Final QC still outstanding for this ${qc.product ?? 'bag'}.`
                  : `${qc.product ?? tag.product_type} does not carry a final QC stamp — only Fine Leaf and Coarse Leaf do.`}
              </p>
            )}

            {/* The in-process run that was on the line when this bag was
                filled. It is the bag's own inheritance, not the batch's
                average — which is the whole point of this tab. */}
            {qc?.inprocess_run_id != null && (
              <div className={`mt-3 rounded-xl border px-3 py-2.5 ${qc.inprocess_out_of_spec ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-stone-50'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  {qc.inprocess_out_of_spec
                    ? <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                    : <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />}
                  <span className="text-[11px] font-semibold text-stone-700">
                    In-process run when this bag was filled
                  </span>
                  <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border ${qc.inprocess_out_of_spec ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                    {qc.inprocess_pass_status ?? 'unknown'}
                  </span>
                  {qc.inprocess_at && (
                    <span className="font-mono text-[10px] text-stone-400 ml-auto">
                      {format(parseISO(qc.inprocess_at), 'dd MMM HH:mm')}
                      {qc.inprocess_qc_name ? ` · ${qc.inprocess_qc_name}` : ''}
                    </span>
                  )}
                </div>
                {violations.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {violations.map((v, i) => (
                      <li key={i} className="text-[11px] text-amber-700">
                        · {typeof v === 'string' ? v : JSON.stringify(v)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Genealogy ── */}
      <div>
        <Heading icon={<History size={11} />}>Genealogy</Heading>

        {loadingLineage ? <Spinner label="Loading chain…" /> : (
          <div className="space-y-3">

            {/* Upstream */}
            <div>
              <p className="text-[10px] text-stone-400 italic mb-1.5 flex items-center gap-1">
                <ArrowDownToLine size={10} /> Made from
              </p>
              {parents.length === 0 ? (
                <p className="text-[11px] text-stone-400 italic">
                  {tag.section_id === 'sieving'
                    ? 'Sieving debags farm bags at the head of the line — they carry no upstream serial.'
                    : 'No parent bags recorded for this bag.'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {parents.map(p => (
                    <ChainBag
                      key={`${p.parent_serial}-${p.relation}`}
                      serial={p.parent_serial}
                      sectionId={p.parent_section_id}
                      productType={p.parent_product_type}
                      grade={p.parent_grade}
                      lot={p.parent_lot}
                      kg={p.parent_kg ?? p.parent_weight_kg}
                      note={p.relation === 'transferred_from' ? 'drawn from' : null}
                      onOpen={onOpenSerial}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* This bag */}
            <div className="flex items-center gap-2 flex-wrap pl-1">
              <div className={`w-2 h-2 rounded-full ${SECTION_DOT[tag.section_id] ?? 'bg-stone-400'}`} />
              <Pill sectionId={tag.section_id} label={tag.section_name} />
              <span className="font-mono text-[11px] font-bold text-stone-900">{serial}</span>
              <ArrowRight size={12} className="text-stone-300 shrink-0" />
              {tag.consumed_at_section ? (
                <>
                  <Pill sectionId={tag.consumed_at_section} />
                  {tag.consumed_weight_kg != null && (
                    <span className="font-mono text-[10px] text-stone-500">{tag.consumed_weight_kg} kg</span>
                  )}
                </>
              ) : (
                <span className="inline-flex font-mono text-[9px] font-bold px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                  On floor — not yet consumed
                </span>
              )}
            </div>

            {/* Downstream */}
            <div>
              <p className="text-[10px] text-stone-400 italic mb-1.5 flex items-center gap-1">
                <ArrowUpFromLine size={10} /> Went into
              </p>
              {children.length === 0 ? (
                <p className="text-[11px] text-stone-400 italic">
                  Nothing has been made from this bag yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {children.map(c => (
                    <ChainBag
                      key={`${c.child_serial}-${c.relation}`}
                      serial={c.child_serial}
                      sectionId={c.section_id}
                      productType={c.child_product_type}
                      lot={c.child_lot}
                      kg={c.parent_kg}
                      note={c.relation === 'transferred_from' ? 'drawn into' : null}
                      onOpen={onOpenSerial}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Events ── */}
      <div>
        <Heading icon={<Activity size={11} />} count={loadingEvents ? undefined : events.length}>
          Events
        </Heading>
        {loadingEvents ? <Spinner label="Loading events…" /> : events.length === 0 ? (
          <p className="text-[11px] text-stone-400 italic">
            No events yet — these appear as the bag is bagged, scanned and consumed.
          </p>
        ) : (
          <div className="relative">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-stone-100" />
            <div className="space-y-0">
              {events.map(ev => (
                <div key={ev.id} className="flex items-start gap-3 pl-4 relative py-2 border-b border-stone-50 last:border-0">
                  <div className={`absolute left-0 top-3 w-3.5 h-3.5 rounded-full border-2 border-white shrink-0 ${SECTION_DOT[ev.section_id] ?? 'bg-stone-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] font-bold text-stone-800 capitalize">
                        {ev.action?.replace(/_/g, ' ') || 'scan'}
                      </span>
                      {ev.section_id && <Pill sectionId={ev.section_id} />}
                      {ev.weight_kg != null && (
                        <span className="font-mono text-[10px] text-stone-500">{ev.weight_kg} kg</span>
                      )}
                      {ev.related_serial_number && (
                        <span className="font-mono text-[10px] text-stone-400">
                          ↔ {ev.related_serial_number}
                        </span>
                      )}
                    </div>
                    {ev.notes && <div className="font-mono text-[10px] text-stone-500 mt-0.5 truncate">{ev.notes}</div>}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-[10px] text-stone-400">
                        {format(parseISO(ev.scanned_at), 'dd MMM yyyy HH:mm:ss')}
                      </span>
                      <span className="text-[9px] text-stone-300">
                        · {formatDistanceToNow(parseISO(ev.scanned_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

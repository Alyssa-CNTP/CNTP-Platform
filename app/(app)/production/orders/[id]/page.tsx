'use client'

// app/(app)/production/orders/[id]/page.tsx
// Full production order detail — everything about one prod_sessions row in
// one place: identifiers, mass balance, the full bag/debag list (not just
// counts), both sign-offs with their actual signature images, comments and
// reopen history. Built on components/production/ui/kit so it reads as the
// same product as the Orders list, Supervisor Hub and Shift Report.
//
// Doubles as the printable record: app/globals.css already hides app chrome
// (aside/header) under @media print, and this page renders everything
// un-collapsed by default (no Collapse behind a click — "show everything"
// was the actual ask), so Print produces the same full report you see here.

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, Printer, Loader2, CheckCircle2, Clock, Pen, Play, Radio } from 'lucide-react'
import { loadOrderDetail, type OrderDetail, type OrderBagRow } from '@/lib/production/order-detail'
import { sectionMeta } from '@/lib/production/capture-config'
import { getDb } from '@/lib/supabase/db'

// bagging_time is a timestamptz (the bag's real creation instant) — show it as
// SAST wall-clock time. Falls back to em-dash for bags with no recorded time.
const fmtBagTime = (ts: string | null) =>
  ts ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '—'
import { Panel, PanelHead, PanelBody, Table, Tr, Td, Empty, Pill } from '@/components/production/ui/kit'

const STATUS: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'info'; icon: any }> = {
  draft:     { label: 'In progress',       tone: 'warn', icon: Pen },
  submitted: { label: 'Awaiting sign-off', tone: 'info', icon: Clock },
  approved:  { label: 'Signed off',        tone: 'ok',   icon: CheckCircle2 },
  new:       { label: 'Not started',       tone: 'neutral', icon: Play },
}

const num = (v: number | null | undefined) => v ?? 0

export default function ProductionOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  // Live, independent read: this page reloads straight from the database
  // (bag_tags is the source of truth for output bags — see order-detail.ts),
  // and re-fetches whenever a bag / bagging row / the session itself changes
  // for this order, so a bag captured on the floor appears here within a tick
  // without anyone opening the capture page or refreshing. Realtime is a live
  // convenience on top of a correct read — a 20s poll backstops it so the
  // record stays current even if the socket drops.
  const loadedOnceRef = useRef(false)
  useEffect(() => {
    let alive = true
    const reload = () =>
      loadOrderDetail(id)
        .then(d => { if (alive) { setDetail(d); loadedOnceRef.current = true; setLoading(false) } })
        // Only surface an error on the FIRST load — a transient failure on a
        // later realtime/poll refresh must not blank out the record already
        // on screen.
        .catch(() => { if (alive && !loadedOnceRef.current) { setError('Could not load this production order'); setLoading(false) } })
    reload()

    const db = getDb()
    const bump = () => { reload() }
    const channel = db.channel(`order-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'production', table: 'bag_tags',    filter: `session_id=eq.${id}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'production', table: 'prod_bagging', filter: `session_id=eq.${id}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'production', table: 'prod_sessions', filter: `id=eq.${id}` }, bump)
      .subscribe((s: string) => { if (alive) setLive(s === 'SUBSCRIBED') })
    const poll = setInterval(reload, 20_000)

    return () => { alive = false; clearInterval(poll); db.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-text-faint" /></div>
  if (error || !detail) return <div className="p-6 text-center text-text-muted">{error ?? 'Production order not found.'}</div>

  const { session: s, massBalance: mb, bags, bagsOutputKg, debags, signatures, reopenRequests } = detail
  const meta = sectionMeta(s.section_id)
  const st = STATUS[s.status] ?? STATUS.new
  const opSig  = signatures.find(x => x.signer_role === 'operator')
  const supSig = signatures.find(x => x.signer_role === 'supervisor')
  const totalOutput = mb ? num(mb.total_output_a_kg) + num(mb.total_output_b_kg) + num(mb.total_output_c_kg) + num(mb.total_output_d_kg) : 0
  const yieldPct = mb && mb.total_input_kg ? Math.round((totalOutput / mb.total_input_kg) * 1000) / 10 : null

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5 print-full-width">
      <div className="no-print flex items-center justify-between">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-3">
          {live && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ok" title="Reading live from the database — updates as bags are captured">
              <Radio size={12} className="animate-pulse" /> Live
            </span>
          )}
          <button onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[13px] font-medium hover:opacity-90">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {/* Header */}
      <Panel>
        <PanelHead title={`${meta.name} — Production Order`} meta={s.record_no ?? undefined}
          action={<Pill tone={st.tone}><st.icon size={11} /> {st.label}</Pill>} />
        <PanelBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Date" value={format(new Date(s.date), 'd MMM yyyy')} />
            <Field label="Shift" value={s.shift} />
            <Field label="Operators" value={s.operator_names?.join(', ') || '—'} />
            <Field label="Supervisor" value={s.supervisor_name || s.sup_name_signoff || '—'} />
            <Field label="Lot number" value={s.lot_number || '—'} />
            <Field label="Variant" value={s.variant || '—'} />
            <Field label="Production orders" value={s.production_orders?.join(', ') || '—'} />
            <Field label="Submitted" value={s.submitted_at ? format(new Date(s.submitted_at), 'd MMM HH:mm') : '—'} />
          </div>
        </PanelBody>
      </Panel>

      {/* Mass balance */}
      {mb && (
        <Panel>
          <PanelHead title="Mass balance" />
          <PanelBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Total input"  value={`${num(mb.total_input_kg).toFixed(1)} kg`} />
              <Field label="Total output" value={`${totalOutput.toFixed(1)} kg`} />
              <Field label="Balance"      value={`${num(mb.balance_kg).toFixed(1)} kg`} />
              <Field label="Yield"        value={yieldPct != null ? `${yieldPct}%` : '—'} />
              <Field label="Output A"     value={`${num(mb.total_output_a_kg).toFixed(1)} kg`} />
              <Field label="Output B"     value={`${num(mb.total_output_b_kg).toFixed(1)} kg`} />
              <Field label="Output C"     value={`${num(mb.total_output_c_kg).toFixed(1)} kg`} />
              <Field label="Output D"     value={`${num(mb.total_output_d_kg).toFixed(1)} kg`} />
              <Field label="Water"            value={mb.water_kg != null ? `${num(mb.water_kg).toFixed(1)} kg` : '—'} />
              <Field label="Dust extraction"  value={mb.dust_extraction_kg != null ? `${num(mb.dust_extraction_kg).toFixed(1)} kg` : '—'} />
              <Field label="Floor waste"      value={mb.floor_waste_kg != null ? `${num(mb.floor_waste_kg).toFixed(1)} kg` : '—'} />
              <Field label="Tolerance"        value={mb.tolerance_kg != null ? `±${num(mb.tolerance_kg).toFixed(1)} kg` : '—'} />
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* Debagging (inputs) */}
      <Panel>
        <PanelHead title="Debagging — input bags" meta={String(debags.length)} />
        <PanelBody>
          {debags.length === 0 ? <Empty>No input bags recorded.</Empty> : (
            <Table head={['Bag #', 'Serial', 'Lot', 'Product', 'Variant', 'kg Gross', 'kg Nett', 'Delivery', 'Type', 'Org/Conv', 'Spillage', 'Notes']} align={[5, 6]}>
              {debags.map(d => (
                <Tr key={d.id}>
                  <Td mono>{d.bag_no}</Td>
                  <Td mono>{d.bag_serial_no || '—'}</Td>
                  <Td>{d.lot_number || '—'}</Td>
                  <Td>{d.product_type || '—'}</Td>
                  <Td>{d.variant || '—'}</Td>
                  <Td right mono>{d.kg_gross != null ? d.kg_gross.toFixed(1) : '—'}</Td>
                  <Td right mono>{d.kg_nett.toFixed(1)}</Td>
                  <Td>{d.delivery_date || '—'}</Td>
                  <Td>{d.local_or_export || '—'}</Td>
                  <Td>{d.org_or_conv || '—'}</Td>
                  <Td tone={d.is_spillage ? 'warn' : undefined}>{d.is_spillage ? 'Yes' : 'No'}</Td>
                  <Td>{d.notes || '—'}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </PanelBody>
      </Panel>

      {/* Bagging (outputs) — grouped by product type, each type counted on its
          own ("14 bags of Fine Leaf"), read live from the bag_tags ledger so
          nothing the floor bagged is ever missing here. */}
      <Panel>
        <PanelHead title="Bagging — output bags"
          meta={`${bags.length} bag${bags.length === 1 ? '' : 's'} · ${bagsOutputKg.toFixed(1)} kg`} />
        <PanelBody>
          {bags.length === 0 ? <Empty>No output bags recorded.</Empty> : (
            <div className="space-y-4">
              {groupByType(bags).map(g => (
                <BagTypeGroup key={g.type} type={g.type} rows={g.rows} />
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Sign-off */}
      <Panel>
        <PanelHead title="Sign-off" />
        <PanelBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SignoffBlock label="Operator"   name={s.op_name_signoff}  signedAt={s.op_signed_at}  image={opSig?.signature_b64} />
            <SignoffBlock label="Supervisor" name={s.sup_name_signoff} signedAt={s.sup_signed_at} image={supSig?.signature_b64} />
          </div>
        </PanelBody>
      </Panel>

      {/* Comments */}
      {s.comments && (
        <Panel>
          <PanelHead title="Comments" />
          <PanelBody><p className="text-[12.5px] text-text whitespace-pre-wrap">{s.comments}</p></PanelBody>
        </Panel>
      )}

      {/* Reopen history */}
      {reopenRequests.length > 0 && (
        <Panel>
          <PanelHead title="Reopen history" meta={String(reopenRequests.length)} />
          <PanelBody>
            <Table head={['Requested by', 'Reason', 'Status', 'Decided by', 'Decision note', 'Decided at']} align={[]}>
              {reopenRequests.map(r => (
                <Tr key={r.id}>
                  <Td>{r.requested_by_name || '—'}</Td>
                  <Td>{r.reason}</Td>
                  <Td><Pill tone={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'err' : 'warn'}>{r.status}</Pill></Td>
                  <Td>{r.decided_by_name || '—'}</Td>
                  <Td>{r.decision_note || '—'}</Td>
                  <Td>{r.decided_at ? format(new Date(r.decided_at), 'd MMM HH:mm') : '—'}</Td>
                </Tr>
              ))}
            </Table>
          </PanelBody>
        </Panel>
      )}
    </div>
  )
}

// Group the merged bag list by product type, preserving first-seen order, so
// each output type reads as its own tally ("14 bags of Fine Leaf · 4,200 kg")
// — the same per-type mental model as the capture screen.
function groupByType(bags: OrderBagRow[]): { type: string; rows: OrderBagRow[] }[] {
  const order: string[] = []
  const map = new Map<string, OrderBagRow[]>()
  for (const b of bags) {
    const t = b.product_type || 'Other'
    if (!map.has(t)) { map.set(t, []); order.push(t) }
    map.get(t)!.push(b)
  }
  return order.map(type => ({ type, rows: map.get(type)! }))
}

// One product type's bags. Compact per-bag lines (not a wide table) so it stays
// readable on a phone — the whole reason the flat 7-column table was cramped.
function BagTypeGroup({ type, rows }: { type: string; rows: OrderBagRow[] }) {
  const kg = rows.reduce((s, r) => s + (r.kg || 0), 0)
  return (
    <div className="rounded-xl border border-surface-rule overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-dim">
        <span className="text-[12.5px] font-semibold text-text">{type}</span>
        <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
          {rows.length} bag{rows.length === 1 ? '' : 's'} · {kg.toFixed(1)} kg
        </span>
      </div>
      <ul className="divide-y divide-surface-rule/60">
        {rows.map((b, i) => (
          <li key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span className="font-mono text-text-faint w-6 shrink-0 text-right">{i + 1}</span>
            <span className="font-mono text-text flex-1 min-w-0 truncate">{b.bag_serial_no || '—'}</span>
            {b.output_group && <span className="font-mono text-[10px] text-text-faint shrink-0">grp {b.output_group}</span>}
            <span className="font-mono text-text-muted shrink-0 tabular-nums w-16 text-right">{b.kg.toFixed(1)} kg</span>
            <span className="font-mono text-text-faint shrink-0 w-10 text-right">{fmtBagTime(b.bagging_time)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-faint">{label}</div>
      <div className="text-[12.5px] text-text mt-0.5 truncate">{value}</div>
    </div>
  )
}

function SignoffBlock({ label, name, signedAt, image }: { label: string; name: string | null; signedAt: string | null; image?: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-faint mb-1">{label}</div>
      {!name ? (
        <p className="text-[12px] text-text-faint">Not yet signed</p>
      ) : (
        <>
          <p className="text-[13px] text-text font-medium">{name}</p>
          {signedAt && <p className="text-[11px] text-text-muted">{format(new Date(signedAt), 'd MMM yyyy HH:mm')}</p>}
          {image && (
            <div className="mt-1.5 rounded-lg border border-surface-rule bg-white px-3 py-2 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt={`${name}'s signature`} style={{ height: 40 }} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

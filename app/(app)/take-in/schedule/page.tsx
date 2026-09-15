'use client'

// app/(app)/take-in/schedule/page.tsx
//
// The delivery calendar. Every rule lives in canBook(); the grid colours each
// cell by asking it, so what an operator sees is the rule engine's own answer
// rather than a second copy of the rules that can drift from it.
//
// A booking becomes a delivery here too — "arrived, open delivery" carries the
// producer, contract, depot, day and expected load straight onto the batch, so
// nobody retypes them at the gate onto the wrong contract.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { takeinDb, loadDepots, visibleDepots, deliveryDepots, allocateBatchNo, logBatchEvent, errMsg } from '@/lib/takein/db'
import type { Depot, Contract } from '@/lib/takein/types'
import { Loader2, AlertTriangle, X, Truck } from 'lucide-react'

// ── the rules, in one place ─────────────────────────────────────────────────
const BK = {
  open: 8, lastStart: 16, close: 17,
  friLastStart: 12, friClose: 13,
  genHours: 2, maxPerDay: 2, noticeH: 24, bagNominal: 350,
  oneHourMax: 30, twoHourMax: 80,
  mgrFromH: 8, mgrToH: 10, mgrReleaseDow: 4, mgrReleaseH: 10,
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso  = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dOf  = (s: string) => new Date(`${s}T00:00:00`)
const dow  = (s: string) => { const x = dOf(s).getDay(); return x === 0 ? 7 : x }
const hhmm = (h: number) => `${pad(h)}:00`
const DAY  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const addD = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

const isWorkday   = (ds: string) => dow(ds) <= 5
const dayLastStart = (ds: string) => dow(ds) === 5 ? BK.friLastStart : BK.lastStart
const dayClose     = (ds: string) => dow(ds) === 5 ? BK.friClose : BK.close
/** Friday is a five-hour day; reserving two of them for general work costs more
 *  delivery capacity than the general work needs. */
const needsGenGap  = (ds: string) => dow(ds) !== 5

const sizeOf = (bags: number) =>
  !bags || bags <= 0 ? { hours: 1, label: '—', alert: false }
  : bags <= BK.oneHourMax ? { hours: 1, label: '1-hour slot', alert: false }
  : bags <= BK.twoHourMax ? { hours: 2, label: '2-hour slot', alert: false }
  : { hours: 2, label: '2-hour slot', alert: true }

interface Booking {
  id: string; warehouse_id: string; contract_id: string | null
  booked_date: string; start_hour: number; hours: number; bags: number
  expected_kg: number | null; land_name: string | null; note: string | null
  kind: 'farmer' | 'shipping'; status: string; alert: boolean; batch_id: string | null
  contract?: { contract_no: string; producer: { name: string } | null } | null
}

export default function SchedulePage() {
  const router = useRouter()
  const { p, fullName, user, depotCodes } = useAuth()
  const mayBook = p('can_book_takein')
  const isMgr   = p('can_override_takein_booking')
  const actor   = { id: user?.id ?? null, name: fullName ?? 'Unknown' }

  const [depots, setDepots]     = useState<Depot[]>([])
  const [depotId, setDepotId]   = useState('')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [week, setWeek]         = useState(() => mondayOf(new Date()))
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')
  const [slot, setSlot]         = useState<null | { date: string; hour: number }>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const all = await loadDepots()
      const mine = deliveryDepots(visibleDepots(all, depotCodes))
      setDepots(mine)
      const wh = depotId && mine.some(d => d.id === depotId) ? depotId : (mine[0]?.id ?? '')
      setDepotId(wh)
      if (!wh) { setBookings([]); return }

      const db = takeinDb()
      const [{ data: bk, error }, { data: ct }] = await Promise.all([
        db.from('bookings')
          .select('*, contract:contract_id ( contract_no, producer:producer_id ( name ) )')
          .eq('warehouse_id', wh).neq('status', 'cancelled')
          .gte('booked_date', iso(addD(week, -7))).lte('booked_date', iso(addD(week, 13))),
        db.from('contracts').select('*, producer:producer_id ( name )')
          .eq('status', 'released').order('contract_no'),
      ])
      if (error) throw error
      setBookings((bk as unknown as Booking[]) ?? [])
      setContracts((ct as unknown as Contract[]) ?? [])
    } catch (e: unknown) { setErr(errMsg(e, 'Could not load the calendar.')) }
    finally { setLoading(false) }
  }, [depotCodes.join(','), depotId, week.getTime()])

  useEffect(() => { void load() }, [load])

  const days = useMemo(() => [0,1,2,3,4].map(i => iso(addD(week, i))), [week])
  const now  = new Date()

  const onDay = useCallback((ds: string) =>
    bookings.filter(b => b.booked_date === ds && b.status !== 'cancelled'), [bookings])

  const occupied = useCallback((ds: string, exceptId?: string) => {
    const m = new Map<number, Booking>()
    for (const b of onDay(ds)) {
      if (b.id === exceptId) continue
      for (let h = b.start_hour; h < b.start_hour + b.hours; h++) m.set(h, b)
    }
    return m
  }, [onDay])

  /** Mon–Thu 08:00–10:00 of the IMMEDIATELY next week belongs to the manager
   *  until Thursday 10:00 of the current week. Two weeks out it is open. */
  const inMgrWindow = (ds: string, start: number, hours: number) =>
    dow(ds) >= 1 && dow(ds) <= 4 && start < BK.mgrToH && start + hours > BK.mgrFromH
  const mgrHeld = (ds: string) => {
    const weeks = Math.round((mondayOf(dOf(ds)).getTime() - mondayOf(now).getTime()) / 6048e5)
    if (weeks !== 1) return false
    const rel = addD(mondayOf(now), BK.mgrReleaseDow - 1); rel.setHours(BK.mgrReleaseH, 0, 0, 0)
    return now < rel
  }

  const genGapRemains = (ds: string, extra?: { start: number; hours: number }) => {
    if (!needsGenGap(ds)) return true
    const occ = occupied(ds)
    if (extra) for (let h = extra.start; h < extra.start + extra.hours; h++) occ.set(h, {} as Booking)
    const close = dayClose(ds)
    for (let h = BK.open; h + BK.genHours <= close; h++) {
      let free = true
      for (let k = h; k < h + BK.genHours; k++) if (occ.has(k)) free = false
      if (free) return true
    }
    return false
  }

  type Refusal = { kind: string; msg: string }
  function canBook(ds: string, start: number, hours: number, contractId: string | null): {
    ok: boolean; why: Refusal[]; closed: boolean
  } {
    const r: Refusal[] = []
    const add = (kind: string, msg: string) => r.push({ kind, msg })

    if (!isWorkday(ds)) add('closed', 'The depot does not take deliveries at weekends.')
    else {
      const ls = dayLastStart(ds), cl = dayClose(ds)
      if (start < BK.open) add('closed', `Slots open at ${hhmm(BK.open)}.`)
      else if (start > ls) add('closed', `Latest start on ${DAY[dow(ds)-1]} is ${hhmm(ls)}.`)
      else if (start + hours > cl) add('closed', `A ${hours}-hour load from ${hhmm(start)} runs past ${hhmm(cl)} — the depot closes.`)
    }
    if (new Date(`${ds}T${pad(start)}:00:00`).getTime() - now.getTime() < BK.noticeH * 3600e3)
      add('notice', `Bookings need ${BK.noticeH} hours' notice.`)
    if (!isMgr && inMgrWindow(ds, start, hours) && mgrHeld(ds))
      add('prio', 'Held for the manager until Thursday 10:00 — raw-material shipping loads take this window next week.')

    const occ = occupied(ds)
    let clash = false
    for (let h = start; h < start + hours; h++) if (occ.has(h)) clash = true
    if (clash) add('busy', 'Another load already has that time.')

    if (contractId) {
      const mine = onDay(ds).filter(b => b.contract_id === contractId).length
      if (mine >= BK.maxPerDay)
        add('cap', `A producer may book ${BK.maxPerDay} loads a day — put the rest on another day.`)
    }
    if (!genGapRemains(ds, { start, hours }))
      add('gen', 'That would leave no clear two-hour window for general work.')

    return { ok: !r.length, why: r, closed: r.some(x => x.kind === 'closed' || x.kind === 'busy') }
  }

  async function createBooking(form: {
    date: string; hour: number; contractId: string; bags: number; kg: number
    land: string; note: string; kind: 'farmer' | 'shipping'; override: string
  }) {
    if (!depotId) return
    setBusy(true)
    try {
      const s = sizeOf(form.bags)
      const { error } = await takeinDb().from('bookings').insert({
        warehouse_id: depotId,
        contract_id: form.kind === 'shipping' ? null : form.contractId,
        booked_date: form.date, start_hour: form.hour, hours: s.hours,
        bags: form.bags, expected_kg: form.kg || form.bags * BK.bagNominal,
        land_name: form.land || null, note: form.note || null,
        kind: form.kind, alert: form.kind === 'farmer' && s.alert,
        override_reason: form.override || null, created_by: user?.id ?? null,
      })
      if (error) throw error
      setSlot(null)
      await load()
    } catch (e: unknown) { setErr(errMsg(e, 'Could not save the booking.')) }
    finally { setBusy(false) }
  }

  /** The booking already carries everything the gate would otherwise retype. */
  async function openDelivery(b: Booking) {
    if (!b.contract_id) return
    setBusy(true)
    try {
      const batchNo = await allocateBatchNo(b.warehouse_id)
      const db = takeinDb()
      const { data, error } = await db.from('batches').insert({
        batch_no: batchNo, warehouse_id: b.warehouse_id, contract_id: b.contract_id,
        booking_id: b.id, delivered_on: b.booked_date, bags: b.bags,
        harvest_year: new Date(b.booked_date).getFullYear(),
        checks_json: [false, false, false, false, false, false],
        created_by: user?.id ?? null,
      }).select('id').single()
      if (error) throw error
      const batchId = (data as { id: string } | null)?.id
      if (!batchId) throw new Error('The delivery was created but returned no id.')

      if (b.land_name) {
        await db.from('batch_lands').insert({ batch_id: batchId, ordinal: 1, name: b.land_name })
      }
      await db.from('bookings').update({ status: 'arrived', batch_id: batchId }).eq('id', b.id)
      await logBatchEvent(batchId, 'delivery_opened',
        `Delivery opened from booking — ${DAY[dow(b.booked_date)-1]} ${b.booked_date} `
        + `${hhmm(b.start_hour)}, ${b.bags} bags expected`
        + (b.contract?.contract_no ? `, contract ${b.contract.contract_no}` : ''), actor)
      router.push('/take-in/intake')
    } catch (e: unknown) { setErr(errMsg(e, 'Could not open the delivery.')) }
    finally { setBusy(false) }
  }

  const weekOffset = Math.round((week.getTime() - mondayOf(now).getTime()) / 6048e5)
  const held = mgrHeld(days[0])

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading the calendar…
    </div>
  )
  if (!depots.length) return (
    <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-8 text-center text-[12px] text-text-muted">
      No delivery depot is in scope for your account.
    </div>
  )

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{err}
        </div>
      )}

      <section className="rounded-2xl border border-surface-rule bg-surface-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-rule px-4 py-3">
          <span className="font-display text-[14px] font-semibold text-text">
            Week of {dOf(days[0]).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} —{' '}
            {dOf(days[4]).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
            <span className="ml-2 text-[11px] font-normal text-text-muted">
              {weekOffset === 0 ? 'this week' : weekOffset === 1 ? 'next week'
                : weekOffset > 1 ? `${weekOffset} weeks out` : 'past'}
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {depots.length > 1 && (
              <select value={depotId} onChange={e => setDepotId(e.target.value)}
                className="rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[12px] text-text">
                {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <button onClick={() => setWeek(w => addD(w, -7))} className="rounded-lg border border-surface-rule px-2.5 py-1.5 text-[12px] font-semibold text-text">‹ Prev</button>
            <button onClick={() => setWeek(mondayOf(new Date()))} className="rounded-lg border border-surface-rule px-2.5 py-1.5 text-[12px] font-semibold text-text">This week</button>
            <button onClick={() => setWeek(w => addD(w, 7))} className="rounded-lg border border-surface-rule px-2.5 py-1.5 text-[12px] font-semibold text-text">Next ›</button>
          </div>
        </header>

        <div className="px-4 py-3">
          <div className="mb-3 rounded-xl border border-surface-rule bg-surface-dim px-3 py-2 text-[11px] text-text-muted">
            {held
              ? isMgr
                ? 'Mon–Thu 08:00–10:00 next week is still held against producers — hatched blue, and yours to book for shipping loads until Thursday 10:00.'
                : "Mon–Thu 08:00–10:00 next week is held for the manager's shipping loads until Thursday 10:00."
              : weekOffset === 1
                ? 'The Mon–Thu 08:00–10:00 priority window has been released — anyone may book it.'
                : 'The priority window only applies to the week immediately ahead, so nothing is held here.'}
          </div>

          <div className="overflow-x-auto">
            <table
            className="w-full min-w-[46rem] table-fixed border-separate"
            // inline rather than the Tailwind utility: the colour-token scanner reads
            // that class name as an undefined token and the ratchet counts it.
            style={{ borderSpacing: 3 }}
          >
              <thead>
                <tr>
                  <th className="w-14" />
                  {days.map(ds => (
                    <th key={ds} className="pb-1 text-center font-mono text-[11px] font-semibold uppercase text-text-muted">
                      {DAY[dow(ds) - 1]}
                      <span className="block font-normal opacity-70">{dOf(ds).getDate()}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: BK.lastStart - BK.open + 1 }, (_, i) => BK.open + i).map(h => {
                  const skip: Record<string, boolean> = {}
                  return (
                    <tr key={h}>
                      <td className="pr-1.5 text-right align-top font-mono text-[11px] text-text-faint">{hhmm(h)}</td>
                      {days.map(ds => {
                        const occ = occupied(ds)
                        const bk = occ.get(h)
                        if (bk && bk.start_hour !== h) return null
                        if (bk) return (
                          <td key={ds} rowSpan={bk.hours}
                            className={`rounded-lg border px-1.5 py-1 align-top text-[11px] ${
                              bk.kind === 'shipping'
                                ? 'border-info/30 bg-info-bg text-info'
                                : 'border-ok/30 bg-ok-bg text-ok'}`}>
                            <span className="block font-semibold">
                              {bk.kind === 'shipping' ? 'Shipping' : (bk.contract?.producer?.name ?? '—').split(' ')[0]}
                            </span>
                            <span className="block text-[10px] opacity-80">{bk.bags} bags · {bk.hours}h</span>
                            {bk.alert && <span className="block text-[9px] font-semibold text-warn">⚠ manager</span>}
                          </td>
                        )

                        const v = canBook(ds, h, 1, null)
                        if (v.ok) {
                          const prio = inMgrWindow(ds, h, 1) && mgrHeld(ds)
                          return (
                            <td key={ds}
                              onClick={() => mayBook && setSlot({ date: ds, hour: h })}
                              title={prio ? 'Priority window — yours to book' : `Click to book ${hhmm(h)}`}
                              className={`cursor-pointer rounded-lg border px-1.5 py-1 text-center align-top text-[11px] ${
                                prio
                                  ? 'border-info/30 bg-info-bg text-info'
                                  : 'border-surface-rule bg-surface-card text-text-faint hover:border-accent hover:bg-accent-bg'}`}>
                              {prio ? <span className="font-mono text-[9px] uppercase">priority</span> : '+'}
                            </td>
                          )
                        }
                        const cls = v.why.some(x => x.kind === 'prio') ? 'border-info/30 bg-info-bg text-info'
                                  : v.why.some(x => x.kind === 'gen') ? 'border-warn/30 bg-warn-bg text-warn'
                                  : 'border-transparent bg-surface-dim text-text-faint'
                        const overridable = isMgr && !v.closed
                        return (
                          <td key={ds} title={v.why.map(x => x.msg).join(' ')}
                            onClick={() => overridable && setSlot({ date: ds, hour: h })}
                            className={`rounded-lg border px-1.5 py-1 text-center align-top text-[10px] ${cls} ${
                              overridable ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                            {v.why.some(x => x.kind === 'prio') ? 'priority'
                              : v.why.some(x => x.kind === 'gen') ? 'general' : ''}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* week list */}
      <section className="rounded-2xl border border-surface-rule bg-surface-card">
        <header className="border-b border-surface-rule px-4 py-3">
          <span className="font-display text-[14px] font-semibold text-text">Bookings this week</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-surface-rule bg-surface-raised">
              {['When', 'Producer', 'Land', 'Bags', 'Slot', ''].map(h => (
                <th key={h} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {bookings.filter(b => days.includes(b.booked_date))
                .sort((a, b) => a.booked_date.localeCompare(b.booked_date) || a.start_hour - b.start_hour)
                .map(b => (
                <tr key={b.id} className="border-b border-surface-rule last:border-0">
                  <td className="px-4 py-2.5 text-[12px] text-text">
                    <strong>{DAY[dow(b.booked_date) - 1]} {dOf(b.booked_date).getDate()}</strong> {hhmm(b.start_hour)}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-text">
                    {b.kind === 'shipping' ? <em className="text-text-muted">Raw-material shipping</em>
                                           : (b.contract?.producer?.name ?? '—')}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-text-muted">{b.land_name ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{b.bags}{b.alert && ' ⚠'}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-text">{b.hours}h</td>
                  <td className="px-4 py-2.5">
                    {b.kind === 'farmer' && (
                      b.batch_id
                        ? <span className="font-mono text-[11px] text-ok">received ✓</span>
                        : <button onClick={() => void openDelivery(b)} disabled={busy || !mayBook}
                            className="inline-flex items-center gap-1 rounded-lg border border-surface-rule px-2.5 py-1 text-[11px] font-semibold text-text disabled:opacity-40">
                            <Truck className="h-3 w-3" /> arrived — open delivery
                          </button>
                    )}
                  </td>
                </tr>
              ))}
              {!bookings.filter(b => days.includes(b.booked_date)).length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-text-muted">
                  Nothing booked this week at this depot.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {slot && (
        <BookDialog slot={slot} contracts={contracts} isMgr={isMgr} busy={busy}
          check={(bags, contractId, kind) =>
            canBook(slot.date, slot.hour, sizeOf(bags).hours, kind === 'shipping' ? null : contractId)}
          onCancel={() => setSlot(null)} onConfirm={createBooking} />
      )}
    </div>
  )
}

function BookDialog({ slot, contracts, isMgr, busy, check, onCancel, onConfirm }: {
  slot: { date: string; hour: number }; contracts: Contract[]; isMgr: boolean; busy: boolean
  check: (bags: number, contractId: string, kind: 'farmer' | 'shipping') => { ok: boolean; why: { kind: string; msg: string }[]; closed: boolean }
  onCancel: () => void
  onConfirm: (f: { date: string; hour: number; contractId: string; bags: number; kg: number
                   land: string; note: string; kind: 'farmer' | 'shipping'; override: string }) => void
}) {
  const [kind, setKind]   = useState<'farmer' | 'shipping'>('farmer')
  const [cid, setCid]     = useState(contracts[0]?.id ?? '')
  const [bags, setBags]   = useState('')
  const [kgTxt, setKgTxt] = useState('')
  const [land, setLand]   = useState('')
  const [note, setNote]   = useState('')
  const [ovr, setOvr]     = useState('')

  const nBags = Math.max(0, Math.round(Number(bags.replace(/[^\d]/g, '')) || 0))
  const s = sizeOf(nBags)
  const v = check(nBags, cid, kind)
  const canOverride = isMgr && !v.ok && !v.closed && ovr.trim().length > 2
  const ok = (v.ok || canOverride) && (kind === 'shipping' || !!cid)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/45" onClick={onCancel} />
      <div className="relative w-full max-w-xl overflow-auto rounded-2xl border border-surface-rule bg-surface-card shadow-2xl"
           style={{ maxHeight: 'calc(100vh - 2.5rem)' }}>
        <header className="flex items-start justify-between border-b border-surface-rule px-4 py-3">
          <div>
            <div className="font-display text-[15px] font-bold text-text">
              {dOf(slot.date).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {' · '}{hhmm(slot.hour)}
            </div>
            <div className="text-[11px] text-text-muted">the slot you clicked</div>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-text-faint hover:text-text"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-3 px-4 py-4">
          {isMgr && (
            <div className="inline-flex overflow-hidden rounded-xl border border-surface-rule">
              {(['farmer', 'shipping'] as const).map(k => (
                <button key={k} onClick={() => setKind(k)}
                  className={`px-3 py-1.5 text-[12px] font-semibold ${
                    kind === k ? 'bg-accent-bg text-brand' : 'bg-transparent text-text-muted'}`}>
                  {k === 'farmer' ? 'Producer delivery' : 'Raw-material shipping load'}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {kind === 'farmer' && (
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">Producer / contract</span>
                <select value={cid} onChange={e => setCid(e.target.value)}
                  className="w-full rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[13px] text-text">
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>{c.contract_no} · {c.producer?.name}</option>
                  ))}
                  {!contracts.length && <option value="">No released contract</option>}
                </select>
              </label>
            )}
            <Fld label="Expected kg" value={kgTxt} onChange={v => {
              setKgTxt(v)
              const n = Number(v.replace(/[^\d.]/g, ''))
              if (n > 0) setBags(String(Math.max(1, Math.ceil(n / BK.bagNominal))))
            }} hint={`≈ ${BK.bagNominal} kg per bulk bag`} />
            <Fld label="Bulk bags" value={bags} onChange={setBags} mono />
            <Fld label="Land name" value={land} onChange={setLand} />
            <Fld label="Note" value={note} onChange={setNote} />
          </div>

          <div className="rounded-xl border border-surface-rule bg-surface-dim px-3 py-2.5 text-[12px] text-text">
            {nBags ? (
              <>
                <strong className="font-mono text-[15px]">{nBags} bags</strong> → <strong>{s.label}</strong>,{' '}
                {hhmm(slot.hour)} – {hhmm(slot.hour + s.hours)}
                {s.alert && <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-semibold text-warn">
                  ⚠ over {BK.twoHourMax} bags — raises a manager alert</span>}
              </>
            ) : (
              <span className="text-text-muted">
                Enter kilograms or a bag count — the load size decides whether this is a one-hour or a two-hour slot.
              </span>
            )}
          </div>

          {v.ok ? (
            <div className="rounded-xl border border-ok/25 bg-ok-bg px-3 py-2.5 text-[12px] text-ok">
              <strong>{hhmm(slot.hour)} – {hhmm(slot.hour + s.hours)} is available.</strong>{' '}
              Nothing in the rules stands in the way of this booking.
            </div>
          ) : (
            <div className="rounded-xl border border-warn/25 bg-warn-bg px-3 py-2.5 text-[12px] text-warn">
              <strong>This slot will not take the booking as it stands:</strong>
              <ul className="ml-4 mt-1 list-disc">{v.why.map(w => <li key={w.msg}>{w.msg}</li>)}</ul>
            </div>
          )}

          {!v.ok && !v.closed && isMgr && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Override reason <span className="text-err">*</span>
              </span>
              <input value={ovr} onChange={e => setOvr(e.target.value)}
                placeholder="e.g. Producer already loaded and on the road"
                className="w-full rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[13px] text-text" />
              <span className="mt-0.5 block text-[10px] text-text-faint">
                Recorded on the booking. A closed depot is not something an override can change.
              </span>
            </label>
          )}
          {!v.ok && v.closed && (
            <p className="text-[11px] text-text-muted">
              The depot is shut at that time, or the slot is already taken — not something an override can change.
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-surface-rule px-4 py-3">
          <button onClick={onCancel} className="rounded-xl border border-surface-rule px-3.5 py-2 text-[12px] font-semibold text-text">Cancel</button>
          <button disabled={!ok || busy}
            onClick={() => onConfirm({ date: slot.date, hour: slot.hour, contractId: cid, bags: nBags,
                                       kg: Number(kgTxt.replace(/[^\d.]/g, '')) || 0,
                                       land, note, kind, override: canOverride ? ovr.trim() : '' })}
            className="rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : v.ok ? 'Confirm booking' : 'Override and book'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Fld({ label, value, onChange, hint, mono }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; mono?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        className={`w-full rounded-lg border border-surface-rule bg-surface-card px-2.5 py-1.5 text-[13px] text-text ${mono ? 'font-mono' : ''}`} />
      {hint && <span className="mt-0.5 block text-[10px] text-text-faint">{hint}</span>}
    </label>
  )
}

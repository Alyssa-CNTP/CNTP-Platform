'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Printer, PenLine, Package, PackageCheck, Scale, Sparkles, Lock, Pencil, Check, AlertTriangle } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { voidBagTag, fetchTopUpEventsForSession, type TopUpEvent } from '@/lib/production/scan-utils'
import { printLabelAuto } from '@/lib/production/label-print'
import { variantToShort, isImplausibleWeight, GRADE_TO_LOCAL_EXPORT } from '@/lib/production/capture-config'
import { nextStepNudge, recentBatches, debaggedBatches } from '@/lib/production/inventory'
import { OutputPicker, type PickedOutput } from '@/components/production/capture/OutputPicker'
import { BatchKeypadField } from '@/components/production/capture/BatchKeypadField'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment } from '@/lib/supabase/database.types'
import { logBucketElevator, outstandingBucketElevator, variantFamily } from '@/lib/production/bucket-elevator'
import { n } from '@/lib/core/num'
import { resolveTypeCode } from '@/lib/core/serials'
import { canonicalProductType } from '@/lib/core/product-names'
import { allocateBagSerial } from '@/lib/production/serial-allocator'
import { legacySievingSerial } from '@/lib/production/serial-legacy'
import { usesDbSerials } from '@/lib/config/flags'
import { sievingTotals } from '@/lib/core/mass-balance/sieving'
import { debagRowKey, missingDebagRows } from '@/lib/production/debag-reconcile'
export { sievingTotals }
export { debagRowKey }

// ── Sieving output serial ─────────────────────────────────────────────────────
// Format: ST{TYPE}-DDMMYY-NNN  (e.g. Fine Leaf → STFL-120826-003).
// A 2-letter output-type code plus a per-type daily sequence, so the number of
// bags of each output type is readable straight off the serial and its barcode
// (the barcode encodes serial_number verbatim). Each type counts independently.
// Serial minting moved to lib/core/serials.ts + lib/production/serial-allocator.ts
// (ARCHITECTURE.md §5). What used to live here was a private copy of the type
// abbreviations, the date stem and seqOf, plus a max+1 scan of bag_tags capped
// at limit(4000) -- the race that loses bags when two operators bag at once,
// and the wrong-max read that starts colliding past 4000 rows (§1B).
//
// The date is still the SESSION's date, never the device clock: the afternoon
// shift runs to 01h00 and wall-clock time would roll the stem to tomorrow
// mid-run and restart the sequence inside one continuous production day.

export interface SpillageRow { id: string; kg: string }
export interface DebagRow {
  id: string; bag_no: string; lot: string; gross: string; nett: string
  delivery_date: string; grade: string; secured?: boolean; logged_at?: string
}
export interface OutBag {
  id: string; serial: string; productType: string; code: string | null; description?: string
  weight: string; batch: string; destination: string; printed: boolean
  tagMethod?: 'printed' | 'handwritten' | null   // per-bag choice, same pattern as Blender
  secured?: boolean; logged_at?: string
}
export interface SievingData {
  spillage: SpillageRow[]
  debag:    DebagRow[]
  outputs:  OutBag[]
  bucketSecured?: boolean      // bucket-elevator spillage locked once finished (per grade)
  bucketLedgerLogged?: boolean // this session's bucket-elevator figure already written to
                                // production.bucket_elevator_log — set once, on first lock, so
                                // re-locking after an Edit never double-writes the carry-over ledger
}

export function emptySievingData(): SievingData {
  return {
    spillage: [{ id: crypto.randomUUID(), kg: '' }, { id: crypto.randomUUID(), kg: '' }],
    debag:    [],
    outputs:  [],
  }
}

const nowISO = () => new Date().toISOString()
// Sieving lot numbers vary more than a single letter+digit shape — plain
// source lots like GS-0299 or MAT-0270 alongside manual-mix batches like
// GS26-MIX-A. The invariant that holds across all real examples is
// structural, not a fixed length or character class: at least one dash
// separating alphanumeric segments, not a bare unstructured string.
// Rejecting anything dash-less/too-short at entry is what catches a dropped
// digit or a missing dash before it becomes a batch number that doesn't
// match anything real. Exported so downstream sections (Blender's Fine/
// Coarse Leaf batch number, which is always a Sieving Tower lot) enforce the
// identical rule rather than a second, potentially-drifting copy of it.
export const isValidLot = (lot: string) => {
  const v = lot.trim()
  return v.length >= 3 && v.length <= 20 && /^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(v)
}
// Display a logged-at timestamp in SAST (Africa/Johannesburg), e.g. "13:42".
const fmtTime = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

// Section colours — bulk bags carry the blue of Debagging, output bags the
// amber of Bagging, so each list visibly belongs to the section you tapped.
const DEBAG_BLUE = '#1d4ed8'

// Output bags are grouped by product type (Leaf / Dust / Sticks) so a shift
// with several types bagged never turns into one long, easy-to-lose-count
// list — same idea as Blender's colour-coded ingredient groups, one colour
// per group, bags numbered within their own group.
const GROUP_COLORS = ['#d97706', '#0d9488', '#7c3aed', '#2563eb', '#db2777']
const groupColor = (i: number) => GROUP_COLORS[i % GROUP_COLORS.length]

// Canonical group order (paper-form order), not discovery order — a shift
// that bags Sticks before Fine Leaf shouldn't reorder the groups on screen.
// Anything not in this list (Dust, a free-text search result, etc.) sorts
// after, in the order it was first bagged.
const OUTPUT_GROUP_ORDER = ['Fine Leaf', 'Coarse Leaf', 'Indent Sticks', 'Heavy Sticks', 'RB Blocks']
function sortOutputGroups(types: string[]): string[] {
  // Ordered by canonical name so a session left open across the Sticks rename
  // does not drop its 'Rolsiev Sticks' group to the bottom of the list.
  return [...types].sort((a, b) => {
    const ia = OUTPUT_GROUP_ORDER.indexOf(canonicalProductType(a))
    const ib = OUTPUT_GROUP_ORDER.indexOf(canonicalProductType(b))
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

export type Shift = 'morning' | 'afternoon'

// Mass balance for one Sieving production.
//
// The bucket elevator holds work-in-progress that carries across the production
// day (07h00–01h00). The MORNING shift *consumes* what yesterday left in the
// elevator — so it's an INPUT. The AFTERNOON shift *leaves* material in the
// elevator for the next day — so it's an OUTPUT. The two are different material
// and never cancel; keeping the distinction is what makes the run balance honest.
// Machine spillage (spillage[1..]) is always counted on the input side.
//
// topUpKg — Half-bag Top-up weight added into an EXISTING bag this session
// (see HalfBagTopUpModal/addFreshWeightToBag). It's a side-channel write
// that never touches d.outputs, so without this parameter it was invisible
// here: the debagged material it came from is still counted in debagIn
// above, but the bagged weight it became was never added back to outputs —
// a real, growing mass-balance shortfall, not just a display quirk. Callers
// pass the session's own topped-up total (fetchTopUpEventsForSession),
// defaulting to 0 for any caller that hasn't wired it up yet.

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'

export function SievingCapture({
  assignment, variantWord, gradeLetter = 'A', shift = 'morning', locked, value, onChange, genSerial, operatorId, date,
  sectionId = 'sieving', sessionId,
  otherBatchDebagKeys = [], otherBatchOutputSerials = [],
}: {
  assignment: ShiftAssignment
  variantWord: string
  gradeLetter?: string
  shift?: Shift
  locked: boolean
  value: SievingData
  onChange: (d: SievingData) => void
  genSerial: () => string
  operatorId?: string | null
  date: string   // session's dateParam (YYYY-MM-DD), never the device clock — see addOutput
  sectionId?: string
  sessionId?: string | null
  // What the session's OTHER batches already hold. prod_debagging and bag_tags
  // are keyed on session_id with no batch discriminator, so the self-heal below
  // cannot tell this batch's rows from a sibling batch's without being told —
  // and a changeover mounts this component fresh and empty against a session
  // that already has rows. See the self-heal effect.
  otherBatchDebagKeys?: string[]
  otherBatchOutputSerials?: string[]
}) {
  const [tab, setTab]       = useState<'debag' | 'bag'>('debag')
  const [picking, setPicking] = useState(false)
  // Set when a bag's serial was minted on a degraded path: an unmapped product
  // whose type code had to be derived from its name, or a number allocated
  // locally because the database was unreachable. Neither stops the operator
  // bagging; both are things somebody has to know about, and a silent
  // downgrade that looks identical to the safe path is how they go unnoticed.
  const [serialNotice, setSerialNotice] = useState<string | null>(null)
  const [dbBatches, setDbBatches] = useState<string[]>([])
  useEffect(() => { recentBatches('sieving').then(setDbBatches) }, [])
  const variantShort = variantToShort(variantWord as any) as ShortVariant

  // Batches allowed onto an output bag: whatever was debagged THIS session,
  // plus any batch debagged in an earlier session under the exact same
  // variant + grade this run is currently consuming — that carve-out covers a
  // lot fed in on a previous shift that's still legitimately being bagged out
  // today, without opening the field back up to every lot ever seen at this
  // section (which is what let a mistyped/wrong batch onto an output bag).
  const [matchingBatches, setMatchingBatches] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    debaggedBatches(sectionId, variantWord, GRADE_TO_LOCAL_EXPORT[gradeLetter] ?? 'Export')
      .then(list => { if (!cancelled) setMatchingBatches(list) })
    return () => { cancelled = true }
  }, [sectionId, variantWord, gradeLetter])

  const batchOptions = Array.from(new Set([
    assignment.lot_number ?? '',
    ...value.outputs.map(b => b.batch),
    ...value.debag.map(r => r.lot),
    ...dbBatches,
  ].filter(Boolean) as string[]))

  const patch = (p: Partial<SievingData>) => onChange({ ...value, ...p })

  // Read by the async self-heal below so it reconciles against the CURRENT batch
  // and the CURRENT sibling rows, not whatever they were when it started. Refs
  // rather than effect deps on purpose: as deps they would re-run the whole
  // reconcile on every keystroke. Synced in an effect rather than during render —
  // the self-heal only reads them after awaiting its queries, by which point
  // effects have committed, so there is nothing to gain from writing them earlier.
  const valueRef = useRef(value)
  const excludeRef = useRef({ debagKeys: otherBatchDebagKeys, outputSerials: otherBatchOutputSerials })
  useEffect(() => { valueRef.current = value })
  useEffect(() => {
    excludeRef.current = { debagKeys: otherBatchDebagKeys, outputSerials: otherBatchOutputSerials }
  })

  // Shared by both self-heal effects below: order strictly by when each row
  // was actually logged, never by array position — appending restored rows
  // to the end (their natural query order) is what produced "Bag 1"..N
  // labels that didn't match the times shown on each row. Anything without
  // a timestamp (still being typed, not yet secured) sorts last, as "most
  // recent."
  function byLoggedAt<T extends { logged_at?: string }>(rows: T[]): T[] {
    const t = (r: T) => (r.logged_at ? new Date(r.logged_at).getTime() : Infinity)
    return [...rows].sort((a, b) => t(a) - t(b))
  }

  // ── Self-heal this batch's rows from the ledgers ──────────────────────────
  // Output bags (bag_tags, written atomically the instant a bag is added) and
  // debagging inputs (prod_debagging, rewritten wholesale by persist() on every
  // save) can both fall behind draft_data if a save is disrupted mid-shift — a
  // deploy restart landing while the tab is open, a dropped connection, a stale
  // second tab's autosave clobbering a newer one. The ledger is the source of
  // truth, so whatever it holds that this batch doesn't is pulled back in. Never
  // removes anything, and never writes to bag_tags/scan_events itself.
  //
  // ONE effect and ONE patch, deliberately. As two effects they each built their
  // patch from the same mount-time `value` closure, so whichever query resolved
  // last silently discarded the other's restore — outputs were being dropped
  // that way, invisibly, whenever the debag query won the race.
  //
  // Both ledgers are keyed on session_id ALONE — neither carries a batch
  // discriminator, so a session that has been through a changeover has every
  // batch's rows sitting under one id. `excludeRef` carries what the session's
  // OTHER batches already hold, so those rows are not read as missing and copied
  // into this one: a row living in another batch of draft_data is not lost, and
  // restoring it here duplicates it. Without that exclusion every changeover
  // mounted an empty batch (key={active.id}), restored the whole session into
  // it, and doubled the session's inputs on the next save — 8 farm bags became
  // 258 and Sieving's mass balance read +86 t.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    ;(async () => {
      const db = getDb()
      const [tagsRes, debagRes] = await Promise.all([
        db.schema('production').from('bag_tags')
          .select('serial_number, product_type, acumatica_id, lot_number, weight_kg, destination, printed_at')
          .eq('section_id', 'sieving').eq('session_id', sessionId).neq('status', 'voided'),
        db.schema('production').from('prod_debagging')
          .select('notes, lot_number, product_type, kg_gross, kg_nett, delivery_date, grade, bagging_time, created_at')
          // 'Farm Bag' going forward, '500kg Farm Bag' on rows captured before the
          // rename — historical rows keep the old stored value, never backfilled.
          .eq('session_id', sessionId).in('product_type', ['Farm Bag', '500kg Farm Bag']).eq('is_spillage', false),
      ])
      if (cancelled) return

      // The latest value, never the mount-time closure — the operator may have
      // typed a bag in while those two queries were in flight.
      const cur = valueRef.current
      const exclude = excludeRef.current
      const next: Partial<SievingData> = {}

      const tags = (tagsRes.data as any[]) ?? []
      if (tags.length) {
        // Output bags have a serial, which is unique per bag, so identity is exact.
        const known = new Set([...cur.outputs.map(o => o.serial), ...exclude.outputSerials])
        const restored: OutBag[] = tags.filter(t => !known.has(t.serial_number)).map(t => ({
          id: crypto.randomUUID(), serial: t.serial_number, productType: t.product_type,
          code: t.acumatica_id ?? null, weight: String(t.weight_kg ?? ''), batch: t.lot_number ?? '',
          // A bag_tags row from before the grade column was populated for this
          // batch falls back to the batch's own current grade — the same
          // fallback addOutput() itself uses when creating one fresh.
          destination: t.destination ?? gradeLetter, printed: !!t.printed_at,
          tagMethod: t.printed_at ? 'printed' : null, secured: true,
          logged_at: t.printed_at ?? new Date().toISOString(),
        }))
        // Re-sort even when nothing was missing: a batch already fully restored
        // by an earlier run still had its rows in query order, not time order.
        const merged = byLoggedAt([...cur.outputs, ...restored])
        if (merged.length !== cur.outputs.length || merged.some((r, i) => r !== cur.outputs[i])) next.outputs = merged
      }

      const rows = (debagRes.data as any[]) ?? []
      if (rows.length) {
        // Debag rows have no stable identity, and rows off one farm pallet are
        // byte-identical, so this reconciles on multiplicity rather than set
        // membership — see lib/production/debag-reconcile.ts for why, and its
        // test file for the incident it pins.
        const restored: DebagRow[] = missingDebagRows(
          rows,
          d => debagRowKey(d.notes, d.lot_number, d.kg_nett),
          [...cur.debag.map(r => debagRowKey(r.bag_no, r.lot, r.nett)), ...exclude.debagKeys],
        )
          .map(d => ({
            id: crypto.randomUUID(), bag_no: d.notes ?? '', lot: d.lot_number ?? '',
            gross: d.kg_gross != null ? String(d.kg_gross) : '', nett: String(d.kg_nett ?? ''),
            delivery_date: d.delivery_date ?? '', grade: d.grade ?? '',
            secured: true, logged_at: d.bagging_time ?? d.created_at ?? new Date().toISOString(),
          }))
        const merged = byLoggedAt([...cur.debag, ...restored])
        if (merged.length !== cur.debag.length || merged.some((r, i) => r !== cur.debag[i])) next.debag = merged
      }

      if (Object.keys(next).length) onChange({ ...cur, ...next })
    })()
    return () => { cancelled = true }
  }, [sessionId])

  // Every field on a bulk bag is mandatory before it can be locked.
  const debagComplete = (r: DebagRow) => !!r.bag_no.trim() && isValidLot(r.lot) && n(r.nett) > 0 && !isImplausibleWeight(n(r.nett))

  // ── Auto-secure: completed bulk bags lock themselves (with a timestamp) as
  // the operator moves on — they never have to remember to tap "secure". Only a
  // fully-completed bag locks. Edit re-opens any locked row.
  const lockCompleted = (rows: DebagRow[]): DebagRow[] => {
    const t = nowISO()
    return rows.map(r => (!r.secured && debagComplete(r)) ? { ...r, secured: true, logged_at: r.logged_at ?? t } : r)
  }

  // ── Debagging ────────────────────────────────────────────────────────────
  // Adding the next bulk bag finalises the previous completed one.
  const addDebag = () => patch({ debag: [...lockCompleted(value.debag), {
    id: crypto.randomUUID(), bag_no: '', lot: assignment.lot_number ?? '',
    gross: '', nett: '', delivery_date: '', grade: GRADE_TO_LOCAL_EXPORT[gradeLetter] ?? 'Export',
  }] })
  const updateDebag = (id: string, k: keyof DebagRow, v: string) =>
    patch({ debag: value.debag.map(r => r.id === id ? { ...r, [k]: v } : r) })
  const removeDebag = (id: string) => patch({ debag: value.debag.filter(r => r.id !== id) })
  const setDebagSecured = (id: string, val: boolean) =>
    patch({ debag: value.debag.map(r => r.id === id ? { ...r, secured: val, logged_at: val ? (r.logged_at ?? nowISO()) : r.logged_at } : r) })
  const setOutputSecured = (id: string, val: boolean) =>
    patch({ outputs: value.outputs.map(b => b.id === id ? { ...b, secured: val } : b) })
  const updateSpillage = (id: string, v: string) =>
    patch({ spillage: value.spillage.map(r => r.id === id ? { ...r, kg: v } : r) })

  // Leaving the inbound (debag) step locks any finished bulk bags. On the MORNING
  // shift the bucket elevator is a start-of-day input captured here, so it locks
  // too; on the AFTERNOON shift it's an end-of-day output captured on the Bagging
  // tab, so it must stay open when the operator moves across.
  function goToTab(next: 'debag' | 'bag') {
    if (next === 'bag') patch({ debag: lockCompleted(value.debag), ...(shift === 'morning' ? bucketLockPatch() : {}) })
    setTab(next)
  }
  const bucketKg   = n(value.spillage?.[0]?.kg)                                   // elevator carryover (shown in the locked summary)
  // On the afternoon shift the bucket elevator is left for the next day, so it's
  // an END-OF-DAY OUTPUT captured on the Bagging tab; on the morning shift it's
  // the START-OF-DAY carry-in consumed that morning — an INPUT captured on the
  // Debagging tab. Same figure, placed on the tab that matches its direction.
  const bucketIsOutput = shift === 'afternoon'
  const bucketDir  = bucketIsOutput
    ? { title: 'Bucket elevator — end of day',   badge: 'counts as output', hint: 'left in the tower for tomorrow' }
    : { title: 'Bucket elevator — start of day', badge: 'counts as input',  hint: 'from yesterday · consumed this morning' }

  // ── Bucket-elevator carry-over ledger (production.bucket_elevator_log) ──────
  // RA-Conventional shares a physical carry-over pool with Conventional (same
  // for RA-Organic/Organic) — never with the other family — see
  // lib/production/bucket-elevator.ts. familyBalance is what THIS shift can
  // actually draw on; otherFamilyBalance is shown only to explain why a
  // mismatched shift sees nothing to consume.
  const family = variantFamily(variantWord)
  const [familyBalance, setFamilyBalance] = useState(0)
  const [otherFamilyBalance, setOtherFamilyBalance] = useState(0)
  useEffect(() => {
    let cancelled = false
    outstandingBucketElevator(sectionId, family).then(kg => { if (!cancelled) setFamilyBalance(kg) })
    outstandingBucketElevator(sectionId, family === 'organic' ? 'conventional' : 'organic')
      .then(kg => { if (!cancelled) setOtherFamilyBalance(kg) })
    return () => { cancelled = true }
  }, [sectionId, family, value.bucketLedgerLogged])

  // The morning shift's job is to consume exactly what last night's matching-
  // variant shift left in the elevator — prefill (never force) the field with
  // that balance so the operator confirms a real figure instead of re-typing
  // one off a handover note. Only fires while the field is still untouched.
  useEffect(() => {
    if (shift !== 'morning' || locked || value.bucketSecured) return
    const row = value.spillage?.[0]
    if (!row || row.kg.trim() !== '' || familyBalance <= 0) return
    updateSpillage(row.id, familyBalance.toFixed(1))
  }, [familyBalance, shift, locked, value.bucketSecured])

  // Single source of truth for "lock the bucket elevator": writes the ledger
  // entry at most once per session (bucketLedgerLogged), whichever direction
  // — generated (afternoon, left for tomorrow) or consumed (morning, drawn
  // from last night's balance) — this shift's figure represents. Returns a
  // patch delta rather than patching directly so goToTab can merge it into
  // the same patch() call as the debag lock (two separate patch() calls in a
  // row would race on the stale `value` closure and silently undo each other).
  function bucketLockPatch(): Partial<SievingData> {
    const kg = n(value.spillage?.[0]?.kg ?? '')
    // `family` is null when the run's variant isn't one we recognise — an
    // unset variant on the batch record, most often. The ledger is keyed on
    // family precisely so the two pools cannot combine, so there is nothing
    // safe to write; it used to default to 'conventional'. Deliberately NOT
    // marked as logged, so it is still owed rather than quietly written off,
    // and the next lock retries once the variant is set.
    const shouldLog = !value.bucketLedgerLogged && kg > 0 && family !== null
    if (shouldLog) {
      logBucketElevator(bucketIsOutput ? 'generated' : 'consumed',
        { sectionId, variantFamily: family, kg, date, shift, sessionId })
        .catch(err => console.error('[bucket-elevator] carry-over not logged', err))
    } else if (!value.bucketLedgerLogged && kg > 0) {
      console.error(
        `[bucket-elevator] ${kg} kg not logged: variant ${JSON.stringify(variantWord)} is not recognised, ` +
        `so it cannot be filed as conventional or organic. Set the variant on the batch record.`,
      )
    }
    return { bucketSecured: true, ...(shouldLog ? { bucketLedgerLogged: true } : {}) }
  }

  // ── Bagging — picker → serial → tag → label ──────────────────────────────
  async function addOutput(p: PickedOutput) {
    // Rolled out per section (NEXT_PUBLIC_FF_DB_SERIAL_ALLOCATION). Until
    // 'sieving' is in that list this mints the historic format the old way —
    // a serial is printed onto a physical bag, so stopping the new format has
    // to be one line in the environment, not a code revert.
    const localSerials = value.outputs.map(o => o.serial)
    let serial: string
    if (!usesDbSerials('sieving')) {
      serial = await legacySievingSerial(p.productType, localSerials, date)
    } else {
      const { code: typeCode, configured } = resolveTypeCode('ST', p.productType)
      const alloc = await allocateBagSerial({ workCentre: 'ST', typeCode, date }, localSerials)
      serial = alloc.serial
      // Both of these are worth saying out loud rather than swallowing: an
      // unmapped product got a guessed code that looks exactly like a real
      // one, and a locally-allocated number is not collision-proof.
      if (!configured || alloc.source === 'local') {
        setSerialNotice(!configured
          ? `"${p.productType}" has no serial code configured — ${typeCode} was derived from its name. Tell IT so it gets a proper one.`
          : 'Offline — this bag was numbered locally. Check for a duplicate serial once the tablet reconnects.')
      }
    }
    const grade  = gradeLetter || 'A'
    const now    = new Date().toISOString()
    const bag: OutputBag = {
      id: crypto.randomUUID(), serial_number: serial, product_type: p.productType,
      variant: variantShort, grade: grade as any, weight_kg: n(p.weight),
      lot_number: p.batch || '', section_id: 'sieving',
      section_name: 'Sieving Tower', created_at: now, printed: false,
      acumaticaId: p.code ?? undefined, acumaticaDesc: p.description,
    }
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number: serial, section_id: 'sieving', session_id: null,
        product_type: p.productType, variant: variantWord || null, weight_kg: n(p.weight),
        lot_number: bag.lot_number || null, acumatica_id: p.code || null,
        status: 'in_stock', consumed: false, printed_at: now, is_open: !!p.leaveOpen,
        destination: grade,
      } as any, { onConflict: 'serial_number' })
      // Event tracking — log the bagging-out once, when the bag is created.
      await getDb().schema('production').from('scan_events').insert({
        serial_number: serial, action: 'bagging_out', section_id: 'sieving',
        weight_kg: n(p.weight), operator_id: operatorId ?? null,
      } as any)
    } catch { /* session save retries */ }

    // An output bag is complete the moment it's added (picked + weighed), so it
    // logs and secures itself right away — no separate "secure" tap needed. The
    // tag itself (print vs write-on-bag) is a per-bag choice made just below,
    // same as Blender — not an automatic/global decision.
    patch({ outputs: [...value.outputs, {
      id: bag.id, serial, productType: p.productType, code: p.code, description: p.description,
      weight: p.weight, batch: bag.lot_number, destination: grade, printed: false, tagMethod: null,
      secured: true, logged_at: now,
    }] })
    setPicking(false)
  }

  function reprint(b: OutBag) {
    printLabelAuto({
      id: b.id, serial_number: b.serial, product_type: b.productType, variant: variantShort,
      grade: (b.destination || 'A') as any, weight_kg: n(b.weight), lot_number: b.batch,
      section_id: 'sieving', section_name: 'Sieving Tower', created_at: new Date().toISOString(),
      printed: true, acumaticaId: b.code ?? undefined,
    })
  }

  // Removing a bag from this record must also void its bag_tags row — leaving
  // it 'in_stock' would let it keep looking like real, available inventory
  // to every other screen even though this record says it doesn't exist.
  function removeOutput(b: OutBag) {
    patch({ outputs: value.outputs.filter(x => x.id !== b.id) })
    voidBagTag(b.serial, operatorId)
  }

  function setOutputTagMethod(id: string, method: 'printed' | 'handwritten') {
    patch({ outputs: value.outputs.map(b => b.id === id ? { ...b, tagMethod: method, printed: method === 'printed' } : b) })
    const b = value.outputs.find(x => x.id === id)
    if (!b) return
    getDb().schema('production').from('bag_tags').update({ tag_method: method } as any)
      .eq('serial_number', b.serial).then(() => {})
    if (method === 'printed') reprint(b)
  }

  // Half-bag Top-up: never touches value.outputs (side-channel write — see
  // HalfBagTopUpModal), so its weight has to be pulled in from scan_events
  // separately to actually count toward this session's own output total and
  // each topped-up bag's own displayed weight — otherwise the debagged
  // material it came from is counted as input with nothing to balance it
  // on the output side. Keyed by serial so each bag's own card can show
  // exactly what was added to it.
  //
  // Restricted to mode==='production' ("from today's production", no
  // source bag — addFreshWeightToBag) — mode==='existing' ("from another
  // bag" — transferBagWeight) moves weight OUT of a source bag that was
  // already counted as output when IT was first bagged, so adding it again
  // here would double-count; that mode is deliberately left off this total.
  const [topUpsBySerial, setTopUpsBySerial] = useState<Map<string, TopUpEvent[]>>(new Map())
  useEffect(() => {
    if (!sessionId) { setTopUpsBySerial(new Map()); return }
    let cancelled = false
    fetchTopUpEventsForSession(sectionId, sessionId).then(m => { if (!cancelled) setTopUpsBySerial(m) })
    return () => { cancelled = true }
  }, [sectionId, sessionId])
  const productionTopUpsBySerial = new Map(
    Array.from(topUpsBySerial.entries())
      .map(([serial, list]) => [serial, list.filter(t => t.mode === 'production')] as const)
      .filter(([, list]) => list.length > 0),
  )
  const topUpKg = Array.from(productionTopUpsBySerial.values()).flat().reduce((s, t) => s + t.kg, 0)

  const { totalIn, totalOut } = sievingTotals(value, { shift, topUpKg })
  const byType: Record<string, number> = {}
  value.outputs.forEach(b => { byType[b.productType] = (byType[b.productType] ?? 0) + 1 })
  const nudge = nextStepNudge('sieving', byType)

  // Live counts so the in/out split reads as two clear jobs with visible progress.
  const debagCount = value.debag.filter(r => n(r.nett) > 0).length
  const bagCount   = value.outputs.length

  // Bucket elevator — one figure, shown on the tab that matches its direction:
  // start-of-day input on Debagging (morning), end-of-day output on Bagging
  // (afternoon). Colour follows direction (blue = in, amber = out).
  const bucketRow = value.spillage?.[0]
  const bucketCard = bucketRow && (value.bucketSecured ? (
    <div className="flex items-center gap-3 bg-ok/5 border border-ok/30 rounded-2xl px-4 py-3">
      <Lock size={15} className="text-ok shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text">{bucketDir.title} · {bucketKg.toFixed(1)} kg</div>
        <div className="font-mono text-[11px] text-text-muted">logged · {bucketDir.badge} ({bucketDir.hint})</div>
      </div>
      {!locked && (
        <button onClick={() => patch({ bucketSecured: false })}
          className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg">
          <Pencil size={13} /> Edit
        </button>
      )}
    </div>
  ) : (
    <div className={`border rounded-2xl p-4 space-y-3 ${bucketIsOutput ? 'bg-amber-50/60 border-amber-200' : 'bg-blue-50/50 border-blue-200'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Scale size={14} className={bucketIsOutput ? 'text-amber-700' : 'text-blue-700'} />
        <span className={`font-semibold text-[13px] ${bucketIsOutput ? 'text-amber-800' : 'text-blue-800'}`}>{bucketDir.title}</span>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${bucketIsOutput ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{bucketDir.badge}</span>
        <span className="text-[11px] text-stone-500">{bucketDir.hint}</span>
      </div>
      {/* Carry-over context — morning shift only. familyBalance is what last
          night's matching-variant shift actually left (already prefilled into
          the field below); otherFamilyBalance explains an empty prefill when
          the elevator holds the OTHER family's material, which this shift
          can't touch. */}
      {!bucketIsOutput && (
        familyBalance > 0
          ? <p className="text-[11px] text-blue-700">{familyBalance.toFixed(1)} kg left in the elevator overnight ({family}) — prefilled below, confirm or correct it.</p>
          : otherFamilyBalance > 0
            ? <p className="text-[11px] text-amber-700">{otherFamilyBalance.toFixed(1)} kg of {family === 'organic' ? 'conventional' : 'organic'} bucket elevator is waiting in the tower — not usable on this {family} shift.</p>
            : null
      )}
      <div className="max-w-[52%]">
        <label className={LBL}>Bucket elevator (kg)</label>
        <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={bucketRow.kg} disabled={locked}
          onChange={e => updateSpillage(bucketRow.id, e.target.value)} placeholder="0" className={INP} />
        {isImplausibleWeight(n(bucketRow.kg)) && (
          <p className="text-[11px] text-err">That's over 999kg — check for a typo.</p>
        )}
      </div>
      {!locked && (
        <button onClick={() => patch(bucketLockPatch())}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] hover:bg-ok/20 transition-colors">
          <Check size={15} /> Done — lock bucket elevator
        </button>
      )}
    </div>
  ))

  // Machine spillage — always an input loss, captured on the Debagging tab on
  // either shift. Single field, no lock (it's one number).
  const machineRow = value.spillage?.[1]
  const machineCard = machineRow && (
    <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Scale size={14} className="text-stone-500" />
        <span className="font-semibold text-[13px] text-stone-700">Machine spillage</span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">counts as input</span>
      </div>
      <div className="max-w-[52%]">
        <label className={LBL}>Machine spillage (kg)</label>
        <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={machineRow.kg} disabled={locked}
          onChange={e => updateSpillage(machineRow.id, e.target.value)} placeholder="0" className={INP} />
        {isImplausibleWeight(n(machineRow.kg)) && (
          <p className="text-[11px] text-err">That's over 999kg — check for a typo.</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* The two jobs, side by side — tap one to work that section. Each is in
          its own bold colour (blue = Debagging/in, amber = Bagging/out). */}
      <div className="grid grid-cols-2 gap-2.5">
        {([
          { id: 'debag', label: 'Debagging', dir: 'in',  Icon: Package,      count: debagCount, kg: totalIn,  color: '#1d4ed8' },
          { id: 'bag',   label: 'Bagging',   dir: 'out', Icon: PackageCheck,  count: bagCount,   kg: totalOut, color: '#d97706' },
        ] as const).map(t => {
          const on = tab === t.id
          // Two bold, distinct colours — blue for "in", amber for "out" — so the
          // operator can tell at a glance which job they're on. The active one
          // fills with its colour; the other stays quiet.
          return (
            <button key={t.id} onClick={() => goToTab(t.id)}
              style={on ? { background: t.color, borderColor: t.color } : { borderColor: t.color + '55' }}
              className={`flex flex-col gap-1.5 p-3.5 rounded-2xl border-2 text-left transition-all ${on ? 'shadow-sm text-white' : 'bg-white'}`}>
              <div className="flex items-center gap-1.5">
                <t.Icon size={18} className={on ? 'text-white' : ''} style={on ? undefined : { color: t.color }} />
                <span className="font-bold text-[15px]" style={on ? undefined : { color: t.color }}>{t.label}</span>
                <span className={`text-[11px] ${on ? 'text-white/70' : 'text-stone-400'}`}>({t.dir})</span>
              </div>
              <div className={`text-[12px] ${on ? 'text-white/90' : 'text-stone-500'}`}>
                <span className={`font-mono font-bold text-[15px] ${on ? 'text-white' : 'text-text'}`}>{t.count}</span> bag{t.count !== 1 ? 's' : ''}
                <span className={`mx-1.5 ${on ? 'text-white/40' : 'text-stone-300'}`}>·</span>
                <span className="font-mono">{t.kg.toFixed(1)} kg</span>
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-[12px] text-stone-500 px-1 -mt-1">
        {tab === 'debag'
          ? 'What goes into the machine — weigh in each bulk bag.'
          : 'What comes out — every bag prints a barcode label.'}
      </p>

      {tab === 'debag' && (
        <>
          {/* Start-of-day bucket elevator (input) lives here on the MORNING shift.
              On the afternoon shift the elevator is an end-of-day output and moves
              to the Bagging tab. Machine spillage is an input loss on both shifts. */}
          {shift === 'morning' && bucketCard}
          {machineCard}

          <div className="space-y-3">
            {value.debag.map((r, i) => {
              // Secured bulk bags collapse to a read-only summary so the operator
              // can't accidentally change a finished bag — Edit re-opens it.
              if (r.secured) {
                return (
                  <div key={r.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border" style={{ background: DEBAG_BLUE + '0d', borderColor: DEBAG_BLUE + '40' }}>
                    <Lock size={15} className="shrink-0" style={{ color: DEBAG_BLUE }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text">Bulk bag {i + 1} · {n(r.nett).toFixed(1)} kg</div>
                      <div className="font-mono text-[11px] text-text-muted truncate">{[r.bag_no, r.lot, r.grade].filter(Boolean).join(' · ')}{r.logged_at ? ` · logged ${fmtTime(r.logged_at)}` : ''}</div>
                    </div>
                    {!locked && (
                      <button onClick={() => setDebagSecured(r.id, false)}
                        className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg">
                        <Pencil size={13} /> Edit
                      </button>
                    )}
                  </div>
                )
              }
              return (
                <div key={r.id} className="bg-white border rounded-2xl p-4 space-y-3" style={{ borderColor: DEBAG_BLUE + '40' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[13px]" style={{ color: DEBAG_BLUE }}>Bulk bag {i + 1}</span>
                    {!locked && <button onClick={() => removeDebag(r.id)} className="text-stone-300 hover:text-err p-1"><Trash2 size={15} /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><label className={LBL}>Bag no.</label>
                      <BatchKeypadField value={r.bag_no} disabled={locked} onChange={v => updateDebag(r.id, 'bag_no', v)} className={INP} label="Bag no." /></div>
                    <div className="space-y-1"><label className={LBL}>Lot / serial</label>
                      <BatchKeypadField value={r.lot} disabled={locked} onChange={v => updateDebag(r.id, 'lot', v)} options={batchOptions} className={INP} label="Lot / serial" placeholder="Tap to enter" />
                      {r.lot.trim() && !isValidLot(r.lot) && (
                        <p className="text-[11px] text-err">Expected at least one dash separating letters/numbers (e.g. GS-0299 or GS26-MIX-A).</p>
                      )}</div>
                    <div className="space-y-1"><label className={LBL}>Nett (kg)</label>
                      <input type="text" inputMode="decimal" pattern="[0-9.,]*" value={r.nett} disabled={locked} onChange={e => updateDebag(r.id, 'nett', e.target.value)} className={INP} />
                      {isImplausibleWeight(n(r.nett)) && (
                        <p className="text-[11px] text-err">That's over 999kg for one bulk bag — check for a typo.</p>
                      )}</div>
                    <div className="space-y-1"><label className={LBL}>Grade</label>
                      <select value={r.grade} disabled={locked} onChange={e => updateDebag(r.id, 'grade', e.target.value)} className={INP + ' cursor-pointer'}>
                        <option>Export</option><option>Export Blend</option><option>Domestic/Local</option>
                      </select></div>
                  </div>
                  {!locked && (() => {
                    const missing = [!r.bag_no.trim() && 'bag no.', !r.lot.trim() && 'lot', r.lot.trim() && !isValidLot(r.lot) && 'a valid lot format', n(r.nett) <= 0 && 'weight'].filter(Boolean).join(', ')
                    return (
                      <>
                        <button onClick={() => setDebagSecured(r.id, true)} disabled={!debagComplete(r)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] disabled:opacity-40 hover:bg-ok/20 transition-colors">
                          <Check size={15} /> Done — lock this bag
                        </button>
                        {missing && <p className="text-[11px] text-stone-400 text-center">All fields required — still need {missing}.</p>}
                      </>
                    )
                  })()}
                </div>
              )
            })}
            {!locked && (
              <button onClick={addDebag} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors">
                <Plus size={16} /> Add bulk bag
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total raw material in</span>
            <span className="font-mono font-bold text-[16px]">{totalIn.toFixed(1)} kg</span>
          </div>
        </>
      )}

      {tab === 'bag' && (
        <>
          {serialNotice && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-900">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{serialNotice}</span>
              <button type="button" onClick={() => setSerialNotice(null)}
                className="shrink-0 text-amber-700 underline">Dismiss</button>
            </div>
          )}
          {value.outputs.length > 0 && (() => {
            const groups = sortOutputGroups(Array.from(new Set(value.outputs.map(b => b.productType))))
            return groups.map((productType, gi) => {
              const bags = value.outputs.filter(b => b.productType === productType)
              const groupKg = bags.reduce((s, b) => {
                const bagTopUpKg = (b.serial ? productionTopUpsBySerial.get(b.serial) : undefined)?.reduce((ts, t) => ts + t.kg, 0) ?? 0
                return s + n(b.weight) + bagTopUpKg
              }, 0)
              const col = groupColor(gi)
              return (
                <div key={productType} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[12px] font-bold flex items-center gap-1.5" style={{ color: col }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                      {productType}
                    </span>
                    <span className="text-[11px] font-mono text-stone-500">{groupKg.toFixed(1)} kg · {bags.length} bag{bags.length === 1 ? '' : 's'}</span>
                  </div>
                  {bags.map((b, i) => {
                    const bagTopUps = b.serial ? productionTopUpsBySerial.get(b.serial) : undefined
                    const bagTopUpKg = (bagTopUps ?? []).reduce((s, t) => s + t.kg, 0)
                    return (
                    <div key={b.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border"
                      style={{ background: col + '0d', borderColor: col + '40' }}>
                      {b.secured && <Lock size={14} className="shrink-0" style={{ color: col }} />}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text">
                          Bag {i + 1} · {(n(b.weight) + bagTopUpKg).toFixed(1)} kg
                          {bagTopUpKg > 0 && <span className="ml-1 font-semibold text-violet-600">(+{bagTopUpKg.toFixed(1)} top-up)</span>}
                          {b.logged_at ? <span className="font-normal text-text-muted"> · {fmtTime(b.logged_at)}</span> : null}
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-2 font-mono text-[13px] font-bold text-text bg-stone-100 border border-stone-200 rounded-lg px-2.5 py-1">
                            {b.serial}{b.code ? <span className="text-[10px] font-sans font-normal text-stone-400"> · {b.code}</span> : null}
                          </span>
                          {/* Fine/Coarse Leaf carry a batch number — its identity
                              is what other lines (Refining) trace back to, so it
                              has to be visible here, not just captured. */}
                          {b.batch && (
                            <span className="font-mono text-[11px] text-stone-500">{b.batch}</span>
                          )}
                          {b.tagMethod && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                              {b.tagMethod === 'printed' ? <Printer size={11} /> : <PenLine size={11} />} {b.tagMethod}
                            </span>
                          )}
                        </div>
                        {!b.tagMethod && !locked && (
                          <div className="flex gap-1.5 mt-1.5">
                            <button onClick={() => setOutputTagMethod(b.id, 'printed')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand">
                              <Printer size={12} /> Print label
                            </button>
                            <button onClick={() => setOutputTagMethod(b.id, 'handwritten')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:border-brand hover:text-brand">
                              <PenLine size={12} /> Write on tag
                            </button>
                          </div>
                        )}
                      </div>
                      {b.tagMethod === 'printed' && (
                        <button onClick={() => reprint(b)} className="text-stone-400 hover:text-brand p-1.5" title="Reprint label"><Printer size={15} /></button>
                      )}
                      {!locked && (b.secured
                        ? <button onClick={() => setOutputSecured(b.id, false)} className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-brand px-2 py-1 rounded-lg"><Pencil size={13} /> Unlock</button>
                        : <>
                            <button onClick={() => setOutputSecured(b.id, true)} className="flex items-center gap-1.5 text-[12px] text-ok hover:bg-ok/10 px-2 py-1 rounded-lg"><Check size={13} /> Secure</button>
                            <button onClick={() => removeOutput(b)} className="text-stone-300 hover:text-err p-1.5"><Trash2 size={15} /></button>
                          </>
                      )}
                    </div>
                    )
                  })}
                </div>
              )
            })
          })()}

          {nudge && !picking && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-ok/5 border border-ok/20 rounded-xl text-[12px] text-ok">
              <Sparkles size={14} /> {nudge}
            </div>
          )}

          {!locked && (picking
            ? <OutputPicker sectionId="sieving" variantWord={variantWord} gradeLetter={gradeLetter}
                // Output batches must come from what was actually debagged — either
                // this run, or an earlier session of the exact same variant + grade
                // — so a typo on an output can't introduce a batch that was never
                // fed in under what's currently being consumed.
                defaultBatch={[...value.debag].reverse().find(r => r.lot.trim())?.lot.trim() ?? ''}
                batchHints={Array.from(new Set([
                  ...value.debag.map(r => r.lot.trim()).filter(Boolean),
                  ...matchingBatches,
                ]))}
                onAdd={addOutput} onClose={() => setPicking(false)} />
            : <button onClick={() => setPicking(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 font-medium text-[13px] hover:border-brand hover:text-brand transition-colors">
                <Plus size={16} /> Add output bag
              </button>
          )}

          {/* End-of-day bucket elevator (output) is captured here on the AFTERNOON
              shift — what's left in the tower to be consumed the next day. */}
          {shift === 'afternoon' && bucketCard}

          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white rounded-2xl">
            <span className="text-[12px] font-medium opacity-80">Total bagged out</span>
            <span className="font-mono font-bold text-[16px]">{totalOut.toFixed(1)} kg</span>
          </div>
        </>
      )}
    </div>
  )
}

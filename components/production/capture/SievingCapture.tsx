'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Printer, PenLine, Package, PackageCheck, Scale, Sparkles, Lock, Pencil, Check } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { printLabelAuto } from '@/lib/production/label-print'
import { variantToShort, isImplausibleWeight, GRADE_TO_LOCAL_EXPORT } from '@/lib/production/capture-config'
import { nextStepNudge, recentBatches, debaggedBatches } from '@/lib/production/inventory'
import { OutputPicker, type PickedOutput } from '@/components/production/capture/OutputPicker'
import { BatchKeypadField } from '@/components/production/capture/BatchKeypadField'
import type { OutputBag, Variant as ShortVariant } from '@/lib/production/live-types'
import type { ShiftAssignment } from '@/lib/supabase/database.types'
import { logBucketElevator, outstandingBucketElevator, variantFamily } from '@/lib/production/bucket-elevator'

// ── Sieving output serial ─────────────────────────────────────────────────────
// Format: ST{TYPE}-DDMMYY-NNN  (e.g. Fine Leaf → STFL-120826-003).
// A 2-letter output-type code plus a per-type daily sequence, so the number of
// bags of each output type is readable straight off the serial and its barcode
// (the barcode encodes serial_number verbatim). Each type counts independently.
const SIEVING_TYPE_ABBR: Array<[RegExp, string]> = [
  [/fine leaf/i,               'FL'],
  [/coarse leaf/i,             'CL'],
  [/rolsiev|rol siev/i,        'RS'],
  [/indent stick/i,            'IS'],
  [/rb block|\bblock/i,        'RB'],
  [/brown dust/i,              'BD'],
  [/powder dust/i,             'PD'],
  [/white dust/i,              'WD'],
  [/bucket elevator|spillage/i,'BE'],
]
function sievingAbbr(productType: string): string {
  for (const [re, code] of SIEVING_TYPE_ABBR) if (re.test(productType || '')) return code
  // Unknown/one-off product: first two letters of its name, so it's still a
  // stable per-type stem rather than colliding with everything else.
  const letters = (productType || '').replace(/[^A-Za-z]/g, '').toUpperCase()
  return letters.slice(0, 2) || 'XX'
}
// date is the session's own dateParam (YYYY-MM-DD), NOT wall-clock "now" — the
// afternoon/night shift runs past midnight, and using the device's live date
// would roll the daily stem over to tomorrow mid-shift, resetting the sequence
// even though it's the same continuous production run (07h00-01h00).
async function nextSievingSerial(productType: string, localSerials: string[], date: string): Promise<string> {
  const dp = date.split('-')
  const ddmmyy = dp.length === 3 ? `${dp[2]}${dp[1]}${dp[0].slice(2)}` : '000000'
  const prefix = `ST${sievingAbbr(productType)}-${ddmmyy}-`
  const seqOf = (s: string) => { const m = String(s).match(/-(\d{1,4})$/); return m ? parseInt(m[1]) : 0 }
  // Seed the per-type sequence from bags already tagged under this exact prefix
  // (this session's local bags + anything persisted for the same type + day).
  let maxSeq = localSerials.filter(s => s.startsWith(prefix)).reduce((mx, s) => Math.max(mx, seqOf(s)), 0)
  try {
    const { data } = await getDb().schema('production').from('bag_tags')
      .select('serial_number').ilike('serial_number', `${prefix}%`).limit(4000)
    ;(data ?? []).forEach((r: any) => { maxSeq = Math.max(maxSeq, seqOf(r.serial_number)) })
  } catch { /* offline — fall back to local max */ }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

export interface SpillageRow { id: string; kg: string }
export interface DebagRow {
  id: string; bag_no: string; lot: string; gross: string; nett: string
  delivery_date: string; local_export: string; secured?: boolean; logged_at?: string
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

// Operators on SA devices type the decimal as a COMMA (1200,5). Normalise comma
// → period so it always parses and is stored in the DB as a proper decimal.
const n = (v: string) => parseFloat(String(v).replace(',', '.')) || 0
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
const OUTPUT_GROUP_ORDER = ['Fine Leaf', 'Coarse Leaf', 'Indent Sticks', 'Rolsiev Sticks', 'RB Blocks']
function sortOutputGroups(types: string[]): string[] {
  return [...types].sort((a, b) => {
    const ia = OUTPUT_GROUP_ORDER.indexOf(a), ib = OUTPUT_GROUP_ORDER.indexOf(b)
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
export function sievingTotals(d: SievingData, shift?: Shift) {
  const debagIn   = (d.debag ?? []).reduce((s, r) => s + n(r.nett), 0)
  const bucketKg  = n(d.spillage?.[0]?.kg)                                   // bucket elevator carryover
  const machineKg = (d.spillage ?? []).slice(1).reduce((s, r) => s + n(r.kg), 0)  // machine spillage
  const outputs   = (d.outputs ?? []).reduce((s, b) => s + n(b.weight), 0)
  const bucketIsOutput = shift === 'afternoon'
  const totalIn  = debagIn + machineKg + (bucketIsOutput ? 0 : bucketKg)
  const totalOut = outputs + (bucketIsOutput ? bucketKg : 0)
  return { totalIn, totalOut, spillage: bucketKg + machineKg, bucketKg, machineKg, bucketIsOutput }
}

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'

export function SievingCapture({
  assignment, variantWord, gradeLetter = 'A', shift = 'morning', locked, value, onChange, genSerial, operatorId, date,
  sectionId = 'sieving', sessionId,
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
  date: string   // session's dateParam (YYYY-MM-DD) — see nextSievingSerial
  sectionId?: string
  sessionId?: string | null
}) {
  const [tab, setTab]       = useState<'debag' | 'bag'>('debag')
  const [picking, setPicking] = useState(false)
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

  // Self-heal outputs from bag_tags. Every output bag's bag_tags row is
  // written atomically the instant it's added (see addOutput below) — a
  // completely separate write path from this session's own draft_data,
  // which is only debounce-saved. If that save gets disrupted mid-shift (a
  // deploy restart landing while the tab is open, a dropped connection, a
  // stale second tab's autosave clobbering a newer one) bag_tags stays
  // correct while `outputs` can silently fall behind, showing the operator
  // fewer bags than actually exist even though nothing was lost. On load,
  // pull back in any bag_tags row for this exact session that `outputs`
  // doesn't have — the ledger is always the source of truth. Never removes
  // anything outputs already has, and never writes to bag_tags/scan_events
  // itself — purely a read-and-backfill of the local display.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    ;(async () => {
      const { data } = await getDb().schema('production').from('bag_tags')
        .select('serial_number, product_type, acumatica_id, lot_number, weight_kg, destination, printed_at')
        .eq('section_id', 'sieving').eq('session_id', sessionId).neq('status', 'voided')
      if (cancelled || !data) return
      const known = new Set(value.outputs.map(o => o.serial))
      const missing = (data as any[]).filter(t => !known.has(t.serial_number))
      if (!missing.length) return
      const restored: OutBag[] = missing.map(t => ({
        id: crypto.randomUUID(), serial: t.serial_number, productType: t.product_type,
        code: t.acumatica_id ?? null, weight: String(t.weight_kg ?? ''), batch: t.lot_number ?? '',
        // A bag_tags row from before the grade column was populated for this
        // batch falls back to the batch's own current grade — the same
        // fallback addOutput() itself uses when creating one fresh.
        destination: t.destination ?? gradeLetter, printed: !!t.printed_at,
        tagMethod: t.printed_at ? 'printed' : null, secured: true,
        logged_at: t.printed_at ?? new Date().toISOString(),
      }))
      patch({ outputs: [...value.outputs, ...restored] })
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
    gross: '', nett: '', delivery_date: '', local_export: GRADE_TO_LOCAL_EXPORT[gradeLetter] ?? 'Export',
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
    const shouldLog = !value.bucketLedgerLogged && kg > 0
    if (shouldLog) {
      logBucketElevator(bucketIsOutput ? 'generated' : 'consumed',
        { sectionId, variantFamily: family, kg, date, shift, sessionId })
    }
    return { bucketSecured: true, ...(shouldLog ? { bucketLedgerLogged: true } : {}) }
  }

  // ── Bagging — picker → serial → tag → label ──────────────────────────────
  async function addOutput(p: PickedOutput) {
    const serial = await nextSievingSerial(p.productType, value.outputs.map(o => o.serial), date)
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

  function setOutputTagMethod(id: string, method: 'printed' | 'handwritten') {
    patch({ outputs: value.outputs.map(b => b.id === id ? { ...b, tagMethod: method, printed: method === 'printed' } : b) })
    const b = value.outputs.find(x => x.id === id)
    if (!b) return
    getDb().schema('production').from('bag_tags').update({ tag_method: method } as any)
      .eq('serial_number', b.serial).then(() => {})
    if (method === 'printed') reprint(b)
  }

  const { totalIn, totalOut } = sievingTotals(value, shift)
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
                      <div className="font-mono text-[11px] text-text-muted truncate">{[r.bag_no, r.lot, r.local_export].filter(Boolean).join(' · ')}{r.logged_at ? ` · logged ${fmtTime(r.logged_at)}` : ''}</div>
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
                    <div className="space-y-1"><label className={LBL}>Local / export</label>
                      <select value={r.local_export} disabled={locked} onChange={e => updateDebag(r.id, 'local_export', e.target.value)} className={INP + ' cursor-pointer'}>
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
          {value.outputs.length > 0 && (() => {
            const groups = sortOutputGroups(Array.from(new Set(value.outputs.map(b => b.productType))))
            return groups.map((productType, gi) => {
              const bags = value.outputs.filter(b => b.productType === productType)
              const groupKg = bags.reduce((s, b) => s + n(b.weight), 0)
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
                  {bags.map((b, i) => (
                    <div key={b.id} className="flex items-center gap-3 rounded-2xl px-4 py-3 border"
                      style={{ background: col + '0d', borderColor: col + '40' }}>
                      {b.secured && <Lock size={14} className="shrink-0" style={{ color: col }} />}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text">Bag {i + 1} · {b.weight} kg{b.logged_at ? <span className="font-normal text-text-muted"> · {fmtTime(b.logged_at)}</span> : null}</div>
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
                            <button onClick={() => patch({ outputs: value.outputs.filter(x => x.id !== b.id) })} className="text-stone-300 hover:text-err p-1.5"><Trash2 size={15} /></button>
                          </>
                      )}
                    </div>
                  ))}
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

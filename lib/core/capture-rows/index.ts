/**
 * The prod_debagging / prod_bagging row builders.
 *
 * Moved VERBATIM out of `app/(app)/production/capture/[section]/page.tsx`,
 * where they were two closures inside a 2,900-line React component and
 * therefore impossible to test. They are what `persist()` writes: every input
 * and output row for every section, for every save the floor makes.
 *
 * ── What changed in the move, and what did not ──────────────────────────────
 *
 * The bodies are unchanged, line for line. Only the two values they used to
 * read off the component's closure are now arguments:
 *
 *     kind        was `const kind = sectionKindFor(sectionId)`
 *     workCentre  was `meta.name`, stamped onto every output row
 *
 * That is the whole diff. `capture-rows.test.ts` pins the current output for
 * all five sections so an extraction cannot silently change what a capture
 * screen writes — if those tests fail, the refactor changed behaviour, which is
 * the signal, not a test to relax (ARCHITECTURE.md §8).
 *
 * ── Deliberately NOT changed ────────────────────────────────────────────────
 *
 * `rows: any[]`. These are PostgREST payloads for two tables whose columns
 * differ per section (`kg_nett` vs `kg`, `output_group` only on bagging,
 * `is_spillage` only on debagging). Typing them properly means typing those two
 * tables, which is worth doing and is not this change — doing it here would
 * make a verbatim move into a rewrite, and the point of a verbatim move is that
 * the tests either side prove nothing moved.
 *
 * ── Two seams left open ─────────────────────────────────────────────────────
 *
 * 1. `dustProductType` arrives through the context rather than being imported.
 *    It lives in GranuleCapture.tsx, a `'use client'` React module, and core
 *    importing that would pull React into a pure module at runtime. DUST_META
 *    belongs in core alongside product-names.ts; until it moves, this is the
 *    seam.
 * 2. The five section data types are still `import type` from their component
 *    files. Type-only, so nothing is pulled in at runtime — but Phase 2 was
 *    supposed to move all five into `lib/core/types/capture.ts` and only moved
 *    SectionKind and assertNever. That is the remaining Phase 2 work.
 */
import { n } from '@/lib/core/num'
import { variantForDb } from '@/lib/core/variants'
import { assertNever, type SectionKind } from '@/lib/core/types/capture'

import type { SievingData } from '@/components/production/capture/SievingCapture'
import type { RefiningData } from '@/components/production/capture/RefiningCapture'
import type { GranuleData } from '@/components/production/capture/GranuleCapture'
import type { BlenderData } from '@/components/production/capture/BlenderCapture'
import type { PasteuriserData } from '@/components/production/capture/PasteuriserCapture'

/** One batch record on a capture screen. Mirrors the page's own `Production`. */
export interface CaptureProduction {
  id:      string
  variant: string
  grade:   string
  lot:     string
  data:    SievingData | RefiningData | GranuleData | BlenderData | PasteuriserData
}

export interface RowBuildContext {
  /** The section kind. Was `sectionKindFor(sectionId)` on the component. */
  kind: SectionKind
  /**
   * Work centre name — "Sieving Tower", "Refining 1", … Stamped on every output
   * row so prod_bagging carries the producing line without joining back through
   * prod_sessions.section_id. Was `meta.name` on the component.
   */
  workCentre: string
  /** Dust key → product type. See seam 1 in the header. */
  dustProductType: (key: string) => string
}

/** Input rows for `production.prod_debagging`. */
export function buildDebagRows(
  prods: CaptureProduction[],
  sid: string,
  ctx: RowBuildContext,
) {
  const { kind, dustProductType } = ctx
  const rows: any[] = []
  let bagNo = 1
  prods.forEach(prod => {
    if (kind === 'refining') {
      const rd = prod.data as RefiningData
      ;(rd.inputs ?? []).forEach(r => {
        if (n(r.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++,
          // bag_serial_no is a FK to bag_tags — only set for scan/system bags
          // guaranteed to exist there. Manual serials go in notes to avoid FK failure.
          bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
          notes: r.inputMode === 'manual' ? r.serial || null : null,
          lot_number: r.lot || prod.lot || null,
          product_type: r.productType || null, variant: variantForDb(r.variant || prod.variant),
          kg_nett: n(r.weight),
          delivery_date: r.deliveryDate || null, is_spillage: false,
        })
      })
    } else if (kind === 'granule') {
      const gd = prod.data as GranuleData
      ;(gd.blends ?? []).forEach(bl => {
        (bl.rows ?? []).forEach(r => {
          if (n(r.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++,
            // bag_serial_no is a FK to bag_tags — only set for scan/system bags.
            // Manual serials go in notes to avoid an FK failure.
            bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
            notes: [`blend ${bl.blendNo}`, r.inputMode === 'manual' ? r.serial : null].filter(Boolean).join(' · ') || null,
            lot_number: r.lot || prod.lot || null,
            product_type: dustProductType(r.dustKey), variant: variantForDb(r.variant || prod.variant),
            kg_nett: n(r.weight), is_spillage: false,
          })
        })
      })
    } else if (kind === 'blender') {
      const bd = prod.data as BlenderData
      ;(bd.inputs ?? []).forEach(r => {
        if (n(r.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++,
          bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
          grade: r.destination || null,
          notes: r.inputMode === 'manual' ? r.serial : null,
          lot_number: r.lot || prod.lot || null,
          product_type: r.productType || null, variant: variantForDb(r.variant || prod.variant),
          kg_nett: n(r.weight), is_spillage: false,
        })
      })
    } else if (kind === 'pasteuriser') {
      const pd = prod.data as PasteuriserData
      ;(pd.debag ?? []).forEach(r => {
        if (n(r.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++,
          // bag_serial_no is a FK to bag_tags — only set for scan/system bags
          // guaranteed to be there; a manual serial goes in notes to avoid an FK failure.
          bag_serial_no: r.inputMode !== 'manual' ? r.serial || null : null,
          notes: [r.stream === 'postsieve' ? 'post-sieve' : null, r.inputMode === 'manual' ? r.serial : null].filter(Boolean).join(' · ') || null,
          lot_number: r.lot || pd.batchNo || prod.lot || null,
          product_type: r.productType || null, variant: variantForDb(r.variant || prod.variant),
          kg_nett: n(r.weight), is_spillage: false,
        })
      })
    } else if (kind === 'sieving') {
      const sd = prod.data as SievingData
      // spillage[0] is the bucket-elevator carry-over; spillage[1..] are
      // machine spillage — they're different inputs and must read as their
      // own type on the production order, not both as "Bucket Elevator".
      sd.spillage.forEach((r, idx) => {
        if (n(r.kg) === 0) return
        rows.push({ session_id: sid, bag_no: bagNo++, product_type: idx === 0 ? 'Bucket Elevator' : 'Machine Spillage', variant: variantForDb(prod.variant), kg_nett: n(r.kg), is_spillage: true })
      })
      sd.debag.forEach(r => {
        if (n(r.nett) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++,
          // bag_serial_no is a FK to bag_tags — farm bags aren't in bag_tags, so null it.
          // Preserve the operator's physical bag number in notes for traceability.
          bag_serial_no: null, notes: r.bag_no || null,
          lot_number: r.lot || prod.lot || null,
          // Was '500kg Farm Bag' — kept unchanged on historical rows (Acumatica
          // actually reads batch numbers + total weight, not this string, so the
          // rename is safe going forward without a backfill).
          product_type: 'Farm Bag', variant: variantForDb(prod.variant),
          kg_gross: n(r.gross) || null, kg_nett: n(r.nett),
          delivery_date: r.delivery_date || null, grade: r.grade || null,
          // Real capture instant, immune to persist()'s delete+reinsert restamping
          // created_at on every save — same pattern as output bags' bagging_time.
          bagging_time: r.logged_at || null,
          is_spillage: false,
        })
      })
    } else { assertNever(kind, 'section kind') }
  })
  return rows
}

/** Output rows for `production.prod_bagging`. */
export function buildBagRows(
  prods: CaptureProduction[],
  sid: string,
  ctx: RowBuildContext,
) {
  const { kind, workCentre } = ctx
  const rows: any[] = []
  let bagNo = 1
  prods.forEach(prod => {
    if (kind === 'refining') {
      const rd = prod.data as RefiningData
      const groups: Array<[string, typeof rd.outputB]> = [['A', rd.outputA], ['B', rd.outputB], ['C', rd.outputC], ['D', rd.outputD]]
      groups.forEach(([grp, g]) => {
        ;(g?.bags ?? []).forEach(b => {
          if (n(b.weight) === 0) return
          rows.push({
            session_id: sid, bag_no: bagNo++, output_group: grp,
            bag_serial_no: b.serial, lot_number: prod.lot || null,
            product_type: b.productType, acumatica_id: b.code || null,
            variant: variantForDb(prod.variant),
            kg: n(b.weight),
            // The exact moment this bag was added on the Refining (sieving
            // tower) screen — set client-side as RefiningOutputBag.logged_at
            // when the operator adds it. Carried through so downstream
            // consumers (Quality's Final QC picker) show the true bagging
            // time instead of when the whole session was last saved — every
            // other output section already does this via its own b.time.
            bagging_time: b.logged_at || null,
          })
        })
      })
    } else if (kind === 'granule') {
      const gd = prod.data as GranuleData
      ;(gd.outputs ?? []).forEach(b => {
        if (n(b.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++, output_group: null,
          bag_serial_no: b.serial, lot_number: b.lot || prod.lot || null,
          product_type: b.item, acumatica_id: b.code || null, variant: variantForDb(prod.variant),
          kg: n(b.weight), bagging_time: b.logged_at || null,
        })
      })
      ;(gd.dustOutputs ?? []).forEach(r => {
        if (n(r.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++, output_group: null,
          bag_serial_no: r.serial, lot_number: prod.lot || null,
          product_type: r.dustType, acumatica_id: r.code || null, variant: variantForDb(prod.variant),
          kg: n(r.weight),
        })
      })
    } else if (kind === 'blender') {
      const bd = prod.data as BlenderData
      const bomId = bd.bomId
      ;(bd.outputs ?? []).forEach(b => {
        if (n(b.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++, output_group: null,
          bag_serial_no: b.serial, lot_number: prod.lot || null,
          product_type: bomId ? `Blend ${bomId}` : null, acumatica_id: bomId || null, variant: variantForDb(prod.variant),
          kg: n(b.weight), bagging_time: b.logged_at || null,
        })
      })
    } else if (kind === 'pasteuriser') {
      const pd = prod.data as PasteuriserData
      const perBag = n(pd.weightPerBag) || 0
      // Final-product pallet lines (A): one bagging row per line, kg = bags × kg/bag.
      ;(pd.outputs ?? []).forEach(l => {
        const kg = n(l.bagCount) * (n(l.bagWeight) || perBag)
        if (kg === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++, output_group: null,
          bag_serial_no: l.serial, lot_number: l.lot || pd.batchNo || prod.lot || null,
          product_type: l.item || l.kind || null, acumatica_id: l.itemCode || null, variant: variantForDb(prod.variant),
          kg, bagging_time: l.logged_at || null,
        })
      })
      // By-products (B) — recorded as bagging rows so they count in the output total.
      ;(pd.byProducts ?? []).forEach(r => {
        if (n(r.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++, output_group: null,
          bag_serial_no: r.serial || null, lot_number: pd.batchNo || prod.lot || null,
          product_type: r.type || null, variant: variantForDb(prod.variant), kg: n(r.weight),
        })
      })
    } else if (kind === 'sieving') {
      const sd = prod.data as SievingData
      sd.outputs.forEach(b => {
        if (n(b.weight) === 0) return
        rows.push({
          session_id: sid, bag_no: bagNo++, output_group: 'B',
          bag_serial_no: b.serial, lot_number: b.batch || prod.lot || null, product_type: b.productType,
          acumatica_id: b.code || null, variant: variantForDb(prod.variant),
          kg: n(b.weight),
          bagging_time: b.logged_at || null,   // see bagging_time note above
        })
      })
    } else { assertNever(kind, 'section kind') }
  })
  // Stamp the work centre (Sieving Tower / Refining 1 / … / Pasteuriser) on
  // every output bag so prod_bagging carries the producing line directly,
  // without having to join back through prod_sessions.section_id.
  rows.forEach(r => { r.work_centre = workCentre })
  return rows
}

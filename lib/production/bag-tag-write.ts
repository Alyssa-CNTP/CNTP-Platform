/**
 * Registering a bag in the canonical per-bag record.
 *
 * `production.bag_tags` is the canonical record of a bag: what it is, what it
 * weighs, which lot it came from, where it is. `prod_bagging` is save-scratch
 * for a capture screen. A bag that reaches prod_bagging without a bag_tags row
 * exists on paper and nowhere else — it cannot be scanned at the next section,
 * cannot be found in Bag Tracking, and carries no QC record.
 *
 * That has bitten twice. The Blender wrote output bags with no tag for weeks,
 * and the Pasteuriser never wrote its output at all. Both are fixed the same
 * way, and this is the shared writer so the third section to need it does not
 * invent a third field list.
 *
 * ── Why the client is structural, and why the cast is here ─────────────────
 *
 * `lib/supabase/database.types.ts` is generated and does not carry the full
 * column set of `production.bag_tags` — the table has drifted ahead of it more
 * than once (`section_id` arrived that way). Callers therefore reached for
 * `as any` at each write site, which is the exact pattern ARCHITECTURE.md §1A
 * blames for the compiler being switched off where it would have caught
 * something.
 *
 * So the untyped edge lives HERE, once, behind a payload type that IS checked.
 * A caller passing a misspelled column now fails to compile, which is the
 * thing `as any` at the call site was giving away.
 */

/** The columns a capture screen legitimately sets when registering a bag. */
export interface BagTagWrite {
  serial_number: string
  section_id: string
  /** Always null from capture: the tag outlives the session that made it. */
  session_id?: string | null
  product_type: string
  variant?: string | null
  weight_kg?: number | null
  lot_number?: string | null
  /** The Acumatica inventory id where one is known. Never constructed. */
  acumatica_id?: string | null
  status?: 'in_stock' | 'consumed'
  consumed?: boolean
  consumed_at_section?: string | null
  printed_at?: string | null
  location_updated_at?: string | null
  is_open?: boolean
}

/** A bagging event on the append-only ledger. */
export interface ScanEventWrite {
  serial_number: string
  action: 'bagging_out' | 'bagging_in' | 'topped_up' | 'drawn_down' | 'stock_adjust'
  section_id: string
  weight_kg?: number | null
  operator_id?: string | null
}

/**
 * The narrowest shape of a Supabase client this module needs.
 *
 * Structural rather than imported so the same code serves the browser client
 * and the admin client, and so a test can pass a plain object without mocking
 * a module.
 */
export interface BagTagWritable {
  schema(name: 'production'): {
    from(table: string): {
      upsert(values: unknown, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>
      insert(values: unknown): PromiseLike<{ error: { message: string } | null }>
    }
  }
}

/**
 * Register (or correct) one bag.
 *
 * Upsert on `serial_number`, so editing a captured line follows through to the
 * canonical record instead of leaving bag_tags describing the first draft. It
 * is NOT delete-then-insert: that is the documented cause of 44% of Fine/Coarse
 * Leaf bags being lost (ARCHITECTURE.md §1B, §4).
 *
 * Returns an error message rather than throwing, because every caller has to
 * SHOW it — a silent failure here is the whole defect being fixed.
 */
export async function registerBagTag(
  db: BagTagWritable,
  tag: BagTagWrite,
): Promise<string | null> {
  try {
    const { error } = await db.schema('production').from('bag_tags')
      .upsert(tag, { onConflict: 'serial_number' })
    return error ? error.message : null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/**
 * Append a bagging event.
 *
 * Deliberately best-effort and deliberately separate from `registerBagTag`.
 * The ledger is the audit trail; the tag is the bag's identity. Losing an audit
 * row is a smaller problem than showing an operator a serial the system can
 * never find again, so a caller registers the tag, insists on it, and then
 * appends this without blocking on it.
 */
export async function appendScanEvent(
  db: BagTagWritable,
  event: ScanEventWrite,
): Promise<void> {
  try {
    await db.schema('production').from('scan_events').insert(event)
  } catch { /* see above — the bag itself is already saved */ }
}

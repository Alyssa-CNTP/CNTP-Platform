/**
 * lib/production/validate-scan.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Universal bag scan validator.
 * Called at every debagging input point in the production system.
 *
 * Implements the "Chinese factory barcode" principle:
 *   1. Existence check — bag must be registered in the system
 *   2. Consumption check — bag must not already be consumed
 *   3. Variant family check — CON/RA-CON cannot enter an ORG run (or vice versa)
 *   4. Product type check — optional allow-list of accepted types for this input
 *   5. Finished product block — blended products cannot be used as raw ingredients
 *
 * Usage:
 *   const result = await validateBagScan('20-05-01', {
 *     sessionVariant: 'CON',
 *     allowedTypes: ['Fine Leaf', 'Coarse Leaf'],
 *   })
 *   if (result.status !== 'ok') { showError(result.message); return }
 *   autofill(result.tag)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDb } from '@/lib/supabase/db'
import { normaliseVariant } from '@/lib/constants/manufacturing'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ScanStatus =
  | 'ok'               // all checks passed — safe to accept and auto-fill
  | 'not_found'        // serial not in bag_tags — unregistered bag
  | 'already_consumed' // bag already scanned in at another section
  | 'wrong_variant'    // variant family mismatch (CON vs ORG)
  | 'wrong_type'       // product type not in allow-list
  | 'finished_product' // blended/finished product blocked as ingredient

export interface ScanValidationResult {
  status:    ScanStatus
  message:   string
  /** Populated when status === 'ok' — the bag_tags row for auto-filling */
  tag?: {
    serial_number:       string
    product_type:        string
    lot_number:          string
    weight_kg:           number | null
    variant:             string | null
    section_id:          string
    section_name:        string
    acumatica_id:        string | null
    tag_date:            string | null
    consumed_at_section: string | null
  }
}

export interface ValidateScanOptions {
  /**
   * The variant code of the current session (CON/ORG/RA-CON/RA-ORG).
   * When set, variant family mismatches are blocked.
   */
  sessionVariant?: string | null

  /**
   * Optional allow-list of product types this input point accepts.
   * Case-insensitive substring match. If omitted, all types are accepted.
   * Example: ['Fine Leaf', 'Coarse Leaf', 'Indent Sticks']
   */
  allowedTypes?: string[]

  /**
   * Whether to block finished blended products (default: true).
   * A bag is considered a finished product if its product_type includes 'blend'.
   */
  blockFinishedProducts?: boolean
}

// ── Helper — variant family ────────────────────────────────────────────────────

function variantFamily(v: string | null | undefined): 'conventional' | 'organic' | null {
  if (!v) return null
  const n = normaliseVariant(v)
  if (n === 'Conventional' || n === 'RA-Conventional') return 'conventional'
  if (n === 'Organic'      || n === 'RA-Organic' || n === 'FT-ORG') return 'organic'
  return null
}

// ── Main validator ─────────────────────────────────────────────────────────────

/**
 * Validates a bag serial number before accepting it as a debagging input.
 *
 * @param serial - The serial number to validate (e.g. '20-05-01')
 * @param opts   - Validation options (variant, allowed types, etc.)
 * @returns      - `ScanValidationResult` with status, message, and tag data
 */
export async function validateBagScan(
  serial: string,
  opts: ValidateScanOptions = {}
): Promise<ScanValidationResult> {
  const {
    sessionVariant,
    allowedTypes,
    blockFinishedProducts = true,
  } = opts

  if (!serial || serial.trim() === '') {
    return { status: 'not_found', message: 'No serial number provided.' }
  }

  // ── Query bag_tags ───────────────────────────────────────────────────────────
  let tag: any
  try {
    const { data, error } = await getDb()
      .schema('production')
      .from('bag_tags')
      .select(`
        serial_number, product_type, lot_number, weight_kg, variant,
        section_id, section_name, acumatica_id, tag_date,
        consumed_at_section, consumed_at_session
      `)
      .eq('serial_number', serial.trim())
      .maybeSingle()

    if (error) throw error
    tag = data
  } catch (e) {
    return { status: 'not_found', message: `Database error looking up serial ${serial}. Try again.` }
  }

  // ── 1. Existence check ───────────────────────────────────────────────────────
  if (!tag) {
    return {
      status:  'not_found',
      message: `Serial "${serial}" not found in the system. Is this bag registered? Check the tag was printed and saved before scanning.`,
    }
  }

  // ── 2. Already consumed check ────────────────────────────────────────────────
  if (tag.consumed_at_section) {
    return {
      status:  'already_consumed',
      message: `Bag ${serial} (${tag.product_type}) was already consumed at ${tag.consumed_at_section}. This bag cannot be scanned in again.`,
    }
  }

  // ── 3. Finished product block ────────────────────────────────────────────────
  if (blockFinishedProducts && tag.product_type && /blend/i.test(tag.product_type)) {
    return {
      status:  'finished_product',
      message: `Finished product "${tag.product_type}" (${serial}) cannot be used as a raw material input. Scan a raw leaf or intermediate material bag.`,
    }
  }

  // ── 4. Variant family check ───────────────────────────────────────────────────
  if (sessionVariant && tag.variant) {
    const sessionFam = variantFamily(sessionVariant)
    const bagFam     = variantFamily(tag.variant)
    if (sessionFam && bagFam && sessionFam !== bagFam) {
      return {
        status:  'wrong_variant',
        message: `⛔ Variant mismatch — this session is ${sessionVariant} (${sessionFam}) but bag ${serial} is ${tag.variant} (${bagFam}). CON/RA-CON and ORG/RA-ORG cannot be mixed. Scan the correct bag.`,
      }
    }
  }

  // ── 5. Product type allow-list ────────────────────────────────────────────────
  if (allowedTypes && allowedTypes.length > 0 && tag.product_type) {
    const normalised = tag.product_type.toLowerCase()
    const accepted   = allowedTypes.some(t => normalised.includes(t.toLowerCase()))
    if (!accepted) {
      return {
        status:  'wrong_type',
        message: `Wrong product type — scanned "${tag.product_type}" (${serial}) but this input expects: ${allowedTypes.join(', ')}. Clear and scan the correct bag.`,
      }
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────────────
  return {
    status: 'ok',
    message: `✓ ${tag.product_type} · ${tag.variant || 'Unknown variant'} · ${tag.weight_kg ? `${tag.weight_kg} kg` : 'weight unknown'}`,
    tag: {
      serial_number:       tag.serial_number,
      product_type:        tag.product_type        || '',
      lot_number:          tag.lot_number           || 'NOT TRACKED',
      weight_kg:           tag.weight_kg            ?? null,
      variant:             tag.variant              ?? null,
      section_id:          tag.section_id           || '',
      section_name:        tag.section_name         || '',
      acumatica_id:        tag.acumatica_id         ?? null,
      tag_date:            tag.tag_date             ?? null,
      consumed_at_section: tag.consumed_at_section  ?? null,
    },
  }
}

'use client'
import { useEffect, useRef, useCallback } from 'react'
import * as React from 'react'
import { getDb } from '@/lib/supabase/db'

// ── sanitizeSerial — keystroke-level cleanup for every "scan or type serial"
// input across capture. Real serials in this app are digits/dashes (section
// outputs, DD-MM-NN) or a blend-code-prefixed digits/dash/slash string
// (Blender/Pasteuriser, e.g. SFC-KUN25-C/1-01) — never spaces. A stray space
// from a scanner double-fire or a fat-fingered tap breaks an exact-match
// bag_tags lookup silently (looks "not found" with no clue why), so it's
// stripped outright rather than just trimmed at the ends. Letters stay
// allowed (blend codes need them) but anything else typed by mistake — stray
// punctuation, control characters — is dropped too.
export function sanitizeSerial(v: string): string {
  return v.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9\-/]/g, '')
}

// ── variantFamily — maps a variant code/name to its blending family ──────────
// CON + RA-CON + FT-CON → 'conventional'  (can be blended together)
// ORG + RA-ORG + FT-ORG → 'organic'       (can be blended together)
// Families cannot be mixed in a single blend run.
//
// This was the most correct of the four copies, and is now the only one:
// lib/core/variants.ts. Note FT-CON, which this version omitted — it fell
// through to null, so a Fairtrade Conventional bag skipped the family check
// entirely instead of passing it.
export { variantFamily } from '@/lib/core/variants'

// ── useSerialLookup — fires bag_tags query when serial matches DD-MM-NN ───────
// Works with USB scanner (types fast) AND manual entry (debounced).
// The USB scanner types the full serial in <200ms then sends Enter.
// We detect the complete serial format and query after a short debounce.
export function useSerialLookup(
  serial: string,
  onFound: (result: { lot_number:string; weight_kg:string; product_type:string; variant:string; consumed_at_section:string|null }) => void
) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout>|null>(null)
  useEffect(() => {
    // Match DD-MM-NN format (20-05-01) or blended format (08-04-26/1-02)
    const isComplete = /^\d{2}-\d{2}-\d{2,3}$/.test(serial) ||
                       /^\d{2}-\d{2}-\d{2}\/\d+-\d+$/.test(serial)
    if (!isComplete) return
    // Debounce 150ms — handles both fast scanner and manual typing
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await getDb()
          .schema('production')
          .from('bag_tags')
          .select('lot_number, weight_kg, product_type, variant, consumed_at_section')
          .eq('serial_number', serial)
          .maybeSingle()
        if (data) {
          onFound({
            lot_number:          data.lot_number  || 'NOT TRACKED',
            weight_kg:           data.weight_kg   ? String(data.weight_kg) : '',
            product_type:        data.product_type || '',
            variant:             data.variant || '',
            consumed_at_section: (data as any).consumed_at_section || null,
          })
        }
      } catch(e) {
        // silent fail — operator can fill manually
      }
    }, 150)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])
}

// ── Standalone markBagConsumed — callable from any form component ─────────────
// Takes explicit sectionId and sessionId so it works outside SectionCaptureInner.
export async function markBagConsumed(
  serialNumber: string,
  sectionId: string,
  sessionId: string | null,
  weightKg?: number,
  operatorId?: string | null
): Promise<void> {
  if (!serialNumber || serialNumber === 'NOT TRACKED') return
  try {
    await getDb().schema('production').from('bag_tags').update({
      consumed_at_session:  sessionId || undefined,
      consumed_at_section:  sectionId,
      consumed_weight_kg:   weightKg ?? null,
      status:               'consumed',
      location_updated_at:  new Date().toISOString(),
    } as any).eq('serial_number', serialNumber)

    await getDb().schema('production').from('scan_events').insert({
      serial_number: serialNumber,
      section_id:    sectionId,
      session_id:    sessionId || null,
      action:        'debagging_in',
      weight_kg:     weightKg ?? null,
      operator_id:   operatorId ?? null,
      scanned_at:    new Date().toISOString(),
    } as any)
  } catch (e) {
    console.warn('markBagConsumed failed for', serialNumber, e)
  }
}

// ── Standalone voidBagTag — call when a bag is removed from a capture record ──
// Every "remove output bag" button only ever removed the bag from the local
// capture state (draft_data) — the bag_tags row, already written the moment
// the bag was added, stayed 'in_stock' forever, looking like real available
// inventory to Quality/Stock Control/Orders even though the record it came
// from says it doesn't exist. Never hard-delete: scan_events.serial_number
// has an ON DELETE CASCADE FK to bag_tags, so deleting the row would
// silently erase its whole audit trail too. Flips status to 'voided'
// instead — retained in the database, excluded from every status-filtered
// "active" query elsewhere without needing to touch those screens.
export async function voidBagTag(
  serialNumber: string,
  operatorId?: string | null,
): Promise<void> {
  if (!serialNumber) return
  try {
    const now = new Date().toISOString()
    await getDb().schema('production').from('bag_tags').update({
      status: 'voided', voided_at: now, voided_by: operatorId ?? null,
    } as any).eq('serial_number', serialNumber)

    await getDb().schema('production').from('scan_events').insert({
      serial_number: serialNumber, action: 'void',
      operator_id: operatorId ?? null, scanned_at: now,
    } as any)
  } catch (e) {
    console.warn('voidBagTag failed for', serialNumber, e)
  }
}

// ── Standalone transferBagWeight — move weight from a source bag into a ──────
// target bag (a "top-up"). Every top-up must name the bag the material
// physically came from — there's no such thing as loose weight added to an
// existing tagged bag with no traceable origin, so this always takes both
// serials and moves a bounded amount between them, instead of just bumping
// a number on one bag.
//
// The source bag's weight_kg drops by the amount drawn — voided instead of
// ever reaching zero (bag_tags.weight_kg has CHECK(weight_kg > 0), and a
// fully-drained bag no longer exists as its own physical unit anyway); a
// partially-drained source is left is_open so its remainder doesn't get
// forgotten on the floor. The target's weight_kg rises by the same amount.
//
// Both sides are logged as a linked pair in scan_events — 'topped_up' on
// the receiving bag, 'drawn_down' on the depleted one, each pointing at the
// other via related_serial_number. A top-up is therefore never new
// production (see the 20260818_004 migration): it's kg that was already
// counted on the day the source bag was first bagged, just moved between
// containers — production/reporting sums must keep counting 'bagging_out'
// only, never 'topped_up', or the same kg gets counted twice.
export async function transferBagWeight(
  sourceSerial: string,
  sourceCurrentWeight: number,
  targetSerial: string,
  targetCurrentWeight: number,
  amountKg: number,
  sectionId: string,
  sessionId: string | null,
  operatorId?: string | null,
  closeTargetBag = false,
  // Set only when the caller has confirmed the source's product doesn't
  // match the target's — actually reclassifies the target row so the bag's
  // own record reflects what it now physically contains. Left undefined for
  // a same-product top-up, which never touches product_type.
  reclassifyProductType?: string,
): Promise<void> {
  if (!sourceSerial || !targetSerial || sourceSerial === targetSerial) return
  if (!(amountKg > 0) || amountKg > sourceCurrentWeight) return
  const now = new Date().toISOString()

  const remaining = sourceCurrentWeight - amountKg
  if (remaining <= 0) {
    await getDb().schema('production').from('bag_tags').update({
      status: 'voided', voided_at: now, voided_by: operatorId ?? null,
    } as any).eq('serial_number', sourceSerial)
  } else {
    await getDb().schema('production').from('bag_tags').update({
      weight_kg: remaining, is_open: true,
    } as any).eq('serial_number', sourceSerial)
  }

  const targetUpdate: Record<string, unknown> = { weight_kg: targetCurrentWeight + amountKg }
  if (closeTargetBag) targetUpdate.is_open = false
  if (reclassifyProductType) targetUpdate.product_type = reclassifyProductType
  await getDb().schema('production').from('bag_tags').update(targetUpdate as any).eq('serial_number', targetSerial)

  await getDb().schema('production').from('scan_events').insert([
    {
      serial_number: targetSerial, related_serial_number: sourceSerial,
      section_id: sectionId, session_id: sessionId || null,
      action: 'topped_up', weight_kg: amountKg,
      operator_id: operatorId ?? null, scanned_at: now,
    },
    {
      serial_number: sourceSerial, related_serial_number: targetSerial,
      section_id: sectionId, session_id: sessionId || null,
      action: 'drawn_down', weight_kg: amountKg,
      operator_id: operatorId ?? null, scanned_at: now,
    },
  ] as any)
}

// ── Standalone createBagFromTransfer — a re-bag whose target is a BRAND ─────
// NEW bag, not an existing one (the "create new bag" path of the Re-bagging
// feature). Same source-side draw-down as transferBagWeight (reduce or
// void), but the target side is an INSERT, not an UPDATE — a new physical
// bag born from material moved out of an existing one. Cross-SKU by design:
// the new bag's product_type/acumatica_id/variant/lot are independent of
// the source's, whatever the operator picked for it.
//
// The new bag's FIRST-EVER scan_events row is 'topped_up', not
// 'bagging_out' — 'topped_up' already means "received weight, sourced from
// another bag," true whether the receiver pre-existed or was created for
// the purpose. This is what keeps it out of every 'bagging_out'-only
// production sum (dashboard tiles, OperationalTrends, monthly ledgers): the
// kg was already counted as production on the day the SOURCE bag was first
// bagged, so counting it again here would double-count it.
//
// tag_method is deliberately left unset — unlike top-up (which always
// forces a reprint because it's correcting an already-printed, now-stale
// label), a brand-new bag has no prior label. It gets the same "Print
// label" / "Write on tag" choice every other freshly bagged output already
// gets; the caller decides that afterward, this function never prints.
export async function createBagFromTransfer(
  sourceSerial: string,
  sourceCurrentWeight: number,
  target: {
    serialNumber: string
    productType: string
    acumaticaId: string | null
    variant: string | null
    lotNumber: string | null
    destination?: string | null
    isOpen?: boolean
  },
  amountKg: number,
  sectionId: string,
  sessionId: string | null,
  operatorId?: string | null,
): Promise<void> {
  if (!sourceSerial || !target.serialNumber || sourceSerial === target.serialNumber) return
  if (!(amountKg > 0) || amountKg > sourceCurrentWeight) return
  const now = new Date().toISOString()

  const remaining = sourceCurrentWeight - amountKg
  if (remaining <= 0) {
    await getDb().schema('production').from('bag_tags').update({
      status: 'voided', voided_at: now, voided_by: operatorId ?? null,
    } as any).eq('serial_number', sourceSerial)
  } else {
    await getDb().schema('production').from('bag_tags').update({
      weight_kg: remaining, is_open: true,
    } as any).eq('serial_number', sourceSerial)
  }

  await getDb().schema('production').from('bag_tags').insert({
    serial_number: target.serialNumber, section_id: sectionId, session_id: sessionId || null,
    product_type: target.productType, acumatica_id: target.acumaticaId,
    variant: target.variant, weight_kg: amountKg, lot_number: target.lotNumber,
    destination: target.destination ?? null, status: 'in_stock',
    is_open: target.isOpen ?? false, printed_at: now,
  } as any)

  await getDb().schema('production').from('scan_events').insert([
    {
      serial_number: target.serialNumber, related_serial_number: sourceSerial,
      section_id: sectionId, session_id: sessionId || null,
      action: 'topped_up', weight_kg: amountKg,
      operator_id: operatorId ?? null, scanned_at: now,
    },
    {
      serial_number: sourceSerial, related_serial_number: target.serialNumber,
      section_id: sectionId, session_id: sessionId || null,
      action: 'drawn_down', weight_kg: amountKg,
      operator_id: operatorId ?? null, scanned_at: now,
    },
  ] as any)
}

// ── addFreshWeightToBag — the common Half-bag Top-up case: today's own
// production (freshly debagged/produced material that hasn't been bagged
// anywhere yet) goes into an EXISTING open bag instead of starting a new
// one. Unlike transferBagWeight above, there is no source BAG — the
// traceable origin is this session's own debagging/production, exactly
// like an ordinary new output bag. Logged as a plain 'bagging_out' row
// (not a topped_up/drawn_down pair) so it counts toward today's output
// the same way a brand-new bag would — this genuinely IS new production,
// not material moved between two already-counted containers.
export async function addFreshWeightToBag(
  targetSerial: string,
  targetCurrentWeight: number,
  amountKg: number,
  sectionId: string,
  sessionId: string | null,
  operatorId?: string | null,
  closeTargetBag = false,
  // The debagged lot this addition actually came from (Fine/Coarse Leaf
  // only — same batch-must-be-debagged rule ordinary bagging enforces).
  // bag_tags.lot_number is deliberately left untouched (it stays "fixed at
  // bagging", the bag's original batch) — this is recorded on the event
  // itself, in the one free-text field scan_events has, so a bag topped up
  // from more than one batch over time keeps every batch's identity in its
  // history rather than only the latest one overwriting the last.
  batch?: string,
): Promise<void> {
  if (!targetSerial || !(amountKg > 0)) return
  const now = new Date().toISOString()

  const targetUpdate: Record<string, unknown> = { weight_kg: targetCurrentWeight + amountKg }
  if (closeTargetBag) targetUpdate.is_open = false
  await getDb().schema('production').from('bag_tags').update(targetUpdate as any).eq('serial_number', targetSerial)

  // notes always carries the HALF_BAG_TOPUP marker (not only when a batch
  // applies) — this is the one reliable way to tell "this bagging_out row
  // is a top-up into an existing bag" apart from an ordinary bag's own
  // first-ever bagging_out row, for both the live activity display and
  // Production Orders' cross-day fresh-topup detection.
  await getDb().schema('production').from('scan_events').insert({
    serial_number: targetSerial, section_id: sectionId, session_id: sessionId || null,
    action: 'bagging_out', weight_kg: amountKg,
    operator_id: operatorId ?? null, scanned_at: now,
    notes: `HALF_BAG_TOPUP${batch ? `: ${batch}` : ''}`,
  } as any)
}

// ── originalBagEvent — a bag's starting weight isn't recoverable from ───────
// bag_tags.weight_kg once it's been topped up/re-bagged (overwritten in
// place each time). The earliest scan_events row for a serial always
// carries it, whether that row is 'bagging_out' (normal capture) or
// 'topped_up' (a bag born via re-bag) — used both to show a bag's original
// bagging date/weight on the re-bag confirmation screen, and by Production
// Orders to tell a bag born via re-bag apart from an ordinary bag that was
// merely topped up later.
export async function originalBagEvent(
  serialNumber: string,
): Promise<{ action: string; weight_kg: number; scanned_at: string } | null> {
  const { data } = await getDb().schema('production').from('scan_events')
    .select('action, weight_kg, scanned_at')
    .eq('serial_number', serialNumber)
    .order('scanned_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as any) ?? null
}

// ── setBagTargetWeight — the "pre-print" step of Half-bag Top-up: an
// operator declares the final weight a bag should reach once fully topped
// up, before any material has actually been added. Writes bag_tags.
// target_weight_kg directly — a pure side-channel update, same as every
// other top-up write here, never touches a session's draft_data. Passing
// null clears a previously set target (e.g. once it's been reached and the
// bag is closed out).
export async function setBagTargetWeight(
  serialNumber: string,
  targetWeightKg: number | null,
): Promise<void> {
  if (!serialNumber) return
  await getDb().schema('production').from('bag_tags')
    .update({ target_weight_kg: targetWeightKg } as any)
    .eq('serial_number', serialNumber)
}

// ── advanceToNextSerial — moves focus to next empty serial input after scan ──
// Called after useSerialLookup fires. Finds the next input with
// data-serial="true" that has no value and focuses it.
// This is the standard scanner UX: scan bag 1 → auto-advance to bag 2 field.
export function advanceToNextSerial(currentInput?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const allSerialInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-serial="true"]')
    )
    if (allSerialInputs.length === 0) return
    const currentIdx = currentInput
      ? allSerialInputs.indexOf(currentInput as HTMLInputElement)
      : -1
    const next = allSerialInputs.slice(currentIdx + 1).find(el => !el.value)
    if (next) {
      next.focus()
      next.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

// ── useGlobalScanner — catches USB scanner input anywhere on the page ─────────
// The Zebra DS2208 types at ~300 chars/sec then sends Enter (keyCode 13).
// Humans type at ~5 chars/sec. We detect the difference by timing.
// When a complete DD-MM-NN serial is detected via scanner speed, fires onScan.
// Ignores input when the active element is a text/number/textarea input
// (so manual typing in a field still works normally).
export function useGlobalScanner(onScan: (serial: string) => void, enabled = true) {
  const bufferRef  = React.useRef('')
  const timerRef   = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastKeyRef = React.useRef<number>(0)

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(e: KeyboardEvent) {
      // If user is actively typing in an input/textarea/select, let it through normally
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const isInputFocused = tag === 'input' || tag === 'textarea' || tag === 'select'

      // Enter key — scanner finished typing
      if (e.key === 'Enter') {
        const serial = bufferRef.current.trim()
        bufferRef.current = ''
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }

        // Only fire if serial looks like DD-MM-NN and came fast (scanner, not user)
        const isValidSerial = /^\d{2}-\d{2}-\d{2,3}$/.test(serial) ||
                              /^\d{2}-\d{2}-\d{2}\/\d+-\d+$/.test(serial)
        const isFast = (Date.now() - lastKeyRef.current) < 200

        if (isValidSerial && isFast && !isInputFocused) {
          e.preventDefault()
          onScan(serial)
        }
        return
      }

      // Accumulate printable characters
      if (e.key.length === 1) {
        const now = Date.now()
        // If gap since last key > 400ms, reset buffer (human started typing)
        if (bufferRef.current && (now - lastKeyRef.current) > 400) {
          bufferRef.current = ''
        }
        lastKeyRef.current = now
        bufferRef.current += e.key

        // Auto-clear buffer after 500ms of no input
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { bufferRef.current = '' }, 500)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, onScan])
}

// ── Half-bag Top-up event lookup — shared by HalfBagTopUpActivity (this
// session's own feed) and CaptureOverview (folded into each bag's own row).
// A qualifying event is either a distinct 'topped_up' row (the "from another
// bag" path — never ambiguous with anything else) or a 'bagging_out' row
// whose notes carry the HALF_BAG_TOPUP marker (the "from today's
// production" path — see addFreshWeightToBag). Anything else is an ordinary
// bag's own first-ever row, not a top-up.
export interface TopUpEvent {
  serial: string
  kg: number
  mode: 'production' | 'existing'
  sourceOrBatch: string | null   // source bag's serial (existing mode) or the batch noted (production mode)
  at: string
}

function parseTopUpRow(r: any): TopUpEvent | null {
  const qualifies = r.action === 'topped_up' || (r.action === 'bagging_out' && String(r.notes ?? '').startsWith('HALF_BAG_TOPUP'))
  if (!qualifies) return null
  const m = /^HALF_BAG_TOPUP:\s*(.+)$/.exec(String(r.notes ?? '').trim())
  return {
    serial: r.serial_number, kg: Number(r.weight_kg) || 0,
    mode: r.action === 'topped_up' ? 'existing' : 'production',
    sourceOrBatch: r.action === 'topped_up' ? r.related_serial_number : (m ? m[1] : null),
    at: r.scanned_at,
  }
}

function groupTopUpEvents(rows: any[]): Map<string, TopUpEvent[]> {
  const map = new Map<string, TopUpEvent[]>()
  for (const r of rows) {
    const ev = parseTopUpRow(r)
    if (!ev) continue
    const list = map.get(ev.serial) ?? []
    list.push(ev)
    map.set(ev.serial, list)
  }
  return map
}

// Every top-up logged for this specific section+session — for a live "what
// just happened in front of me" feed.
export async function fetchTopUpEventsForSession(sectionId: string, sessionId: string): Promise<Map<string, TopUpEvent[]>> {
  const { data } = await getDb().schema('production').from('scan_events')
    .select('serial_number, action, related_serial_number, weight_kg, notes, scanned_at')
    .eq('section_id', sectionId).eq('session_id', sessionId)
    .in('action', ['topped_up', 'bagging_out']).order('scanned_at', { ascending: true })
  return groupTopUpEvents((data as any[]) ?? [])
}

// Every top-up logged for a known set of bag serials, regardless of which
// session logged it — for folding history into bags already being shown
// elsewhere (e.g. Overview's own product/lot grouping), where the top-up
// could have happened in a different session than the one that created
// the bag.
export async function fetchTopUpEventsForSerials(serials: string[]): Promise<Map<string, TopUpEvent[]>> {
  if (!serials.length) return new Map()
  const { data } = await getDb().schema('production').from('scan_events')
    .select('serial_number, action, related_serial_number, weight_kg, notes, scanned_at')
    .in('serial_number', serials).in('action', ['topped_up', 'bagging_out'])
    .order('scanned_at', { ascending: true })
  return groupTopUpEvents((data as any[]) ?? [])
}

// ── fetchFreshTopUpsForSection — "from today's production" top-ups (no
// source bag — addFreshWeightToBag) logged anywhere in this section on this
// date, resolved with the TARGET bag's own product/variant/grade/lot. This
// is specifically for the case fetchTopUpEventsForSerials can't cover: a
// top-up into a bag first bagged on an EARLIER day, which was never part of
// today's own captured output — so there's no existing row anywhere in
// today's product/lot grouping to attach a sub-row to. Callers fold these
// in as their OWN rows, under the matching product type, instead of leaving
// them invisible (Overview) or stuck in a separate, disconnected panel
// (Production Orders).
//
// Scoped by section+date via prod_sessions, the same join order-detail.ts
// already uses for its own freshTopUps — robust to however many sessions/
// shifts/operators the day actually had, without needing every caller to
// thread a full session-id list through.
export interface FreshTopUpRow {
  serial: string
  productType: string | null
  variant: string | null
  grade: string | null
  lot: string | null
  kg: number
  at: string
  batch: string | null   // parsed from notes — the debagged lot credited, Leaf-only
}

export async function fetchFreshTopUpsForSection(
  sectionId: string,
  date: string,
  excludeSerials: Set<string> = new Set(),
): Promise<FreshTopUpRow[]> {
  const { data: sessions } = await getDb().schema('production').from('prod_sessions')
    .select('id').eq('section_id', sectionId).eq('date', date)
  const ids = ((sessions as any[]) ?? []).map(s => s.id)
  if (!ids.length) return []

  const { data } = await getDb().schema('production').from('scan_events')
    .select('serial_number, weight_kg, notes, scanned_at')
    .in('session_id', ids).eq('action', 'bagging_out').ilike('notes', 'HALF_BAG_TOPUP%')
  const rows = ((data as any[]) ?? []).filter(e => e.serial_number && !excludeSerials.has(e.serial_number))
  if (!rows.length) return []

  const serials = Array.from(new Set(rows.map(r => r.serial_number)))
  const { data: tags } = await getDb().schema('production').from('bag_tags')
    .select('serial_number, product_type, variant, destination, lot_number').in('serial_number', serials)
  const tagBySerial = new Map(((tags as any[]) ?? []).map((t: any) => [t.serial_number, t]))

  return rows.map(r => {
    const tag = tagBySerial.get(r.serial_number)
    const m = /^HALF_BAG_TOPUP:\s*(.+)$/.exec(String(r.notes ?? '').trim())
    return {
      serial: r.serial_number,
      productType: tag?.product_type ?? null,
      variant: tag?.variant ?? null,
      grade: tag?.destination ?? null,
      lot: tag?.lot_number ?? null,
      kg: Number(r.weight_kg) || 0,
      at: r.scanned_at,
      batch: m ? m[1] : null,
    }
  })
}

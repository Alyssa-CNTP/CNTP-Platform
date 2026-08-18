'use client'
import { useEffect, useRef, useCallback } from 'react'
import * as React from 'react'
import { getDb } from '@/lib/supabase/db'
import { normaliseVariant } from '@/lib/constants/manufacturing'

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
// CON + RA-CON  → 'conventional'  (can be blended together)
// ORG + RA-ORG + FT-ORG → 'organic'  (can be blended together)
// Families cannot be mixed in a single blend run.
export function variantFamily(v: string): 'conventional' | 'organic' | null {
  const n = normaliseVariant(v)
  if (n === 'Conventional' || n === 'RA-Conventional') return 'conventional'
  if (n === 'Organic' || n === 'RA-Organic' || n === 'FT-ORG') return 'organic'
  return null
}

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

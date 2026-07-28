// lib/logistics/actions.ts
// High-level domain actions. Each action keeps units + unit_events consistent.
// These call the browser/session Supabase client directly — appropriate for the
// prototype. Move to server-side API routes once the access pattern stabilises.

import { getDb } from '@/lib/supabase/db'
import { markBagConsumed } from '@/lib/production/scan-utils'
import { logisticsDb } from './db'
import { newUnitBarcode } from './barcode'
import type { Unit, UnitEvent, EventType, UnitStage } from './types'

export interface RecordEventInput {
  unitId:        string
  eventType:     EventType
  fromStage?:    string | null
  toStage?:      string | null
  fromLocation?: string | null
  toLocation?:   string | null
  operatorId?:   string | null
  operatorName?: string | null
  grnId?:        string | null
  dispatchId?:   string | null
  sessionId?:    string | null
  notes?:        string | null
  payload?:      Record<string, unknown>
}

/** Insert a unit_events row. Caller is responsible for updating units.current_*. */
export async function recordEvent(input: RecordEventInput): Promise<{ id: number } | null> {
  const db = logisticsDb()
  const { data, error } = await db
    .from('unit_events')
    .insert({
      unit_id:           input.unitId,
      event_type:        input.eventType,
      from_stage:        input.fromStage ?? null,
      to_stage:          input.toStage ?? null,
      from_location_id:  input.fromLocation ?? null,
      to_location_id:    input.toLocation ?? null,
      operator_id:       input.operatorId ?? null,
      operator_name:     input.operatorName ?? null,
      grn_id:            input.grnId ?? null,
      dispatch_id:       input.dispatchId ?? null,
      session_id:        input.sessionId ?? null,
      payload:           input.payload ?? {},
      notes:             input.notes ?? null,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[logistics] recordEvent failed', error)
    return null
  }
  return data as { id: number } | null
}

export interface ReceiveUnitInput {
  grnId:           string
  supplierId?:     string | null
  batchId?:        string | null
  customerId?:     string | null
  productType:     string
  variant?:        string | null
  weightKg:        number
  unitType:        'bag' | 'box' | 'pallet'
  locationId?:     string | null
  operatorId?:     string | null
  operatorName?:   string | null
  barcode?:        string             // optional override; auto-generated if absent
}

/** Create a new physical unit during receiving, link to GRN, and emit receive_in event. */
export async function receiveUnit(input: ReceiveUnitInput): Promise<{ unit: Unit; barcode: string } | { error: string }> {
  const db = logisticsDb()
  const barcode = input.barcode?.trim() || newUnitBarcode()

  // Insert the unit
  const { data: unit, error: unitErr } = await db
    .from('units')
    .insert({
      barcode,
      unit_type:           input.unitType,
      batch_id:            input.batchId ?? null,
      supplier_id:         input.supplierId ?? null,
      customer_id:         input.customerId ?? null,
      grn_id:              input.grnId,
      product_type:        input.productType,
      variant:             input.variant ?? null,
      weight_kg:           input.weightKg,
      current_stage:       'received',
      current_location_id: input.locationId ?? null,
      status:              'active',
    })
    .select('*')
    .maybeSingle()

  if (unitErr || !unit) {
    return { error: unitErr?.message ?? 'Failed to create unit' }
  }

  // Record the receive_in event
  await recordEvent({
    unitId:        (unit as any).id,
    eventType:     'receive_in',
    toStage:       'received',
    toLocation:    input.locationId ?? null,
    operatorId:    input.operatorId ?? null,
    operatorName:  input.operatorName ?? null,
    grnId:         input.grnId,
    payload:       { barcode, weight_kg: input.weightKg },
  })

  return { unit: unit as Unit, barcode }
}

export interface ReceiveProductionUnitInput {
  bagSerial:     string             // production.bag_tags.serial_number being scanned in
  unitType:      'bag' | 'box' | 'pallet'
  locationId?:   string | null
  operatorId?:   string | null
  operatorName?: string | null
}

export type ReceiveProductionUnitErrorCode =
  | 'not_found'         // no bag_tags row with that serial
  | 'not_in_stock'      // bag exists but isn't status='in_stock' (already consumed/dispatched/on_hold/rejected)
  | 'already_received'  // a logistics unit already exists with this barcode
  | 'insert_failed'

/**
 * The production-sourced counterpart to receiveUnit() (which is GRN/supplier
 * sourced) — creates a warehouse unit directly from a scanned production bag
 * serial, using that serial as the unit's barcode (the shared identity that
 * links the two schemas; see migration 20260728_002).
 *
 * Retires the source bag_tags row via markBagConsumed() in the same call, so
 * the same physical bag is never simultaneously "in stock" on the production
 * floor AND "active" in the warehouse — each physical unit is represented in
 * exactly one of the two systems at any moment, which is what makes a
 * combined stock count (bag_tags in_stock + logistics.units active) correct
 * rather than double-counted.
 */
export async function receiveProductionUnit(input: ReceiveProductionUnitInput):
  Promise<{ unit: Unit; barcode: string } | { error: string; code: ReceiveProductionUnitErrorCode }> {
  const db = logisticsDb()
  const serial = input.bagSerial.trim()

  const { data: bagRow } = await getDb().schema('production').from('bag_tags')
    .select('serial_number, product_type, variant, weight_kg, lot_number, acumatica_id, section_id, status')
    .eq('serial_number', serial).maybeSingle()
  const bag = bagRow as { serial_number: string; product_type: string; variant: string | null; weight_kg: number | null; lot_number: string | null; acumatica_id: string | null; section_id: string; status: string } | null
  if (!bag) return { error: `No production bag with serial "${serial}".`, code: 'not_found' }
  if (bag.status !== 'in_stock') {
    return { error: `Bag ${serial} is "${bag.status}" — only in-stock bags can be received into the warehouse.`, code: 'not_in_stock' }
  }

  const { data: existingUnit } = await db.from('units').select('id').eq('barcode', serial).maybeSingle()
  if (existingUnit) return { error: `Bag ${serial} has already been received into the warehouse.`, code: 'already_received' }

  const { data: unit, error: unitErr } = await db
    .from('units')
    .insert({
      barcode:                serial,
      unit_type:               input.unitType,
      source:                  'production',
      source_section_id:       bag.section_id ?? null,
      product_type:            bag.product_type,
      variant:                 bag.variant ?? null,
      weight_kg:                bag.weight_kg ?? null,
      acumatica_inventory_id:   bag.acumatica_id ?? null,
      current_stage:           'finished',
      current_location_id:     input.locationId ?? null,
      status:                  'active',
    } as any)
    .select('*')
    .maybeSingle()
  if (unitErr || !unit) return { error: unitErr?.message ?? 'Failed to create unit', code: 'insert_failed' }

  await recordEvent({
    unitId:        (unit as any).id,
    eventType:     'receive_in',
    toStage:       'finished',
    toLocation:    input.locationId ?? null,
    operatorId:    input.operatorId ?? null,
    operatorName:  input.operatorName ?? null,
    payload:       { barcode: serial, weight_kg: bag.weight_kg, source: 'production', lot_number: bag.lot_number },
  })

  await markBagConsumed(serial, 'logistics', null, bag.weight_kg ?? undefined, input.operatorId ?? null)

  return { unit: unit as Unit, barcode: serial }
}

export interface MoveUnitInput {
  unitId:        string
  toLocationId:  string
  toStage?:      UnitStage | null
  operatorId?:   string | null
  operatorName?: string | null
  notes?:        string | null
}

/** Move a unit to a new location (and optionally a new stage). */
export async function moveUnit(input: MoveUnitInput): Promise<{ ok: true } | { error: string }> {
  const db = logisticsDb()

  const { data: existing, error: getErr } = await db
    .from('units')
    .select('id, current_location_id, current_stage, status')
    .eq('id', input.unitId)
    .maybeSingle()
  if (getErr || !existing) return { error: getErr?.message ?? 'Unit not found' }

  const ex = existing as { current_location_id: string | null; current_stage: string; status: string }
  if (ex.status !== 'active' && ex.status !== 'in_process') {
    return { error: `Cannot move unit with status "${ex.status}"` }
  }

  const newStage = input.toStage ?? ex.current_stage
  const { error: updErr } = await db
    .from('units')
    .update({
      current_location_id: input.toLocationId,
      current_stage:       newStage,
    })
    .eq('id', input.unitId)
  if (updErr) return { error: updErr.message }

  await recordEvent({
    unitId:        input.unitId,
    eventType:     'move',
    fromStage:     ex.current_stage,
    toStage:       newStage,
    fromLocation:  ex.current_location_id,
    toLocation:    input.toLocationId,
    operatorId:    input.operatorId ?? null,
    operatorName:  input.operatorName ?? null,
    notes:         input.notes ?? null,
  })

  return { ok: true }
}

export async function setUnitStage(input: {
  unitId:        string
  toStage:       UnitStage
  operatorId?:   string | null
  operatorName?: string | null
  dispatchId?:   string | null
  notes?:        string | null
}): Promise<{ ok: true } | { error: string }> {
  const db = logisticsDb()
  const { data: existing } = await db.from('units').select('current_stage').eq('id', input.unitId).maybeSingle()
  const fromStage = (existing as any)?.current_stage ?? null

  const { error: updErr } = await db
    .from('units').update({ current_stage: input.toStage }).eq('id', input.unitId)
  if (updErr) return { error: updErr.message }

  await recordEvent({
    unitId:        input.unitId,
    eventType:     'stage_change',
    fromStage,
    toStage:       input.toStage,
    dispatchId:    input.dispatchId ?? null,
    operatorId:    input.operatorId ?? null,
    operatorName:  input.operatorName ?? null,
    notes:         input.notes ?? null,
  })
  return { ok: true }
}

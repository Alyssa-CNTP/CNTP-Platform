/**
 * Production capture — shared types
 * Used by the landing page, section forms, and the Zustand store.
 */

export type Shift = 'morning' | 'afternoon' | 'night'
export type SessionStatus = 'draft' | 'submitted' | 'approved'
export type OutputGroup = 'B' | 'C' | 'D'
export type VariantCode = 'C' | 'O' | 'RC' | 'RO'

// ── SECTION DEFINITIONS ───────────────────────────────────────────────────────
export interface ProductionSection {
  id:          string
  name:        string
  description: string
  color:       string   // Tailwind bg class
  hasOutputGroups: boolean  // true = Refining (B/C/D outputs); false = single output
}

export const PRODUCTION_SECTIONS: ProductionSection[] = [
  {
    id:   'sieving',
    name: 'Sieving Tower',
    description: 'Input raw material, output leaf, sticks, dust fractions',
    color: 'bg-blue-500',
    hasOutputGroups: false,
  },
  {
    id:   'refining1',
    name: 'Refining 1',
    description: 'Input sticks & dust → indent sticks, white dust, plant dust',
    color: 'bg-emerald-600',
    hasOutputGroups: true,
  },
  {
    id:   'refining2',
    name: 'Refining 2',
    description: 'Input heavy sticks → CHS coarse, CHS fine, dust fractions',
    color: 'bg-emerald-500',
    hasOutputGroups: true,
  },
  {
    id:   'granule',
    name: 'Granule Line',
    description: 'Input blend material → granules, by-product dusts',
    color: 'bg-amber-500',
    hasOutputGroups: false,
  },
  {
    id:   'blender',
    name: 'Blender',
    description: 'Input refined fractions → final blends',
    color: 'bg-purple-500',
    hasOutputGroups: false,
  },
  {
    id:   'pasteuriser',
    name: 'Pasteuriser',
    description: 'Input blend → pasteurised final product',
    color: 'bg-red-500',
    hasOutputGroups: false,
  },
]

// ── FORM STATE ────────────────────────────────────────────────────────────────

export interface DebaggingRow {
  id:           string   // local uuid for React key
  bagSerialNo:  string
  lotNumber:    string
  productType:  string
  variant:      VariantCode | ''
  kgNett:       string   // string for input control, parsed on submit
  deliveryDate: string
  notes:        string
}

export interface BaggingRow {
  id:          string   // local uuid
  bagSerialNo: string
  lotNumber:   string
  productType: string
  inventoryId: string
  variant:     VariantCode | ''
  kg:          string
  baggingTime: string
}

export interface OutputGroupState {
  rows: BaggingRow[]
}

export interface RefiningFormState {
  // Header
  date:        string
  shift:       Shift
  line:        'ref1' | 'ref2'
  operator1:   string
  operator2:   string
  supervisor:  string

  // Input bags (debagging)
  debagging: DebaggingRow[]

  // Output bags — three independent groups B, C, D
  outputB: BaggingRow[]
  outputC: BaggingRow[]
  outputD: BaggingRow[]

  // Submit state
  sessionId:         string | null
  submittedAt:       string | null
  submittedBy:       string | null
  supervisorConfirmed:  boolean
  supervisorSignature:  string | null
}

// ── MASS BALANCE ──────────────────────────────────────────────────────────────
export interface MassBalance {
  totalInput:   number   // A
  totalOutputB: number   // B
  totalOutputC: number   // C
  totalOutputD: number   // D
  balance:      number   // A - B - C - D  (E)
  withinTolerance: boolean
  toleranceKg:  number   // default 15
}

export function calcMassBalance(
  debagging: DebaggingRow[],
  outputB:   BaggingRow[],
  outputC:   BaggingRow[],
  outputD:   BaggingRow[],
  toleranceKg = 15
): MassBalance {
  const sum = (rows: BaggingRow[]) =>
    rows.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0)

  const totalInput   = debagging.reduce((s, r) => s + (parseFloat(r.kgNett) || 0), 0)
  const totalOutputB = sum(outputB)
  const totalOutputC = sum(outputC)
  const totalOutputD = sum(outputD)
  const balance      = totalInput - totalOutputB - totalOutputC - totalOutputD

  return {
    totalInput,
    totalOutputB,
    totalOutputC,
    totalOutputD,
    balance,
    withinTolerance: Math.abs(balance) <= toleranceKg,
    toleranceKg,
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

export function emptyDebaggingRow(): DebaggingRow {
  return {
    id:           crypto.randomUUID(),
    bagSerialNo:  '',
    lotNumber:    '',
    productType:  '',
    variant:      '',
    kgNett:       '',
    deliveryDate: '',
    notes:        '',
  }
}

export function emptyBaggingRow(): BaggingRow {
  return {
    id:          crypto.randomUUID(),
    bagSerialNo: '',
    lotNumber:   '',
    productType: '',
    inventoryId: '',
    variant:     '',
    kg:          '',
    baggingTime: '',
  }
}

export const VARIANT_OPTIONS: { value: VariantCode; label: string }[] = [
  { value: 'C',  label: 'Conventional' },
  { value: 'O',  label: 'Organic' },
  { value: 'RC', label: 'RA-Conventional' },
  { value: 'RO', label: 'RA-Organic' },
]

export const SHIFT_OPTIONS: { value: Shift; label: string }[] = [
  { value: 'morning',   label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'night',     label: 'Night' },
]
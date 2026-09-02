// The short variant labels, as VARIANT_OPTIONS in capture-config.ts defines
// them. Fairtrade is included: variantToShort() no longer folds FT onto
// CON/ORG, so these two really do reach capture at runtime.
export type Variant = 'CON' | 'ORG' | 'RA CON' | 'RA ORG' | 'FT CON' | 'FT ORG'
export type Grade = 'A' | 'B' | 'C'
export type ShiftType = 'morning' | 'afternoon' | 'night'

export interface LiveOperator {
  id: string
  name: string
  role: 'floor_operator' | 'production_supervisor'
  section_ids: string[]
  active: boolean
}

export interface SessionOperators {
  primary: LiveOperator
  secondary?: LiveOperator   // second floor operator on the same section
}

export function operatorsForSection(operators: LiveOperator[], sectionId: string): LiveOperator[] {
  return operators.filter(op => op.section_ids.includes(sectionId))
}

export interface ScannedBag {
  id: string
  serial_number: string
  product_type: string
  variant: Variant | null
  grade: Grade | null
  weight_kg: number
  lot_number: string | null
  section_id: string
  scanned_at: string
  acumaticaId?:   string   // consumption item code from bag_tags or derived
  acumaticaDesc?: string
  raw?: {
    bag_number: string
    producer: string
    date_of_receipt: string
    dry: boolean
    third_party: boolean
    leaf_shade?: string
    bulk_density?: string
    pa_level?: string
  }
}

export interface OutputBag {
  id: string
  serial_number: string
  product_type: string
  variant: Variant
  grade: Grade
  weight_kg: number
  lot_number: string
  section_id: string
  section_name: string
  created_at: string
  printed: boolean
  acumaticaId?:    string   // derived inventory code e.g. '10LGEF-C'
  acumaticaDesc?:  string   // human description e.g. 'Sieved Fine Leaf: Export - Conventional'
  phantomId?:      string   // phantom item for production order (sieving only)
  // Half-bag Top-up label fields — all optional, only set when building a
  // label for a bag that's been topped up and/or has a target weight set.
  // When present, buildLabelHtml/buildLabelPplb/buildLabelZpl render the
  // distinctive top-up band + history strip instead of the plain footer.
  targetWeightKg?:   number             // final weight this bag should reach once fully topped up (bag_tags.target_weight_kg)
  originalWeightKg?: number             // weight at first bagging, before any top-ups (from the bag's earliest scan_events row — weight_kg itself is overwritten in place on every top-up)
  topUps?: { kg: number; at: string }[] // chronological additions since the original bagging, oldest first
}

export const SECTION_CONFIG: Record<string, {
  name: string
  code: string
  colorHex: string
  colorClass: string
  inputMode: 'scan' | 'register'
  inputTypes: string[]
  outputTypes: string[]
}> = {
  sieving: {
    name: 'Sieving Tower', code: 'ST',
    colorHex: '#0d9488', colorClass: 'bg-teal-600',
    inputMode: 'register',
    inputTypes: ['Farm Bag'],
    outputTypes: ['Fine Leaf','Coarse Leaf','RB Blocks','Heavy Sticks','Indent Sticks','Brown Dust','Powder Dust','Bucket Elevator Spillage'],
  },
  refining1: {
    name: 'Refining 1', code: 'R1',
    colorHex: '#1d4ed8', colorClass: 'bg-blue-700',
    inputMode: 'scan',
    // Coarse Leaf + Cut Heavy Stick Fine/Coarse are additional inputs that
    // originate upstream (sieving tower / refining) — their batch number and
    // serial trace back to the origin bag on scan / system pick.
    inputTypes: ['Indent Sticks', 'Heavy Sticks', 'Blocks: Clean', '1st Cut', 'Coarse Leaf', 'Cut Heavy Stick Fine', 'Cut Heavy Stick Coarse'],
    outputTypes: ['Indent Dust', 'White Dust'],
  },
  refining2: {
    name: 'Refining 2', code: 'R2',
    colorHex: '#3b82f6', colorClass: 'bg-blue-500',
    inputMode: 'scan',
    inputTypes: ['Heavy Sticks', 'Cut Heavy Stick Coarse', 'Cut Heavy Stick Fine', 'Coarse Leaf'],
    outputTypes: ['Cut Heavy Stick Fine', 'Cut Heavy Stick Coarse', 'White Dust', 'Powder Dust'],
  },
  granule: {
    name: 'Granule Line', code: 'GL',
    colorHex: '#d97706', colorClass: 'bg-amber-600',
    inputMode: 'scan',
    inputTypes: ['Brown Dust','White Dust','Indent Dust','ALT Dust','SG Dust','SF Dust','Powder Dust','Dust Extraction'],
    outputTypes: [
      'SG Granules','SG Granules 002',
      'SF Granules','SF Granules 002',
      'Export Granules','Export Granules 002',
      'SG Dust','SF Dust',
    ],
  },
  blender: {
    name: 'Blender', code: 'BL',
    colorHex: '#7c3aed', colorClass: 'bg-violet-700',
    inputMode: 'scan',
    inputTypes: [
      'Fine Leaf','Coarse Leaf','Blocks Clean','Blocks Dirty','Blocks Cut',
      'Cut Heavy Stick Fine','Cut Heavy Stick Coarse',
      'SG Granules','SF Granules',
      'Other',
    ],
    outputTypes: ['Blended Batch'],
  },
  smallblender: {
    name: 'Small Blender', code: 'SB',
    colorHex: '#a855f7', colorClass: 'bg-purple-500',
    inputMode: 'scan',
    inputTypes: ['Various'],
    outputTypes: ['Blended Batch'],
  },
  pasteuriser: {
    name: 'Pasteuriser', code: 'PR',
    colorHex: '#be185d', colorClass: 'bg-rose-600',
    inputMode: 'scan',
    inputTypes: ['Blended Batch'],
    outputTypes: ['Bulk Bag 500kg','Box 18kg','Paper Bag 18kg','By-product'],
  },
  // Not a production bagging section (no capture screen) -- the Sieving
  // Final QC lab's own printer, so it can show up on the Printers/Print
  // Health admin pages the same way real sections do. See
  // capture-config.ts's PRINTER_SECTIONS/SECTION_PRINTER for why it's kept
  // out of SECTION_ORDER itself.
  quality_lab: {
    name: 'Quality Lab (Sieving Final QC)', code: 'QL',
    colorHex: '#475569', colorClass: 'bg-slate-600',
    inputMode: 'register',
    inputTypes: [],
    outputTypes: [],
  },
}

export const VARIANT_LABELS: Record<Variant, string> = {
  'CON':    'Conventional',
  'ORG':    'Organic',
  'RA CON': 'RA Conventional',
  'RA ORG': 'RA Organic',
  'FT CON': 'Fairtrade Conventional',
  'FT ORG': 'Fairtrade Organic',
}

export const GRADE_LABELS: Record<Grade, string> = {
  'A': 'Export (A)',
  'B': 'Export Blend (B)',
  'C': 'Domestic / Local (C)',
}

export const SECTION_CODE_MAP: Record<string, string> = {
  sieving: 'ST', refining1: 'R1', refining2: 'R2',
  granule: 'GL', blender: 'BL', smallblender: 'SB', pasteuriser: 'PR',
}

export const BLENDER_INPUT_COLUMNS: Record<string, string> = {
  'Fine Leaf':              'A',
  'Coarse Leaf':            'B',
  'Blocks Clean':           'C',
  'Blocks Dirty':           'C',
  'Blocks Cut':             'D',
  'Cut Heavy Stick Fine':   'D',
  'Cut Heavy Stick Coarse': 'D',
  'SG Granules':            'E',
  'SF Granules':            'E',
  'Other':                  'F',
}

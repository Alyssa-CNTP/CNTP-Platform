// ── CNTP PRODUCTION DATA ────────────────────────────────────────────────────
// Single source of truth for all sections and inventory items.
// Synced with the live HTML app (stock-count.html) — same items, same IDs.
// Group types: 'leaf' | 'dust' | 'stick' | 'simple' | 'pallet' | 'granule'

export type VariantCode = 'C' | 'O' | 'RC' | 'RO'

export interface Variant {
  val:   VariantCode
  label: string
}

export interface InventoryItem {
  uid:  string          // unique within the app
  base: string          // Acumatica inventory ID base
  name: string          // human-readable name
  g:    'leaf' | 'dust' | 'stick' | 'simple' | 'pallet' | 'granule'
  v:    Variant[]       // available variants (empty = no variant suffix)
}

export interface Section {
  id:    string
  color: string         // Tailwind bg color class for the accent bar
  tk:    string         // translation key for title
  hk:    string         // translation key for subtitle/hint
  items: InventoryItem[]
}

// ── VARIANT SETS ──────────────────────────────────────────────────────────────
export const V4: Variant[] = [
  { val: 'C',  label: 'Conventional' },
  { val: 'O',  label: 'Organic' },
  { val: 'RC', label: 'RA-Conventional' },
  { val: 'RO', label: 'RA-Organic' },
]
export const V2: Variant[] = [V4[0], V4[1]]
export const VC: Variant[] = [V4[0]]
export const V_RA: Variant[] = [V4[0], V4[3]]

// ── ROOIBOS SECTIONS ─────────────────────────────────────────────────────────
export const ROOIBOS_SECTIONS: Section[] = [
  {
    id: 'sieve', color: 'bg-teal-600', tk: 's1t', hk: 's1h',
    items: [
      { uid: 'lf-ef',         base: '10LGEF',       name: 'Fine Leaf: Export',              g: 'leaf',   v: V4 },
      { uid: 'lf-blf',        base: '10LGBLF',      name: 'Fine Leaf: Export Blend',        g: 'leaf',   v: V4 },
      { uid: 'lf-df',         base: '10LGDF',       name: 'Fine Leaf: Domestic',            g: 'leaf',   v: V4 },
      { uid: 'lf-ec',         base: '10LGEC',       name: 'Coarse Leaf: Export',            g: 'leaf',   v: V4 },
      { uid: 'lf-blc',        base: '10LGBLC',      name: 'Coarse Leaf: Export Blend',      g: 'leaf',   v: V4 },
      { uid: 'lf-dc',         base: '10LGDC',       name: 'Coarse Leaf: Domestic',          g: 'leaf',   v: V4 },
      { uid: 's-db',          base: '15IGDB',       name: 'Dust: Brown',                    g: 'dust',   v: V4 },
      { uid: 's-dpow',        base: '15IGDPOWDR',   name: 'Dust: Powder',                   g: 'dust',   v: V4 },
      { uid: 's-is',          base: '15IGIS',       name: 'Indent Sticks',                  g: 'stick',  v: V4 },
      { uid: 's-st',          base: '15IGST',       name: 'Sticks (RS)',                    g: 'stick',  v: V4 },
      { uid: 's-bl',          base: '15IGBL-C',     name: 'Blocks: Clean',                  g: 'stick',  v: V4 },
      { uid: 's-1c',          base: '15IG1C',       name: '1st Cut',                        g: 'stick',  v: V4 },
      { uid: 's-alt',         base: '15IGDALT',     name: 'ALT Dust',                       g: 'simple', v: [V4[0], V4[1], V4[3]] },
      { uid: 'be-exb-sieve',  base: '05RMDBL',      name: 'Bucket Elevator: Export Blend',  g: 'simple', v: V4 },
      { uid: 'be-exp-sieve',  base: '05RMDE',       name: 'Bucket Elevator: Export',        g: 'simple', v: V4 },
      { uid: 'be-loc-sieve',  base: '05RMDD',       name: 'Bucket Elevator: Domestic',      g: 'simple', v: V4 },
      { uid: 'be-spill-sieve',base: 'SPILL',        name: 'Machine Spillage',               g: 'simple', v: [] },
    ],
  },
  {
    id: 'ref1', color: 'bg-blue-700', tk: 's2t', hk: 's2h',
    items: [
      { uid: 'r1-is',          base: '15IGIS',    name: 'Indent Sticks',      g: 'stick',  v: V4 },
      { uid: 'r1-st',          base: '15IGST',    name: 'Sticks',              g: 'stick',  v: V4 },
      { uid: 'r1-bl',          base: '15IGBL-C',  name: 'Blocks: Clean',       g: 'stick',  v: V4 },
      { uid: 'r1-1c',          base: '15IG1C',    name: '1st Cut',             g: 'stick',  v: V4 },
      { uid: 'r1-dis',         base: '15IGDIS',   name: 'Dust: Indent',        g: 'dust',   v: V4 },
      { uid: 'r1-dw',          base: '15IGDW',    name: 'Dust: White',         g: 'dust',   v: V4 },
      { uid: 'r1-db',          base: '15IGDB',    name: 'Dust from Plant',     g: 'simple', v: V4 },
      { uid: 'be-spill-ref1',  base: 'SPILL',     name: 'Machine Spillage',    g: 'simple', v: [] },
    ],
  },
  {
    id: 'ref2', color: 'bg-indigo-700', tk: 's3t', hk: 's3h',
    items: [
      { uid: 'r2-chsc',        base: '20BGCHS-C',   name: 'Cut Heavy Stick Coarse', g: 'simple', v: V4 },
      { uid: 'r2-chsf',        base: '20BGCHS-F',   name: 'Cut Heavy Stick Fine',   g: 'simple', v: V4 },
      { uid: 'r2-dw',          base: '15IGDW',      name: 'Dust: White',            g: 'dust',   v: V4 },
      { uid: 'r2-pow',         base: '15IGDPOWDR',  name: 'Dust: Powder',           g: 'dust',   v: V4 },
      { uid: 'r2-db',          base: '15IGDB',      name: 'Dust from Plant',        g: 'simple', v: V4 },
      { uid: 'be-spill-ref2',  base: 'SPILL',       name: 'Machine Spillage',       g: 'simple', v: [] },
    ],
  },
  {
    id: 'past', color: 'bg-purple-700', tk: 's4t', hk: 's4h',
    items: [
      { uid: 'pa-sg',          base: '30FP-SG',     name: 'Super Grade',             g: 'pallet', v: V4 },
      { uid: 'pa-sfc',         base: '30FP-SFC',    name: 'Super Fine Cut',          g: 'pallet', v: V4 },
      { uid: 'pa-se',          base: '30FP-SE',     name: 'Super Export',            g: 'pallet', v: V4 },
      { uid: 'pa-fse',         base: '30FP-FSE',    name: 'Fine Super Export',       g: 'pallet', v: V4 },
      { uid: 'pa-ch',          base: '30FP-CH',     name: 'Choice',                  g: 'pallet', v: V4 },
      { uid: 'pa-sc',          base: '30FP-SC',     name: 'Short Cut',               g: 'pallet', v: V4 },
      { uid: 'pa-esp',         base: '30FP-ESP',    name: 'Espresso',                g: 'pallet', v: V4 },
      { uid: 'be-spill-past',  base: 'SPILL',       name: 'Machine Spillage',        g: 'simple', v: [] },
    ],
  },
  {
    id: 'blend', color: 'bg-orange-600', tk: 's5t', hk: 's5h',
    items: [
      { uid: 'bl-sg',          base: '25BMSG',    name: 'Blend: Super Grade',    g: 'simple', v: VC },
      { uid: 'bl-se',          base: '25BMSE',    name: 'Blend: Super Export',   g: 'simple', v: V_RA },
      { uid: 'bl-refse',       base: '25REFSE',   name: 'Refill: Super Export',  g: 'simple', v: VC },
      { uid: 'bl-refsg',       base: '25REFSG',   name: 'Refill: Super Grade',   g: 'simple', v: VC },
      { uid: 'bl-reforg',      base: '25REFORG',  name: 'Refill: Organic',       g: 'simple', v: V2 },
      { uid: 'bl-reffse',      base: '25REFFSE',  name: 'Refill: FSE',           g: 'simple', v: [V4[0], V4[2]] },
      { uid: 'be-spill-blend', base: 'SPILL',     name: 'Machine Spillage',      g: 'simple', v: [] },
    ],
  },
  {
    id: 'gran', color: 'bg-green-700', tk: 's6t', hk: 's6h',
    items: [
      { uid: 'gr-sg',          base: '20BGGSG-001',  name: 'Granules SG',            g: 'granule', v: V4 },
      { uid: 'gr-f',           base: '20BGGF-001',   name: 'Granules Fine',          g: 'granule', v: V4 },
      { uid: 'gr-e',           base: '20BGGE-001',   name: 'Granules Export',        g: 'granule', v: V4 },
      { uid: 'gr-f2',          base: '20BGGF-002',   name: 'Granules Fine (alt)',    g: 'granule', v: V4 },
      { uid: 'gr-db',          base: '15IGDB',       name: 'Dust: Brown',            g: 'dust',    v: V4 },
      { uid: 'gr-dis',         base: '15IGDIS',      name: 'Dust: Indent',           g: 'dust',    v: V4 },
      { uid: 'gr-dw',          base: '15IGDW',       name: 'Dust: White',            g: 'dust',    v: V4 },
      { uid: 'gr-pow',         base: '15IGDPOWDR',   name: 'Dust: Powder',           g: 'dust',    v: V4 },
      { uid: 'gr-dsg',         base: '15IGDSG',      name: 'Dust: SG (by-product)', g: 'dust',    v: V4 },
      { uid: 'gr-dsf',         base: '15IGDSF',      name: 'Dust: SF (by-product)', g: 'dust',    v: V4 },
      { uid: 'gr-tbc',         base: '20BGTBC',      name: 'Tea Bag Cut (TBC)',      g: 'simple',  v: V4 },
      { uid: 'gr-pyr',         base: '20BGPYR',      name: 'Pyramid Cut',            g: 'simple',  v: V2 },
      { uid: 'be-spill-gran',  base: 'SPILL',        name: 'Machine Spillage',       g: 'simple',  v: [] },
    ],
  },
  {
    id: 'final', color: 'bg-red-700', tk: 's7t', hk: 's7h',
    items: [
      { uid: 'fi-fpch',        base: '30FPCH-001B',  name: 'Final Product: Choice',          g: 'pallet', v: [] },
      { uid: 'fi-fpse',        base: '30FPSE-001B',  name: 'Final Product: Super Export',    g: 'pallet', v: [] },
      { uid: 'fi-fpsg',        base: '30FPSG-001C',  name: 'Final Product: Super Grade',     g: 'pallet', v: [] },
      { uid: 'fi-fpsfc',       base: '30FPSFC-001A', name: 'Final Product: Super Fine Cut',  g: 'pallet', v: [] },
      { uid: 'fi-ref',         base: '25REFSG-C',    name: 'Refill Bags: SG',                g: 'pallet', v: [] },
      { uid: 'be-spill-final', base: 'SPILL',        name: 'Machine Spillage',               g: 'simple', v: [] },
    ],
  },
  {
    id: 'hmm', color: 'bg-slate-600', tk: 's8t', hk: 's8h',
    items: [
      { uid: 'hm-rd',          base: '35WGRD',        name: 'Red Dust',        g: 'simple', v: V2 },
      { uid: 'hm-yd',          base: '35WGYD',        name: 'Yellow Dust',     g: 'simple', v: VC },
      { uid: 'hm-fw',          base: '35WPW-FLOOR-C', name: 'Floor Waste',     g: 'simple', v: [] },
      { uid: 'hm-cw',          base: '35WPW-CLEAN-C', name: 'Cleaning Waste',  g: 'simple', v: [] },
      { uid: 'hm-wc',          base: '35WPWC-C',      name: 'Wet Clumps',      g: 'simple', v: [] },
      { uid: 'be-spill-hmm',   base: 'SPILL',         name: 'Machine Spillage',g: 'simple', v: [] },
    ],
  },
]

// ── ROSEHIP SECTIONS ──────────────────────────────────────────────────────────
export const ROSEHIP_SECTIONS: Section[] = [
  {
    id: 'rh-f', color: 'bg-pink-700', tk: 'r1t', hk: 'r1h',
    items: [
      { uid: 'rhf-db',         base: '05RMDB',      name: 'Whole Rosehip Berries (Dry)', g: 'simple', v: V2 },
      { uid: 'rhf-wdb',        base: '05RMWB',      name: 'Whole Rosehip Berries (Wet)', g: 'simple', v: V2 },
      { uid: 'rhf-sh',         base: '15IGSH',      name: 'Shell',                       g: 'simple', v: V2 },
      { uid: 'rhf-shc',        base: '15IGSH-C',    name: 'Shell: Clean',                g: 'simple', v: V2 },
      { uid: 'rhf-fp',         base: '30FPSH-001',  name: 'Finished Product: Shell',     g: 'pallet', v: [] },
      { uid: 'be-spill-rhf',   base: 'SPILL',       name: 'Machine Spillage',            g: 'simple', v: [] },
    ],
  },
  {
    id: 'rh-p', color: 'bg-indigo-600', tk: 'r2t', hk: 'r2h',
    items: [
      { uid: 'rhp-as',   base: '15IGAS',    name: 'Aspirated Shell',    g: 'simple', v: V2 },
      { uid: 'rhp-asd',  base: '15IGASD',   name: 'Aspirated Seed',     g: 'simple', v: V2 },
      { uid: 'rhp-cc',   base: '15IGRHCC',  name: 'Coarse: Cutter',     g: 'simple', v: V2 },
      { uid: 'rhp-ch',   base: '15IGRHCH',  name: 'Coarse: Hammermill', g: 'simple', v: V2 },
      { uid: 'rhp-shm',  base: '15IGSH-M',  name: 'Shell: Mixed',       g: 'simple', v: V2 },
      { uid: 'rhp-sws',  base: '15IGSSM',   name: 'Shell with Seed',    g: 'simple', v: VC },
    ],
  },
  {
    id: 'rh-k', color: 'bg-cyan-700', tk: 'r3t', hk: 'r3h',
    items: [
      { uid: 'rhk-tbc',     base: '30FPTBC-001',   name: 'TBC (Tea Bag Cut)',   g: 'pallet', v: [] },
      { uid: 'rhk-pc',      base: '30FPPC-001',    name: 'Pyramid Cut',         g: 'pallet', v: [] },
      { uid: 'rhk-sh25',    base: '30FPSH25-001',  name: 'Shell 25% Blend',     g: 'pallet', v: [] },
      { uid: 'rhk-granc',   base: '20BGGRHC',      name: 'RH Granules: Coarse', g: 'simple', v: V2 },
      { uid: 'rhk-grantbc', base: '20BGGRHTBC',    name: 'RH Granules: TBC',    g: 'simple', v: V2 },
    ],
  },
  {
    id: 'rh-w', color: 'bg-slate-600', tk: 'r4t', hk: 'r4h',
    items: [
      { uid: 'rhw-rd', base: '35WGRD',   name: 'Red Dust',                  g: 'simple', v: V2 },
      { uid: 'rhw-yd', base: '35WGYD',   name: 'Yellow Dust',               g: 'simple', v: VC },
      { uid: 'rhw-fw', base: '35WGFW',   name: 'Floor Waste + Wet Clumps',  g: 'simple', v: [] },
      { uid: 'rhw-wc', base: '35WPWC-C', name: 'Wet Clumps',               g: 'simple', v: [] },
    ],
  },
]

export const ALL_SECTIONS = [...ROOIBOS_SECTIONS, ...ROSEHIP_SECTIONS]

// ── PALLET PACKAGE CONFIG ────────────────────────────────────────────────────
// Labels match the live HTML app: Boxes, Paper Bags, Bulk Bags
export const PALLET_PACKAGES = [
  { key: 'boxes',  label: 'Boxes',      weight: 18  },
  { key: 'bags',   label: 'Paper Bags', weight: 18  },
  { key: 'paper',  label: 'Bulk Bags',  weight: 500 },
] as const

// ── HELPERS ──────────────────────────────────────────────────────────────────

/** Derive the full Acumatica inventory code including variant suffix */
export function inventoryCode(item: InventoryItem, variant: string): string {
  if (!variant || item.g === 'pallet' || !item.v.length) return item.base
  if (item.base.endsWith('-C') || item.base.endsWith('-O')) return item.base
  return `${item.base}-${variant}`
}

/** Compute total kg from a pallet entry */
export function palletKg(boxes: number, bags: number, paper: number): number {
  return boxes * 18 + bags * 18 + paper * 500
}

/** Get item by uid across all sections */
export function findItem(uid: string): { section: Section; item: InventoryItem } | null {
  for (const sec of ALL_SECTIONS) {
    const item = sec.items.find(i => i.uid === uid)
    if (item) return { section: sec, item }
  }
  return null
}

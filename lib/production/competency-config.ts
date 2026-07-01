/**
 * Staff & Competency module — shared configuration.
 * Mirrors the shape of roster-config.ts so patterns stay consistent.
 *
 * Status values align exactly with the CHECK constraint in:
 *   production.employee_competencies.status
 * and the progress scale from SOP_Matrix_Final.xlsx.
 */

export type CompetencyStatus =
  | 'not_started'
  | 'sop_created'
  | 'training_done'
  | 'assessed'
  | 'competent'
  | 'not_competent'
  | 'tba'

export interface CompetencyStatusMeta {
  status:   CompetencyStatus
  label:    string
  short:    string       // for matrix cells
  progress: number | null
  colorHex: string
  bgClass:  string       // Tailwind bg for cell/badge
  textClass: string
}

export const COMPETENCY_STATUSES: CompetencyStatusMeta[] = [
  { status: 'competent',     label: 'Competent',        short: 'COMP', progress: 1.00, colorHex: '#1A7A3C', bgClass: 'bg-ok/15',         textClass: 'text-ok'       },
  { status: 'assessed',      label: 'Assessed',         short: 'ASSD', progress: 0.75, colorHex: '#2A7CB8', bgClass: 'bg-azure/15',       textClass: 'text-azure'    },
  { status: 'training_done', label: 'Training Done',    short: 'TRN',  progress: 0.50, colorHex: '#B85C0A', bgClass: 'bg-warn/15',        textClass: 'text-warn'     },
  { status: 'sop_created',   label: 'SOP Created',      short: 'SOP',  progress: 0.25, colorHex: '#6B4FA0', bgClass: 'bg-purple-100',     textClass: 'text-purple-700'},
  { status: 'tba',           label: 'To Be Assessed',   short: 'TBA',  progress: null, colorHex: '#B85C0A', bgClass: 'bg-amber-50',       textClass: 'text-amber-600'},
  { status: 'not_started',   label: 'Not Trained',      short: '—',    progress: 0.00, colorHex: '#9CA3AF', bgClass: 'bg-stone-50',       textClass: 'text-stone-400'},
  { status: 'not_competent', label: 'Not Competent',    short: 'NC',   progress: 0.00, colorHex: '#B81C1C', bgClass: 'bg-err/10',         textClass: 'text-err'      },
]

export function statusMeta(status: CompetencyStatus | string): CompetencyStatusMeta {
  return COMPETENCY_STATUSES.find(s => s.status === status)
    ?? COMPETENCY_STATUSES.find(s => s.status === 'not_started')!
}

// ── Raw-code → canonical status (from SOP_Matrix_Final.xlsx) ─────────────────
// CT confirmed = score 1 in the Training Information sheet → competent.

export const RAW_CODE_MAP: Record<string, CompetencyStatus> = {
  'COMP':        'competent',
  'CT':          'competent',      // "Competent-Trained" — confirmed score=1
  'NC':          'not_competent',
  'TBA':         'tba',
  'Not Trained': 'not_started',
  '0':           'not_started',
  '0.25':        'sop_created',
  '0.5':         'training_done',
  '0.75':        'assessed',
  '1':           'competent',
}

export function rawCodeToStatus(raw: string | null | undefined): CompetencyStatus {
  if (!raw) return 'not_started'
  return RAW_CODE_MAP[raw.trim()] ?? 'not_started'
}

// ── SOP area colours + labels ─────────────────────────────────────────────────

export interface SopArea {
  key:      string
  label:    string
  colorHex: string
}

export const SOP_AREAS: SopArea[] = [
  { key: 'production',  label: 'Production',   colorHex: '#1A3A0E' },
  { key: 'rosehip',     label: 'Rosehip',      colorHex: '#6B4FA0' },
  { key: 'stores',      label: 'Stores',       colorHex: '#2A7CB8' },
  { key: 'quality',     label: 'Quality',      colorHex: '#B85C0A' },
  { key: 'laboratory',  label: 'Laboratory',   colorHex: '#1A7A3C' },
  { key: 'hygiene',     label: 'Hygiene',      colorHex: '#B81C1C' },
  { key: 'maintenance', label: 'Maintenance',  colorHex: '#637056' },
  { key: 'food_safety', label: 'Food Safety',  colorHex: '#9CA3AF' },
  { key: 'other',       label: 'Other',        colorHex: '#9CA3AF' },
]

export function sopAreaMeta(key: string): SopArea {
  return SOP_AREAS.find(a => a.key === key) ?? { key, label: key, colorHex: '#9CA3AF' }
}

// ── Section → SOP doc_no seed mapping (mirrors migration seed) ───────────────
// Used by the UI to pre-filter the matrix by floor section.

export const SECTION_CORE_SOPS: Record<string, string> = {
  sieving:     'PROD-WI-004',
  refining1:   'PROD-WI-002',
  refining2:   'PROD-WI-007',
  granule:     'PROD-WI-005',
  blender:     'PROD-WI-006',
  pasteuriser: 'PROD-WI-003',
}

// ── Department code → production.employees.department map ────────────────────
// Raw codes from the spreadsheet → the canonical department CHECK enum.

export const DEPT_CODE_MAP: Record<string, string> = {
  'PRD':    'production',
  'PRG':    'production',   // Production: Granules
  'QUA':    'qc',
  'GENWRK': 'production',
  'STR':    'store',
  'MAIN':   'maintenance',
  'HS':     'hs',
  'CLEAN':  'cleaning',
  'ADM':    'admin',
}

export function deptCodeToEnum(code: string | null | undefined): string {
  if (!code) return 'production'
  const prefix = code.split(' ')[0].split('-')[0]
  return DEPT_CODE_MAP[prefix] ?? 'production'
}

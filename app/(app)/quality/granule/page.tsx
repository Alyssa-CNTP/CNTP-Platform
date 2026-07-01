'use client'

// app/(app)/quality/granule/page.tsx
//
// Granule Line workcenter — exact feature parity with CNTPquality Express app.
//
// Data lives in qms schema (Supabase), NOT public schema:
//   qms.granule_runs       — run headers
//   qms.granule_samples    — per-sample sieve/moisture/BD data
//   qms.granule_tastings   — tasting records linked to runs
//   qms.granule_specs      — spec library
//
// All CRUD goes directly to Supabase (no Express proxy needed for this page).
// Violation logic mirrors the Express POST /api/granule/samples exactly.

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { checkOutlier } from '@/lib/utils/outliers'
import { exportGranuleRun } from '@/lib/utils/exportExcel'
import { useQcNames } from '@/lib/hooks/useQcNames'
import QCNameField from '@/components/shared/QCNameField'
import LmDecisionModal from '@/components/shared/LmDecisionModal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

// ─── Constants (from original App.js) ────────────────────────────────────────

const GRANULE_SIEVES = [
  { key: 'gt6',  label: '>6'   },
  { key: 'gt10', label: '>10'  },
  { key: 'gt12', label: '>12'  },
  { key: 'gt16', label: '>16'  },
  { key: 'gt20', label: '>20'  },
  { key: 'gt40', label: '>40'  },
  { key: 'dust', label: 'Dust' },
]

const GRANULE_TYPE_GRADES = [
  'Rooibos Super Grade Granules',
  'Rooibos Super Fine Granules',
  'Rooibos Super Export Granules',
  'Rooibos Super Export Plus Granules',
]

const GRANULE_TASTE_FIELDS = [
  { key: 'granule_aroma',   label: 'Granule Aroma',      short: 'Aroma'    },
  { key: 'flavour_profile', label: 'Flavour Profile',    short: 'Flavour'  },
  { key: 'briskness',       label: 'Briskness of Taste', short: 'Briskness'},
  { key: 'strength',        label: 'Strength of Taste',  short: 'Strength' },
  { key: 'cup_colour',      label: 'Cup Colour',         short: 'Cup Col.' },
]

const SCORE_LABELS: Record<string, string[]> = {
  granule_aroma:   ['', 'Poor',        'Weak',          'Acceptable', 'Good',             'Excellent'          ],
  flavour_profile: ['', 'Off-flavour', 'Flat',          'Acceptable', 'Balanced/Woody',   'Balanced/Woody/Sweet'],
  briskness:       ['', 'Very Flat',   'Flat',          'Acceptable', 'Lively',           'Very Lively'        ],
  strength:        ['', 'Very Weak',   'Weak',          'Medium',     'Bold',             'Very Bold'          ],
  cup_colour:      ['', 'Murky',       'Dull',          'Acceptable', 'Clear',            'Clear & Bright'     ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inp = 'px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-[12px] text-text bg-surface-card outline-none focus:border-accent'
const lbl = 'block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1'

function buildSerialPrefix(dateStr: string) {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length !== 3) return ''
  return `${parts[2]}.${parts[1]}.`
}

function extractBagNum(serial: string) {
  if (!serial) return ''
  const parts = serial.split('.')
  return parts.length >= 3 ? parts.slice(2).join('.') : ''
}

function scoreColor(v: any) {
  const n = parseInt(v)
  if (!n) return 'var(--color-text-muted)'
  if (n >= 4) return 'var(--color-ok)'
  if (n <= 2) return 'var(--color-err)'
  return 'var(--color-warn)'
}

/** Compute violations exactly as the Express server does */
function computeViolations(b: any, specJson: any): string[] {
  const spec = specJson || {}
  const violations: string[] = []
  if (b.moisture != null && spec.moisture_max && parseFloat(b.moisture) > parseFloat(spec.moisture_max))
    violations.push(`Moisture ${b.moisture}% > ${spec.moisture_max}%`)
  if (b.bulk_density != null && spec.bd_min && parseFloat(b.bulk_density) < parseFloat(spec.bd_min))
    violations.push(`BD ${b.bulk_density} < ${spec.bd_min}`)
  if (b.bulk_density != null && spec.bd_max && parseFloat(b.bulk_density) > parseFloat(spec.bd_max))
    violations.push(`BD ${b.bulk_density} > ${spec.bd_max}`)
  const sievePct = b.sieve_pct || {}
  Object.entries(sievePct).forEach(([frac, pct]: [string, any]) => {
    const sp = spec[`sieve_${frac}`]; if (!sp) return
    if (sp.min != null && pct < sp.min) violations.push(`${frac} ${parseFloat(pct).toFixed(1)}% < ${sp.min}%`)
    if (sp.max != null && pct > sp.max) violations.push(`${frac} ${parseFloat(pct).toFixed(1)}% > ${sp.max}%`)
  })
  return violations
}

// Normalises a batch number for duplicate comparison — case, whitespace and
// hyphen/underscore variants (e.g. "GS-0098" / "GS 0098" / "GS_0098") all
// collapse to the same key, so a duplicate can't slip through as "different".
function normBatch(b: string | null | undefined) {
  return (b ?? '').trim().toLowerCase().replace(/_/g, '-').replace(/\s*-\s*/g, '-')
}

// Fetches every row of a table, paginating past PostgREST's 1000-row cap so
// duplicate-batch checks and history views always see the full data set.
async function fetchAllRows(db: any, table: string, build: (q: any) => any): Promise<any[]> {
  let all: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(db.schema('qms').from(table).select('*')).range(from, from + 999)
    if (error) break
    all = all.concat(data || [])
    if (!data || data.length < 1000) break
  }
  return all
}

function sortSamples(samples: any[]) {
  return [...samples].sort((a, b) => {
    const da = `${a.sample_date || ''}${a.sample_time || ''}`
    const db2 = `${b.sample_date || ''}${b.sample_time || ''}`
    if (da && db2) return da < db2 ? -1 : da > db2 ? 1 : 0
    if (da) return -1; if (db2) return 1; return 0
  })
}

// ─── GranuleNumKey ────────────────────────────────────────────────────────────

function GranuleNumKey({ value, onChange }: { value: any; onChange: (v: string) => void }) {
  const keys = ['7','8','9','4','5','6','1','2','3','⌫','0','.']
  return (
    <div className="grid grid-cols-3 gap-1" style={{ width: 150 }}>
      {keys.map(k => (
        <button key={k} type="button"
          onClick={() => {
            if (k === '⌫') { onChange(String(value || '').slice(0, -1)); return }
            const cur = String(value || '')
            if (k === '.' && cur.includes('.')) return
            onChange(cur + k)
          }}
          className={`py-2.5 rounded-lg border text-[14px] font-bold font-mono cursor-pointer transition-colors ${k === '⌫' ? 'border-err/30 bg-err/8 text-err' : 'border-surface-rule bg-surface text-text hover:bg-surface-card'}`}>
          {k}
        </button>
      ))}
    </div>
  )
}

// ─── Shared SieveTable (used in Add/Edit/Sieve modals) ───────────────────────

interface SieveTableProps {
  grams: Record<string, string>
  pcts: Record<string, number>
  focusedSieve: string
  setFocusedSieve: (k: string) => void
  specJson: any
  errors?: string[]
}

function SieveTable({ grams, pcts, focusedSieve, setFocusedSieve, specJson, errors = [] }: SieveTableProps) {
  const totalG = GRANULE_SIEVES.reduce((s, f) => s + (parseFloat(grams[f.key]) || 0), 0)
  const hasErr = errors.some(e => e.startsWith('Sieve'))

  const specForFrac = (key: string) => {
    const sp = specJson?.[`sieve_${key}`]; if (!sp) return null
    const parts = []
    if (sp.min != null && sp.min !== '') parts.push(`≥${sp.min}%`)
    if (sp.max != null && sp.max !== '') parts.push(`≤${sp.max}%`)
    return parts.join(' ') || null
  }

  const isViolation = (key: string) => {
    const sp = specJson?.[`sieve_${key}`]
    if (!sp || totalG === 0) return false
    const pct = pcts[key]
    return (sp.min != null && sp.min !== '' && pct < parseFloat(sp.min)) ||
           (sp.max != null && sp.max !== '' && pct > parseFloat(sp.max))
  }

  return (
    <div className="flex gap-3">
      <div className="flex-1 overflow-x-auto rounded-xl border border-surface-rule">
        {hasErr && <div className="text-[10px] text-err px-3 py-1.5 bg-err/5">⚠ All fractions required</div>}
        <table className="w-full text-left" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr className="text-white" style={{ background: '#1f4e79' }}>
              {['Frac.','g','%','Spec'].map(h => <th key={h} className="px-2 py-2 font-semibold text-center first:text-left">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {GRANULE_SIEVES.map(s => {
              const vio  = isViolation(s.key)
              const isFoc = focusedSieve === s.key
              return (
                <tr key={s.key}
                  onClick={() => setFocusedSieve(s.key)}
                  className="border-b border-surface-rule cursor-pointer"
                  style={{ background: vio ? '#fef2f2' : isFoc ? '#eff6ff' : 'transparent', outline: isFoc ? '2px solid #3b82f6' : 'none', outlineOffset: -1 }}>
                  <td className="px-2 py-1.5 font-bold text-text">{s.label}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: isFoc ? '#1d4ed8' : '#111827', background: isFoc ? '#dbeafe' : 'transparent' }}>
                    {grams[s.key] !== '' ? grams[s.key] : <span className="text-text-faint">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: vio ? 'var(--color-err)' : totalG > 0 ? 'var(--color-ok)' : 'var(--color-text-faint)', fontWeight: vio ? 700 : 400 }}>
                    {totalG > 0 ? pcts[s.key].toFixed(1) + '%' : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-center text-[9px] text-text-faint">{specForFrac(s.key) || '—'}</td>
                </tr>
              )
            })}
            <tr className="bg-surface font-bold">
              <td className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right font-mono">{totalG.toFixed(1)}</td>
              <td className="px-2 py-1.5 text-right font-mono" style={{ color: totalG > 0 ? 'var(--color-ok)' : 'var(--color-text-faint)' }}>{totalG > 0 ? '100%' : '—'}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="font-mono text-[9px] font-bold text-center" style={{ color: '#1f4e79' }}>
          {GRANULE_SIEVES.find(s => s.key === focusedSieve)?.label}
        </div>
        <GranuleNumKey
          value={grams[focusedSieve]}
          onChange={v => {
            // handled by parent via setFocusedSieve — parent must handle gram changes
          }}
        />
        <div className="text-[8px] text-text-faint text-center">↑↓ or click row</div>
      </div>
    </div>
  )
}

// ─── GranuleNewRunModal ───────────────────────────────────────────────────────

function GranuleNewRunModal({ specs, onSave, onClose }: { specs: any[]; onSave: (f: any) => void; onClose: () => void }) {
  const today = new Date().toISOString().split('T')[0]
  const qcNames = useQcNames()

  const [form, setForm] = useState<{
    batch_number: string; qc_name: string; production_date: string;
    type_grade: string; customer: string; is_cntp: boolean; reference_used: string;
    spec_id: number | null; spec_json: Record<string, any>
  }>({
    batch_number: '', qc_name: '', production_date: today,
    type_grade: '', customer: '', is_cntp: true, reference_used: '',
    spec_id: null, spec_json: {},
  })
  const [errors, setErrors] = useState<string[]>([])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  // Select a saved spec from the library — copies a snapshot into the run.
  function selectSpec(idStr: string) {
    const id = parseInt(idStr, 10)
    const spec = specs.find(s => s.id === id)
    if (!spec) { setForm(f => ({ ...f, spec_id: null, type_grade: '', customer: '', spec_json: {} })); return }
    const sieveSpecs: Record<string, any> = {}
    GRANULE_SIEVES.forEach(s => {
      const sp = spec.sieve_specs?.[s.key]
      sieveSpecs[`sieve_${s.key}`] = { min: sp?.min ?? '', max: sp?.max ?? '' }
    })
    setForm(f => ({
      ...f,
      spec_id: spec.id,
      type_grade: spec.type_grade,
      customer: spec.customer || '',
      spec_json: { moisture_max: spec.moisture_max ?? '', bd_min: spec.bd_min ?? '', bd_max: spec.bd_max ?? '', ...sieveSpecs },
    }))
  }

  function validate() {
    const errs: string[] = []
    if (!form.batch_number.trim()) errs.push('Batch Number')
    if (!form.qc_name.trim()) errs.push('Quality Controller')
    if (!form.production_date) errs.push('Production Date')
    if (!form.spec_id) errs.push('Specification')
    setErrors(errs)
    return errs.length === 0
  }

  function handleSave() {
    if (!validate()) return
    onSave(form)
  }

  const fieldErr = (name: string) => errors.includes(name)
  const sp = form.spec_json

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-xl shadow-menu my-auto">
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: '#1a3a2a' }}>
          <div className="text-white font-bold text-[15px]">🔶 New Granule Run</div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white text-[18px]">×</button>
        </div>
        <div className="p-5 space-y-4">
          {errors.length > 0 && (
            <div className="px-4 py-2.5 bg-err/8 border border-err/20 rounded-xl text-[11px] text-err">
              ⚠ Required: {errors.join(' · ')}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {([['Batch Number *','batch_number','text'],['Quality Controller *','qc_name','text'],['Production Date *','production_date','date']] as const).map(([label, key, type]) => (
              <div key={key}>
                <label className={`${lbl} ${fieldErr(label.replace(' *',''))?'text-err':''}`}>{label}</label>
                {key === 'qc_name' ? (
                  <QCNameField value={form.qc_name} onChange={v => set('qc_name', v)} names={qcNames}
                    className={`${inp} w-full ${fieldErr('Quality Controller')?'border-err/40':''}`} />
                ) : (
                  <input type={type} value={(form as any)[key]} onChange={e => set(key, e.target.value)}
                    className={`${inp} w-full ${fieldErr(label.replace(' *',''))?'border-err/40':''}`} />
                )}
              </div>
            ))}
            <div className="col-span-2">
              <label className={`${lbl} ${fieldErr('Specification')?'text-err':''}`}>Specification *</label>
              <select value={form.spec_id ?? ''} onChange={e => selectSpec(e.target.value)}
                className={`${inp} w-full ${fieldErr('Specification')?'border-err/40':''}`}>
                <option value="">— Select a saved specification —</option>
                {specs.map(s => <option key={s.id} value={s.id}>{s.type_grade}{s.customer ? ` — ${s.customer}` : ''}</option>)}
              </select>
              {specs.length === 0 && (
                <div className="text-[11px] text-warn mt-1">No specifications saved yet — add one in the Specifications tab first.</div>
              )}
            </div>
            <div className="col-span-2">
              <label className={lbl}>Reference Used</label>
              <input value={form.reference_used} onChange={e => set('reference_used', e.target.value)}
                placeholder="e.g. REF-2024-001" className={`${inp} w-full`} />
            </div>
          </div>

          {/* Product type */}
          <div className="flex items-center gap-6">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Product Type:</span>
            {([true, false] as const).map(v => (
              <label key={String(v)} className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold">
                <input type="radio" checked={form.is_cntp === v} onChange={() => set('is_cntp', v)} />
                {v ? '🏭 CNTP Granules' : '🤝 Contracted'}
              </label>
            ))}
          </div>

          {/* Selected specification (read-only — managed in the Specifications tab) */}
          {form.spec_id && (
            <div className="border-t border-surface-rule pt-4">
              <div className="font-mono text-[10px] uppercase tracking-wide text-brand font-bold mb-3">
                📐 Specification — {form.type_grade}{form.customer ? ` · ${form.customer}` : ''}
                <span className="text-text-faint font-normal normal-case ml-2">read-only · edit in the Specifications tab</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {([['Max Moisture (%)','moisture_max'],['Min Bulk Density','bd_min'],['Max Bulk Density','bd_max']] as const).map(([label, key]) => (
                  <div key={key}>
                    <label className={lbl}>{label}</label>
                    <div className={`${inp} w-full bg-surface text-text-muted`}>{(sp as any)[key] !== '' && (sp as any)[key] != null ? (sp as any)[key] : '—'}</div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-2">Sieve Specs (% min / max)</div>
              <div className="rounded-xl border border-surface-rule overflow-hidden">
                <table className="w-full text-left" style={{ fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="bg-surface border-b border-surface-rule">
                      {['Fraction','Min %','Max %'].map(h => <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase text-text-muted">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-rule">
                    {GRANULE_SIEVES.map((s, i) => {
                      const v = sp[`sieve_${s.key}`] || {}
                      return (
                        <tr key={s.key} className={i % 2 === 1 ? 'bg-surface/50' : ''}>
                          <td className="px-3 py-1.5 font-semibold">{s.label}</td>
                          <td className="px-3 py-1.5 text-center font-mono">{v.min !== '' && v.min != null ? v.min : '—'}</td>
                          <td className="px-3 py-1.5 text-center font-mono">{v.max !== '' && v.max != null ? v.max : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2 rounded-xl text-white text-[12px] font-bold" style={{ background: '#166534' }}>✓ Create Run</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── GranuleAddSampleModal ────────────────────────────────────────────────────

function GranuleAddSampleModal({ run, onSave, onClose }: { run: any; onSave: (f: any) => void; onClose: () => void }) {
  const qcNames = useQcNames()
  const prevSamples  = run.samples || []
  const lastSample   = prevSamples.length > 0 ? prevSamples[prevSamples.length - 1] : null
  const now          = new Date()

  const [form, setForm] = useState(() => ({
    sample_time:  `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
    sample_date:  now.toISOString().split('T')[0],
    qc_name:      now.getHours() >= 16 ? '' : (run.qc_name || ''),
    dryer_number: lastSample?.dryer_number || '',
    bulk_bag_serial: '', bag_number: '',
    sieving_done: true, moisture: '', bulk_density: '', dryer_temp: '',
    compares_to_ref: true, final_weight_ok: true,
    sieve_g: null as any, sieve_pct: null as any,
    bag_type: 'bulk', weight_1: '', weight_2: '', weight_3: '',
    dryer2_running: false, dryer2_moisture: '', dryer2_bulk_density: '', dryer2_dryer_temp: '',
  }))
  const [grams, setGrams]               = useState<Record<string,string>>(() => Object.fromEntries(GRANULE_SIEVES.map(s => [s.key, ''])))
  const [focusedSieve, setFocusedSieve] = useState(GRANULE_SIEVES[0].key)
  const [errors, setErrors]             = useState<string[]>([])
  const [warnings, setWarnings]         = useState<string[]>([])
  const [confirmAnomaly, setConfirmAnomaly] = useState(false)

  const isAfterShift = (() => { const [hh] = (form.sample_time || '').split(':').map(Number); return !isNaN(hh) && hh >= 16 })()
  const serialPrefix = buildSerialPrefix(form.sample_date)

  // ── Variation / outlier detection vs the other samples in this run ──
  // Flags moisture/BD/temp only when this run already has real spread AND
  // the new value sits >2.5 std away — same convention as pasteuriser.
  const outlierWarnings: string[] = (() => {
    const warns: string[] = []
    const checkField = (key: string, label: string, cur: any, stdFloor: number, unit = '') => {
      const n = parseFloat(cur); if (isNaN(n)) return
      const hist = prevSamples.map((s: any) => parseFloat(s[key])).filter((v: number) => !isNaN(v))
      const result = checkOutlier(n, hist, stdFloor)
      if (result?.flagged) warns.push(`${label}: ${n}${unit} far from run avg ${result.mean.toFixed(1)}${unit}`)
    }
    checkField('moisture', 'Moisture', form.moisture, 0.3, '%')
    checkField('bulk_density', 'Bulk Density', form.bulk_density, 5, '')
    checkField('dryer_temp', 'Dryer Temp', form.dryer_temp, 1.0, '°C')
    return warns
  })()

  const set = (k: string, v: any) => {
    setForm(f => {
      const next: any = { ...f, [k]: v }
      if (k === 'bag_number' || k === 'sample_date') {
        const prefix = buildSerialPrefix(k === 'sample_date' ? v : f.sample_date)
        const bag    = k === 'bag_number' ? v : f.bag_number
        next.bulk_bag_serial = bag !== '' ? `${prefix}${bag}` : ''
      }
      if (k === 'sieving_done' && !v) { next.sieve_g = null; next.sieve_pct = null }
      return next
    })
    if (k === 'sieving_done' && !v) setGrams(Object.fromEntries(GRANULE_SIEVES.map(s => [s.key, ''])))
  }

  const totalG = GRANULE_SIEVES.reduce((s, f) => s + (parseFloat(grams[f.key]) || 0), 0)
  const pcts: Record<string,number> = Object.fromEntries(
    GRANULE_SIEVES.map(f => { const g = parseFloat(grams[f.key]) || 0; return [f.key, totalG > 0 ? Math.round((g / totalG) * 1000) / 10 : 0] })
  )

  // Sync sieve_g/sieve_pct into form whenever grams change
  useEffect(() => {
    if (GRANULE_SIEVES.some(s => grams[s.key] !== '')) {
      setForm(f => ({ ...f, sieve_g: grams, sieve_pct: pcts }))
    }
  }, [grams])

  // Keyboard navigation for sieve numpad
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = e.key
      if (/^[0-9]$/.test(k) || k === '.') {
        setGrams(g => { const cur = String(g[focusedSieve] || ''); if (k === '.' && cur.includes('.')) return g; return { ...g, [focusedSieve]: cur + k } })
        e.preventDefault()
      } else if (k === 'Backspace') {
        setGrams(g => ({ ...g, [focusedSieve]: String(g[focusedSieve] || '').slice(0, -1) }))
        e.preventDefault()
      } else if (k === 'ArrowDown' || k === 'Tab') {
        const idx = GRANULE_SIEVES.findIndex(s => s.key === focusedSieve)
        setFocusedSieve(GRANULE_SIEVES[(idx + 1) % GRANULE_SIEVES.length].key); e.preventDefault()
      } else if (k === 'ArrowUp') {
        const idx = GRANULE_SIEVES.findIndex(s => s.key === focusedSieve)
        setFocusedSieve(GRANULE_SIEVES[(idx - 1 + GRANULE_SIEVES.length) % GRANULE_SIEVES.length].key); e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [focusedSieve])

  function validate() {
    const errs: string[] = []
    const warns: string[] = []
    if (!form.sample_date) errs.push('Date')
    if (!form.sample_time.trim()) errs.push('Time')
    if (isAfterShift && !form.qc_name.trim()) errs.push('QC Name (required after 16:00 shift change)')
    if (!form.dryer_number.trim()) errs.push('Dryer Number')
    if (!form.bag_number.trim()) errs.push('Bag Number')
    if (form.moisture === '' || form.moisture == null) errs.push('Moisture')
    if (form.bulk_density === '' || form.bulk_density == null) errs.push('Bulk Density')
    if (form.dryer_temp === '' || form.dryer_temp == null) errs.push('Dryer Temperature')
    if (form.sieving_done) {
      const anyFilled = GRANULE_SIEVES.some(s => grams[s.key] !== '')
      const allFilled = GRANULE_SIEVES.every(s => grams[s.key] !== '')
      if (!anyFilled) errs.push('Sieve Data (enter grams for all fractions)')
      else if (!allFilled) errs.push('Sieve Data (all fractions required)')
    }
    if (lastSample && form.sample_time && lastSample.sample_time) {
      const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
      if (toMins(form.sample_time) <= toMins(lastSample.sample_time))
        warns.push(`Time ${form.sample_time} is not after previous sample time ${lastSample.sample_time}`)
    }
    if (lastSample && form.bag_number !== '') {
      const prevBag = parseInt(extractBagNum(lastSample.bulk_bag_serial), 10)
      const thisBag = parseInt(form.bag_number, 10)
      if (!isNaN(prevBag) && !isNaN(thisBag) && thisBag < prevBag)
        warns.push(`Bag number ${thisBag} is lower than previous bag ${prevBag}`)
    }
    if (form.bag_type === 'bulk' && (form.weight_1 === '' || form.weight_1 == null)) errs.push('Bulk Bag Weight')
    if (form.bag_type === 'polyprop') {
      if (form.weight_1 === '' || form.weight_1 == null) errs.push('Polyprop Check 1')
      if (form.weight_2 === '' || form.weight_2 == null) errs.push('Polyprop Check 2')
      if (form.weight_3 === '' || form.weight_3 == null) errs.push('Polyprop Check 3')
    }
    if (form.dryer2_running) {
      if (form.dryer2_moisture === '' || form.dryer2_moisture == null) errs.push('Dryer 2 Moisture')
      if (form.dryer2_bulk_density === '' || form.dryer2_bulk_density == null) errs.push('Dryer 2 Bulk Density')
      if (form.dryer2_dryer_temp === '' || form.dryer2_dryer_temp == null) errs.push('Dryer 2 Temp')
    }
    setErrors(errs); setWarnings(warns)
    return errs.length === 0
  }

  function handleSave() {
    if (!validate()) return
    if (outlierWarnings.length > 0 && !confirmAnomaly) { alert('Please tick "Yes, these values are correct" before saving.'); return }
    const effectiveQcName = isAfterShift && form.qc_name.trim() ? form.qc_name : run.qc_name
    onSave({ ...form, qc_name: effectiveQcName, run_id: run.id, spec_json: run.spec_json })
  }

  const specForFrac = (key: string) => {
    const sp = run.spec_json?.[`sieve_${key}`]; if (!sp) return null
    const parts = []
    if (sp.min != null && sp.min !== '') parts.push(`≥${sp.min}%`)
    if (sp.max != null && sp.max !== '') parts.push(`≤${sp.max}%`)
    return parts.join(' ')
  }
  const isViolation = (key: string) => {
    const sp = run.spec_json?.[`sieve_${key}`]
    if (!sp || totalG === 0) return false
    const pct = pcts[key]
    return (sp.min != null && sp.min !== '' && pct < parseFloat(sp.min)) ||
           (sp.max != null && sp.max !== '' && pct > parseFloat(sp.max))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-2xl shadow-menu my-auto">
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: '#1f4e79' }}>
          <div>
            <div className="text-white font-bold text-[14px]">➕ Add Sample — {run.batch_number}</div>
            <div className="text-blue-200 text-[10px] mt-0.5">{run.type_grade} · {run.is_cntp ? 'CNTP' : 'Contracted'}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          {errors.length > 0 && <div className="px-4 py-2 bg-err/8 border border-err/20 rounded-xl text-[11px] text-err">⚠ {errors.join(' · ')}</div>}
          {warnings.length > 0 && <div className="px-4 py-2 bg-warn/8 border border-warn/30 rounded-xl text-[11px] text-warn">⚠ {warnings.join(' · ')}</div>}

          {/* Variation / outlier warnings — require explicit confirmation before saving */}
          {outlierWarnings.length > 0 && (
            <div className="px-4 py-3 bg-warn/8 border border-warn/40 rounded-xl">
              <div className="font-bold text-[12px] text-warn mb-1">⚠ Unusual variation — please double-check before saving</div>
              <ul className="list-disc pl-5 space-y-0.5 mb-2">
                {outlierWarnings.map((w, i) => <li key={i} className="text-[11px] text-warn">{w}</li>)}
              </ul>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-warn cursor-pointer">
                <input type="checkbox" checked={confirmAnomaly} onChange={e => setConfirmAnomaly(e.target.checked)} />
                Yes, these values are correct
              </label>
            </div>
          )}

          {/* After-shift QC */}
          {isAfterShift && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-warn/8 border border-warn/30 rounded-xl">
              <span className="text-[11px] font-bold text-warn whitespace-nowrap">🌙 After 16:00 — Night Shift QC Required</span>
              <QCNameField value={form.qc_name} onChange={v => set('qc_name', v)} names={qcNames}
                placeholder="Night shift QC name…"
                className={`${inp} flex-1 ${errors.some(e => e.startsWith('QC Name')) ? 'border-err/40' : 'border-warn/40'}`} />
            </div>
          )}

          {/* Basic fields */}
          <div className="grid grid-cols-3 gap-3">
            {([['Date *','sample_date','date',''],['Time *','sample_time','text','HH:MM'],['Dryer Number *','dryer_number','text','e.g. D1'],['Moisture (%) *','moisture','number','%'],['Bulk Density (cc/100g) *','bulk_density','number','cc/100g'],['Dryer Temp (°C) *','dryer_temp','number','°C']] as const).map(([label, key, type, ph]) => (
              <div key={key}>
                <label className={`${lbl} ${errors.some(e => e.startsWith(label.replace(' *',''))) ? 'text-err' : ''}`}>{label}</label>
                <input type={type} step="any" value={(form as any)[key]} placeholder={ph} onChange={e => set(key, e.target.value)}
                  className={`${inp} w-full ${errors.some(e => e.startsWith(label.replace(' *',''))) ? 'border-err/40' : ''}`} />
              </div>
            ))}
          </div>

          {/* Bag serial */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className={`${lbl} ${errors.some(e => e.startsWith('Bag Number')) ? 'text-err' : ''}`}>Bag Number *</label>
              <input type="number" min="1" step="1" value={form.bag_number}
                placeholder={lastSample ? `prev: ${extractBagNum(lastSample.bulk_bag_serial) || '—'}` : 'e.g. 7'}
                onChange={e => set('bag_number', e.target.value)}
                className={`${inp} w-full ${errors.some(e => e.startsWith('Bag Number')) ? 'border-err/40' : ''}`} />
            </div>
            <div>
              <label className={`${lbl} text-text-faint`}>Bulk Bag Serial (auto-filled)</label>
              <div className="px-3 py-1.5 bg-surface border border-surface-rule rounded-lg font-mono text-[12px]" style={{ color: form.bulk_bag_serial ? '#111827' : '#9ca3af' }}>
                {form.bulk_bag_serial || `${serialPrefix || 'DD.MM.'}…`}
              </div>
            </div>
          </div>

          {/* Bag Type & Weight */}
          <div className="bg-ok/5 border border-ok/20 rounded-xl p-4">
            <div className="font-bold text-[11px] text-ok mb-3">⚖️ Bag Type & Weight Check</div>
            <div className="flex gap-6 mb-3">
              {([['bulk','🛢 Bulk Bag (500 kg)'],['polyprop','📦 Polyprop Bag (20 kg)']] as const).map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold" style={{ color: form.bag_type === v ? 'var(--color-ok)' : 'var(--color-text)' }}>
                  <input type="radio" checked={form.bag_type === v} onChange={() => set('bag_type', v)} /> {l}
                </label>
              ))}
            </div>
            {form.bag_type === 'bulk' && (
              <div>
                <label className={`${lbl} ${errors.some(e => e.startsWith('Bulk Bag Weight')) ? 'text-err' : ''}`}>Bulk Bag Weight (kg) *</label>
                <input type="number" step="any" value={form.weight_1} onChange={e => set('weight_1', e.target.value)}
                  placeholder="e.g. 498.5" className={`${inp} w-36`} />
              </div>
            )}
            {form.bag_type === 'polyprop' && (
              <div className="grid grid-cols-3 gap-3">
                {(['weight_1','weight_2','weight_3'] as const).map((k, i) => (
                  <div key={k}>
                    <label className={lbl}>Check {i + 1} (kg) *</label>
                    <input type="number" step="any" value={form[k]} onChange={e => set(k, e.target.value)}
                      placeholder="e.g. 20.1" className={`${inp} w-full`} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Second Dryer */}
          <div className="bg-info/5 border border-info/20 rounded-xl p-4">
            <label className="flex items-center gap-2 cursor-pointer font-bold text-[11px] text-info mb-0">
              <input type="checkbox" checked={form.dryer2_running} onChange={e => set('dryer2_running', e.target.checked)} className="w-4 h-4 accent-brand" />
              🔧 Second Dryer Running
              <span className="text-[9px] font-normal text-text-muted">(sieving = composite from both dryers)</span>
            </label>
            {form.dryer2_running && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {([['Moisture % *','dryer2_moisture'],['BD (cc/100g) *','dryer2_bulk_density'],['Dryer Temp (°C) *','dryer2_dryer_temp']] as const).map(([label, key]) => (
                  <div key={key}>
                    <label className={`${lbl} ${errors.some(e => e.startsWith(label.replace(' *',''))) ? 'text-err' : ''}`}>{label}</label>
                    <input type="number" step="any" value={(form as any)[key]} onChange={e => set(key, e.target.value)} className={`${inp} w-full`} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Checkboxes */}
          <div className="flex gap-5 flex-wrap">
            {([['sieving_done','Sieving done'],['compares_to_ref','Compares to reference'],['final_weight_ok','Final product weight OK']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-[12px] font-medium">
                <input type="checkbox" checked={(form as any)[key]} onChange={e => set(key, e.target.checked)} className="w-4 h-4 accent-brand" />
                {label}
              </label>
            ))}
          </div>

          {/* Inline sieve */}
          {form.sieving_done && (
            <div className="bg-surface border border-surface-rule rounded-xl p-4">
              <div className="font-bold text-[12px] mb-3" style={{ color: '#1f4e79' }}>
                ⚖️ Sieve Fractions
                <span className="text-[9px] font-normal text-text-muted ml-2">Click row or ↑↓ to navigate · Type grams</span>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 overflow-x-auto rounded-xl border border-surface-rule">
                  <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr className="text-white" style={{ background: '#1f4e79' }}>
                        {['Frac.','g','%','Spec'].map(h => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {GRANULE_SIEVES.map(s => {
                        const vio  = isViolation(s.key)
                        const isFoc = focusedSieve === s.key
                        return (
                          <tr key={s.key} onClick={() => setFocusedSieve(s.key)}
                            className="border-b border-surface-rule cursor-pointer"
                            style={{ background: vio ? '#fef2f2' : isFoc ? '#eff6ff' : 'transparent', outline: isFoc ? '2px solid #3b82f6' : 'none', outlineOffset: -1 }}>
                            <td className="px-2 py-1.5 font-bold">{s.label}</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: isFoc ? '#1d4ed8' : '#111827', background: isFoc ? '#dbeafe' : 'transparent' }}>
                              {grams[s.key] !== '' ? grams[s.key] : <span className="text-text-faint">—</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono" style={{ color: vio ? 'var(--color-err)' : totalG > 0 ? 'var(--color-ok)' : 'var(--color-text-faint)', fontWeight: vio ? 700 : 400 }}>
                              {totalG > 0 ? pcts[s.key].toFixed(1) + '%' : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-center text-[9px] text-text-faint">{specForFrac(s.key) || '—'}</td>
                          </tr>
                        )
                      })}
                      <tr className="bg-surface font-bold">
                        <td className="px-2 py-1.5">Total</td>
                        <td className="px-2 py-1.5 text-right font-mono">{totalG.toFixed(1)}</td>
                        <td className="px-2 py-1.5 text-right font-mono" style={{ color: totalG > 0 ? 'var(--color-ok)' : 'var(--color-text-faint)' }}>{totalG > 0 ? '100%' : '—'}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="font-mono text-[9px] font-bold text-center" style={{ color: '#1f4e79' }}>
                    {GRANULE_SIEVES.find(s => s.key === focusedSieve)?.label}
                  </div>
                  <GranuleNumKey
                    value={grams[focusedSieve]}
                    onChange={v => setGrams(g => ({ ...g, [focusedSieve]: v }))}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
            <button onClick={handleSave} disabled={outlierWarnings.length > 0 && !confirmAnomaly}
              className="px-6 py-2 rounded-xl text-white text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: '#166534' }}>💾 Save Sample</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── GranuleEditSampleModal ───────────────────────────────────────────────────

function GranuleEditSampleModal({ sample, run, onSave, onClose }: { sample: any; run: any; onSave: (id: number, f: any) => void; onClose: () => void }) {
  const sp = run.spec_json || {}

  const [grams, setGrams]               = useState<Record<string,string>>(() => Object.fromEntries(GRANULE_SIEVES.map(s => [s.key, sample.sieve_g?.[s.key] ?? ''])))
  const [focusedSieve, setFocusedSieve] = useState(GRANULE_SIEVES[0].key)
  const [form, setForm]                 = useState({
    sample_time: sample.sample_time || '', sample_date: sample.sample_date || new Date().toISOString().split('T')[0],
    dryer_number: sample.dryer_number || '', bulk_bag_serial: sample.bulk_bag_serial || '',
    moisture: sample.moisture ?? '', bulk_density: sample.bulk_density ?? '', dryer_temp: sample.dryer_temp ?? '',
    sieving_done: sample.sieving_done !== false, compares_to_ref: sample.compares_to_ref !== false, final_weight_ok: sample.final_weight_ok !== false,
    qc_comment: sample.qc_comment || '',
  })
  const [saving, setSaving]  = useState(false)
  const [errors, setErrors]  = useState<string[]>([])
  const [confirmAnomaly, setConfirmAnomaly] = useState(false)

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const totalG = GRANULE_SIEVES.reduce((s, f) => s + (parseFloat(grams[f.key]) || 0), 0)
  const pcts   = Object.fromEntries(GRANULE_SIEVES.map(f => { const g = parseFloat(grams[f.key]) || 0; return [f.key, totalG > 0 ? Math.round((g / totalG) * 1000) / 10 : 0] }))

  // ── Variation / outlier detection vs the other samples in this run ──
  const otherSamples = (run.samples || []).filter((s: any) => s.id !== sample.id)
  const outlierWarnings: string[] = (() => {
    const warns: string[] = []
    const checkField = (key: string, label: string, cur: any, stdFloor: number, unit = '') => {
      const n = parseFloat(cur); if (isNaN(n)) return
      const hist = otherSamples.map((s: any) => parseFloat(s[key])).filter((v: number) => !isNaN(v))
      const result = checkOutlier(n, hist, stdFloor)
      if (result?.flagged) warns.push(`${label}: ${n}${unit} far from run avg ${result.mean.toFixed(1)}${unit}`)
    }
    checkField('moisture', 'Moisture', form.moisture, 0.3, '%')
    checkField('bulk_density', 'Bulk Density', form.bulk_density, 5, '')
    checkField('dryer_temp', 'Dryer Temp', form.dryer_temp, 1.0, '°C')
    return warns
  })()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = e.key
      if (/^[0-9]$/.test(k) || k === '.') {
        setGrams(g => { const cur = String(g[focusedSieve] || ''); if (k === '.' && cur.includes('.')) return g; return { ...g, [focusedSieve]: cur + k } }); e.preventDefault()
      } else if (k === 'Backspace') {
        setGrams(g => ({ ...g, [focusedSieve]: String(g[focusedSieve] || '').slice(0, -1) })); e.preventDefault()
      } else if (k === 'ArrowDown' || k === 'Tab') {
        const idx = GRANULE_SIEVES.findIndex(s => s.key === focusedSieve); setFocusedSieve(GRANULE_SIEVES[(idx + 1) % GRANULE_SIEVES.length].key); e.preventDefault()
      } else if (k === 'ArrowUp') {
        const idx = GRANULE_SIEVES.findIndex(s => s.key === focusedSieve); setFocusedSieve(GRANULE_SIEVES[(idx - 1 + GRANULE_SIEVES.length) % GRANULE_SIEVES.length].key); e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [focusedSieve])

  function validate() {
    const errs: string[] = []
    if (!form.sample_date) errs.push('Date')
    if (!form.sample_time.trim()) errs.push('Time')
    if (!form.dryer_number.trim()) errs.push('Dryer Number')
    if (!form.bulk_bag_serial.trim()) errs.push('Bulk Bag Serial')
    if (form.moisture === '' || form.moisture == null) errs.push('Moisture')
    if (form.bulk_density === '' || form.bulk_density == null) errs.push('Bulk Density')
    if (form.dryer_temp === '' || form.dryer_temp == null) errs.push('Dryer Temperature')
    if (form.sieving_done && !GRANULE_SIEVES.every(s => grams[s.key] !== '')) errs.push('Sieve Data (all fractions required)')
    setErrors(errs)
    return errs.length === 0
  }

  async function handleSave() {
    if (!validate()) return
    if (outlierWarnings.length > 0 && !confirmAnomaly) { alert('Please tick "Yes, these values are correct" before saving.'); return }
    setSaving(true)
    await onSave(sample.id, { ...form, sieve_g: form.sieving_done ? grams : {}, sieve_pct: form.sieving_done ? pcts : {}, run_id: sample.run_id, spec_json: sp })
    setSaving(false)
    onClose()
  }

  const specForFrac = (key: string) => {
    const sv = sp[`sieve_${key}`]; if (!sv) return null
    return [sv.min != null && sv.min !== '' ? `≥${sv.min}%` : '', sv.max != null && sv.max !== '' ? `≤${sv.max}%` : ''].filter(Boolean).join(' ') || null
  }
  const isViolation = (key: string) => {
    const sv = sp[`sieve_${key}`]; if (!sv || totalG === 0) return false
    const pct = pcts[key]
    return (sv.min != null && sv.min !== '' && pct < parseFloat(sv.min)) || (sv.max != null && sv.max !== '' && pct > parseFloat(sv.max))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[2000] flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-2xl shadow-menu my-auto">
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: '#1f4e79' }}>
          <div>
            <div className="text-white font-bold text-[14px]">✏️ Edit Sample — {run.batch_number}</div>
            <div className="text-blue-200 text-[10px] mt-0.5">{run.type_grade}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          {errors.length > 0 && <div className="px-4 py-2 bg-err/8 border border-err/20 rounded-xl text-[11px] text-err">⚠ Missing: {errors.join(' · ')}</div>}

          {/* Variation / outlier warnings — require explicit confirmation before saving */}
          {outlierWarnings.length > 0 && (
            <div className="px-4 py-3 bg-warn/8 border border-warn/40 rounded-xl">
              <div className="font-bold text-[12px] text-warn mb-1">⚠ Unusual variation — please double-check before saving</div>
              <ul className="list-disc pl-5 space-y-0.5 mb-2">
                {outlierWarnings.map((w, i) => <li key={i} className="text-[11px] text-warn">{w}</li>)}
              </ul>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-warn cursor-pointer">
                <input type="checkbox" checked={confirmAnomaly} onChange={e => setConfirmAnomaly(e.target.checked)} />
                Yes, these values are correct
              </label>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {([['Date *','sample_date','date'],['Time *','sample_time','text'],['Dryer Number *','dryer_number','text'],['Bulk Bag Serial *','bulk_bag_serial','text'],['Moisture (%) *','moisture','number'],['Bulk Density *','bulk_density','number'],['Dryer Temp (°C) *','dryer_temp','number']] as const).map(([label, key, type]) => (
              <div key={key}>
                <label className={`${lbl} ${errors.some(e => e.startsWith(label.replace(' *',''))) ? 'text-err' : ''}`}>{label}</label>
                <input type={type} step="any" value={(form as any)[key]} onChange={e => set(key, e.target.value)}
                  className={`${inp} w-full ${errors.some(e => e.startsWith(label.replace(' *',''))) ? 'border-err/40' : ''}`} />
              </div>
            ))}
          </div>
          <div className="flex gap-5 flex-wrap">
            {([['sieving_done','Sieving done'],['compares_to_ref','Compares to reference'],['final_weight_ok','Final product weight OK']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-[12px] font-medium">
                <input type="checkbox" checked={(form as any)[key]} onChange={e => set(key, e.target.checked)} className="w-4 h-4 accent-brand" />
                {label}
              </label>
            ))}
          </div>
          {form.sieving_done && (
            <div className="bg-surface border border-surface-rule rounded-xl p-4">
              <div className="font-bold text-[12px] mb-3" style={{ color: '#1f4e79' }}>⚖️ Sieve Fractions</div>
              <div className="flex gap-3">
                <div className="flex-1 overflow-x-auto rounded-xl border border-surface-rule">
                  <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr className="text-white" style={{ background: '#1f4e79' }}>{['Frac.','g','%','Spec'].map(h => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
                    <tbody>
                      {GRANULE_SIEVES.map(s => {
                        const vio = isViolation(s.key); const isFoc = focusedSieve === s.key
                        return (
                          <tr key={s.key} onClick={() => setFocusedSieve(s.key)} className="border-b border-surface-rule cursor-pointer"
                            style={{ background: vio ? '#fef2f2' : isFoc ? '#eff6ff' : 'transparent', outline: isFoc ? '2px solid #3b82f6' : 'none', outlineOffset: -1 }}>
                            <td className="px-2 py-1.5 font-bold">{s.label}</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: isFoc ? '#1d4ed8' : '#111827', background: isFoc ? '#dbeafe' : 'transparent' }}>{grams[s.key] !== '' ? grams[s.key] : <span className="text-text-faint">—</span>}</td>
                            <td className="px-2 py-1.5 text-right font-mono" style={{ color: vio ? 'var(--color-err)' : totalG > 0 ? 'var(--color-ok)' : 'var(--color-text-faint)', fontWeight: vio ? 700 : 400 }}>{totalG > 0 ? pcts[s.key].toFixed(1) + '%' : '—'}</td>
                            <td className="px-2 py-1.5 text-center text-[9px] text-text-faint">{specForFrac(s.key) || '—'}</td>
                          </tr>
                        )
                      })}
                      <tr className="bg-surface font-bold"><td className="px-2 py-1.5">Total</td><td className="px-2 py-1.5 text-right font-mono">{totalG.toFixed(1)}</td><td className="px-2 py-1.5 text-right font-mono" style={{ color: totalG > 0 ? 'var(--color-ok)' : 'var(--color-text-faint)' }}>{totalG > 0 ? '100%' : '—'}</td><td /></tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="font-mono text-[9px] font-bold" style={{ color: '#1f4e79' }}>{GRANULE_SIEVES.find(s => s.key === focusedSieve)?.label}</div>
                  <GranuleNumKey value={grams[focusedSieve]} onChange={v => setGrams(g => ({ ...g, [focusedSieve]: v }))} />
                </div>
              </div>
            </div>
          )}
          <div>
            <label className={lbl}>💬 QC Comment</label>
            <textarea value={form.qc_comment} onChange={e => set('qc_comment', e.target.value)} rows={2} placeholder="Optional — notes, observations, actions taken…" className={`${inp} w-full resize-y`} />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
            <button onClick={handleSave} disabled={saving || (outlierWarnings.length > 0 && !confirmAnomaly)}
              className="px-6 py-2 rounded-xl text-white text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: '#1d4ed8' }}>{saving ? 'Saving…' : '✓ Save Changes'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── GranuleAddTastingModal ───────────────────────────────────────────────────

function GranuleAddTastingModal({ run, sampleId, onSave, onClose }: { run: any; sampleId: number | null; onSave: (f: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({ assessed_by: run.qc_name || '', granule_aroma: '', flavour_profile: '', briskness: '', strength: '', cup_colour: '', notes: '', pass_reject: 'Pass' })
  const [errors, setErrors] = useState<string[]>([])
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const errs: string[] = []
    if (!form.assessed_by.trim()) errs.push('Assessed By')
    GRANULE_TASTE_FIELDS.forEach(f => {
      if (!form[f.key as keyof typeof form] && form[f.key as keyof typeof form] !== 0) errs.push(f.label)
      else if (parseInt(form[f.key as keyof typeof form] as string) > 5) errs.push(`${f.label} cannot exceed 5`)
    })
    setErrors(errs)
    return errs.length === 0
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-lg shadow-menu my-auto">
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: '#78350f' }}>
          <div>
            <div className="text-white font-bold text-[14px]">🍵 Tasting Record — {run.batch_number}</div>
            {sampleId && <div className="text-yellow-200 text-[10px] mt-0.5">Linked to sample at {(run.samples || []).find((s: any) => s.id === sampleId)?.sample_time || `#${sampleId}`}</div>}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          {errors.length > 0 && <div className="px-4 py-2 bg-err/8 border border-err/20 rounded-xl text-[11px] text-err">⚠ Required: {errors.join(' · ')}</div>}
          <div>
            <label className={`${lbl} ${errors.includes('Assessed By') ? 'text-err' : ''}`}>Assessed By *</label>
            <input value={form.assessed_by} onChange={e => set('assessed_by', e.target.value)} className={`${inp} w-full ${errors.includes('Assessed By') ? 'border-err/40' : ''}`} />
          </div>
          <div className="rounded-xl border border-surface-rule overflow-hidden">
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr className="text-white" style={{ background: '#78350f' }}>
                {['Attribute','Score (1–5)','Description'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {GRANULE_TASTE_FIELDS.map((f, i) => {
                  const val  = parseInt(form[f.key as keyof typeof form] as string)
                  const desc = val >= 1 && val <= 5 ? SCORE_LABELS[f.key][val] : ''
                  const hasErr = errors.includes(f.label)
                  return (
                    <tr key={f.key} className={`border-b border-surface-rule ${i % 2 === 0 ? '' : 'bg-surface/50'}`}>
                      <td className="px-3 py-2 font-semibold">{f.label}{hasErr && <span className="text-err ml-1">*</span>}</td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min="1" max="5" value={form[f.key as keyof typeof form]}
                          onChange={e => { const v = e.target.value; if (v === '' || (parseInt(v) >= 1 && parseInt(v) <= 5)) set(f.key, v) }}
                          className="w-14 text-center font-bold text-[15px] border-2 rounded-lg px-1 py-1 outline-none"
                          style={{ borderColor: hasErr ? '#fca5a5' : val >= 1 && val <= 5 ? '#78350f' : '#d1d5db', color: scoreColor(form[f.key as keyof typeof form]) }} />
                      </td>
                      <td className="px-3 py-2 text-[10px]" style={{ color: scoreColor(form[f.key as keyof typeof form]), fontStyle: desc ? 'italic' : 'normal' }}>{desc || <span className="text-text-faint">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-surface rounded-xl text-[9px] text-text-muted border border-surface-rule">
            <span className="font-bold text-text">Guide: </span>1 = Poor · 2 = Below standard · 3 = Acceptable · 4 = Good · 5 = Excellent
          </div>
          <div>
            <label className={lbl}>Comments</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Observations, defects, actions…" className={`${inp} w-full resize-y`} />
          </div>
          <div className="flex items-center gap-6">
            <span className="font-bold text-[11px]">Result:</span>
            {(['Pass','Fail'] as const).map(v => (
              <label key={v} className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold" style={{ color: v === 'Pass' ? 'var(--color-ok)' : 'var(--color-err)' }}>
                <input type="radio" checked={form.pass_reject === v} onChange={() => set('pass_reject', v)} /> {v}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
            <button onClick={() => { if (validate()) onSave({ ...form, run_id: run.id, sample_id: sampleId || null }) }}
              className="px-6 py-2 rounded-xl text-white text-[12px] font-bold" style={{ background: '#166534' }}>✓ Save Tasting</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── GranuleInlineTastingRow ──────────────────────────────────────────────────

function GranuleInlineTastingRow({ tasting, colCount, rowBg, onSave }: { tasting: any; colCount: number; rowBg: string; onSave: (id: number, f: any) => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ assessed_by: tasting.assessed_by || '', granule_aroma: tasting.granule_aroma ?? '', flavour_profile: tasting.flavour_profile ?? '', briskness: tasting.briskness ?? '', strength: tasting.strength ?? '', cup_colour: tasting.cup_colour ?? '', notes: tasting.notes || '', pass_reject: tasting.pass_reject || 'Pass' })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => { setSaving(true); await onSave(tasting.id, form); setSaving(false); setEditing(false) }
  const scoreInput = (key: string) => (
    <input type="number" min="1" max="5" value={(form as any)[key]}
      onChange={e => { const v = e.target.value; if (v === '' || (parseInt(v) >= 1 && parseInt(v) <= 5)) set(key, v) }}
      className="w-11 text-center font-bold text-[12px] border rounded-md px-1 py-0.5 outline-none"
      style={{ borderColor: '#d97706', color: scoreColor((form as any)[key]) }} />
  )

  if (!editing) {
    return (
      <tr style={{ background: rowBg, borderBottom: '1px solid #f0e8e0' }}>
        <td colSpan={colCount} className="px-4 py-1.5 pl-9">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-bold min-w-[70px]" style={{ color: '#78350f' }}>🍵 {form.assessed_by}</span>
            {GRANULE_TASTE_FIELDS.map(f => (
              <span key={f.key} className="text-[10px]">
                <span className="text-text-faint text-[9px]">{f.short}: </span>
                <span className="font-bold" style={{ color: scoreColor((form as any)[f.key]) }}>{(form as any)[f.key] || '—'}</span>
              </span>
            ))}
            {form.notes && <span className="text-[10px] text-text-muted italic max-w-[200px] truncate overflow-hidden">"{form.notes}"</span>}
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${form.pass_reject === 'Pass' ? 'bg-ok/15 text-ok' : 'bg-err/15 text-err'}`}>{form.pass_reject}</span>
            <button onClick={() => setEditing(true)} className="text-[10px] px-2 py-0.5 rounded border border-surface-rule bg-surface-card cursor-pointer ml-auto">✏️ Edit</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr style={{ background: '#fef3c7', borderBottom: '2px solid #fcd34d' }}>
      <td colSpan={colCount} className="px-4 py-2 pl-9">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-text-muted font-semibold">Assessed By</label>
            <input value={form.assessed_by} onChange={e => set('assessed_by', e.target.value)} className="w-24 px-2 py-1 border rounded-md text-[11px] outline-none" style={{ borderColor: '#d97706' }} />
          </div>
          {GRANULE_TASTE_FIELDS.map(f => (
            <div key={f.key} className="flex flex-col gap-1 items-center">
              <label className="text-[9px] text-text-muted font-semibold whitespace-nowrap">{f.short}</label>
              {scoreInput(f.key)}
            </div>
          ))}
          <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
            <label className="text-[9px] text-text-muted font-semibold">Comments</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional…" className="px-2 py-1 border rounded-md text-[11px] outline-none w-full" style={{ borderColor: '#d97706' }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-text-muted font-semibold">Result</label>
            <div className="flex gap-3">
              {(['Pass','Fail'] as const).map(v => (
                <label key={v} className="flex items-center gap-1 cursor-pointer text-[11px] font-semibold" style={{ color: v === 'Pass' ? 'var(--color-ok)' : 'var(--color-err)' }}>
                  <input type="radio" checked={form.pass_reject === v} onChange={() => set('pass_reject', v)} /> {v}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-1 items-end pb-0.5">
            <button onClick={() => { setEditing(false); setForm({ assessed_by: tasting.assessed_by || '', granule_aroma: tasting.granule_aroma ?? '', flavour_profile: tasting.flavour_profile ?? '', briskness: tasting.briskness ?? '', strength: tasting.strength ?? '', cup_colour: tasting.cup_colour ?? '', notes: tasting.notes || '', pass_reject: tasting.pass_reject || 'Pass' }) }}
              className="text-[10px] px-2 py-1 rounded border border-surface-rule bg-surface-card cursor-pointer">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="text-[10px] px-3 py-1 rounded text-white font-bold cursor-pointer" style={{ background: '#166534' }}>{saving ? 'Saving…' : '✓ Save'}</button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ─── GranuleRecheckPanel ──────────────────────────────────────────────────────

function GranuleRecheckPanel({ sample, specMoistureMax, onSave }: { sample: any; specMoistureMax: any; onSave: (id: number, f: any) => void }) {
  const already = sample.recheck_done
  const [open, setOpen]         = useState(false)
  const [moisture, setMoisture] = useState(sample.recheck_moisture ?? '')
  const [temp, setTemp]         = useState(sample.recheck_dryer_temp ?? '')
  const [time, setTime]         = useState(sample.recheck_time ?? (() => { const now = new Date(); return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}` })())
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    if (open && already) { setMoisture(sample.recheck_moisture ?? ''); setTemp(sample.recheck_dryer_temp ?? ''); setTime(sample.recheck_time ?? '') }
  }, [open])

  const recheckPass = moisture !== '' && specMoistureMax != null ? parseFloat(moisture) <= parseFloat(specMoistureMax) : null
  const canSave     = moisture !== '' && temp !== '' && time !== ''

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    await onSave(sample.id, { recheck_done: true, recheck_moisture: parseFloat(moisture), recheck_dryer_temp: parseFloat(temp), recheck_time: time, recheck_pass: recheckPass })
    setSaving(false); setOpen(false)
  }

  return (
    <div className="px-4 py-2 border-l-[3px]" style={{ borderColor: '#f59e0b' }}>
      {!open ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold text-warn">⚠ Moisture out of spec</span>
          {already ? (
            <>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${sample.recheck_pass ? 'bg-ok/15 text-ok' : 'bg-err/15 text-err'}`}>
                🔁 Re-check: {sample.recheck_moisture}% @ {sample.recheck_time} · {sample.recheck_pass ? '✓ PASS' : '✗ FAIL — add new sample'}
              </span>
              {!sample.recheck_pass && <span className="text-[9px] text-text-muted italic">Re-check failed — please add a new sample</span>}
              <button onClick={() => setOpen(true)} className="text-[10px] px-2 py-0.5 rounded border border-surface-rule bg-surface-card cursor-pointer">✏️ Edit</button>
            </>
          ) : (
            <button onClick={() => setOpen(true)} className="text-[10px] px-2.5 py-0.5 rounded border font-bold cursor-pointer" style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#92400e' }}>+ Add Re-check</button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold text-warn whitespace-nowrap">🔁 Re-check</span>
          {[['Time', time, setTime, 'text', '09:30', 64],['Moisture %', moisture, setMoisture, 'number', specMoistureMax ? `max ${specMoistureMax}%` : '%', 90],['Dryer Temp °C', temp, setTemp, 'number', '°C', 90]].map(([label, val, setter, type, ph, w]) => (
            <div key={label as string} className="flex flex-col gap-1">
              <label className="text-[9px] text-text-muted font-semibold">{label as string}</label>
              <input type={type as string} step="any" value={val as string} placeholder={ph as string} onChange={e => (setter as any)(e.target.value)}
                className="px-2 py-1 border rounded-md text-[11px] outline-none"
                style={{ width: w as number, borderColor: label === 'Moisture %' && moisture !== '' && recheckPass === false ? '#fca5a5' : '#fcd34d', background: label === 'Moisture %' && recheckPass === false && moisture !== '' ? '#fef2f2' : label === 'Moisture %' && recheckPass === true ? '#f0fdf4' : '#fff' }} />
            </div>
          ))}
          {moisture !== '' && recheckPass !== null && (
            <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${recheckPass ? 'bg-ok/15 text-ok' : 'bg-err/15 text-err'}`}>{recheckPass ? '✓ PASS' : '✗ FAIL'}</span>
          )}
          <button onClick={() => { setOpen(false); if (already) { setMoisture(sample.recheck_moisture ?? ''); setTemp(sample.recheck_dryer_temp ?? ''); setTime(sample.recheck_time ?? '') } }}
            className="text-[10px] px-2 py-1 rounded border border-surface-rule bg-surface-card cursor-pointer">Cancel</button>
          <button onClick={handleSave} disabled={saving || !canSave}
            className="text-[10px] px-3 py-1 rounded text-white font-bold"
            style={{ background: canSave ? '#166534' : '#d1d5db', cursor: canSave ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : already ? '✓ Update Re-check' : '✓ Save Re-check'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── GranuleCommentBox ────────────────────────────────────────────────────────

function GranuleCommentBox({ sample, onSave }: { sample: any; onSave: (id: number, f: any) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText]       = useState(sample.qc_comment || '')
  const [saving, setSaving]   = useState(false)
  const taRef                 = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (editing && taRef.current) taRef.current.focus() }, [editing])

  const handleSave = async () => {
    if (text === (sample.qc_comment || '')) { setEditing(false); return }
    setSaving(true)
    await onSave(sample.id, { qc_comment: text })
    setSaving(false); setEditing(false)
  }

  if (!editing && !text) {
    return <button onClick={() => setEditing(true)} className="text-[10px] text-text-faint flex items-center gap-1 cursor-pointer bg-transparent border-none">💬 Add comment</button>
  }
  if (!editing) {
    return (
      <div className="flex items-start gap-2 max-w-[400px]">
        <span className="text-[11px]">💬</span>
        <span className="text-[11px] text-text italic leading-snug">{text}</span>
        <button onClick={() => setEditing(true)} className="text-[10px] text-text-faint cursor-pointer bg-transparent border-none">✏️</button>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] pt-1">💬</span>
      <div className="flex flex-col gap-1 flex-1 max-w-[420px]">
        <textarea ref={taRef} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave(); if (e.key === 'Escape') { setText(sample.qc_comment || ''); setEditing(false) } }}
          rows={2} placeholder="QC comment… (Ctrl+Enter to save, Esc to cancel)"
          className="px-3 py-2 border-2 rounded-lg text-[11px] resize-y font-mono outline-none leading-snug w-full"
          style={{ borderColor: '#6366f1' }} />
        <div className="flex gap-1">
          <button onClick={handleSave} disabled={saving} className="text-[10px] px-3 py-1 rounded border-none text-white font-bold cursor-pointer" style={{ background: '#4f46e5' }}>{saving ? 'Saving…' : '✓ Save'}</button>
          <button onClick={() => { setText(sample.qc_comment || ''); setEditing(false) }} className="text-[10px] px-2 py-1 rounded border border-surface-rule bg-surface-card cursor-pointer text-text-muted">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── GranuleEditSpecModal ─────────────────────────────────────────────────────

function GranuleEditSpecModal({ run, onSave, onClose }: { run: any; onSave: (id: number, spec: any) => void; onClose: () => void }) {
  const sp = run.spec_json || {}
  const [form, setForm] = useState<Record<string, any>>({
    moisture_max: sp.moisture_max ?? '', bd_min: sp.bd_min ?? '', bd_max: sp.bd_max ?? '',
    ...Object.fromEntries(GRANULE_SIEVES.map(s => [`sieve_${s.key}`, { min: sp[`sieve_${s.key}`]?.min ?? '', max: sp[`sieve_${s.key}`]?.max ?? '' }]))
  })
  const [saving, setSaving] = useState(false)

  const setScalar = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const setSieve  = (frac: string, bound: string, v: string) => setForm(f => ({ ...f, [`sieve_${frac}`]: { ...(f[`sieve_${frac}`] as any), [bound]: v } }))

  const handleSave = async () => {
    setSaving(true)
    const spec_json: any = {
      moisture_max: form.moisture_max !== '' ? parseFloat(form.moisture_max as string) : null,
      bd_min: form.bd_min !== '' ? parseFloat(form.bd_min as string) : null,
      bd_max: form.bd_max !== '' ? parseFloat(form.bd_max as string) : null,
    }
    GRANULE_SIEVES.forEach(s => {
      const sv = (form[`sieve_${s.key}`] as any)
      spec_json[`sieve_${s.key}`] = { min: sv.min !== '' ? parseFloat(sv.min) : null, max: sv.max !== '' ? parseFloat(sv.max) : null }
    })
    await onSave(run.id, spec_json)
    setSaving(false); onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/55 z-[2000] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-lg shadow-menu my-auto">
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl bg-brand">
          <div>
            <div className="text-white font-bold text-[14px]">📐 Edit Specifications — {run.batch_number}</div>
            <div className="text-blue-200 text-[10px] mt-0.5">Changes apply to this run only</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[['Max Moisture (%)','moisture_max'],['Min Bulk Density','bd_min'],['Max Bulk Density','bd_max']].map(([label, key]) => (
              <div key={key}>
                <label className={lbl}>{label}</label>
                <input type="number" step="any" value={(form as any)[key]} onChange={e => setScalar(key, e.target.value)} className={`${inp} w-full`} />
              </div>
            ))}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-2">Sieve Specs (% min / max)</div>
          <div className="rounded-xl border border-surface-rule overflow-hidden">
            <table className="w-full" style={{ fontSize: 11, borderCollapse: 'collapse' }}>
              <thead><tr className="bg-surface border-b border-surface-rule">{['Fraction','Min %','Max %'].map(h => <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase text-text-muted">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-surface-rule">
                {GRANULE_SIEVES.map((s, i) => (
                  <tr key={s.key} className={i % 2 === 1 ? 'bg-surface/50' : ''}>
                    <td className="px-3 py-1.5 font-semibold">{s.label}</td>
                    {(['min','max'] as const).map(b => (
                      <td key={b} className="px-2 py-1">
                        <input type="number" step="any" value={(form[`sieve_${s.key}`] as any)?.[b] ?? ''}
                          onChange={e => setSieve(s.key, b, e.target.value)} className={`${inp} text-center`} style={{ width: 80 }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-6 py-2 rounded-xl bg-brand text-white text-[12px] font-bold">{saving ? 'Saving…' : '✓ Save Specs'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── GranuleRunCard ───────────────────────────────────────────────────────────

interface RunCardProps {
  run: any; isAdmin: boolean
  onAddSample: (r: any) => void
  onAddTasting: (r: any, sid: number | null) => void
  onDelete: (id: number) => void
  onFinalise: (id: number, status: string, reason?: string) => void
  onUpdateSpec: (id: number, spec: any) => void
  onRecheckSample: (id: number, f: any) => void
  onEditSample: (id: number, f: any) => void
  onCommentSample: (id: number, f: any) => void
  onEditTasting: (id: number, f: any) => void
  onUpdateBatch: (id: number, bn: string) => void
  onAllocate: (id: number) => void
  onRecall: (id: number) => void
  canApprove: boolean
}

function GranuleRunCard({ run, isAdmin, onAddSample, onAddTasting, onDelete, onFinalise, onUpdateSpec, onRecheckSample, onEditSample, onCommentSample, onEditTasting, onUpdateBatch, onAllocate, onRecall, canApprove }: RunCardProps) {
  const [expanded, setExpanded]         = useState(true)
  const [editingSpec, setEditingSpec]   = useState(false)
  const [editingSample, setEditingSample] = useState<any>(null)
  const [editingBatch, setEditingBatch] = useState(false)
  const [batchDraft, setBatchDraft]     = useState(run.batch_number)
  const [batchSaving, setBatchSaving]   = useState(false)
  const [decisionResult, setDecisionResult] = useState<'Pass'|'Fail'|'Concession'|null>(null)

  const handleBatchSave = async () => {
    const trimmed = batchDraft.trim()
    if (!trimmed || trimmed === run.batch_number) { setEditingBatch(false); setBatchDraft(run.batch_number); return }
    setBatchSaving(true); await onUpdateBatch(run.id, trimmed); setBatchSaving(false); setEditingBatch(false)
  }

  const hasViolations = run.samples?.some((s: any) => (s.violations || []).length > 0)
  const status        = run.overall_status || 'Pending'
  const sp            = run.spec_json || {}
  const noTastings    = !run.tastings || run.tastings.length === 0
  const colCount      = 7 + GRANULE_SIEVES.length + 4

  return (
    <div className={`bg-surface-card rounded-xl mb-4 overflow-hidden border-2 ${hasViolations ? 'border-err/40' : 'border-surface-rule'}`}>
      {editingSpec && <GranuleEditSpecModal run={run} onSave={onUpdateSpec} onClose={() => setEditingSpec(false)} />}
      {editingSample && <GranuleEditSampleModal sample={editingSample} run={run} onSave={onEditSample} onClose={() => setEditingSample(null)} />}
      {decisionResult && (
        <LmDecisionModal
          result={decisionResult}
          batchLabel={run.batch_number}
          onClose={() => setDecisionResult(null)}
          onConfirm={comment => { onFinalise(run.id, decisionResult, comment); setDecisionResult(null) }}
        />
      )}

      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${hasViolations ? 'bg-err/5' : 'bg-surface'}`} onClick={() => setExpanded(e => !e)}>
        <span className="text-text-muted text-[13px] leading-none">{expanded ? '▼' : '▶'}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {editingBatch ? (
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <input value={batchDraft} onChange={e => setBatchDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleBatchSave(); if (e.key === 'Escape') { setEditingBatch(false); setBatchDraft(run.batch_number) } }}
                  autoFocus className="font-mono font-bold text-[13px] px-2 py-0.5 border-2 border-brand rounded-lg w-40 outline-none" />
                <button onClick={handleBatchSave} disabled={batchSaving} className="text-[10px] px-2 py-0.5 rounded border-none text-white font-bold" style={{ background: '#166534' }}>{batchSaving ? '…' : '✓'}</button>
                <button onClick={() => { setEditingBatch(false); setBatchDraft(run.batch_number) }} className="text-[10px] px-1.5 py-0.5 rounded border border-surface-rule bg-surface-card">✕</button>
              </div>
            ) : (
              <span onClick={e => { e.stopPropagation(); setEditingBatch(true) }} title="Click to edit batch number"
                className="font-mono font-bold text-[13px] cursor-pointer border-b border-dashed border-text-muted pb-0.5">{run.batch_number}</span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${status === 'Pass' ? 'bg-ok/15 text-ok' : status === 'Fail' ? 'bg-err/15 text-err' : 'bg-warn/15 text-warn'}`}>
              {status === 'Pass' ? '✓ PASS' : status === 'Fail' ? '✗ FAIL' : `⏳ ${status}`}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${run.is_cntp ? 'bg-info/15 text-info' : 'bg-purple-100 text-purple-700'}`}>{run.is_cntp ? 'CNTP' : 'Contracted'}</span>
          </div>
          <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-1 flex-wrap">
            <span>{run.type_grade}</span>
            {run.customer && <><span>·</span><span>{run.customer}</span></>}
            <span>·</span><span>{run.production_date}</span>
            <span>·</span><span>QC: {run.qc_name}</span>
            {run.reference_used && <><span>·</span><span className="font-semibold text-text">Ref: {run.reference_used}</span></>}
            <span>·</span><span>{run.samples?.length || 0} sample{run.samples?.length !== 1 ? 's' : ''}</span>
            <span>·</span><span>{run.tastings?.length || 0} tasting{run.tastings?.length !== 1 ? 's' : ''}</span>
            {hasViolations && <span className="font-bold text-err ml-1">⚠ Violations</span>}
          </div>
          {run.final_reason && (
            <div className="text-[10px] text-warn bg-warn/8 border border-warn/20 rounded-lg px-2 py-1 mt-1 inline-block">
              💬 <span className="font-semibold">Lab Manager comment:</span> {run.final_reason}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <button onClick={() => onAddSample(run)} title="Add when a new sample is taken during the current run" className="px-3 py-1.5 rounded-lg border border-surface-rule bg-surface-card text-[11px] font-semibold cursor-pointer">+ Sample</button>
          <button onClick={() => onAddTasting(run, null)} className="px-3 py-1.5 rounded-lg border border-surface-rule bg-surface-card text-[11px] font-semibold cursor-pointer">🍵 Tasting</button>
          {run.lm_status === 'awaiting_approval' ? (
            <>
              <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold border-2 border-warn/40 bg-warn/10 text-warn">
                ⏳ Awaiting Lab Manager{run.allocated_by ? ` · ${run.allocated_by}` : ''}
              </span>
              {canApprove ? (
                (['Pass', 'Fail', 'Concession'] as const).map(st => (
                  <button key={st} onClick={() => setDecisionResult(st)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border-2"
                    style={{ borderColor: st === 'Pass' ? '#166534' : st === 'Fail' ? '#dc2626' : '#d97706', background: st === 'Pass' ? '#f0fdf4' : st === 'Fail' ? '#fef2f2' : '#fffbeb', color: st === 'Pass' ? '#166534' : st === 'Fail' ? '#dc2626' : '#d97706' }}>
                    {st}
                  </button>
                ))
              ) : (
                <button onClick={() => onRecall(run.id)} className="px-3 py-1.5 rounded-lg border border-info/30 bg-info/8 text-info text-[11px] font-semibold cursor-pointer">↩ Recall to QC</button>
              )}
            </>
          ) : (
            <button
              onClick={() => { if (noTastings) { alert('Cannot allocate: at least one tasting record is required first.'); return } onAllocate(run.id) }}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
              style={{ border: noTastings ? '1px solid #d1d5db' : '1px solid #1f4e79', background: noTastings ? '#f3f4f6' : '#1f4e79', color: noTastings ? '#9ca3af' : '#fff', cursor: noTastings ? 'not-allowed' : 'pointer' }}
              title={noTastings ? 'Add at least one tasting before allocating' : 'Send to the Lab Manager for pass/fail approval'}>
              📤 Allocate to Lab Manager{noTastings ? ' 🍵?' : ''}
            </button>
          )}
          <button onClick={() => exportGranuleRun(run, GRANULE_SIEVES)} className="px-3 py-1.5 rounded-lg border border-ok/30 bg-ok/8 text-ok text-[11px] font-semibold cursor-pointer">⬇ Excel</button>
          {isAdmin && <button onClick={() => onDelete(run.id)} className="px-2 py-1.5 rounded-lg border-none bg-err/10 text-err text-[12px] cursor-pointer">🗑</button>}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          {/* Spec bar */}
          <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-xl border border-info/20 bg-info/5">
            <span className="font-mono text-[10px] uppercase tracking-wide text-info font-bold whitespace-nowrap">📐 SPECS</span>
            {[['Moist max', sp.moisture_max != null ? sp.moisture_max + '%' : '—'],['BD min', sp.bd_min ?? '—'],['BD max', sp.bd_max ?? '—'],
              ...GRANULE_SIEVES.map(s => {
                const sv = sp[`sieve_${s.key}`]
                return [s.label, sv ? [sv.min != null && sv.min !== '' ? `≥${sv.min}%` : '', sv.max != null && sv.max !== '' ? `≤${sv.max}%` : ''].filter(Boolean).join(' ') || '—' : '—']
              })
            ].map(([label, val]) => (
              <span key={label as string} className="text-[10px] whitespace-nowrap">
                <span className="text-text-muted font-semibold">{label}: </span>
                <span className="font-bold font-mono">{val as string}</span>
              </span>
            ))}
            <button onClick={() => setEditingSpec(true)} className="ml-auto px-2.5 py-1 rounded-lg border font-bold text-[10px] cursor-pointer" style={{ borderColor: '#0369a1', background: '#e0f2fe', color: '#0369a1' }}>✏️ Edit Specs</button>
          </div>

          {run.samples?.length === 0 && <div className="text-text-faint text-[11px] text-center py-4">No samples yet — click "+ Sample" to add</div>}

          {run.samples?.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-surface-rule">
              <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr className="text-white" style={{ background: '#1f4e79' }}>
                    {['Date','Time','Dryer','Bag Serial','Moisture %','BD (cc/100g)','Temp °C',...GRANULE_SIEVES.map(s => s.label),'Ref ✓','Wt ✓','Status',''].map(h => (
                      <th key={h} className="px-2 py-2 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                  {/* Spec limit row */}
                  <tr style={{ background: '#dbeafe', color: '#1e40af', fontSize: 10 }}>
                    <td className="px-2 py-1.5 font-bold">Spec</td><td /><td /><td />
                    <td className="px-2 py-1.5 text-center font-mono font-bold">{sp.moisture_max != null ? `≤${sp.moisture_max}%` : '—'}</td>
                    <td className="px-2 py-1.5 text-center font-mono font-bold">{sp.bd_min != null || sp.bd_max != null ? `${sp.bd_min != null ? `≥${sp.bd_min}` : ''}${sp.bd_min != null && sp.bd_max != null ? ' ' : ''}${sp.bd_max != null ? `≤${sp.bd_max}` : ''}` : '—'}</td>
                    <td />
                    {GRANULE_SIEVES.map(f => {
                      const sv = sp[`sieve_${f.key}`]
                      return <td key={f.key} className="px-1.5 py-1.5 text-center font-mono font-bold">
                        {sv ? [sv.min != null && sv.min !== '' ? `≥${sv.min}%` : '', sv.max != null && sv.max !== '' ? `≤${sv.max}%` : ''].filter(Boolean).join(' ') || '—' : '—'}
                      </td>
                    })}
                    <td /><td /><td /><td />
                  </tr>
                </thead>
                <tbody>
                  {run.samples.slice().reverse().map((s: any, i: number) => {
                    const vios       = s.violations || []
                    const moistVio   = sp.moisture_max && parseFloat(s.moisture) > parseFloat(sp.moisture_max)
                    return (
                      <Fragment key={s.id}>
                        <tr style={{ background: vios.length > 0 ? '#fef2f2' : i % 2 === 0 ? '#fff' : '#f9fafb', borderBottom: moistVio && !s.recheck_done ? 'none' : '1px solid #e5e7eb' }}>
                          <td className="px-2 py-2 font-mono text-[10px] text-text-muted whitespace-nowrap">{s.sample_date || '—'}</td>
                          <td className="px-2 py-2 font-semibold whitespace-nowrap">{s.sample_time || '—'}</td>
                          <td className="px-2 py-2 text-center">{s.dryer_number || '—'}</td>
                          <td className="px-2 py-2 font-mono text-[10px]">{s.bulk_bag_serial || '—'}</td>
                          <td className="px-2 py-2 text-center font-bold" style={{ color: moistVio ? 'var(--color-err)' : 'inherit' }}>{s.moisture ?? '—'}</td>
                          <td className="px-2 py-2 text-center">{s.bulk_density ?? '—'}</td>
                          <td className="px-2 py-2 text-center">{s.dryer_temp ?? '—'}</td>
                          {GRANULE_SIEVES.map(f => {
                            const pct = s.sieve_pct?.[f.key]; const sv = sp[`sieve_${f.key}`]
                            const vio = sv && pct != null && ((sv.min != null && pct < sv.min) || (sv.max != null && pct > sv.max))
                            return <td key={f.key} className="px-1.5 py-2 text-center font-mono" style={{ background: vio ? '#fef2f2' : '', color: vio ? 'var(--color-err)' : 'inherit', fontWeight: vio ? 700 : 400 }}>
                              {pct != null ? pct.toFixed(1) + '%' : '—'}
                            </td>
                          })}
                          <td className="px-2 py-2 text-center">{s.compares_to_ref ? '✓' : <span className="text-err">✗</span>}</td>
                          <td className="px-2 py-2 text-center">{s.final_weight_ok ? '✓' : <span className="text-err">✗</span>}</td>
                          <td className="px-2 py-2 text-center">
                            {vios.length > 0
                              ? <span title={vios.join(', ')} className="text-[9px] px-1.5 py-0.5 rounded-full bg-err/15 text-err font-bold cursor-help">⚠ {vios.length}</span>
                              : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-ok/15 text-ok font-bold">✓</span>}
                          </td>
                          <td className="px-2 py-2 text-center whitespace-nowrap">
                            <button onClick={() => setEditingSample(s)} className="text-[11px] px-1.5 py-0.5 rounded border border-surface-rule bg-surface-card cursor-pointer" title="Edit">✏️</button>
                          </td>
                        </tr>
                        {moistVio && (
                          <tr style={{ background: '#fffbeb' }}>
                            <td colSpan={colCount} className="p-0">
                              <GranuleRecheckPanel sample={s} specMoistureMax={sp.moisture_max} onSave={onRecheckSample} />
                            </td>
                          </tr>
                        )}
                        {/* Comment + weight + dryer2 + inline tastings */}
                        <tr style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <td colSpan={colCount} className="px-4 py-2 pl-7">
                            <div className="flex items-center gap-4 flex-wrap">
                              <GranuleCommentBox sample={s} onSave={onCommentSample} />
                              {s.bag_type && (
                                <span className="text-[9px] bg-surface px-2 py-0.5 rounded-full border border-surface-rule whitespace-nowrap">
                                  {s.bag_type === 'bulk' ? `🛢 Bulk: ${s.weight_1 ?? '—'} kg` : `📦 Polyprop: ${s.weight_1 ?? '—'} / ${s.weight_2 ?? '—'} / ${s.weight_3 ?? '—'} kg`}
                                </span>
                              )}
                              {s.dryer2_running && (
                                <span className="text-[9px] bg-info/10 text-info px-2 py-0.5 rounded-full border border-info/20 whitespace-nowrap">
                                  🔧 D2: {s.dryer2_moisture ?? '—'}% · {s.dryer2_bulk_density ?? '—'} cc/100g · {s.dryer2_dryer_temp ?? '—'}°C
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* Inline tastings — newest first */}
                        {(run.tastings || []).filter((t: any) => t.sample_id === s.id).slice().reverse().map((t: any, ti: number) => (
                          <GranuleInlineTastingRow key={t.id} tasting={t} colCount={colCount} rowBg={ti % 2 === 0 ? '#fdf8f5' : '#faf5f0'} onSave={onEditTasting} />
                        ))}
                        {/* Add tasting */}
                        <tr style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                          <td colSpan={colCount} className="px-4 py-1.5 pl-7">
                            <button onClick={() => onAddTasting(run, s.id)} className="text-[10px] px-2.5 py-1 rounded-lg font-semibold cursor-pointer" style={{ border: '1px solid #d97706', background: '#fef3c7', color: '#92400e' }}>🍵 Add Tasting</button>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── GranuleHistoryTab ────────────────────────────────────────────────────────

function GranuleHistoryTab({ runs, onReopen, onUpdateBatch }: { runs: any[]; onReopen: (id: number) => void; onUpdateBatch: (id: number, bn: string) => void }) {
  const [filterBatch, setFilterBatch]     = useState('')
  const [chartMetric, setChartMetric]     = useState('moisture')
  const [highlightPt, setHighlightPt]     = useState<any>(null)
  const [expandedRun, setExpandedRun]     = useState<number | null>(null)
  const [editingBatchId, setEditingBatchId] = useState<number | null>(null)
  const [batchDraft, setBatchDraft]       = useState('')
  const [batchSaving, setBatchSaving]     = useState(false)
  const [granHistTab, setGranHistTab]     = useState<'batches'|'bydate'>('batches')

  const finalisedRuns = runs.filter(r => !!r.final_status)
  const filtered      = filterBatch ? finalisedRuns.filter(r => r.batch_number.toLowerCase().includes(filterBatch.toLowerCase())) : finalisedRuns

  const runStats = (run: any) => {
    const samps = run.samples || []
    const avg   = (key: string) => { const v = samps.map((s: any) => parseFloat(s[key])).filter((v: number) => !isNaN(v)); return v.length ? v.reduce((a: number, b: number) => a + b, 0) / v.length : null }
    const avgS  = (key: string) => { const v = samps.map((s: any) => s.sieve_pct?.[key]).filter((v: any) => v != null); return v.length ? v.reduce((a: number, b: number) => a + b, 0) / v.length : null }
    const avgT  = (key: string) => { const v = (run.tastings || []).map((t: any) => parseFloat(t[key])).filter((v: number) => !isNaN(v)); return v.length ? v.reduce((a: number, b: number) => a + b, 0) / v.length : null }
    return {
      avg_moisture: avg('moisture'), avg_bd: avg('bulk_density'),
      sieve_avgs: Object.fromEntries(GRANULE_SIEVES.map(s => [s.key, avgS(s.key)])),
      taste_avgs: Object.fromEntries(GRANULE_TASTE_FIELDS.map(f => [f.key, avgT(f.key)])),
    }
  }

  const withStats = filtered.map(r => ({ ...r, ...runStats(r) }))

  const CHART_OPTIONS = [
    { value: 'moisture', label: 'Moisture %' },
    { value: 'bulk_density', label: 'Bulk Density' },
    ...GRANULE_SIEVES.map(s => ({ value: `sieve_${s.key}`, label: `Sieve ${s.label} %` })),
  ]
  const chartData: any[] = []
  filtered.slice().reverse().forEach(run => {
    (run.samples || []).forEach((s: any, i: number) => {
      const label = `${s.sample_date || run.production_date || ''} ${s.sample_time || ''}`.trim()
      let value = null
      if (chartMetric === 'moisture') value = parseFloat(s.moisture) || null
      else if (chartMetric === 'bulk_density') value = parseFloat(s.bulk_density) || null
      else value = s.sieve_pct?.[chartMetric.replace('sieve_', '')] ?? null
      if (value != null) chartData.push({ name: label, value, batch: run.batch_number, sampleIdx: i, runId: run.id })
    })
  })

  const handleBatchSave = async (runId: number) => {
    const trimmed = batchDraft.trim(); if (!trimmed) return
    setBatchSaving(true); await onUpdateBatch(runId, trimmed); setBatchSaving(false); setEditingBatchId(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <input placeholder="🔍 Filter by batch number…" value={filterBatch} onChange={e => setFilterBatch(e.target.value)} className={`${inp} w-56`} />
        <span className="text-[11px] text-text-muted">{filtered.length} finalised run{filtered.length !== 1 ? 's' : ''}</span>
        <div className="ml-auto flex gap-2">
          {([['batches','📋 Batch History'],['bydate','📅 By Date']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setGranHistTab(v)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
              style={{ border: granHistTab === v ? '1px solid #1a3a2a' : '1px solid #d1d5db', background: granHistTab === v ? '#1a3a2a' : '#f9fafb', color: granHistTab === v ? '#fff' : '#6b7280' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* By-date view */}
      {granHistTab === 'bydate' && (() => {
        const byDate: Record<string, any> = {}
        filtered.forEach(run => {
          const d = run.production_date || 'Unknown'
          if (!byDate[d]) byDate[d] = { batches: [], samps: [], tastings: [] }
          byDate[d].batches.push(run.batch_number)
          ;(run.samples || []).forEach((s: any) => byDate[d].samps.push(s))
          ;(run.tastings || []).forEach((t: any) => byDate[d].tastings.push(t))
        })
        const entries = Object.entries(byDate).sort(([a], [b]) => a < b ? -1 : 1)
        if (!entries.length) return <div className="text-text-faint text-center py-10 text-[12px]">No data</div>
        return (
          <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ background: '#1a3a2a' }} className="text-white">
                  {['Date','Batches','Samples','Avg Moisture %','Avg BD',...GRANULE_SIEVES.map(s => `Avg ${s.label}`),...GRANULE_TASTE_FIELDS.map(f => `Avg ${f.short}`)].map(h => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap text-[10px]">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-surface-rule">
                  {entries.map(([date, grp], i) => {
                    const numAvg = (k: string) => { const v = grp.samps.map((s: any) => parseFloat(s[k])).filter((n: number) => !isNaN(n)); return v.length ? parseFloat((v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(2)) : null }
                    const sieveAvgs = GRANULE_SIEVES.map(s => { const v = grp.samps.map((x: any) => x.sieve_pct?.[s.key]).filter((v: any) => v != null); return v.length ? parseFloat((v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(1)) : null })
                    const tasteAvgs = GRANULE_TASTE_FIELDS.map(f => { const v = grp.tastings.map((t: any) => parseFloat(t[f.key])).filter((n: number) => !isNaN(n)); return v.length ? parseFloat((v.reduce((a: number, b: number) => a + b, 0) / v.length).toFixed(1)) : null })
                    const avgM = numAvg('moisture'); const avgBD = numAvg('bulk_density')
                    return (
                      <tr key={date} className={i % 2 === 0 ? 'bg-surface-card' : 'bg-surface/50'}>
                        <td className="px-3 py-2 font-bold font-mono">{date}</td>
                        <td className="px-3 py-2 text-[10px] text-text-muted text-center">{grp.batches.length}</td>
                        <td className="px-3 py-2 text-center">{grp.samps.length}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold" style={{ color: avgM && avgM > 8.5 ? 'var(--color-err)' : 'var(--color-ok)' }}>{avgM != null ? avgM + '%' : '—'}</td>
                        <td className="px-3 py-2 text-center font-mono">{avgBD ?? '—'}</td>
                        {sieveAvgs.map((v, j) => <td key={j} className="px-2 py-2 text-center font-mono text-[10px]">{v != null ? v + '%' : '—'}</td>)}
                        {tasteAvgs.map((v, j) => <td key={j} className="px-2 py-2 text-center text-[10px]" style={{ color: v && v >= 4 ? 'var(--color-ok)' : v != null && v <= 2 ? 'var(--color-err)' : 'var(--color-text)', fontWeight: v != null ? 600 : 400 }}>{v ?? '—'}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {granHistTab === 'batches' && <>
        {/* Trend chart */}
        <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-bold text-[12px]">📈 Trend — individual samples</span>
            <select value={chartMetric} onChange={e => { setChartMetric(e.target.value); setHighlightPt(null) }} className={`${inp} text-[11px]`}>
              {CHART_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-[10px] text-text-faint">Click a point to identify it</span>
          </div>
          {chartData.length === 0
            ? <div className="text-text-faint text-center py-5 text-[11px]">No data yet</div>
            : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} onClick={(e: any) => { if (e?.activePayload?.[0]?.payload) { const p = e.activePayload[0].payload; setHighlightPt({ runId: p.runId, sampleIdx: p.sampleIdx, batch: p.batch }); setExpandedRun(p.runId) } }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 8, fill: '#6b7280' }} angle={-30} textAnchor="end" height={50} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload
                    return (
                      <div className="bg-surface-card border border-surface-rule rounded-xl p-3 text-[11px] shadow-menu">
                        <div className="font-bold text-text">{p.batch}</div>
                        <div className="text-text-muted">{p.name}</div>
                        <div className="font-bold text-ok mt-1">{CHART_OPTIONS.find(o => o.value === chartMetric)?.label}: {p.value?.toFixed(2)}</div>
                      </div>
                    )
                  }} />
                  <Line type="monotone" dataKey="value" stroke="#166534" strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, payload } = props
                      const isH = highlightPt && payload.runId === highlightPt.runId && payload.sampleIdx === highlightPt.sampleIdx
                      return <circle key={`dot-${payload.runId}-${payload.sampleIdx}`} cx={cx} cy={cy} r={isH ? 7 : 3} fill={isH ? '#1d4ed8' : '#166534'} stroke={isH ? '#fff' : '#166534'} strokeWidth={isH ? 2 : 1} />
                    }} />
                </LineChart>
              </ResponsiveContainer>
            )}
        </div>

        {/* Summary table */}
        <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr className="text-white" style={{ background: '#1f2937' }}>
                  {['Batch','Date','Type / Grade','Samples','Avg Moist %','Avg BD',...GRANULE_SIEVES.map(s => `Avg ${s.label}`),...GRANULE_TASTE_FIELDS.map(f => `Avg ${f.short}`),'Status',''].map(h => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {withStats.map((run: any, i: number) => {
                  const isExpanded = expandedRun === run.id
                  return (
                    <Fragment key={run.id}>
                      <tr className={`${i % 2 === 0 ? '' : 'bg-surface/50'} hover:bg-surface transition-colors`} style={{ outline: highlightPt?.runId === run.id ? '2px solid #3b82f6' : 'none', outlineOffset: -1 }}>
                        <td className="px-3 py-2.5 font-mono font-bold">
                          {editingBatchId === run.id ? (
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                              <input value={batchDraft} autoFocus onChange={e => setBatchDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleBatchSave(run.id); if (e.key === 'Escape') setEditingBatchId(null) }}
                                className="w-28 px-1.5 py-0.5 border-2 border-brand rounded font-mono font-bold text-[11px] outline-none" />
                              <button onClick={() => handleBatchSave(run.id)} disabled={batchSaving} className="text-[10px] px-1.5 rounded border-none text-white" style={{ background: '#166534' }}>{batchSaving ? '…' : '✓'}</button>
                              <button onClick={() => setEditingBatchId(null)} className="text-[10px] px-1 rounded border border-surface-rule bg-surface-card">✕</button>
                            </div>
                          ) : (
                            <span onClick={() => { setEditingBatchId(run.id); setBatchDraft(run.batch_number) }} className="cursor-pointer border-b border-dashed border-text-muted">{run.batch_number}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-text-muted whitespace-nowrap">{run.production_date}</td>
                        <td className="px-3 py-2.5 text-[10px]">{run.type_grade}</td>
                        <td className="px-3 py-2.5 text-center">
                          <button onClick={() => setExpandedRun(isExpanded ? null : run.id)} className="text-[10px] text-info font-bold cursor-pointer bg-transparent border-none">{run.samples?.length || 0} {isExpanded ? '▲' : '▼'}</button>
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono" style={{ color: run.spec_json?.moisture_max && run.avg_moisture > parseFloat(run.spec_json.moisture_max) ? 'var(--color-err)' : 'var(--color-text)' }}>
                          {run.avg_moisture != null ? run.avg_moisture.toFixed(2) + '%' : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono">{run.avg_bd != null ? run.avg_bd.toFixed(1) : '—'}</td>
                        {GRANULE_SIEVES.map(s => {
                          const sv = run.spec_json?.[`sieve_${s.key}`]; const val = run.sieve_avgs[s.key]
                          const outSpec = sv && val != null && ((sv.min != null && val < sv.min) || (sv.max != null && val > sv.max))
                          return <td key={s.key} className="px-2 py-2.5 text-center font-mono" style={{ color: outSpec ? 'var(--color-err)' : 'var(--color-text)', fontWeight: outSpec ? 700 : 400 }}>{val != null ? val.toFixed(1) + '%' : '—'}</td>
                        })}
                        {GRANULE_TASTE_FIELDS.map(f => (
                          <td key={f.key} className="px-2 py-2.5 text-center" style={{ color: run.taste_avgs[f.key] >= 4 ? 'var(--color-ok)' : run.taste_avgs[f.key] != null && run.taste_avgs[f.key] <= 2 ? 'var(--color-err)' : 'var(--color-text)' }}>
                            {run.taste_avgs[f.key] != null ? run.taste_avgs[f.key].toFixed(1) : '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${run.overall_status === 'Pass' ? 'bg-ok/15 text-ok' : 'bg-err/15 text-err'}`}>{run.overall_status || 'Pass'}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <button onClick={() => exportGranuleRun(run, GRANULE_SIEVES)} className="text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer mr-1" style={{ border: '1px solid #166534', background: '#f0fdf4', color: '#166534' }}>⬇ Excel</button>
                          <button onClick={() => onReopen(run.id)} className="text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer" style={{ border: '1px solid #d97706', background: '#fef3c7', color: '#92400e' }}>↩ Re-open</button>
                        </td>
                      </tr>
                      {isExpanded && run.samples?.length > 0 && (
                        <tr style={{ background: '#f8fafc' }}>
                          <td colSpan={6 + GRANULE_SIEVES.length + GRANULE_TASTE_FIELDS.length + 3} className="p-0 pl-6">
                            <div className="overflow-x-auto border-l-[3px] border-brand mb-1">
                              <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 10 }}>
                                <thead><tr style={{ background: '#1e3a5f' }} className="text-white">
                                  {['Date','Time','Bag Serial','Moisture %','Bulk Density','Temp °C',...GRANULE_SIEVES.map(s => s.label),'Status','QC Note'].map(h => <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
                                </tr></thead>
                                <tbody className="divide-y divide-surface-rule">
                                  {run.samples.map((s: any, si: number) => {
                                    const vios  = s.violations || []
                                    const sp2   = run.spec_json || {}
                                    const mVio  = sp2.moisture_max && parseFloat(s.moisture) > parseFloat(sp2.moisture_max)
                                    const isH   = highlightPt?.runId === run.id && highlightPt?.sampleIdx === si
                                    return (
                                      <tr key={s.id} style={{ background: isH ? '#dbeafe' : vios.length > 0 ? '#fef2f2' : si % 2 === 0 ? '#fff' : '#f8fafc', outline: isH ? '2px solid #3b82f6' : 'none' }}>
                                        <td className="px-2 py-1.5 font-mono text-[9px] text-text-muted">{s.sample_date || '—'}</td>
                                        <td className="px-2 py-1.5 font-semibold">{s.sample_time || '—'}</td>
                                        <td className="px-2 py-1.5 font-mono text-[9px]">{s.bulk_bag_serial || '—'}</td>
                                        <td className="px-2 py-1.5 text-center font-bold" style={{ color: mVio ? 'var(--color-err)' : 'inherit' }}>
                                          {s.moisture ?? '—'}{s.recheck_done && <span className="text-[8px] text-text-muted ml-1">→{s.recheck_moisture}%</span>}
                                        </td>
                                        <td className="px-2 py-1.5 text-center">{s.bulk_density ?? '—'}</td>
                                        <td className="px-2 py-1.5 text-center">{s.dryer_temp ?? '—'}</td>
                                        {GRANULE_SIEVES.map(f => {
                                          const pct = s.sieve_pct?.[f.key]; const sv = sp2[`sieve_${f.key}`]
                                          const vio = sv && pct != null && ((sv.min != null && pct < sv.min) || (sv.max != null && pct > sv.max))
                                          return <td key={f.key} className="px-1.5 py-1.5 text-center font-mono" style={{ color: vio ? 'var(--color-err)' : 'inherit', fontWeight: vio ? 700 : 400 }}>{pct != null ? pct.toFixed(1) + '%' : '—'}</td>
                                        })}
                                        <td className="px-2 py-1.5 text-center">
                                          {vios.length > 0 ? <span title={vios.join(', ')} className="text-[8px] px-1.5 py-0.5 rounded-full bg-err/15 text-err font-bold cursor-help">⚠{vios.length}</span>
                                            : <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-ok/15 text-ok font-bold">✓</span>}
                                        </td>
                                        <td className="px-2 py-1.5 text-[9px] text-text-muted max-w-[140px] truncate" title={s.qc_comment || ''}>{s.qc_comment || '—'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {withStats.length === 0 && <div className="text-text-faint text-center py-6 text-[11px]">No finalised runs yet</div>}
          </div>
        </div>
      </>}
    </div>
  )
}

// ─── GranuleSpecsTab ──────────────────────────────────────────────────────────

function GranuleSpecsTab({ isAdmin }: { isAdmin: boolean }) {
  const db = getDb()
  const [specs, setSpecs]         = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showNew, setShowNew]     = useState(false)
  const [filterGrade, setFilterGrade] = useState('')
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')

  const emptyForm = () => ({
    type_grade: '', customer: '', moisture_max: '', bd_min: '', bd_max: '',
    sieve_specs: Object.fromEntries(GRANULE_SIEVES.map(s => [s.key, { min: '', max: '' }])), notes: '',
  })

  const [form, setForm]           = useState<any>(emptyForm())
  const [editForm, setEditForm]   = useState<any>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await db.schema('qms').from('granule_specs').select('*').order('type_grade').order('customer')
    setSpecs(data ?? [])
    setLoading(false)
  }, [db])

  useEffect(() => { load() }, [load])

  const setF        = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const setSieve    = (key: string, b: string, v: string) => setForm((f: any) => ({ ...f, sieve_specs: { ...f.sieve_specs, [key]: { ...f.sieve_specs[key], [b]: v } } }))
  const setEF       = (k: string, v: any) => setEditForm((f: any) => ({ ...f, [k]: v }))
  const setEditSieve = (key: string, b: string, v: string) => setEditForm((f: any) => ({ ...f, sieve_specs: { ...(f.sieve_specs || {}), [key]: { ...(f.sieve_specs || {})[key], [b]: v } } }))

  async function handleSave() {
    if (!form.type_grade) { setErr('Type & Grade is required'); return }
    setSaving(true); setErr('')
    const { data, error } = await db.schema('qms').from('granule_specs').insert({ ...form, moisture_max: form.moisture_max || null, bd_min: form.bd_min || null, bd_max: form.bd_max || null }).select().single()
    if (error) {
      setErr(error.code === '23505'
        ? 'A specification for this grade & customer already exists — edit that one instead.'
        : error.message)
      setSaving(false); return
    }
    setSpecs(p => [...p, data]); setForm(emptyForm()); setShowNew(false); setSaving(false)
  }

  async function handleUpdate(id: number) {
    setSaving(true); setErr('')
    const { error } = await db.schema('qms').from('granule_specs').update({ ...editForm, moisture_max: editForm.moisture_max || null, bd_min: editForm.bd_min || null, bd_max: editForm.bd_max || null }).eq('id', id)
    if (error) { setErr(error.message); setSaving(false); return }
    setSpecs(p => p.map(s => s.id !== id ? s : { ...s, ...editForm })); setEditingId(null); setSaving(false)
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this specification?')) return
    await db.schema('qms').from('granule_specs').delete().eq('id', id)
    setSpecs(p => p.filter(s => s.id !== id))
  }

  const startEdit = (spec: any) => {
    setEditingId(spec.id)
    setEditForm({ type_grade: spec.type_grade, customer: spec.customer || '', moisture_max: spec.moisture_max ?? '', bd_min: spec.bd_min ?? '', bd_max: spec.bd_max ?? '', sieve_specs: spec.sieve_specs || {}, notes: spec.notes || '' })
  }

  const filtered = filterGrade ? specs.filter(s => s.type_grade === filterGrade) : specs

  const SpecForm = ({ f, sf, ss, submitLabel, onSubmit, onCancel }: any) => (
    <div className="bg-surface border border-surface-rule rounded-xl p-4 mb-4 space-y-4">
      {err && <div className="text-err text-[11px]">⚠ {err}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Type & Grade *</label>
          <select value={f.type_grade} onChange={e => sf('type_grade', e.target.value)} className={`${inp} w-full`}>
            <option value="">— Select grade —</option>
            {GRANULE_TYPE_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Customer <span className="text-text-faint font-normal normal-case">(blank = generic)</span></label>
          <input value={f.customer} onChange={e => sf('customer', e.target.value)} placeholder="e.g. Woolworths" className={`${inp} w-full`} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[['Max Moisture (%)','moisture_max'],['Min Bulk Density','bd_min'],['Max Bulk Density','bd_max']].map(([label, key]) => (
          <div key={key}>
            <label className={lbl}>{label}</label>
            <input type="number" step="any" value={f[key]} onChange={e => sf(key, e.target.value)} className={`${inp} w-full`} />
          </div>
        ))}
      </div>
      <div>
        <div className={`${lbl} mb-2`}>Sieve Specs (% min / max)</div>
        <div className="rounded-xl border border-surface-rule overflow-hidden">
          <table className="w-full" style={{ fontSize: 11, borderCollapse: 'collapse' }}>
            <thead><tr className="bg-surface border-b border-surface-rule">{['Fraction','Min %','Max %'].map(h => <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase text-text-muted">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-surface-rule">
              {GRANULE_SIEVES.map((s, i) => (
                <tr key={s.key} className={i % 2 === 1 ? 'bg-surface/50' : ''}>
                  <td className="px-3 py-1.5 font-semibold">{s.label}</td>
                  {(['min','max'] as const).map(b => (
                    <td key={b} className="px-2 py-1">
                      <input type="number" step="any" value={f.sieve_specs?.[s.key]?.[b] ?? ''} onChange={e => ss(s.key, b, e.target.value)} className={`${inp} text-center`} style={{ width: 80 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <label className={lbl}>Notes</label>
        <textarea value={f.notes} onChange={e => sf('notes', e.target.value)} rows={2} className={`${inp} w-full resize-y`} />
      </div>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
        <button onClick={onSubmit} disabled={saving} className="px-5 py-2 rounded-xl text-white text-[12px] font-bold" style={{ background: '#166534' }}>{saving ? 'Saving…' : submitLabel}</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center flex-wrap">
        <span className="font-bold text-[12px]">📋 Granule Specifications</span>
        <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className={`${inp} text-[11px]`}>
          <option value="">All grades</option>
          {GRANULE_TYPE_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button onClick={() => { setShowNew(true); setErr('') }} className="ml-auto px-4 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold">+ New Spec</button>
      </div>

      {showNew && <SpecForm f={form} sf={setF} ss={setSieve} submitLabel="✓ Save Spec" onSubmit={handleSave} onCancel={() => { setShowNew(false); setErr(''); setForm(emptyForm()) }} />}

      {loading && <div className="text-text-muted text-center py-8 animate-pulse text-[12px]">Loading…</div>}
      {!loading && filtered.length === 0 && <div className="text-text-muted text-center py-8 text-[12px]">No specifications yet — click "+ New Spec"</div>}
      {!loading && filtered.map(spec => (
        <div key={spec.id} className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
          {editingId === spec.id ? (
            <div className="p-4">
              <div className="font-bold text-[12px] mb-3">✏️ Editing: {spec.type_grade}{spec.customer ? ` · ${spec.customer}` : ' (generic)'}</div>
              <SpecForm f={editForm} sf={setEF} ss={setEditSieve} submitLabel="✓ Update Spec" onSubmit={() => handleUpdate(spec.id)} onCancel={() => { setEditingId(null); setErr('') }} />
            </div>
          ) : (
            <div className="px-4 py-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1">
                  <span className="font-bold text-[12px]">{spec.type_grade}</span>
                  {spec.customer
                    ? <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-info/10 text-info font-bold">👤 {spec.customer}</span>
                    : <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-surface border border-surface-rule text-text-muted">Generic</span>}
                  <span className="ml-3 text-[10px] text-text-faint">Moisture ≤{spec.moisture_max ?? '—'}% · BD {spec.bd_min ?? '—'}–{spec.bd_max ?? '—'}</span>
                </div>
                <button onClick={() => startEdit(spec)} className="px-3 py-1 rounded-lg border border-surface-rule text-[11px] cursor-pointer">✏️ Edit</button>
                {isAdmin && <button onClick={() => handleDelete(spec.id)} className="px-2 py-1 rounded-lg border-none bg-err/10 text-err text-[11px] cursor-pointer">🗑</button>}
              </div>
              <div className="flex gap-2 flex-wrap">
                {GRANULE_SIEVES.map(s => {
                  const sp = spec.sieve_specs?.[s.key]
                  if (!sp || (sp.min === '' && sp.max === '')) return null
                  return (
                    <span key={s.key} className="text-[10px] px-2 py-0.5 rounded-full bg-ok/10 text-ok border border-ok/20">
                      {s.label}: {sp.min !== '' ? `≥${sp.min}%` : ''}{sp.min !== '' && sp.max !== '' ? ' ' : ''}{sp.max !== '' ? `≤${sp.max}%` : ''}
                    </span>
                  )
                })}
                {spec.notes && <span className="text-[10px] text-text-faint italic">{spec.notes}</span>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GranulePage() {
  const { p, session } = useAuth()
  const isAdmin    = p('can_delete_runs')
  const canApprove = p('can_approve_runs')
  const whoAmI     = () => session?.user?.email?.split('@')[0] || 'unknown'
  const db           = getDb()

  const [tab, setTab]                           = useState<'dashboard'|'history'|'specs'>('dashboard')
  const [runs, setRuns]                         = useState<any[]>([])
  const [specs, setSpecs]                       = useState<any[]>([])
  const [loading, setLoading]                   = useState(true)
  const [showNewRun, setShowNewRun]             = useState(false)
  const [sampleTarget, setSampleTarget]         = useState<any>(null)
  const [tastingTarget, setTastingTarget]       = useState<any>(null) // { run, sampleId }
  const [selectedRunId, setSelectedRunId]       = useState<number | null>(null)

  // ── Load runs, samples, tastings, and specs in parallel ──
  // Paginated — the duplicate-batch-number check depends on ALL history being
  // loaded, not just the newest page (PostgREST caps a single request at 1000 rows).
  const load = useCallback(async () => {
    setLoading(true)
    // qms is the single source (legacy public granule_* consolidated 2026-06-24)
    const [allRuns, allSamples, allTastings, allSpecs] = await Promise.all([
      fetchAllRows(db, 'granule_runs', q => q.order('created_at', { ascending: false })),
      fetchAllRows(db, 'granule_samples', q => q.order('sample_date', { ascending: true, nullsFirst: false }).order('sample_time', { ascending: true, nullsFirst: false })),
      fetchAllRows(db, 'granule_tastings', q => q.order('created_at', { ascending: true })),
      fetchAllRows(db, 'granule_specs', q => q.order('type_grade').order('customer')),
    ])

    const byRun: Record<number, any[]>     = {}
    const tastByRun: Record<number, any[]> = {}
    allSamples.forEach((s: any)  => { if (!byRun[s.run_id])     byRun[s.run_id]     = []; byRun[s.run_id].push(s) })
    allTastings.forEach((t: any) => { if (!tastByRun[t.run_id]) tastByRun[t.run_id] = []; tastByRun[t.run_id].push(t) })

    const assembled = allRuns.map((r: any) => ({
      ...r, samples: sortSamples(byRun[r.id] || []), tastings: tastByRun[r.id] || [],
    }))
    setRuns(assembled)
    setSpecs(allSpecs)
    setLoading(false)
  }, [db])

  useEffect(() => { load() }, [load])

  // ── CRUD handlers — all mirror Express server logic ──

  async function handleCreateRun(form: any) {
    const dup = runs.find((r: any) => normBatch(r.batch_number) === normBatch(form.batch_number))
    if (dup) {
      if (!dup.final_status) {
        alert(`⚠ A run for batch "${form.batch_number}" is already open.\n\nPlease add a sample to the existing run instead of starting a new one.`)
      } else {
        alert(`⚠ Batch "${form.batch_number}" already exists (finalised as ${dup.final_status}).\n\nPlease use a different batch number.`)
      }
      return
    }
    const { data, error } = await db.schema('qms').from('granule_runs').insert({
      batch_number: form.batch_number, qc_name: form.qc_name || '', production_date: form.production_date || '',
      type_grade: form.type_grade || '', customer: form.customer || '', is_cntp: form.is_cntp !== false,
      spec_json: form.spec_json || {}, reference_used: form.reference_used || '', overall_status: 'Pass',
    }).select().single()
    if (error) { alert(error.message); return }
    setRuns(prev => [{ ...data, samples: [], tastings: [] }, ...prev])
    setShowNewRun(false)
  }

  async function handleAddSample(form: any) {
    const violations = computeViolations(form, form.spec_json)
    const { data, error } = await db.schema('qms').from('granule_samples').insert({
      run_id: form.run_id, sample_time: form.sample_time || '', sample_date: form.sample_date || '',
      dryer_number: form.dryer_number || '', bulk_bag_serial: form.bulk_bag_serial || '',
      sieving_done: form.sieving_done !== false, moisture: form.moisture || null, bulk_density: form.bulk_density || null,
      dryer_temp: form.dryer_temp || null, compares_to_ref: form.compares_to_ref !== false, final_weight_ok: form.final_weight_ok !== false,
      sieve_g: form.sieve_g || {}, sieve_pct: form.sieve_pct || {}, violations,
      bag_type: form.bag_type || 'bulk', weight_1: form.weight_1 || null, weight_2: form.weight_2 || null, weight_3: form.weight_3 || null,
      dryer2_running: form.dryer2_running || false, dryer2_moisture: form.dryer2_moisture || null,
      dryer2_bulk_density: form.dryer2_bulk_density || null, dryer2_dryer_temp: form.dryer2_dryer_temp || null,
    }).select().single()
    if (error) { alert(error.message); return }
    if (violations.length > 0) {
      await db.schema('qms').from('granule_runs').update({ overall_status: 'Fail' }).eq('id', form.run_id)
    }
    setRuns(prev => prev.map(r => r.id !== form.run_id ? r : {
      ...r,
      samples: sortSamples([...(r.samples || []), data]),
      overall_status: violations.length > 0 ? 'Fail' : r.overall_status,
    }))
    setSampleTarget(null)
  }

  async function handleAddTasting(form: any) {
    const { data, error } = await db.schema('qms').from('granule_tastings').insert({
      run_id: form.run_id, sample_id: form.sample_id || null, assessed_by: form.assessed_by || '',
      tasting_time: form.tasting_time || '', granule_aroma: form.granule_aroma || null,
      flavour_profile: form.flavour_profile || null, briskness: form.briskness || null,
      strength: form.strength || null, cup_colour: form.cup_colour || null,
      notes: form.notes || '', pass_reject: form.pass_reject || 'Pass',
    }).select().single()
    if (error) { alert(error.message); return }
    setRuns(prev => prev.map(r => r.id !== form.run_id ? r : { ...r, tastings: [...(r.tastings || []), data] }))
    setTastingTarget(null)
  }

  async function handleDeleteRun(id: number) {
    if (!confirm('Delete this granule run and all its samples?')) return
    await db.schema('qms').from('granule_runs').delete().eq('id', id)
    setRuns(prev => prev.filter(r => r.id !== id))
  }

  // QC allocates a captured run to the Lab Manager for pass/fail approval.
  async function handleAllocateRun(id: number) {
    const run = runs.find(r => r.id === id)
    if (!run || (run.samples || []).length === 0) { alert('Add at least one sample before allocating to the Lab Manager.'); return }
    if (!confirm('Allocate this run to the Lab Manager for pass/fail approval?')) return
    const who = whoAmI(), at = new Date().toISOString()
    const { error } = await db.schema('qms').from('granule_runs').update({ lm_status: 'awaiting_approval', allocated_by: who, allocated_at: at }).eq('id', id)
    if (error) { alert(error.message); return }
    setRuns(prev => prev.map(r => r.id !== id ? r : { ...r, lm_status: 'awaiting_approval', allocated_by: who, allocated_at: at }))
  }

  // QC pulls a run back from the Lab Manager queue while unapproved.
  async function handleRecallRun(id: number) {
    const { error } = await db.schema('qms').from('granule_runs').update({ lm_status: null, allocated_by: null, allocated_at: null }).eq('id', id)
    if (error) { alert(error.message); return }
    setRuns(prev => prev.map(r => r.id !== id ? r : { ...r, lm_status: null, allocated_by: null, allocated_at: null }))
  }

  // Lab Manager / Quality Manager / IT approves the allocated run.
  async function handleFinaliseRun(id: number, status: string, reason = '') {
    const who = whoAmI()
    const { error } = await db.schema('qms').from('granule_runs').update({ final_status: status, overall_status: status, approved_by: who, final_reason: reason || null, lm_status: 'complete' }).eq('id', id)
    if (error) { alert('Failed to finalise run'); return }
    setRuns(prev => prev.map(r => r.id !== id ? r : { ...r, final_status: status, overall_status: status, approved_by: who, final_reason: reason || null, lm_status: 'complete' }))
  }

  async function handleRecheckSample(sampleId: number, recheckData: any) {
    const { data, error } = await db.schema('qms').from('granule_samples').update(recheckData).eq('id', sampleId).select().single()
    if (error) { alert(error.message); return }
    setRuns(prev => prev.map(r => ({ ...r, samples: (r.samples || []).map((s: any) => s.id === sampleId ? { ...s, ...data } : s) })))
  }

  async function handleReopenRun(id: number) {
    if (!confirm('Re-open this run? It will move back to the Run Dashboard for editing.')) return
    const { error } = await db.schema('qms').from('granule_runs').update({ final_status: null, overall_status: 'Pass' }).eq('id', id)
    if (error) { alert('Failed to re-open run'); return }
    setRuns(prev => prev.map(r => r.id !== id ? r : { ...r, final_status: null, overall_status: 'Pass' }))
  }

  async function handleUpdateBatch(runId: number, batchNumber: string) {
    const { error } = await db.schema('qms').from('granule_runs').update({ batch_number: batchNumber }).eq('id', runId)
    if (error) { alert('Failed to update batch number'); return }
    setRuns(prev => prev.map(r => r.id !== runId ? r : { ...r, batch_number: batchNumber }))
  }

  async function handleEditTasting(tastingId: number, form: any) {
    const { data, error } = await db.schema('qms').from('granule_tastings').update(form).eq('id', tastingId).select().single()
    if (error) { alert(error.message); return }
    setRuns(prev => prev.map(r => ({ ...r, tastings: (r.tastings || []).map((t: any) => t.id === tastingId ? { ...t, ...data } : t) })))
  }

  async function handleCommentSample(sampleId: number, data: any) {
    const { data: saved, error } = await db.schema('qms').from('granule_samples').update({ qc_comment: data.qc_comment }).eq('id', sampleId).select('qc_comment').single()
    if (error) { alert(error.message); return }
    setRuns(prev => prev.map(r => ({ ...r, samples: (r.samples || []).map((s: any) => s.id === sampleId ? { ...s, qc_comment: saved.qc_comment } : s) })))
  }

  async function handleEditSample(sampleId: number, form: any) {
    // Recompute violations against run spec (mirrors Express PATCH /api/granule/samples/:id)
    const run = runs.find(r => (r.samples || []).some((s: any) => s.id === sampleId))
    const spec = run?.spec_json || {}
    const violations = computeViolations(form, spec)
    const { data: saved, error } = await db.schema('qms').from('granule_samples').update({
      sample_time: form.sample_time || '', sample_date: form.sample_date || '', dryer_number: form.dryer_number || '',
      bulk_bag_serial: form.bulk_bag_serial || '', moisture: form.moisture || null, bulk_density: form.bulk_density || null,
      dryer_temp: form.dryer_temp || null, compares_to_ref: form.compares_to_ref !== false, final_weight_ok: form.final_weight_ok !== false,
      sieving_done: form.sieving_done !== false, sieve_g: form.sieve_g || {}, sieve_pct: form.sieve_pct || {}, violations,
      qc_comment: form.qc_comment || '',
    }).eq('id', sampleId).select().single()
    if (error) { alert(error.message); return }
    // Update run overall_status
    if (run) {
      const allVios = run.samples.map((s: any) => s.id === sampleId ? violations : (s.violations || []))
      const anyVio  = allVios.some((v: any) => v.length > 0)
      await db.schema('qms').from('granule_runs').update({ overall_status: anyVio ? 'Fail' : 'Pass' }).eq('id', run.id)
      setRuns(prev => prev.map(r => r.id !== run.id ? r : {
        ...r,
        samples: (r.samples || []).map((s: any) => s.id === sampleId ? { ...s, ...saved } : s),
        overall_status: anyVio ? 'Fail' : 'Pass',
      }))
    }
  }

  async function handleUpdateSpec(runId: number, spec_json: any) {
    const { error } = await db.schema('qms').from('granule_runs').update({ spec_json }).eq('id', runId)
    if (error) { alert('Failed to update specs'); return }
    setRuns(prev => prev.map(r => r.id !== runId ? r : { ...r, spec_json }))
  }

  const currentRuns   = runs.filter(r => !r.final_status)
  const finalisedRuns = runs.filter(r => !!r.final_status)
  const selectedRun   = currentRuns.find(r => r.id === selectedRunId) || currentRuns[0] || null

  // Warn the QC if there are already open runs before starting another.
  function openNewRun() {
    if (currentRuns.length > 0 &&
        !confirm(`⚠ There ${currentRuns.length === 1 ? 'is' : 'are'} already ${currentRuns.length} open granule run${currentRuns.length !== 1 ? 's' : ''}.\n\nAdd a sample to an existing run instead of starting a new one?\n\nClick OK to start a NEW run anyway, or Cancel to go back.`)) {
      return
    }
    setShowNewRun(true)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="bg-surface-card border-b border-surface-rule px-5 flex gap-0 overflow-x-auto flex-shrink-0">
        {([['dashboard','🏭 Run Dashboard'],['history','📊 History'],['specs','📋 Specifications']] as const).map(t => (
          <button key={t[0]} onClick={() => setTab(t[0])}
            className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t[0] ? 'border-brand text-brand' : 'border-transparent text-text-muted hover:text-text'}`}>
            {t[1]}
            {t[0] === 'dashboard' && currentRuns.length > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${tab === 'dashboard' ? 'bg-white/25 text-white' : 'bg-warn/15 text-warn'}`}>{currentRuns.length}</span>
            )}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-2.5 text-[11px] text-text-muted hover:text-text flex items-center gap-1">↻ Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 max-w-[1400px] w-full mx-auto">
        {loading ? (
          <div className="text-center py-16 text-text-muted text-[12px] animate-pulse">Loading granule runs…</div>
        ) : tab === 'dashboard' ? (
          <div className="space-y-4">
            {currentRuns.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warn/10 border border-warn/30">
                <span className="text-warn text-[16px]">⚠</span>
                <div>
                  <span className="font-bold text-[12px] text-warn">Granule line has {currentRuns.length} open run{currentRuns.length !== 1 ? 's' : ''}</span>
                  <span className="ml-2 text-[11px] text-text-muted">— finalise completed batches when done</span>
                </div>
              </div>
            )}

            {/* Batch selector — blocks (click to open), matching the pasteuriser layout */}
            <div className="flex gap-2 flex-wrap items-center">
              <button onClick={openNewRun} title="Start when a new batch has been completed or begun"
                className="px-4 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold">+ New Run</button>
              {currentRuns.length === 0 && (
                <span className="text-[12px] text-text-muted italic">No active runs — click "New Run" to start</span>
              )}
              {currentRuns.map(run => {
                const sel = selectedRun?.id === run.id
                const awaiting = run.lm_status === 'awaiting_approval'
                return (
                  <button key={run.id} onClick={() => setSelectedRunId(run.id)}
                    className={`px-3 py-1.5 rounded-xl border-2 text-[12px] font-semibold transition-colors ${sel ? 'border-brand bg-info/5 text-brand' : 'border-surface-rule bg-surface-card text-text-muted'}`}>
                    {run.batch_number}
                    <span className="ml-1 text-[9px] opacity-60">({(run.samples || []).length})</span>
                    <span className={`ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${awaiting ? 'bg-warn/15 text-warn' : 'bg-info/10 text-info'}`}>
                      {awaiting ? '⏳ Awaiting LM' : '🔶 In Progress'}
                    </span>
                  </button>
                )
              })}
            </div>

            {currentRuns.length === 0 ? (
              <div className="bg-surface-card border-2 border-dashed border-surface-rule rounded-xl p-10 text-center">
                <div className="text-[28px] mb-2">🔶</div>
                <div className="font-bold text-[13px] mb-1">No active runs</div>
                <div className="text-[11px] text-text-muted mb-4">Click "New Run" to start a granule production run</div>
                <button onClick={openNewRun} className="px-5 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold">+ New Run</button>
              </div>
            ) : selectedRun ? (
              <GranuleRunCard key={selectedRun.id} run={selectedRun} isAdmin={isAdmin}
                onAddSample={r => setSampleTarget(r)}
                onAddTasting={(r, sid) => setTastingTarget({ run: r, sampleId: sid })}
                onDelete={handleDeleteRun}
                onFinalise={handleFinaliseRun}
                onUpdateSpec={handleUpdateSpec}
                onRecheckSample={handleRecheckSample}
                onEditSample={handleEditSample}
                onCommentSample={handleCommentSample}
                onEditTasting={handleEditTasting}
                onUpdateBatch={handleUpdateBatch}
                onAllocate={handleAllocateRun}
                onRecall={handleRecallRun}
                canApprove={canApprove} />
            ) : null}
          </div>
        ) : tab === 'history' ? (
          <GranuleHistoryTab runs={runs} onReopen={handleReopenRun} onUpdateBatch={handleUpdateBatch} />
        ) : (
          <GranuleSpecsTab isAdmin={isAdmin} />
        )}
      </div>

      {/* Modals */}
      {showNewRun && <GranuleNewRunModal specs={specs} onSave={handleCreateRun} onClose={() => setShowNewRun(false)} />}
      {sampleTarget && <GranuleAddSampleModal run={sampleTarget} onSave={handleAddSample} onClose={() => setSampleTarget(null)} />}
      {tastingTarget && <GranuleAddTastingModal run={tastingTarget.run} sampleId={tastingTarget.sampleId} onSave={handleAddTasting} onClose={() => setTastingTarget(null)} />}
    </div>
  )
}
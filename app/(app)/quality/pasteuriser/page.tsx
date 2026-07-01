'use client'

// app/(app)/quality/pasteuriser/page.tsx
//
// Pasteuriser workcenter — exact feature parity with CNTPquality Express app.
//
// Tabs:
//   Run Dashboard  — active batch runs with hourly sample capture, spec checking, sensorial
//   History        — completed batch history with per-batch charts
//   Microbiology   — PDF upload + MicroDropZone + MicroTable
//   Residue        — PDF upload + ResidueTable
//   Heavy Metals   — TestTab (generic)
//   EtO            — TestTab
//   Aflatoxins     — TestTab
//   MOSH/MOAH      — TestTab
//   PAs            — PasteuriserPATab
//   Glyphosate     — TestTab + GlyphosateTable
//   Specifications — customer spec library
//
// Batch run data stored as JSON blob in qms.quality_records (workcenter=pasteuriser, workflow=pasteuriser_run)
// Lab results stored in qms.lab_results (test_type per tab, workcenter=pasteuriser)
// Customer specs read from qms.customer_specs
// PDF uploads go to Express /api/upload

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { isoDate, isoDateTime } from '@/lib/utils/formatDate'
import { checkOutlier } from '@/lib/utils/outliers'
import { useQcNames } from '@/lib/hooks/useQcNames'
import QCNameField from '@/components/shared/QCNameField'
import { exportPasteuriserBatch, exportPasteuriserBatches } from '@/lib/utils/exportExcel'
import {
  Plus, RefreshCw, Trash2, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, X, MessageSquare,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAST_SIEVE_COLS = [
  { key:'gt6',  label:'>6',   unit:'%' },
  { key:'gt10', label:'>10',  unit:'%' },
  { key:'gt12', label:'>12',  unit:'%' },
  { key:'gt16', label:'>16',  unit:'%' },
  { key:'gt20', label:'>20',  unit:'%' },
  { key:'gt60', label:'>60',  unit:'%' },
  { key:'dust', label:'Dust', unit:'%' },
]

const PACKAGING_OPTIONS = ['Bulk Bags (500 kg)', '18 kg Bags', 'Vacuum Sealed Boxes']

const SPEC_FAMILIES = ['Rooibos','Green Rooibos','Honeybush','Green Tea','Rosehips']
const SPEC_GRADES: Record<string,string[]> = {
  'Rooibos':       ['Super Grade','Super Fine Cut','Super Export','Fine Super Export','Long Cut','Short Cut','Choice','Espresso'],
  'Green Rooibos': ['Fine Cut','Long Cut'],
  'Honeybush':     ['Fine Cut'],
  'Green Tea':     ['Fine Cut'],
  'Rosehips':      ['Tea Bag Cut','Shell'],
}
const SPEC_VARIANTS = ['Conventional','Organic','RA-Conventional','RA-Organic']

const PAST_SPEC_DEFAULTS: Record<string,{min:number|null,max:number|null}> = {
  gt6:  { min:null, max:1 }, gt10: { min:null, max:1 }, gt12: { min:null, max:5 },
  gt16: { min:10,  max:20 }, gt20: { min:20,  max:35 }, gt60: { min:35,  max:50 },
  dust: { min:null, max:1 }, moisture: { min:null, max:8.5 }, untapped_bd: { min:280, max:340 },
  hourly_temp: { min: 85, max: null },
}

const PASS_COLORS: Record<string,[string,string,string]> = {
  Pass:       ['#f0fdf4','#166534','#86efac'],
  Fail:       ['#fee2e2','#991b1b','#fca5a5'],
  Concession: ['#fef9c3','#854d0e','#fcd34d'],
}

const CHART_COLORS: Record<string,string> = {
  '>6':'#6366f1','>10':'#f59e0b','>12':'#10b981','>16':'#ef4444',
  '>20':'#8b5cf6','>60':'#0ea5e9','Dust':'#9ca3af',
  'Moisture':'#f97316','BD (cc)':'#14b8a6',
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BatchSample {
  id:             string
  time:           string
  date:           string
  qc_name:        string
  serial_bin:     string
  hourly_temp:    string
  has_sieve:      boolean
  has_mb:         boolean
  gt6: string; gt10: string; gt12: string; gt16: string; gt20: string; gt60: string; dust: string
  gt6_g: string; gt10_g: string; gt12_g: string; gt16_g: string; gt20_g: string; gt60_g: string; dust_g: string
  moisture:       string
  untapped_bd:    string
  customer_bd:    string
  needle_count:   string
  compares_to_ref:string
  final_weight_1: string; final_weight_2: string; final_weight_3: string
  afternoon_qc?:  string
  has_sensorial:  boolean
  aroma: string; flavour_profile: string; briskness: string; strength: string; cup_colour: string
  cup_clarity:    string
  sensorial_pass: string
  sensorial_note: string
  comment:        string
}

interface Batch {
  id:              string
  _db_id?:         number
  batch_number:    string
  production_date: string
  product_family:  string
  grade:           string
  variant:         string
  type_grade:      string
  customer:        string
  packaging:       string
  qc_name:         string
  reference_batch: string
  comments:        string
  is_organic:      boolean
  batch_specs:     Record<string,any>
  _spec:           any
  samples:         BatchSample[]
  final_result?:   string
  finalised_at?:   string
  batch_status?:   string
  final_reason?:   string
  allocated_at?:   string
  allocated_by?:   string
  approved_by?:    string
  oos_flags?:      any[]
  created_at:      string
}

interface LabRecord {
  id:             number
  batch_no:       string | null
  test_type:      string | null
  lab_name:       string | null
  results:        Record<string,any> | null
  overall_status: string | null
  comment:        string | null
  created_at:     string
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const inp = 'px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-[12px] text-text bg-surface-card outline-none focus:border-accent'
const lbl = 'block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1'

function getPastSpec(custName: string, field: string, batchSpec: any, batchSpecsOverride: any) {
  // Priority 1: user-typed batch_specs from NewBatchModal (flat keys: gt6_min, gt6_max, etc.)
  if (batchSpecsOverride) {
    const MAP: Record<string,any> = {
      gt6:  {min:batchSpecsOverride.gt6_min,  max:batchSpecsOverride.gt6_max},
      gt10: {min:batchSpecsOverride.gt10_min, max:batchSpecsOverride.gt10_max},
      gt12: {min:batchSpecsOverride.gt12_min, max:batchSpecsOverride.gt12_max},
      gt16: {min:batchSpecsOverride.gt16_min, max:batchSpecsOverride.gt16_max},
      gt20: {min:batchSpecsOverride.gt20_min, max:batchSpecsOverride.gt20_max},
      gt60: {min:batchSpecsOverride.gt60_min, max:batchSpecsOverride.gt60_max},
      dust: {min:batchSpecsOverride.dust_min, max:batchSpecsOverride.dust_max},
      moisture:    {min:null, max:batchSpecsOverride.moisture_max},
      untapped_bd: {min:batchSpecsOverride.bd_min, max:batchSpecsOverride.bd_max},
      hourly_temp: {min:batchSpecsOverride.temp_min ?? 85, max:batchSpecsOverride.temp_max ?? null},
    }
    const v = MAP[field]
    if (v) {
      const minV = v.min !== '' && v.min != null ? Number(v.min) : null
      const maxV = v.max !== '' && v.max != null ? Number(v.max) : null
      if (minV != null || maxV != null) return { min:minV, max:maxV }
    }
  }
  // Priority 2: spec row loaded at batch creation (_spec)
  // Our qms.customer_specs stores sieve specs in sieve_specs JSONB: { gt6: {min,max}, ... }
  // but also supports flat columns for backward compat with migrated data
  if (batchSpec) {
    const sieveSpecs = batchSpec.sieve_specs ?? {}
    if (sieveSpecs[field]) {
      const sv = sieveSpecs[field]
      const minV = sv.min != null ? Number(sv.min) : null
      const maxV = sv.max != null ? Number(sv.max) : null
      if (minV != null || maxV != null) return { min:minV, max:maxV }
    }
    // Flat column fallback (original Express DB schema and migrated records)
    const flatMap: Record<string,any> = {
      gt6:  {min: batchSpec.gt6_min,  max: batchSpec.gt6_max},
      gt10: {min: batchSpec.gt10_min, max: batchSpec.gt10_max},
      gt12: {min: batchSpec.gt12_min, max: batchSpec.gt12_max},
      gt16: {min: batchSpec.gt16_min, max: batchSpec.gt16_max},
      gt20: {min: batchSpec.gt20_min, max: batchSpec.gt20_max},
      gt60: {min: batchSpec.gt60_min, max: batchSpec.gt60_max},
      dust: {min: batchSpec.dust_min, max: batchSpec.dust_max},
      moisture:    {min: null,                     max: batchSpec.moisture_max},
      untapped_bd: {min: batchSpec.bulk_density_min, max: batchSpec.bulk_density_max},
    }
    if (flatMap[field]) {
      const v = flatMap[field]
      const minV = v.min != null ? Number(v.min) : null
      const maxV = v.max != null ? Number(v.max) : null
      if (minV != null || maxV != null) return { min:minV, max:maxV }
    }
  }
  // Priority 3: defaults
  return PAST_SPEC_DEFAULTS[field] ?? null
}

// Normalises a batch number for duplicate comparison — case, whitespace and
// hyphen/underscore variants (e.g. "GS-0098" / "GS 0098" / "GS_0098") all
// collapse to the same key, so a duplicate can't slip through as "different".
function normBatch(b: string | null | undefined) {
  return (b ?? '').trim().toLowerCase().replace(/_/g, '-').replace(/\s*-\s*/g, '-')
}

function pastChk(value: any, spec: {min:number|null,max:number|null} | null): 'pass'|'fail'|'neutral' {
  if (!spec || value === '' || value == null) return 'neutral'
  const n = parseFloat(value); if (isNaN(n)) return 'neutral'
  if (spec.min != null && n < spec.min) return 'fail'
  if (spec.max != null && n > spec.max) return 'fail'
  return 'pass'
}

// Out-of-spec bag/box flags for a pasteuriser batch — used by the Lab Manager
// daily overview to point out which bag/box is out of spec, and on what.
export function computePastOosFlags(batch: any): { bag: string; time?: string; fails: { field: string; value: any; spec: any }[] }[] {
  const flags: { bag: string; time?: string; fails: { field: string; value: any; spec: any }[] }[] = []
  const cust = batch?.customer, spec = batch?._spec, ov = batch?.batch_specs
  for (const s of (batch?.samples ?? [])) {
    const fails: { field: string; value: any; spec: any }[] = []
    const mSpec  = getPastSpec(cust, 'moisture', spec, ov)
    if (pastChk(s.moisture, mSpec) === 'fail')      fails.push({ field: 'Moisture', value: s.moisture, spec: mSpec })
    const bdSpec = getPastSpec(cust, 'untapped_bd', spec, ov)
    if (pastChk(s.untapped_bd, bdSpec) === 'fail')  fails.push({ field: 'BD', value: s.untapped_bd, spec: bdSpec })
    if (s.has_sieve) for (const c of PAST_SIEVE_COLS) {
      const sp = getPastSpec(cust, c.key, spec, ov)
      if (pastChk((s as any)[c.key], sp) === 'fail') fails.push({ field: c.label, value: (s as any)[c.key], spec: sp })
    }
    if (fails.length) flags.push({ bag: s.serial_bin || `Sample ${s.id}`, time: s.time, fails })
  }
  return flags
}

function checkSieveOrder(row: any): Set<string> {
  const ordered = ['gt6','gt10','gt12','gt16','gt20','gt60']
  const violations = new Set<string>()
  for (let i = 0; i < ordered.length - 1; i++) {
    const cur  = parseFloat(row[ordered[i]])
    const next = parseFloat(row[ordered[i+1]])
    if (!isNaN(cur) && !isNaN(next) && cur > next) violations.add(ordered[i])
  }
  return violations
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-text-faint text-[11px]">—</span>
  const s = String(status).toUpperCase()
  const cls = s === 'PASS' || s === 'COMPLIES' ? 'badge-ok' : s === 'FAIL' ? 'badge-err' : s === 'REVIEW' ? 'badge-warn' : 'badge-gray'
  return <span className={`badge ${cls}`}>{status}</span>
}

function KpiCard({ label, value, color }: { label:string; value:string|number; color?:string }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
      <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">{label}</div>
      <div className={`font-display font-bold text-[28px] ${color ?? 'text-text'}`}>{value}</div>
    </div>
  )
}

// ─── PastSensorialPanel ───────────────────────────────────────────────────────

function PastSensorialPanel({ sample, onSave, onClose }: { sample:any; onSave:(d:any)=>void; onClose:()=>void }) {
  const [s, setS] = useState({
    aroma:           sample.aroma           ?? '',
    flavour_profile: sample.flavour_profile ?? '',
    briskness:       sample.briskness       ?? '',
    strength:        sample.strength        ?? '',
    cup_colour:      sample.cup_colour      ?? '',
    cup_clarity:     sample.cup_clarity     || 'Clear',
    sensorial_pass:  sample.sensorial_pass  || 'Pass',
    sensorial_note:  sample.sensorial_note  || '',
  })

  const Score = ({ field, label }: { field:string; label:string }) => (
    <div className="flex flex-col items-center gap-1">
      <label className="font-mono text-[10px] uppercase tracking-wide text-text-muted text-center">{label}</label>
      <div className="flex gap-1.5">
        {[1,2,3,4,5].map(n => (
          <button key={n} type="button" onClick={() => setS(p => ({ ...p, [field]: String(n) }))}
            className={`w-8 h-8 rounded-lg border-2 text-[13px] font-bold transition-colors ${String((s as any)[field]) === String(n) ? 'border-brand bg-brand text-white' : 'border-surface-rule bg-surface-card text-text-muted hover:border-brand/50'}`}>
            {n}
          </button>
        ))}
      </div>
      <div className="text-[9px] text-text-faint">1=Low 5=High</div>
    </div>
  )

  return (
    <div className="bg-ok/5 border-2 border-ok/30 rounded-xl p-4 mt-2">
      <div className="flex items-center justify-between mb-4">
        <span className="font-semibold text-[13px] text-ok">🍵 Sensorial Evaluation — {sample.time || 'sample'}</span>
        <button onClick={onClose} className="text-text-muted hover:text-text text-[18px] leading-none">×</button>
      </div>
      <div className="flex gap-5 flex-wrap justify-center mb-4">
        <Score field="aroma"           label="Rooibos Aroma" />
        <Score field="flavour_profile" label="Flavour Profile" />
        <Score field="briskness"       label="Briskness" />
        <Score field="strength"        label="Strength of Taste" />
        <Score field="cup_colour"      label="Cup Colour" />
      </div>
      <div className="flex gap-4 flex-wrap items-start mb-4">
        <div>
          <label className={lbl}>Cup Clarity</label>
          <div className="flex gap-2">
            {['Clear','Murky'].map(v => (
              <button key={v} type="button" onClick={() => setS(p => ({ ...p, cup_clarity: v }))}
                className={`px-4 py-1.5 rounded-lg border-2 text-[12px] font-semibold transition-colors ${s.cup_clarity === v ? 'border-brand bg-brand text-white' : 'border-surface-rule bg-surface-card text-text-muted'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={lbl}>Pass / Reject</label>
          <div className="flex gap-2">
            {['Pass','Reject'].map(v => (
              <button key={v} type="button" onClick={() => setS(p => ({ ...p, sensorial_pass: v }))}
                className={`px-4 py-1.5 rounded-lg border-2 text-[12px] font-semibold transition-colors ${s.sensorial_pass === v ? (v === 'Pass' ? 'border-ok bg-ok text-white' : 'border-err bg-err text-white') : 'border-surface-rule bg-surface-card text-text-muted'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className={lbl}>Notes</label>
          <input value={s.sensorial_note} onChange={e => setS(p => ({ ...p, sensorial_note: e.target.value }))}
            placeholder="Optional comment…" className={`${inp} w-full`} />
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="px-4 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
        <button onClick={() => onSave({ ...s, has_sensorial: true })}
          className="px-5 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold">💾 Save Sensorial</button>
      </div>
    </div>
  )
}

// ─── New Batch Modal ──────────────────────────────────────────────────────────

function NewBatchModal({ onSave, onClose }: { onSave:(b:any)=>void; onClose:()=>void }) {
  const { session } = useAuth()
  const db = getDb()
  const qcNames = useQcNames()
  // Upload goes to Next.js API route — no external service needed

  const [form, setForm] = useState({
    batch_number:'', production_date: format(new Date(),'yyyy-MM-dd'),
    product_family:'Rooibos', grade:'Super Grade', variant:'Conventional',
    customer:'', packaging:PACKAGING_OPTIONS[0], qc_name:'',
    reference_batch:'', comments:'', _saveToLibrary: false,
  })
  const [batchSpecs, setBatchSpecs] = useState({
    moisture_max:'', bd_min:'', bd_max:'',
    gt6_min:'',gt6_max:'',gt10_min:'',gt10_max:'',gt12_min:'',gt12_max:'',
    gt16_min:'',gt16_max:'',gt20_min:'',gt20_max:'',gt60_min:'',gt60_max:'',
    dust_min:'',dust_max:'',
  })
  const [specPreview, setSpec] = useState<any>(null)
  const [specLoading, setSpecL] = useState(false)
  const [err, setErr]           = useState('')

  // Load spec when product/grade/variant/customer changes
  useEffect(() => {
    if (!form.product_family || !form.grade || !form.variant) return
    setSpecL(true); setSpec(null)
    // Match original SQL: LOWER() case-insensitive, customer-specific preferred over generic
    db.schema('qms').from('customer_specs').select('*')
      .ilike('product_family', form.product_family)
      .ilike('grade', form.grade)
      .ilike('variant', form.variant)
      .then(({ data }: { data: any[] | null }) => {
        let spec = null
        if (data && data.length > 0) {
          // Exact match: same customer name (case-insensitive) → first priority
          // Generic (no customer) → second priority
          // Any remaining → last resort
          spec = data.find((s: any) =>
            (s.customer || '').toLowerCase() === (form.customer || '').toLowerCase()
          ) ?? data.find((s: any) => !s.customer || s.customer === '') ?? data[0]
        }
        setSpec(spec)
        if (spec) {
          // Support both JSONB sieve_specs and flat columns (migrated data)
          const ss = spec.sieve_specs ?? {}
          setBatchSpecs({
            moisture_max: spec.moisture_max ?? '',
            bd_min: spec.bulk_density_min ?? '', bd_max: spec.bulk_density_max ?? '',
            // JSONB first, flat column fallback
            gt6_min:  ss.gt6?.min  ?? spec.gt6_min  ?? '', gt6_max:  ss.gt6?.max  ?? spec.gt6_max  ?? '',
            gt10_min: ss.gt10?.min ?? spec.gt10_min ?? '', gt10_max: ss.gt10?.max ?? spec.gt10_max ?? '',
            gt12_min: ss.gt12?.min ?? spec.gt12_min ?? '', gt12_max: ss.gt12?.max ?? spec.gt12_max ?? '',
            gt16_min: ss.gt16?.min ?? spec.gt16_min ?? '', gt16_max: ss.gt16?.max ?? spec.gt16_max ?? '',
            gt20_min: ss.gt20?.min ?? spec.gt20_min ?? '', gt20_max: ss.gt20?.max ?? spec.gt20_max ?? '',
            gt60_min: ss.gt60?.min ?? spec.gt60_min ?? '', gt60_max: ss.gt60?.max ?? spec.gt60_max ?? '',
            dust_min: ss.dust?.min ?? spec.dust_min ?? '', dust_max: ss.dust?.max ?? spec.dust_max ?? '',
          })
        }
      })
      .finally(() => setSpecL(false))
  }, [form.product_family, form.grade, form.variant, form.customer])

  function save() {
    if (!form.batch_number.trim()) { setErr('Batch number is required'); return }
    const hasSpecs = batchSpecs.moisture_max !== '' || batchSpecs.bd_min !== '' || batchSpecs.bd_max !== '' ||
      ['gt6','gt10','gt12','gt16','gt20','gt60','dust'].some(k => (batchSpecs as any)[`${k}_min`] !== '' || (batchSpecs as any)[`${k}_max`] !== '')
    if (!hasSpecs) { setErr('Enter at least one spec value (moisture, BD, or sieve) before saving.'); return }
    onSave({ ...form, type_grade:`${form.product_family} ${form.grade}`, _spec: specPreview, batch_specs: batchSpecs })
  }

  const setSp = (k: string, v: string) => setBatchSpecs(p => ({ ...p, [k]: v }))
  const isOrganic = form.variant === 'Organic' || form.variant === 'RA-Organic'

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-2xl shadow-menu my-auto">
        <div className="flex items-center justify-between px-6 py-4 bg-brand rounded-t-2xl">
          <div className="text-white font-bold text-[15px]">🔬 New Pasteuriser Run</div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white">×</button>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Batch Number <span className="text-err">*</span></label>
              <input value={form.batch_number} onChange={e => setForm(p => ({ ...p, batch_number: e.target.value }))} className={`${inp} w-full`} placeholder="e.g. FP-0350" />
            </div>
            <div>
              <label className={lbl}>Production Date <span className="text-err">*</span></label>
              <input type="date" value={form.production_date} onChange={e => setForm(p => ({ ...p, production_date: e.target.value }))} className={`${inp} w-full`} />
            </div>
          </div>

          {/* Spec lookup panel */}
          <div className="bg-info/5 border border-info/20 rounded-xl p-4">
            <div className="font-mono text-[10px] uppercase tracking-wide text-info font-bold mb-3">📋 Product & Spec Lookup</div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[['Product Family','product_family',SPEC_FAMILIES],['Grade','grade',SPEC_GRADES[form.product_family]||[]],['Variant','variant',SPEC_VARIANTS]].map(([label,key,opts]) => (
                <div key={key as string}>
                  <label className={lbl}>{label as string}</label>
                  <select value={(form as any)[key as string]} onChange={e => {
                    if (key === 'product_family') { setForm(p => ({ ...p, product_family: e.target.value, grade: (SPEC_GRADES[e.target.value]??[])[0]??'' })) }
                    else setForm(p => ({ ...p, [key as string]: e.target.value }))
                  }} className={`${inp} w-full`}>
                    {(opts as string[]).map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="mb-3">
              <label className={`${lbl} text-info`}>👤 Customer Name <span className="text-text-muted font-normal normal-case">(optional — loads customer-specific spec)</span></label>
              <input value={form.customer} onChange={e => setForm(p => ({ ...p, customer: e.target.value }))}
                placeholder="e.g. Kunitaro — leave blank for generic spec" className={`${inp} w-full`} />
            </div>
            <div className="flex items-center gap-2 mb-3">
              <span className={`badge ${isOrganic ? 'badge-ok' : 'badge-info'}`}>{isOrganic ? '🌱 Organic' : '⚗️ Conventional'}{form.variant.startsWith('RA') ? ' · RA' : ''}</span>
              {specLoading && <span className="text-[11px] text-text-muted animate-pulse">Loading spec…</span>}
              {!specLoading && specPreview && <span className="text-[11px] text-ok font-semibold">✓ Spec loaded</span>}
              {!specLoading && !specPreview && <span className="text-[11px] text-warn">No spec found — enter manually below</span>}
            </div>

            {/* Editable batch specs */}
            <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-text text-surface-card text-[10px] font-mono uppercase tracking-wide font-bold flex justify-between">
                <span>📐 Batch Specifications</span>
                {specPreview && <span className="opacity-70 font-normal">Pre-filled from {form.product_family} {form.grade} · {form.variant}</span>}
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[['Moisture Max (%)','moisture_max'],['BD Min (cc/100g)','bd_min'],['BD Max (cc/100g)','bd_max']].map(([label,key]) => (
                    <div key={key}>
                      <label className={lbl}>{label}</label>
                      <input type="number" step="0.1" value={(batchSpecs as any)[key]} onChange={e => setSp(key,e.target.value)}
                        placeholder="—" className={`${inp} w-full text-center ${(batchSpecs as any)[key] ? 'bg-ok/5 border-ok/30' : ''}`} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className={`${lbl} mb-2`}>Sieve Specifications (%)</label>
                  <div className="overflow-x-auto rounded-xl border border-surface-rule">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="bg-surface border-b border-surface-rule">
                          {['Mesh','Min %','Max %'].map(h => <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase text-text-muted">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-rule">
                        {[['>6 mesh','gt6'],['>10 mesh','gt10'],['>12 mesh','gt12'],['>16 mesh','gt16'],['>20 mesh','gt20'],['>60 mesh','gt60'],['Dust','dust']].map(([label,key],i) => (
                          <tr key={key} className={i%2===1?'bg-surface/50':''}>
                            <td className="px-3 py-1.5 font-semibold text-text">{label}</td>
                            {['min','max'].map(mm => (
                              <td key={mm} className="px-2 py-1">
                                <input type="number" step="0.1" value={(batchSpecs as any)[`${key}_${mm}`]} onChange={e => setSp(`${key}_${mm}`, e.target.value)}
                                  placeholder="—" className={`${inp} w-full text-center ${(batchSpecs as any)[`${key}_${mm}`] ? 'bg-info/5 border-info/30' : ''}`} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Packaging</label>
              <select value={form.packaging} onChange={e => setForm(p => ({ ...p, packaging: e.target.value }))} className={`${inp} w-full`}>
                {PACKAGING_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>QC Controller</label>
              <QCNameField value={form.qc_name} onChange={v => setForm(p => ({ ...p, qc_name: v }))} names={qcNames} className={`${inp} w-full`} />
            </div>
            <div>
              <label className={lbl}>Reference Batch</label>
              <input value={form.reference_batch} onChange={e => setForm(p => ({ ...p, reference_batch: e.target.value }))} className={`${inp} w-full`} />
            </div>
          </div>

          <div>
            <label className={lbl}>Comments</label>
            <textarea value={form.comments} onChange={e => setForm(p => ({ ...p, comments: e.target.value }))} rows={2}
              className={`${inp} w-full resize-y`} />
          </div>

          {Object.values(batchSpecs).some(v => v !== '') && (
            <label className="flex items-center gap-2 px-4 py-3 bg-ok/5 border border-ok/20 rounded-xl text-[12px] text-ok cursor-pointer">
              <input type="checkbox" checked={form._saveToLibrary} onChange={e => setForm(p => ({ ...p, _saveToLibrary: e.target.checked }))} className="w-4 h-4 accent-ok" />
              <span className="font-semibold">Save these specs to the library for future batches</span>
            </label>
          )}

          {err && <div className="px-4 py-3 bg-err/8 border border-err/20 rounded-xl text-[12px] text-err">⚠ {err}</div>}

          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
            <button onClick={save} className="px-6 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold">Create Batch</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add/Edit Sample Modal ────────────────────────────────────────────────────

function AddSampleModal({ batch, sampleIndex, initialRow, onSave, onClose }: {
  batch:Batch; sampleIndex:number; initialRow?:BatchSample; onSave:(r:any)=>void; onClose:()=>void
}) {
  const qcNames  = useQcNames()
  const isOdd    = sampleIndex % 2 === 0
  const now      = new Date()
  const isEdit   = !!initialRow

  function blank(): any {
    return {
      time: format(now,'HH:mm'), date: format(now,'yyyy-MM-dd'),
      qc_name:'', serial_bin:'', hourly_temp:'', needle_count:'', compares_to_ref:'',
      gt6:'',gt10:'',gt12:'',gt16:'',gt20:'',gt60:'',dust:'',
      gt6_g:'',gt10_g:'',gt12_g:'',gt16_g:'',gt20_g:'',gt60_g:'',dust_g:'',
      moisture:'', untapped_bd:'', customer_bd:'',
      final_weight_1:'', final_weight_2:'', final_weight_3:'',
      afternoon_qc: now.getHours() >= 16 ? '' : undefined,
      has_sieve: isOdd, has_mb: true,
    }
  }

  const [row, setRow] = useState<any>(initialRow ? { ...blank(), ...initialRow } : blank())
  const set = (k: string, v: any) => setRow((p: any) => ({ ...p, [k]: v }))
  const spec = (field: string) => getPastSpec(batch.customer, field, batch._spec, batch.batch_specs)

  // Auto-calculate % from grams
  function calcPct(gKey: string, val: string) {
    const newRow = { ...row, [gKey]: val }
    const total = PAST_SIEVE_COLS.reduce((s,c) => { const g = parseFloat(newRow[c.key+'_g']); return s + (isNaN(g)?0:g) }, 0)
    if (total > 0) {
      const updates: any = { [gKey]: val }
      PAST_SIEVE_COLS.forEach(c => { const g = parseFloat(newRow[c.key+'_g']); if (!isNaN(g)) updates[c.key] = ((g/total)*100).toFixed(1) })
      setRow((p: any) => ({ ...p, ...updates }))
    } else { set(gKey, val) }
  }

  const total = PAST_SIEVE_COLS.reduce((s,c) => s + (parseFloat(row[c.key]) || 0), 0)
  const orderViolations = checkSieveOrder(row)

  // ── Variation / outlier detection vs the other samples in this batch ──
  // Flag a value only when the batch already has real spread (std > floor)
  // AND the new value sits >2.5 std away. Non-blocking, but requires an
  // explicit "confirm anyway" tick before saving — catches typos without
  // ever fully locking someone out of a genuinely unusual reading.
  const priorSamples = (batch.samples || []).filter((s:any) => s.id !== (initialRow as any)?.id)
  const anomalyWarnings: string[] = (() => {
    const warns: string[] = []
    const checkField = (key: string, label: string, cur: any, stdFloor: number, unit = '') => {
      const n = parseFloat(cur); if (isNaN(n)) return
      const hist = priorSamples.map((s:any) => parseFloat(s[key])).filter((v:number) => !isNaN(v))
      const result = checkOutlier(n, hist, stdFloor)
      if (result?.flagged) warns.push(`${label}: ${n}${unit} far from batch avg ${result.mean.toFixed(1)}${unit}`)
    }
    if (row.has_sieve) PAST_SIEVE_COLS.forEach(c => checkField(c.key, c.label, row[c.key], 1.0, '%'))
    if (row.has_mb) {
      checkField('moisture', 'Moisture', row.moisture, 0.3, '%')
      checkField('untapped_bd', 'BD', row.untapped_bd, 5, '')
    }
    checkField('hourly_temp', 'Temp', row.hourly_temp, 1.0, '°C')
    return warns
  })()
  const [confirmAnomaly, setConfirmAnomaly] = useState(false)

  function submit() {
    if (!row.time.trim())     { alert('Time is required'); return }
    if (!row.date)            { alert('Date is required'); return }
    if (!row.qc_name?.trim()) { alert('QC Controller name is required'); return }
    if (anomalyWarnings.length > 0 && !confirmAnomaly) { alert('Please tick "Yes, these values are correct" before saving.'); return }
    const hr = parseInt((row.time||'').split(':')[0])
    if (hr >= 16 && !row.afternoon_qc?.trim()) { alert('Afternoon QC Controller name is required for samples taken after 16:00'); return }
    onSave(row)
  }

  const isAfternoon = parseInt((row.time||'00').split(':')[0]) >= 16

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-2xl shadow-menu my-auto">
        <div className="flex items-center justify-between px-6 py-4 bg-brand rounded-t-2xl">
          <div>
            <div className="text-white font-bold text-[14px]">
              {isEdit ? `✏️ Edit Sample #${sampleIndex+1}` : `Sample #${sampleIndex+1} — ${isOdd ? 'Full Sieve + Moisture/BD' : 'Moisture/BD only'}`}
            </div>
            <div className="text-blue-200 text-[11px] mt-0.5">{batch.batch_number} · {batch.type_grade}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Type indicator + toggles */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl flex-wrap border ${isOdd ? 'bg-info/5 border-info/20' : 'bg-purple-50 border-purple-100'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isOdd ? 'bg-info' : 'bg-purple-400'}`} />
              <span className={`text-[12px] font-bold ${isOdd ? 'text-info' : 'text-purple-700'}`}>
                Auto: {isOdd ? 'Full sieve + Moisture/BD' : 'Moisture/BD only'}
              </span>
            </div>
            <div className="flex gap-2 ml-auto">
              {[['has_sieve','⚙ Sieve'],['has_mb','💧 Moisture/BD']].map(([k,l]) => (
                <label key={k} className={`flex items-center gap-1.5 cursor-pointer px-3 py-1.5 rounded-lg border-2 text-[11px] font-semibold transition-colors ${row[k] ? 'border-brand bg-info/10 text-brand' : 'border-surface-rule bg-surface-card text-text-muted'}`}>
                  <input type="checkbox" checked={row[k]} onChange={e => set(k, e.target.checked)} className="w-3.5 h-3.5 accent-brand" />
                  {l}
                </label>
              ))}
            </div>
          </div>

          {/* Identity fields */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[['time','Time *','text'],['date','Date *','date'],['serial_bin','Bin/Bag No.','text'],['needle_count','Needle Count','number']].map(([k,l,t]) => (
              <div key={k}>
                <label className={`${lbl} ${k==='date'?'text-info':''}`}>{l as string}</label>
                <input type={t as string} inputMode={t==='number'?'numeric':undefined} value={row[k]??''} onChange={e => set(k as string, e.target.value)}
                  className={`${inp} w-full ${k==='date'?'border-info/40 bg-info/5':''}`} />
              </div>
            ))}
            <div>
              <label className={lbl}>QC Controller *</label>
              <QCNameField value={row.qc_name||''} onChange={v => set('qc_name', v)} names={qcNames}
                placeholder="Name" className={`${inp} w-full`} />
            </div>
            <div>
              <label className={lbl}>Temp (°C)</label>
              {(() => {
                const tempSpec = spec('hourly_temp')
                const tempSt = pastChk(row.hourly_temp, tempSpec)
                return (
                  <>
                    <input type="number" inputMode="decimal" step="0.1" value={row.hourly_temp??''} onChange={e => set('hourly_temp', e.target.value)}
                      className={`${inp} w-full ${tempSt==='fail' ? 'border-err bg-err/5' : tempSt==='pass' ? 'border-ok/50' : ''}`} />
                    {tempSt==='fail' && (
                      <p className="mt-1 text-[10px] font-semibold text-err">
                        ⚠ Temp below spec (min {tempSpec?.min}°C)
                      </p>
                    )}
                  </>
                )
              })()}
            </div>
            <div>
              <label className={lbl}>Compares to Ref?</label>
              <select value={row.compares_to_ref} onChange={e => set('compares_to_ref', e.target.value)} className={`${inp} w-full`}>
                <option value="">—</option><option>Yes</option><option>No</option>
              </select>
            </div>
          </div>

          {/* Afternoon QC */}
          {isAfternoon && (
            <div className="px-4 py-3 bg-warn/8 border border-warn/30 rounded-xl">
              <div className="font-bold text-[12px] text-warn mb-2">🌇 Afternoon Shift (16:00+) — Second QC Controller required</div>
              <div>
                <label className={lbl}>Afternoon QC Controller *</label>
                <QCNameField value={row.afternoon_qc||''} onChange={v => set('afternoon_qc', v)} names={qcNames}
                  placeholder="Enter afternoon QC controller name" className={`${inp} w-full`} />
              </div>
            </div>
          )}

          {/* Sieve section */}
          {row.has_sieve && (
            <div className="bg-info/5 border-2 border-info/30 rounded-xl p-4">
              <div className="font-bold text-[12px] text-info mb-3">⚙ Sieve Analysis</div>
              <div className="overflow-x-auto rounded-xl border border-surface-rule">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="bg-brand text-white">
                      {['Fraction','Spec','Grams (g)','Result (%)','Status'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-rule">
                    {PAST_SIEVE_COLS.map((c,i) => {
                      const sp = spec(c.key)
                      const st = pastChk(row[c.key], sp)
                      const orderFail = orderViolations.has(c.key)
                      const fail = st === 'fail' || orderFail
                      return (
                        <tr key={c.key} className={i%2===1?'bg-surface/50':''}>
                          <td className="px-3 py-2 font-semibold text-text">{c.label}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-text-muted">
                            {sp ? `${sp.min!=null?sp.min+'–':'≤'}${sp.max??''}%` : '—'}
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" inputMode="decimal" step="0.1" value={row[c.key+'_g']} onChange={e => calcPct(c.key+'_g', e.target.value)}
                              placeholder="g" className={`${inp} w-24 text-center border-info/40 bg-info/5 text-[15px] py-2`} />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className={`px-3 py-1.5 rounded-lg border text-center font-mono font-bold text-[13px] ${fail ? 'border-err/40 bg-err/8 text-err' : st === 'pass' ? 'border-ok/40 bg-ok/8 text-ok' : 'border-surface-rule bg-surface text-text-muted'}`}>
                              {row[c.key] ? row[c.key]+'%' : '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-[11px] font-semibold">
                            {st==='fail' ? <span className="text-err">⚠ FAIL</span> :
                             orderFail   ? <span className="text-warn" title="Order violation">⚠ ORDER</span> :
                             st==='pass' ? <span className="text-ok">✓</span> :
                             <span className="text-text-faint">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-surface font-bold border-t-2 border-surface-rule">
                      <td colSpan={3} className="px-3 py-2 text-right text-[11px] text-text-muted">Total</td>
                      <td className={`px-2 py-1.5 text-center font-mono font-bold text-[13px] ${total > 0 ? (Math.abs(total-100)<2 ? 'text-ok' : 'text-err') : 'text-text-faint'}`}>
                        {total > 0 ? total.toFixed(1)+'%' : '—'}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-text-muted">{total > 0 ? (Math.abs(total-100)<2 ? '~100% ✓' : 'check total') : ''}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Moisture & BD */}
          {row.has_mb && (
            <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4">
              <div className="font-bold text-[12px] text-purple-700 mb-3">💧 Moisture & Bulk Density</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[['moisture','Moisture %','moisture'],['untapped_bd','Untapped BD (cc/100g)','untapped_bd'],['customer_bd','Customer BD (cc/100g)',null]].map(([k,l,sk]) => {
                  const sp = sk ? spec(sk as string) : null
                  const st = pastChk(row[k as string], sp)
                  return (
                    <div key={k as string}>
                      <label className={lbl}>{l as string}{sp && <span className="text-[9px] text-text-faint ml-1">{sp.min!=null?`${sp.min}–${sp.max}`:sp.max!=null?`≤${sp.max}`:''}</span>}</label>
                      <input type="number" inputMode="decimal" step="0.01" value={row[k as string]} onChange={e => set(k as string, e.target.value)}
                        className={`${inp} w-full ${st==='fail'?'border-err/40 bg-err/8':st==='pass'?'border-ok/40 bg-ok/8':''}`} />
                      {st==='fail' && <div className="text-[9px] text-err mt-0.5">⚠ Out of spec</div>}
                    </div>
                  )
                })}
                {['1','2','3'].map(n => (
                  <div key={n}>
                    <label className={lbl}>Weight Check {n} (kg)</label>
                    <input type="number" inputMode="decimal" step="0.1" value={row[`final_weight_${n}`]} onChange={e => set(`final_weight_${n}`, e.target.value)} className={`${inp} w-full`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Variation / outlier warnings — require explicit confirmation before saving */}
          {anomalyWarnings.length > 0 && (
            <div className="px-4 py-3 bg-warn/8 border border-warn/40 rounded-xl">
              <div className="flex items-center gap-2 font-bold text-[12px] text-warn mb-1">
                <AlertTriangle size={14} /> Unusual variation — please double-check before saving
              </div>
              <ul className="list-disc pl-5 space-y-0.5 mb-2">
                {anomalyWarnings.map((w,i) => (
                  <li key={i} className="text-[11px] text-warn">{w}</li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-warn cursor-pointer">
                <input type="checkbox" checked={confirmAnomaly} onChange={e => setConfirmAnomaly(e.target.checked)} />
                Yes, these values are correct
              </label>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
            <button onClick={submit} disabled={anomalyWarnings.length > 0 && !confirmAnomaly}
              className="px-6 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              {isEdit ? '✏️ Update Sample' : `💾 Save Sample #${sampleIndex+1}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Batch completeness checker ───────────────────────────────────────────────

function BatchCompleteness({ batch }: { batch:Batch }) {
  const samples       = batch.samples || []
  const sieveSamples  = samples.filter(s => s.has_sieve)
  const mbSamples     = samples.filter(s => s.has_mb)
  const sensorialDone = samples.filter(s => s.has_sensorial).length

  const checks = [
    { label:'Samples recorded',     done: samples.length > 0,      detail: `${samples.length} recorded` },
    { label:'Moisture & BD',         done: mbSamples.length > 0 && mbSamples.every(s => s.moisture && s.untapped_bd), detail: `${mbSamples.length} MB samples` },
    { label:'Sieve data',            done: sieveSamples.length > 0 && sieveSamples.every(s => PAST_SIEVE_COLS.some(c => s[c.key as keyof BatchSample])), detail: `${sieveSamples.length} sieve samples` },
    { label:'Sensorial tasting',     done: sensorialDone > 0,       detail: `${sensorialDone}/${samples.length} tasted`, warn: sensorialDone > 0 && sensorialDone < samples.length },
  ]
  const complete = checks.every(c => c.done)

  return (
    <div className={`p-4 rounded-xl border ${complete ? 'bg-ok/5 border-ok/20' : 'bg-warn/5 border-warn/20'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`font-semibold text-[13px] ${complete ? 'text-ok' : 'text-warn'}`}>
          {complete ? '✅ Batch complete — ready to finalise' : '⚠ Batch incomplete'}
        </span>
        <span className="text-[10px] text-text-muted">{checks.filter(c=>c.done).length}/{checks.length} checks</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {checks.map((c,i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className={`text-[13px] ${c.done ? 'text-ok' : (c as any).warn ? 'text-warn' : 'text-err'}`}>{c.done ? '✓' : (c as any).warn ? '⚠' : '✗'}</span>
            <span className={`font-semibold ${c.done ? 'text-ok' : (c as any).warn ? 'text-warn' : 'text-err'}`}>{c.label}</span>
            <span className="text-text-muted text-[10px]">— {c.detail}</span>
          </div>
        ))}
      </div>
      {!samples.some(s => s.has_sensorial) && (
        <div className="mt-3 px-3 py-2 bg-err/8 border border-err/20 rounded-lg text-[11px] text-err font-semibold">
          🚫 Finalising is blocked — add at least one sensorial (tasting) assessment before closing.
        </div>
      )}
    </div>
  )
}

// ─── Run Dashboard ────────────────────────────────────────────────────────────

// ─── Runs Overview Dashboard ──────────────────────────────────────────────────
// At-a-glance summary across all active runs + a live moisture/temperature trend
// for the currently selected batch.

function RunsOverview({ batches, activeBatch }: { batches: Batch[]; activeBatch: Batch | null }) {
  const active    = batches.filter(b => !b.final_result)
  const completed = batches.filter(b => !!b.final_result)
  const passRate  = completed.length ? Math.round(completed.filter(b=>b.final_result==='Pass').length/completed.length*100) : null

  const activeSamples = active.flatMap(b => b.samples || [])
  const moistVals = activeSamples.map(s => parseFloat(s.moisture as any)).filter(n=>!isNaN(n))
  const tempVals  = activeSamples.map(s => parseFloat(s.hourly_temp as any)).filter(n=>!isNaN(n))
  const avgMoist  = moistVals.length ? moistVals.reduce((a,b)=>a+b,0)/moistVals.length : null
  const avgTemp   = tempVals.length  ? tempVals.reduce((a,b)=>a+b,0)/tempVals.length   : null

  const sieveFails = active.reduce((acc,b) => acc + (b.samples||[]).filter(s =>
    s.has_sieve && PAST_SIEVE_COLS.some(c => pastChk(s[c.key as keyof BatchSample] as string, getPastSpec(b.customer,c.key,b._spec,b.batch_specs))==='fail')
  ).length, 0)

  const trend = (activeBatch?.samples || []).map((s,i) => ({
    name: s.time || `#${i+1}`,
    Moisture: !isNaN(parseFloat(s.moisture as any))    ? parseFloat(s.moisture as any)    : null,
    Temp:     !isNaN(parseFloat(s.hourly_temp as any)) ? parseFloat(s.hourly_temp as any) : null,
  })).filter(d => d.Moisture!=null || d.Temp!=null)

  const cards: Array<{label:string,value:string|number,color:string}> = [
    { label:'Active Runs',    value: active.length,                                  color:'text-brand' },
    { label:'Samples (live)', value: activeSamples.length,                           color:'text-text' },
    { label:'Avg Moisture',   value: avgMoist!=null?`${avgMoist.toFixed(1)}%`:'—',   color: avgMoist!=null&&avgMoist>8.5?'text-err':'text-ok' },
    { label:'Avg Temp',       value: avgTemp!=null?`${avgTemp.toFixed(0)}°C`:'—',    color: avgTemp!=null&&avgTemp<85?'text-err':'text-ok' },
    { label:'Sieve Fails',    value: sieveFails,                                     color: sieveFails>0?'text-err':'text-ok' },
    { label:'Pass Rate',      value: passRate!=null?`${passRate}%`:'—',              color:'text-ok' },
  ]

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-display font-bold text-[15px] text-text">📊 Runs Overview</div>
        <div className="text-[11px] text-text-muted">{active.length} active · {completed.length} completed</div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {cards.map(c => (
          <div key={c.label} className="bg-surface rounded-xl border border-surface-rule px-3 py-2.5 text-center">
            <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted mb-0.5">{c.label}</div>
            <div className={`font-display font-bold text-[20px] ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>
      {trend.length >= 2 && (
        <div>
          <div className="text-[11px] font-semibold text-text-muted mb-1">
            {activeBatch?.batch_number} — Moisture & Temperature trend
          </div>
          <div style={{ width:'100%', height:180 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top:5, right:10, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="name" tick={{ fontSize:10 }} />
                <YAxis yAxisId="m" tick={{ fontSize:10 }} domain={['auto','auto']} />
                <YAxis yAxisId="t" orientation="right" tick={{ fontSize:10 }} domain={['auto','auto']} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize:11 }} />
                <ReferenceLine yAxisId="m" y={8.5} stroke="#ef4444" strokeDasharray="4 4" label={{ value:'Moisture max', fontSize:9, fill:'#ef4444' }} />
                <Line yAxisId="m" type="monotone" dataKey="Moisture" stroke="#f97316" strokeWidth={2} connectNulls dot={{ r:3 }} />
                <Line yAxisId="t" type="monotone" dataKey="Temp"     stroke="#0ea5e9" strokeWidth={2} connectNulls dot={{ r:3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function RunDashboard({ isAdmin }: { isAdmin:boolean }) {
  const db     = getDb()
  const { session, p } = useAuth()
  const canApprove = p('can_approve_runs')
  const qcNames = useQcNames()

  const [batches,       setBatches]        = useState<Batch[]>([])
  const [activeBatchId, setActiveBatchId]  = useState<string|null>(null)
  const [dashView,      setDashView]       = useState<'active'|'history'>('active')
  const [showNewBatch,  setShowNewBatch]   = useState(false)
  const [showAddRow,    setShowAddRow]     = useState(false)
  const [editSampleId,  setEditSampleId]   = useState<string|null>(null)
  const [sensorialFor,  setSensorialFor]   = useState<string|null>(null)
  const [commentFor,    setCommentFor]     = useState<string|null>(null)
  const [collapsed,     setCollapsed]      = useState(false)
  const [dbLoading,     setDbLoading]      = useState(true)
  const [dbSaving,      setDbSaving]       = useState(false)
  const [historySearch, setHistorySearch]  = useState('')
  const [expandedHistId,setExpandedHistId] = useState<string|null>(null)
  const [editingField,  setEditingField]   = useState<string|null>(null)
  const [qcDraft,       setQcDraft]        = useState('')
  const [pubBatches,    setPubBatches]     = useState<any[]>([])
  const [pubLoading,    setPubLoading]     = useState(false)
  const [showPubHistory,setShowPubHistory] = useState(false)
  const [histSort,      setHistSort]       = useState<{key:string;dir:'asc'|'desc'}>({ key:'date', dir:'desc' })
  const [histRowView,   setHistRowView]    = useState<'samples'|'daily'>('samples')
  const prevBatchIdRef = useRef<string|null>(null)

  // Load batches from qms (single source — legacy public consolidated 2026-06-24)
  // Paginated — the duplicate-batch-number check depends on ALL history being
  // loaded, not just the newest page (PostgREST caps a single request at 1000 rows).
  useEffect(() => {
    setDbLoading(true)
    ;(async () => {
      let allData: any[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.schema('qms').from('quality_records').select('*')
          .eq('workcenter','pasteuriser').eq('workflow','pasteuriser_run')
          .order('created_at',{ascending:false}).range(from, from + 999)
        if (error) break
        allData = allData.concat(data || [])
        if (!data || data.length < 1000) break
      }
      const parseRec = (r: any): any => {
        let d: any = {}
        try { d = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}) } catch {}
        if (!d.id) d.id = r.id || r.batch_number || `rec-${Math.random().toString(36).slice(2)}`
        const b = { ...d, _db_id: r.id }
        // Chronological order (oldest first) — this order drives "Sample #N"
        // numbering and the odd/even sieve pattern. Display is reversed
        // separately where samples are rendered, so newest shows on top.
        return { ...b, samples: [...(b.samples||[])].sort((a:any,x:any) => {
          const da = `${a.date||''}${a.time||''}`, db2 = `${x.date||''}${x.time||''}`
          return da < db2 ? -1 : da > db2 ? 1 : 0
        })}
      }
      const fromQms = allData.map((r: any) => parseRec(r)).filter(Boolean)
      setBatches(fromQms as any)
      if (fromQms.length > 0) setActiveBatchId((fromQms[0] as any).id)
      setDbLoading(false)
    })()
  }, [])

  // "Historical" view — now a qms read (public schema retired)
  const loadPubHistory = useCallback(async () => {
    setPubLoading(true)
    const { data } = await db.schema('qms').from('quality_records').select('*')
      .eq('workcenter', 'pasteuriser').order('created_at', { ascending: false }).limit(500)
    setPubBatches((data ?? []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    setPubLoading(false)
  }, [db])

  useEffect(() => {
    if (showPubHistory) loadPubHistory()
  }, [showPubHistory, loadPubHistory])

  // Export every historical (public-schema) record as one combined workbook
  function exportPubHistory(records: any[]) {
    const batches = records.map((r: any) => {
      let d: any = {}
      try { d = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}) } catch {}
      return {
        ...d,
        batch_number: r.batch_number || d.batch_number || d.batch_no || '—',
        customer: d.customer || r.customer || '',
        type_grade: d.type_grade || d.product_family || r.product_family || '',
        final_result: d.final_result || r.final_result || '',
        production_date: d.production_date || (r.created_at ? String(r.created_at).slice(0, 10) : ''),
        samples: d.samples || [],
      }
    })
    exportPasteuriserBatches(batches, `Pasteuriser_Historical_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  useEffect(() => {
    if (activeBatchId !== prevBatchIdRef.current) { setCollapsed(false); prevBatchIdRef.current = activeBatchId }
  }, [activeBatchId])

  async function saveBatchToDB(batch: Batch) {
    setDbSaving(true)
    const { _db_id, ...batchData } = batch as any
    if (_db_id) {
      await db.schema('qms').from('quality_records').update({ data_json: batchData, batch_number: batchData.batch_number }).eq('id', _db_id)
    } else {
      const { data: saved } = await db.schema('qms').from('quality_records').insert({
        workcenter:'pasteuriser', workflow:'pasteuriser_run',
        batch_number: batchData.batch_number || 'UNKNOWN', data_json: batchData,
      }).select().single()
      if (saved) setBatches(p => p.map(b => b.id === batch.id ? { ...b, _db_id: (saved as any).id } : b))
    }
    setDbSaving(false)
  }

  async function deleteBatchFromDB(dbId?: number) {
    if (!dbId) return
    await db.schema('qms').from('quality_records').delete().eq('id', dbId)
  }

  function createBatch(form: any) {
    const dup = batches.find(b => normBatch(b.batch_number) === normBatch(form.batch_number))
    if (dup) {
      if (!dup.final_result) {
        alert(`⚠ Batch "${form.batch_number}" already has an open run.\n\nPlease add a sample to the existing run instead of starting a new one.`)
      } else {
        alert(`⚠ Batch "${form.batch_number}" already exists (finalised as ${dup.final_result}).\n\nPlease use a different batch number.`)
      }
      return
    }
    const nb: Batch = { ...form, id: Math.random().toString(36).slice(2), samples:[], created_at: new Date().toISOString() }
    setBatches(p => [nb, ...p])
    setActiveBatchId(nb.id)
    setShowNewBatch(false)
    saveBatchToDB(nb)
  }

  function addSample(row: any) {
    setBatches(p => {
      const updated = p.map(b => b.id !== activeBatchId ? b : { ...b, samples: [...b.samples, { ...row, id: Math.random().toString(36).slice(2) }] })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
    setShowAddRow(false)
  }

  function updateSample(row: any) {
    setBatches(p => {
      const updated = p.map(b => b.id !== activeBatchId ? b : { ...b, samples: b.samples.map(s => s.id === editSampleId ? { ...s, ...row, id: s.id } : s) })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
    setEditSampleId(null)
  }

  function saveSensorial(sampleId: string, data: any) {
    setBatches(p => {
      const updated = p.map(b => b.id !== activeBatchId ? b : { ...b, samples: b.samples.map(s => s.id !== sampleId ? s : { ...s, ...data }) })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
    setSensorialFor(null)
  }

  function saveSampleComment(sampleId: string, comment: string) {
    setBatches(p => {
      const updated = p.map(b => b.id !== activeBatchId ? b : { ...b, samples: b.samples.map(s => s.id !== sampleId ? s : { ...s, comment }) })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
    setCommentFor(null)
  }

  function deleteSample(sampleId: string) {
    if (!confirm('Delete this sample row?')) return
    setBatches(p => {
      const updated = p.map(b => b.id !== activeBatchId ? b : { ...b, samples: b.samples.filter(s => s.id !== sampleId) })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
  }

  const whoAmI = () => session?.user?.email?.split('@')[0] || 'unknown'

  // Step 1 (QC): allocate a captured run to the Lab Manager for approval.
  function allocateToLabManager() {
    const hasSensorial = (activeBatch?.samples||[]).some(s => s.has_sensorial)
    if (!hasSensorial) { alert('⚠ Cannot allocate: no sensorial data has been recorded.\nPlease add at least one sensorial assessment before sending to the Lab Manager.'); return }
    if (!confirm('Allocate this run to the Lab Manager for pass/fail approval?')) return
    setBatches(prev => {
      const updated = prev.map(b => b.id !== activeBatchId ? b : { ...b, batch_status:'awaiting_approval', allocated_at:new Date().toISOString(), allocated_by:whoAmI(), oos_flags:computePastOosFlags(b) })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
  }

  // QC can pull a run back from the Lab Manager queue while it is unapproved.
  function recallFromLabManager() {
    setBatches(prev => {
      const updated = prev.map(b => b.id !== activeBatchId ? b : { ...b, batch_status:'in_progress', allocated_at:undefined, allocated_by:undefined })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
  }

  // Step 2 (Lab Manager / Quality Manager / IT): approve the allocated run.
  function finaliseBatch(result: string, reason = '') {
    const hasSensorial = (activeBatch?.samples||[]).some(s => s.has_sensorial)
    if (!hasSensorial) { alert('⚠ Cannot finalise: no sensorial data has been recorded.\nPlease add at least one sensorial assessment before closing.'); return }
    setBatches(prev => {
      const updated = prev.map(b => b.id !== activeBatchId ? b : { ...b, final_result:result, finalised_at:new Date().toISOString(), batch_status:'complete', final_reason:reason||undefined, approved_by:whoAmI(), oos_flags:computePastOosFlags(b) })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
  }

  function reopenBatch() {
    if (!confirm(`Re-open batch "${activeBatch?.batch_number}"?`)) return
    setBatches(p => {
      const updated = p.map(b => b.id !== activeBatchId ? b : { ...b, final_result:undefined, finalised_at:undefined, batch_status:'in_progress' })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
  }

  function saveBatchField(field: string, value: string) {
    setBatches(p => {
      const updated = p.map(b => b.id !== activeBatchId ? b : { ...b, [field]: value })
      const batch = updated.find(b => b.id === activeBatchId)
      if (batch) saveBatchToDB(batch)
      return updated
    })
    setEditingField(null)
  }

  const activeBatch    = batches.find(b => b.id === activeBatchId) || null
  const activeBatches  = batches.filter(b => !b.final_result)
  const completedBatches = (() => {
    const finished = batches.filter(b => !!b.final_result)
    const seen: Record<string,number> = {}; const merged: Batch[] = []
    finished.forEach(b => {
      const key = (b.batch_number||'').trim().toLowerCase()
      if (seen[key] != null) { merged[seen[key]].samples = [...(merged[seen[key]].samples||[]), ...(b.samples||[])] }
      else { seen[key] = merged.length; merged.push({ ...b }) }
    })
    return merged
  })()

  // ── History table sorting ───────────────────────────────────────────────────
  const meanOf = (b: Batch, field: keyof BatchSample, onlyMb = true) => {
    const ss = (b.samples||[]).filter(s => onlyMb ? s.has_mb : true)
    const vals = ss.map(s => parseFloat(s[field] as string)).filter(n => !isNaN(n))
    return vals.length ? vals.reduce((a,v)=>a+v,0)/vals.length : NaN
  }
  const earliestDate = (b: Batch) => {
    const ds = [...new Set((b.samples||[]).map(s=>s.date).filter(Boolean))].sort()
    return ds[0] || b.production_date || ''
  }
  const sortKeyVal = (b: Batch, key: string): string|number => {
    switch (key) {
      case 'batch':    return (b.batch_number||'').toLowerCase()
      case 'date':     return earliestDate(b)
      case 'customer': return (b.customer||'').toLowerCase()
      case 'product':  return `${b.product_family||b.type_grade||''} ${b.grade||''}`.toLowerCase()
      case 'variant':  return (b.variant||'').toLowerCase()
      case 'samples':  return (b.samples||[]).length
      case 'moisture': { const v = meanOf(b,'moisture'); return isNaN(v) ? -Infinity : v }
      case 'bd':       { const v = meanOf(b,'untapped_bd'); return isNaN(v) ? -Infinity : v }
      case 'result':   return (b.final_result||'').toLowerCase()
      default:         return ''
    }
  }
  const toggleHistSort = (key: string) =>
    setHistSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  const histSorted = [...completedBatches]
    .filter(b => !historySearch || b.batch_number.toLowerCase().includes(historySearch.toLowerCase()))
    .sort((a,b) => {
      const va = sortKeyVal(a, histSort.key), vb = sortKeyVal(b, histSort.key)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return histSort.dir === 'asc' ? cmp : -cmp
    })

  if (dbLoading) return <div className="text-center py-16 text-text-muted text-[12px] animate-pulse">Loading batches…</div>

  return (
    <div className="space-y-4">
      {activeBatches.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warn/10 border border-warn/30">
          <span className="text-warn text-[16px]">⚠</span>
          <div>
            <span className="font-bold text-[12px] text-warn">Pasteuriser has {activeBatches.length} open batch{activeBatches.length !== 1 ? 'es' : ''}</span>
            <span className="ml-2 text-[11px] text-text-muted">— finalise completed batches when done</span>
          </div>
        </div>
      )}
      {/* View toggle */}
      <div className="flex border border-surface-rule rounded-xl overflow-hidden w-fit">
        {([['active','🏭 Active Runs'],['history','📊 History & Performance']] as const).map(([v,l],i) => (
          <button key={v} onClick={() => setDashView(v)}
            className={`px-5 py-2 text-[13px] font-semibold transition-colors ${i>0?'border-l border-surface-rule':''} ${dashView===v?'bg-brand text-white':'bg-surface-card text-text-muted hover:text-text'}`}>
            {l}
            {v==='active' && activeBatches.length > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${dashView==='active'?'bg-white/25 text-white':'bg-warn/15 text-warn'}`}>{activeBatches.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── ACTIVE VIEW ── */}
      {dashView === 'active' && (
        <div className="space-y-4">
          {/* Runs overview dashboard */}
          <RunsOverview batches={batches} activeBatch={activeBatch} />

          {/* Batch selector */}
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setShowNewBatch(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover">
              <Plus size={14} /> New Run
            </button>
            {activeBatches.length === 0 && !dbLoading && (
              <span className="text-[12px] text-text-muted italic">No active runs — click "New Run" to start</span>
            )}
            {activeBatches.map(b => (
              <button key={b.id} onClick={() => setActiveBatchId(b.id)}
                className={`px-3 py-1.5 rounded-xl border-2 text-[12px] font-semibold transition-colors ${activeBatchId===b.id?'border-brand bg-info/5 text-brand':'border-surface-rule bg-surface-card text-text-muted'}`}>
                {b.batch_number}
                <span className="ml-1 text-[9px] opacity-60">({b.samples.length})</span>
                <span className="ml-1 text-[9px] bg-warn/15 text-warn px-1.5 py-0.5 rounded-full font-bold">⏳ In Progress</span>
              </button>
            ))}
            {dbSaving && <span className="text-[11px] text-text-faint animate-pulse">Saving…</span>}
          </div>

          {activeBatch && (
            <>
              {/* Batch header */}
              <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <button onClick={() => setCollapsed(c => !c)} className="text-text-muted text-[15px] leading-none">
                        {collapsed ? '▶' : '▼'}
                      </button>
                      {/* Editable batch number */}
                      {editingField === 'batch_number' ? (
                        <input autoFocus defaultValue={activeBatch.batch_number}
                          onBlur={e => saveBatchField('batch_number', e.target.value || activeBatch.batch_number)}
                          onKeyDown={e => { if (e.key==='Enter') (e.target as HTMLInputElement).blur(); if (e.key==='Escape') setEditingField(null) }}
                          className="font-mono font-bold text-[15px] border-2 border-brand rounded-lg px-2 py-0.5 w-44 outline-none" />
                      ) : (
                        <span onClick={() => setEditingField('batch_number')} className="font-mono font-bold text-[16px] text-text cursor-text border-b border-dashed border-text-muted">
                          {activeBatch.batch_number}
                        </span>
                      )}
                      <span className="text-[12px] text-text-muted">{activeBatch.production_date}</span>
                      <span className={`badge ${activeBatch.is_organic ? 'badge-ok' : 'badge-info'}`}>{activeBatch.is_organic ? '🌱 ORG' : 'CON'}</span>
                      <span className="badge badge-gray">📦 {activeBatch.packaging}</span>
                      {activeBatch.customer && <span className="badge" style={{background:'#ede9fe',color:'#7c3aed'}}>{activeBatch.customer}</span>}
                    </div>
                    <div className="flex items-center gap-2 pl-6 flex-wrap text-[11px] text-text-muted">
                      <span>{activeBatch.type_grade}</span>
                      <span>·</span>
                      <span>QC:</span>
                      {editingField === 'qc_name' ? (
                        <QCNameField autoFocus value={qcDraft} onChange={setQcDraft} names={qcNames}
                          onBlur={() => saveBatchField('qc_name', qcDraft)}
                          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key==='Enter') (e.target as HTMLInputElement).blur(); if (e.key==='Escape') setEditingField(null) }}
                          className="border border-brand rounded px-2 py-0.5 w-32 text-[11px] outline-none" />
                      ) : (
                        <span onClick={() => { setQcDraft(activeBatch.qc_name||''); setEditingField('qc_name') }} className="cursor-text border-b border-dashed border-text-muted font-semibold text-text">{activeBatch.qc_name || '(click to set)'}</span>
                      )}
                      {activeBatch.reference_batch && <><span>·</span><span>Ref: {activeBatch.reference_batch}</span></>}
                      {activeBatch._spec
                        ? <span className="badge badge-ok text-[9px]">✓ Spec: {activeBatch.product_family} {activeBatch.grade} · {activeBatch.variant}</span>
                        : <span className="badge badge-warn text-[9px]">⚠ Default spec</span>
                      }
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {activeBatch.final_result ? (
                      /* ── Approved / finalised ── */
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-3 py-1.5 rounded-lg text-[12px] font-bold border-2"
                          style={{ background:PASS_COLORS[activeBatch.final_result]?.[0], color:PASS_COLORS[activeBatch.final_result]?.[1], borderColor:PASS_COLORS[activeBatch.final_result]?.[2] }}>
                          Final: {activeBatch.final_result}
                        </span>
                        {activeBatch.approved_by && <span className="text-[10px] text-text-muted">approved by {activeBatch.approved_by}</span>}
                        <button onClick={reopenBatch} className="px-3 py-1.5 rounded-lg border border-info/30 bg-info/8 text-info text-[11px] font-semibold">🔓 Re-open</button>
                      </div>
                    ) : activeBatch.batch_status === 'awaiting_approval' ? (
                      /* ── Allocated to Lab Manager, awaiting pass/fail ── */
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-3 py-1.5 rounded-lg text-[11px] font-bold border-2 border-warn/40 bg-warn/10 text-warn">
                          ⏳ Awaiting Lab Manager{activeBatch.allocated_by ? ` · sent by ${activeBatch.allocated_by}` : ''}
                        </span>
                        {canApprove ? (
                          <>
                            <span className="text-[11px] text-text-muted">Approve as:</span>
                            {(['Pass','Fail','Concession'] as const).map(r => (
                              <button key={r}
                                onClick={() => {
                                  if (r === 'Fail' || r === 'Concession') {
                                    const reason = prompt(`Reason for "${r}" (required):`, '')
                                    if (reason === null) return
                                    if (!reason.trim()) { alert('A reason is required'); return }
                                    finaliseBatch(r, reason.trim())
                                  } else finaliseBatch(r)
                                }}
                                className="px-3 py-1.5 rounded-lg border-2 text-[11px] font-bold transition-colors"
                                style={{ borderColor:PASS_COLORS[r][2], background:PASS_COLORS[r][0], color:PASS_COLORS[r][1] }}>
                                {r}
                              </button>
                            ))}
                          </>
                        ) : (
                          <button onClick={recallFromLabManager} className="px-3 py-1.5 rounded-lg border border-info/30 bg-info/8 text-info text-[11px] font-semibold">↩ Recall to QC</button>
                        )}
                      </div>
                    ) : (
                      /* ── In progress: QC allocates to the Lab Manager ── */
                      (() => {
                        const hasSens = activeBatch.samples.some(s => s.has_sensorial)
                        return (
                          <button
                            onClick={() => { if (hasSens) allocateToLabManager() }}
                            disabled={!hasSens}
                            title={!hasSens ? 'Add sensorial data before allocating' : ''}
                            className="px-4 py-1.5 rounded-lg border-2 text-[11px] font-bold transition-colors disabled:opacity-50"
                            style={{ borderColor:hasSens?'#1f4e79':'#d1d5db', background:hasSens?'#1f4e79':'#f3f4f6', color:hasSens?'#fff':'#9ca3af', cursor:hasSens?'pointer':'not-allowed' }}>
                            📤 Allocate to Lab Manager
                          </button>
                        )
                      })()
                    )}
                    <button
                      onClick={() => exportPasteuriserBatch(activeBatch)}
                      className="px-3 py-1.5 rounded-lg border border-ok/30 bg-ok/8 text-ok text-[11px] font-semibold">
                      ⬇ Export Excel
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => { if (!confirm(`Delete entire run "${activeBatch.batch_number}" and all ${activeBatch.samples.length} samples?`)) return; deleteBatchFromDB(activeBatch._db_id); setBatches(p => p.filter(b => b.id !== activeBatchId)); setActiveBatchId(null) }}
                        className="px-3 py-1.5 rounded-lg border border-err/30 bg-err/8 text-err text-[11px] font-semibold">
                        🗑 Delete Run
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {!collapsed && (
                <>
                  <BatchCompleteness batch={activeBatch} />

                  {/* Add sample button */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {!activeBatch.final_result && (
                      <button onClick={() => setShowAddRow(true)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold">
                        <Plus size={14} /> Add Sample #{activeBatch.samples.length+1}
                      </button>
                    )}
                    <span className="text-[11px] text-text-muted">{activeBatch.samples.length} samples · {activeBatch.samples.filter(s=>s.has_sensorial).length} with sensorial</span>
                    <div className="ml-auto flex gap-2 text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-info/10 text-info font-semibold border border-info/20">Odd = Full Sieve + MB</span>
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold border border-purple-200">Even = MB only</span>
                    </div>
                  </div>

                  {/* Samples table */}
                  {activeBatch.samples.length === 0 ? (
                    <div className="bg-surface-card border border-surface-rule rounded-xl p-10 text-center text-text-muted text-[13px]">
                      No samples yet — click "Add Sample" to start recording
                    </div>
                  ) : (
                    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr>
                              <th colSpan={7} className="px-3 py-2 bg-brand text-white text-[10px] font-semibold text-center border-r-2 border-white/30">Sample Identity</th>
                              <th colSpan={8} className="px-3 py-2 bg-info text-white text-[10px] font-semibold text-center border-r-2 border-white/30">Sieve Analysis (%)</th>
                              <th colSpan={3} className="px-3 py-2 bg-purple-600 text-white text-[10px] font-semibold text-center border-r-2 border-white/30">Moisture & BD</th>
                              <th colSpan={6} className="px-3 py-2 bg-ok text-white text-[10px] font-semibold text-center">Sensorial</th>
                              <th className="px-3 py-2 bg-text text-surface-card text-[10px] font-semibold text-center"></th>
                            </tr>
                            <tr className="bg-surface border-b border-surface-rule text-[9px] font-mono uppercase text-text-muted">
                              <th className="px-2 py-2 text-center">#</th>
                              <th className="px-2 py-2 text-center">Type</th>
                              <th className="px-2 py-2">Time</th>
                              <th className="px-2 py-2 text-info">Date</th>
                              <th className="px-2 py-2">Bin/Bag</th>
                              <th className="px-2 py-2">QC</th>
                              <th className="px-2 py-2 text-center border-r-2 border-surface-rule">Temp°C</th>
                              {PAST_SIEVE_COLS.map(c => <th key={c.key} className="px-1.5 py-2 text-center whitespace-nowrap">{c.label}</th>)}
                              <th className="px-1.5 py-2 text-center font-bold border-r-2 border-surface-rule">Total</th>
                              <th className="px-2 py-2 text-center">Moist%</th>
                              <th className="px-2 py-2 text-center">BD cc</th>
                              <th className="px-2 py-2 text-center border-r-2 border-surface-rule">FW (kg)</th>
                              <th className="px-1.5 py-2 text-center">Aroma</th>
                              <th className="px-1.5 py-2 text-center">Flav</th>
                              <th className="px-1.5 py-2 text-center">Brisk</th>
                              <th className="px-1.5 py-2 text-center">Str</th>
                              <th className="px-1.5 py-2 text-center">Colour</th>
                              <th className="px-2 py-2 text-center">Sens.</th>
                              <th className="px-2 py-2 text-center">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeBatch.samples.map((s, i) => ({ s, i })).slice().reverse().map(({ s, i }) => {
                              const total = PAST_SIEVE_COLS.reduce((sum,c) => sum+(parseFloat(s[c.key as keyof BatchSample] as string)||0), 0)
                              const rowBg = i%2===0 ? '' : 'bg-surface/50'
                              return (
                                <>
                                  <tr key={s.id} id={`sample-${s.id}`}
                                    className={`border-b border-surface-rule/50 transition-colors hover:bg-surface ${rowBg} border-l-[3px] ${i%2===0?'border-l-brand/40':'border-l-purple-400/40'}`}>
                                    <td className="px-2 py-2.5 text-center font-mono font-bold text-[11px]" style={{ color: i%2===0?'var(--color-info)':'var(--color-brand)' }}>{i+1}</td>
                                    <td className="px-2 py-2.5 text-center">
                                      <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold border ${s.has_sieve?'bg-info/10 text-info border-info/20':'bg-purple-100 text-purple-700 border-purple-200'}`}>
                                        {s.has_sieve?'Full':'MB'}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2.5 font-mono font-bold text-[11px]">{s.time||'—'}</td>
                                    <td className="px-2 py-2.5 text-[10px] text-info font-semibold whitespace-nowrap">{s.date || '—'}</td>
                                    <td className="px-2 py-2.5 text-[10px] text-text-muted">{s.serial_bin||'—'}</td>
                                    <td className="px-2 py-2.5 text-[10px]">{s.qc_name||'—'}</td>
                                    <td className="px-2 py-2.5 text-center text-[10px] border-r-2 border-surface-rule">{s.hourly_temp||'—'}</td>
                                    {PAST_SIEVE_COLS.map(c => {
                                      const val = s[c.key as keyof BatchSample] as string
                                      const sp  = getPastSpec(activeBatch.customer, c.key, activeBatch._spec, activeBatch.batch_specs)
                                      const st  = pastChk(val, sp)
                                      return (
                                        <td key={c.key} className="px-1.5 py-2.5 text-center font-mono text-[11px]"
                                          style={{ background:st==='fail'?'#ef4444':'', color:st==='fail'?'#fff':st==='pass'?'var(--color-ok)':val?'var(--color-text)':'var(--color-text-faint)', fontWeight:st!=='neutral'&&val?700:400 }}>
                                          {val ? `${val}%` : (s.has_sieve ? '—' : <span className="text-[9px] opacity-30">n/a</span>)}
                                        </td>
                                      )
                                    })}
                                    {/* Total */}
                                    {(() => {
                                      return (
                                        <td className="px-1.5 py-2.5 text-center font-mono font-bold text-[11px] border-r-2 border-surface-rule"
                                          style={{ color: total>0?(Math.abs(total-100)<2?'var(--color-ok)':'var(--color-err)'):'var(--color-text-faint)' }}>
                                          {total>0?total.toFixed(1)+'%':'—'}
                                        </td>
                                      )
                                    })()}
                                    {/* Moisture */}
                                    {(() => {
                                      const sp = getPastSpec(activeBatch.customer,'moisture',activeBatch._spec,activeBatch.batch_specs)
                                      const st = pastChk(s.moisture, sp)
                                      return <td className="px-2 py-2.5 text-center font-mono text-[11px]" style={{ color:st==='fail'?'var(--color-err)':st==='pass'?'var(--color-ok)':s.moisture?'var(--color-text)':'var(--color-text-faint)', fontWeight:st!=='neutral'?700:400 }}>{s.moisture?`${s.moisture}%`:(s.has_mb?'—':'')}</td>
                                    })()}
                                    {/* BD */}
                                    {(() => {
                                      const sp = getPastSpec(activeBatch.customer,'untapped_bd',activeBatch._spec,activeBatch.batch_specs)
                                      const st = pastChk(s.untapped_bd, sp)
                                      return <td className="px-2 py-2.5 text-center font-mono text-[11px]" style={{ color:st==='fail'?'var(--color-err)':st==='pass'?'var(--color-ok)':s.untapped_bd?'var(--color-text)':'var(--color-text-faint)', fontWeight:st!=='neutral'?700:400 }}>{s.untapped_bd||(s.has_mb?'—':'')}</td>
                                    })()}
                                    <td className="px-2 py-2.5 text-center text-[10px] text-text-muted border-r-2 border-surface-rule">
                                      {[s.final_weight_1,s.final_weight_2,s.final_weight_3].filter(Boolean).join(' / ')||'—'}
                                    </td>
                                    {['aroma','flavour_profile','briskness','strength','cup_colour'].map(f => (
                                      <td key={f} className="px-1.5 py-2.5 text-center font-mono text-[11px]" style={{ color:(s as any)[f]?'var(--color-text)':'var(--color-text-faint)' }}>
                                        {(s as any)[f]||'—'}
                                      </td>
                                    ))}
                                    <td className="px-2 py-2.5 text-center">
                                      {s.has_sensorial ? (
                                        <span className={`badge ${s.sensorial_pass==='Pass'?'badge-ok':'badge-err'} text-[10px]`}>{s.sensorial_pass}</span>
                                      ) : (
                                        <button onClick={() => setSensorialFor(s.id)}
                                          className="px-2 py-1 rounded-lg border border-warn/40 bg-warn/8 text-warn text-[10px] font-semibold">+ Taste</button>
                                      )}
                                    </td>
                                    <td className="px-2 py-2.5 text-center whitespace-nowrap">
                                      {s.has_sensorial && <button onClick={() => setSensorialFor(s.id)} className="px-1.5 py-0.5 rounded border border-surface-rule bg-surface text-[10px] mr-1" title="Edit sensorial">🍵</button>}
                                      <button onClick={() => setEditSampleId(s.id)} className="px-1.5 py-0.5 rounded border border-info/30 bg-info/8 text-info text-[10px] mr-1">✏️</button>
                                      <button onClick={() => deleteSample(s.id)} className="px-1.5 py-0.5 rounded border border-err/30 bg-err/8 text-err text-[10px] mr-1">🗑</button>
                                      <button onClick={() => setCommentFor(commentFor===s.id?null:s.id)}
                                        className={`px-1.5 py-0.5 rounded border text-[10px] ${s.comment?'border-purple-200 bg-purple-50 text-purple-700':'border-surface-rule bg-surface text-text-muted'}`}>
                                        💬{s.comment?'●':''}
                                      </button>
                                    </td>
                                  </tr>

                                  {/* Comment row */}
                                  {commentFor === s.id && (
                                    <tr key={`${s.id}-comment`} className="bg-purple-50/50">
                                      <td colSpan={100} className="px-4 py-3">
                                        <div className="flex gap-3 items-start">
                                          <span className="font-bold text-[11px] text-purple-700 whitespace-nowrap pt-1.5">💬 QC Comment #{i+1}</span>
                                          <textarea defaultValue={s.comment||''} id={`comment-${s.id}`} rows={2}
                                            placeholder="Enter QC observation…"
                                            className="flex-1 px-3 py-2 border-2 border-purple-300 rounded-xl text-[11px] resize-y font-mono outline-none" />
                                          <div className="flex flex-col gap-1">
                                            <button onClick={() => { const el = document.getElementById(`comment-${s.id}`) as HTMLTextAreaElement; saveSampleComment(s.id, el?.value||'') }}
                                              className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[11px] font-bold">Save</button>
                                            <button onClick={() => setCommentFor(null)} className="px-3 py-1.5 rounded-lg border border-surface-rule text-[11px]">Cancel</button>
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}

                                  {/* Sensorial panel */}
                                  {sensorialFor === s.id && (
                                    <tr key={`${s.id}-sens`} className="bg-ok/3">
                                      <td colSpan={100} className="px-4 pb-3">
                                        <PastSensorialPanel sample={s} onSave={d => saveSensorial(s.id, d)} onClose={() => setSensorialFor(null)} />
                                      </td>
                                    </tr>
                                  )}
                                </>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Out of spec summary */}
                  {activeBatch.samples.some(s => PAST_SIEVE_COLS.some(c => pastChk(s[c.key as keyof BatchSample] as string, getPastSpec(activeBatch.customer,c.key,activeBatch._spec,activeBatch.batch_specs)) === 'fail') || pastChk(s.moisture, getPastSpec(activeBatch.customer,'moisture',activeBatch._spec,activeBatch.batch_specs)) === 'fail') && (
                    <div className="px-4 py-3 bg-err/5 border border-err/20 rounded-xl">
                      <div className="font-bold text-[12px] text-err mb-2">⚠ Out-of-spec results detected</div>
                      {activeBatch.samples.slice().reverse().map(s => {
                        const fails = [
                          ...PAST_SIEVE_COLS.filter(c => pastChk(s[c.key as keyof BatchSample] as string, getPastSpec(activeBatch.customer,c.key,activeBatch._spec,activeBatch.batch_specs)) === 'fail').map(c => `${c.label}: ${s[c.key as keyof BatchSample]}%`),
                          pastChk(s.moisture, getPastSpec(activeBatch.customer,'moisture',activeBatch._spec,activeBatch.batch_specs))==='fail' ? `Moisture: ${s.moisture}%` : null,
                        ].filter(Boolean)
                        if (!fails.length) return null
                        return (
                          <div key={s.id} className="flex gap-2 flex-wrap items-center mb-1">
                            <span className="font-mono font-bold text-[11px]">{s.time||'?'}</span>
                            {fails.map((f,i) => <span key={i} className="badge badge-err text-[10px]">{f}</span>)}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── HISTORY VIEW ── */}
      {dashView === 'history' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ['Total Batches', completedBatches.length, 'text-text'],
              ['Pass', completedBatches.filter(b=>b.final_result==='Pass').length, 'text-ok'],
              ['Fail', completedBatches.filter(b=>b.final_result==='Fail').length, 'text-err'],
              ['Concession', completedBatches.filter(b=>b.final_result==='Concession').length, 'text-warn'],
              ['Pass Rate', completedBatches.length > 0 ? Math.round(completedBatches.filter(b=>b.final_result==='Pass').length/completedBatches.length*100)+'%' : '—', 'text-ok'],
            ].map(([label,value,color]) => (
              <KpiCard key={label as string} label={label as string} value={value as string|number} color={color as string} />
            ))}
          </div>

          <div className="flex gap-2 items-center">
            <input value={historySearch} onChange={e => setHistorySearch(e.target.value)}
              placeholder="🔍 Search batch number…" className={`${inp} flex-1 max-w-xs`} />
            <span className="text-[11px] text-text-muted">{completedBatches.filter(b=>!historySearch||b.batch_number.toLowerCase().includes(historySearch.toLowerCase())).length} batches</span>
            <button
              onClick={() => setShowPubHistory(h => !h)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${showPubHistory ? 'border-warn/40 bg-warn/8 text-warn' : 'border-surface-rule text-text-muted hover:text-text'}`}
            >
              📜 Historical
            </button>
          </div>

          {completedBatches.length === 0 ? (
            <div className="bg-surface-card border border-surface-rule rounded-xl p-10 text-center text-text-muted text-[13px]">No completed batches yet — finalise a run to see it here</div>
          ) : (
            <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-surface border-b border-surface-rule">
                      {([['Batch No.','batch'],['Date','date'],['Customer','customer'],['Product','product'],['Variant','variant'],['Samples','samples'],['Avg Moisture','moisture'],['Avg BD','bd'],['Avg Cust BD',null],...PAST_SIEVE_COLS.map(c=>[`Avg ${c.label}`,null] as [string,null]),['Sieve Fails',null],['Result','result'],['Export',null]] as [string,string|null][]).map(([h,key]) => (
                        <th key={h}
                          onClick={key ? () => toggleHistSort(key) : undefined}
                          className={`px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide whitespace-nowrap ${key?'cursor-pointer select-none hover:text-text':''} ${key && histSort.key===key ? 'text-brand' : 'text-text-muted'}`}>
                          {h}{key && histSort.key===key ? (histSort.dir==='asc'?' ▲':' ▼') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-rule">
                    {histSorted.map((b, ri) => {
                      const samples = b.samples||[]
                      const sieveSamples = samples.filter(s => s.has_sieve)
                      const mbSamples    = samples.filter(s => s.has_mb)
                      const moist  = mbSamples.map(s => parseFloat(s.moisture)).filter(n => !isNaN(n))
                      const bd     = mbSamples.map(s => parseFloat(s.untapped_bd)).filter(n => !isNaN(n))
                      const custBd = mbSamples.map(s => parseFloat((s as any).customer_bd)).filter(n => !isNaN(n))
                      const avgM      = moist.length   ? (moist.reduce((a,b)=>a+b,0)/moist.length).toFixed(2)   : '—'
                      const avgBD     = bd.length      ? (bd.reduce((a,b)=>a+b,0)/bd.length).toFixed(0)         : '—'
                      const avgCustBD = custBd.length  ? (custBd.reduce((a,b)=>a+b,0)/custBd.length).toFixed(0) : '—'
                      const avgSieves = Object.fromEntries(PAST_SIEVE_COLS.map(c => {
                        const vals = sieveSamples.map(s => parseFloat(s[c.key as keyof BatchSample] as string)).filter(n => !isNaN(n))
                        return [c.key, vals.length ? (vals.reduce((a,v)=>a+v,0)/vals.length).toFixed(1) : null]
                      }))
                      const sieveFails = samples.filter(s => s.has_sieve && PAST_SIEVE_COLS.some(c => pastChk(s[c.key as keyof BatchSample] as string, getPastSpec(b.customer,c.key,b._spec,b.batch_specs)) === 'fail')).length
                      const rc = PASS_COLORS[b.final_result!] || ['#f3f4f6','#374151','#e5e7eb']
                      const isExpanded = expandedHistId === b.id
                      const sampleDates = [...new Set((b.samples||[]).map(s=>s.date).filter(Boolean))].sort()
                      const dateDisplay = sampleDates.length === 0 ? (b.production_date||'—')
                        : sampleDates.length === 1 ? sampleDates[0]
                        : `${sampleDates[0]} – ${sampleDates[sampleDates.length-1]}`

                      return (
                        <>
                          <tr key={b.id}
                            onClick={() => setExpandedHistId(isExpanded?null:b.id)}
                            className={`cursor-pointer hover:bg-surface transition-colors ${isExpanded?'bg-info/3 border-l-2 border-l-brand':'border-l-2 border-l-transparent'} ${ri%2===1?'bg-surface/50':''}`}>
                            <td className="px-4 py-3 font-mono font-bold text-[12px] text-text whitespace-nowrap">
                              <span className="text-[10px] text-text-muted mr-1">{isExpanded?'▼':'▶'}</span>
                              {b.batch_number}
                            </td>
                            <td className="px-4 py-3 text-[11px] text-text-muted whitespace-nowrap">{dateDisplay}</td>
                            <td className="px-4 py-3 text-[12px] text-text-muted">{b.customer||'—'}</td>
                            <td className="px-4 py-3 text-[11px] text-text-muted">{b.product_family||b.type_grade||'—'} {b.grade||''}</td>
                            <td className="px-4 py-3"><span className={`badge ${b.variant?.includes('Organic')?'badge-ok':'badge-info'}`}>{b.variant||'—'}</span></td>
                            <td className="px-4 py-3 font-mono text-[12px] text-text-muted">{samples.length}</td>
                            <td className="px-4 py-3 font-mono font-bold text-[12px]" style={{ color:parseFloat(avgM)>8.5?'var(--color-err)':'var(--color-ok)' }}>{avgM}{avgM!=='—'?'%':''}</td>
                            <td className="px-4 py-3 font-mono text-[12px] text-text-muted">{avgBD}</td>
                            <td className="px-4 py-3 font-mono text-[12px] text-text-muted">{avgCustBD}</td>
                            {PAST_SIEVE_COLS.map(c => {
                              const val = avgSieves[c.key]
                              const sp  = getPastSpec(b.customer, c.key, b._spec, b.batch_specs)
                              const num = val!=null ? parseFloat(val) : null
                              const outSpec = sp && num!=null && ((sp.min!=null&&num<sp.min)||(sp.max!=null&&num>sp.max))
                              return <td key={c.key} className="px-4 py-3 text-center font-mono text-[11px]" style={{ color:outSpec?'var(--color-err)':num!=null?'var(--color-text)':'var(--color-text-faint)', fontWeight:outSpec?700:400 }}>{val!=null?`${val}%`:'—'}</td>
                            })}
                            <td className="px-4 py-3 font-bold text-[11px]" style={{ color:sieveFails>0?'var(--color-err)':'var(--color-ok)' }}>{sieveFails>0?`⚠ ${sieveFails}`:'✓ 0'}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold border" style={{ background:rc[0], color:rc[1], borderColor:rc[2] }}>{b.final_result}</span>
                            </td>
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <button onClick={() => exportPasteuriserBatch(b)}
                                className="px-2 py-1 rounded-lg border border-ok/30 bg-ok/8 text-ok text-[10px] font-semibold whitespace-nowrap">⬇ Excel</button>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr key={`${b.id}-exp`}>
                              <td colSpan={99} className="bg-info/3 border-b-2 border-b-brand p-0">
                                <div className="p-5 space-y-3">
                                  <div className="flex items-center gap-3 flex-wrap sticky left-0 w-fit">
                                    <span className="font-mono font-bold text-[13px] text-text">{b.batch_number}</span>
                                    {b.qc_name && <span className="text-[11px] text-text-muted">QC: {b.qc_name}</span>}
                                    {b.final_reason && <span className="text-[10px] text-warn bg-warn/8 px-2 py-0.5 rounded-lg italic">💬 {b.final_reason}</span>}
                                    <div className="ml-auto flex border border-surface-rule rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                                      {([['samples','Samples'],['daily','📅 Per-day avg']] as const).map(([v,l],i) => (
                                        <button key={v} onClick={() => setHistRowView(v)}
                                          className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${i>0?'border-l border-surface-rule':''} ${histRowView===v?'bg-brand text-white':'bg-surface-card text-text-muted hover:text-text'}`}>{l}</button>
                                      ))}
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); setActiveBatchId(b.id); setDashView('active') }}
                                      className="px-3 py-1.5 rounded-lg border border-surface-rule text-[11px] font-semibold">✏️ Edit Run</button>
                                    <button onClick={e => { e.stopPropagation(); exportPasteuriserBatch(b) }}
                                      className="px-3 py-1.5 rounded-lg border border-ok/30 bg-ok/8 text-ok text-[11px] font-semibold">⬇ Export Excel</button>
                                  </div>
                                  {samples.length > 0 && histRowView === 'daily' && (() => {
                                    const byDate: Record<string, BatchSample[]> = {}
                                    samples.forEach(s => { const d = s.date || 'Unknown'; (byDate[d] = byDate[d] || []).push(s) })
                                    const mean = (ss: BatchSample[], field: keyof BatchSample, filt: (s:BatchSample)=>boolean = ()=>true) => {
                                      const vals = ss.filter(filt).map(s => parseFloat(s[field] as string)).filter(n => !isNaN(n))
                                      return vals.length ? vals.reduce((a,v)=>a+v,0)/vals.length : NaN
                                    }
                                    const dates = Object.keys(byDate).sort()
                                    return (
                                      <div className="overflow-x-auto rounded-xl border border-surface-rule">
                                        <table className="w-full text-left text-[10px]">
                                          <thead>
                                            <tr className="bg-brand text-white">
                                              {['Production Date','Samples','Avg Temp','Avg Moisture%','Avg BD (cc)',...PAST_SIEVE_COLS.map(c=>`Avg ${c.label}%`),'MB','Full'].map(h => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-surface-rule">
                                            {dates.map((d, di) => {
                                              const ss = byDate[d]
                                              const mb = ss.filter(s => s.has_mb), sv = ss.filter(s => s.has_sieve)
                                              const am = mean(mb,'moisture'), abd = mean(mb,'untapped_bd'), at = mean(ss,'hourly_temp')
                                              return (
                                                <tr key={d} className={`hover:bg-surface ${di%2===1?'bg-surface/50':'bg-surface-card'}`}>
                                                  <td className="px-3 py-2 font-mono font-bold text-text whitespace-nowrap">{d!=='Unknown' ? d : '—'}</td>
                                                  <td className="px-3 py-2 text-center font-mono text-text-muted">{ss.length}</td>
                                                  <td className="px-3 py-2 text-center font-mono">{isNaN(at)?'—':at.toFixed(1)}</td>
                                                  <td className="px-3 py-2 text-center font-mono font-bold" style={{ color:am>8.5?'var(--color-err)':'var(--color-ok)' }}>{isNaN(am)?'—':am.toFixed(2)+'%'}</td>
                                                  <td className="px-3 py-2 text-center font-mono">{isNaN(abd)?'—':abd.toFixed(0)}</td>
                                                  {PAST_SIEVE_COLS.map(c => { const v = mean(sv, c.key as keyof BatchSample); return <td key={c.key} className="px-2 py-2 text-center font-mono">{isNaN(v)?'—':v.toFixed(1)+'%'}</td> })}
                                                  <td className="px-3 py-2 text-center font-mono text-text-muted">{mb.length}</td>
                                                  <td className="px-3 py-2 text-center font-mono text-text-muted">{sv.length}</td>
                                                </tr>
                                              )
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )
                                  })()}
                                  {samples.length > 0 && histRowView === 'samples' && (
                                    <div className="overflow-x-auto rounded-xl border border-surface-rule">
                                      <table className="w-full text-left text-[10px]">
                                        <thead>
                                          <tr className="bg-brand text-white">
                                            {['#','Type','Date','Time','Bin/Bag','Temp','Moisture%','BD (cc)',...PAST_SIEVE_COLS.map(c=>c.label+'%'),'Total%','Aroma','Flav','Brisk','Str','Pass'].map(h => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-surface-rule">
                                          {samples.map((s, si) => {
                                            const tot = PAST_SIEVE_COLS.reduce((sum,c) => sum+(parseFloat(s[c.key as keyof BatchSample] as string)||0), 0)
                                            const hasFail = s.has_sieve && PAST_SIEVE_COLS.some(c => pastChk(s[c.key as keyof BatchSample] as string, getPastSpec(b.customer,c.key,b._spec,b.batch_specs))==='fail')
                                            return (
                                              <tr key={s.id||si} className={`hover:bg-surface ${hasFail?'bg-err/3 border-l-2 border-l-err':'bg-surface-card'}`}>
                                                <td className="px-3 py-2 text-center font-bold text-text-muted">{si+1}</td>
                                                <td className="px-3 py-2"><span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${s.has_sieve?'bg-info/10 text-info':'bg-purple-100 text-purple-700'}`}>{s.has_sieve?'Full':'MB'}</span></td>
                                                <td className="px-3 py-2 font-mono text-[9px] text-text-muted">{s.date || '—'}</td>
                                                <td className="px-3 py-2 font-mono">{s.time||'—'}</td>
                                                <td className="px-3 py-2 font-mono text-text-muted">{s.serial_bin||'—'}</td>
                                                <td className="px-3 py-2 text-center">{s.hourly_temp||'—'}</td>
                                                <td className="px-3 py-2 text-center font-mono font-bold" style={{ color:parseFloat(s.moisture)>8.5?'var(--color-err)':'var(--color-ok)' }}>{s.moisture?s.moisture+'%':'—'}</td>
                                                <td className="px-3 py-2 text-center font-mono">{s.untapped_bd||'—'}</td>
                                                {PAST_SIEVE_COLS.map(c => {
                                                  const val = s[c.key as keyof BatchSample] as string
                                                  const sp  = getPastSpec(b.customer, c.key, b._spec, b.batch_specs)
                                                  const st  = s.has_sieve ? pastChk(val, sp) : null
                                                  return <td key={c.key} className="px-2 py-2 text-center font-mono" style={{ background:st==='fail'?'var(--color-err-bg)':st==='pass'?'var(--color-ok-bg)':'', color:st==='fail'?'var(--color-err)':st==='pass'?'var(--color-ok)':'var(--color-text-muted)', fontWeight:st==='fail'?700:400 }}>{s.has_sieve?(val?val+'%':'—'):<span className="opacity-30 text-[8px]">n/a</span>}</td>
                                                })}
                                                <td className="px-3 py-2 text-center font-mono font-bold" style={{ color:tot>0?(Math.abs(tot-100)<2?'var(--color-ok)':'var(--color-err)'):'var(--color-text-faint)' }}>{tot>0?tot.toFixed(1)+'%':'—'}</td>
                                                {['aroma','flavour_profile','briskness','strength'].map(f => <td key={f} className="px-2 py-2 text-center">{(s as any)[f]||'—'}</td>)}
                                                <td className="px-3 py-2 text-center">{s.sensorial_pass?<span className={`badge ${s.sensorial_pass==='Pass'?'badge-ok':'badge-err'} text-[9px]`}>{s.sensorial_pass}</span>:'—'}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Historical records from public schema (read-only) ── */}
          {showPubHistory && (
            <div className="space-y-3 pt-2 border-t border-surface-rule">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wide text-warn font-bold">📜 Historical — public schema (read-only)</span>
                {pubLoading && <span className="text-[11px] text-text-muted animate-pulse">Loading…</span>}
                {!pubLoading && <span className="text-[11px] text-text-muted">{pubBatches.length} records</span>}
                {!pubLoading && pubBatches.length > 0 && (
                  <button onClick={() => exportPubHistory(pubBatches)}
                    className="ml-auto px-3 py-1.5 rounded-lg border border-ok/30 bg-ok/8 text-ok text-[11px] font-semibold">⬇ Export All</button>
                )}
              </div>
              {!pubLoading && pubBatches.length === 0 && (
                <div className="text-[12px] text-text-muted">No historical pasteuriser records found in the public schema.</div>
              )}
              {!pubLoading && pubBatches.length > 0 && (
                <div className="bg-surface-card border border-warn/20 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-surface border-b border-warn/20">
                          {['Batch','Date','Customer','Product','Samples','Result','Export'].map(h => (
                            <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-warn/70 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-rule">
                        {pubBatches.map((r: any, i: number) => {
                          let d: any = {}
                          try { d = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}) } catch {}
                          const batchNo = r.batch_number || d.batch_number || d.batch_no || '—'
                          const customer = d.customer || r.customer || '—'
                          const product = d.type_grade || d.product_family || r.product_family || '—'
                          const sampleCount = (d.samples || []).length
                          const result = d.final_result || r.final_result || null
                          const rc = result ? (PASS_COLORS[result] ?? ['#f3f4f6','#374151','#e5e7eb']) : null
                          return (
                            <tr key={r.id} className={`hover:bg-surface ${i%2===1?'bg-warn/[0.02]':''}`}>
                              <td className="px-4 py-2.5 font-mono font-semibold text-[12px] text-text">{batchNo}</td>
                              <td className="px-4 py-2.5 text-[11px] text-text-muted font-mono">
                                {isoDate(r.created_at)}
                              </td>
                              <td className="px-4 py-2.5 text-[12px] text-text-muted">{customer}</td>
                              <td className="px-4 py-2.5 text-[11px] text-text-muted">{product}</td>
                              <td className="px-4 py-2.5 font-mono text-[11px] text-text-muted">{sampleCount > 0 ? sampleCount : '—'}</td>
                              <td className="px-4 py-2.5">
                                {rc
                                  ? <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold border" style={{ background:rc[0], color:rc[1], borderColor:rc[2] }}>{result}</span>
                                  : <span className="text-text-faint text-[11px]">—</span>
                                }
                              </td>
                              <td className="px-4 py-2.5">
                                <button onClick={() => exportPasteuriserBatch({ ...d, batch_number: batchNo, customer, type_grade: product, final_result: result })}
                                  className="px-2 py-1 rounded-lg border border-ok/30 bg-ok/8 text-ok text-[10px] font-semibold">⬇ Excel</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showNewBatch && <NewBatchModal onSave={createBatch} onClose={() => setShowNewBatch(false)} />}
      {showAddRow && activeBatch && (
        <AddSampleModal batch={activeBatch} sampleIndex={activeBatch.samples.length} onSave={addSample} onClose={() => setShowAddRow(false)} />
      )}
      {editSampleId && activeBatch && (() => {
        const s = activeBatch.samples.find(x => x.id === editSampleId)
        const idx = activeBatch.samples.findIndex(x => x.id === editSampleId)
        if (!s) return null
        return <AddSampleModal batch={activeBatch} sampleIndex={idx} initialRow={s} onSave={updateSample} onClose={() => setEditSampleId(null)} />
      })()}
    </div>
  )
}

// ─── PDF Drop Zone ────────────────────────────────────────────────────────────

interface LabDropZoneProps { testType: string; onSuccess: () => void }

function LabDropZone({ testType, onSuccess }: LabDropZoneProps) {
  const { session } = useAuth()
  const [drag,  setDrag]  = useState(false)
  const [queue, setQueue] = useState<any[]>([])
  const processing = useRef(false)
  // Upload goes to Next.js API route — no external service needed

  const WF_LABELS: Record<string,string> = {
    micro:'Microbiology', residue:'Residue/Pesticides', heavy_metals:'Heavy Metals',
    eto:'EtO', aflatoxins:'Aflatoxins', mosh_moah:'MOSH/MOAH', pa_final:'PA/TA Final', glyphosate:'Glyphosate',
  }

  async function uploadFile(file: File, force = false, retest = false) {
    const fd = new FormData()
    fd.append('pdf', file); fd.append('workcenter','pasteuriser'); fd.append('workflow',testType)
    if (force)  fd.append('force_save','true')
    if (retest) fd.append('is_retest','true')
    const res  = await fetch('/api/upload', { method:'POST', body:fd })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload failed')
    return data
  }

  async function processQueue(items: any[]) {
    if (processing.current) return
    processing.current = true
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      setQueue(q => q.map(x => x.id===item.id ? { ...x, status:'processing' } : x))
      try {
        const data = await uploadFile(item.file)
        if (data.duplicate_warning) {
          setQueue(q => q.map(x => x.id===item.id ? { ...x, status:'duplicate', message: data.message || 'Duplicate batch', dupData:data } : x))
        } else {
          setQueue(q => q.map(x => x.id===item.id ? { ...x, status:'done', message:`✅ Saved ${data.records_saved} record(s)` } : x))
          onSuccess()
        }
      } catch (err: any) {
        setQueue(q => q.map(x => x.id===item.id ? { ...x, status:'error', message:`❌ ${err.message}` } : x))
      }
      if (i < items.length-1) await new Promise(r => setTimeout(r,2500))
    }
    processing.current = false
  }

  function addFiles(fl: FileList|null) {
    if (!fl) return
    const pdfs = Array.from(fl).filter(f => f.type==='application/pdf')
    if (!pdfs.length) { alert('PDF files only'); return }
    const newItems = pdfs.map(f => ({ id:Math.random().toString(36).slice(2), file:f, status:'pending', message:'', dupData:null }))
    setQueue(prev => { const next = [...prev,...newItems]; setTimeout(() => processQueue(newItems),0); return next })
  }

  async function forceSave(item: any) {
    setQueue(q => q.map(x => x.id===item.id ? { ...x, status:'processing', dupData:null } : x))
    try { const data = await uploadFile(item.file,true); setQueue(q => q.map(x => x.id===item.id ? { ...x, status:'done', message:`✅ Overwritten — ${data.records_saved} record(s)` } : x)); onSuccess() }
    catch (err: any) { setQueue(q => q.map(x => x.id===item.id ? { ...x, status:'error', message:`❌ ${err.message}` } : x)) }
  }

  const busy = queue.some(x => x.status==='processing')

  return (
    <div className="mb-4">
      <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)addFiles(e.dataTransfer.files)}}
        className={`relative border-2 border-dashed rounded-xl p-5 text-center transition-colors ${drag?'border-accent bg-accent-bg':busy?'border-surface-rule bg-surface animate-pulse':'border-surface-rule hover:border-accent/40 hover:bg-surface'}`}>
        {busy ? (
          <><div className="w-5 h-5 border-2 border-surface-rule border-t-accent rounded-full animate-spin mx-auto mb-2"/>
          <p className="font-semibold text-[12px] text-text-muted">Extracting with Gemini…</p></>
        ) : (
          <><div className="text-xl mb-1">📄</div>
          <p className="font-semibold text-[12px] text-text-muted">Drop {WF_LABELS[testType]||testType} PDF(s) here</p>
          <p className="text-[11px] text-text-faint mb-2">Multiple PDFs supported</p>
          <span className="inline-block px-3 py-1 rounded-lg bg-brand text-white text-[11px] font-semibold cursor-pointer">Browse PDFs</span>
          <input type="file" accept="application/pdf" multiple onChange={e=>{addFiles(e.target.files);e.currentTarget.value=''}} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" /></>
        )}
      </div>
      {queue.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          {queue.map(item => (
            <div key={item.id} className={`rounded-xl border px-4 py-2.5 text-[12px] flex items-start gap-2 ${item.status==='done'?'bg-ok/5 border-ok/20':item.status==='error'?'bg-err/5 border-err/20':item.status==='duplicate'?'bg-warn/8 border-warn/30':'bg-surface border-surface-rule'}`}>
              <span>{item.status==='processing'?'⏳':item.status==='done'?'✅':item.status==='error'?'❌':item.status==='duplicate'?'⚠️':'🕐'}</span>
              <div className="flex-1">
                <div className="font-semibold text-text">{item.file.name}</div>
                {item.message && <div className="text-text-muted text-[11px] whitespace-pre-line">{item.message}</div>}
                {item.status==='duplicate' && (
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => forceSave(item)} className="px-2 py-0.5 rounded bg-err text-white text-[10px] font-semibold">Overwrite</button>
                    <button onClick={() => setQueue(q => q.filter(x => x.id!==item.id))} className="px-2 py-0.5 rounded border border-surface-rule text-[10px]">Skip</button>
                  </div>
                )}
              </div>
              {item.status!=='processing' && item.status!=='duplicate' && (
                <button onClick={() => setQueue(q => q.filter(x => x.id!==item.id))} className="text-text-faint hover:text-text"><X size={12}/></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Generic TestTab ──────────────────────────────────────────────────────────

function TestTab({ title, icon, testType, isAdmin }: { title:string; icon:string; testType:string; isAdmin:boolean }) {
  const db = getDb()
  const [records, setRecords] = useState<LabRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await db.schema('qms').from('lab_results').select('*')
      .eq('test_type', testType).order('created_at', {ascending:false})
    setRecords((data as LabRecord[]) ?? [])
    setLoading(false)
  }, [db, testType])

  useEffect(() => { load() }, [load])

  async function deleteRecord(id: number) {
    if (!confirm('Delete this record?')) return
    await db.schema('qms').from('lab_results').delete().eq('id', id)
    setRecords(p => p.filter(r => r.id !== id))
  }

  const passCount = records.filter(r => {
    const s = r.overall_status ?? r.results?.overall_status ?? 'Pass'
    return String(s).toLowerCase().includes('pass') || s === 'Complies'
  }).length

  return (
    <>
      <LabDropZone testType={testType} onSuccess={load} />
      {!loading && records.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <KpiCard label="Pass"  value={passCount}             color="text-ok" />
          <KpiCard label="Fail"  value={records.length-passCount} color="text-err" />
          <KpiCard label="Total" value={records.length} />
        </div>
      )}
      {loading && <div className="text-center py-8 text-text-muted text-[12px] animate-pulse">Loading records…</div>}
      {!loading && records.length === 0 && (
        <div className="bg-surface-card border border-surface-rule rounded-xl p-10 text-center text-text-muted text-[13px]">
          No {title.toLowerCase()} records yet — upload lab reports using the drop zone above.
        </div>
      )}
      {!loading && records.length > 0 && (
        <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
            <span className="font-semibold text-[14px] text-text">{icon} {title} Results</span>
            <span className="text-[11px] text-text-muted">{records.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface border-b border-surface-rule">
                  {['Batch','Date','Lab','Status','Comment'].map(h => (
                    <th key={h} className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted">{h}</th>
                  ))}
                  {isAdmin && <th className="px-5 py-2.5 font-mono text-[10px] text-text-muted">Del</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {records.map((r,i) => {
                  const d = r.results ?? {}
                  const status = r.overall_status ?? d.overall_status ?? 'Pass'
                  return (
                    <tr key={r.id} className={`hover:bg-surface transition-colors ${i%2===1?'bg-surface/50':''}`}>
                      <td className="px-5 py-3 font-mono font-bold text-[12px] text-text">{r.batch_no||d.batch_no||'—'}</td>
                      <td className="px-5 py-3 text-[11px] text-text-muted font-mono">{isoDate(r.created_at)}</td>
                      <td className="px-5 py-3 text-[11px] text-text-muted">{d.lab||r.lab_name||'—'}</td>
                      <td className="px-5 py-3"><StatusBadge status={status}/></td>
                      <td className="px-5 py-3 text-[11px] text-text-muted max-w-[150px] truncate">{r.comment||'—'}</td>
                      {isAdmin && <td className="px-3 py-3"><button onClick={() => deleteRecord(r.id)} className="px-2 py-0.5 rounded border border-err/30 bg-err/8 text-err text-[10px]">✕</button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Specifications tab ────────────────────────────────────────────────────────

function SpecificationsTab({ isAdmin }: { isAdmin:boolean }) {
  const db = getDb()
  const [specs,   setSpecs]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.schema('qms').from('customer_specs').select('*').order('product_family').then(({ data }: { data: any[] | null }) => {
      setSpecs(data ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-8 text-text-muted animate-pulse text-[12px]">Loading specifications…</div>
  if (specs.length === 0) return (
    <div className="bg-surface-card border border-surface-rule rounded-xl p-10 text-center text-text-muted text-[13px]">
      No specifications in library yet. Add specs from the Customer Specs page, or they will be created automatically when you start a new batch run.
    </div>
  )

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface border-b border-surface-rule">
              {['Family','Grade','Variant','Customer','Moisture Max','BD Min','BD Max','Notes'].map(h => (
                <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-rule">
            {specs.map((s,i) => (
              <tr key={s.id} className={`hover:bg-surface ${i%2===1?'bg-surface/50':''}`}>
                <td className="px-4 py-2.5 text-[12px] font-semibold text-text">{s.product_family}</td>
                <td className="px-4 py-2.5 text-[12px] text-text">{s.grade}</td>
                <td className="px-4 py-2.5"><span className={`badge ${s.variant?.includes('Organic')?'badge-ok':'badge-info'}`}>{s.variant}</span></td>
                <td className="px-4 py-2.5 text-[11px] text-text-muted">{s.customer||<span className="text-text-faint italic">generic</span>}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-text-muted">{s.moisture_max??'—'}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-text-muted">{s.bulk_density_min??'—'}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-text-muted">{s.bulk_density_max??'—'}</td>
                <td className="px-4 py-2.5 text-[11px] text-text-muted max-w-[160px] truncate">{s.notes||'—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { key:'rundash',   label:'🏭 Run Dashboard'  },
  { key:'specs',     label:'📋 Specifications' },
]

// ─── PastSensorialTable ──────────────────────────────────────────────────────
// Full batch-level central table: sieve averages + sensorial averages per batch
// Reads from qms.past_sensorial_sessions + qms.past_sensorial_samples

function PastSensorialTable({ canWrite }: { canWrite: boolean }) {
  const db = getDb()
  const [sessions, setSessions] = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState<number|null>(null)
  const [expandedData, setExpandedData] = useState<any|null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await db.schema('qms').from('past_sensorial_sessions')
      .select('*').order('created_at', { ascending:false })
    setSessions(data ?? [])
    setLoading(false)
  }, [db])

  useEffect(() => { load() }, [load])

  async function expand(id: number) {
    if (expanded===id) { setExpanded(null); setExpandedData(null); return }
    setExpanded(id)
    const { data } = await db.schema('qms').from('past_sensorial_samples')
      .select('*').eq('session_id', id).order('created_at')
    setExpandedData({ samples: data||[] })
  }

  async function deleteSession(id: number) {
    if (!confirm('Delete this pasteuriser sensorial session?')) return
    await db.schema('qms').from('past_sensorial_samples').delete().eq('session_id', id)
    await db.schema('qms').from('past_sensorial_sessions').delete().eq('id', id)
    setSessions(p => p.filter(s => s.id!==id))
    if (expanded===id) { setExpanded(null); setExpandedData(null) }
  }

  async function inlineEdit(sampleId: number, field: string, value: any) {
    await db.schema('qms').from('past_sensorial_samples').update({ [field]: value }).eq('id', sampleId)
    if (expanded) {
      const { data } = await db.schema('qms').from('past_sensorial_samples')
        .select('*').eq('session_id', expanded).order('created_at')
      setExpandedData({ samples: data||[] })
    }
  }

  const avg = (arr: any[], field: string) => {
    const vals = arr.filter(r=>r[field]!=null&&r[field]!=='').map(r=>parseFloat(r[field])).filter(v=>!isNaN(v))
    return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—'
  }

  const SIEVE_COLS = [['gt6','>6'],['gt10','>10 (ORG)'],['gt12','>12 (CON)'],['gt16','>16'],['gt20','>20'],['gt60','>60'],['dust','Dust']]

  const TH = ({ children, bg='#065f46', ...rest }: any) => (
    <th style={{ padding:'5px 6px', textAlign:'center', whiteSpace:'nowrap', background:bg, color:'#fff', fontWeight:600, fontSize:10, ...rest }}>{children}</th>
  )

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#374151' }}>
          Pasteuriser Central Table — {sessions.length} batch{sessions.length!==1?'es':''}
        </div>
        <button onClick={load} style={{ padding:'4px 12px', borderRadius:6, border:'1px solid #e5e7eb', background:'#fff', fontSize:11, cursor:'pointer' }}>↻ Refresh</button>
      </div>
      {loading && <div style={{ textAlign:'center', padding:20, color:'#9ca3af' }}>Loading…</div>}
      {!loading && sessions.length===0 && (
        <div style={{ textAlign:'center', padding:20, color:'#9ca3af' }}>
          No sensorial sessions yet — create them from the Run Dashboard when finalising batches.
        </div>
      )}
      {!loading && sessions.length>0 && (
        <div style={{ overflowX:'auto', borderRadius:9, background:'#fff', border:'1px solid #e5e7eb' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10, minWidth:1400 }}>
            <thead>
              <tr>
                <TH bg="#1f4e79" colSpan={4} style={{ textAlign:'left', padding:'5px 10px', borderRight:'2px solid #fff' }}>Identity</TH>
                <TH bg="#14532d" colSpan={3} style={{ borderRight:'2px solid #fff' }}>Production / QC</TH>
                <TH bg="#065f46" colSpan={3} style={{ borderRight:'2px solid #fff' }}>BD &amp; Process</TH>
                <TH bg="#78350f" colSpan={SIEVE_COLS.length+1} style={{ borderRight:'2px solid #fff' }}>Sieve Analysis (% avg)</TH>
                <TH bg="#4c1d95" colSpan={5}>Sensorial (avg)</TH>
              </tr>
              <tr style={{ background:'#f3f4f6', fontSize:10, color:'#374151' }}>
                <th style={{ padding:'4px 4px', width:32 }}></th>
                <th style={{ padding:'4px 8px', textAlign:'left', fontWeight:700, whiteSpace:'nowrap' }}>Batch No.</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>Date</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap', borderRight:'2px solid #e5e7eb' }}>Type / Grade</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>QC Name</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>Customer</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap', borderRight:'2px solid #e5e7eb' }}>Packaging</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>BD Result</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>Moisture%</th>
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap', borderRight:'2px solid #e5e7eb' }}>Bags</th>
                {SIEVE_COLS.map(([k,l]) => <th key={k} style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>{l}%</th>)}
                <th style={{ padding:'4px 6px', whiteSpace:'nowrap', fontWeight:700, borderRight:'2px solid #e5e7eb' }}>Total%</th>
                {['Aroma','Flavour','Briskness','Strength','Cup Col.'].map(h => (
                  <th key={h} style={{ padding:'4px 6px', whiteSpace:'nowrap', background:'#f5f3ff' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s,si) => {
                const isExp = expanded===s.id
                const bags  = isExp&&expandedData ? (expandedData.samples||[]) : []
                const sieveAvg = (k: string) => bags.length ? avg(bags, `sieve_${k}_pct`) : '—'
                const sensAvg  = (f: string) => bags.length ? avg(bags, f) : '—'
                const moistAvg = bags.length ? avg(bags,'moisture_pct') : (s.avg_moisture||'—')
                const bdAvg    = bags.length ? avg(bags,'volumetrics_cc') : (s.bd_result||'—')
                const sieveTotal = SIEVE_COLS.reduce((acc,[k])=>{ const v=parseFloat(sieveAvg(k)); return acc+(isNaN(v)?0:v) },0)

                return [
                  <tr key={s.id} style={{ borderBottom:'1px solid #f3f4f6', background:si%2===0?'#fff':'#fafafa', cursor:'pointer' }}
                    onClick={()=>expand(s.id)}>
                    <td style={{ padding:'4px 4px', textAlign:'center' }} onClick={e=>e.stopPropagation()}>
                      {canWrite && (
                        <button onClick={()=>deleteSession(s.id)}
                          style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontSize:13 }}>🗑</button>
                      )}
                    </td>
                    <td style={{ padding:'5px 8px', fontFamily:'monospace', fontWeight:700, whiteSpace:'nowrap' }}>
                      {s.batch_number}
                      <span style={{ marginLeft:6, fontSize:10, color:isExp?'#166534':'#9ca3af' }}>{isExp?'▲':'▼'}</span>
                    </td>
                    <td style={{ padding:'5px 6px', whiteSpace:'nowrap' }}>{s.date||'—'}</td>
                    <td style={{ padding:'5px 6px', whiteSpace:'nowrap', borderRight:'2px solid #e5e7eb' }}>{s.type_grade||'—'}</td>
                    <td style={{ padding:'5px 6px', whiteSpace:'nowrap' }}>{s.assessed_by||s.qc_name||'—'}</td>
                    <td style={{ padding:'5px 6px', whiteSpace:'nowrap' }}>{s.customer||'—'}</td>
                    <td style={{ padding:'5px 6px', whiteSpace:'nowrap', borderRight:'2px solid #e5e7eb' }}>{s.packaging_type||'—'}</td>
                    <td style={{ padding:'5px 6px', fontWeight:600 }}>{bdAvg}</td>
                    <td style={{ padding:'5px 6px', color:parseFloat(moistAvg)>8.5?'#dc2626':'#166534', fontWeight:600 }}>{moistAvg}{moistAvg!=='—'?'%':''}</td>
                    <td style={{ padding:'5px 6px', borderRight:'2px solid #e5e7eb' }}>{bags.length||0}</td>
                    {SIEVE_COLS.map(([k]) => <td key={k} style={{ padding:'5px 4px', textAlign:'center' }}>{sieveAvg(k)}</td>)}
                    <td style={{ padding:'5px 4px', textAlign:'center', fontWeight:700, borderRight:'2px solid #e5e7eb' }}>
                      {bags.length ? sieveTotal.toFixed(1) : '—'}
                    </td>
                    {(['rooibos_aroma','flavour_profile','briskness','strength','cup_colour'] as const).map(f => (
                      <td key={f} style={{ padding:'5px 4px', textAlign:'center', background:'#faf5ff' }}>{sensAvg(f)}</td>
                    ))}
                  </tr>,
                  isExp&&expandedData && (
                    <tr key={`${s.id}_exp`} style={{ background:'#f8faff' }}>
                      <td colSpan={30} style={{ padding:0 }}>
                        <div style={{ padding:'12px 16px', borderTop:'2px solid #166534' }}>
                          <div style={{ fontWeight:700, fontSize:11, color:'#166534', marginBottom:8 }}>
                            📦 Per-bag detail — {bags.length} bags · click values to edit
                          </div>
                          <div style={{ overflowX:'auto' }}>
                            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                              <thead>
                                <tr style={{ background:'#1f4e79', color:'#fff' }}>
                                  {['Bag','Moisture%','Vol. cc','Aroma','Flavour','Briskness','Strength','Cup Colour','Cup Clarity','Pass/Reject','Comments'].map(h=>(
                                    <th key={h} style={{ padding:'4px 7px', textAlign:'center', whiteSpace:'nowrap' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {bags.map((sa: any, i: number) => (
                                  <tr key={sa.id} style={{ borderBottom:'1px solid #f3f4f6', background:sa.pass_reject==='Reject'?'#fef2f2':i%2===0?'#fff':'#f9fafb' }}>
                                    <td style={{ padding:'3px 7px', fontWeight:600 }}>{sa.sample_id}</td>
                                    <td style={{ padding:'3px 5px', textAlign:'center' }}>
                                      <InlineEditCell value={sa.moisture_pct} onSave={v=>inlineEdit(sa.id,'moisture_pct',v)}/>
                                    </td>
                                    <td style={{ padding:'3px 5px', textAlign:'center' }}>
                                      <InlineEditCell value={sa.volumetrics_cc} onSave={v=>inlineEdit(sa.id,'volumetrics_cc',v)}/>
                                    </td>
                                    {(['rooibos_aroma','flavour_profile','briskness','strength','cup_colour'] as const).map(f=>(
                                      <td key={f} style={{ padding:'3px 5px', textAlign:'center' }}>
                                        <InlineEditCell value={sa[f]} onSave={v=>inlineEdit(sa.id,f,v)}/>
                                      </td>
                                    ))}
                                    <td style={{ padding:'3px 5px', textAlign:'center', fontSize:10 }}>{sa.cup_clarity||'—'}</td>
                                    <td style={{ padding:'3px 5px', textAlign:'center', fontWeight:600,
                                      color:sa.pass_reject==='Reject'?'#dc2626':'#166534' }}>{sa.pass_reject||'—'}</td>
                                    <td style={{ padding:'3px 7px', color:'#6b7280' }}>{sa.comments||'—'}</td>
                                  </tr>
                                ))}
                                {/* Averages footer */}
                                <tr style={{ background:'#f0fdf4', fontWeight:700, borderTop:'2px solid #86efac' }}>
                                  <td style={{ padding:'3px 7px', color:'#166534' }}>AVG ({bags.length})</td>
                                  <td style={{ padding:'3px 5px', textAlign:'center', color:'#166534' }}>{avg(bags,'moisture_pct')}%</td>
                                  <td style={{ padding:'3px 5px', textAlign:'center', color:'#166534' }}>{avg(bags,'volumetrics_cc')}</td>
                                  {(['rooibos_aroma','flavour_profile','briskness','strength','cup_colour'] as const).map(f=>(
                                    <td key={f} style={{ padding:'3px 5px', textAlign:'center', color:'#166534' }}>{avg(bags,f)}</td>
                                  ))}
                                  <td colSpan={3} style={{ padding:'3px 7px', color:'#9ca3af', fontSize:9 }}>
                                    {bags.filter((b: any)=>b.pass_reject==='Pass').length}/{bags.length} Pass
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── InlineEditCell (used in PastSensorialTable) ──────────────────────────────
function InlineEditCell({ value, onSave }: { value: any; onSave: (v: any) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  if (editing) return (
    <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
      onBlur={()=>{ onSave(draft); setEditing(false) }}
      onKeyDown={e=>{ if(e.key==='Enter'){onSave(draft);setEditing(false)} if(e.key==='Escape')setEditing(false) }}
      style={{ width:55, padding:'2px 4px', border:'1.5px solid #1f4e79', borderRadius:4, fontSize:10, textAlign:'center' }}/>
  )
  return (
    <span onClick={()=>{ setDraft(value==null?'':String(value)); setEditing(true) }}
      style={{ cursor:'pointer', padding:'2px 6px', borderRadius:4, display:'inline-block', minWidth:36, textAlign:'center' }}
      title="Click to edit">
      {value==null||value===''?<span style={{color:'#d1d5db'}}>—</span>:String(value)}
    </span>
  )
}

export default function PasteuriserPage() {
  const { p } = useAuth()
  const isAdmin         = p('can_delete_runs')
  const canWriteQuality = p('can_create_runs')
  const [tab, setTab] = useState('rundash')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="bg-surface-card border-b border-surface-rule px-5 flex gap-0 overflow-x-auto flex-shrink-0">
        {TABS.map((t,i) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap ${tab===t.key?'border-brand text-brand':'border-transparent text-text-muted hover:text-text hover:border-surface-rule'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 max-w-[1400px] w-full mx-auto">
        {tab === 'rundash'   && <RunDashboard isAdmin={canWriteQuality} />}
        {tab === 'specs'     && <SpecificationsTab isAdmin={canWriteQuality} />}
      </div>
    </div>
  )
}

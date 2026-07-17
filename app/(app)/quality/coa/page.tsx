'use client'

// app/(app)/quality/coa/page.tsx
//
// COA (Certificate of Analysis) Generator.
//
// The lab manager types a BATCH NUMBER — the single join key across every
// source — and the generator pulls the matching data and populates a standard,
// customer-specific COA:
//
//   • Header (grade, production date, customer)  ← pasteuriser batch
//     (invoice, order, destination, quantities, best-before) ← typed on the form
//   • Microbiology  ← Final Product Lab Results (test_type = 'micro')
//   • Cut length / sieving  ← pasteuriser sieve samples, averaged across the batch
//     (the pasteuriser sieve mesh set >6/>10/>12/>16/>20/>60/Dust matches the COA)
//   • Moisture / Bulk Density  ← pasteuriser samples, averaged
//   • Pesticide residue  ← Lab Results (test_type = 'residue')
//   • Pyrrolizidine Alkaloids  ← Lab Results (test_type = 'pa_final')
//   • Heavy metals / MOSH-MOAH  ← Lab Results (optional)
//   • Description of goods + Sensorical properties  ← standard wording
//
// Which optional blocks appear will ultimately be driven by a per-customer
// template under Customer Specs (added later). Until then, every block that
// has data auto-appears and can be toggled; specs are editable inline.
//
// Wording is centralised in COA_WORDING so every generated COA reads identically.

import { useState, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { jsPDF } from 'jspdf'

// ─── Standard wording (identical across every COA) ────────────────────────────

const COA_WORDING = {
  descriptionConventional:
    'A herbal tea, comprising of the needle like leaves of the plant Aspalathus linearis (Rooibos), after it has been cut, bruised, fermented, dried, pasteurised, dried and packaged.',
  descriptionOrganic:
    'An organic herbal tea, comprising of the needle like leaves of the plant Aspalathus linearis (Rooibos), after it has been cut, bruised, fermented, dried, pasteurised, dried and packaged.',
  residueRegulation:
    'As prescribed by EU Commission Regulation (EC) No. 1881/2006 of December 19, 2006, with amendments.',
  sensorical: 'Reddish brown liquid with a characteristic aroma and taste of rooibos',
  company: 'Cape Natural Tea Products (Pty) Ltd',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Normalise a batch number for matching across sources — case, whitespace and
// separator variants ("26138-CON-SG" / "26138 CON SG" / "26138/CON/SG") all
// collapse to the same key.
function normBatch(b: string | null | undefined) {
  return (b ?? '').trim().toUpperCase().replace(/[\s_/]+/g, '-').replace(/-+/g, '-')
}

function parseData(r: any) {
  try { return typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}) } catch { return {} }
}

function avg(nums: number[]): number | null {
  const v = nums.filter(n => !isNaN(n))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

// Best-before = production date + 3 years, formatted "Month YYYY" like the COA.
function bestBefore(productionDate: string): string {
  if (!productionDate) return ''
  const d = new Date(productionDate + (productionDate.length <= 7 ? '-01' : ''))
  if (isNaN(d.getTime())) return ''
  d.setFullYear(d.getFullYear() + 3)
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}
function monthYear(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + (dateStr.length <= 7 ? '-01' : ''))
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

// COA-standard result display for a micro organism value.
function microDisplay(key: string, raw: any): string {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const low = s.toLowerCase()
  if (key === 'salmonella_25g' || key === 'salmonella') return low.includes('absent') || low.includes('not') || s.startsWith('<') ? 'Absent' : s
  if (key === 'listeria' || key === 'ecoli_o157' || key === 'ecoli')
    return low.includes('not') || low.includes('absent') || /^<\s*\d/.test(s) ? 'Not detected' : s
  return s
}

const MICRO_ROWS: { key: string; label: string; specDefault: string }[] = [
  { key: 'tpc',            label: 'Total Plate Count',      specDefault: '<300 000' },
  { key: 'ecoli',          label: 'E.coli',                 specDefault: 'Not Detected' },
  { key: 'salmonella_25g', label: 'Salmonella spp',         specDefault: 'Absent/25g' },
  { key: 'listeria',       label: 'Listeria monocytogenes', specDefault: 'Absent/25g' },
  { key: 'ecoli_o157',     label: 'E.coli O157',            specDefault: 'Not detected' },
  { key: 'yeast',          label: 'Yeast',                  specDefault: '<5000' },
  { key: 'mould',          label: 'Mould',                  specDefault: '<5000' },
]

const CUT_LENGTH_ROWS: { key: string; label: string }[] = [
  { key: 'gt6',  label: '>6 mesh' },
  { key: 'gt10', label: '>10 mesh' },
  { key: 'gt12', label: '>12 mesh' },
  { key: 'gt16', label: '>16 mesh' },
  { key: 'gt20', label: '>20 mesh' },
  { key: 'gt60', label: '>60 mesh' },
  { key: 'dust', label: 'Dust - 60' },
]

interface CoaLine { label: string; spec: string; result: string }
interface CoaModel {
  batch: string
  found: { pasteuriser: boolean; micro: boolean; residue: boolean; pa: boolean; heavyMetals: boolean; moshMoah: boolean; sieving: boolean }
  header: Record<string, string>
  isOrganic: boolean
  micro: CoaLine[]
  cutLength: CoaLine[]
  other: CoaLine[]
  sections: { micro: boolean; cutLength: boolean; residue: boolean; pa: boolean; heavyMetals: boolean; moshMoah: boolean }
}

const inp = 'px-2 py-1 border border-gray-300 rounded text-[12px] outline-none focus:border-blue-500'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CoaGeneratorPage() {
  const { p } = useAuth()
  const canUse = p('can_save_lab_results') || p('can_approve_runs')
  const db = getDb()

  const [batchInput, setBatchInput] = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [model, setModel]           = useState<CoaModel | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const lookup = useCallback(async (batchRaw: string) => {
    const batch = batchRaw.trim()
    if (!batch) return
    setLoading(true); setError(''); setModel(null)
    const key = normBatch(batch)

    // Pull every source in parallel, then match on the normalised batch number.
    const [pRes, lRes, sRes] = await Promise.all([
      db.schema('qms').from('quality_records').select('*').eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run').order('created_at', { ascending: false }).limit(1000),
      db.schema('qms').from('lab_results').select('*').order('created_at', { ascending: false }).limit(2000),
      db.schema('qms').from('sd_runs').select('*').order('created_at', { ascending: false }).limit(2000),
    ])

    // ── Pasteuriser batch (header + moisture/BD + sieve/cut-length averages) ──
    const pastRow = (pRes.data ?? []).map((r: any) => ({ ...r, d: parseData(r) }))
      .find((r: any) => normBatch(r.batch_number || r.d.batch_number) === key)
    const past = pastRow?.d
    const samples: any[] = past?.samples ?? []
    const mbSamples   = samples.filter(s => s.has_mb)
    const sieveSamples = samples.filter(s => s.has_sieve)

    const moistureAvg = avg(mbSamples.map(s => parseFloat(s.moisture)))
    const bdAvg       = avg(mbSamples.map(s => parseFloat(s.untapped_bd)))
    const cutLength: CoaLine[] = CUT_LENGTH_ROWS.map(row => {
      const a = avg(sieveSamples.map(s => parseFloat(s[row.key])))
      return { label: row.label, spec: '', result: a != null ? `${a.toFixed(1).replace('.', ',')}%` : '' }
    })
    const hasSieve = sieveSamples.length > 0 && cutLength.some(c => c.result !== '')

    // ── Lab results for this batch, indexed by test type ──
    const labFor = (t: string) => (lRes.data ?? []).find((r: any) => r.test_type === t && normBatch(r.batch_no) === key)
    const microRec  = labFor('micro')
    const residueRec = labFor('residue')
    const paRec     = labFor('pa_final')
    const hmRec     = labFor('heavy_metals')
    const moshRec   = labFor('mosh_moah')

    // ── Microbiology rows ──
    const microData = microRec ? (microRec.results || microRec) : {}
    const micro: CoaLine[] = MICRO_ROWS
      .map(r => ({ key: r.key, label: r.label, spec: r.specDefault, result: microDisplay(r.key, microData[r.key]) }))
      .filter(r => r.result !== '')   // only rows the lab actually reported
      .map(({ label, spec, result }) => ({ label, spec, result }))

    // ── Other analysis rows ──
    const isOrganic = !!(past?.is_organic) || /org/i.test(past?.variant || '') || /organic|org/i.test(key)
    const residueResult = residueRec ? coaComplies(residueRec) : ''
    const paResult      = paRec ? coaComplies(paRec) : ''

    const other: CoaLine[] = []
    if (moistureAvg != null) other.push({ label: 'Moisture', spec: '<10%', result: `${moistureAvg.toFixed(1).replace('.', ',')}%` })
    if (bdAvg != null)       other.push({ label: 'Bulk Density', spec: '280 – 340cc/100g', result: `${Math.round(bdAvg)}cc/100g` })
    other.push({ label: 'Foreign Material', spec: '<1%', result: '0.0%' })
    if (residueRec) other.push({ label: 'Pesticide residue', spec: COA_WORDING.residueRegulation, result: residueResult })
    if (paRec)      other.push({ label: 'Pyrrolizidine Alkaloids', spec: '<50 μg', result: paResult })
    if (hmRec)      other.push({ label: 'Heavy Metals', spec: '', result: coaComplies(hmRec) })
    if (moshRec)    other.push({ label: 'MOSH/MOAH', spec: '', result: coaComplies(moshRec) })
    other.push({ label: 'Sensorical Properties', spec: COA_WORDING.sensorical, result: 'Complies' })

    const built: CoaModel = {
      batch,
      found: {
        pasteuriser: !!past, micro: !!microRec, residue: !!residueRec, pa: !!paRec,
        heavyMetals: !!hmRec, moshMoah: !!moshRec, sieving: hasSieve,
      },
      isOrganic,
      header: {
        date_of_issue: new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
        batch_number: past?.batch_number || batch,
        grade: past?.type_grade || [past?.grade, past?.variant].filter(Boolean).join(' ') || '',
        destination: past?.customer || '',
        production_date: monthYear(past?.production_date || ''),
        best_before: bestBefore(past?.production_date || ''),
        invoice_no: '', order_number: '', quantity_kg: '', quantity_bags: '',
      },
      micro, cutLength, other,
      sections: {
        micro: !!microRec, cutLength: hasSieve, residue: !!residueRec,
        pa: !!paRec, heavyMetals: !!hmRec, moshMoah: !!moshRec,
      },
    }
    setModel(built)
    if (!past && !microRec && !residueRec) setError(`No pasteuriser or lab data found for batch "${batch}".`)
    setLoading(false)
  }, [db])

  // ── Field mutators ──
  const setHeader = (k: string, v: string) => setModel(m => m ? { ...m, header: { ...m.header, [k]: v } } : m)
  const setLine = (section: 'micro' | 'cutLength' | 'other', i: number, field: 'spec' | 'result', v: string) =>
    setModel(m => m ? { ...m, [section]: (m as any)[section].map((l: CoaLine, idx: number) => idx === i ? { ...l, [field]: v } : l) } : m)
  const toggleSection = (s: keyof CoaModel['sections']) =>
    setModel(m => m ? { ...m, sections: { ...m.sections, [s]: !m.sections[s] } } : m)

  const description = model?.isOrganic ? COA_WORDING.descriptionOrganic : COA_WORDING.descriptionConventional

  // ── Outstanding data (sections that are on but have no source) ──
  const outstanding: string[] = []
  if (model) {
    if (!model.found.pasteuriser) outstanding.push('Pasteuriser batch (grade, moisture, bulk density)')
    if (model.sections.micro && !model.found.micro) outstanding.push('Microbiology results')
    if (model.sections.cutLength && !model.found.sieving) outstanding.push('Sieving / cut-length (pasteuriser sieve samples)')
    if (model.sections.residue && !model.found.residue) outstanding.push('Pesticide residue')
    if (model.sections.pa && !model.found.pa) outstanding.push('Pyrrolizidine Alkaloids')
    if (model.sections.heavyMetals && !model.found.heavyMetals) outstanding.push('Heavy metals')
    if (model.sections.moshMoah && !model.found.moshMoah) outstanding.push('MOSH/MOAH')
  }

  if (!canUse) return <div className="p-5 text-[13px] text-gray-500">You don't have permission to generate COAs.</div>

  return (
    <div className="p-5 max-w-[900px] mx-auto">
      <style>{`@media print { body * { visibility: hidden; } .coa-print, .coa-print * { visibility: visible; } .coa-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>

      <div className="mb-4 no-print">
        <h1 className="font-bold text-[22px]">📋 COA Generator</h1>
        <p className="text-[12px] text-gray-500">Type a batch number — data is pulled from Pasteuriser, its sieve samples, and Final Product Lab Results.</p>
      </div>

      {/* Batch search */}
      <div className="flex gap-2 mb-4 no-print">
        <input value={batchInput} onChange={e => setBatchInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') lookup(batchInput) }}
          placeholder="e.g. 26138-CON-SG"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-[13px] font-mono outline-none focus:border-blue-500" />
        <button onClick={() => lookup(batchInput)} disabled={loading}
          className="px-5 py-2 rounded-lg text-white text-[13px] font-bold disabled:opacity-50" style={{ background: '#1f4e79' }}>
          {loading ? 'Loading…' : 'Generate'}
        </button>
      </div>

      {error && <div className="mb-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 no-print">{error}</div>}

      {model && (
        <>
          {/* Outstanding + section toggles */}
          <div className="mb-4 grid grid-cols-2 gap-3 no-print">
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-[11px] font-bold uppercase text-gray-500 mb-2">Data sources</div>
              {([['pasteuriser','Pasteuriser'],['micro','Microbiology'],['sieving','Sieving / cut-length'],['residue','Residue'],['pa','Pyrrolizidine Alkaloids'],['heavyMetals','Heavy metals'],['moshMoah','MOSH/MOAH']] as const).map(([k,l]) => (
                <div key={k} className="flex items-center justify-between text-[12px] py-0.5">
                  <span>{l}</span>
                  <span className={(model.found as any)[k] ? 'text-green-700 font-semibold' : 'text-gray-400'}>
                    {(model.found as any)[k] ? '✓ found' : '— none'}
                  </span>
                </div>
              ))}
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-[11px] font-bold uppercase text-gray-500 mb-2">Include sections</div>
              {([['micro','Microbiology'],['cutLength','Cut length / sieving'],['residue','Pesticide residue'],['pa','Pyrrolizidine Alkaloids'],['heavyMetals','Heavy metals'],['moshMoah','MOSH/MOAH']] as const).map(([k,l]) => (
                <label key={k} className="flex items-center gap-2 text-[12px] py-0.5 cursor-pointer">
                  <input type="checkbox" checked={model.sections[k]} onChange={() => toggleSection(k)} />
                  {l}
                </label>
              ))}
            </div>
          </div>

          {outstanding.length > 0 && (
            <div className="mb-4 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 no-print">
              ⚠ Outstanding — included but no data yet: {outstanding.join(' · ')}
            </div>
          )}

          <div className="flex gap-2 mb-4 no-print">
            <button onClick={() => window.print()} className="px-4 py-2 rounded-lg border border-gray-300 text-[12px] font-semibold">🖨 Print</button>
            <button onClick={() => exportPdf(model, description)} className="px-4 py-2 rounded-lg text-white text-[12px] font-bold" style={{ background: '#166534' }}>⬇ Export PDF</button>
          </div>

          {/* ── COA preview (editable) ── */}
          <div ref={printRef} className="coa-print bg-white border border-gray-300 rounded-lg p-6 text-[12px]" style={{ color: '#111' }}>
            <div className="text-center font-bold text-[16px] tracking-wide mb-4 border-b-2 border-gray-800 pb-2">CERTIFICATE OF ANALYSIS</div>

            {/* Header grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mb-4">
              {([
                ['date_of_issue','DATE OF ISSUE'],['batch_number','BATCH NUMBER'],
                ['invoice_no','INVOICE No.'],['grade','GRADE'],
                ['destination','DESTINATION'],['quantity_bags','QUANTITY OF BAGS'],
                ['order_number','ORDER NUMBER'],['production_date','PRODUCTION DATE'],
                ['quantity_kg',"QUANTITY (Kg's)"],['best_before','BEST BEFORE DATE'],
              ] as const).map(([k,l]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="font-bold text-[10px] uppercase text-gray-600 w-[130px] shrink-0">{l}</span>
                  <input value={model.header[k] || ''} onChange={e => setHeader(k, e.target.value)}
                    className="flex-1 px-1.5 py-0.5 border-b border-dashed border-gray-300 text-[12px] outline-none focus:border-blue-500 bg-transparent" />
                </div>
              ))}
            </div>

            {/* Description */}
            <div className="mb-3">
              <div className="font-bold text-[11px] uppercase mb-1">Description of Goods</div>
              <div className="text-[11px] italic">{description}</div>
            </div>

            {/* Microbiology */}
            {model.sections.micro && (
              <CoaTable title="Microbiological Analyses" cols={['Organism', "Specification (cfu's/g)", "Result (cfu's/g)"]}
                lines={model.micro} onEdit={(i, f, v) => setLine('micro', i, f, v)} />
            )}

            {/* Cut length */}
            {model.sections.cutLength && (
              <CoaTable title="Cut Length Guidelines" cols={['Sieve Size', 'Specification', 'Result']}
                lines={model.cutLength} onEdit={(i, f, v) => setLine('cutLength', i, f, v)} />
            )}

            {/* Other analysis */}
            <CoaTable title="Other Analysis" cols={['Description', 'Specification', 'Result']}
              lines={model.other.filter(l => {
                if (l.label === 'Pesticide residue') return model.sections.residue
                if (l.label === 'Pyrrolizidine Alkaloids') return model.sections.pa
                if (l.label === 'Heavy Metals') return model.sections.heavyMetals
                if (l.label === 'MOSH/MOAH') return model.sections.moshMoah
                return true
              })}
              onEdit={(i, f, v) => {
                // map filtered index back to full `other` array
                const shown = model.other.filter(l => {
                  if (l.label === 'Pesticide residue') return model.sections.residue
                  if (l.label === 'Pyrrolizidine Alkaloids') return model.sections.pa
                  if (l.label === 'Heavy Metals') return model.sections.heavyMetals
                  if (l.label === 'MOSH/MOAH') return model.sections.moshMoah
                  return true
                })
                const target = shown[i]
                const realIdx = model.other.indexOf(target)
                if (realIdx >= 0) setLine('other', realIdx, f, v)
              }} />

            <div className="mt-6 text-[10px] text-gray-500">{COA_WORDING.company}</div>
          </div>
        </>
      )}

      {/* ── Filled-in example template (always shown, read-only) ── */}
      <SampleCoa />
    </div>
  )
}

// ─── Filled-in example template ───────────────────────────────────────────────
// A read-only, fully-populated sample COA so anyone can see exactly how a
// generated certificate looks and what each block maps to. Uses the real
// 26138-CON-SG example values. Purely illustrative — not saved anywhere.

function SampleCoa() {
  const [open, setOpen] = useState(true)
  const header: [string, string][] = [
    ['DATE OF ISSUE', '02.06.2026'], ['BATCH NUMBER', '26138-CON-SG'],
    ['INVOICE No.', 'BH-INV0000189'], ['GRADE', 'Super Grade'],
    ['DESTINATION', 'Motherwell Investments (Pty) Ltd'], ['QUANTITY OF BAGS', '1600 x 18kg'],
    ['ORDER NUMBER', 'PO 1185'], ['PRODUCTION DATE', 'May 2026'],
    ["QUANTITY (Kg's)", '28 800kg'], ['BEST BEFORE DATE', 'May 2029'],
  ]
  const micro: CoaLine[] = [
    { label: 'Total Plate Count', spec: '<300 000', result: '140' },
    { label: 'E.coli', spec: 'Not Detected', result: 'Not detected' },
    { label: 'Salmonella', spec: 'Absent/25g', result: 'Absent' },
    { label: 'Yeast', spec: '<5000', result: '20' },
    { label: 'Mould', spec: '<5000', result: '<10' },
  ]
  const other: CoaLine[] = [
    { label: 'Moisture', spec: '<10%', result: '7,9%' },
    { label: 'Bulk Density', spec: '280 – 340cc/100g', result: '287cc/100g' },
    { label: 'Foreign Material', spec: '<1%', result: '0.0%' },
    { label: 'Pesticide residue', spec: COA_WORDING.residueRegulation, result: 'Complies' },
    { label: 'Sensorical Properties', spec: COA_WORDING.sensorical, result: 'Complies' },
  ]
  return (
    <div className="mt-8 no-print">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-[12px] font-semibold text-gray-600 mb-2">
        <span>{open ? '▼' : '▶'}</span> 📄 Example template — how a completed COA looks (sample data)
      </button>
      {open && (
        <div className="bg-white border border-gray-300 rounded-lg p-6 text-[12px] opacity-95" style={{ color: '#111' }}>
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3 inline-block">
            Illustrative sample only — batch 26138-CON-SG. Enter a real batch above to generate an editable COA.
          </div>
          <div className="text-center font-bold text-[16px] tracking-wide mb-4 border-b-2 border-gray-800 pb-2">CERTIFICATE OF ANALYSIS</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mb-4">
            {header.map(([l, v]) => (
              <div key={l} className="flex items-center gap-2">
                <span className="font-bold text-[10px] uppercase text-gray-600 w-[130px] shrink-0">{l}</span>
                <span className="flex-1 text-[12px] border-b border-dashed border-gray-200 pb-0.5">{v}</span>
              </div>
            ))}
          </div>
          <div className="mb-3">
            <div className="font-bold text-[11px] uppercase mb-1">Description of Goods</div>
            <div className="text-[11px] italic">{COA_WORDING.descriptionConventional}</div>
          </div>
          <SampleTable title="Microbiological Analyses" cols={['Organism', "Specification (cfu's/g)", "Result (cfu's/g)"]} lines={micro} />
          <SampleTable title="Other Analysis" cols={['Description', 'Specification', 'Result']} lines={other} />
          <div className="mt-6 text-[10px] text-gray-500">{COA_WORDING.company}</div>
        </div>
      )}
    </div>
  )
}

function SampleTable({ title, cols, lines }: { title: string; cols: string[]; lines: CoaLine[] }) {
  return (
    <div className="mb-3">
      <div className="font-bold text-[11px] uppercase mb-1">{title}</div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className="border border-gray-300 bg-gray-100 px-2 py-1 text-center font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="border border-gray-300 px-2 py-1">{l.label}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{l.spec}</td>
              <td className="border border-gray-300 px-2 py-1 text-center font-semibold">{l.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Result string for a "Complies / None detected" style block from a lab record.
function coaComplies(rec: any): string {
  const d = rec.results || rec
  const status = String(d.overall_status || rec.overall_status || '').toLowerCase()
  if (Array.isArray(d.compounds_detected) && d.compounds_detected.length === 0) return 'None detected'
  if (Array.isArray(d.analytes) && d.analytes.length === 0) return 'Complies'
  if (status.includes('pass') || status.includes('compl')) return 'Complies'
  if (status.includes('fail') || status.includes('exceed')) return 'Does not comply'
  return 'Complies'
}

// ─── Editable COA table ───────────────────────────────────────────────────────

function CoaTable({ title, cols, lines, onEdit }: {
  title: string; cols: string[]; lines: CoaLine[]; onEdit: (i: number, field: 'spec' | 'result', v: string) => void
}) {
  return (
    <div className="mb-3">
      <div className="font-bold text-[11px] uppercase mb-1">{title}</div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className="border border-gray-300 bg-gray-100 px-2 py-1 text-center font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="border border-gray-300 px-2 py-1">{l.label}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-center">
                <input value={l.spec} onChange={e => onEdit(i, 'spec', e.target.value)}
                  className="w-full text-center text-[11px] outline-none bg-transparent focus:bg-blue-50" />
              </td>
              <td className="border border-gray-300 px-1 py-0.5 text-center">
                <input value={l.result} onChange={e => onEdit(i, 'result', e.target.value)}
                  className="w-full text-center text-[11px] outline-none bg-transparent focus:bg-blue-50 font-semibold" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── PDF export (jsPDF, laid out to mirror the template) ──────────────────────

function exportPdf(model: CoaModel, description: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('CERTIFICATE OF ANALYSIS', pageW / 2, y, { align: 'center' })
  doc.setLineWidth(1.2); doc.line(margin, y + 6, pageW - margin, y + 6)
  y += 26

  // Header — two columns
  const hdr: [string, string][] = [
    ['DATE OF ISSUE', model.header.date_of_issue], ['BATCH NUMBER', model.header.batch_number],
    ['INVOICE No.', model.header.invoice_no], ['GRADE', model.header.grade],
    ['DESTINATION', model.header.destination], ['QUANTITY OF BAGS', model.header.quantity_bags],
    ['ORDER NUMBER', model.header.order_number], ['PRODUCTION DATE', model.header.production_date],
    ["QUANTITY (Kg's)", model.header.quantity_kg], ['BEST BEFORE DATE', model.header.best_before],
  ]
  doc.setFontSize(8)
  const colX = [margin, pageW / 2 + 10]
  for (let i = 0; i < hdr.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const item = hdr[i + c]; if (!item) continue
      const x = colX[c]
      doc.setFont('helvetica', 'bold'); doc.text(item[0], x, y)
      doc.setFont('helvetica', 'normal'); doc.text(String(item[1] || ''), x + 95, y)
    }
    y += 15
  }
  y += 8

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('DESCRIPTION OF GOODS', margin, y); y += 12
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8)
  const descLines = doc.splitTextToSize(description, pageW - 2 * margin)
  doc.text(descLines, margin, y); y += descLines.length * 10 + 8

  const drawTable = (title: string, cols: string[], lines: CoaLine[]) => {
    if (!lines.length) return
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(title.toUpperCase(), margin, y); y += 12
    const w = pageW - 2 * margin
    const cw = [w * 0.4, w * 0.32, w * 0.28]
    doc.setFontSize(8)
    // header row
    doc.setFillColor(230, 230, 230); doc.rect(margin, y - 9, w, 14, 'F')
    doc.setFont('helvetica', 'bold')
    let cx = margin
    cols.forEach((c, i) => { doc.text(c, cx + 4, y); cx += cw[i] })
    y += 6
    doc.setFont('helvetica', 'normal')
    lines.forEach(l => {
      const vals = [l.label, l.spec, l.result]
      const cellLines = vals.map((v, i) => doc.splitTextToSize(String(v || ''), cw[i] - 8))
      const rowH = Math.max(...cellLines.map(cl => cl.length)) * 9 + 4
      cx = margin
      doc.setDrawColor(200); doc.rect(margin, y - 2, w, rowH)
      vals.forEach((_, i) => { doc.text(cellLines[i], cx + 4, y + 7); if (i > 0) doc.line(cx, y - 2, cx, y - 2 + rowH); cx += cw[i] })
      y += rowH
    })
    y += 10
  }

  if (model.sections.micro) drawTable('Microbiological Analyses', ['Organism', "Spec (cfu's/g)", "Result (cfu's/g)"], model.micro)
  if (model.sections.cutLength) drawTable('Cut Length Guidelines', ['Sieve Size', 'Specification', 'Result'], model.cutLength)
  drawTable('Other Analysis', ['Description', 'Specification', 'Result'], model.other.filter(l => {
    if (l.label === 'Pesticide residue') return model.sections.residue
    if (l.label === 'Pyrrolizidine Alkaloids') return model.sections.pa
    if (l.label === 'Heavy Metals') return model.sections.heavyMetals
    if (l.label === 'MOSH/MOAH') return model.sections.moshMoah
    return true
  }))

  doc.save(`COA_${normBatch(model.batch)}.pdf`)
}

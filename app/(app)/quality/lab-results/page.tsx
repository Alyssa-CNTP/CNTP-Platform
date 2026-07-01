'use client'

// app/(app)/quality/lab-results/page.tsx
// Full parity with TestTab in CNTPquality Express app.
// PDF upload → Express /api/upload → extract_only review panel → save to qms.lab_results

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { isoDateTime } from '@/lib/utils/formatDate'
import { exportTableXlsx } from '@/lib/utils/exportExcel'
import { RefreshCw, History, AlertTriangle, X } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

const TEST_TYPES = [
  { key:'micro',       label:'🦠 Micro',         icon:'🦠', desc:'TPC · E.Coli · Salmonella · Listeria' },
  { key:'residue',     label:'🌿 Residue',        icon:'🌿', desc:'Multi-residue pesticide screening' },
  { key:'heavy_metals',label:'⚗️ Heavy Metals',   icon:'⚗️', desc:'Lead · Cadmium · Mercury · Arsenic' },
  { key:'eto',         label:'🧪 EtO',             icon:'🧪', desc:'Ethylene oxide + 2-Chloroethanol' },
  { key:'aflatoxins',  label:'🍄 Aflatoxins',      icon:'🍄', desc:'B1 · B2 · G1 · G2 · Ochratoxin A' },
  { key:'mosh_moah',   label:'🛢 MOSH/MOAH',       icon:'🛢', desc:'Mineral oil hydrocarbons' },
  { key:'pa_final',    label:'💊 PAs',             icon:'💊', desc:'PA/TA Final · EU limits · Scopolamine' },
  { key:'glyphosate',  label:'🧫 Glyphosate',      icon:'🧫', desc:'Glyphosate · AMPA · Glufosinate' },
] as const

type TestType = typeof TEST_TYPES[number]['key']

interface LabResult {
  id: number; batch_no: string|null; test_type: string|null; lab_name: string|null
  order_no: string|null; date_issued: string|null; date_received: string|null
  results: any; overall_status: string|null; comment: string|null
  pdf_path: string|null; created_at: string
}

// ─── Column definitions per test type ────────────────────────────────────────

const COLS: Record<string, [string,string][]> = {
  micro: [
    ['ecoli','E. coli'],['tpc','TPC'],['yeast','Yeast'],['mould','Mould'],
    ['staph','Staph. aureus'],['salmonella_25g','Salm. 25g'],['salmonella_375g','Salm. 375g'],
    ['listeria','Listeria'],['coliforms','Coliforms'],['enterobacteriaceae','Enterobact.'],
    ['bacillus_cereus','B. cereus'],['overall_status','Overall'],
  ],
  residue: [['compound','Compound'],['result','Result'],['unit','Unit'],['mrl','MRL (mg/kg)'],['spec','Spec'],['status','Status']],
  heavy_metals: [['analyte','Metal'],['result','Result'],['unit','Unit'],['spec','Spec'],['status','Status']],
  eto: [['analyte','Analyte'],['result','Result'],['unit','Unit'],['spec','Spec'],['status','Status']],
  aflatoxins: [['analyte','Analyte'],['result','Result'],['unit','Unit'],['spec','Spec'],['status','Status']],
  mosh_moah: [['analyte','Analyte'],['result','Result'],['unit','Unit'],['spec','Spec'],['status','Status']],
  pa_final:  [['analyte','PA/TA Analyte'],['result','Result (µg/kg)'],['unit','Unit'],['spec','EU Limit'],['status','Status']],
  glyphosate:[['analyte','Analyte'],['result','Result'],['unit','Unit'],['spec','Spec'],['status','Status']],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: string|null) {
  if (!s) return '#374151'
  const u = s.toUpperCase()
  if (u === 'PASS' || u === 'COMPLIES') return '#166534'
  if (u === 'FAIL' || u === 'EXCEEDS') return '#dc2626'
  return '#374151'
}

function StatusBadge({ s }: { s: string|null }) {
  if (!s) return <span style={{ color:'#9ca3af', fontSize:10 }}>—</span>
  const color = statusColor(s)
  const bg    = color === '#166534' ? '#dcfce7' : color === '#dc2626' ? '#fee2e2' : '#f3f4f6'
  return <span style={{ fontSize:9, padding:'2px 8px', borderRadius:10, background:bg, color, fontWeight:700 }}>{s}</span>
}

/** Expand a single LabResult record into display rows (mirrors Express allRows logic) */
function expandRecord(r: LabResult): any[] {
  const d = r.results || r
  const batchKey = r.batch_no || '—'

  if (d.compounds_detected && Array.isArray(d.compounds_detected)) {
    if (d.compounds_detected.length === 0)
      return [{ batch_no:batchKey, id:r.id, created_at:r.created_at, compound:'NONE DETECTED', analyte:'NONE DETECTED', result:'—', unit:'—', mrl:'—', spec:'—', status:d.overall_status||'PASS' }]
    return d.compounds_detected.map((c: any) => {
      const isFP = c.result_mg_kg !== undefined
      return {
        batch_no:batchKey, id:r.id, created_at:r.created_at,
        compound: c.compound_name||'—', analyte: c.compound_name||'—',
        result: isFP ? (c.result_mg_kg!=null?String(c.result_mg_kg):'—') : (`${c.detected_value_prefix||''}${c.detected_value_mg_kg??''}`||'—'),
        unit:'mg/kg',
        mrl: isFP?(c.default_export_mrl!=null?c.default_export_mrl:'—'):(c.mrl_eu_mg_kg!=null?c.mrl_eu_mg_kg:'—'),
        spec: isFP?(c.default_export_mrl!=null?`≤${c.default_export_mrl}`:'—'):(c.mrl_eu_mg_kg!=null?`≤${c.mrl_eu_mg_kg}`:'—'),
        status: isFP?(d.overall_status||'PASS'):(c.eu_mrl_exceeded?'Fail':'Pass'),
      }
    })
  }

  // pa_final old flat format → convert to analytes array
  if (!d.analytes && (d.total_pa_eu !== undefined || d.total_pa_bfr28 !== undefined)) {
    const entries: any[] = []
    if (d.total_pa_eu      !== undefined) entries.push({ analyte:'Total PA (EU 2023/915)', result:d.total_pa_eu,      unit:d.unit||'µg/kg', spec:'≤400',  status: d.total_pa_eu!=null&&parseFloat(d.total_pa_eu)>400  ?'Fail':'Pass' })
    if (d.total_pa_bfr28   !== undefined) entries.push({ analyte:'Total PA (BfR 28)',      result:d.total_pa_bfr28,   unit:d.unit||'µg/kg', spec:'—',     status:'—' })
    if (d.scopolamine_total !== undefined) entries.push({ analyte:'Scopolamine',            result:d.scopolamine_total,unit:d.unit||'µg/kg', spec:'—',     status:'—' })
    if (d.total_ta          !== undefined) entries.push({ analyte:'Total TA',               result:d.total_ta,         unit:d.unit||'µg/kg', spec:'≤1000', status: d.total_ta!=null&&parseFloat(d.total_ta)>1000?'Fail':'Pass' })
    if (entries.length === 0) return [{ batch_no:batchKey, id:r.id, created_at:r.created_at, analyte:'No data', result:'—', unit:'—', spec:'—', status:d.overall_status||'—' }]
    return entries.map((a: any) => ({
      batch_no:batchKey, id:r.id, created_at:r.created_at,
      compound:a.analyte, analyte:a.analyte,
      result: a.result!=null&&a.result!=='' ? String(a.result) : 'None detected',
      unit:a.unit, mrl:a.spec, spec:a.spec, status:a.status,
    }))
  }

  if (d.analytes && Array.isArray(d.analytes)) {
    if (d.analytes.length === 0)
      return [{ batch_no:batchKey, id:r.id, created_at:r.created_at, compound:'None detected', analyte:'None detected', result:'None detected', unit:'—', mrl:'—', spec:'—', status:d.overall_status||'Pass' }]
    return d.analytes.map((c: any) => ({
      batch_no:batchKey, id:r.id, created_at:r.created_at,
      compound:c.analyte||c.metal||'—', analyte:c.analyte||c.metal||'—',
      result: c.result!=null&&c.result!=='' ? String(c.result) : 'None detected',
      unit:c.unit||'—',
      mrl:c.eu_mrl??c.spec??'—', spec:c.spec!=null?`≤${c.spec}`:(c.eu_mrl!=null?`≤${c.eu_mrl}`:'—'),
      status:c.status||d.overall_status||'—',
    }))
  }

  // Micro or flat
  return [{ batch_no:batchKey, id:r.id, created_at:r.created_at, ...d }]
}

// ─── PDF Drop Zone ────────────────────────────────────────────────────────────

interface QueueItem { id:string; file:File; status:'pending'|'processing'|'done'|'error'; message:string }

function PdfDropZone({ testType, onExtracted }: { testType:TestType; onExtracted:(d:any)=>void }) {
  const { session } = useAuth() // needed for upload auth
  // Upload goes to Next.js API route — no external service needed
  const [drag,  setDrag]  = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const processing = useRef(false)
  const fileInput  = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    const fd = new FormData()
    fd.append('pdf', file); fd.append('workcenter','rawMaterial'); fd.append('workflow', testType)
    const res  = await fetch('/api/upload', { method:'POST', body:fd })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    return data
  }

  async function processQueue(items: QueueItem[]) {
    if (processing.current) return
    processing.current = true
    for (const item of items) {
      setQueue(q => q.map(x => x.id===item.id ? {...x,status:'processing'} : x))
      try {
        const data = await upload(item.file)
        setQueue(q => q.map(x => x.id===item.id ? {...x,status:'done',message:'Extracted'} : x))
        if (data.extract_only && data.data) onExtracted({ ...data.data, _sourceFile:item.file.name, _model_used:data.model_used||'' })
        else if (data.data) onExtracted({ ...data.data, _sourceFile:item.file.name })
      } catch (err:any) {
        setQueue(q => q.map(x => x.id===item.id ? {...x,status:'error',message:err.message} : x))
      }
      await new Promise(r => setTimeout(r,800))
    }
    processing.current = false
  }

  function addFiles(fl: FileList|null) {
    if (!fl) return
    const pdfs = Array.from(fl).filter(f => f.type==='application/pdf')
    if (!pdfs.length) return
    const items: QueueItem[] = pdfs.map(f => ({ id:Math.random().toString(36).slice(2), file:f, status:'pending', message:'' }))
    setQueue(prev => { const next = [...prev,...items]; setTimeout(()=>processQueue(items),0); return next })
  }

  const busy = queue.some(x => x.status==='processing')
  const icon = TEST_TYPES.find(t => t.key===testType)?.icon ?? '📄'
  const desc = TEST_TYPES.find(t => t.key===testType)?.desc ?? ''

  return (
    <div style={{ marginBottom:14 }}>
      <div
        onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)addFiles(e.dataTransfer.files)}}
        onClick={()=>!busy&&fileInput.current?.click()}
        style={{ position:'relative', border:`2px dashed ${drag?'#1f4e79':'#d1d5db'}`, borderRadius:10, padding:14, textAlign:'center', cursor:'pointer', background:drag?'#eff6ff':busy?'#f9fafb':'#fff', transition:'all .15s' }}>
        {busy ? (
          <>
            <div style={{ width:20, height:20, border:'2px solid #d1d5db', borderTopColor:'#1f4e79', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 6px' }}/>
            <div style={{ fontSize:11, fontWeight:600, color:'#166534' }}>Extracting with Gemini…</div>
          </>
        ) : (
          <>
            <div style={{ fontSize:20, marginBottom:4 }}>{icon}</div>
            <div style={{ fontSize:11, fontWeight:600, color:'#374151', marginBottom:2 }}>Drop {TEST_TYPES.find(t=>t.key===testType)?.label.replace(/^[^ ]+ /,'')} PDF(s) here</div>
            <div style={{ fontSize:9, color:'#9ca3af', marginBottom:6 }}>Multiple PDFs supported · {desc}</div>
            <div style={{ display:'inline-block', padding:'3px 12px', background:'#166534', color:'#fff', borderRadius:5, fontSize:10, fontWeight:600 }}>Browse PDFs</div>
          </>
        )}
        <input ref={fileInput} type="file" accept="application/pdf" multiple style={{ display:'none' }}
          onChange={e=>{addFiles(e.target.files);if(fileInput.current)fileInput.current.value=''}}/>
      </div>
      {queue.map(item => (
        <div key={item.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', marginTop:4, borderRadius:7, border:'1px solid #e5e7eb', background:item.status==='error'?'#fef2f2':item.status==='done'?'#f0fdf4':'#f9fafb', fontSize:11 }}>
          <span>{item.status==='processing'?'⏳':item.status==='done'?'✅':item.status==='error'?'❌':'🕐'}</span>
          <span style={{ flex:1, fontWeight:500 }}>{item.file.name}</span>
          {item.message && <span style={{ color:'#6b7280', fontSize:10 }}>{item.message}</span>}
          {item.status!=='processing' && <button onClick={()=>setQueue(q=>q.filter(x=>x.id!==item.id))} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer' }}>×</button>}
        </div>
      ))}
    </div>
  )
}

// ─── Review Panel ─────────────────────────────────────────────────────────────

function ReviewPanel({ data, testType, onSave, onDiscard }: { data:any; testType:TestType; onSave:(d:any,force:boolean)=>void; onDiscard:()=>void }) {
  const [pending, setPending] = useState({ ...data })
  const cols = COLS[testType] ?? []

  const metaFields: [string,string][] = [
    ['batch_no','Batch No.'],['_lab','Lab'],['lab','Lab'],
    ['_date_issued','Date Issued'],['date_validated','Date Validated'],
    ['_order','Order No.'],['lab_reference','Lab Ref'],['report_reference','Report Ref'],
    ['po_number','PO Number'],['requested_by','Requested By'],['commodity','Commodity'],
  ].filter(([f]) => pending[f] !== undefined) as [string,string][]

  return (
    <div style={{ background:'#f0fdf4', border:'2px solid #86efac', borderRadius:10, padding:16, marginBottom:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:12, color:'#166534' }}>
            ✅ Review — {TEST_TYPES.find(t=>t.key===testType)?.label}
          </div>
          {pending._sourceFile && <div style={{ fontSize:9, color:'#9ca3af', marginTop:2 }}>📄 {pending._sourceFile}</div>}
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:10, fontWeight:700, color:(pending._confidence||80)>=85?'#166534':'#d97706' }}>
            Confidence: {pending._confidence||80}%
          </div>
          <div style={{ height:4, width:80, background:'#e5e7eb', borderRadius:2, marginTop:2 }}>
            <div style={{ height:'100%', width:(pending._confidence||80)+'%', background:(pending._confidence||80)>=85?'#166534':'#d97706', borderRadius:2 }}/>
          </div>
        </div>
      </div>

      {/* Editable metadata */}
      {metaFields.length > 0 && (
        <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
          {metaFields.map(([f,l]) => (
            <div key={f} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:5, padding:'3px 8px', fontSize:10 }}>
              <span style={{ fontWeight:700, color:'#6b7280' }}>{l}: </span>
              <input value={pending[f]||''} onChange={e=>setPending((p:any)=>({...p,[f]:e.target.value}))}
                style={{ border:'none', background:'transparent', fontSize:10, width:Math.max(60,(String(pending[f]||'')).length*7) }}/>
            </div>
          ))}
        </div>
      )}

      {/* compounds_detected (residue COA) */}
      {pending.compounds_detected !== undefined && !pending.analytes && !pending.results && (
        <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:12, marginBottom:10 }}>
          <div style={{ fontWeight:700, fontSize:11, color:'#166534', marginBottom:8 }}>🔍 Extracted Results</div>
          {pending.compounds_detected.length === 0
            ? <div style={{ color:'#166534', fontWeight:600, fontSize:12 }}>✅ No residues detected → PASS</div>
            : <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead><tr style={{ background:'#166534', color:'#fff' }}>
                  {['Compound','Method','Result (mg/kg)','Export MRL','LOQ'].map(h=><th key={h} style={{ padding:'4px 8px', textAlign:'left' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {pending.compounds_detected.map((c:any,i:number)=>(
                    <tr key={i} style={{ background:i%2===0?'#fff':'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
                      <td style={{ padding:'3px 8px', fontWeight:600 }}>{c.compound_name||'—'}</td>
                      <td style={{ padding:'3px 8px', color:'#6b7280' }}>{c.method_reference||'—'}</td>
                      <td style={{ padding:'3px 8px', textAlign:'center', fontFamily:'monospace', fontWeight:700 }}>{c.result_mg_kg??'—'}</td>
                      <td style={{ padding:'3px 8px', textAlign:'center', color:'#6b7280' }}>{c.default_export_mrl??'—'}</td>
                      <td style={{ padding:'3px 8px', textAlign:'center', color:'#6b7280' }}>{c.loq??'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>}
          <div style={{ marginTop:8, fontSize:10, color:'#6b7280' }}>
            Overall: <strong style={{ color:statusColor(pending.overall_status) }}>{pending.overall_status||'PASS'}</strong>
            {pending._model_used && <span style={{ marginLeft:12, color:'#9ca3af' }}>🤖 {pending._model_used}</span>}
          </div>
        </div>
      )}

      {/* analytes array (glyphosate, heavy metals, eto, aflatoxins) */}
      {pending.analytes !== undefined && !pending.results && (
        <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:12, marginBottom:10 }}>
          <div style={{ fontWeight:700, fontSize:11, color:'#166534', marginBottom:8 }}>🔍 Extracted Results</div>
          {pending.analytes.length === 0
            ? <div style={{ color:'#166534', fontWeight:600, fontSize:12 }}>✅ None detected — all below reporting limits → PASS</div>
            : <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead><tr style={{ background:'#1f4e79', color:'#fff' }}>
                  {['Compound','Result (mg/kg)','EU MRL','Status'].map(h=><th key={h} style={{ padding:'4px 8px', textAlign:'left' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {pending.analytes.map((a:any,i:number)=>(
                    <tr key={i} style={{ background:i%2===0?'#fff':'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
                      <td style={{ padding:'3px 8px' }}>{a.analyte}</td>
                      <td style={{ padding:'3px 8px', textAlign:'center', fontFamily:'monospace', fontWeight:700 }}>{a.result}</td>
                      <td style={{ padding:'3px 8px', textAlign:'center', color:'#6b7280' }}>{a.eu_mrl??a.spec??'—'}</td>
                      <td style={{ padding:'3px 8px', textAlign:'center', fontWeight:700, color:statusColor(a.status) }}>{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>}
          <div style={{ marginTop:8, fontSize:10, color:'#6b7280' }}>
            Overall: <strong style={{ color:statusColor(pending.overall_status) }}>{pending.overall_status}</strong>
            {pending._model_used && <span style={{ marginLeft:12, color:'#9ca3af' }}>🤖 {pending._model_used}</span>}
          </div>
        </div>
      )}

      {/* Micro flat result (array or object of test keys) */}
      {testType === 'micro' && pending.results && typeof pending.results === 'object' && !Array.isArray(pending.results) && (
        <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:12, marginBottom:10 }}>
          <div style={{ fontWeight:700, fontSize:11, color:'#1f4e79', marginBottom:8 }}>🦠 Microbiology Results</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8 }}>
            {Object.entries(pending.results).filter(([k])=>k!=='overall_status').map(([k,v])=>(
              <div key={k} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px' }}>
                <div style={{ fontSize:9, color:'#6b7280', fontWeight:700, marginBottom:3, textTransform:'uppercase' }}>{k.replace(/_/g,' ')}</div>
                <input value={String(v??'')} onChange={e=>setPending((p:any)=>({...p,results:{...p.results,[k]:e.target.value}}))}
                  style={{ width:'100%', padding:'3px 6px', border:'1px solid #d1d5db', borderRadius:4, fontSize:12, fontFamily:'monospace', fontWeight:700 }}/>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:10, color:'#6b7280' }}>Overall:</span>
            <select value={pending.overall_status||'Pass'} onChange={e=>setPending((p:any)=>({...p,overall_status:e.target.value}))}
              style={{ padding:'3px 8px', borderRadius:5, border:'1px solid #d1d5db', fontSize:11, fontWeight:700 }}>
              <option>Pass</option><option>Fail</option>
            </select>
          </div>
        </div>
      )}

      {/* Flat micro object in top-level pending */}
      {testType === 'micro' && !pending.results && (pending.tpc !== undefined || pending.ecoli !== undefined) && (
        <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:12, marginBottom:10 }}>
          <div style={{ fontWeight:700, fontSize:11, color:'#1f4e79', marginBottom:8 }}>🦠 Microbiology Results</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8 }}>
            {(['tpc','ecoli','yeast','mould','staph','salmonella_25g','salmonella_125g','salmonella_375g','listeria','coliforms','enterobacteriaceae','bacillus_cereus'] as const).filter(k=>pending[k]!==undefined).map(k=>(
              <div key={k} style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:6, padding:'6px 10px' }}>
                <div style={{ fontSize:9, color:'#6b7280', fontWeight:700, marginBottom:3, textTransform:'uppercase' }}>{k.replace(/_/g,' ')}</div>
                <input value={String(pending[k]??'')} onChange={e=>setPending((p:any)=>({...p,[k]:e.target.value}))}
                  style={{ width:'100%', padding:'3px 6px', border:'1px solid #d1d5db', borderRadius:4, fontSize:12, fontFamily:'monospace', fontWeight:700 }}/>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:10, color:'#6b7280' }}>Overall:</span>
            <select value={pending.overall_status||'Pass'} onChange={e=>setPending((p:any)=>({...p,overall_status:e.target.value}))}
              style={{ padding:'3px 8px', borderRadius:5, border:'1px solid #d1d5db', fontSize:11, fontWeight:700 }}>
              <option>Pass</option><option>Fail</option>
            </select>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, justifyContent:'space-between' }}>
        <button onClick={onDiscard} style={{ padding:'6px 14px', borderRadius:7, border:'1px solid #d1d5db', background:'#fff', fontSize:12, cursor:'pointer', color:'#374151' }}>✕ Discard</button>
        <button onClick={()=>onSave(pending,false)} style={{ padding:'6px 20px', borderRadius:7, border:'none', background:'#166534', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>✓ Confirm &amp; Save</button>
      </div>
    </div>
  )
}

// ─── MicroEditCell ────────────────────────────────────────────────────────────

function MicroEditCell({ record, onSaved }: { record: any; onSaved: (r: any) => void }) {
  const db = getDb()
  const [open, setOpen]   = useState(false)
  const [form, setForm]   = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const d = record.results || record
  const MICRO_FIELDS = [
    { key:'tpc', label:'TPC' }, { key:'ecoli', label:'E. coli' },
    { key:'yeast', label:'Yeast' }, { key:'mould', label:'Mould' },
    { key:'salmonella_25g', label:'Salmonella (25g)' }, { key:'salmonella_125g', label:'Salmonella (125g)' },
    { key:'salmonella_375g', label:'Salmonella (375g)' }, { key:'listeria', label:'Listeria' },
    { key:'staph', label:'Staph. aureus' }, { key:'ecoli_o157', label:'E. coli O157' },
  ]

  function openEdit() {
    const init: any = {}
    MICRO_FIELDS.forEach(f => { init[f.key] = d[f.key]??'' })
    init.batch_no      = d.batch_no || record.batch_no || ''
    init.date_issued   = d.date_issued || record.date_issued || ''
    init.lab_name      = d.lab || record.lab_name || ''
    init.overall_status = d.overall_status || record.overall_status || 'Pass'
    setForm(init); setOpen(true)
  }

  async function save() {
    setSaving(true)
    const { data, error } = await db.schema('qms').from('lab_results')
      .update({ results: { ...d, ...form } }).eq('id', record.id).select().single()
    if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
    onSaved({ ...record, results: { ...d, ...form } })
    setOpen(false); setSaving(false)
  }

  return (
    <>
      <button onClick={openEdit}
        style={{ padding:'2px 8px', borderRadius:4, border:'1px solid #d1d5db', background:'#f9fafb', cursor:'pointer', fontSize:10, fontWeight:600 }}>
        ✏️ Edit
      </button>
      {open && form && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:12, padding:22, width:420, maxHeight:'85vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontWeight:800, fontSize:14 }}>✏️ Edit Microbiology — {form.batch_no}</div>
              <button onClick={()=>setOpen(false)} style={{ border:'none', background:'none', fontSize:18, cursor:'pointer' }}>✕</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
              {MICRO_FIELDS.filter(f => d[f.key]!=null && d[f.key]!=='').map(f => (
                <div key={f.key}>
                  <label style={{ fontSize:10, fontWeight:700, display:'block', marginBottom:2, color:'#374151' }}>{f.label}</label>
                  <input value={form[f.key]} onChange={e=>setForm((p: any)=>({...p,[f.key]:e.target.value}))}
                    style={{ width:'100%', padding:'5px 7px', border:'1px solid #d1d5db', borderRadius:5, fontSize:12, boxSizing:'border-box' }}/>
                </div>
              ))}
              <div>
                <label style={{ fontSize:10, fontWeight:700, display:'block', marginBottom:2 }}>Overall Status</label>
                <select value={form.overall_status} onChange={e=>setForm((p: any)=>({...p,overall_status:e.target.value}))}
                  style={{ width:'100%', padding:'5px 7px', border:'1px solid #d1d5db', borderRadius:5, fontSize:12, background:'#fff' }}>
                  <option>Pass</option><option>Fail</option>
                </select>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={()=>setOpen(false)} style={{ padding:'7px 14px', borderRadius:6, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontSize:12 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding:'7px 16px', borderRadius:6, border:'none', background:'#166534', color:'#fff', cursor:'pointer', fontSize:12, fontWeight:700 }}>
                {saving?'Saving…':'✓ Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── MicroTable ───────────────────────────────────────────────────────────────

function MicroTable({ records, canWrite, onDelete, onUpdate }: {
  records: any[]; canWrite: boolean; onDelete: (id:number)=>void; onUpdate: (r:any)=>void
}) {
  const ORGANISMS = [
    { key:'tpc',             label:'TPC',              unit:'cfu/g',  specVal:300000,  isCount:true,  alwaysShow:false },
    { key:'ecoli',           label:'E. coli',           unit:'cfu/g',  specVal:10,      isCount:true,  alwaysShow:false },
    { key:'yeast',           label:'Yeast',             unit:'cfu/g',  specVal:5000,    isCount:true,  alwaysShow:false },
    { key:'mould',           label:'Mould',             unit:'cfu/g',  specVal:5000,    isCount:true,  alwaysShow:false },
    { key:'salmonella_25g',  label:'Salm. (25g)',        unit:'/25g',   specVal:null,    isCount:false, alwaysShow:true  },
    { key:'salmonella',      label:'Salmonella',         unit:'/25g',   specVal:null,    isCount:false, alwaysShow:false },
    { key:'salmonella_125g', label:'Salm. (125g)',        unit:'/125g',  specVal:null,    isCount:false, alwaysShow:false },
    { key:'salmonella_375g', label:'Salm. (375g)',        unit:'/375g',  specVal:null,    isCount:false, alwaysShow:false },
    { key:'listeria',        label:'Listeria',           unit:'/25g',   specVal:null,    isCount:false, alwaysShow:false },
    { key:'staph',           label:'Staph. aureus',      unit:'cfu/g',  specVal:10,      isCount:true,  alwaysShow:false },
    { key:'ecoli_o157',      label:'E. coli O157',       unit:'/25g',   specVal:null,    isCount:false, alwaysShow:false },
  ]

  const getCellValue = (r: any, key: string) => { const d = r.results||r; return d[key] }
  const activeCols = ORGANISMS.filter(o =>
    o.alwaysShow || records.some(r => { const v = getCellValue(r,o.key); return v!=null&&v!=='' })
  )
  const isViolation = (o: any, val: any) => {
    if (val==null||val==='') return false
    if (!o.isCount) return String(val).toLowerCase().includes('present')&&!String(val).toLowerCase().includes('not')
    const n = parseFloat(String(val).replace(/[<>]/g,'').replace(/\s/g,''))
    return !isNaN(n) && o.specVal!=null && n>o.specVal
  }

  const passCount = records.filter(r=>(r.results?.overall_status||r.overall_status||'Pass').toLowerCase().includes('pass')).length
  const failCount = records.length - passCount

  if (records.length===0) return (
    <div style={{ textAlign:'center', padding:'32px 0', color:'#9ca3af', fontSize:12 }}>
      No microbiology records yet — drop Assurecloud or Mérieux COA PDFs above
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        {[['Pass',passCount,'#dcfce7','#166534'],['Fail',failCount,'#fee2e2','#991b1b'],['Total',records.length,'#f3f4f6','#374151']].map(([l,v,bg,fg])=>(
          <div key={l as string} style={{ padding:'8px 16px', borderRadius:8, background:bg as string, border:`1px solid ${fg as string}30` }}>
            <div style={{ fontSize:10, color:fg as string, fontWeight:700, textTransform:'uppercase' }}>{l as string}</div>
            <div style={{ fontSize:24, fontWeight:800, color:fg as string }}>{v as number}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, minWidth:800 }}>
          <thead>
            <tr style={{ background:'#1f4e79', color:'#fff' }}>
              <th style={{ padding:'6px 8px', textAlign:'left', whiteSpace:'nowrap' }}>Batch</th>
              <th style={{ padding:'6px 8px', textAlign:'left' }}>Date</th>
              <th style={{ padding:'6px 8px', textAlign:'left' }}>Lab</th>
              {activeCols.map(o=><th key={o.key} style={{ padding:'6px 6px', textAlign:'center', whiteSpace:'nowrap', fontSize:10 }}>{o.label}</th>)}
              <th style={{ padding:'6px 8px', textAlign:'center' }}>Status</th>
              <th style={{ padding:'6px 8px', textAlign:'center', fontSize:10, color:'#bfdbfe' }}>Edit</th>
              {canWrite && <th style={{ padding:'6px 8px', textAlign:'center', fontSize:10, color:'#f87171' }}>Del</th>}
            </tr>
          </thead>
          <tbody>
            {records.map((r,i) => {
              const d       = r.results||r
              const batchNo = r.batch_no||d.batch_no||r.batch_number||'—'
              const lab     = r.lab_name||d.lab||'—'
              const labShort = lab.toLowerCase().includes('assure')?'Assurecloud':lab.toLowerCase().includes('merieux')||lab.toLowerCase().includes('swift')?'Mérieux':lab.slice(0,12)
              const date    = r.date_issued||d.date_issued||d.date_received||'—'
              const status  = d.overall_status||r.overall_status||'Pass'
              const pass    = status.toLowerCase().includes('pass')
              return (
                <tr key={r.id||i} style={{ background:i%2===0?'#fff':'#f9fafb', borderBottom:'1px solid #f3f4f6' }}>
                  <td style={{ padding:'5px 8px', fontWeight:700 }}>{batchNo}</td>
                  <td style={{ padding:'5px 8px', fontSize:10, color:'#6b7280' }}>{date}</td>
                  <td style={{ padding:'5px 8px' }}>
                    <span style={{ fontSize:9, padding:'1px 5px', borderRadius:8, fontWeight:600,
                      background:labShort==='Assurecloud'?'#eff6ff':'#faf5ff',
                      color:labShort==='Assurecloud'?'#1d4ed8':'#7c3aed' }}>{labShort}</span>
                  </td>
                  {activeCols.map(o => {
                    const val  = getCellValue(r, o.key)
                    const fail = isViolation(o, val)
                    return (
                      <td key={o.key} style={{ padding:'5px 6px', textAlign:'center', fontWeight:fail?700:400,
                        background:fail?'#fef2f2':'inherit',
                        color:fail?'#dc2626':val==null||val===''?'#d1d5db':'#111827' }}>
                        {val==null||val===''?'—':String(val)}
                        {fail && <div style={{ fontSize:8, color:'#dc2626' }}>⚠ EXCEEDS</div>}
                      </td>
                    )
                  })}
                  <td style={{ padding:'5px 8px', textAlign:'center' }}>
                    <span style={{ padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:700,
                      background:pass?'#dcfce7':'#fee2e2', color:pass?'#166534':'#991b1b' }}>
                      {pass?'✓ Pass':'✗ Fail'}
                    </span>
                  </td>
                  <td style={{ padding:'5px 8px', textAlign:'center' }}>
                    <MicroEditCell record={r} onSaved={onUpdate}/>
                  </td>
                  {canWrite && (
                    <td style={{ padding:'5px 8px', textAlign:'center' }}>
                      <button onClick={()=>onDelete(r.id)}
                        style={{ background:'none', border:'1px solid #fca5a5', color:'#dc2626', borderRadius:4, padding:'2px 6px', cursor:'pointer', fontSize:10 }}>✕</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop:12, fontSize:10, color:'#9ca3af' }}>
        Specs — TPC: &lt;300 000 cfu/g · E. coli: &lt;10 cfu/g · Yeast &amp; Mould: &lt;5 000 cfu/g · Salmonella/Listeria: Absent
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LabResultsPage() {
  const { p } = useAuth(); const canWrite = p('can_save_lab_results'); const isAdmin = p('can_delete_lab_results')
  const db = getDb()

  const [activeTab,   setActiveTab]   = useState<TestType>('micro')
  const [records,     setRecords]     = useState<Record<TestType,LabResult[]>>({ micro:[],residue:[],heavy_metals:[],eto:[],aflatoxins:[],mosh_moah:[],pa_final:[],glyphosate:[] })
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [pending,     setPending]     = useState<any|null>(null)
  const [dupWarn,     setDupWarn]     = useState<string|null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historyRecs, setHistoryRecs] = useState<any[]>([])
  const [searchText,  setSearchText]  = useState('')

  const load = useCallback(async (tab: TestType) => {
    setLoading(true); setError('')
    // qms is the single source (legacy public.lab_results consolidated 2026-06-24)
    const { data: qmsData, error: err } = await db.schema('qms').from('lab_results')
      .select('*').eq('test_type', tab).order('created_at', { ascending:false })
    if (err) { setError(err.message); setLoading(false); return }
    const merged = (qmsData ?? [])
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setRecords(p=>({...p,[tab]: merged as LabResult[]}))
    setLoading(false)
  }, [db])

  useEffect(() => { load(activeTab) }, [activeTab, load])

  const loadHistory = useCallback(async () => {
    const { data } = await db.schema('qms').from('lab_results').select('*')
      .order('created_at', { ascending: false }).limit(500)
    setHistoryRecs(data ?? [])
  }, [db])

  useEffect(() => { if (showHistory) loadHistory() }, [showHistory, loadHistory])

  async function saveRecord(data: any, force = false) {
    if (!force) {
      const { data:existing } = await db.schema('qms').from('lab_results').select('id')
        .eq('test_type', activeTab).eq('batch_no', data.batch_no??'').limit(1)
      if (existing && existing.length > 0) { setDupWarn(data.batch_no); return }
    }
    const body = {
      batch_no:     data.batch_no??'',
      test_type:    activeTab,
      lab_name:     data._lab||data.lab||data.lab_name||'',
      order_no:     data._order||data.report_reference||data.order_no||'',
      date_issued:  data._date_issued||data.date_issued||'',
      date_received:data.date_received||'',
      results:      data.results||(data.analytes?{analytes:data.analytes}:data),
      overall_status: data.overall_status||'',
      pdf_path:     data._doc||data._sourceFile||'',
    }
    const { data:saved, error:err } = await db.schema('qms').from('lab_results').insert(body).select().single()
    if (err) { alert('Save failed: '+err.message); return }
    setRecords(p=>({...p,[activeTab]:[saved as LabResult,...p[activeTab]]}))
    setPending(null); setDupWarn(null)
  }

  async function deleteRecord(id: number) {
    if (!confirm('Delete this record?')) return
    await db.schema('qms').from('lab_results').delete().eq('id', id)
    setRecords(p=>({...p,[activeTab]:p[activeTab].filter(r=>r.id!==id)}))
  }

  // Global search — matches against every field of a record/row (batch, lab,
  // dates, analyte values, etc.) via a blunt but thorough JSON stringify.
  const matchesSearch = (row: any) => {
    if (!searchText.trim()) return true
    return JSON.stringify(row).toLowerCase().includes(searchText.trim().toLowerCase())
  }

  const current  = records[activeTab].filter(matchesSearch)
  const allRows  = current.flatMap(expandRecord)
  const cols     = COLS[activeTab] ?? []

  // Group allRows by record id for rowspan display
  const grouped: any[] = []
  let i = 0
  while (i < allRows.length) {
    const r = allRows[i]
    const span = allRows.filter((x: any) => x.id === r.id).length
    grouped.push({ ...r, _span:span, _isFirst:true })
    for (let j = 1; j < span; j++) grouped.push({ ...allRows[i+j], _span:span, _isFirst:false })
    i += span
  }

  return (
    <div className="p-5 max-w-[1400px]">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontWeight:800, fontSize:20, marginBottom:2 }}>Final Product Lab Results</div>
          <div style={{ fontSize:11, color:'#6b7280' }}>Upload COA PDFs · Gemini extracts structured data</div>
        </div>
        <div style={{ display:'flex', gap:8, marginLeft:'auto', flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ position:'relative', minWidth:220 }}>
            <input value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="🔍 Search this table…"
              style={{ width:'100%', padding:'6px 30px 6px 10px', fontSize:11, border:'1px solid #d1d5db', borderRadius:7, boxSizing:'border-box' }}/>
            {searchText && (
              <button onClick={()=>setSearchText('')} title="Clear search"
                style={{ position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'#9ca3af', cursor:'pointer', fontSize:13 }}>✕</button>
            )}
          </div>
          <button onClick={()=>load(activeTab)} style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:7, border:'1px solid #e5e7eb', background:'#fff', fontSize:11, cursor:'pointer' }}>
            ↻ Refresh
          </button>
          {/* Excel Export — formatted, AutoFilter, empty columns dropped */}
          {current.length > 0 && (
            <button
              onClick={() => {
                const cols2 = COLS[activeTab] ?? []
                const rows = allRows.map((r:any) => {
                  const o: Record<string, any> = { Batch: r.batch_no ?? '' }
                  cols2.forEach(([k,l]: any) => { o[l] = r[k] ?? '' })
                  o['Date'] = r.created_at ? isoDateTime(r.created_at) : ''
                  return o
                })
                exportTableXlsx(rows, `lab_${activeTab}_${new Date().toISOString().slice(0,10)}.xlsx`, activeTab)
              }}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:7, border:'1px solid #e5e7eb', background:'#fff', fontSize:11, cursor:'pointer' }}>
              ⬇ Export Excel
            </button>
          )}
          {/* CSV Import */}
          {canWrite && (
            <label style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:7, border:'1px solid #e5e7eb', background:'#fff', fontSize:11, cursor:'pointer' }}>
              ⬆ Import CSV
              <input type="file" accept=".csv" style={{ display:'none' }} onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return
                const text = await file.text()
                const lines = text.split('\n').map(l=>l.trim()).filter(Boolean)
                if (lines.length < 2) { alert('CSV is empty'); return }
                const headers = lines[0].split(',').map(h=>h.replace(/^"|"$/g,'').trim().toLowerCase())
                const batchIdx = headers.findIndex(h=>h.includes('batch'))
                const dateIdx  = headers.findIndex(h=>h.includes('date'))
                if (batchIdx < 0) { alert('CSV must have a "batch" column'); return }
                let imported = 0
                for (let i = 1; i < lines.length; i++) {
                  const vals = lines[i].split(',').map(v=>v.replace(/^"|"$/g,'').trim())
                  const batchNo = vals[batchIdx]
                  if (!batchNo) continue
                  const flat: any = {}
                  headers.forEach((h,idx)=>{ if (vals[idx]) flat[h]=vals[idx] })
                  const body = {
                    batch_no: batchNo,
                    test_type: activeTab,
                    lab_name: flat.lab||flat.lab_name||'CSV Import',
                    order_no: flat.order_no||flat.report||'',
                    date_issued: dateIdx>=0?vals[dateIdx]:'',
                    results: flat,
                    overall_status: flat.status||flat.overall_status||'',
                    pdf_path: '',
                  }
                  const { error:err } = await db.schema('qms').from('lab_results').insert(body)
                  if (!err) imported++
                }
                alert(`Imported ${imported} records`)
                load(activeTab)
                e.target.value = ''
              }}/>
            </label>
          )}
          <button onClick={()=>setShowHistory(h=>!h)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:7, border:`1px solid ${showHistory?'#d97706':'#e5e7eb'}`, background:showHistory?'#fef3c7':'#fff', color:showHistory?'#92400e':'#374151', fontSize:11, cursor:'pointer' }}>
            📜 Historical
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden', width:'fit-content', marginBottom:16 }}>
        {TEST_TYPES.map((t,i)=>(
          <button key={t.key} onClick={()=>{setActiveTab(t.key);setPending(null);setDupWarn(null)}}
            style={{ padding:'8px 16px', fontWeight:700, fontSize:12, cursor:'pointer', borderLeft:i>0?'1px solid #e5e7eb':'none',
              background:activeTab===t.key?'#1f4e79':'#fff', color:activeTab===t.key?'#fff':'#6b7280', transition:'all .15s', whiteSpace:'nowrap' }}>
            {t.label}
            {records[t.key].length>0&&<span style={{ marginLeft:5, fontFamily:'monospace', fontSize:10, opacity:.6 }}>({records[t.key].length})</span>}
          </button>
        ))}
      </div>

      {error && <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, fontSize:11, color:'#991b1b', padding:'8px 14px', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8 }}>⚠ {error}</div>}

      {/* Upload zone */}
      {canWrite && !pending && <PdfDropZone testType={activeTab} onExtracted={d=>{setPending(d);setDupWarn(null)}}/>}

      {/* Duplicate warning */}
      {dupWarn && (
        <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:10, padding:'12px 16px', marginBottom:14 }}>
          <div style={{ fontWeight:600, fontSize:13, color:'#92400e', marginBottom:10 }}>⚠ Batch {dupWarn} already has a {TEST_TYPES.find(t=>t.key===activeTab)?.label} record</div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>saveRecord(pending,true)} style={{ padding:'6px 14px', borderRadius:7, border:'none', background:'#dc2626', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' }}>Overwrite</button>
            <button onClick={()=>{setPending(null);setDupWarn(null)}} style={{ padding:'6px 14px', borderRadius:7, border:'1px solid #e5e7eb', background:'#fff', fontSize:12, cursor:'pointer' }}>Discard</button>
          </div>
        </div>
      )}

      {/* Review panel */}
      {pending && !dupWarn && (
        <ReviewPanel data={pending} testType={activeTab}
          onSave={saveRecord}
          onDiscard={()=>{setPending(null);setDupWarn(null)}}/>
      )}

      {/* Loading */}
      {loading && <div style={{ textAlign:'center', color:'#9ca3af', padding:20, fontSize:11 }}>Loading…</div>}

      {/* Micro tab uses dedicated MicroTable */}
      {!loading && activeTab === 'micro' && current.length > 0 && (
        <MicroTable
          records={current}
          canWrite={canWrite}
          onDelete={deleteRecord}
          onUpdate={(updated: any) => setRecords(p => ({ ...p, micro: p.micro.map(r => r.id===updated.id ? updated : r) }))}
        />
      )}

      {/* Other tabs use generic table */}
      {!loading && activeTab !== 'micro' && allRows.length > 0 && (
        <div style={{ overflowX:'auto', borderRadius:10, border:'1px solid #e5e7eb', background:'#fff' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead>
              <tr style={{ background:'#1f4e79', color:'#fff' }}>
                {canWrite && <th style={{ padding:'6px 8px', width:36 }}></th>}
                <th style={{ padding:'6px 10px', textAlign:'left', whiteSpace:'nowrap' }}>Batch</th>
                {cols.map(([k,l])=>(
                  <th key={k} style={{ padding:'6px 8px', textAlign:'center', whiteSpace:'nowrap', fontSize:10 }}>{l}</th>
                ))}
                <th style={{ padding:'6px 8px', color:'#bfdbfe', fontSize:9 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((r,gi)=>(
                <tr key={gi} style={{ background:r._isFirst&&gi>0?'#fff':gi%2===0?'#fff':'#f9fafb',
                  borderTop:r._isFirst&&gi>0?'2px solid #e5e7eb':undefined,
                  borderBottom:'1px solid #f3f4f6' }}>
                  {r._isFirst && canWrite && (
                    <td rowSpan={r._span} style={{ padding:'4px 6px', textAlign:'center', verticalAlign:'top', paddingTop:6 }}>
                      <button onClick={()=>deleteRecord(r.id)}
                        style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontSize:12 }} title="Delete">🗑</button>
                    </td>
                  )}
                  {r._isFirst && (
                    <td rowSpan={r._span} style={{ padding:'5px 10px', fontFamily:'monospace', fontWeight:700, fontSize:11, verticalAlign:'top', paddingTop:6, borderRight:'1px solid #f3f4f6', whiteSpace:'nowrap' }}>
                      {r.batch_no||'—'}
                    </td>
                  )}
                  {cols.map(([k])=>{
                    const val = r[k]??''
                    return (
                      <td key={k} style={{ padding:'5px 8px', textAlign:'center', fontWeight:k==='status'||k==='overall_status'?700:400,
                        color:k==='status'||k==='overall_status'?statusColor(String(val)):'inherit' }}>
                        {k==='status'||k==='overall_status'
                          ? <StatusBadge s={String(val)||null}/>
                          : (String(val)||'—')}
                      </td>
                    )
                  })}
                  {r._isFirst && (
                    <td rowSpan={r._span} style={{ padding:'5px 8px', fontSize:10, color:'#9ca3af', verticalAlign:'top', paddingTop:6, whiteSpace:'nowrap' }}>
                      {isoDateTime(r.created_at)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && allRows.length === 0 && current.length === 0 && !pending && (
        <div style={{ textAlign:'center', color:'#9ca3af', padding:'24px 0', fontSize:11 }}>
          {searchText.trim() && records[activeTab].length > 0
            ? `No results match "${searchText}"`
            : `No ${TEST_TYPES.find(t=>t.key===activeTab)?.label} results yet — drop a PDF above`}
        </div>
      )}

      {/* Historical */}
      {showHistory && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8, padding:'6px 12px', background:'#fef3c7', borderRadius:7, border:'1px solid #fcd34d' }}>
            📜 Historical — public.quality_records (read-only)
          </div>
          {historyRecs.length === 0 && <div style={{ color:'#9ca3af', textAlign:'center', padding:16, fontSize:11 }}>No historical records found.</div>}
          {historyRecs.length > 0 && (
            <div style={{ overflowX:'auto', background:'#fff', borderRadius:8, border:'1px solid #fcd34d' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
                <thead><tr style={{ background:'#92400e', color:'#fff' }}>
                  {['Batch','Workcenter','Workflow','Date'].map(h=><th key={h} style={{ padding:'6px 8px', textAlign:'left', fontSize:9 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {historyRecs.map((r:any,i:number)=>(
                    <tr key={r.id} style={{ background:i%2===0?'#fff':'#fefce8', borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'4px 8px', fontFamily:'monospace', fontWeight:700 }}>{r.batch_number||'—'}</td>
                      <td style={{ padding:'4px 8px' }}>{r.workcenter||'—'}</td>
                      <td style={{ padding:'4px 8px' }}>{r.workflow||'—'}</td>
                      <td style={{ padding:'4px 8px', color:'#6b7280' }}>{isoDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
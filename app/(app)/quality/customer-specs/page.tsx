'use client'

// app/(app)/quality/customer-specs/page.tsx
// Full parity with SpecificationsTab in CNTPquality.
// Uses flat sieve columns: gt6_min/max ... dust_min/max (NOT sieve_specs JSONB)

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { useDraftAutosave, readDraft, clearDraft } from '@/lib/hooks/useDraftAutosave'
import DraftRecoveryBanner from '@/components/shared/DraftRecoveryBanner'
import CoaSpecsTab from '@/components/quality/CoaSpecsTab'
import { cleanCustomerName, findDuplicateSpec, customerOptions, normCustomerKey } from '@/lib/quality/customer-spec-match'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Spec {
  id: number; product_family: string; grade: string; variant: string; customer: string | null
  sieve_type: string
  gt6_min: number|null;  gt6_max: number|null
  gt10_min: number|null; gt10_max: number|null
  gt12_min: number|null; gt12_max: number|null
  gt16_min: number|null; gt16_max: number|null
  gt20_min: number|null; gt20_max: number|null
  gt40_min: number|null; gt40_max: number|null
  gt60_min: number|null; gt60_max: number|null
  dust_min: number|null; dust_max: number|null
  moisture_max: number|null; bulk_density_min: number|null; bulk_density_max: number|null
  bd_target: number|null; notes: string|null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SIEVE_COLS = [
  {key:'gt6',label:'>6'},{key:'gt10',label:'>10'},{key:'gt12',label:'>12'},
  {key:'gt16',label:'>16'},{key:'gt20',label:'>20'},{key:'gt60',label:'>60'},
  {key:'dust',label:'Dust'},
]
// Rosehips uses a >40 mesh (per IPSSOU006 Tea Bag Cut datasheet). We add it
// (between >20 and >60) only for Rosehips, so other families are unaffected.
const ROSEHIPS_GT40 = {key:'gt40',label:'>40'}
function sieveColsFor(family:string){
  if(family!=='Rosehips') return SIEVE_COLS
  const i = SIEVE_COLS.findIndex(c=>c.key==='gt60')
  return [...SIEVE_COLS.slice(0,i), ROSEHIPS_GT40, ...SIEVE_COLS.slice(i)]
}
// Rosehips bulk density is volumetric (ml/5g, e.g. "<10 ml/5g") rather than cc/100g.
function bdUnit(family:string){ return family==='Rosehips' ? 'ml/5g' : 'cc/100g' }
const FAMILIES = ['Rooibos','Green Rooibos','Honeybush','Green Tea','Rosehips']
const GRADES: Record<string,string[]> = {
  'Rooibos':['Super Grade','Super Fine Cut','Super Export','Fine Super Export','Long Cut','Short Cut','Choice','Espresso'],
  'Green Rooibos':['Fine Cut','Long Cut'],'Honeybush':['Fine Cut'],'Green Tea':['Fine Cut'],'Rosehips':['Tea Bag Cut','Shell'],
}
const VARIANTS = ['Conventional','Organic','RA-Conventional','RA-Organic']
const EMPTY = () => ({
  product_family:'Rooibos',grade:'Super Grade',variant:'Conventional',customer:'',sieve_type:'standard',
  gt6_min:'',gt6_max:'',gt10_min:'',gt10_max:'',gt12_min:'',gt12_max:'',
  gt16_min:'',gt16_max:'',gt20_min:'',gt20_max:'',gt40_min:'',gt40_max:'',gt60_min:'',gt60_max:'',
  dust_min:'',dust_max:'',moisture_max:'',bulk_density_min:'',bulk_density_max:'',bd_target:'',notes:'',
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numOrNull(v: string): number|null {
  if (v===''||v==null) return null
  const n = parseFloat(v); return isNaN(n)?null:n
}

function VariantBadge({v}:{v:string}) {
  const MAP: Record<string,[string,string,string]> = {
    'Conventional':['#eff6ff','#1e40af','#bfdbfe'],'Organic':['#f0fdf4','#166534','#86efac'],
    'RA-Conventional':['#fffbeb','#92400e','#fcd34d'],'RA-Organic':['#f0fdf4','#065f46','#6ee7b7'],
  }
  const [bg,fg,bd] = MAP[v]??['#f3f4f6','#374151','#d1d5db']
  return <span style={{fontSize:9,padding:'1px 7px',borderRadius:9,background:bg,color:fg,border:`1px solid ${bd}`,fontWeight:700,whiteSpace:'nowrap'}}>{v}</span>
}

function EC({id,col,value,width=50,onSave,savedKey}:{id:number;col:string;value:any;width?:number;onSave:(id:number,col:string,val:any)=>void;savedKey:string}) {
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState('')
  const [flash,setFlash]=useState(false)
  function commit(){
    const val = draft===''?null:isNaN(Number(draft))?draft:parseFloat(draft)
    onSave(id,col,val)
    setEditing(false); setFlash(true); setTimeout(()=>setFlash(false),1500)
  }
  if(editing) return <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e=>{if(e.key==='Enter')commit();if(e.key==='Escape')setEditing(false)}}
    style={{width,padding:'2px 4px',border:'1.5px solid #1f4e79',borderRadius:4,fontSize:10,textAlign:'center',fontFamily:'monospace',boxSizing:'border-box'}}/>
  return <span onClick={()=>{setDraft(value==null?'':String(value));setEditing(true)}} title="Click to edit"
    style={{display:'inline-block',minWidth:width,padding:'3px 4px',textAlign:'center',fontFamily:'monospace',fontSize:10,
      background:flash?'#dcfce7':'transparent',borderRadius:3,cursor:'pointer'}}>
    {value==null?<span style={{color:'#d1d5db'}}>—</span>:value}
    {flash&&<span style={{color:'#166534',marginLeft:2}}>✓</span>}
  </span>
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomerSpecsPage() {
  const {p}=useAuth(); const canWrite=p('can_edit_customer_specs')
  const db=getDb()
  const [tab,setTab]=useState<'sieve'|'coa'>('coa')
  const [specs,setSpecs]=useState<Spec[]>([])
  const [loading,setLoading]=useState(true)
  const [err,setErr]=useState('')
  const [filterFam,setFilterFam]=useState('')
  const [filterCust,setFilterCust]=useState('')

  // Deep-link support (?tab=sieve&family=…&customer=…) so a Pasteuriser run can
  // send you straight to the spec it is measured against, already filtered,
  // instead of "go to Customer Specs and find it yourself".
  //
  // Applied in an effect rather than as useState initialisers on purpose: this
  // is a client component, but Next still server-renders it, and the server has
  // no URL query to read — seeding state from window.location during render
  // would make the first client render differ from the server's HTML and
  // trip a hydration mismatch. After mount these are ordinary filters.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('tab') === 'sieve') setTab('sieve')
    const fam = q.get('family'); if (fam) setFilterFam(fam)
    const cust = q.get('customer'); if (cust) setFilterCust(cust)
  }, [])
  const [showAdd,setShowAdd]=useState(false)
  const [addNewCust,setAddNewCust]=useState(false)
  // Typed patch helper — addForm is a loose bag of fields, but a setter that
  // merges a partial does not need `any` to say so.
  const patchAdd=(patch:Record<string,unknown>)=>setAddForm((p:Record<string,unknown>)=>({...p,...patch}))
  const [addForm,setAddForm]=useState<any>(EMPTY())
  const [addSaving,setAddSaving]=useState(false)
  const [addErr,setAddErr]=useState('')

  // Local-storage safety net — see lib/hooks/useDraftAutosave.ts. Autosaves
  // the "+ New Specification" form every 15s while open; cleared once
  // saveNew() confirms the insert.
  const draftKey='customerspecs_draft_new'
  const [recoveredDraft,setRecoveredDraft]=useState<{data:any;savedAt:string}|null>(null)
  useDraftAutosave(draftKey, addForm, { enabled: showAdd })
  useEffect(() => {
    if (showAdd) return
    setRecoveredDraft(readDraft(draftKey))
  }, [showAdd])
  const [showHistory,setShowHistory]=useState(false)
  const [histSpecs,setHistSpecs]=useState<any[]>([])
  const [histLoading,setHistLoading]=useState(false)

  const load=useCallback(async()=>{
    setLoading(true);setErr('')
    const {data,error}=await db.schema('qms').from('customer_specs').select('*').order('product_family').order('grade').order('variant')
    if(error){setErr(error.message);setLoading(false);return}
    setSpecs((data as Spec[])??[]);setLoading(false)
  },[db])

  useEffect(()=>{load()},[load])
  useEffect(()=>{
    if(!showHistory)return;setHistLoading(true)
    // qms is the single source (legacy public.customer_specs consolidated 2026-06-24)
    db.schema('qms').from('customer_specs').select('*').order('product_family').order('grade')
      .then(({data}:{data:any[]|null})=>{setHistSpecs(data??[]);setHistLoading(false)})
  },[showHistory,db])

  // The four columns that together identify a spec. Editing any of them can
  // collide with another row, and a trailing space in one of them is how
  // production ended up with three Entyce rows carrying different limits — so
  // they are cleaned on the way in and checked against the rest of the table.
  const IDENTITY_COLS = ['customer','product_family','grade','variant']

  async function saveField(id:number,col:string,val:any){
    let value = val
    if (IDENTITY_COLS.includes(col)) {
      value = cleanCustomerName(val)                     // trim + collapse, case kept
      if (col !== 'customer' && !value) { alert('Product family, grade and variant cannot be blank.'); return }
      const row = specs.find(r=>r.id===id)
      if (row) {
        const dup = findDuplicateSpec(specs, {...row, [col]: value}, id)
        if (dup && !confirm(
          `That makes this a second spec for the same customer and product.\n\n`+
          `${dup.customer||'Generic'} — ${dup.product_family} ${dup.grade} · ${dup.variant} already exists (id ${dup.id}).\n\n`+
          `The pasteuriser and the COA will then pick one of the two by database row order. Continue?`)) return
      }
    }
    const {data:updated,error}=await db.schema('qms').from('customer_specs').update({[col]:value}).eq('id',id).select().single()
    if(error){alert('Save failed: '+error.message);return}
    setSpecs(p=>p.map(r=>r.id===id?(updated as Spec):r))
  }

  async function deleteSpec(id:number){
    if(!confirm('Delete this specification row? This cannot be undone.'))return
    const {error}=await db.schema('qms').from('customer_specs').delete().eq('id',id)
    if(error){alert('Delete failed: '+error.message);return}
    setSpecs(p=>p.filter(r=>r.id!==id))
  }

  async function saveNew(){
    if(!addForm.product_family||!addForm.grade||!addForm.variant){setAddErr('Product family, grade and variant are required');return}
    // Clean before checking AND before saving: a spec whose customer or product
    // carries stray whitespace is unreachable by the lookups that read it.
    const ident = {
      customer:       cleanCustomerName(addForm.customer),
      product_family: cleanCustomerName(addForm.product_family),
      grade:          cleanCustomerName(addForm.grade),
      variant:        cleanCustomerName(addForm.variant),
    }
    // Warn, don't refuse. The client spec sheet has SEVEN Entyce documents, six
    // of them under the same family/grade/variant with different sieve limits,
    // separated only by doc number and product description — neither of which
    // this table has a column for. So a second row for one customer+product is
    // sometimes legitimate. What must not happen silently is the ACCIDENTAL
    // one, so it takes an explicit confirmation and names the row it clashes
    // with. (The dropdown above is what stops the whitespace/case variants.)
    const dup = findDuplicateSpec(specs, ident)
    if (dup && !confirm(
      `${dup.customer||'Generic'} — ${dup.product_family} ${dup.grade} · ${dup.variant} already has a spec (id ${dup.id}).\n\n`+
      `Nothing in this table separates two specs for the same customer and product, so the pasteuriser and the COA will pick one of them by database row order — not necessarily this one.\n\n`+
      `Add it anyway?`)) { setAddErr('Not saved — edit the existing spec instead, or change the product family / grade / variant.'); return }
    setAddSaving(true);setAddErr('')
    const body:any={...addForm,...ident}
    ;['gt6_min','gt6_max','gt10_min','gt10_max','gt12_min','gt12_max','gt16_min','gt16_max','gt20_min','gt20_max','gt40_min','gt40_max','gt60_min','gt60_max','dust_min','dust_max','moisture_max','bulk_density_min','bulk_density_max','bd_target']
      .forEach(k=>{body[k]=numOrNull(body[k])})
    body.customer=ident.customer;body.notes=addForm.notes||null
    const {data:saved,error}=await db.schema('qms').from('customer_specs').insert(body).select().single()
    if(error){setAddErr(error.message);setAddSaving(false);return}
    clearDraft(draftKey)
    setSpecs(p=>[...p,saved as Spec]);setShowAdd(false);setAddForm(EMPTY());setAddSaving(false)
  }

  const families=[...new Set(specs.map(r=>r.product_family))].sort()
  // Deduped on a normalised key, so 'Entyce', 'Entyce ' and 'ENTYCE ' offer
  // ONE option and picking it writes the spelling the lookups will match.
  const specCustomers=customerOptions(specs)
  // Existing duplicates: one spec per (customer, family, grade, variant) is
  // the rule, and until today nothing enforced it. Whichever row Postgres
  // returns first is the one the pasteuriser and the COA are judged against,
  // so these have to be visible here to be fixable — the guards below only
  // stop NEW ones.
  const dupGroups=(()=>{
    const by=new Map<string,Spec[]>()
    specs.forEach(r=>{
      const k=[r.customer,r.product_family,r.grade,r.variant].map(v=>normCustomerKey(v)).join('|')
      by.set(k,[...(by.get(k)??[]),r])
    })
    return [...by.values()].filter(g=>g.length>1)
  })()
  const customers=specCustomers
  let filtered=specs
  if(filterFam)filtered=filtered.filter(r=>r.product_family===filterFam)
  // Matched on the normalised key, not the raw string: the dropdown now offers
  // one deduped spelling per customer, so an exact compare would hide the rows
  // stored under a variant spelling — the opposite of what this filter is for.
  if(filterCust)filtered=filtered.filter(r=>normCustomerKey(r.customer)===normCustomerKey(filterCust))
  const grouped:Record<string,Spec[]>={}
  filtered.forEach(r=>{if(!grouped[r.product_family])grouped[r.product_family]=[];grouped[r.product_family].push(r)})
  const fld:React.CSSProperties={width:'100%',padding:'5px 7px',border:'1px solid #d1d5db',borderRadius:6,fontSize:11,boxSizing:'border-box',fontFamily:'monospace'}

  return (
    <div className="p-5 max-w-[1400px]">
      {/* Tab switch */}
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        {([['coa','📄 COA Requirements (per customer)'],['sieve','🧪 Sieve Specs']] as const).map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            style={{padding:'8px 16px',borderRadius:10,fontSize:12,fontWeight:700,cursor:'pointer',
              border:`1px solid ${tab===k?'#1f4e79':'#e5e7eb'}`,background:tab===k?'#1f4e79':'#fff',color:tab===k?'#fff':'#6b7280'}}>
            {l}
          </button>
        ))}
      </div>

      {tab==='coa' && <CoaSpecsTab canWrite={canWrite} />}

      {tab==='sieve' && (<>
      {/* Toolbar */}
      {dupGroups.length>0&&(
        <div style={{marginBottom:12,padding:'10px 14px',borderRadius:10,border:'1px solid #fca5a5',background:'#fef2f2'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#991b1b',marginBottom:4}}>
            ⚠ {dupGroups.length} customer{dupGroups.length===1?'':'s'} {dupGroups.length===1?'has':'have'} more than one spec for the same product
          </div>
          <div style={{fontSize:11,color:'#7f1d1d',marginBottom:6}}>
            Only one of each is used, and which one comes down to database row order — so a pasteuriser run or a COA may be checked
            against limits nobody chose. Keep the correct row, delete the rest.
          </div>
          {dupGroups.map((g,i)=>(
            <div key={i} style={{fontSize:11,color:'#7f1d1d',fontFamily:'monospace',marginTop:2}}>
              {(g[0].customer||'Generic')} — {g[0].product_family} {g[0].grade} · {g[0].variant}:{' '}
              {g.map(r=>`id ${r.id} (${JSON.stringify(r.customer)})`).join('  vs  ')}
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
        <span style={{fontWeight:700,fontSize:13}}>📋 Product Specifications</span>
        <span style={{fontSize:10,color:'#9ca3af'}}>{specs.length} specs · {families.length} families</span>
        <select value={filterFam} onChange={e=>setFilterFam(e.target.value)} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:6,fontSize:11}}>
          <option value="">All families</option>
          {families.map(f=><option key={f}>{f}</option>)}
        </select>
        <select value={filterCust} onChange={e=>setFilterCust(e.target.value)} style={{padding:'4px 8px',border:'1px solid #d1d5db',borderRadius:6,fontSize:11}}>
          <option value="">All customers</option>
          {customers.map(c=><option key={c}>{c}</option>)}
        </select>
        <button onClick={load} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',fontSize:11,cursor:'pointer'}}>↻</button>
        <button onClick={()=>setShowHistory(h=>!h)}
          style={{padding:'4px 12px',borderRadius:6,border:'1px solid #d97706',fontSize:11,cursor:'pointer',background:showHistory?'#fef3c7':'#fff',color:showHistory?'#92400e':'#374151',fontWeight:600}}>
          📜 {showHistory?'Hide Historical':'Historical'}
        </button>
        {canWrite&&<button onClick={()=>{setShowAdd(true);setRecoveredDraft(null)}}
          style={{marginLeft:'auto',padding:'5px 16px',borderRadius:7,border:'none',background:'#1f4e79',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>
          + Add Specification
        </button>}
      </div>

      {recoveredDraft&&!showAdd&&(
        <DraftRecoveryBanner savedAt={recoveredDraft.savedAt}
          onRestore={()=>{setAddForm(recoveredDraft.data);setShowAdd(true);setRecoveredDraft(null)}}
          onDiscard={()=>{clearDraft(draftKey);setRecoveredDraft(null)}} />
      )}

      <div style={{marginBottom:10,padding:'7px 11px',background:'#eff6ff',borderRadius:7,border:'1px solid #bfdbfe',fontSize:10,color:'#1e40af'}}>
        ✏️ Click any value to edit inline · Enter to save · Esc to cancel · Specs auto-load in the Pasteuriser run modal
      </div>

      {err&&<div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:7,fontSize:11,color:'#991b1b',marginBottom:10}}>⚠ {err}</div>}

      {/* Add modal */}
      {showAdd&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:16,overflowY:'auto'}}>
          <div style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:640,boxShadow:'0 24px 64px rgba(0,0,0,.3)',overflow:'hidden',margin:'auto'}}>
            <div style={{background:'#1f4e79',padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{color:'#fff',fontWeight:700,fontSize:14}}>+ New Specification</div>
              <button onClick={()=>{setShowAdd(false);setAddErr('');clearDraft(draftKey)}} style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:6,padding:'3px 10px',color:'#fff',cursor:'pointer',fontSize:16}}>×</button>
            </div>
            <div style={{padding:18,display:'flex',flexDirection:'column',gap:12}}>
              <div style={{background:'#eff6ff',borderRadius:7,padding:'8px 12px',fontSize:11,color:'#1e40af'}}>
                Customer-specific specs take priority over generic ones when a pasteuriser batch is created.
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:3,textTransform:'uppercase'}}>Product Family</label>
                  <select value={addForm.product_family} onChange={e=>setAddForm((p:any)=>({...p,product_family:e.target.value,grade:(GRADES[e.target.value]??[])[0]??''}))} style={fld}>
                    {FAMILIES.map(f=><option key={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:3,textTransform:'uppercase'}}>Grade</label>
                  <input value={addForm.grade} onChange={e=>setAddForm((p:any)=>({...p,grade:e.target.value}))} style={fld} list="grade-dl"/>
                  <datalist id="grade-dl">{(GRADES[addForm.product_family]??[]).map(g=><option key={g} value={g}/>)}</datalist>
                </div>
                <div>
                  <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:3,textTransform:'uppercase'}}>Variant</label>
                  <select value={addForm.variant} onChange={e=>setAddForm((p:any)=>({...p,variant:e.target.value}))} style={fld}>
                    {VARIANTS.map(v=><option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:3,textTransform:'uppercase'}}>Customer</label>
                  {/* A list rather than a free-text box: typing the name is how
                      one customer ends up with several spec rows differing only
                      by a space or a capital, and the pasteuriser/COA lookups
                      then resolve to whichever row Postgres returns first. */}
                  <select value={addNewCust?'__new__':addForm.customer} style={fld}
                    onChange={e=>{
                      const v=e.target.value
                      if(v==='__new__'){setAddNewCust(true);patchAdd({customer:''})}
                      else{setAddNewCust(false);patchAdd({customer:v})}
                    }}>
                    <option value="">Generic — applies to every customer</option>
                    {specCustomers.map(c=><option key={c} value={c}>{c}</option>)}
                    <option value="__new__">+ New customer…</option>
                  </select>
                  {addNewCust&&(
                    <input autoFocus value={addForm.customer} placeholder="New customer name"
                      onChange={e=>patchAdd({customer:e.target.value})}
                      onBlur={e=>patchAdd({customer:cleanCustomerName(e.target.value)})}
                      style={{...fld,marginTop:4}}/>
                  )}
                </div>
              </div>
              <div style={{fontWeight:700,fontSize:11,color:'#374151',marginBottom:2}}>Sieve Specifications (%)</div>
              <div style={{borderRadius:7,overflow:'hidden',border:'1px solid #e5e7eb'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead><tr style={{background:'#1f4e79',color:'#fff'}}>
                    <th style={{padding:'5px 8px',textAlign:'left',fontSize:10}}>Mesh</th>
                    <th style={{padding:'5px 8px',textAlign:'center',fontSize:10}}>Min %</th>
                    <th style={{padding:'5px 8px',textAlign:'center',fontSize:10}}>Max %</th>
                  </tr></thead>
                  <tbody>
                    {sieveColsFor(addForm.product_family).map(({key,label},i)=>(
                      <tr key={key} style={{background:i%2===0?'#fff':'#f9fafb',borderBottom:'1px solid #f3f4f6'}}>
                        <td style={{padding:'4px 8px',fontWeight:600}}>{label} mesh</td>
                        {(['min','max'] as const).map(mm=>(
                          <td key={mm} style={{padding:'3px 6px'}}>
                            <input type="number" step="0.1" value={addForm[`${key}_${mm}`]}
                              onChange={e=>setAddForm((p:any)=>({...p,[`${key}_${mm}`]:e.target.value}))}
                              placeholder="—"
                              style={{width:'100%',padding:'4px 6px',border:'1px solid #d1d5db',borderRadius:5,fontSize:11,textAlign:'center',fontFamily:'monospace',boxSizing:'border-box'}}/>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8}}>
                {[['Moisture Max (%)','moisture_max'],[`BD Min (${bdUnit(addForm.product_family)})`,'bulk_density_min'],[`BD Max (${bdUnit(addForm.product_family)})`,'bulk_density_max'],['BD Target','bd_target']].map(([lbl,key])=>(
                  <div key={key}>
                    <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:3,textTransform:'uppercase'}}>{lbl}</label>
                    <input type="number" step="0.1" value={addForm[key]} onChange={e=>setAddForm((p:any)=>({...p,[key]:e.target.value}))}
                      placeholder="—" style={{...fld,textAlign:'center'}}/>
                  </div>
                ))}
              </div>
              <div>
                <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:3,textTransform:'uppercase'}}>Notes / IPS Reference</label>
                <input value={addForm.notes} onChange={e=>setAddForm((p:any)=>({...p,notes:e.target.value}))}
                  placeholder="e.g. IPS-CEL-002" style={fld}/>
              </div>
              {addErr&&<div style={{color:'#dc2626',fontSize:12,padding:'6px 10px',background:'#fef2f2',borderRadius:6}}>⚠ {addErr}</div>}
              <div style={{display:'flex',justifyContent:'flex-end',gap:8,paddingTop:4}}>
                <button onClick={()=>{setShowAdd(false);setAddErr('');clearDraft(draftKey)}} style={{padding:'8px 18px',borderRadius:7,border:'1px solid #d1d5db',background:'#fff',fontSize:12,cursor:'pointer'}}>Cancel</button>
                <button onClick={saveNew} disabled={addSaving}
                  style={{padding:'8px 24px',borderRadius:7,border:'none',background:addSaving?'#9ca3af':'#1f4e79',color:'#fff',fontSize:12,fontWeight:700,cursor:addSaving?'default':'pointer'}}>
                  {addSaving?'Saving…':'💾 Save Specification'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading&&<div style={{padding:'40px 20px',textAlign:'center',color:'#9ca3af'}}>Loading specifications…</div>}

      {/* QMS specs grouped table */}
      {!loading&&!showHistory&&<>
        {Object.entries(grouped).map(([family,rows])=>(
          <div key={family} style={{marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:700,color:'#1f4e79',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6,paddingBottom:4,borderBottom:'2px solid #dbeafe'}}>
              {family}
            </div>
            <div style={{overflowX:'auto',background:'#fff',borderRadius:8}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                <thead>
                  <tr style={{background:'#1f4e79'}}>
                    <th style={{padding:'6px 8px',textAlign:'left',color:'#fff',fontSize:9,textTransform:'uppercase',whiteSpace:'nowrap'}}>Grade</th>
                    <th style={{padding:'6px 6px',color:'#fff',fontSize:9,textTransform:'uppercase'}}>Variant</th>
                    <th style={{padding:'6px 8px',color:'#fde68a',fontSize:9,fontWeight:800,borderLeft:'1px solid #2d5f8f',whiteSpace:'nowrap',background:'#1a3f60'}}>CUSTOMER</th>
                    {sieveColsFor(family).map(c=>(
                      <th key={c.key} colSpan={2} style={{padding:'4px 4px',textAlign:'center',color:'#bfdbfe',fontSize:9,borderLeft:'1px solid #2d5f8f'}}>{c.label}%</th>
                    ))}
                    <th style={{padding:'6px 4px',color:'#bfdbfe',fontSize:9,borderLeft:'2px solid #2d5f8f',whiteSpace:'nowrap'}}>Moist≤</th>
                    <th colSpan={2} style={{padding:'4px 4px',textAlign:'center',color:'#bfdbfe',fontSize:9,borderLeft:'1px solid #2d5f8f',whiteSpace:'nowrap'}}>BD {bdUnit(family)}</th>
                    {canWrite&&<th style={{padding:'4px 4px',color:'#f87171',fontSize:9}}></th>}
                  </tr>
                  <tr style={{background:'#f0f4f8',borderBottom:'1px solid #dbeafe'}}>
                    <th/><th/><th style={{fontSize:9,color:'#6b7280',borderLeft:'1px solid #e5e7eb'}}>name</th>
                    {sieveColsFor(family).map(c=>(
                      <>{/* Fragment needs key on outer element */}
                        <th key={c.key+'min'} style={{fontSize:8,color:'#9ca3af',textAlign:'center',borderLeft:'1px solid #e5e7eb'}}>min</th>
                        <th key={c.key+'max'} style={{fontSize:8,color:'#9ca3af',textAlign:'center'}}>max</th>
                      </>
                    ))}
                    <th style={{fontSize:8,color:'#9ca3af',borderLeft:'2px solid #dbeafe'}}>%</th>
                    <th style={{fontSize:8,color:'#9ca3af',textAlign:'center',borderLeft:'1px solid #e5e7eb'}}>min</th>
                    <th style={{fontSize:8,color:'#9ca3af',textAlign:'center'}}>max</th>
                    {canWrite&&<th/>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row,i)=>(
                    <tr key={row.id} style={{background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f3f4f6'}}>
                      <td style={{padding:'5px 8px',fontWeight:700,color:'#111827',whiteSpace:'nowrap',fontSize:11}}>{row.grade}</td>
                      <td style={{padding:'5px 6px',whiteSpace:'nowrap'}}><VariantBadge v={row.variant}/></td>
                      <td style={{padding:'5px 6px',color:row.customer?'#1f4e79':'#9ca3af',fontStyle:row.customer?'normal':'italic',fontSize:10,borderLeft:'1px solid #f3f4f6',whiteSpace:'nowrap'}}>
                        {canWrite
                          ?<EC id={row.id} col="customer" value={row.customer??null} width={90} onSave={saveField} savedKey={`${row.id}_customer`}/>
                          :<span style={{fontFamily:'monospace',fontSize:10}}>{row.customer||'—'}</span>}
                      </td>
                      {sieveColsFor(family).map(c=>(
                        <>
                          <td key={c.key+'min'} style={{padding:'5px 2px',textAlign:'center',borderLeft:'1px solid #f3f4f6'}}>
                            {canWrite?<EC id={row.id} col={`${c.key}_min`} value={(row as any)[`${c.key}_min`]} onSave={saveField} savedKey={`${row.id}_${c.key}_min`}/>
                              :<span style={{fontFamily:'monospace',fontSize:10}}>{(row as any)[`${c.key}_min`]??'—'}</span>}
                          </td>
                          <td key={c.key+'max'} style={{padding:'5px 2px',textAlign:'center'}}>
                            {canWrite?<EC id={row.id} col={`${c.key}_max`} value={(row as any)[`${c.key}_max`]} onSave={saveField} savedKey={`${row.id}_${c.key}_max`}/>
                              :<span style={{fontFamily:'monospace',fontSize:10}}>{(row as any)[`${c.key}_max`]??'—'}</span>}
                          </td>
                        </>
                      ))}
                      <td style={{padding:'5px 4px',textAlign:'center',borderLeft:'2px solid #dbeafe'}}>
                        {canWrite?<EC id={row.id} col="moisture_max" value={row.moisture_max} onSave={saveField} savedKey={`${row.id}_moisture_max`}/>
                          :<span style={{fontFamily:'monospace',fontSize:10}}>{row.moisture_max??'—'}</span>}
                      </td>
                      <td style={{padding:'5px 2px',textAlign:'center',borderLeft:'1px solid #f3f4f6'}}>
                        {canWrite?<EC id={row.id} col="bulk_density_min" value={row.bulk_density_min} onSave={saveField} savedKey={`${row.id}_bulk_density_min`}/>
                          :<span style={{fontFamily:'monospace',fontSize:10}}>{row.bulk_density_min??'—'}</span>}
                      </td>
                      <td style={{padding:'5px 2px',textAlign:'center'}}>
                        {canWrite?<EC id={row.id} col="bulk_density_max" value={row.bulk_density_max} onSave={saveField} savedKey={`${row.id}_bulk_density_max`}/>
                          :<span style={{fontFamily:'monospace',fontSize:10}}>{row.bulk_density_max??'—'}</span>}
                      </td>
                      {canWrite&&(
                        <td style={{padding:'5px 4px',textAlign:'center'}}>
                          <button onClick={()=>deleteSpec(row.id)}
                            style={{background:'none',border:'none',color:'#f87171',cursor:'pointer',fontSize:13,lineHeight:1,padding:0}} title="Delete">×</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {filtered.length===0&&<div style={{padding:'40px 20px',textAlign:'center',color:'#9ca3af'}}>
          No specifications found{filterFam||filterCust?' — clear the filters':' — click "+ Add Specification"'}
        </div>}
        <div style={{marginTop:10,padding:'8px 12px',background:'#f9fafb',borderRadius:7,border:'1px solid #e5e7eb',fontSize:10,color:'#6b7280'}}>
          💡 Customer-specific specs take priority over generic ones when a pasteuriser batch is created.
        </div>
      </>}

      {/* Historical */}
      {showHistory&&(
        <div style={{marginTop:16}}>
          <div style={{fontSize:11,fontWeight:700,color:'#92400e',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8,padding:'6px 12px',background:'#fef3c7',borderRadius:7,border:'1px solid #fcd34d'}}>
            📜 Historical Specifications — public schema (read-only)
          </div>
          {histLoading&&<div style={{textAlign:'center',color:'#9ca3af',padding:20}}>Loading…</div>}
          {!histLoading&&histSpecs.length===0&&<div style={{textAlign:'center',color:'#9ca3af',padding:20}}>No historical specs found.</div>}
          {!histLoading&&histSpecs.length>0&&(
            <div style={{overflowX:'auto',background:'#fff',borderRadius:8,border:'1px solid #fcd34d'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                <thead><tr style={{background:'#92400e',color:'#fff'}}>
                  {['Family','Grade','Variant','Customer','Moist Max','BD Min','BD Max','Notes'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:'left',fontWeight:600,whiteSpace:'nowrap',fontSize:9}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {histSpecs.map((r:any,i:number)=>(
                    <tr key={r.id} style={{background:i%2===0?'#fff':'#fefce8',borderBottom:'1px solid #f3f4f6'}}>
                      <td style={{padding:'4px 8px',fontWeight:700}}>{r.product_family}</td>
                      <td style={{padding:'4px 8px'}}>{r.grade}</td>
                      <td style={{padding:'4px 8px'}}><VariantBadge v={r.variant}/></td>
                      <td style={{padding:'4px 8px',color:r.customer?'#1f4e79':'#9ca3af',fontStyle:r.customer?'normal':'italic'}}>{r.customer||'generic'}</td>
                      <td style={{padding:'4px 8px',fontFamily:'monospace'}}>{r.moisture_max??'—'}</td>
                      <td style={{padding:'4px 8px',fontFamily:'monospace'}}>{r.bulk_density_min??'—'}</td>
                      <td style={{padding:'4px 8px',fontFamily:'monospace'}}>{r.bulk_density_max??'—'}</td>
                      <td style={{padding:'4px 8px',color:'#6b7280'}}>{r.notes||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>)}
    </div>
  )
}
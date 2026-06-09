'use client'
import { useState, useEffect, useRef } from 'react'
import * as React from 'react'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Trash2, Plus, Scale } from 'lucide-react'
import { uid, num, nowTime, INP, F, Card, AddRow } from '@/components/production/shared/ui'
import { useSerialLookup, markBagConsumed, advanceToNextSerial, variantFamily } from '@/lib/production/scan-utils'

// ══════════════════════════════════════════════════════════════════════════════
// PASTEURISER — 7 sub-forms
// ══════════════════════════════════════════════════════════════════════════════
export type PastTempRow    = { id:string; time:string; tea_temp:string; dryer_air_temp:string; boiler_flush:boolean; boiler_bar:string; boiler_kpa:string; steam_temp:string; water_cond:string; complies:'yes'|'no'|''; corrective_action:string; ncr_ref:string }
export type PastWaterJet   = { id:string; jet:string; reading:string }
export type PastRatePoint  = { id:string; time:string; kg:string }
export type PastDebagRow   = { id:string; bag_seq:string; batch:string; time:string; product_type:string; serial:string; lot:string; kg:string }
export type PastBagRow     = { id:string; line:string; start_time:string; item:string; lot:string; num_bags:string; start_bag:string; end_bag:string; bag_weight:string; total_weight:string }
export type PastByProduct  = { id:string; product_type:string; serial:string; weight:string }
export type PastTimesheetRow = { id:string; material:string; speed:string; invertor:string; start_time:string; stop_time:string; time_not_producing:string; failure_areas:string[]; other_specify:string; comments:string }
export type PastVacuumRow  = { id:string; operation:string; batch:string; start_box:string; end_box:string; comments:string }
export type PastQualityPoint = { id:string; time:string; value:string }

export const FAILURE_AREAS = ['End of day','No feed material','Product change','Feed tank','Conveyor','Main sieve','Screw conveyor','Aspirator','Bag filter','Pasteuriser','Boiler','Drier heater','Drier shaker','Post sieve','Bin shaker','Bagging unit','Bin stamper']
export const WATER_JETS    = ['1,11','2,12','3,13','4,14','5,15','6,16 (middle)','8,18','9,19','10,20']

export function SimpleLineChart({ points, yLabel, color='#10b981', yMin=0, yMax=100 }: { points:{time:string;value:number}[]; yLabel:string; color?:string; yMin?:number; yMax?:number }) {
  const W=320,H=140,PL=40,PR=10,PT=10,PB=30,IW=W-PL-PR,IH=H-PT-PB
  if(!points.length) return <div style={{width:W,height:H}} className="flex items-center justify-center bg-stone-50 rounded-xl border border-stone-200"><p className="text-[11px] text-stone-400">No readings yet</p></div>
  function tMins(t:string){const[h,m]=t.split(':').map(Number);return(h||0)*60+(m||0)}
  const times=points.map(p=>tMins(p.time)),tMin=Math.min(...times),tMax=Math.max(...times,tMin+60),tRange=tMax-tMin||1,vRange=yMax-yMin||1
  function px(t:number){return PL+((t-tMin)/tRange)*IW}
  function py(v:number){return PT+IH-((v-yMin)/vRange)*IH}
  const pts=points.map(p=>({x:px(tMins(p.time)),y:py(p.value)}))
  const pathD=pts.map((p,i)=>`${i===0?'M':'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const yTicks=5,yStep=vRange/yTicks
  return (
    <svg width={W} height={H} className="overflow-visible">
      {Array.from({length:yTicks+1},(_,i)=>{const v=yMin+i*yStep,y=py(v);return(<g key={i}><line x1={PL} x2={PL-4} y1={y} y2={y} stroke="#d1d5db" strokeWidth={1}/><text x={PL-6} y={y+3} fontSize={8} textAnchor="end" fill="#9ca3af">{Math.round(v)}</text><line x1={PL} x2={W-PR} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1}/></g>)})}
      <line x1={PL} x2={PL} y1={PT} y2={H-PB} stroke="#e5e7eb" strokeWidth={1}/>
      <line x1={PL} x2={W-PR} y1={H-PB} y2={H-PB} stroke="#e5e7eb" strokeWidth={1}/>
      <text x={8} y={H/2} fontSize={8} fill="#9ca3af" textAnchor="middle" transform={`rotate(-90,8,${H/2})`}>{yLabel}</text>
      {pts.length>1&&<path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>}
      {pts.map((p,i)=>(<g key={i}><circle cx={p.x} cy={p.y} r={3} fill={color}/><text x={p.x} y={H-PB+12} fontSize={7} textAnchor="middle" fill="#9ca3af">{points[i].time}</text></g>))}
    </svg>
  )
}

// Utility: persist/restore a pasteuriser sub-form state to Supabase qms.pasteuriser_drafts
export function usePastLS<T>(storageKey: string, initialFn: ()=>T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initialFn)
  const writeTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const initialised = useRef(false)

  // Load from Supabase once on mount
  useEffect(()=>{
    async function load() {
      try {
        const db = getDb()
        const { data: { user } } = await db.auth.getUser()
        if (!user) return
        const { data } = await db
          .schema('qms' as any)
          .from('pasteuriser_drafts')
          .select('state_json')
          .eq('user_id', user.id)
          .eq('storage_key', storageKey)
          .maybeSingle()
        if (data && (data as any).state_json != null) setState((data as any).state_json as T)
      } catch {}
      initialised.current = true
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Debounced upsert on every state change (after initial load)
  useEffect(()=>{
    if (!initialised.current) return
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(async ()=>{
      try {
        const db = getDb()
        const { data: { user } } = await db.auth.getUser()
        if (!user) return
        await db
          .schema('qms' as any)
          .from('pasteuriser_drafts')
          .upsert(
            { user_id: user.id, storage_key: storageKey, state_json: state, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,storage_key' }
          )
      } catch {}
    }, 800)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return [state, setState]
}

export function PastDailyReport({ locked, storageKey='past_daily', onData }:{ locked:boolean; storageKey?:string; onData?:(d:any)=>void }) {
  const todayStr=format(new Date(),'yyyy-MM-dd')
  const [{operatorName,batchNumber,verifiedBy,verifyDate},setH]=usePastLS(storageKey+':hdr',()=>({operatorName:'',batchNumber:'',verifiedBy:'',verifyDate:todayStr}))
  const setOperatorName=(v:string)=>setH(s=>({...s,operatorName:v}))
  const setBatchNumber=(v:string)=>setH(s=>({...s,batchNumber:v}))
  const setVerifiedBy=(v:string)=>setH(s=>({...s,verifiedBy:v}))
  const setVerifyDate=(v:string)=>setH(s=>({...s,verifyDate:v}))
  const timeSlots=(()=>{const slots=[];let h=7,m=45;while(h<24){slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);m+=15;if(m>=60){m=0;h++}};return slots})()
  const [rows,setRows]=usePastLS<PastTempRow[]>(storageKey+':rows',()=>timeSlots.map(t=>({id:uid(),time:t,tea_temp:'',dryer_air_temp:'',boiler_flush:false,boiler_bar:'',boiler_kpa:'',steam_temp:'',water_cond:'',complies:'' as const,corrective_action:'',ncr_ref:''})))
  const [waterJets,setWaterJets]=usePastLS<PastWaterJet[]>(storageKey+':jets',()=>WATER_JETS.map(j=>({id:uid(),jet:j,reading:''})))
  const onDataRef=React.useRef(onData); onDataRef.current=onData
  useEffect(()=>{ onDataRef.current?.({ operatorName,batchNumber,verifiedBy,verifyDate,tempLog:rows,waterJets }) },[operatorName,batchNumber,verifiedBy,verifyDate,rows,waterJets])
  function upRow(i:number,k:keyof PastTempRow,v:any){setRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r))}
  const tTF=(v:string)=>{const n=num(v);return!!v&&(n<85||n>100)}
  const dF=(v:string)=>{const n=num(v);return!!v&&(n<0||n>90)}
  const bKF=(v:string)=>{const n=num(v);return!!v&&(n<500||n>1000)}
  const sF=(v:string)=>{const n=num(v);return!!v&&(n<104||n>150)}
  const wF=(v:string)=>{const n=num(v);return!!v&&n>=950}
  const iCls=(f:boolean)=>`w-full px-2 py-1.5 rounded-lg border text-[12px] text-text outline-none transition-all ${f?'border-warn bg-warn/5 text-warn font-bold':'border-stone-200 bg-white focus:border-brand'} disabled:opacity-40 disabled:bg-stone-50`
  return (
    <div className="space-y-5">
      <Card title="Daily report header">
        <div className="grid grid-cols-2 gap-3">
          <F label="Operator name"     value={operatorName} onChange={setOperatorName} ph="e.g. Thabo"        disabled={locked}/>
          <F label="Batch number"      value={batchNumber}  onChange={setBatchNumber}  ph="e.g. RSFCPAS-001"  disabled={locked}/>
          <F label="Verified by"       value={verifiedBy}   onChange={setVerifiedBy}   ph="Name"              disabled={locked}/>
          <F label="Verification date" value={verifyDate}   onChange={setVerifyDate}   type="date"            disabled={locked}/>
        </div>
      </Card>
      <Card title="15-minute temperature log" variant="info">
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p><strong>Acceptable ranges:</strong> Tea temp 85–100°C · Dryer air 0–90°C · Boiler 500–1000 kPa · Steam 104–150°C · Water &lt;950 mS</p>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-left" style={{minWidth:700}}>
            <thead><tr className="border-b border-stone-200 bg-stone-50">{['Time','Tea °C','Dryer °C','Flush','Bar','kPa','Steam °C','Water mS','Complies','Action','NCR'].map(h=>(<th key={h} className="px-2 py-2 font-mono text-[9px] uppercase tracking-wide text-stone-400 text-center">{h}</th>))}</tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r,i)=>(<tr key={r.id} className={i%2===0?'bg-white':'bg-stone-50/50'}>
                <td className="px-2 py-1 font-mono text-[11px] text-stone-500 whitespace-nowrap">{r.time}</td>
                <td className="px-1 py-1"><input type="text" inputMode="decimal" value={r.tea_temp} onChange={e=>upRow(i,'tea_temp',e.target.value)} disabled={locked} placeholder="—" className={iCls(tTF(r.tea_temp))} style={{width:52}}/></td>
                <td className="px-1 py-1"><input type="text" inputMode="decimal" value={r.dryer_air_temp} onChange={e=>upRow(i,'dryer_air_temp',e.target.value)} disabled={locked} placeholder="—" className={iCls(dF(r.dryer_air_temp))} style={{width:52}}/></td>
                <td className="px-1 py-1 text-center"><input type="checkbox" checked={r.boiler_flush} onChange={e=>upRow(i,'boiler_flush',e.target.checked)} disabled={locked} className="w-4 h-4 accent-brand"/></td>
                <td className="px-1 py-1"><input type="text" inputMode="decimal" value={r.boiler_bar} onChange={e=>upRow(i,'boiler_bar',e.target.value)} disabled={locked} placeholder="—" className={iCls(false)} style={{width:48}}/></td>
                <td className="px-1 py-1"><input type="text" inputMode="decimal" value={r.boiler_kpa} onChange={e=>upRow(i,'boiler_kpa',e.target.value)} disabled={locked} placeholder="—" className={iCls(bKF(r.boiler_kpa))} style={{width:60}}/></td>
                <td className="px-1 py-1"><input type="text" inputMode="decimal" value={r.steam_temp} onChange={e=>upRow(i,'steam_temp',e.target.value)} disabled={locked} placeholder="—" className={iCls(sF(r.steam_temp))} style={{width:52}}/></td>
                <td className="px-1 py-1"><input type="text" inputMode="decimal" value={r.water_cond} onChange={e=>upRow(i,'water_cond',e.target.value)} disabled={locked} placeholder="—" className={iCls(wF(r.water_cond))} style={{width:52}}/></td>
                <td className="px-1 py-1"><select value={r.complies} onChange={e=>upRow(i,'complies',e.target.value)} disabled={locked} className={`px-1 py-1.5 rounded-lg border text-[11px] outline-none ${r.complies==='no'?'border-err bg-err/5 text-err font-bold':r.complies==='yes'?'border-ok/40 bg-ok/5 text-ok':'border-stone-200 bg-white text-stone-400'}`} style={{width:60}}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></td>
                <td className="px-1 py-1"><input type="text" value={r.corrective_action} onChange={e=>upRow(i,'corrective_action',e.target.value)} disabled={locked} placeholder="Action" className={INP} style={{width:120}}/></td>
                <td className="px-1 py-1"><input type="text" value={r.ncr_ref} onChange={e=>upRow(i,'ncr_ref',e.target.value)} disabled={locked} placeholder="NCR-" className={INP} style={{width:70}}/></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Daily water readings — open jets">
        <div className="grid grid-cols-3 gap-3">
          {waterJets.map((wj,i)=>(<div key={wj.id} className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-stone-400 uppercase tracking-[0.07em]">Jet {wj.jet}</label><input type="text" inputMode="decimal" value={wj.reading} disabled={locked} onChange={e=>setWaterJets(js=>js.map((j,k)=>k===i?{...j,reading:e.target.value}:j))} placeholder="Reading" className={INP}/></div>))}
        </div>
      </Card>
    </div>
  )
}

export function PastRateOfProduction({ locked, storageKey='past_rate', onData }:{ locked:boolean; storageKey?:string; onData?:(d:any)=>void }) {
  const [batchNo,setBatchNo]=usePastLS<string>(storageKey+':bn',()=>'')
  const [points,setPoints]=usePastLS<PastRatePoint[]>(storageKey+':pts',()=>[{id:uid(),time:format(new Date(),'HH:mm'),kg:''}])
  const onDataRef=React.useRef(onData); onDataRef.current=onData
  useEffect(()=>{ onDataRef.current?.({ batchNo,points }) },[batchNo,points])
  const chartPoints=points.filter(p=>p.time&&p.kg).map(p=>({time:p.time,value:num(p.kg)})).sort((a,b)=>a.time.localeCompare(b.time))
  const totalKg=chartPoints.length>0?Math.max(...chartPoints.map(p=>p.value)):0
  return (
    <div className="space-y-5">
      <Card title="Rate of production — header"><F label="Batch number" value={batchNo} onChange={setBatchNo} ph="e.g. RSFCPAS-001" disabled={locked}/></Card>
      <Card title="Production rate chart" variant="output">
        <div className="overflow-x-auto"><SimpleLineChart points={chartPoints} yLabel="kg" color="#10b981" yMin={0} yMax={Math.max(1000,totalKg+100)}/></div>
        <div className="space-y-2 mt-2">
          <div className="grid grid-cols-[28px_1fr_1fr_auto] gap-2 px-1">{['#','Time','Cumulative kg',''].map(h=>(<span key={h} className="text-[9px] font-bold text-stone-400 uppercase">{h}</span>))}</div>
          {points.map((p,i)=>(<div key={p.id} className="grid grid-cols-[28px_1fr_1fr_auto] gap-2 items-center bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5">
            <span className="font-mono text-[11px] text-stone-400 text-center">{i+1}</span>
            <input type="time" value={p.time} disabled={locked} onChange={e=>setPoints(ps=>ps.map((x,j)=>j===i?{...x,time:e.target.value}:x))} className={INP}/>
            <input type="text" inputMode="decimal" value={p.kg} placeholder="e.g. 480" disabled={locked} onChange={e=>setPoints(ps=>ps.map((x,j)=>j===i?{...x,kg:e.target.value}:x))} className={INP}/>
            {points.length>1&&!locked?<button onClick={()=>setPoints(ps=>ps.filter((_,j)=>j!==i))} className="text-err/40 hover:text-err"><Trash2 size={12}/></button>:<span/>}
          </div>))}
          {!locked&&<button onClick={()=>setPoints(ps=>[...ps,{id:uid(),time:nowTime(),kg:''}])} className="w-full py-2.5 border border-dashed border-stone-300 rounded-xl text-[12px] font-medium text-stone-400 hover:border-brand hover:text-brand hover:bg-brand/5 transition-all flex items-center justify-center gap-1.5"><Plus size={13}/> Add point</button>}
        </div>
      </Card>
    </div>
  )
}

// ── PastDebagSerialInput — serial lookup for Pasteuriser debagging ────────────
// Pasteuriser receives FINISHED product (blended bags) — blockFinishedProducts=false.
// Still validates: consumed_at_section (hard block), variant family (hard block).
export const PastDebagSerialInput = React.memo(function PastDebagSerialInput({
  value, variantCode, locked,
  onChangeSerial, onAutoFill,
}: {
  value: string; variantCode: string; locked: boolean
  onChangeSerial: (v: string) => void
  onAutoFill: (patch: { kg?: string; lot?: string; product_type?: string }) => void
}) {
  const [lookupStatus, setLookupStatus] = React.useState<'idle'|'found'|'mismatch'>('idle')
  const [mismatchMsg,  setMismatchMsg]  = React.useState('')
  const serialRef = React.useRef<HTMLInputElement>(null)

  useSerialLookup(value, React.useCallback((result) => {
    // 1. Already consumed — hard block
    if ((result as any).consumed_at_section) {
      setLookupStatus('mismatch')
      setMismatchMsg(`Already consumed at ${(result as any).consumed_at_section}. This bag cannot be scanned in again.`)
      return
    }
    // 2. Variant family — hard block (CON/ORG cannot mix even at pasteuriser)
    const sessFam = variantCode ? variantFamily(variantCode) : null
    const bagFam  = result.variant ? variantFamily(result.variant) : null
    if (sessFam && bagFam && sessFam !== bagFam) {
      setLookupStatus('mismatch')
      setMismatchMsg(`Variant mismatch — session is ${variantCode} but bag is ${result.variant}. Scan the correct bag.`)
      return
    }
    // 3. All good — auto-fill product_type, lot, kg
    const patch: { kg?: string; lot?: string; product_type?: string } = {}
    if (result.weight_kg)                                         patch.kg           = result.weight_kg
    if (result.lot_number && result.lot_number !== 'NOT TRACKED') patch.lot          = result.lot_number
    if (result.product_type)                                      patch.product_type = result.product_type
    onAutoFill(patch)
    setLookupStatus('found')
    markBagConsumed(value, 'pasteuriser', null, parseFloat(result.weight_kg) || undefined)
    advanceToNextSerial(serialRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, variantCode, onAutoFill]))

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Serial / bag no.</label>
      <div className="relative">
        <input
          ref={serialRef}
          type="text"
          data-serial="true"
          value={value}
          onChange={e => {
            onChangeSerial(e.target.value.toUpperCase())
            setLookupStatus('idle')
            setMismatchMsg('')
          }}
          placeholder="▐▌ Scan barcode"
          disabled={locked}
          className={`w-full px-3 py-2.5 rounded-lg border-2 bg-white text-[12px] font-mono text-text outline-none transition-all disabled:opacity-40 ${
            lookupStatus === 'found'    ? 'border-ok/60 bg-ok/5 pr-7' :
            lookupStatus === 'mismatch' ? 'border-err/60 bg-err/5' :
            'border-blue-300 bg-blue-50/30 focus:border-brand'
          }`}
        />
        {lookupStatus === 'found'    && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ok  text-[14px]">✓</span>}
        {lookupStatus === 'mismatch' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-err text-[14px]">✗</span>}
      </div>
      {lookupStatus === 'mismatch' && (
        <p className="text-[10px] text-err font-semibold leading-tight">⛔ {mismatchMsg}</p>
      )}
    </div>
  )
})

export function PastDebagging({ locked, storageKey='past_debag', onData }:{ locked:boolean; storageKey?:string; onData?:(d:any)=>void }) {
  const todayStr=format(new Date(),'yyyy-MM-dd')
  const [operators,setOperators]=usePastLS<string>(storageKey+':ops',()=>'')
  const [shift,setShift]=usePastLS<string>(storageKey+':shift',()=>'Morning')
  const [variantCode,setVariantCode]=usePastLS<string>(storageKey+':variant',()=>'CON')
  const [debagRows,setDebagRows]=usePastLS<PastDebagRow[]>(storageKey+':debag',()=>[{id:uid(),bag_seq:'1',batch:'',time:'',product_type:'',serial:'',lot:'',kg:''}])
  const [postSieveRows,setPostSieveRows]=usePastLS<PastDebagRow[]>(storageKey+':post',()=>[{id:uid(),bag_seq:'1',batch:'',time:'',product_type:'',serial:'',lot:'',kg:''}])
  const onDataRef=React.useRef(onData); onDataRef.current=onData
  useEffect(()=>{ onDataRef.current?.({ operators,shift,variantCode,debagRows,postSieveRows }) },[operators,shift,variantCode,debagRows,postSieveRows])
  const totalD=debagRows.reduce((s,r)=>s+num(r.kg),0),totalE=postSieveRows.reduce((s,r)=>s+num(r.kg),0)
  function addRow(rows:PastDebagRow[],setRows:React.Dispatch<React.SetStateAction<PastDebagRow[]>>){const prev=rows[rows.length-1];setRows(rs=>[...rs,{id:uid(),bag_seq:String(rs.length+1),batch:prev?.batch??'',time:nowTime(),product_type:prev?.product_type??'',serial:'',lot:prev?.lot??'',kg:prev?.kg??''}])}
  function upRow(i:number,k:keyof PastDebagRow,v:string,setRows:React.Dispatch<React.SetStateAction<PastDebagRow[]>>){setRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:k==='serial'||k==='lot'?v.toUpperCase():v}:r))}
  const summaryRows=[...debagRows,...postSieveRows].reduce((acc,r)=>{if(!r.product_type)return acc;if(!acc[r.product_type])acc[r.product_type]={bags:0,kg:0};acc[r.product_type].bags+=1;acc[r.product_type].kg+=num(r.kg);return acc},{} as Record<string,{bags:number;kg:number}>)
  function DebagTable({rows,setRows,total,label}:{rows:PastDebagRow[];setRows:React.Dispatch<React.SetStateAction<PastDebagRow[]>>;total:number;label:string}){return(
    <Card title={label} total={total} variant="input">
      <div className="space-y-2">
        {rows.map((r,i)=>(<div key={r.id} className="bg-stone-50 border border-stone-200 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2"><span className="font-mono text-[11px] font-semibold text-stone-400">Bag {r.bag_seq}</span>{rows.length>1&&!locked&&<button onClick={()=>setRows(rs=>rs.filter((_,j)=>j!==i))} className="text-err/40 hover:text-err"><Trash2 size={13}/></button>}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <F label="Batch no."          value={r.batch}        onChange={v=>upRow(i,'batch',v,setRows)}        ph="e.g. RSFCPAS-001"   disabled={locked}/>
            <F label="Time"               value={r.time}         onChange={v=>upRow(i,'time',v,setRows)}         type="time"              disabled={locked}/>
            <F label="Product type"       value={r.product_type} onChange={v=>upRow(i,'product_type',v,setRows)} ph="e.g. Rooibos SFC"   disabled={locked}/>
            <PastDebagSerialInput
              value={r.serial}
              variantCode={variantCode}
              locked={locked}
              onChangeSerial={v => upRow(i, 'serial', v, setRows)}
              onAutoFill={patch => setRows(rs => rs.map((x, j) => j === i ? { ...x, ...patch } : x))}
            />
            <F label="Lot number"         value={r.lot}          onChange={v=>upRow(i,'lot',v,setRows)}          ph="e.g. 08-013-26/1"   disabled={locked}/>
            <F label="kg nett excl. bag"  value={r.kg}           onChange={v=>upRow(i,'kg',v,setRows)}           type="number" ph="350"   disabled={locked}/>
          </div>
        </div>))}
      </div>
      {!locked&&<AddRow label="Add bag" onClick={()=>addRow(rows,setRows)}/>}
      <div className="flex justify-between px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-xl"><span className="text-[11px] font-medium text-sky-600">Total</span><span className="font-mono font-bold text-[14px] text-sky-700">{total.toFixed(1)} kg</span></div>
    </Card>
  )}
  return (
    <div className="space-y-5">
      <Card title="Debagging station — header"><div className="grid grid-cols-3 gap-3"><F label="Operators" value={operators} onChange={setOperators} ph="e.g. Thabo, Yanga" disabled={locked}/><F label="Shift" value={shift} onChange={setShift} opts={['Morning','Afternoon']} disabled={locked}/><F label="Variant code" value={variantCode} onChange={setVariantCode} opts={['CON','ORG','RA']} disabled={locked}/></div></Card>
      <DebagTable rows={debagRows} setRows={setDebagRows} total={totalD} label="Debagging table (D)"/>
      <DebagTable rows={postSieveRows} setRows={setPostSieveRows} total={totalE} label="Post-sieve blending table (E)"/>
      {Object.keys(summaryRows).length>0&&(<Card title="Debagging summary"><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-stone-200">{['Product type','Total bags','Total input kg'].map(h=>(<th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-stone-400">{h}</th>))}</tr></thead><tbody className="divide-y divide-stone-100">{Object.entries(summaryRows).map(([pt,s])=>(<tr key={pt}><td className="px-4 py-2.5 text-[13px] font-semibold text-text">{pt}</td><td className="px-4 py-2.5 font-mono text-[12px] text-stone-600">{s.bags}</td><td className="px-4 py-2.5 font-mono text-[12px] font-bold text-text">{s.kg.toFixed(1)} kg</td></tr>))}<tr className="bg-sky-50"><td className="px-4 py-2.5 font-semibold text-[12px] text-sky-700">Total (D+E)</td><td className="px-4 py-2.5 font-mono text-[12px] text-sky-600">{debagRows.length+postSieveRows.length}</td><td className="px-4 py-2.5 font-mono font-bold text-[14px] text-sky-700">{(totalD+totalE).toFixed(1)} kg</td></tr></tbody></table></div></Card>)}
    </div>
  )
}

export function PastBagging({ locked, storageKey='past_bag', onData }:{ locked:boolean; storageKey?:string; onData?:(d:any)=>void }) {
  const todayStr=format(new Date(),'yyyy-MM-dd')
  const [operators,setOperators]=usePastLS<string>(storageKey+':ops',()=>'')
  const [shift,setShift]=usePastLS<string>(storageKey+':shift',()=>'Morning')
  const [supervisor,setSupervisor]=usePastLS<string>(storageKey+':sup',()=>'')
  const [lotNumber,setLotNumber]=usePastLS<string>(storageKey+':lot',()=>'')
  const [prodType,setProdType]=usePastLS<string>(storageKey+':type',()=>'Bagging')
  const [stdWt,setStdWt]=usePastLS<string>(storageKey+':stdwt',()=>'160')
  const [actualWt,setActualWt]=usePastLS<string>(storageKey+':actwt',()=>'160')
  const [floorWaste,setFloorWaste]=usePastLS<string>(storageKey+':fw',()=>'')
  const [comments,setComments]=usePastLS<string>(storageKey+':cmt',()=>'')
  const [bagRows,setBagRows]=usePastLS<PastBagRow[]>(storageKey+':rows',()=>[{id:uid(),line:'1',start_time:'',item:'',lot:'',num_bags:'',start_bag:'',end_bag:'',bag_weight:'',total_weight:''}])
  const [byProducts,setByProducts]=usePastLS<PastByProduct[]>(storageKey+':byp',()=>[{id:uid(),product_type:'',serial:'',weight:''}])
  const onDataRef=React.useRef(onData); onDataRef.current=onData
  useEffect(()=>{ onDataRef.current?.({ operators,shift,supervisor,lotNumber,prodType,stdWt,actualWt,floorWaste,comments,bagRows,byProducts }) },[operators,shift,supervisor,lotNumber,prodType,stdWt,actualWt,floorWaste,comments,bagRows,byProducts])
  const totalA=bagRows.reduce((s,r)=>s+num(r.total_weight),0),totalB=byProducts.reduce((s,r)=>s+num(r.weight),0),totalC=num(floorWaste),totalProduct=totalA+totalB+totalC
  function addBagRow(){const prev=bagRows[bagRows.length-1];setBagRows(rs=>[...rs,{id:uid(),line:String(rs.length+1),start_time:nowTime(),item:prev?.item??'',lot:prev?.lot??lotNumber,num_bags:'',start_bag:'',end_bag:'',bag_weight:prev?.bag_weight??'',total_weight:''}])}
  function upBag(i:number,k:keyof PastBagRow,v:string){setBagRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r))}
  const baggerySummary=bagRows.reduce((acc,r)=>{if(!r.item)return acc;if(!acc[r.item])acc[r.item]={lot:r.lot,bags:0,kg:0};acc[r.item].bags+=num(r.num_bags);acc[r.item].kg+=num(r.total_weight);return acc},{} as Record<string,{lot:string;bags:number;kg:number}>)
  return (
    <div className="space-y-5">
      <Card title="Bagging station — header"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><F label="Operators" value={operators} onChange={setOperators} ph="e.g. Thabo, Yanga" disabled={locked}/><F label="Shift" value={shift} onChange={setShift} opts={['Morning','Afternoon']} disabled={locked}/><F label="Shift supervisor" value={supervisor} onChange={setSupervisor} ph="e.g. Arnold" disabled={locked}/><F label="Lot number" value={lotNumber} onChange={v=>setLotNumber(v.toUpperCase())} ph="e.g. RSFCPAS-001" disabled={locked}/><F label="Production type" value={prodType} onChange={setProdType} opts={['Bagging','Debagging','Re-labelling']} disabled={locked}/><F label="Scale — Std weight (kg)" value={stdWt} onChange={setStdWt} type="number" ph="160" disabled={locked}/><F label="Scale — Actual weight (kg)" value={actualWt} onChange={setActualWt} type="number" ph="160" disabled={locked}/></div></Card>
      <Card title="Bagging table" total={totalA} variant="output">
        <div className="space-y-2">{bagRows.map((r,i)=>(<div key={r.id} className="bg-stone-50 border border-stone-200 rounded-xl p-3"><div className="flex items-center justify-between mb-2"><span className="font-mono text-[11px] font-semibold text-stone-400">Line {r.line}</span>{bagRows.length>1&&!locked&&<button onClick={()=>setBagRows(rs=>rs.filter((_,j)=>j!==i))} className="text-err/40 hover:text-err"><Trash2 size={13}/></button>}</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><F label="Start time" value={r.start_time} onChange={v=>upBag(i,'start_time',v)} type="time" disabled={locked}/><F label="Item" value={r.item} onChange={v=>upBag(i,'item',v)} ph="e.g. Rooibos SFC" disabled={locked}/><F label="Lot number" value={r.lot} onChange={v=>upBag(i,'lot',v.toUpperCase())} ph="e.g. RSFCPAS-001" disabled={locked}/><F label="No. of bags" value={r.num_bags} onChange={v=>upBag(i,'num_bags',v)} type="number" ph="20" disabled={locked}/><F label="Starting bag no." value={r.start_bag} onChange={v=>upBag(i,'start_bag',v)} ph="001" disabled={locked}/><F label="Ending bag no." value={r.end_bag} onChange={v=>upBag(i,'end_bag',v)} ph="020" disabled={locked}/><F label="Bag weight (kg)" value={r.bag_weight} onChange={v=>upBag(i,'bag_weight',v)} type="number" ph="25" disabled={locked}/><F label="Total weight (kg)" value={r.total_weight} onChange={v=>upBag(i,'total_weight',v)} type="number" ph="500" disabled={locked}/></div></div>))}</div>
        {!locked&&<AddRow label="Add bagging line" onClick={addBagRow}/>}
      </Card>
      {Object.keys(baggerySummary).length>0&&(<Card title="Bagging summary — Total (A)"><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-stone-200">{['Product type','Lot number','Total bags','Total output kg'].map(h=>(<th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-stone-400">{h}</th>))}</tr></thead><tbody className="divide-y divide-stone-100">{Object.entries(baggerySummary).map(([item,s])=>(<tr key={item}><td className="px-4 py-2.5 text-[13px] font-semibold text-text">{item}</td><td className="px-4 py-2.5 font-mono text-[12px] text-stone-600">{s.lot}</td><td className="px-4 py-2.5 font-mono text-[12px] text-stone-600">{s.bags}</td><td className="px-4 py-2.5 font-mono font-bold text-[13px] text-emerald-700">{s.kg.toFixed(1)} kg</td></tr>))}</tbody></table></div></Card>)}
      <Card title="By-product summary — Total (B)" variant="info">
        <div className="space-y-2">{byProducts.map((r,i)=>(<div key={r.id} className="grid grid-cols-3 gap-3 bg-stone-50 border border-stone-200 rounded-xl p-3"><F label="Product type" value={r.product_type} onChange={v=>setByProducts(bs=>bs.map((x,j)=>j===i?{...x,product_type:v}:x))} ph="e.g. Brown Dust" disabled={locked}/><F label="Serial no." value={r.serial} onChange={v=>setByProducts(bs=>bs.map((x,j)=>j===i?{...x,serial:v.toUpperCase()}:x))} ph="e.g. BD-240426-001" disabled={locked}/><F label="Weight (kg)" value={r.weight} onChange={v=>setByProducts(bs=>bs.map((x,j)=>j===i?{...x,weight:v}:x))} type="number" disabled={locked}/>{byProducts.length>1&&!locked&&<button onClick={()=>setByProducts(bs=>bs.filter((_,j)=>j!==i))} className="col-span-3 text-right text-[10px] text-err/60 hover:text-err">Remove</button>}</div>))}</div>
        {!locked&&<AddRow label="Add by-product" onClick={()=>setByProducts(bs=>[...bs,{id:uid(),product_type:'',serial:'',weight:''}])}/>}
        <div className="flex justify-between px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl"><span className="text-[11px] font-medium text-amber-600">Total (B)</span><span className="font-mono font-bold text-[13px] text-amber-700">{totalB.toFixed(1)} kg</span></div>
      </Card>
      <div className="bg-white border border-stone-200 rounded-2xl p-4 flex items-center gap-4"><div className="flex-1"><p className="text-[13px] font-semibold text-stone-600">Floor waste (C)</p><p className="text-[11px] text-stone-400 mt-0.5">Swept and weighed</p></div><div className="w-32"><F label="kg" value={floorWaste} onChange={setFloorWaste} type="number" ph="0" disabled={locked}/></div></div>
      <div className="rounded-2xl p-5 border-2 border-stone-200 bg-stone-50">
        <div className="flex items-center gap-2 mb-4"><Scale size={16} className="text-brand"/><span className="font-semibold text-[14px] text-text">Mass balance — supervisor completes</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">{[{label:'Total (A+B+C)',value:totalProduct,color:'text-text'},{label:'Final product (A)',value:totalA,color:'text-emerald-700'},{label:'By-products (B)',value:totalB,color:'text-amber-600'},{label:'Floor waste (C)',value:totalC,color:'text-stone-500'}].map(col=>(<div key={col.label} className="bg-white rounded-xl px-3 py-3 border border-stone-200"><div className={`font-mono font-bold text-[18px] ${col.color}`}>{col.value.toFixed(1)} kg</div><div className="text-[9px] text-stone-400 uppercase tracking-wide mt-1">{col.label}</div></div>))}</div>
        {totalA>0&&(<div className="flex justify-between px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl"><span className="text-[12px] font-semibold text-emerald-700">Yield (A / total)</span><span className="font-mono font-bold text-[14px] text-emerald-700">{totalProduct>0?((totalA/totalProduct)*100).toFixed(1):'—'}%</span></div>)}
      </div>
      <div className="space-y-1.5"><label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Comments</label><textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3} disabled={locked} className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none"/></div>
    </div>
  )
}

export function PastProcessTimesheet({ locked, storageKey='past_ts', onData }:{ locked:boolean; storageKey?:string; onData?:(d:any)=>void }) {
  const [rows,setRows]=usePastLS<PastTimesheetRow[]>(storageKey+':rows',()=>[{id:uid(),material:'',speed:'',invertor:'',start_time:'',stop_time:'',time_not_producing:'',failure_areas:[],other_specify:'',comments:''}])
  const onDataRef=React.useRef(onData); onDataRef.current=onData
  useEffect(()=>{ onDataRef.current?.({ rows }) },[rows])
  function upRow(i:number,k:keyof PastTimesheetRow,v:any){setRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r))}
  function toggleFailure(i:number,area:string){setRows(rs=>rs.map((r,j)=>{if(j!==i)return r;const areas=r.failure_areas.includes(area)?r.failure_areas.filter(a=>a!==area):[...r.failure_areas,area];return{...r,failure_areas:areas}}))}
  const totalNotProducing=rows.reduce((s,r)=>{const parts=r.time_not_producing.split(':').map(Number);return s+(parts[0]||0)*60+(parts[1]||0)},0)
  return (
    <div className="space-y-5">
      <p className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-xl px-4 py-3">Record each production run. Add a row per run or changeover.</p>
      {rows.map((r,i)=>(<Card key={r.id} title={`Run ${i+1}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <F label="Material produced"  value={r.material}           onChange={v=>upRow(i,'material',v)}           ph="e.g. Rooibos SFC" disabled={locked} wide/>
          <F label="Speed setting"      value={r.speed}              onChange={v=>upRow(i,'speed',v)}              type="number" ph="7"   disabled={locked}/>
          <F label="Invertor setting"   value={r.invertor}           onChange={v=>upRow(i,'invertor',v)}           type="number" ph="50"  disabled={locked}/>
          <F label="Line start time"    value={r.start_time}         onChange={v=>upRow(i,'start_time',v)}         type="time"            disabled={locked}/>
          <F label="Line stop time"     value={r.stop_time}          onChange={v=>upRow(i,'stop_time',v)}          type="time"            disabled={locked}/>
          <F label="Time not producing" value={r.time_not_producing} onChange={v=>upRow(i,'time_not_producing',v)} ph="HH:MM"             disabled={locked}/>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em] block mb-2">Failure area (select all that apply)</label>
          <div className="flex flex-wrap gap-2">{FAILURE_AREAS.map(area=>(<label key={area} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-[11px] font-medium transition-colors ${r.failure_areas.includes(area)?'bg-err/10 border-err/30 text-err':'bg-stone-50 border-stone-200 text-stone-500 hover:border-stone-300'}`}><input type="checkbox" checked={r.failure_areas.includes(area)} onChange={()=>!locked&&toggleFailure(i,area)} disabled={locked} className="sr-only"/>{area}</label>))}</div>
        </div>
        <F label="Other — specify" value={r.other_specify} onChange={v=>upRow(i,'other_specify',v)} ph="Describe other failure" disabled={locked} wide/>
        <div className="space-y-1.5"><label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Comments</label><textarea value={r.comments} onChange={e=>upRow(i,'comments',e.target.value)} rows={2} disabled={locked} className="w-full px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none"/></div>
        {rows.length>1&&!locked&&<button onClick={()=>setRows(rs=>rs.filter((_,j)=>j!==i))} className="text-[11px] text-err/60 hover:text-err text-right w-full">Remove run</button>}
      </Card>))}
      {!locked&&<AddRow label="Add run" onClick={()=>setRows(rs=>[...rs,{id:uid(),material:'',speed:'',invertor:'',start_time:'',stop_time:'',time_not_producing:'',failure_areas:[],other_specify:'',comments:''}])}/>}
      {totalNotProducing>0&&(<div className="flex justify-between px-4 py-3 bg-warn/5 border border-warn/20 rounded-xl"><span className="text-[12px] font-semibold text-warn">Total time not producing</span><span className="font-mono font-bold text-[14px] text-warn">{Math.floor(totalNotProducing/60)}h {totalNotProducing%60}m</span></div>)}
    </div>
  )
}

export function PastVacuumRegister({ locked, storageKey='past_vac', onData }:{ locked:boolean; storageKey?:string; onData?:(d:any)=>void }) {
  const [operatorName,setOperatorName]=usePastLS<string>(storageKey+':op',()=>'')
  const [shift,setShift]=usePastLS<string>(storageKey+':shift',()=>'Morning')
  const [rows,setRows]=usePastLS<PastVacuumRow[]>(storageKey+':rows',()=>[{id:uid(),operation:'Bagging',batch:'',start_box:'',end_box:'',comments:''}])
  const onDataRef=React.useRef(onData); onDataRef.current=onData
  useEffect(()=>{ onDataRef.current?.({ operatorName,shift,rows }) },[operatorName,shift,rows])
  function upRow(i:number,k:keyof PastVacuumRow,v:string){setRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r))}
  return (
    <div className="space-y-5">
      <Card title="Vacuum & bagging unit register — header"><div className="grid grid-cols-2 gap-3"><F label="Operator name" value={operatorName} onChange={setOperatorName} ph="e.g. Thabo" disabled={locked}/><F label="Shift" value={shift} onChange={setShift} opts={['Morning','Afternoon']} disabled={locked}/></div></Card>
      <Card title="Operations log">
        <div className="space-y-3">{rows.map((r,i)=>(<div key={r.id} className="bg-stone-50 border border-stone-200 rounded-xl p-3"><div className="flex items-center justify-between mb-2"><span className="font-mono text-[11px] font-semibold text-stone-400">Entry {i+1}</span>{rows.length>1&&!locked&&<button onClick={()=>setRows(rs=>rs.filter((_,j)=>j!==i))} className="text-err/40 hover:text-err"><Trash2 size={13}/></button>}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><F label="Operation" value={r.operation} onChange={v=>upRow(i,'operation',v)} opts={['Vacuuming','Bagging','Boxing','Packing']} disabled={locked}/><F label="Batch number" value={r.batch} onChange={v=>upRow(i,'batch',v.toUpperCase())} ph="e.g. RSFCPAS-001" disabled={locked}/><F label="Starting box no." value={r.start_box} onChange={v=>upRow(i,'start_box',v)} ph="e.g. 001" disabled={locked}/><F label="Ending box no." value={r.end_box} onChange={v=>upRow(i,'end_box',v)} ph="e.g. 100" disabled={locked}/><F label="Comments / concerns" value={r.comments} onChange={v=>upRow(i,'comments',v)} ph="Any issues" disabled={locked} wide/></div></div>))}</div>
        {!locked&&<AddRow label="Add entry" onClick={()=>setRows(rs=>[...rs,{id:uid(),operation:'Bagging',batch:'',start_box:'',end_box:'',comments:''}])}/>}
      </Card>
    </div>
  )
}

export function PastQualityGraphs({ locked, storageKey='past_qual', onData }:{ locked:boolean; storageKey?:string; onData?:(d:any)=>void }) {
  const [batchNo,setBatchNo]=usePastLS<string>(storageKey+':bn',()=>'')
  const [bdPoints,setBdPoints]=usePastLS<PastQualityPoint[]>(storageKey+':bd',()=>[{id:uid(),time:'',value:''}])
  const [mstPoints,setMstPoints]=usePastLS<PastQualityPoint[]>(storageKey+':mst',()=>[{id:uid(),time:'',value:''}])
  const onDataRef=React.useRef(onData); onDataRef.current=onData
  useEffect(()=>{ onDataRef.current?.({ batchNo,bdPoints,mstPoints }) },[batchNo,bdPoints,mstPoints])
  const bdChart=bdPoints.filter(p=>p.time&&p.value).map(p=>({time:p.time,value:num(p.value)})).sort((a,b)=>a.time.localeCompare(b.time))
  const mstChart=mstPoints.filter(p=>p.time&&p.value).map(p=>({time:p.time,value:num(p.value)})).sort((a,b)=>a.time.localeCompare(b.time))
  function PointTable({points,setPoints,yUnit}:{points:PastQualityPoint[];setPoints:React.Dispatch<React.SetStateAction<PastQualityPoint[]>>;yUnit:string}){return(
    <div className="space-y-1.5">
      <div className="grid grid-cols-[28px_1fr_1fr_auto] gap-2 px-1">{['#','Time',yUnit,''].map(h=>(<span key={h} className="text-[9px] font-bold text-stone-400 uppercase">{h}</span>))}</div>
      {points.map((p,i)=>(<div key={p.id} className="grid grid-cols-[28px_1fr_1fr_auto] gap-2 items-center bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5"><span className="font-mono text-[11px] text-stone-400 text-center">{i+1}</span><input type="time" value={p.time} disabled={locked} onChange={e=>setPoints(ps=>ps.map((x,j)=>j===i?{...x,time:e.target.value}:x))} className={INP}/><input type="text" inputMode="decimal" value={p.value} placeholder="—" disabled={locked} onChange={e=>setPoints(ps=>ps.map((x,j)=>j===i?{...x,value:e.target.value}:x))} className={INP}/>{points.length>1&&!locked?<button onClick={()=>setPoints(ps=>ps.filter((_,j)=>j!==i))} className="text-err/40 hover:text-err"><Trash2 size={12}/></button>:<span/>}</div>))}
      {!locked&&<button onClick={()=>setPoints(ps=>[...ps,{id:uid(),time:nowTime(),value:''}])} className="w-full py-2 border border-dashed border-stone-300 rounded-xl text-[12px] font-medium text-stone-400 hover:border-brand hover:text-brand hover:bg-brand/5 transition-all flex items-center justify-center gap-1.5"><Plus size={13}/> Add reading</button>}
    </div>
  )}
  return (
    <div className="space-y-5">
      <Card title="Quality graphs — header"><F label="Batch number" value={batchNo} onChange={setBatchNo} ph="e.g. RSFCPAS-001" disabled={locked}/></Card>
      <Card title="Bulk density (CC/100g)" variant="info"><div className="overflow-x-auto"><SimpleLineChart points={bdChart} yLabel="CC/100g" color="#f59e0b" yMin={0} yMax={Math.max(100,...bdChart.map(p=>p.value))+10}/></div><PointTable points={bdPoints} setPoints={setBdPoints} yUnit="CC/100g"/></Card>
      <Card title="Moisture (%)" variant="info"><div className="overflow-x-auto"><SimpleLineChart points={mstChart} yLabel="%" color="#3b82f6" yMin={0} yMax={Math.max(15,...mstChart.map(p=>p.value))+2}/></div><PointTable points={mstPoints} setPoints={setMstPoints} yUnit="%"/></Card>
      <div className="bg-stone-50 border-2 border-dashed border-stone-300 rounded-2xl p-6 text-center space-y-3">
        <p className="font-semibold text-[14px] text-stone-600">Circular chart recorder</p>
        <p className="text-[12px] text-stone-400 max-w-sm mx-auto">Physical drum chart is scanned and archived against the batch. Image upload coming soon.</p>
        <p className="font-mono text-[10px] text-stone-400">Batch: {batchNo||'—'}</p>
      </div>
    </div>
  )
}

export type PastTab = 'daily'|'rate'|'debagging'|'bagging'|'timesheet'|'vacuum'|'quality'
export const PAST_TABS: {id:PastTab;label:string}[] = [
  {id:'daily',label:'1. Daily report'},{id:'rate',label:'2. Rate of prod.'},{id:'debagging',label:'3. Debagging'},
  {id:'bagging',label:'4. Bagging'},{id:'timesheet',label:'5. Timesheet'},{id:'vacuum',label:'6. Vacuum reg.'},{id:'quality',label:'7. Quality'},
]

export function PasteuriseurForm({ locked, onData, savedData, sessionId, dateParam, shift }: {
  locked:boolean; onData:(d:any)=>void; savedData?:any
  sessionId?:string|null; dateParam?:string; shift?:string
}) {
  const [activeTab, setActiveTab] = useState<PastTab>('debagging')
  const sk = (tab:string) => `cntp_past_${sessionId??'new'}_${dateParam??'today'}_${shift??'m'}_${tab}`

  // Accumulate data from all sub-forms — use a ref so callbacks stay stable and
  // don't cause sub-form re-renders; parent onData is called on every sub-form update.
  const accRef = React.useRef<any>({ section: 'pasteuriser' })
  const onDataRef = React.useRef(onData); onDataRef.current = onData

  const onSubData = React.useCallback((key: string, data: any) => {
    accRef.current = { ...accRef.current, [key]: data }
    onDataRef.current(accRef.current)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex overflow-x-auto gap-1 pb-1 -mx-1 px-1">
        {PAST_TABS.map(tab=>(<button key={tab.id} onClick={()=>setActiveTab(tab.id)} className={`flex-shrink-0 px-3 py-2 rounded-xl font-medium text-[12px] transition-colors whitespace-nowrap ${activeTab===tab.id?'bg-red-500 text-white':'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}>{tab.label}</button>))}
      </div>
      <div style={{display: activeTab==='daily'     ? 'block' : 'none'}}><PastDailyReport      locked={locked} storageKey={sk('daily')}   onData={d=>onSubData('daily',   d)}/></div>
      <div style={{display: activeTab==='rate'      ? 'block' : 'none'}}><PastRateOfProduction locked={locked} storageKey={sk('rate')}    onData={d=>onSubData('rate',    d)}/></div>
      <div style={{display: activeTab==='debagging' ? 'block' : 'none'}}><PastDebagging        locked={locked} storageKey={sk('debag')}   onData={d=>onSubData('debag',   d)}/></div>
      <div style={{display: activeTab==='bagging'   ? 'block' : 'none'}}><PastBagging          locked={locked} storageKey={sk('bagging')} onData={d=>onSubData('bagging', d)}/></div>
      <div style={{display: activeTab==='timesheet' ? 'block' : 'none'}}><PastProcessTimesheet locked={locked} storageKey={sk('ts')}      onData={d=>onSubData('ts',      d)}/></div>
      <div style={{display: activeTab==='vacuum'    ? 'block' : 'none'}}><PastVacuumRegister   locked={locked} storageKey={sk('vacuum')}  onData={d=>onSubData('vacuum',  d)}/></div>
      <div style={{display: activeTab==='quality'   ? 'block' : 'none'}}><PastQualityGraphs    locked={locked} storageKey={sk('quality')} onData={d=>onSubData('quality', d)}/></div>
    </div>
  )
}

export function PasteuriseurFormWrapper({ locked, onData, savedData, sessionId, dateParam, shift }: {
  locked:boolean; onData:(d:any)=>void; savedData?:any; sessionId?:string|null; dateParam?:string; shift?:string
}) {
  return <PasteuriseurForm locked={locked} onData={onData} savedData={savedData} sessionId={sessionId||null} dateParam={dateParam||''} shift={shift||'Morning'}/>
}

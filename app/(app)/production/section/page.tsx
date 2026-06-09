'use client'
// ══════════════════════════════════════════════════════════════════════════════
// DATABASE MIGRATION — run once in Supabase SQL Editor
// ══════════════════════════════════════════════════════════════════════════════
// ALTER TABLE production.prod_sessions
//   ADD COLUMN IF NOT EXISTS operator_names text,
//   ADD COLUMN IF NOT EXISTS supervisor_name text,
//   ADD COLUMN IF NOT EXISTS op_signed boolean DEFAULT false,
//   ADD COLUMN IF NOT EXISTS sup_signed boolean DEFAULT false,
//   ADD COLUMN IF NOT EXISTS op_name_signoff text,
//   ADD COLUMN IF NOT EXISTS sup_name_signoff text,
//   ADD COLUMN IF NOT EXISTS comments text,
//   ADD COLUMN IF NOT EXISTS lot_number text,
//   ADD COLUMN IF NOT EXISTS production_orders text[];
//
// -- bag_tags needs destination + acumatica_id + genealogy fields
// ALTER TABLE production.bag_tags
//   ADD COLUMN IF NOT EXISTS destination text,         -- where this bag goes next
//   ADD COLUMN IF NOT EXISTS acumatica_id text,        -- Acumatica inventory code
//   ADD COLUMN IF NOT EXISTS consumed_at_session text, -- session_id where this bag was used
//   ADD COLUMN IF NOT EXISTS consumed_at_section text, -- section where this bag was consumed
//   ADD COLUMN IF NOT EXISTS consumed_weight_kg numeric;-- weight consumed (may differ from original)
//
// -- scan_events table for future scanner use
// CREATE TABLE IF NOT EXISTS production.scan_events (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   serial_number text NOT NULL,
//   scanned_at timestamptz DEFAULT now(),
//   section_id text,
//   session_id text,
//   operator_id uuid,
//   action text, -- 'debagging_in' | 'bagging_out' | 'stock_count' | 'dispatch'
//   weight_kg numeric,
//   FOREIGN KEY (serial_number) REFERENCES production.bag_tags(serial_number) ON DELETE CASCADE
// );
// CREATE INDEX IF NOT EXISTS scan_events_serial_idx ON production.scan_events(serial_number);
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, Suspense } from 'react'
import * as React from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO } from 'date-fns'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  CheckCircle2, ChevronLeft, Loader2, Clock, ClipboardList, Sparkles,
  PenLine, Lock, RotateCcw,
} from 'lucide-react'

import { AcumaticaSummary } from '@/components/production/AcumaticaSummary'
import { normaliseVariant, variantSuffix } from '@/lib/constants/manufacturing'
import { num } from '@/components/production/shared/ui'
import { markBagConsumed, variantFamily } from '@/lib/production/scan-utils'

// Form components — extracted into separate files
import { SievingFormWrapper } from '@/components/production/SievingTowerForm'
import { RefiningForm, Refining2Form } from '@/components/production/RefiningForms'
import { GranuleForm } from '@/components/production/GranuleLineForm'
import { MultiBlenderForm, MultiProductionWrapper } from '@/components/production/BlenderForms'
import { PasteuriseurFormWrapper } from '@/components/production/PasteuriserForm'
import { TimesheetTab } from '@/components/production/TimesheetTab'
import { nowTime, F, Card } from '@/components/production/shared/ui'

// ══════════════════════════════════════════════════════════════════════════════
// SECTION META + TABS
// ══════════════════════════════════════════════════════════════════════════════
const SECTION_META: Record<string,{name:string;code:string;color:string}> = {
  sieving:    {name:'Sieving Tower',code:'ST',color:'bg-blue-500'},
  refining1:  {name:'Refining 1',   code:'R1',color:'bg-emerald-600'},
  refining2:  {name:'Refining 2',   code:'R2',color:'bg-emerald-500'},
  granule:    {name:'Granule Line', code:'GL',color:'bg-amber-500'},
  blender:    {name:'Blender',      code:'BL',color:'bg-purple-500'},
  pasteuriser:{name:'Pasteuriser',  code:'PR',color:'bg-red-500'},
}
type Tab='timesheet'|'production'|'cleaning'|'signoff'
const TABS:{id:Tab;label:string;icon:React.ReactNode}[]=[
  {id:'timesheet', label:'Timesheet',  icon:<Clock size={14}/>},
  {id:'production',label:'Production', icon:<ClipboardList size={14}/>},
  {id:'cleaning',  label:'Cleaning',   icon:<Sparkles size={14}/>},
  {id:'signoff',   label:'Sign-off',   icon:<PenLine size={14}/>},
]

// ── ScanToast — brief visual confirmation when scanner fires ─────────────────
function ScanToast({ serial, product, status }: {
  serial: string; product: string; status: 'found' | 'unknown' | 'adding'
}) {
  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl font-mono text-[13px] font-bold transition-all animate-in slide-in-from-top-2 duration-200 ${
      status === 'found'   ? 'bg-stone-900 text-white' :
      status === 'unknown' ? 'bg-warn text-white' :
      'bg-stone-700 text-white'
    }`}>
      {status === 'found'   && <span className="text-ok text-[16px]">✓</span>}
      {status === 'unknown' && <span className="text-[16px]">?</span>}
      {status === 'adding'  && <span className="text-[16px]">⏳</span>}
      <div>
        <div>{serial}</div>
        <div className="font-sans font-normal text-[10px] opacity-70">{product}</div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CLEANING CHECKLIST
// ══════════════════════════════════════════════════════════════════════════════
type CleanTask = { id:string; area:string; task:string; responsible:string; done:boolean; time:string; name:string }
const CLEANING_TASKS: Record<string,CleanTask[]> = {
  sieving:[
    {id:crypto.randomUUID(),area:'Sieving',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Brush sieves (every 2 hrs)',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Brush off aspirator',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Clean magnet',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Brush off dust on bell conveyors',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Brush off dust on screw conveyor',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Brush off excess tea on rolsif + wipe magnet',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Brush down screen with telescopic handle and vacuum up dust',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Sieving',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'De-bagging',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'De-bagging',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'De-bagging',task:'Sweep spillages',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Dust Collection Room',task:'Brush crevices and hard to reach areas',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Dust Collection Room',task:'Vacuum walls and floors',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Dust Collection Room',task:'Bag filters removed and changed (Rooibos↔Honeybush)',responsible:'General cleaner',done:false,time:'',name:''},
  ],
  refining1:[
    {id:crypto.randomUUID(),area:'De-bagging',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'De-bagging',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'De-bagging',task:'Sweep spillages',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Post-sieve',task:'Clean sieves by brushing off excess tea leaves, dust and material',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Post-sieve',task:'Remove foreign material from magnet and record on form',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Post-sieve',task:'Brush down screw conveyors and chute',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Post-sieve',task:'Vacuum walls and floors',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Wipe surfaces on conveyor chute with disposable cloth',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Brush down small conveyor',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Lift scale and vacuum or sweep tea underneath daily',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
  refining2:[],
  granule:[
    {id:crypto.randomUUID(),area:'Granule Line',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Granule Line',task:'Brush off all dust on equipment surfaces',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Granule Line',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Wipe surfaces on conveyor chute',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Check and clean scale',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
  blender:[
    {id:crypto.randomUUID(),area:'Blender',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Blender',task:'After mini-blender: brush, vacuum and disinfect',responsible:'Operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Wipe surfaces on conveyor chute with disposable cloth',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Check and clean scale',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
  pasteuriser:[
    {id:crypto.randomUUID(),area:'Pasteuriser',task:'Clean per PPM 13.4',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Pasteuriser',task:'Vacuum dust and leaves from walls and floors',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Drying',task:'Remove funnel at dryer feed and wipe with disposable cloth',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Drying',task:'Remove all hatches, brush and vacuum inside dryer',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Drying',task:'Brush down screw conveyor and chute',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Drying',task:'Vacuum walls and floors',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Wipe surfaces on conveyor chute with disposable cloth',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:crypto.randomUUID(),area:'Bagging',task:'Check and clean scale',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
}
CLEANING_TASKS['refining2'] = CLEANING_TASKS['refining1'].map(t=>({...t,id:crypto.randomUUID()}))

function CleaningTab({ sectionId, locked, onProgress, onTaskUpdate }: { sectionId:string; locked:boolean; onProgress?:(done:number,total:number)=>void; onTaskUpdate?:(tasks:any[])=>void }) {
  const [tasks,setTasks]=useState<CleanTask[]>(()=>(CLEANING_TASKS[sectionId]??[]).map(t=>({...t,id:crypto.randomUUID()})))
  function toggle(i:number){
    setTasks(ts => ts.map((t,j)=>j===i?{...t,done:!t.done,time:!t.done?nowTime():t.time}:t))
  }
  // Call onTaskUpdate in useEffect so it fires AFTER state settles, not during render
  const tasksRef = React.useRef(tasks)
  tasksRef.current = tasks
  useEffect(()=>{ onTaskUpdate?.(tasks) },[tasks])
  function setName(i:number,v:string){setTasks(ts=>ts.map((t,j)=>j===i?{...t,name:v}:t))}
  const done=tasks.filter(t=>t.done).length,total=tasks.length,pct=total>0?Math.round((done/total)*100):0
  const areas=[...new Set(tasks.map(t=>t.area))]
  useEffect(()=>{ onProgress?.(done,total) },[done,total])
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-stone-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2"><span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Checklist progress</span><span className="font-mono font-bold text-[18px] text-brand">{done}/{total}</span></div>
        <div className="h-2 bg-stone-100 rounded-full overflow-hidden"><div className="h-full bg-brand rounded-full transition-all duration-300" style={{width:`${pct}%`}}/></div>
      </div>
      {areas.map(area=>(
        <Card key={area} title={area}>
          {tasks.filter(t=>t.area===area).map(t=>{
            const i=tasks.findIndex(x=>x.id===t.id)
            return(
              <div key={t.id} className={`rounded-xl border p-4 transition-colors ${t.done?'bg-ok/5 border-ok/30':'bg-stone-50 border-stone-200'}`}>
                <div className="flex items-start gap-3">
                  <button onClick={()=>!locked&&toggle(i)} className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${t.done?'bg-ok border-ok':'border-stone-300 bg-white'} ${locked?'cursor-not-allowed':'cursor-pointer'}`}>
                    {t.done&&<CheckCircle2 size={12} className="text-white"/>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] leading-snug ${t.done?'text-ok line-through opacity-70':'text-text'}`}>{t.task}</p>
                    <p className="text-[10px] text-text-faint mt-0.5">{t.responsible}</p>
                    {t.done&&(<div className="flex items-center gap-2 mt-2"><span className="font-mono text-[10px] text-ok">{t.time}</span><input value={t.name} onChange={e=>setName(i,e.target.value)} placeholder="Print name" disabled={locked} className="flex-1 px-2 py-1 rounded-lg border border-ok/30 bg-ok/5 text-[12px] text-ok outline-none focus:border-ok"/></div>)}
                  </div>
                </div>
              </div>
            )
          })}
        </Card>
      ))}
      {done===total&&total>0&&(<div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl"><CheckCircle2 size={20} className="text-ok"/><span className="font-semibold text-[14px] text-ok">All cleaning tasks completed.</span></div>)}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SIGN-OFF
// ══════════════════════════════════════════════════════════════════════════════
function SignaturePad({ label, onSign, signed, disabled }: { label:string; onSign:(data:string)=>void; signed:boolean; disabled:boolean }) {
  const canvasRef=useRef<HTMLCanvasElement>(null),drawing=useRef(false)
  const [hasSig,setHasSig]=useState(false)
  function getPos(e:MouseEvent|TouchEvent,canvas:HTMLCanvasElement){const rect=canvas.getBoundingClientRect();const src='touches' in e?e.touches[0]:e;return{x:src.clientX-rect.left,y:src.clientY-rect.top}}
  function startDraw(e:any){if(disabled||signed)return;drawing.current=true;const ctx=canvasRef.current!.getContext('2d')!;const pos=getPos(e.nativeEvent??e,canvasRef.current!);ctx.beginPath();ctx.moveTo(pos.x,pos.y);e.preventDefault?.()}
  function draw(e:any){if(!drawing.current||disabled)return;const ctx=canvasRef.current!.getContext('2d')!;ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#1C1917';const pos=getPos(e.nativeEvent??e,canvasRef.current!);ctx.lineTo(pos.x,pos.y);ctx.stroke();setHasSig(true);e.preventDefault?.()}
  function stopDraw(){drawing.current=false}
  function clear(){canvasRef.current!.getContext('2d')!.clearRect(0,0,600,140);setHasSig(false)}
  function confirm(){onSign(canvasRef.current!.toDataURL())}
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">{label}</label>
      <div className={`rounded-2xl border-2 overflow-hidden ${signed?'border-ok/40 bg-ok/5':'border-stone-200 bg-white'}`}>
        {signed?(
          <div className="flex items-center gap-3 px-5 py-5"><CheckCircle2 size={20} className="text-ok"/><span className="font-semibold text-[14px] text-ok">Signed</span></div>
        ):(
          <>
            <canvas ref={canvasRef} width={600} height={140} className="w-full touch-none cursor-crosshair block" style={{height:140}}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}/>
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50">
              <span className="text-[10px] text-stone-400">Sign above with finger or stylus</span>
              <div className="flex gap-2">
                {hasSig&&<button onClick={clear} disabled={disabled} className="text-[11px] text-stone-500 hover:text-err px-3 py-1.5 rounded-lg border border-stone-200">Clear</button>}
                {hasSig&&<button onClick={confirm} disabled={disabled} className="text-[11px] text-white bg-brand px-3 py-1.5 rounded-lg">Confirm</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SignOffTab({ locked, sessionStatus, onSubmit, onApprove, onRequestCorrection, submitting, role, sectionId, formData, dateParam, shift, onSignatureData }: {
  locked:boolean; sessionStatus:string; onSubmit:()=>void; onApprove:()=>void
  onRequestCorrection:(reason:string)=>Promise<void>; submitting:boolean; role:string|null
  sectionId:string; formData:any; dateParam:string; shift:string; onSignatureData?:(d:any)=>void
}) {
  const [opSig,setOpSig]=useState(''),[supSig,setSupSig]=useState('')
  const [opName,setOpName]=useState('')
  const [supName,setSupName]=useState('')
  useEffect(()=>{
    onSignatureData?.({opName, supName, opSigned: !!opSig, supSigned: !!supSig})
  },[opName, supName, opSig, supSig])
  const [showCorrect,setShowCorrect]=useState(false),[correctReason,setCorrectReason]=useState(''),[correcting,setCorrecting]=useState(false)
  const opDone=!!opSig,supDone=!!supSig
  async function handleCorrection(){if(!correctReason.trim())return;setCorrecting(true);await onRequestCorrection(correctReason.trim());setShowCorrect(false);setCorrectReason('');setCorrecting(false)}
  return (
    <div className="space-y-5">
      <div className="px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl">
        <p className="text-[13px] text-stone-500 leading-relaxed">Both operator and supervisor must sign to complete this shift record. The supervisor signature locks the form.</p>
      </div>
      {sectionId!=='pasteuriser'&&<AcumaticaSummary sectionId={sectionId} sessionData={formData} date={dateParam} shift={shift}/>}
      <Card title="Operator sign-off">
        <F label="Operator name (print)" value={opName} onChange={setOpName} ph="Full name" disabled={locked}/>
        <SignaturePad label="Operator signature" onSign={setOpSig} signed={opDone} disabled={locked}/>
      </Card>
      {opDone&&<Card title="Supervisor sign-off">
        <F label="Supervisor name (print)" value={supName} onChange={setSupName} ph="Full name" disabled={locked}/>
        <SignaturePad label="Supervisor signature" onSign={setSupSig} signed={supDone} disabled={locked}/>
      </Card>}
      {!locked&&opDone&&supDone&&sessionStatus!=='submitted'&&sessionStatus!=='approved'&&(
        <button onClick={onSubmit} disabled={submitting} className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40">
          {submitting?<Loader2 size={18} className="animate-spin"/>:<CheckCircle2 size={18}/>}{submitting?'Submitting…':'Submit shift record'}
        </button>
      )}
      {(role==='supervisor'||role==='admin')&&sessionStatus==='submitted'&&(
        <button onClick={onApprove} disabled={submitting} className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] disabled:opacity-40">
          {submitting?<Loader2 size={18} className="animate-spin"/>:<Lock size={18}/>}{submitting?'Locking…':'Approve and lock session'}
        </button>
      )}
      {role!=='supervisor'&&role!=='admin'&&sessionStatus==='submitted'&&(
        <div className="flex items-center gap-3 px-4 py-3 bg-info/5 border border-info/20 rounded-2xl text-[13px] text-info">
          <CheckCircle2 size={16} className="flex-shrink-0"/>
          <span>Record submitted — waiting for supervisor approval. A supervisor can approve this session from their device.</span>
        </div>
      )}
      {sessionStatus==='submitted'&&!locked&&(
        <div className="space-y-3">
          {!showCorrect?(
            <button onClick={()=>setShowCorrect(true)} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-warn/40 bg-warn/10 text-warn font-medium text-[13px] hover:bg-warn/20 transition-colors">
              <RotateCcw size={15}/> Request correction
            </button>
          ):(
            <div className="bg-warn/5 border border-warn/30 rounded-2xl p-4 space-y-3">
              <p className="text-[12px] font-semibold text-warn">State the reason for correction</p>
              <textarea value={correctReason} onChange={e=>setCorrectReason(e.target.value)} rows={3}
                placeholder="e.g. Wrong weight entered for Fine Leaf bag 2"
                className="w-full px-3 py-2.5 rounded-xl border border-warn/30 bg-white text-[13px] text-text outline-none focus:border-warn resize-none"/>
              <div className="flex gap-2">
                <button onClick={()=>{setShowCorrect(false);setCorrectReason('')}} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
                <button onClick={handleCorrection} disabled={!correctReason.trim()||correcting} className="flex-1 py-2.5 rounded-xl bg-warn text-white text-[13px] font-medium disabled:opacity-40">{correcting?'Unlocking…':'Confirm — unlock for editing'}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {locked&&<div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl"><Lock size={20} className="text-ok"/><span className="font-semibold text-[14px] text-ok">Session signed off and locked.</span></div>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION CAPTURE — session orchestration
// ══════════════════════════════════════════════════════════════════════════════
function SectionCaptureInner() {
  const sp=useSearchParams(),router=useRouter()
  const {user,role}=useAuth()
  const sectionId=sp.get('id')??'',shift=sp.get('shift')??'morning',dateParam=sp.get('date')??format(new Date(),'yyyy-MM-dd')
  const meta=SECTION_META[sectionId]
  const [activeTab,setActiveTab]=useState<Tab>('timesheet')
  const [cleaningDone,setCleaningDone]=useState(0)
  const [cleaningTotal,setCleaningTotal]=useState(0)
  const [sessionId,setSessionId]=useState<string|null>(null)
  const [sessionStatus,setStatus]=useState<'new'|'draft'|'submitted'|'approved'>('new')
  const [formData,setFormData]=useState<any>({})
  const [savedData,setSavedData]=useState<any>(null)   // ← restored from Supabase notes
  const [saving,setSaving]=useState(false),[submitting,setSubmitting]=useState(false)
  const [saved,setSaved]=useState(false),[error,setError]=useState<string|null>(null)
  const [loading,setLoading]=useState(true)

  // ── Always-fresh refs so timers / event handlers never read stale closures ─
  const formDataRef  = React.useRef<any>({})
  const sessionIdRef = React.useRef<string|null>(null)
  formDataRef.current  = formData
  sessionIdRef.current = sessionId

  // ── Save on page hide/unload to prevent data loss ────────────────────────
  useEffect(()=>{
    function onHide() {
      // Fire-and-forget save when page is hidden (tab switch, screen timeout, etc.)
      const fd  = formDataRef.current
      const sid = sessionIdRef.current
      if (sid && Object.keys(fd).length > 0) {
        getDb().schema('production').from('prod_sessions').update({
          notes: JSON.stringify(fd), updated_at: new Date().toISOString()
        } as any).eq('id', sid).then(()=>{}).catch(()=>{})
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])  // stable — uses refs

  // ── Auto-save every 30 s (only when a session exists) ───────────────────
  useEffect(()=>{
    const timer = setInterval(()=>{
      const fd  = formDataRef.current
      const sid = sessionIdRef.current
      if (!sid || Object.keys(fd).length === 0) return
      getDb().schema('production').from('prod_sessions').update({
        notes: JSON.stringify(fd), updated_at: new Date().toISOString()
      } as any).eq('id', sid).catch(()=>{})
    }, 30_000)
    return () => clearInterval(timer)
  }, [])  // stable — uses refs, fires once on mount

  // ── Load session — fetch notes for draft restore ─────────────────────────
  useEffect(()=>{
    if(!sectionId){setLoading(false);return}
    async function load(){
      const{data}=await getDb().schema('production').from('prod_sessions')
        .select('id,status,notes')
        .eq('section_id',sectionId).eq('date',dateParam).eq('shift',shift)
        .maybeSingle()
      if(data){
        setSessionId((data as any).id)
        setStatus((data as any).status)
        // Restore saved form data
        if((data as any).notes){
          try{
            const parsed=typeof (data as any).notes==='string'
              ? JSON.parse((data as any).notes)
              : (data as any).notes
            setFormData(parsed)
            setSavedData(parsed)
          }catch(e){ console.warn('Could not parse saved notes:',e) }
        }
        // Jump to production tab when resuming a draft
        if((data as any).status==='draft') setActiveTab('production')
      }
      setLoading(false)
    }
    load()
  },[sectionId,dateParam,shift])

  async function ensureSession(){
    if(sessionId)return sessionId
    const{data}=await getDb().schema('production').from('prod_sessions').insert({section_id:sectionId,section_name:meta?.name??sectionId,date:dateParam,shift,status:'draft',created_at:new Date().toISOString(),updated_at:new Date().toISOString()} as any).select('id').single()
    const id=(data as any).id;setSessionId(id);return id
  }

  // ── Build structured debagging rows from formData (handles multi-production) ──
  function buildDebagRows(sid: string): any[] {
    const fd = formData
    // Flatten across productions if present
    const allProductions: any[] = fd.productions ? fd.productions.map((p:any)=>p.data||p).filter(Boolean) : [fd]
    const rows: any[] = []
    // Sieving (structured rows from first/active production; all data in notes JSON)
    if (sectionId === 'sieving' && fd.debag) {
      fd.debag.forEach((r: any, i: number) => {
        if (!r.mass_nett || num(r.mass_nett) === 0) return
        rows.push({ session_id:sid, sequence_no:i+1, bag_serial_no:r.bag_number||null, lot_number:r.lot_serial||null,
          product_type:r.local_export||null, variant:r.org_conv?.slice(0,2)||null,
          kg_gross:num(r.mass_gross)||null, kg_nett:num(r.mass_nett), delivery_date:r.delivery_date||null })
      })
    }
    // Refining 1
    if (sectionId === 'refining1' && fd.debag) {
      fd.debag.forEach((r: any, i: number) => {
        if (!r.qty || num(r.qty) === 0) return
        rows.push({ session_id:sid, sequence_no:i+1, bag_serial_no:r.serial||null, lot_number:null,
          product_type:r.grade||null, variant:r.con_org?.slice(0,1)||null, kg_nett:num(r.qty), delivery_date:r.date||null })
      })
    }
    // Refining 2
    if (sectionId === 'refining2' && fd.debag) {
      fd.debag.forEach((r: any, i: number) => {
        if (!r.qty || num(r.qty) === 0) return
        rows.push({ session_id:sid, sequence_no:i+1, bag_serial_no:r.serial||null, lot_number:null,
          product_type:r.grade||null, variant:r.con_org?.slice(0,1)||null, kg_nett:num(r.qty), delivery_date:r.date||null })
      })
    }
    // Blender
    if (sectionId === 'blender') {
      const ingredients = [
        {key:'rowsA',type:'Sieved Fine Leaf'},{key:'rowsB',type:'Sieved Coarse Leaf'},
        {key:'rowsC',type:'Blocks Clean'},{key:'rowsD',type:'Blocks Cut'},
        {key:'rowsE',type:fd.other1Label||'Other 1'},{key:'rowsF',type:fd.other2Label||'Other 2'},
      ]
      let seq = 1
      ingredients.forEach(({key,type}) => {
        const ingRows: any[] = fd[key] ?? []
        ingRows.forEach((r: any) => {
          if (!r.kg || num(r.kg) === 0) return
          rows.push({ session_id:sid, sequence_no:seq++, lot_number:r.lot||null, bag_serial_no:r.serial||null,
            product_type:type, variant:null, kg_nett:num(r.kg) })
        })
      })
    }
    // Pasteuriser — D table (incoming bags) + E table (post-sieve blending)
    if (sectionId === 'pasteuriser') {
      const variant = fd.debag?.variantCode || null
      const allInputRows = [...(fd.debag?.debagRows??[]), ...(fd.debag?.postSieveRows??[])]
      allInputRows.forEach((r: any, i: number) => {
        if (!r.kg || num(r.kg) === 0) return
        rows.push({ session_id:sid, sequence_no:i+1, bag_serial_no:r.serial||null, lot_number:r.lot||null,
          product_type:r.product_type||null, variant, kg_nett:num(r.kg) })
      })
    }
    return rows
  }

  // ── Build structured bagging rows from formData (handles multi-production) ──
  function buildBagRows(sid: string): any[] {
    const fd = formData
    const allProductions: any[] = fd.productions ? fd.productions.map((p:any)=>p.data||p).filter(Boolean) : [fd]
    const rows: any[] = []
    // Sieving — Fine Leaf and Coarse Leaf tracked bags
    if (sectionId === 'sieving') {
      const streams = [
        {bags: fd.flBags??[], type:'Fine Leaf',   group:'A'},
        {bags: fd.clBags??[], type:'Coarse Leaf',  group:'B'},
      ]
      let seq = 1
      streams.forEach(({bags,type,group}) => {
        bags.forEach((b: any) => {
          if (!b.kg || num(b.kg) === 0) return
          rows.push({ session_id:sid, sequence_no:seq++, output_group:group, bag_serial_no:b.serial||null,
            lot_number:b.batch||null, product_type:type, kg:num(b.kg),
            bagging_time:b.time||null })
        })
      })
    }
    // Refining 1 — generic output groups
    if (sectionId === 'refining1') {
      const groups = [{rows:fd.out1??[],g:'B'},{rows:fd.out2??[],g:'C'},{rows:fd.out3??[],g:'D'}]
      let seq = 1
      groups.forEach(({rows:gRows,g}) => {
        gRows.forEach((r: any) => {
          if (!r.qty || num(r.qty) === 0) return
          rows.push({ session_id:sid, sequence_no:seq++, output_group:g, lot_number:null, bag_serial_no:r.serial||null,
            product_type:r.name||null, kg:num(r.qty) })
        })
      })
    }
    // Refining 2 — named outputs
    if (sectionId === 'refining2') {
      const groups = [
        {rows:fd.rowsA??[],type:'Cut Heavy Stick Fine',g:'A'},
        {rows:fd.rowsB??[],type:'Cut Heavy Stick Coarse',g:'B'},
        {rows:fd.rowsC??[],type:'White Dust',g:'C'},
        {rows:fd.rowsD??[],type:'Powder Dust',g:'D'},
      ]
      let seq = 1
      groups.forEach(({rows:gRows,type,g}) => {
        gRows.forEach((r: any) => {
          if (!r.qty || num(r.qty) === 0) return
          rows.push({ session_id:sid, sequence_no:seq++, output_group:g, bag_serial_no:r.serial||null,
            lot_number:r.lot||null, product_type:type, kg:num(r.qty) })
        })
      })
    }
    // Blender — output bags
    if (sectionId === 'blender' && fd.bagRows) {
      fd.bagRows.forEach((r: any, i: number) => {
        if (!r.kg || num(r.kg) === 0) return
        rows.push({ session_id:sid, sequence_no:i+1, output_group:'G', bag_serial_no:r.serial_no||null,
          lot_number:fd.lotNo||null, product_type:r.blend_type||fd.blendCode||null,
          kg:num(r.kg), bagging_time:r.time||null })
      })
    }
    // Granule
    if (sectionId === 'granule' && fd.bagRows) {
      fd.bagRows.forEach((r: any, i: number) => {
        const kg = num(r.total_weight)
        if (kg === 0) return
        rows.push({ session_id:sid, sequence_no:i+1, output_group:'G', lot_number:r.lot_number||null,
          bag_serial_no:r.serial_numbers||null, product_type:r.item||null, kg })
      })
    }
    // Pasteuriser — bagging station output bags (table A)
    if (sectionId === 'pasteuriser' && fd.bagging?.bagRows) {
      fd.bagging.bagRows.forEach((r: any, i: number) => {
        const kg = num(r.total_weight)
        if (kg === 0) return
        rows.push({ session_id:sid, sequence_no:i+1, output_group:'A', lot_number:r.lot||null,
          bag_serial_no:r.start_bag||null, product_type:r.item||null, kg,
          bagging_time:r.start_time||null })
      })
    }
    return rows
  }

  // ── Build bag_tag rows — FULL genealogy chain ────────────────────────────────
  function buildBagTagRows(sid: string): any[] {
    const fd = formData
    const now = new Date().toISOString()
    const dateStr = dateParam
    const tags: any[] = []

    function pushTag(t: {
      section_id: string; section_name: string; product_type: string
      serial_number: string | null; lot_number: string | null; weight_kg: number | null
      variant?: string | null; acumatica_id?: string | null; destination?: string | null
      qc_name?: string | null; qc_grade?: string | null; operator_name?: string | null
    }) {
      if (!t.weight_kg || t.weight_kg <= 0) return
      const serial = (t.serial_number || '').trim() || 'NOT TRACKED'
      tags.push({
        ...t,
        serial_number:   serial,
        lot_number:      t.lot_number || 'NOT TRACKED',
        variant:         t.variant ?? undefined,
        acumatica_id:    t.acumatica_id ?? undefined,
        destination:     t.destination ?? undefined,
        tag_date:        dateStr,
        prod_session_id: sid,
        qr_payload:      serial !== 'NOT TRACKED' ? serial : undefined,
        captured_at:     now,
        qc_name:         t.qc_name ?? undefined,
        qc_grade:        t.qc_grade ?? undefined,
        operator_name:   t.operator_name ?? undefined,
      })
    }

    // ── SIEVING TOWER ──────────────────────────────────────────────────────────
    if (sectionId === 'sieving') {
      const sieveVariant = normaliseVariant(fd.debag?.[0]?.org_conv) ?? 'Conventional'
      const vSuffix = variantSuffix(sieveVariant)

      const selectedPhantomId = (fd.prodOrderId || '').split(' — ')[0].trim()
      const derivedPhantomId = (() => {
        const le = (fd.debag?.[0]?.local_export || '').toLowerCase()
        const grade = le.includes('blend') ? 'BL' : le.includes('domestic') ? 'D' : 'E'
        return `S10LG${grade}-${vSuffix}`
      })()
      const leafPhantomId = selectedPhantomId || derivedPhantomId

      ;(fd.flBags??[]).forEach((b:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Fine Leaf', serial_number:b.serial||null,
        lot_number:b.batch||null, weight_kg:parseFloat(b.kg)||null,
        variant: sieveVariant, acumatica_id: leafPhantomId, destination: undefined,
        qc_name: b.qc_name||fd.qcName||null, operator_name: fd.shiftOps||null,
      }))
      ;(fd.clBags??[]).forEach((b:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Coarse Leaf', serial_number:b.serial||null,
        lot_number:b.batch||null, weight_kg:parseFloat(b.kg)||null,
        variant: sieveVariant, acumatica_id: leafPhantomId, destination: undefined,
        qc_name: b.qc_name||fd.qcName||null, operator_name: fd.shiftOps||null,
      }))
      ;(fd.indentEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Indent Sticks', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        variant: sieveVariant, acumatica_id: `15IGIS-${vSuffix}`, destination: undefined,
      }))
      ;(fd.rolsievEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Rolsiev Sticks', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        variant: sieveVariant, acumatica_id: `15IGST-${vSuffix}`, destination: undefined,
      }))
      ;(fd.dustEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Brown Dust', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        variant: sieveVariant, acumatica_id: `15IGDB-${vSuffix}`, destination: undefined,
      }))
      ;(fd.rbEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'RB Blocks', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        variant: sieveVariant, acumatica_id: `15IGBL-C-${vSuffix}`, destination: undefined,
      }))
    }

    // ── REFINING 1 ─────────────────────────────────────────────────────────────
    if (sectionId === 'refining1') {
      const r1Variant = normaliseVariant(fd.debag?.[0]?.con_org) ?? 'Conventional'
      const r1Suffix  = variantSuffix(r1Variant)
      ;['out1','out2','out3'].forEach((key, gi) => {
        ;(fd[key]??[]).forEach((r:any) => {
          if (!r.qty || parseFloat(r.qty) <= 0) return
          const name = (r.name||'').toLowerCase()
          const acuId = name.includes('indent') ? `15IGDIS-${r1Suffix}`
                      : name.includes('white')  ? `15IGDW-${r1Suffix}`
                      : null
          const dest = name.includes('indent') ? 'granule_indent_dust'
                     : name.includes('white')  ? 'granule_dust'
                     : 'granule_dust'
          pushTag({
            section_id:'refining1', section_name:'Refining 1',
            product_type: r.name || `Output ${gi+1}`,
            serial_number: r.serial||null, lot_number: r.serial || 'NOT TRACKED',
            weight_kg: parseFloat(r.qty)||null,
            variant: r1Variant, acumatica_id: acuId, destination: dest,
          })
        })
      })
    }

    // ── REFINING 2 ─────────────────────────────────────────────────────────────
    if (sectionId === 'refining2') {
      const r2Variant = normaliseVariant(fd.debag?.[0]?.con_org) ?? 'Conventional'
      const r2Suffix  = variantSuffix(r2Variant)
      const r2groups = [
        { key:'rowsA', type:'Cut Heavy Stick Fine',   acuId:`20BGCHS-F-${r2Suffix}`,  dest:undefined },
        { key:'rowsB', type:'Cut Heavy Stick Coarse', acuId:`20BGCHS-C-${r2Suffix}`,  dest:undefined },
        { key:'rowsC', type:'White Dust',             acuId:`15IGDW-${r2Suffix}`,     dest:undefined },
        { key:'rowsD', type:'Powder Dust',            acuId:`15IGDPOWDR-${r2Suffix}`, dest:undefined },
      ]
      r2groups.forEach(({key, type, acuId, dest}) => {
        ;(fd[key]??[]).forEach((r:any) => pushTag({
          section_id:'refining2', section_name:'Refining 2',
          product_type: type, serial_number: r.serial||null,
          lot_number: r.serial||'NOT TRACKED', weight_kg: parseFloat(r.qty)||null,
          variant: r2Variant, acumatica_id: acuId, destination: dest,
        }))
      })
    }

    // ── BLENDER ────────────────────────────────────────────────────────────────
    if (sectionId === 'blender') {
      const blenderData = fd.productions
        ? fd.productions.map((p:any)=>p.data||p).filter(Boolean)
        : [fd]
      blenderData.forEach((bfd:any) => {
        ;(bfd.bagRows??fd.bagRows??[]).forEach((r:any) => {
          if (!r.serial_no || !r.kg) return
          pushTag({
            section_id:'blender', section_name:'Blender',
            product_type: r.blend_type || bfd.blendCode || fd.blendCode || 'Blended Material',
            serial_number: r.serial_no, lot_number: bfd.lotNo || fd.lotNo || null,
            weight_kg: parseFloat(r.kg)||null,
            variant: normaliseVariant(bfd.variantCode || fd.variantCode) ?? 'Conventional',
            acumatica_id:undefined, destination: 'pasteuriser',
          })
        })
      })
    }

    // ── GRANULE LINE ───────────────────────────────────────────────────────────
    if (sectionId === 'granule') {
      ;(fd.bagRows??[]).forEach((r:any) => {
        if (!r.total_weight || parseFloat(r.total_weight) <= 0) return
        const serials = (r.serial_numbers||'').split(/[\s,]+/).filter(Boolean)
        if (serials.length > 0) {
          serials.forEach((serial:string) => pushTag({
            section_id:'granule', section_name:'Granule Line',
            product_type: r.item || 'SG Granules', serial_number: serial,
            lot_number: r.lot_number || null,
            weight_kg: parseFloat(r.bag_weights) || parseFloat(r.total_weight)/Math.max(serials.length,1) || null,
            acumatica_id: (r.item||'').split(' — ')[0] || undefined, destination: 'depot',
          }))
        } else {
          pushTag({
            section_id:'granule', section_name:'Granule Line',
            product_type: r.item || 'SG Granules', serial_number: null,
            lot_number: r.lot_number || 'NOT TRACKED', weight_kg: parseFloat(r.total_weight)||null,
            acumatica_id: (r.item||'').split(' — ')[0] || undefined, destination: 'depot',
          })
        }
      })
    }

    // ── PASTEURISER ───────────────────────────────────────────────────────────
    if (sectionId === 'pasteuriser') {
      const variant = fd.debag?.variantCode || null
      ;(fd.bagging?.bagRows??[]).forEach((r: any) => {
        const kg = parseFloat(r.total_weight) || null
        if (!kg || kg <= 0) return
        pushTag({
          section_id: 'pasteuriser', section_name: 'Pasteuriser',
          product_type: r.item || 'Pasteurised Tea', serial_number: r.start_bag || null,
          lot_number: r.lot || fd.bagging?.lotNumber || null, weight_kg: kg,
          variant, destination: 'warehouse',
        })
      })
      ;(fd.bagging?.byProducts??[]).forEach((r: any) => {
        const kg = parseFloat(r.weight) || null
        if (!kg || kg <= 0) return
        pushTag({
          section_id: 'pasteuriser', section_name: 'Pasteuriser',
          product_type: r.product_type || 'By-product', serial_number: r.serial || null,
          lot_number: fd.bagging?.lotNumber || null, weight_kg: kg,
          variant, destination: 'warehouse',
        })
      })
    }

    return tags
  }

  async function saveDraft(){
    setSaving(true);setError(null)
    try{
      const sid=await ensureSession()
      const fd = formDataRef.current
      const productions: any[] = fd.productions ?? [fd]
      const pastTotalIn  = sectionId === 'pasteuriser'
        ? [...(fd.debag?.debagRows??[]), ...(fd.debag?.postSieveRows??[])].reduce((s:number,r:any)=>s+num(r.kg),0)
        : null
      const pastTotalOut = sectionId === 'pasteuriser'
        ? (fd.bagging?.bagRows??[]).reduce((s:number,r:any)=>s+num(r.total_weight),0)
        : null
      const totalIn  = pastTotalIn  ?? productions.reduce((s:number,p:any)=>s+(p?.data?.totalA??p?.data?.totalIn??p?.totalA??p?.totalIn??0),0)
      const totalOut = pastTotalOut ?? productions.reduce((s:number,p:any)=>s+(p?.data?.totalOut??p?.data?.totalOutput??p?.totalOut??p?.totalOutput??0),0)
      const variance = totalIn - totalOut

      const operatorNamesText = fd.shiftOps || fd.operators || fd.op1
        || fd.debag?.operators || fd.bagging?.operators || fd.daily?.operatorName || ''
      const operatorNamesArr = operatorNamesText
        .split(/[,/;]+/)
        .map((n: string) => n.trim())
        .filter(Boolean)
      const sessionMeta = {
        operator_name_text: operatorNamesText || null,
        operator_names:    operatorNamesArr.length > 0 ? operatorNamesArr : null,
        supervisor_name:   fd.supervisor || fd.mbSupervisor || fd.bagging?.supervisor || null,
        op_signed:         fd.opSigned || false,
        sup_signed:        fd.supSigned || false,
        op_name_signoff:   fd.opName || null,
        sup_name_signoff:  fd.supName || null,
        comments:          fd.comments || fd.bagging?.comments || null,
        lot_number:        fd.lotNo || fd.lotNumber || fd.bagging?.lotNumber || fd.daily?.batchNumber || null,
        production_orders: productions.map((p:any)=>p?.data?.prodOrderId||p?.data?.blendCode||p?.prodOrderId||p?.blendCode||null).filter(Boolean),
      }
      await getDb().schema('production').from('prod_sessions').update({
        status:'draft', updated_at:new Date().toISOString(),
        notes:JSON.stringify(formData),
        ...(sessionMeta as any),
      } as any).eq('id',sid)

      await getDb().schema('production').from('prod_mass_balance').upsert({
        session_id:sid, total_input_kg:totalIn, total_output_b_kg:totalOut,
        balance_kg:variance, within_tolerance:Math.abs(variance)<=15,
        calculated_at:new Date().toISOString()
      } as any,{onConflict:'session_id'})

      try {
        const debagRows = buildDebagRows(sid)
        if (debagRows.length > 0) {
          const { error: delDebagErr } = await getDb()
            .schema('production').from('prod_debagging').delete().eq('session_id', sid)
          if (delDebagErr) throw new Error(`Debagging delete: ${delDebagErr.message}`)
          const { error: insDebagErr } = await getDb()
            .schema('production').from('prod_debagging').insert(debagRows as any)
          if (insDebagErr) throw new Error(`Debagging insert: ${insDebagErr.message}`)
        }
      } catch (e: any) { console.error('saveDraft step 3 (debagging):', e.message) }

      try {
        const bagRows = buildBagRows(sid)
        if (bagRows.length > 0) {
          const { error: delBagErr } = await getDb()
            .schema('production').from('prod_bagging').delete().eq('session_id', sid)
          if (delBagErr) throw new Error(`Bagging delete: ${delBagErr.message}`)
          const { error: insBagErr } = await getDb()
            .schema('production').from('prod_bagging').insert(bagRows as any)
          if (insBagErr) throw new Error(`Bagging insert: ${insBagErr.message}`)
        }
      } catch (e: any) { console.error('saveDraft step 4 (bagging):', e.message) }

      const bagTagRows = buildBagTagRows(sid)
      try {
        const trackedTags = bagTagRows.filter((t: any) =>
          t.serial_number && t.serial_number !== 'NOT TRACKED'
        )
        for (const tag of trackedTags) {
          const { error: tagErr } = await getDb()
            .schema('production').from('bag_tags')
            .upsert(tag as any, { onConflict: 'serial_number' })
          if (tagErr) console.error(`bag_tags upsert ${tag.serial_number}:`, tagErr.message)
        }
      } catch (e: any) { console.error('saveDraft step 5 (bag_tags):', e.message) }

      const outputSerials = bagTagRows
        .map((t: any) => t.serial_number)
        .filter((s: any) => s && s !== 'NOT TRACKED')
      if (outputSerials.length > 0) {
        getDb().schema('production').from('bag_tags')
          .update({ status: 'in_stock', location_id: 'warehouse', location_updated_at: new Date().toISOString() } as any)
          .in('serial_number', outputSerials)
          .then(() => {}).catch((e: any) => console.warn('bag status update:', e))

        const evts = bagTagRows
          .filter((t: any) => t.serial_number && t.serial_number !== 'NOT TRACKED')
          .map((t: any) => ({
            serial_number: t.serial_number,
            section_id:    sectionId,
            session_id:    sid,
            action:        'bagging_out',
            weight_kg:     t.weight_kg ?? null,
            operator_id:   user?.id ?? null,
            scanned_at:    new Date().toISOString(),
          }))
        if (evts.length > 0) {
          getDb().schema('production').from('scan_events')
            .delete().eq('session_id', sid).eq('action', 'bagging_out')
            .then(() =>
              getDb().schema('production').from('scan_events').insert(evts as any)
            ).catch(() => {})
        }
      }

      const inputSerials: {serial: string; kg?: number}[] = []
      if (sectionId === 'sieving') {
        ;(fd.debag??[]).forEach((r:any)=>{ if(r.bag_number) inputSerials.push({serial:r.bag_number, kg:parseFloat(r.mass_nett)||undefined}) })
      } else if (sectionId === 'refining1' || sectionId === 'refining2') {
        ;(fd.debag??[]).forEach((r:any)=>{ if(r.serial) inputSerials.push({serial:r.serial, kg:parseFloat(r.qty)||undefined}) })
      } else if (sectionId === 'blender') {
        const bProd = fd.productions?.map((p:any)=>p.data||p).filter(Boolean) ?? [fd]
        bProd.forEach((bfd:any)=>{
          ;['rowsA','rowsB','rowsC','rowsD','rowsE','rowsF'].forEach(k=>{
            ;(bfd[k]??[]).forEach((r:any)=>{ if(r.serial) inputSerials.push({serial:r.serial, kg:parseFloat(r.kg)||undefined}) })
          })
        })
      } else if (sectionId === 'pasteuriser') {
        const pastInputRows = [...(fd.debag?.debagRows??[]), ...(fd.debag?.postSieveRows??[])]
        pastInputRows.forEach((r:any)=>{ if(r.serial) inputSerials.push({serial:r.serial, kg:parseFloat(r.kg)||undefined}) })
      }
      Promise.all(
        inputSerials.map(({ serial, kg }) =>
          markBagConsumed(serial, sectionId, sid, kg, user?.id)
        )
      ).catch(() => {})

      try {
        if (typeof window !== 'undefined') {
          const tsKey = `cntp_ts_${sectionId}_${dateParam}_${shift}`
          const tsRaw = localStorage.getItem(tsKey)
          if (tsRaw) {
            const tsEvents = JSON.parse(tsRaw)
            const tsShift = shift.toLowerCase() === 'night' ? 'afternoon' : shift.toLowerCase()
            const tsOperatorName = fd.shiftOps || fd.operators || fd.op1 || null
            const { data: existing } = await getDb()
              .schema('production').from('timesheets')
              .select('id')
              .eq('date', dateParam)
              .eq('shift', tsShift)
              .eq('section', sectionId)
              .maybeSingle()
            if (existing?.id) {
              await getDb().schema('production').from('timesheets')
                .update({ events: tsEvents, operator_name: tsOperatorName } as any)
                .eq('id', existing.id)
            } else {
              await getDb().schema('production').from('timesheets').insert({
                date: dateParam, shift: tsShift, section: sectionId,
                operator_name: tsOperatorName, events: tsEvents,
              } as any)
            }
          }
        }
      } catch (e: any) { console.error('saveDraft step 8 (timesheets):', e.message) }

      setStatus('draft');setSaved(true);setTimeout(()=>setSaved(false),2000)
    }catch(e:any){setError(e.message)}
    setSaving(false)
  }

  async function handleSubmit(){await saveDraft();setSubmitting(true);try{const sid=await ensureSession();await getDb().schema('production').from('prod_sessions').update({status:'submitted',submitted_at:new Date().toISOString(),submitted_by:user?.id??null,updated_at:new Date().toISOString()} as any).eq('id',sid);setStatus('submitted')}catch(e:any){setError(e.message)};setSubmitting(false)}
  async function handleApprove(){setSubmitting(true);try{await getDb().schema('production').from('prod_sessions').update({status:'approved',approved_by:user?.id??null,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()} as any).eq('id',sessionId);setStatus('approved')}catch(e:any){setError(e.message)};setSubmitting(false)}
  async function handleRequestCorrection(reason:string){try{await getDb().schema('production').from('prod_sessions').update({status:'draft',correction_reason:reason,updated_at:new Date().toISOString()} as any).eq('id',sessionId);setStatus('draft')}catch(e:any){setError(e.message)}}

  const locked=sessionStatus==='approved'
  const totalIn=formData.totalA??formData.totalIn??0
  const totalOut=formData.totalOut??formData.totalOutput??0
  const variance=formData.variance??(totalIn-totalOut)
  const withinTol=Math.abs(variance)<=15

  if(!sectionId||!meta)return(<div className="flex items-center justify-center h-64 flex-col gap-3"><p className="text-[13px] text-err">No section selected.</p><button onClick={()=>router.back()} className="text-[12px] text-brand hover:underline">← Go back</button></div>)
  if(loading)return(<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted"/></div>)

  const statusLabel=sessionStatus==='approved'?'Signed off':sessionStatus==='submitted'?'Awaiting sign-off':sessionStatus==='draft'?'Draft':'New'
  const statusColor=sessionStatus==='approved'?'bg-ok/10 text-ok':sessionStatus==='submitted'?'bg-info/10 text-info':sessionStatus==='draft'?'bg-warn/10 text-warn':'bg-stone-100 text-stone-500'

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 flex-shrink-0">
        <button onClick={()=>router.back()} className="p-2 rounded-lg hover:bg-stone-100 transition-colors text-stone-400"><ChevronLeft size={18}/></button>
        <div className={`w-9 h-9 rounded-xl ${meta.color} flex items-center justify-center shrink-0`}><span className="font-mono font-bold text-[11px] text-white">{meta.code}</span></div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[20px] text-text leading-tight">{meta.name}</h1>
          <p className="text-[11px] text-text-muted capitalize">{shift} shift · {format(parseISO(dateParam+'T12:00:00'),'d MMM yyyy')}</p>
        </div>
        <span className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg shrink-0 ${statusColor}`}>{statusLabel}</span>
      </div>

      {role==='section_operator'&&(()=>{
        const isDraft=sessionStatus==='draft',isSubmitted=sessionStatus==='submitted',isApproved=sessionStatus==='approved'
        const cleanPct=cleaningTotal>0?Math.round((cleaningDone/cleaningTotal)*100):0
        const statusDot=isApproved?'bg-ok':isSubmitted?'bg-info':isDraft?'bg-warn':'bg-stone-300'
        const action=isApproved?'✓ All done — session locked':isSubmitted?'Waiting for supervisor sign-off':isDraft?'Keep going — tap the tab below to continue':'Tap Production to start capturing'
        return(
          <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-stone-100 flex-shrink-0">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${statusDot}`}/>
            <p className="text-[12px] text-stone-600 flex-1 leading-snug">{action}</p>
            {cleaningTotal>0&&!isApproved&&(
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="w-16 h-1.5 bg-stone-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-300 ${cleanPct===100?'bg-ok':'bg-brand'}`} style={{width:`${cleanPct}%`}}/></div>
                <span className="font-mono text-[10px] text-stone-400">{cleanPct===100?'✓':`${cleaningDone}/${cleaningTotal}`}</span>
              </div>
            )}
          </div>
        )
      })()}

      <div className="flex border-b border-stone-200 px-4 flex-shrink-0 bg-white">
        {TABS.map(tab=>(
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors ${activeTab===tab.id?'border-brand text-brand':'border-transparent text-stone-400 hover:text-stone-700'}`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      <div style={{flex:1,overflowY:'auto',background:'var(--color-surface)'}}>
        <div className="px-4 py-5 max-w-[800px] space-y-5">

          {activeTab==='timesheet'&&(
            <TimesheetTab locked={locked} sectionId={sectionId} dateParam={dateParam} shift={shift}/>
          )}

          {activeTab==='production'&&(
            <>
              {sectionId==='sieving'    &&(
                <MultiProductionWrapper
                  sectionId="sieving"
                  locked={locked}
                  onData={setFormData}
                  savedData={savedData}
                  FormComponent={SievingFormWrapper}
                  extraProps={{ shift, sessionId, dateParam }}
                  getTabLabel={(data,i)=>{
                    if(!data?.prodOrderId)return `Production ${i+1}`
                    const code=data.prodOrderId.split(' — ')[0]
                    return `${i+1}: ${code}`
                  }}
                />
              )}
              {sectionId==='refining1'&&<RefiningForm sectionId={sectionId} locked={locked} onData={setFormData} savedData={savedData}/>}
              {sectionId==='refining2'&&<Refining2Form locked={locked} onData={setFormData} savedData={savedData}/>}
              {sectionId==='granule'    &&(
                <MultiProductionWrapper
                  sectionId="granule"
                  locked={locked}
                  onData={setFormData}
                  savedData={savedData}
                  FormComponent={GranuleForm}
                  getTabLabel={(data,i)=>{
                    const item=data?.bagRows?.[0]?.item||data?.summary?.[0]?.product_type||''
                    if(!item)return `Production ${i+1}`
                    const code=item.split(' — ')[0]
                    return `${i+1}: ${code}`
                  }}
                />
              )}
              {sectionId==='blender'    &&<MultiBlenderForm locked={locked} onData={setFormData} savedData={savedData}/>}
              {sectionId==='pasteuriser'&&(
                <MultiProductionWrapper
                  sectionId="pasteuriser"
                  locked={locked}
                  onData={setFormData}
                  savedData={savedData}
                  FormComponent={PasteuriseurFormWrapper}
                  extraProps={{ sessionId, dateParam, shift }}
                  getTabLabel={(data,i)=>data?.batchNumber?`${i+1}: ${data.batchNumber}`:`Production ${i+1}`}
                />
              )}

              {!locked&&(
                <button onClick={saveDraft} disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-stone-200 bg-white font-medium text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
                  {saving?<Loader2 size={15} className="animate-spin"/>:saved?<CheckCircle2 size={15} className="text-ok"/>:null}
                  {saving?'Saving…':saved?'Saved':'Save draft'}
                </button>
              )}
            </>
          )}

          {activeTab==='cleaning'&&<CleaningTab sectionId={sectionId} locked={locked} onProgress={(d,t)=>{setCleaningDone(d);setCleaningTotal(t)}} onTaskUpdate={(tasks)=>setFormData((prev:any)=>({...prev,cleaningTasks:tasks}))}/>}

          {activeTab==='signoff'&&(
            <SignOffTab locked={locked} sessionStatus={sessionStatus} onSubmit={handleSubmit} onApprove={handleApprove}
              onRequestCorrection={handleRequestCorrection} submitting={submitting} role={role}
              sectionId={sectionId} formData={formData} dateParam={dateParam} shift={shift}
              onSignatureData={(sigData)=>setFormData((prev:any)=>({...prev,...sigData}))}/>
          )}

          {error&&<p className="text-[12px] text-err px-1">{error}</p>}
        </div>
      </div>
    </div>
  )
}

export default function SectionCapturePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted"/></div>}>
      <SectionCaptureInner/>
    </Suspense>
  )
}

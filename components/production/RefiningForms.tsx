'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import * as React from 'react'
import { format } from 'date-fns'
import { Plus, Trash2, Scale, AlertTriangle, Search, X } from 'lucide-react'
import { uid, num, INP, F, Card, AddRow, SearchableSelect, CONV_OPTS, detectShift } from '@/components/production/shared/ui'
import { useSerialLookup, markBagConsumed, advanceToNextSerial, variantFamily } from '@/lib/production/scan-utils'
import { BagLookupModal } from '@/components/production/SievingTowerForm'

// ══════════════════════════════════════════════════════════════════════════════
// REFINING 1 — generic outputs (unchanged, works for R1)
// REFINING 2 — named, colour-coded outputs: Cut Heavy Stick Fine/Coarse, White/Powder Dust
// Shared inputs: RS Sticks, IS Sticks, Block, 1st Cut (+ generic via tag)
// ══════════════════════════════════════════════════════════════════════════════

export type RefRow = { id:string; date:string; serial:string; con_org:string; grade:string; qty:string }

// ── R2 named output bags ─────────────────────────────────────────────────────
export type R2OutRow = { id:string; serial:string; qty:string }

export const R2_OUTPUTS = [
  { key:'chsf', label:'Cut Heavy Stick Fine',   letter:'A', acuId:'20BGCHS-F-C', tracked:true,  bg:'bg-emerald-50', border:'border-emerald-200', head:'bg-emerald-100', txt:'text-emerald-800', dot:'bg-emerald-500' },
  { key:'chsc', label:'Cut Heavy Stick Coarse', letter:'B', acuId:'20BGCHS-C-C', tracked:false, bg:'bg-teal-50',    border:'border-teal-200',    head:'bg-teal-100',    txt:'text-teal-800',    dot:'bg-teal-500'    },
  { key:'wdst', label:'White Dust',             letter:'C', acuId:'15IGDW-C',    tracked:false, bg:'bg-blue-50',    border:'border-blue-200',    head:'bg-blue-100',    txt:'text-blue-800',    dot:'bg-blue-500'    },
  { key:'pdst', label:'Powder Dust',            letter:'D', acuId:'15IGDPOWDR-C',tracked:false, bg:'bg-violet-50',  border:'border-violet-200',  head:'bg-violet-100',  txt:'text-violet-800',  dot:'bg-violet-500'  },
] as const

export const R2_INPUT_GRADES = [
  '15IGST-C — Sticks - Conventional',
  '15IGST-RC — Sticks - RA Conventional',
  '15IGST-O — Sticks - Organic',
  '15IGST-RO — Sticks - RA Organic',
  '20BGCHS-C-C — Cut Heavy Stick Coarse - Conventional',
  '',
]

export function R2OutputCard({ cfg, rows, total, locked, onUpdate, onAdd, onRemove }: {
  cfg: typeof R2_OUTPUTS[number]
  rows: R2OutRow[]
  total: number
  locked: boolean
  onUpdate: (i:number, k:keyof R2OutRow, v:string) => void
  onAdd: () => void
  onRemove: (i:number) => void
}) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${cfg.border}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${cfg.head} border-b ${cfg.border}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-6 h-6 rounded-lg ${cfg.dot} flex items-center justify-center flex-shrink-0`}>
            <span className="font-mono font-bold text-[11px] text-white">{cfg.letter}</span>
          </div>
          <span className={`font-semibold text-[13px] ${cfg.txt}`}>{cfg.label}</span>
          {cfg.tracked
            ? <span className="font-mono text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase ml-1">Serial tracked · DD-MM-NN</span>
            : <span className="font-mono text-[9px] font-bold text-stone-400 bg-stone-200 px-1.5 py-0.5 rounded uppercase ml-1">Not tracked</span>}
          <span className="font-mono text-[9px] text-stone-400 ml-1">{cfg.acuId}</span>
        </div>
        <span className={`font-mono font-bold text-[14px] ${cfg.txt}`}>{total.toFixed(1)} kg</span>
      </div>
      <div className={`p-3 ${cfg.bg} space-y-2`}>
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[1fr_80px_auto] gap-1.5 items-center bg-white rounded-xl px-2 py-1.5 border border-stone-100">
            {cfg.tracked
              ? <input type="text" value={r.serial} onChange={e=>onUpdate(i,'serial',e.target.value.toUpperCase())}
                  placeholder="e.g. 08-05-01 (DD-MM-NN)" disabled={locked} className={INP}/>
              : <span className="px-3 py-2 rounded-xl bg-stone-100 text-[10px] text-stone-400 font-mono italic border border-stone-200">NOT TRACKED</span>}
            <input type="text" inputMode="decimal" value={r.qty} onChange={e=>onUpdate(i,'qty',e.target.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1'))} placeholder="kg" disabled={locked} className={INP}/>
            {rows.length > 1 && !locked && (
              <button onClick={()=>onRemove(i)} className="text-err/30 hover:text-err flex-shrink-0"><Trash2 size={12}/></button>
            )}
          </div>
        ))}
        {!locked && (
          <button onClick={onAdd}
            className={`w-full py-2 rounded-xl border-2 border-dashed ${cfg.border} ${cfg.txt} font-semibold text-[12px] hover:opacity-70 flex items-center justify-center gap-1.5`}>
            <Plus size={13}/> Add {cfg.label} bag
          </button>
        )}
      </div>
    </div>
  )
}

// ── RefiningDebagBagRow ───────────────────────────────────────────────────────
interface RefiningDebagRow {
  id: string; serial:string; date:string; con_org:string; grade:string; qty:string
}
export const RefiningDebagBagRow = React.memo(function RefiningDebagBagRow({
  row, idx, locked, sectionId, sessionVariant, onUpdate, onRemove, canRemove,
}: {
  row: RefiningDebagRow; idx: number; locked: boolean; sectionId: string
  sessionVariant?: string  // CON/ORG/RA-CON/RA-ORG from the session header — blocks family mismatches
  onUpdate: (id:string, patch:Partial<RefiningDebagRow>) => void
  onRemove: (id:string) => void; canRemove: boolean
}) {
  const [lookupStatus, setLookupStatus] = React.useState<'idle'|'found'|'mismatch'>('idle')
  const [mismatchMsg,  setMismatchMsg]  = React.useState('')
  const [showLookup,   setShowLookup]   = React.useState(false)
  const refSerialRef = React.useRef<HTMLInputElement>(null)

  useSerialLookup(row.serial, React.useCallback((result) => {
    // ── Hard block: variant family mismatch ──────────────────────────────────
    // CON/RA-CON cannot enter an ORG/RA-ORG session and vice versa.
    if (sessionVariant && result.variant) {
      const sessionFam = variantFamily(sessionVariant)
      const bagFam     = variantFamily(result.variant)
      if (sessionFam && bagFam && sessionFam !== bagFam) {
        setLookupStatus('mismatch')
        setMismatchMsg(
          `Variant mismatch — session is ${sessionVariant} (${sessionFam}) but scanned bag is ${result.variant} (${bagFam}). ` +
          `CON/RA-CON and ORG/RA-ORG cannot be mixed. Clear and scan the correct bag.`
        )
        return  // HARD BLOCK — do not auto-fill or mark consumed
      }
    }
    // ── Block finished blended products ─────────────────────────────────────
    if (/blend/i.test(result.product_type)) {
      setLookupStatus('mismatch')
      setMismatchMsg(`Finished blended product "${result.product_type}" cannot be used as a raw material input. Clear and scan the correct bag.`)
      return
    }
    // ── All checks passed — auto-fill ────────────────────────────────────────
    const patch: any = {}
    if (result.weight_kg)  patch.qty     = result.weight_kg
    if (result.product_type && !row.grade) patch.grade = result.product_type
    if (result.variant)    patch.con_org = result.variant.includes('Organic') ? (result.variant.includes('RA') ? 'RA-ORG' : 'ORG') : (result.variant.includes('RA') ? 'RA-CON' : 'CON')
    onUpdate(row.id, patch)
    setLookupStatus('found')
    markBagConsumed(row.serial, sectionId, null, parseFloat(result.weight_kg)||undefined)
    advanceToNextSerial(refSerialRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.serial, sectionId, sessionVariant, onUpdate]))

  return (
    <div className="space-y-1">
      <div className={`grid grid-cols-2 gap-2 sm:grid-cols-5 items-end p-2 rounded-xl border ${lookupStatus === 'mismatch' ? 'border-err/40 bg-err/5' : 'border-stone-100'}`}>
        <F label="Date"   value={row.date}    onChange={v=>onUpdate(row.id,{date:v})}    type="date" disabled={locked}/>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Bag tag serial — scan or type</label>
          <div className="flex gap-1">
            <div className="relative flex-1">
              <input ref={refSerialRef} type="text" data-serial="true"
                value={row.serial}
                onChange={e=>{onUpdate(row.id,{serial:e.target.value.toUpperCase()});setLookupStatus('idle');setMismatchMsg('')}}
                placeholder="▐▌ Scan barcode" disabled={locked}
                className={"w-full px-3 py-2.5 rounded-lg border-2 bg-white text-[12px] font-mono text-text outline-none transition-all disabled:opacity-40 " + (
                  lookupStatus==='found'    ? 'border-ok/60 bg-ok/5' :
                  lookupStatus==='mismatch' ? 'border-err/60 bg-err/5' :
                  'border-blue-300 bg-blue-50/30 focus:border-brand'
                )}/>
              {lookupStatus==='found'    && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ok  text-[14px]">✓</span>}
              {lookupStatus==='mismatch' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-err text-[14px]">✗</span>}
            </div>
            {!locked && (
              <button onClick={()=>setShowLookup(true)}
                title="Browse available bags"
                className="px-2 py-1.5 rounded-lg border border-stone-200 text-stone-400 hover:border-brand hover:text-brand transition-colors text-[11px] flex-shrink-0">
                🔍
              </button>
            )}
          </div>
        </div>
        <F label="CON / ORG" value={row.con_org} onChange={v=>onUpdate(row.id,{con_org:v})} opts={CONV_OPTS} disabled={locked}/>
        <F label="Input type" value={row.grade} onChange={v=>onUpdate(row.id,{grade:v})}
          opts={['15IGIS-C — Indent Sticks - Conventional','15IGIS-RC — Indent Sticks - RA Conventional',
                 '15IGIS-O — Indent Sticks - Organic','15IGIS-RO — Indent Sticks - RA Organic',
                 '15IGST-C — Sticks - Conventional','15IGST-RC — Sticks - RA Conventional',
                 '15IGST-O — Sticks - Organic','15IGST-RO — Sticks - RA Organic',
                 '15IGBL-C-C — Blocks: Clean - Conventional','15IGBL-C-RC — Blocks: Clean - RA Conventional',
                 '15IGBL-C-O — Blocks: Clean - Organic','15IGBL-C-RO — Blocks: Clean - RA Organic',
                 '15IG1C-C — 1st Cut - Conventional','15IG1C-RC — 1st Cut - RA Conventional',
                 '15IG1C-O — 1st Cut - Organic','15IG1C-RO — 1st Cut - RA Organic','']}
          disabled={locked}/>
        <F label="Qty (kg)" value={row.qty} onChange={v=>onUpdate(row.id,{qty:v})} type="number" disabled={locked}/>
        <div className="flex items-center gap-1.5 pt-5">
          {canRemove && !locked && (
            <button onClick={()=>onRemove(row.id)} className="text-err/40 hover:text-err"><Trash2 size={13}/></button>
          )}
        </div>
      </div>
      {lookupStatus === 'mismatch' && (
        <div className="flex items-start gap-2 px-3 py-2 bg-err/5 border border-err/20 rounded-lg">
          <span className="text-err text-[14px] flex-shrink-0 mt-0.5">⛔</span>
          <p className="text-[10px] text-err font-semibold leading-snug">{mismatchMsg}</p>
        </div>
      )}
      {showLookup && (
        <BagLookupModal
          sectionId={sectionId}
          sessionVariant={sessionVariant}
          onSelect={(serial, kg) => {
            onUpdate(row.id, { serial })
            setLookupStatus('idle')
            setMismatchMsg('')
          }}
          onClose={() => setShowLookup(false)}
        />
      )}
    </div>
  )
})

type OutRow = { id:string; name:string; serial:string; qty:string }
interface OutGroupProps {
  label:string; rows:OutRow[]; total:number; locked:boolean
  onUpdate:(i:number, k:keyof OutRow, v:string)=>void
  onAdd:()=>void
  onRemove:(i:number)=>void
}
export function OutGroup({ label, rows, total, locked, onUpdate, onAdd, onRemove }: OutGroupProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">{label}</span>
        <span className="font-mono font-bold text-[13px] text-emerald-700">{total.toFixed(1)} kg</span>
      </div>
      {rows.map((r,i) => (
        <div key={r.id} className="bg-stone-50 border border-stone-200 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <F label="Output type" value={r.name} onChange={v=>onUpdate(i,'name',v)}
            opts={['15IGDIS-C — Dust: Indent - Conventional','15IGDIS-RC — Dust: Indent - RA Conventional','15IGDIS-O — Dust: Indent - Organic','15IGDIS-RO — Dust: Indent - RA Organic','15IGDW-C — Dust: White - Conventional','15IGDW-RC — Dust: White - RA Conventional','15IGDW-O — Dust: White - Organic','15IGDW-RO — Dust: White - RA Organic','']}
            disabled={locked}/>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Serial no.</label>
              <input type="text" value={r.serial} onChange={e=>onUpdate(i,'serial',e.target.value.toUpperCase())} placeholder="e.g. 04-05-01" disabled={locked} className={INP}/>
            </div>
            <F label="Quantity (kg)" value={r.qty} onChange={v=>onUpdate(i,'qty',v)} type="number" ph="275" disabled={locked} wide/>
          </div>
          {rows.length > 1 && !locked && (
            <button onClick={()=>onRemove(i)} className="text-right text-[10px] text-err/60 hover:text-err w-full">Remove</button>
          )}
        </div>
      ))}
      <AddRow label={`Add ${label} bag`} onClick={onAdd}/>
      <div className="flex justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
        <span className="text-[11px] text-emerald-600">Total ({label.charAt(label.length-2)})</span>
        <span className="font-mono font-bold text-[13px] text-emerald-700">{total.toFixed(1)} kg</span>
      </div>
    </div>
  )
}

// ── Refining 2 form ──────────────────────────────────────────────────────────
export function Refining2Form({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
  const todayStr = format(new Date(),'yyyy-MM-dd')
  const [shift,    setShift]    = useState(()=>savedData?.shift??detectShift())
  const [op1,      setOp1]      = useState(()=>savedData?.op1??'')
  const [op2,      setOp2]      = useState(()=>savedData?.op2??'')
  const [comments, setComments] = useState(()=>savedData?.comments??'')
  const [debag, setDebag] = useState<RefRow[]>(()=>savedData?.debag??[{id:uid(),date:todayStr,serial:'',con_org:'CON',grade:'RS (Rolsiev Sticks)',qty:''}])
  const updateR2DebagRow = React.useCallback((id:string, patch:any) => {
    setDebag(rs=>rs.map(r=>r.id===id?{...r,...patch}:r))
  }, [])
  const removeR2DebagRow = React.useCallback((id:string) => {
    setDebag(rs=>rs.filter(r=>r.id!==id))
  }, [])

  // Named outputs
  const [rowsA, setRowsA] = useState<R2OutRow[]>(()=>savedData?.rowsA??[{id:uid(),serial:'',qty:''}])
  const [rowsB, setRowsB] = useState<R2OutRow[]>(()=>savedData?.rowsB??[{id:uid(),serial:'',qty:''}])
  const [rowsC, setRowsC] = useState<R2OutRow[]>(()=>savedData?.rowsC??[])
  const [rowsD, setRowsD] = useState<R2OutRow[]>(()=>savedData?.rowsD??[])

  const totalIn  = debag.reduce((s,r)=>s+num(r.qty),0)
  const totalA   = rowsA.reduce((s,r)=>s+num(r.qty),0)
  const totalB   = rowsB.reduce((s,r)=>s+num(r.qty),0)
  const totalC   = rowsC.reduce((s,r)=>s+num(r.qty),0)
  const totalD   = rowsD.reduce((s,r)=>s+num(r.qty),0)
  const totalOut = totalA+totalB+totalC+totalD
  const variance = totalIn - totalOut
  const withinTol = Math.abs(variance) <= 15

  function blankOut(): R2OutRow { return {id:uid(),serial:'',qty:''} }
  function upOut(setter:React.Dispatch<React.SetStateAction<R2OutRow[]>>, i:number, k:keyof R2OutRow, v:string) {
    setter(rs=>rs.map((r,j)=>j===i?{...r,[k]:k==='serial'?v.toUpperCase():v}:r))
  }

  useEffect(()=>{
    onData({shift,op1,op2,debag,rowsA,rowsB,rowsC,rowsD,totalIn,totalA,totalB,totalC,totalD,totalOut:totalA+totalB+totalC+totalD,variance,comments})
  },[debag,rowsA,rowsB,rowsC,rowsD,comments,op1,op2,shift])

  return (
    <div className="space-y-5">
      <Card title="Refining 2 — session header">
        <div className="grid grid-cols-2 gap-3">
          <F label="Shift"      value={shift} onChange={setShift} opts={['Morning','Afternoon']} disabled={locked}/>
          <F label="Operator 1" value={op1}   onChange={setOp1}   ph="e.g. Exavior"             disabled={locked}/>
          <F label="Operator 2" value={op2}   onChange={setOp2}   ph="e.g. Anda"                disabled={locked}/>
        </div>
      </Card>

      <Card title="Debagging — inputs" total={totalIn} variant="input">
        <p className="text-[11px] text-sky-600 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
          Select input type from dropdown. Cut Heavy Stick Coarse is both an input and output. Serial = bag tag from upstream (DD-MM-NN format).
        </p>
        <div className="space-y-2">
          {debag.map((r,i)=>(
            <RefiningDebagBagRow
              key={r.id}
              row={r}
              idx={i}
              locked={locked}
              sectionId="refining2"
              sessionVariant={debag[0]?.con_org || 'CON'}
              onUpdate={updateR2DebagRow}
              onRemove={removeR2DebagRow}
              canRemove={debag.length>1}
            />
          ))}
        </div>
        {!locked&&<AddRow label="Add input bag" onClick={()=>{const prev=debag[debag.length-1];setDebag(rs=>[...rs,{id:uid(),date:prev?.date??todayStr,serial:'',con_org:prev?.con_org??'CON',grade:prev?.grade??'RS (Rolsiev Sticks)',qty:''}])}}/>}
        <div className="flex justify-between px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-xl">
          <span className="text-[11px] font-medium text-sky-600">Total input (A)</span>
          <span className="font-mono font-bold text-[14px] text-sky-700">{totalIn.toFixed(1)} kg</span>
        </div>
      </Card>

      {/* Named, colour-coded outputs */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 bg-emerald-50 border-b border-emerald-200 rounded-t-2xl">
          <div className="w-1 h-5 rounded-full bg-emerald-500"/>
          <span className="font-semibold text-[13px] text-emerald-800">Bagging — named outputs</span>
          <span className="font-mono text-[11px] font-bold text-emerald-600 ml-auto">{totalOut.toFixed(1)} kg</span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Each output type is colour-coded. White Dust and Powder Dust are optional — only add rows if produced this shift.
          </p>
          <R2OutputCard cfg={R2_OUTPUTS[0]} rows={rowsA} total={totalA} locked={locked}
            onUpdate={(i,k,v)=>upOut(setRowsA,i,k,v)}
            onAdd={()=>setRowsA(rs=>[...rs,blankOut()])}
            onRemove={i=>setRowsA(rs=>rs.filter((_,j)=>j!==i))}/>
          <R2OutputCard cfg={R2_OUTPUTS[1]} rows={rowsB} total={totalB} locked={locked}
            onUpdate={(i,k,v)=>upOut(setRowsB,i,k,v)}
            onAdd={()=>setRowsB(rs=>[...rs,blankOut()])}
            onRemove={i=>setRowsB(rs=>rs.filter((_,j)=>j!==i))}/>
          {/* White Dust — optional */}
          {(rowsC.length>0||!locked)&&(
            rowsC.length>0
              ? <R2OutputCard cfg={R2_OUTPUTS[2]} rows={rowsC} total={totalC} locked={locked}
                  onUpdate={(i,k,v)=>upOut(setRowsC,i,k,v)}
                  onAdd={()=>setRowsC(rs=>[...rs,blankOut()])}
                  onRemove={i=>setRowsC(rs=>rs.filter((_,j)=>j!==i))}/>
              : !locked&&<button onClick={()=>setRowsC([blankOut()])}
                  className="w-full py-2.5 border border-dashed border-blue-300 rounded-xl text-[12px] font-medium text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1.5">
                  <Plus size={13}/> Add White Dust (C)
                </button>
          )}
          {/* Powder Dust — optional */}
          {(rowsD.length>0||!locked)&&(
            rowsD.length>0
              ? <R2OutputCard cfg={R2_OUTPUTS[3]} rows={rowsD} total={totalD} locked={locked}
                  onUpdate={(i,k,v)=>upOut(setRowsD,i,k,v)}
                  onAdd={()=>setRowsD(rs=>[...rs,blankOut()])}
                  onRemove={i=>setRowsD(rs=>rs.filter((_,j)=>j!==i))}/>
              : !locked&&<button onClick={()=>setRowsD([blankOut()])}
                  className="w-full py-2.5 border border-dashed border-violet-300 rounded-xl text-[12px] font-medium text-violet-600 hover:bg-violet-50 flex items-center justify-center gap-1.5">
                  <Plus size={13}/> Add Powder Dust (D)
                </button>
          )}
          {/* Output totals */}
          {totalOut > 0 && (
            <div className="pt-2 border-t border-stone-200 grid grid-cols-2 gap-1.5">
              {([
                [R2_OUTPUTS[0].label,totalA,'text-emerald-700','bg-emerald-50 border-emerald-100'],
                [R2_OUTPUTS[1].label,totalB,'text-teal-700','bg-teal-50 border-teal-100'],
                ...(totalC>0?[[R2_OUTPUTS[2].label,totalC,'text-blue-700','bg-blue-50 border-blue-100']]:[] as any),
                ...(totalD>0?[[R2_OUTPUTS[3].label,totalD,'text-violet-700','bg-violet-50 border-violet-100']]:[] as any),
              ] as [string,number,string,string][]).map(([l,v,tc,bg])=>(
                <div key={l} className={`flex justify-between px-3 py-2 rounded-lg border text-[11px] ${bg}`}>
                  <span className={tc}>{l}</span>
                  <span className={`font-mono font-bold ${tc}`}>{v.toFixed(1)} kg</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mass balance */}
      <div className={`rounded-2xl p-5 border-2 ${withinTol?'border-ok/30 bg-ok/5':'border-warn/40 bg-warn/5'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Scale size={16} className={withinTol?'text-ok':'text-warn'}/>
          <span className="font-semibold text-[14px] text-text">Mass balance</span>
          {!withinTol&&<AlertTriangle size={14} className="text-warn ml-auto"/>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[{label:'Total input (A)',value:totalIn},{label:'Total output',value:totalOut},{label:'Variance',value:Math.abs(variance)}].map((col,ci)=>(
            <div key={col.label}>
              <div className={`font-mono font-bold text-[18px] ${ci===2?(withinTol?'text-ok':'text-warn'):'text-text'}`}>{col.value.toFixed(1)} kg</div>
              <div className="text-[10px] text-text-muted mt-1">{col.label}</div>
            </div>
          ))}
          <div>
            <div className={`font-mono font-bold text-[18px] ${withinTol?'text-ok':'text-warn'}`}>{withinTol?'✓ OK':'⚠ Review'}</div>
            <div className="text-[10px] text-text-muted mt-1">Status</div>
          </div>
        </div>
        {!withinTol&&<p className="text-[11px] text-warn mt-3 text-center">Variance exceeds 15 kg tolerance — review before submitting</p>}
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Comments</label>
        <textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3} disabled={locked}
          className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none"/>
      </div>
    </div>
  )
}

// ── Refining 1 form (unchanged — generic outputs work for R1) ─────────────────
export function RefiningForm({ sectionId, locked, onData, savedData }: { sectionId:string; locked:boolean; onData:(d:any)=>void; savedData?:any }) {
  const todayStr = format(new Date(),'yyyy-MM-dd')
  const [line,     setLine]     = useState(()=>savedData?.line??'Refining 1')
  const [shift,    setShift]    = useState(()=>savedData?.shift??detectShift())
  const [op1,      setOp1]      = useState(()=>savedData?.op1??'')
  const [op2,      setOp2]      = useState(()=>savedData?.op2??'')
  const [comments, setComments] = useState(()=>savedData?.comments??'')
  const [debag, setDebag] = useState<RefRow[]>(()=>savedData?.debag??[{id:uid(),date:todayStr,serial:'',con_org:'CON',grade:'',qty:''}])
  const updateDebagRow = React.useCallback((id:string, patch:any) => {
    setDebag(rs=>rs.map(r=>r.id===id?{...r,...patch}:r))
  }, [])
  const removeDebagRow = React.useCallback((id:string) => {
    setDebag(rs=>rs.filter(r=>r.id!==id))
  }, [])
  const [out1,  setOut1]  = useState<OutRow[]>(()=>savedData?.out1??[{id:uid(),name:'',serial:'',qty:''}])
  const [out2,  setOut2]  = useState<OutRow[]>(()=>savedData?.out2??[{id:uid(),name:'',serial:'',qty:''}])
  const [out3,  setOut3]  = useState<OutRow[]>(()=>savedData?.out3??[{id:uid(),name:'',serial:'',qty:''}])

  const totalA = debag.reduce((s,r)=>s+num(r.qty),0)
  const totalB = out1.reduce((s,r)=>s+num(r.qty),0)
  const totalC = out2.reduce((s,r)=>s+num(r.qty),0)
  const totalD = out3.reduce((s,r)=>s+num(r.qty),0)
  const variance = totalA - totalB - totalC - totalD
  const withinTol = Math.abs(variance) <= 15

  function addDebagRow() {
    const prev=debag[debag.length-1]
    setDebag(rs=>[...rs,{id:uid(),date:prev?.date??todayStr,serial:prev?.serial??'',con_org:prev?.con_org??'CON',grade:prev?.grade??'',qty:''}])
  }

  useEffect(()=>{
    onData({line,shift,op1,op2,debag,out1,out2,out3,totalA,totalB,totalC,totalD,variance,comments,totalOut:totalB+totalC+totalD})
  },[debag,out1,out2,out3,comments,op1,op2,line,shift])

  return (
    <div className="space-y-5">
      <Card title="Session header">
        <div className="grid grid-cols-2 gap-3">
          <F label="Shift"      value={shift} onChange={setShift} opts={['Morning','Afternoon']} disabled={locked}/>
          <F label="Operator 1" value={op1}   onChange={setOp1}   ph="e.g. Exavior"            disabled={locked}/>
          <F label="Operator 2" value={op2}   onChange={setOp2}   ph="e.g. Anda"               disabled={locked}/>
        </div>
      </Card>
      <Card title="Debagging — inputs" total={totalA} variant="input">
        <p className="text-[11px] text-sky-600 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
          Serial number is the bag tag from the upstream section (Sieving Tower).
        </p>
        <div className="space-y-2">
          {debag.map((r,i)=>(
            <RefiningDebagBagRow
              key={r.id}
              row={r}
              idx={i}
              locked={locked}
              sectionId={sectionId}
              sessionVariant={debag[0]?.con_org || 'CON'}
              onUpdate={updateDebagRow}
              onRemove={removeDebagRow}
              canRemove={debag.length>1}
            />
          ))}
        </div>
        {!locked&&<AddRow label="Add debagging bag" onClick={addDebagRow}/>}
        <div className="flex justify-between px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-xl">
          <span className="text-[11px] font-medium text-sky-600">Total (A)</span>
          <span className="font-mono font-bold text-[14px] text-sky-700">{totalA.toFixed(1)} kg</span>
        </div>
      </Card>
      <Card title="Bagging — up to 3 output types" variant="output">
        <p className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          Each output type independently totalled. Name each output e.g. Fine Leaf, Indent Dust.
        </p>
        <OutGroup label="Output 1 (B)" rows={out1} total={totalB} locked={locked}
          onUpdate={(i,k,v)=>setOut1(rs=>rs.map((x,j)=>j===i?{...x,[k]:v}:x))}
          onAdd={()=>setOut1(rs=>[...rs,{id:uid(),name:'',serial:'',qty:''}])}
          onRemove={i=>setOut1(rs=>rs.filter((_,j)=>j!==i))}/>
        <div className="border-t border-stone-200 my-1"/>
        <OutGroup label="Output 2 (C)" rows={out2} total={totalC} locked={locked}
          onUpdate={(i,k,v)=>setOut2(rs=>rs.map((x,j)=>j===i?{...x,[k]:v}:x))}
          onAdd={()=>setOut2(rs=>[...rs,{id:uid(),name:'',serial:'',qty:''}])}
          onRemove={i=>setOut2(rs=>rs.filter((_,j)=>j!==i))}/>
        <div className="border-t border-stone-200 my-1"/>
        <OutGroup label="Output 3 (D)" rows={out3} total={totalD} locked={locked}
          onUpdate={(i,k,v)=>setOut3(rs=>rs.map((x,j)=>j===i?{...x,[k]:v}:x))}
          onAdd={()=>setOut3(rs=>[...rs,{id:uid(),name:'',serial:'',qty:''}])}
          onRemove={i=>setOut3(rs=>rs.filter((_,j)=>j!==i))}/>
      </Card>
      <div className={`rounded-2xl p-5 border-2 ${withinTol?'border-ok/30 bg-ok/5':'border-warn/40 bg-warn/5'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Scale size={16} className={withinTol?'text-ok':'text-warn'}/>
          <span className="font-semibold text-[14px] text-text">Mass balance</span>
          {!withinTol&&<AlertTriangle size={14} className="text-warn ml-auto"/>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[{label:'Total input (A)',value:totalA},{label:'Output B',value:totalB},{label:'Output C+D',value:totalC+totalD},{label:'Variance',value:Math.abs(variance)}].map((col,ci)=>(
            <div key={col.label}>
              <div className={`font-mono font-bold text-[18px] ${ci===3?(withinTol?'text-ok':'text-warn'):'text-text'}`}>{col.value.toFixed(1)} kg</div>
              <div className="text-[10px] text-text-muted mt-1">{col.label}</div>
            </div>
          ))}
        </div>
        {!withinTol&&<p className="text-[11px] text-warn mt-3 text-center">Variance exceeds 15 kg — review before submitting</p>}
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Comments</label>
        <textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3} disabled={locked}
          className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none"/>
      </div>
    </div>
  )
}

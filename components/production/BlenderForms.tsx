'use client'
import { useState, useEffect } from 'react'
import * as React from 'react'
import { format } from 'date-fns'
import { Trash2, Plus } from 'lucide-react'
import { uid, num, INP, F, Card, AddRow, detectShift } from '@/components/production/shared/ui'
import { useSerialLookup, markBagConsumed, advanceToNextSerial, variantFamily } from '@/lib/production/scan-utils'
import { nextBlendSerial } from '@/lib/qr/serial'

// ══════════════════════════════════════════════════════════════════════════════
// BLENDER FORMS
// ══════════════════════════════════════════════════════════════════════════════

export type BlendIngredientRow = { id:string; local_export:string; kg:string; lot:string; serial:string }
export type BlendBagRow = { id:string; time:string; blend_type:string; serial_no:string; kg:string }

export const ING_THEME = {
  A: { label:'Sieved Fine Leaf',   letter:'A', bg:'bg-emerald-50', border:'border-emerald-200', head:'bg-emerald-100', txt:'text-emerald-800', dot:'bg-emerald-500' },
  B: { label:'Sieved Coarse Leaf', letter:'B', bg:'bg-teal-50',    border:'border-teal-200',    head:'bg-teal-100',    txt:'text-teal-800',    dot:'bg-teal-500'    },
  C: { label:'Blocks: Clean',      letter:'C', bg:'bg-blue-50',    border:'border-blue-200',    head:'bg-blue-100',    txt:'text-blue-800',    dot:'bg-blue-500'    },
  D: { label:'Blocks: Cut',        letter:'D', bg:'bg-violet-50',  border:'border-violet-200',  head:'bg-violet-100',  txt:'text-violet-800',  dot:'bg-violet-500'  },
  E: { label:'Other 1',            letter:'E', bg:'bg-amber-50',   border:'border-amber-200',   head:'bg-amber-100',   txt:'text-amber-800',   dot:'bg-amber-400'   },
  F: { label:'Other 2',            letter:'F', bg:'bg-rose-50',    border:'border-rose-200',    head:'bg-rose-100',    txt:'text-rose-800',    dot:'bg-rose-400'    },
} as const
export type IngKey = keyof typeof ING_THEME

// Product types that are valid for each ingredient column.
// Scan is rejected (not consumed, not auto-filled) if the bag's product_type
// doesn't match. Columns E + F are unrestricted (Other / configurable).
export const ING_EXPECTED_TYPES: Partial<Record<IngKey, string[]>> = {
  A: ['Fine Leaf'],
  B: ['Coarse Leaf'],
  C: ['RB Blocks', 'Blocks: Clean', 'Clean Blocks', 'Blocks'],
  D: ['RB Blocks', 'Blocks: Cut', 'Cut Heavy Stick', 'CHS Fine', 'CHS Coarse', 'Blocks'],
}

export const BL_EXP_OPTS = ['Export', 'Export Blend', 'Domestic/Local', '']

export function blankIngRow(): BlendIngredientRow {
  return { id: uid(), local_export: 'Export', kg: '', lot: '', serial: '' }
}

export interface IngredientSectionProps {
  ingKey: IngKey
  rows: BlendIngredientRow[]
  total: number
  locked: boolean
  hasLot: boolean
  onUpdate: (i: number, k: string, v: string) => void
  onAdd: () => void
  onRemove: (i: number) => void
  otherLabel?: string
  blendVariant?: string  // variant code of the blend run — used for family validation
}

// ── BlenderIngredientRow — stable BagScanner wrapper for Blender debagging ───
// Scans a bag serial → looks up bag_tags → auto-fills lot, kg, product type
// Validates: (1) product type matches column, (2) variant family matches blend,
//            (3) finished blended products are blocked as ingredients.
export const BlenderIngredientRow = React.memo(function BlenderIngredientRow({
  row, idx, locked, hasLot, ingKey, blendVariant, onUpdate, onRemove, canRemove,
}: {
  row: BlendIngredientRow; idx: number; locked: boolean; hasLot: boolean
  ingKey: string
  blendVariant: string  // variant code of the blend run (CON/ORG/RA-CON/RA-ORG)
  onUpdate: (i:number, k:string, v:string) => void
  onRemove: (i:number) => void; canRemove: boolean
}) {
  const [lookupStatus, setLookupStatus] = React.useState<'idle'|'found'|'mismatch'>('idle')
  const [mismatchType, setMismatchType] = React.useState('')
  const [mismatchKind, setMismatchKind] = React.useState<'product_type'|'variant_family'|'finished_product'>('product_type')
  const blSerialRef = React.useRef<HTMLInputElement>(null)

  useSerialLookup(row.serial, React.useCallback((result) => {
    // 1. Block finished blended products — cannot be used as ingredients
    if (/blend/i.test(result.product_type)) {
      setLookupStatus('mismatch')
      setMismatchType(result.product_type)
      setMismatchKind('finished_product')
      return
    }
    // 2. Validate product type against what this column expects
    const allowed = ING_EXPECTED_TYPES[ingKey as IngKey]
    if (allowed && result.product_type) {
      const ok = allowed.some(t => result.product_type.toLowerCase().includes(t.toLowerCase()))
      if (!ok) {
        setLookupStatus('mismatch')
        setMismatchType(result.product_type)
        setMismatchKind('product_type')
        return  // Reject — do NOT auto-fill or mark consumed
      }
    }
    // 3. Validate variant family — CON/RA-CON cannot mix with ORG/RA-ORG
    if (blendVariant && result.variant) {
      const blendFam = variantFamily(blendVariant)
      const bagFam   = variantFamily(result.variant)
      if (blendFam && bagFam && blendFam !== bagFam) {
        setLookupStatus('mismatch')
        setMismatchType(result.variant)
        setMismatchKind('variant_family')
        return
      }
    }
    if (result.weight_kg)  onUpdate(idx, 'kg',  result.weight_kg)
    if (result.lot_number && result.lot_number !== 'NOT TRACKED')
                           onUpdate(idx, 'lot', result.lot_number)
    setLookupStatus('found')
    markBagConsumed(row.serial, 'blender', null, parseFloat(result.weight_kg)||undefined)
    advanceToNextSerial(blSerialRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, onUpdate, row.serial, ingKey, blendVariant]))

  const cols = hasLot ? 'grid-cols-[70px_1fr_1fr_1fr_auto]' : 'grid-cols-[70px_1fr_1fr_auto]'

  return (
    <div className="space-y-1">
      <div className={`grid gap-1.5 items-center bg-white rounded-xl px-2 py-1.5 border ${lookupStatus==='mismatch' ? 'border-err/40 bg-err/5' : 'border-stone-100'} ${cols}`}>
        <select value={row.local_export} onChange={e => onUpdate(idx, 'local_export', e.target.value)} disabled={locked}
          className="w-full px-1.5 py-1.5 rounded-lg border border-stone-200 bg-white text-[11px] text-text outline-none focus:border-brand disabled:opacity-40 disabled:bg-stone-50">
          {BL_EXP_OPTS.map(o => <option key={o}>{o}</option>)}
        </select>
        <input type="text" inputMode="decimal" value={row.kg}
          onChange={e => onUpdate(idx, 'kg', e.target.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1'))}
          placeholder="kg" disabled={locked} className={INP}/>
        {hasLot && (
          <input type="text" value={row.lot}
            onChange={e => { onUpdate(idx, 'lot', e.target.value.toUpperCase()); setLookupStatus('idle') }}
            placeholder="e.g. GS-0271" disabled={locked}
            className={INP + (lookupStatus==='found' ? ' border-ok/60 bg-ok/5' : '')}/>
        )}
        <div className="relative">
          <input
            ref={blSerialRef}
            type="text"
            data-serial="true"
            value={row.serial}
            onChange={e => { onUpdate(idx, 'serial', e.target.value.toUpperCase()); setLookupStatus('idle'); setMismatchType(''); setMismatchKind('product_type') }}
            placeholder="▐▌ Scan or type serial" disabled={locked}
            className={"w-full py-1.5 px-2 rounded-lg border-2 bg-white text-[11px] font-mono text-text outline-none focus:border-brand disabled:opacity-40 transition-all " + (
              lookupStatus==='found'    ? 'border-ok/60 bg-ok/5' :
              lookupStatus==='mismatch' ? 'border-err/60 bg-err/5' :
              'border-blue-300 bg-blue-50/30'
            )}/>
          {lookupStatus==='found'    && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ok  text-[14px]">✓</span>}
          {lookupStatus==='mismatch' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-err text-[14px]">✗</span>}
        </div>
        {canRemove && !locked && (
          <button onClick={() => onRemove(idx)} className="text-err/30 hover:text-err"><Trash2 size={12}/></button>
        )}
      </div>
      {lookupStatus === 'mismatch' && (
        <p className="text-[10px] text-err font-semibold px-2">
          {mismatchKind === 'finished_product'
            ? <>✗ Finished product <strong>"{mismatchType}"</strong> cannot be used as a blend ingredient. Clear and scan a raw material bag.</>
            : mismatchKind === 'variant_family'
            ? <>✗ Variant mismatch — blend is <strong>{blendVariant}</strong> but scanned bag is <strong>{mismatchType}</strong>. CON/RA-CON and ORG/RA-ORG cannot be mixed. Clear and scan the correct bag.</>
            : <>✗ Wrong bag type — scanned <strong>"{mismatchType}"</strong> into{' '}
               <strong>{ING_THEME[ingKey as IngKey]?.label ?? ingKey}</strong> column.
               Clear the serial and scan the correct bag.</>
          }
        </p>
      )}
    </div>
  )
})

export function IngredientSection({ ingKey, rows, total, locked, hasLot, onUpdate, onAdd, onRemove, otherLabel, blendVariant }: IngredientSectionProps) {
  const th = ING_THEME[ingKey]
  const label = otherLabel || th.label
  return (
    <div className={`rounded-2xl border overflow-hidden ${th.border}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${th.head} border-b ${th.border}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-6 h-6 rounded-lg ${th.dot} flex items-center justify-center flex-shrink-0`}>
            <span className="font-mono font-bold text-[11px] text-white">{th.letter}</span>
          </div>
          <span className={`font-semibold text-[13px] ${th.txt}`}>{label}</span>
          <span className={`font-mono text-[10px] ${th.txt} opacity-60`}>{rows.length} bag{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <span className={`font-mono font-bold text-[15px] ${th.txt}`}>{total.toFixed(1)} kg</span>
      </div>
      <div className={`p-3 ${th.bg} space-y-2`}>
        {rows.length > 0 && (
          <div className="space-y-1.5">
            <div className={`grid gap-1.5 px-1 ${hasLot ? 'grid-cols-[70px_1fr_1fr_1fr_auto]' : 'grid-cols-[70px_1fr_1fr_auto]'}`}>
              {['Local/Exp', 'KG', ...(hasLot ? ['Lot No.'] : []), 'Serial No.', ''].map(h => (
                <span key={h} className="text-[9px] font-bold text-stone-400 uppercase">{h}</span>
              ))}
            </div>
            {rows.map((r, i) => (
              <BlenderIngredientRow
                key={r.id}
                row={r}
                idx={i}
                locked={locked}
                hasLot={hasLot}
                ingKey={ingKey}
                blendVariant={blendVariant ?? 'CON'}
                onUpdate={onUpdate}
                onRemove={onRemove}
                canRemove={rows.length > 1}
              />
            ))}
          </div>
        )}
        {!locked && (
          <button onClick={onAdd}
            className={`w-full py-2.5 rounded-xl border-2 border-dashed ${th.border} ${th.txt} font-semibold text-[12px] hover:opacity-70 transition-opacity flex items-center justify-center gap-1.5`}>
            <Plus size={13}/> Add {label} bag
          </button>
        )}
        {rows.length === 0 && locked && (
          <p className="text-[11px] text-stone-400 text-center py-2">No {label.toLowerCase()} recorded</p>
        )}
      </div>
    </div>
  )
}

export function BlenderForm({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
  // Header state
  const [op1,         setOp1]        = useState(()=>savedData?.op1         ?? '')
  const [op2,         setOp2]        = useState(()=>savedData?.op2         ?? '')
  const [op3,         setOp3]        = useState(()=>savedData?.op3         ?? '')
  const [shift,       setShift]      = useState(()=>savedData?.shift       ?? detectShift())
  const [supervisor,  setSupervisor] = useState(()=>savedData?.supervisor  ?? '')
  const [lotNo,       setLotNo]      = useState(()=>savedData?.lotNo       ?? '')
  const [variantCode, setVariant]    = useState(()=>savedData?.variantCode ?? 'CON')
  const [blendCode,   setBlendCode]  = useState(()=>savedData?.blendCode   ?? '')
  const [other1Label, setOther1Lbl]  = useState(()=>savedData?.other1Label ?? '')
  const [other2Label, setOther2Lbl]  = useState(()=>savedData?.other2Label ?? '')

  // Ingredient rows — one array per type A–F
  const [rowsA, setRowsA] = useState<BlendIngredientRow[]>(()=>savedData?.rowsA ?? [blankIngRow()])
  const [rowsB, setRowsB] = useState<BlendIngredientRow[]>(()=>savedData?.rowsB ?? [blankIngRow()])
  const [rowsC, setRowsC] = useState<BlendIngredientRow[]>(()=>savedData?.rowsC ?? [blankIngRow()])
  const [rowsD, setRowsD] = useState<BlendIngredientRow[]>(()=>savedData?.rowsD ?? [blankIngRow()])
  const [rowsE, setRowsE] = useState<BlendIngredientRow[]>(()=>savedData?.rowsE ?? [])
  const [rowsF, setRowsF] = useState<BlendIngredientRow[]>(()=>savedData?.rowsF ?? [])

  // Bagging state
  const [bagRows,    setBagRows]    = useState<BlendBagRow[]>(()=>savedData?.bagRows    ?? [{id:uid(),time:'',blend_type:'',serial_no:'',kg:''}])
  const [scaleBegin, setScaleBegin] = useState(()=>savedData?.scaleBegin ?? '')
  const [scaleFull,  setScaleFull]  = useState(()=>savedData?.scaleFull  ?? '')
  const [scaleEnd,   setScaleEnd]   = useState(()=>savedData?.scaleEnd   ?? '')
  const [extrDust,   setExtrDust]   = useState(()=>savedData?.extrDust   ?? '')
  const [waste,      setWaste]      = useState(()=>savedData?.waste      ?? '')
  const [checkedBy,  setCheckedBy]  = useState(()=>savedData?.checkedBy  ?? '')
  const [comments,   setComments]   = useState(()=>savedData?.comments   ?? '')

  // Totals
  const totalA   = rowsA.reduce((s,r)=>s+num(r.kg),0)
  const totalB   = rowsB.reduce((s,r)=>s+num(r.kg),0)
  const totalC   = rowsC.reduce((s,r)=>s+num(r.kg),0)
  const totalD   = rowsD.reduce((s,r)=>s+num(r.kg),0)
  const totalE   = rowsE.reduce((s,r)=>s+num(r.kg),0)
  const totalF   = rowsF.reduce((s,r)=>s+num(r.kg),0)
  const totalIn  = totalA+totalB+totalC+totalD+totalE+totalF
  const totalOut = bagRows.reduce((s,r)=>s+num(r.kg),0)
  const massBalance = totalOut - totalIn  // J = G − I
  const pct = (v:number) => totalIn>0?((v/totalIn)*100).toFixed(1)+'%':'—'

  function upIng(setter:React.Dispatch<React.SetStateAction<BlendIngredientRow[]>>, i:number, k:string, v:string) {
    setter(rs=>rs.map((r,j)=>j===i?{...r,[k]:k==='lot'||k==='serial'?v.toUpperCase():v}:r))
  }
  function addIng(setter:React.Dispatch<React.SetStateAction<BlendIngredientRow[]>>, rows:BlendIngredientRow[]) {
    const prev=rows[rows.length-1]
    setter(rs=>[...rs,{id:uid(),local_export:prev?.local_export??'Export',kg:'',lot:prev?.lot??'',serial:''}])
  }
  function remIng(setter:React.Dispatch<React.SetStateAction<BlendIngredientRow[]>>, i:number) {
    setter(rs=>rs.filter((_,j)=>j!==i))
  }

  useEffect(()=>{
    onData({op1,op2,op3,shift,supervisor,lotNo,variantCode,blendCode,other1Label,other2Label,
      rowsA,rowsB,rowsC,rowsD,rowsE,rowsF,bagRows,
      totalA,totalB,totalC,totalD,totalE,totalF,totalIn,totalOut,massBalance,
      scaleBegin,scaleFull,scaleEnd,extrDust,waste,checkedBy,comments})
  },[rowsA,rowsB,rowsC,rowsD,rowsE,rowsF,bagRows,
     op1,op2,op3,shift,supervisor,lotNo,variantCode,blendCode,other1Label,other2Label,
     scaleBegin,scaleFull,scaleEnd,extrDust,waste,checkedBy,comments])

  const showE = rowsE.length > 0 || !locked
  const showF = rowsF.length > 0 || !locked

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <Card title="Big Blender — header">
        <div className="grid grid-cols-2 gap-3">
          <F label="Shift"            value={shift}       onChange={setShift}                      opts={['Morning','Afternoon','Night']} disabled={locked}/>
          <F label="Operator 1"       value={op1}         onChange={setOp1}                        ph="Name" disabled={locked}/>
          <F label="Operator 2"       value={op2}         onChange={setOp2}                        ph="Name" disabled={locked}/>
          <F label="Operator 3"       value={op3}         onChange={setOp3}                        ph="Name (if applicable)" disabled={locked}/>
          <F label="Shift supervisor" value={supervisor}  onChange={setSupervisor}                 ph="e.g. Arnold" disabled={locked}/>
          <F label="Variant code"     value={variantCode} onChange={setVariant}                    opts={['CON','ORG','RA-CON','RA-ORG']} disabled={locked}/>
          <F label="Lot number"       value={lotNo}       onChange={v=>setLotNo(v.toUpperCase())}  ph="e.g. 08-013-26/1" disabled={locked}/>
          <F label="Blend code (Acumatica)" value={blendCode} onChange={v=>setBlendCode(v.toUpperCase())} ph="e.g. SG-NAT26-C" disabled={locked}/>
        </div>
        {blendCode && (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-purple-50 border border-purple-200 rounded-xl">
            <div className="w-1 h-4 rounded-full bg-purple-400"/>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono text-purple-500 uppercase tracking-wide">Production order</p>
              <p className="font-mono font-bold text-[14px] text-purple-800">25BL{blendCode}</p>
            </div>
            <span className="text-[10px] text-purple-400">Bagging total → Qty to produce</span>
          </div>
        )}
      </Card>

      {/* ── Debagging — ingredient sections (Page 1) ── */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
        <div className="flex items-center justify-between px-5 py-3 bg-sky-50 border-b border-sky-200 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-5 rounded-full bg-sky-400"/>
            <span className="font-semibold text-[13px] text-sky-800">Debagging — inputs (Page 1)</span>
          </div>
          <span className="font-mono font-bold text-[14px] text-sky-700">{totalIn.toFixed(1)} kg total</span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-sky-600 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
            One colour-coded section per ingredient. Add a row for each bag of that ingredient. Lot numbers carry over on add. Only Fine Leaf (A) and Coarse Leaf (B) have lot numbers — matches Acumatica material release.
          </p>

          <IngredientSection ingKey="A" rows={rowsA} total={totalA} locked={locked} hasLot={true} blendVariant={variantCode}
            onUpdate={(i,k,v)=>upIng(setRowsA,i,k,v)}
            onAdd={()=>addIng(setRowsA,rowsA)}
            onRemove={i=>remIng(setRowsA,i)}/>

          <IngredientSection ingKey="B" rows={rowsB} total={totalB} locked={locked} hasLot={true} blendVariant={variantCode}
            onUpdate={(i,k,v)=>upIng(setRowsB,i,k,v)}
            onAdd={()=>addIng(setRowsB,rowsB)}
            onRemove={i=>remIng(setRowsB,i)}/>

          <IngredientSection ingKey="C" rows={rowsC} total={totalC} locked={locked} hasLot={false} blendVariant={variantCode}
            onUpdate={(i,k,v)=>upIng(setRowsC,i,k,v)}
            onAdd={()=>addIng(setRowsC,rowsC)}
            onRemove={i=>remIng(setRowsC,i)}/>

          <IngredientSection ingKey="D" rows={rowsD} total={totalD} locked={locked} hasLot={false} blendVariant={variantCode}
            onUpdate={(i,k,v)=>upIng(setRowsD,i,k,v)}
            onAdd={()=>addIng(setRowsD,rowsD)}
            onRemove={i=>remIng(setRowsD,i)}/>

          {/* Other 1 (E) — optional, editable label */}
          {showE && (
            <div className="space-y-1.5">
              {!locked && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide whitespace-nowrap">Other 1 name</label>
                  <input value={other1Label} onChange={e=>setOther1Lbl(e.target.value)} disabled={locked}
                    placeholder="e.g. Corn Cutter Fine Leaf"
                    className="flex-1 px-2 py-1 rounded-lg border border-amber-200 text-[12px] text-text outline-none focus:border-amber-400 bg-amber-50"/>
                </div>
              )}
              {rowsE.length > 0 ? (
                <IngredientSection ingKey="E" rows={rowsE} total={totalE} locked={locked} hasLot={false} blendVariant={variantCode}
                  otherLabel={other1Label}
                  onUpdate={(i,k,v)=>upIng(setRowsE,i,k,v)}
                  onAdd={()=>addIng(setRowsE,rowsE)}
                  onRemove={i=>remIng(setRowsE,i)}/>
              ) : (
                !locked && (
                  <button onClick={()=>setRowsE([blankIngRow()])}
                    className="w-full py-2.5 border border-dashed border-amber-300 rounded-xl text-[12px] font-medium text-amber-600 hover:border-amber-400 hover:bg-amber-50 transition-all flex items-center justify-center gap-1.5">
                    <Plus size={13}/> Add {other1Label || 'Other (E)'} (E)
                  </button>
                )
              )}
            </div>
          )}

          {/* Other 2 (F) — optional, editable label */}
          {showF && (
            <div className="space-y-1.5">
              {!locked && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-semibold text-rose-700 uppercase tracking-wide whitespace-nowrap">Other 2 name</label>
                  <input value={other2Label} onChange={e=>setOther2Lbl(e.target.value)} disabled={locked}
                    placeholder="e.g. Corn Cutter Fine Leaf..."
                    className="flex-1 px-2 py-1 rounded-lg border border-rose-200 text-[12px] text-text outline-none focus:border-rose-400 bg-rose-50"/>
                </div>
              )}
              {rowsF.length > 0 ? (
                <IngredientSection ingKey="F" rows={rowsF} total={totalF} locked={locked} hasLot={false} blendVariant={variantCode}
                  otherLabel={other2Label}
                  onUpdate={(i,k,v)=>upIng(setRowsF,i,k,v)}
                  onAdd={()=>addIng(setRowsF,rowsF)}
                  onRemove={i=>remIng(setRowsF,i)}/>
              ) : (
                !locked && (
                  <button onClick={()=>setRowsF([blankIngRow()])}
                    className="w-full py-2.5 border border-dashed border-rose-300 rounded-xl text-[12px] font-medium text-rose-600 hover:border-rose-400 hover:bg-rose-50 transition-all flex items-center justify-center gap-1.5">
                    <Plus size={13}/> Add {other2Label || 'Other (F)'} (F)
                  </button>
                )
              )}
            </div>
          )}

          {/* Column totals — mirrors bottom of paper Page 1 */}
          {totalIn > 0 && (
            <div className="pt-2 border-t border-stone-200 space-y-2">
              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide px-1">Column totals</p>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ['A', totalA, ING_THEME.A],
                  ['B', totalB, ING_THEME.B],
                  ['C', totalC, ING_THEME.C],
                  ['D', totalD, ING_THEME.D],
                  ...(totalE>0?[['E',totalE,ING_THEME.E]]:[] as any),
                  ...(totalF>0?[['F',totalF,ING_THEME.F]]:[] as any),
                ] as [string,number,typeof ING_THEME.A][]).map(([l,v,t])=>(
                  <div key={l} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${t.border} ${t.bg} text-[11px]`}>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-4 h-4 rounded ${t.dot} flex items-center justify-center flex-shrink-0`}>
                        <span className="font-mono font-bold text-[8px] text-white">{l}</span>
                      </div>
                      <span className={`${t.txt} truncate max-w-[80px]`}>{t.label}</span>
                    </div>
                    <div className="text-right flex-shrink-0 ml-1">
                      <span className={`font-mono font-bold ${t.txt}`}>{v.toFixed(1)} kg</span>
                      <span className={`font-mono text-[9px] ${t.txt} opacity-60 ml-1`}>· {pct(v)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-xl">
                <span className="text-[12px] font-semibold text-sky-700">Total (I)</span>
                <span className="font-mono font-bold text-[15px] text-sky-800">{totalIn.toFixed(1)} kg</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bagging (Page 2) ── */}
      <Card title="Bagging — outputs (Page 2)" total={totalOut} variant="output">
        <div className="grid grid-cols-2 gap-3 pb-3 border-b border-stone-100">
          <F label="Scale: begin (kg)"    value={scaleBegin} onChange={setScaleBegin} type="number" disabled={locked}/>
          <F label="Scale: full (kg)"     value={scaleFull}  onChange={setScaleFull}  type="number" disabled={locked}/>
          <F label="Scale: end (kg)"      value={scaleEnd}   onChange={setScaleEnd}   type="number" disabled={locked}/>
          <F label="Extraction dust (kg)" value={extrDust}   onChange={setExtrDust}   type="number" disabled={locked}/>
          <F label="Waste (H, kg)"        value={waste}      onChange={setWaste}      type="number" disabled={locked} wide/>
        </div>
        <div className="space-y-1.5 mt-1">
          {bagRows.map((r,i)=>(
            <div key={r.id} className="bg-stone-50 border border-stone-200 rounded-xl px-2 py-2 space-y-1.5">
              {/* Row 1: bag label + time + kg — flex-wrap so kg stays with time on mobile */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-stone-400 flex-shrink-0 w-10">Bag {i+1}</span>
                <input type="time" value={r.time}
                  onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,time:e.target.value}:x))}
                  onFocus={e=>{if(!r.time)setBagRows(rs=>rs.map((x,j)=>j===i?{...x,time:format(new Date(),'HH:mm')}:x))}}
                  disabled={locked} className={`${INP} w-24 flex-shrink-0`}/>
                <input type="text" inputMode="decimal" value={r.kg}
                  onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,kg:e.target.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1')}:x))}
                  placeholder="kg" disabled={locked} className={`${INP} w-20 flex-shrink-0`}/>
                {bagRows.length>1&&!locked&&(
                  <button onClick={()=>setBagRows(rs=>rs.filter((_,j)=>j!==i))} className="ml-auto text-err/30 hover:text-err"><Trash2 size={12}/></button>
                )}
              </div>
              {/* Row 2: blend type + serial — full width on mobile */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <input type="text" value={r.blend_type||blendCode}
                  onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,blend_type:e.target.value.toUpperCase()}:x))}
                  placeholder="Blend type e.g. SG-NAT26-C" disabled={locked} className={INP}/>
                <input type="text" value={r.serial_no}
                  onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,serial_no:e.target.value.toUpperCase()}:x))}
                  placeholder="Serial e.g. BL-240426-001" disabled={locked} className={INP}/>
              </div>
            </div>
          ))}
          {!locked&&(
            <button onClick={()=>{
              const prev=bagRows[bagRows.length-1]
              const serialNo = nextBlendSerial(lotNo || format(new Date(),'dd-MM-yy'), new Date(), bagRows.map((r:any)=>r.serial_no).filter(Boolean))
              setBagRows(rs=>[...rs,{id:uid(),time:format(new Date(),'HH:mm'),blend_type:prev?.blend_type??blendCode,serial_no:serialNo,kg:prev?.kg??''}])
            }}
              className="w-full py-2.5 border border-dashed border-stone-300 rounded-xl text-[12px] font-medium text-stone-400 hover:border-brand hover:text-brand hover:bg-brand/5 transition-all flex items-center justify-center gap-1.5">
              <Plus size={13}/> Add output bag
            </button>
          )}
        </div>
        <div className="mt-3">
          <F label="Report checked by" value={checkedBy} onChange={setCheckedBy} ph="Full name" disabled={locked} wide/>
        </div>
      </Card>

      {/* ── Blend component ratio + mass balance — Page 2 summary box ── */}
      {totalIn > 0 && (
        <Card title="Blend component ratio — auto-calculated" variant="info">
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['Sieved Fine Leaf (A)',   totalA, 'text-emerald-700', 'bg-emerald-50 border-emerald-100'],
              ['Sieved Coarse Leaf (B)', totalB, 'text-teal-700',    'bg-teal-50 border-teal-100'   ],
              ['Blocks: Clean (C)',      totalC, 'text-blue-700',    'bg-blue-50 border-blue-100'   ],
              ['Blocks: Cut (D)',        totalD, 'text-violet-700',  'bg-violet-50 border-violet-100'],
              ...(totalE>0?[[other1Label+' (E)',totalE,'text-amber-700','bg-amber-50 border-amber-100']]:[] as any),
              ...(totalF>0?[[other2Label+' (F)',totalF,'text-rose-700', 'bg-rose-50 border-rose-100' ]]:[] as any),
            ] as [string,number,string,string][]).map(([l,v,tc,bg])=>(
              <div key={l} className={`flex justify-between px-3 py-2 rounded-lg border text-[11px] ${bg}`}>
                <span className={`${tc} truncate pr-2`}>{l}</span>
                <span className={`font-mono font-bold ${tc} flex-shrink-0`}>{v.toFixed(1)} kg · {pct(v)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-xl">
            <span className="text-[12px] font-semibold text-sky-700">Total blend (I)</span>
            <span className="font-mono font-bold text-[15px] text-sky-800">{totalIn.toFixed(1)} kg</span>
          </div>
          {totalOut > 0 && (
            <>
              <div className="flex justify-between px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-[12px] font-semibold text-emerald-700">Total bagged (G)</span>
                <span className="font-mono font-bold text-[14px] text-emerald-800">{totalOut.toFixed(1)} kg</span>
              </div>
              <div className={`flex justify-between px-4 py-3 rounded-xl border-2 ${Math.abs(massBalance)<=15?'bg-ok/5 border-ok/30':'bg-warn/5 border-warn/30'}`}>
                <div>
                  <span className={`text-[12px] font-semibold ${Math.abs(massBalance)<=15?'text-ok':'text-warn'}`}>Mass balance (J = G − I)</span>
                  {Math.abs(massBalance)>15&&<p className="text-[10px] text-warn mt-0.5">Variance exceeds 15 kg — review before submitting</p>}
                </div>
                <span className={`font-mono font-bold text-[16px] ${Math.abs(massBalance)<=15?'text-ok':'text-warn'}`}>{massBalance.toFixed(1)} kg</span>
              </div>
            </>
          )}
        </Card>
      )}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-stone-300"/>
          <label className="text-[12px] font-semibold text-stone-700">Shift comments</label>
          <span className="text-[10px] text-stone-400">— sent to production admins on save</span>
        </div>
        <textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3} disabled={locked}
          placeholder="Any issues, observations, or notes for this blend run…"
          className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none disabled:opacity-40"/>
      </div>
    </div>
  )
}

// MultiBlenderForm — uses the generic wrapper
export function MultiBlenderForm({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
  return (
    <MultiProductionWrapper
      sectionId="blender"
      locked={locked}
      onData={onData}
      savedData={savedData}
      FormComponent={BlenderForm}
      getTabLabel={(data, i) => {
        if (!data?.blendCode) return `Production ${i+1}`
        return `${i+1}: 25BL${data.blendCode}`
      }}
    />
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-PRODUCTION WRAPPER — generic, used by Sieving, Granule, Pasteuriser
// Allows multiple production orders per shift (e.g. Conventional + Organic)
// ══════════════════════════════════════════════════════════════════════════════

// Stable per-slot wrapper — gives each production a stable onData ref
// Prevents BagScanner useEffect infinite loop caused by new fn reference every render
export const ProductionSlot = React.memo(function ProductionSlot({
  visible, idx, locked, savedData, FormComponent, onProductionData, extraProps,
}: {
  visible: boolean; idx: number; locked: boolean; savedData: any
  FormComponent: React.ComponentType<{locked:boolean; onData:(d:any)=>void; savedData?:any; [key:string]:any}>
  onProductionData: (idx:number, data:any) => void
  extraProps?: Record<string, any>
}) {
  const onData = React.useCallback((d:any) => onProductionData(idx, d), [idx, onProductionData])
  return (
    <div style={{display: visible ? 'block' : 'none'}}>
      <FormComponent locked={locked} onData={onData} savedData={savedData} {...(extraProps||{})}/>
    </div>
  )
})

export function MultiProductionWrapper({
  sectionId, locked, onData, savedData, maxProductions = 4,
  FormComponent, getTabLabel, extraProps,
}: {
  sectionId: string
  locked: boolean
  onData: (d:any) => void
  savedData?: any
  maxProductions?: number
  FormComponent: React.ComponentType<{locked:boolean; onData:(d:any)=>void; savedData?:any; [key:string]:any}>
  getTabLabel: (data:any, idx:number) => string
  extraProps?: Record<string, any>
}) {
  const [productions, setProductions] = useState<{id:string; data:any}[]>(
    () => savedData?.productions ?? [{ id: uid(), data: savedData }]
  )
  const [activeIdx, setActiveIdx] = useState(0)

  const PROD_COLORS = [
    'bg-blue-600 text-white border-blue-700',
    'bg-emerald-600 text-white border-emerald-700',
    'bg-amber-600 text-white border-amber-700',
    'bg-purple-600 text-white border-purple-700',
  ]

  const handleProductionData = React.useCallback((idx: number, data: any) => {
    setProductions(ps => ps.map((p,i) => i===idx ? {...p, data} : p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // isFirstRender prevents onData firing on mount (would cause infinite loop)
  const isFirstRender = React.useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    onData({ productions, ...productions[activeIdx]?.data })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productions])

  return (
    <div className="space-y-3">
      {/* Production tabs bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mr-1">Production:</span>
        {productions.map((p, i) => (
          <button key={p.id} onClick={()=>setActiveIdx(i)}
            className={`px-3 py-1.5 rounded-lg font-medium text-[12px] transition-all border flex-shrink-0 ${
              activeIdx===i
                ? PROD_COLORS[i % PROD_COLORS.length]
                : 'bg-white text-stone-500 border-stone-200 hover:bg-stone-50'
            }`}>
            {getTabLabel(p.data, i)}
          </button>
        ))}
        {!locked && productions.length < maxProductions && (
          <button onClick={()=>{
            const newIdx = productions.length
            setProductions(ps=>[...ps,{id:uid(),data:null}])
            setTimeout(()=>setActiveIdx(newIdx), 50)
          }}
            className="px-3 py-1.5 rounded-lg border border-dashed border-stone-300 text-stone-400 font-medium text-[12px] hover:border-brand hover:text-brand transition-all flex items-center gap-1.5 flex-shrink-0">
            <Plus size={12}/> New production order
          </button>
        )}
        {!locked && productions.length > 1 && (
          <button onClick={()=>{
            if(!confirm('Remove production ' + (activeIdx+1) + '? Data will be lost.')) return
            const newProd = productions.filter((_,i)=>i!==activeIdx)
            setProductions(newProd)
            setActiveIdx(Math.min(activeIdx, newProd.length-1))
          }}
            className="px-2 py-1.5 rounded-lg border border-red-200 text-red-400 text-[11px] hover:bg-red-50 transition-all flex-shrink-0">
            Remove
          </button>
        )}
      </div>

      {/* Active production indicator */}
      {productions.length > 1 && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
          ['bg-blue-50 border-blue-200','bg-emerald-50 border-emerald-200','bg-amber-50 border-amber-200','bg-purple-50 border-purple-200'][activeIdx % 4]
        }`}>
          <div className={`w-2 h-2 rounded-full ${['bg-blue-500','bg-emerald-500','bg-amber-500','bg-purple-500'][activeIdx % 4]}`}/>
          <span className={`text-[12px] font-semibold ${['text-blue-700','text-emerald-700','text-amber-700','text-purple-700'][activeIdx % 4]}`}>
            Production {activeIdx+1} of {productions.length}
          </span>
          <span className="text-[11px] text-stone-400 ml-auto">Each production = separate Acumatica order</span>
        </div>
      )}

      {/* Form panels */}
      {productions.map((p, i) => (
        <ProductionSlot
          key={p.id}
          visible={i===activeIdx}
          idx={i}
          locked={locked}
          savedData={p.data}
          FormComponent={FormComponent}
          onProductionData={handleProductionData}
          extraProps={extraProps}
        />
      ))}
    </div>
  )
}

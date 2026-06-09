'use client'
import { useState, useEffect } from 'react'
import * as React from 'react'
import { format } from 'date-fns'
import { Trash2, Plus } from 'lucide-react'
import { uid, num, INP, F, Card, AddRow, SearchableSelect, ProductionOrderSelect, detectShift } from '@/components/production/shared/ui'
import { useSerialLookup, markBagConsumed, advanceToNextSerial, variantFamily } from '@/lib/production/scan-utils'

// ══════════════════════════════════════════════════════════════════════════════
// GRANULE LINE FORM
// ══════════════════════════════════════════════════════════════════════════════

export type GranBagRow     = { id:string; time:string; item:string; lot_number:string; serial_numbers:string; bag_weights:string; total_weight:string }
export type GranSummaryRow = { id:string; product_type:string; lot_number:string; total_bags:string; total_output_kg:string }
export type DustRow        = { id:string; dust_type:string; bags:string; qty_kg:string }
export type WasteRow       = { id:string; description:string; kg:string }

export type GranBlendRow = {
  id:string
  blend_no:string
  // Each column: weight + serial + lot + variant
  brown_dust_kg:string; brown_dust_serial:string; brown_dust_lot:string; brown_dust_variant:string
  white_dust_kg:string; white_dust_serial:string; white_dust_lot:string; white_dust_variant:string
  indent_dust_kg:string; indent_dust_serial:string; indent_dust_lot:string; indent_dust_variant:string
  leaf_dust_kg:string; leaf_dust_serial:string; leaf_dust_lot:string; leaf_dust_variant:string
  alt_dust_kg:string; alt_dust_serial:string; alt_dust_lot:string; alt_dust_variant:string
  sg_dust_kg:string; sg_dust_serial:string; sg_dust_lot:string; sg_dust_variant:string
  dust_extraction_kg:string; dust_extraction_serial:string; dust_extraction_lot:string; dust_extraction_variant:string
  water_kg:string
}

export function blankGranBlendRow(n:number): GranBlendRow {
  return {
    id:uid(), blend_no:String(n),
    brown_dust_kg:'', brown_dust_serial:'', brown_dust_lot:'', brown_dust_variant:'CON',
    white_dust_kg:'', white_dust_serial:'', white_dust_lot:'', white_dust_variant:'CON',
    indent_dust_kg:'', indent_dust_serial:'', indent_dust_lot:'', indent_dust_variant:'CON',
    leaf_dust_kg:'', leaf_dust_serial:'', leaf_dust_lot:'', leaf_dust_variant:'CON',
    alt_dust_kg:'', alt_dust_serial:'', alt_dust_lot:'', alt_dust_variant:'CON',
    sg_dust_kg:'', sg_dust_serial:'', sg_dust_lot:'', sg_dust_variant:'CON',
    dust_extraction_kg:'', dust_extraction_serial:'', dust_extraction_lot:'', dust_extraction_variant:'CON',
    water_kg:'',
  }
}

export const GRAN_COLS = [
  { key:'brown_dust',     label:'Brown Dust / CP Dust', acumatica:true  },
  { key:'white_dust',     label:'White Dust',           acumatica:true  },
  { key:'indent_dust',    label:'Indent Dust',          acumatica:true  },
  { key:'leaf_dust',      label:'Leaf Dust',            acumatica:false },
  { key:'alt_dust',       label:'ALT Dust',             acumatica:false },
  { key:'sg_dust',        label:'SG Dust',              acumatica:false },
  { key:'dust_extraction',label:'Dust Extraction',      acumatica:false, note:'= Powder Dust from Pasteuriser' },
] as const

type GranColKey = typeof GRAN_COLS[number]['key']


// ── GranuleDustSerialInput — auto-looks up bag_tags when serial is scanned ───
// Used for each dust column (Brown Dust, White Dust, Indent Dust etc.) in the
// Granule Line mass balance input. Operator scans the dust bag serial and kg
// auto-fills from the bag_tags row created when Sieving/Refining saved that bag.
const GranuleDustSerialInput = React.memo(function GranuleDustSerialInput({
  serial, kg, onSerialChange, onKgChange, onLotChange, disabled, placeholder, colVariant,
}: {
  serial: string; kg: string
  onSerialChange: (v: string) => void
  onKgChange:     (v: string) => void
  onLotChange?:   (v: string) => void
  disabled: boolean; placeholder?: string
  colVariant?: string
}) {
  const [lookupStatus, setLookupStatus] = React.useState<'idle'|'found'|'mismatch'>('idle')
  const [mismatchMsg,  setMismatchMsg]  = React.useState('')
  const granInputRef = React.useRef<HTMLInputElement>(null)

  useSerialLookup(serial, React.useCallback((result) => {
    // 1. Already consumed
    if ((result as any).consumed_at_section) {
      setLookupStatus('mismatch')
      setMismatchMsg(`⛔ Already consumed at ${(result as any).consumed_at_section}.`)
      return
    }
    // 2. Finished product block — granule never processes blended output as feed
    if (/blend/i.test(result.product_type)) {
      setLookupStatus('mismatch')
      setMismatchMsg(`⛔ Finished blend cannot be granule feed. Scan a raw dust bag.`)
      return
    }
    // 3. Variant family check — compare bag variant vs column variant
    if (colVariant && result.variant) {
      const colFam = variantFamily(colVariant)
      const bagFam = variantFamily(result.variant)
      if (colFam && bagFam && colFam !== bagFam) {
        setLookupStatus('mismatch')
        setMismatchMsg(`⛔ Variant mismatch — column is ${colVariant} but bag is ${result.variant}.`)
        return
      }
    }
    // 4. All good — fill kg, lot, mark consumed
    if (result.weight_kg && !kg)  onKgChange(result.weight_kg)
    if (result.lot_number)        onLotChange?.(result.lot_number)
    setLookupStatus('found')
    markBagConsumed(serial, 'granule', null, parseFloat(result.weight_kg) || undefined)
    advanceToNextSerial(granInputRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial, kg, onKgChange, onLotChange, colVariant]))

  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          ref={granInputRef}
          type="text"
          data-serial="true"
          value={serial}
          onChange={e => { onSerialChange(e.target.value.toUpperCase()); setLookupStatus('idle'); setMismatchMsg('') }}
          placeholder={placeholder || 'Scan barcode or type serial'}
          disabled={disabled}
          className={INP + (
            lookupStatus === 'found'    ? ' border-ok/60 bg-ok/5 pr-7' :
            lookupStatus === 'mismatch' ? ' border-err/60 bg-err/5' : ''
          )}
        />
        {lookupStatus === 'found'    && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ok text-[14px]">✓</span>}
        {lookupStatus === 'mismatch' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-err text-[14px]">✗</span>}
      </div>
      {lookupStatus === 'mismatch' && (
        <p className="text-[10px] text-err font-semibold leading-tight">{mismatchMsg}</p>
      )}
    </div>
  )
})

// ── Granule production order list + grouping ──────────────────────────────────
export const GRAN_ITEMS = [
  '20BGGSG-001-C — Granules SG (Conventional)',
  '20BGGSG-001-RC — Granules SG (RA-Conventional)',
  '20BGGSG-001-O — Granules SG (Organic)',
  '20BGGSG-001-RO — Granules SG (RA-Organic)',
  '20BGGF-001-C — Granules Fine (Conventional)',
  '20BGGF-001-RC — Granules Fine (RA-Conventional)',
  '20BGGF-001-O — Granules Fine (Organic)',
  '20BGGF-001-RO — Granules Fine (RA-Organic)',
  '20BGGE-001-C — Granule Export (Conventional)',
  '20BGGE-001-O — Granule Export (Organic)',
  '',
]
function granOrderGroup(opt: string): string {
  const desc = (opt.split(' — ')[1] || opt).toLowerCase()
  if (/\bsg\b/.test(desc))          return 'SG Granules'
  if (desc.includes('fine'))         return 'Fine Granules'
  if (desc.includes('export'))       return 'Export Granules'
  return 'Other'
}
const GRAN_ORDER_GROUPS = ['SG Granules', 'Fine Granules', 'Export Granules', 'Other']

export function GranuleForm({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
  // ── Bagging Station header ──────────────────────────────────────────────
  const [shift,      setShift]      = useState(()=>savedData?.shift??detectShift())
  const [operators,  setOperators]  = useState(()=>savedData?.operators??'')
  const [supervisor, setSupervisor] = useState(()=>savedData?.supervisor??'')
  const [lotNumber,  setLotNumber]  = useState(()=>savedData?.lotNumber??'')
  const [stdWt,      setStdWt]      = useState(()=>savedData?.stdWt??'160')
  const [actualWt,   setActualWt]   = useState(()=>savedData?.actualWt??'160')
  const [comments,   setComments]   = useState(()=>savedData?.comments??'')

  // ── Bagging Station rows ────────────────────────────────────────────────
  const [bagRows,   setBagRows]   = useState<GranBagRow[]>(()=>savedData?.bagRows??[{id:uid(),time:'',item:'',lot_number:'',serial_numbers:'',bag_weights:'',total_weight:''}])
  const [dustRows,  setDustRows]  = useState<DustRow[]>(()=>savedData?.dustRows??[{id:uid(),dust_type:'SG Dust',bags:'',qty_kg:''}])
  const [wasteRows, setWasteRows] = useState<WasteRow[]>(()=>savedData?.wasteRows??[{id:uid(),description:'',kg:''}])

  // ── Mass Balance Report ─────────────────────────────────────────────────
  const [blendRows,    setBlendRows]    = useState<GranBlendRow[]>(()=>savedData?.blendRows??[blankGranBlendRow(1)])
  const [carryoverD,   setCarryoverD]   = useState(()=>savedData?.carryoverD??'')
  const [carryoverE,   setCarryoverE]   = useState(()=>savedData?.carryoverE??'')
  const [wasteF,       setWasteF]       = useState(()=>savedData?.wasteF??'')
  const [mbOperator,   setMbOperator]   = useState(()=>savedData?.mbOperator??'')
  const [mbSupervisor, setMbSupervisor] = useState(()=>savedData?.mbSupervisor??'')
  const [runStart,     setRunStart]     = useState(()=>savedData?.runStart??'')
  const [runStop,      setRunStop]      = useState(()=>savedData?.runStop??'')
  const [activeTab,    setActiveTab]    = useState<'bagging'|'massbalance'>('bagging')

  // ── Auto-computed summary — grouped by item code from bagRows ───────────
  const computedSummary = React.useMemo(() => {
    const groups: Record<string, {bags:number; totalKg:number; lots:Set<string>}> = {}
    bagRows.forEach(r => {
      const w = parseFloat(r.total_weight)
      if (!r.item || !w) return
      if (!groups[r.item]) groups[r.item] = {bags:0, totalKg:0, lots:new Set()}
      groups[r.item].bags++
      groups[r.item].totalKg += w
      if (r.lot_number) groups[r.item].lots.add(r.lot_number)
    })
    return Object.entries(groups).map(([item, d]) => ({
      item,
      bags:    d.bags,
      totalKg: d.totalKg,
      lots:    Array.from(d.lots).join(', '),
    }))
  }, [bagRows])

  // ── Derived totals — bagging ────────────────────────────────────────────
  const totalOutput = computedSummary.reduce((s,r)=>s+r.totalKg,0)

  // ── Derived totals — mass balance ───────────────────────────────────────
  const colTotal = (col: GranColKey) =>
    blendRows.reduce((s,r) => s + num((r as any)[col+'_kg']), 0)

  const totalMixed = blendRows.reduce((s,r) => {
    return s + GRAN_COLS.reduce((cs, c) => cs + num((r as any)[c.key+'_kg']), 0) + num(r.water_kg)
  }, 0)

  // C* = totals from bagging station report (totalOutput)
  const totalProducedG = totalOutput + num(carryoverD) + num(carryoverE) + num(wasteF)
  const totalRawH = totalMixed
  const balanceFG = totalRawH - totalProducedG
  const yieldPct = totalRawH > 0 ? ((totalProducedG / totalRawH) * 100).toFixed(1) : '—'

  function upBlend(i:number, k:keyof GranBlendRow, v:string) {
    setBlendRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r))
  }

  function addBagRow(){
    const prev=bagRows[bagRows.length-1]
    setBagRows(rs=>[...rs,{id:uid(),time:format(new Date(),'HH:mm'),item:prev?.item??'',lot_number:prev?.lot_number??lotNumber,serial_numbers:'',bag_weights:prev?.bag_weights??'',total_weight:''}])
  }

  useEffect(()=>{
    onData({shift,operators,supervisor,lotNumber,stdWt,actualWt,bagRows,summary:computedSummary,dustRows,wasteRows,totalOutput,
      blendRows,carryoverD,carryoverE,wasteF,totalMixed,totalProducedG,totalRawH,balanceFG,yieldPct,
      mbOperator,mbSupervisor,runStart,runStop,comments})
  },[bagRows,computedSummary,dustRows,wasteRows,shift,operators,supervisor,lotNumber,stdWt,actualWt,
     blendRows,carryoverD,carryoverE,wasteF,mbOperator,mbSupervisor,runStart,runStop,comments])

  const VARIANT_OPTS = ['CON','ORG','RA-CON','RA-ORG']

  return (
    <div className="space-y-5">

      {/* ── Tab switcher ── */}
      <div className="flex gap-1 p-1 bg-stone-100 rounded-xl">
        <button onClick={()=>setActiveTab('bagging')}
          className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${activeTab==='bagging'?'bg-white text-amber-700 shadow-sm':'text-stone-500 hover:text-stone-700'}`}>
          Bagging Station Report
        </button>
        <button onClick={()=>setActiveTab('massbalance')}
          className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors ${activeTab==='massbalance'?'bg-white text-amber-700 shadow-sm':'text-stone-500 hover:text-stone-700'}`}>
          Mass Balance Report
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          TAB 1 — BAGGING STATION REPORT (PR-FM-005.1)
      ══════════════════════════════════════════════════════════════ */}
      {activeTab==='bagging'&&(
        <>
          <Card title="Granule Bagging Station Report — header">
            <div className="grid grid-cols-2 gap-3">
              <F label="Shift"                      value={shift}      onChange={setShift}      opts={['Morning','Afternoon']} disabled={locked}/>
              <F label="Operators"                  value={operators}  onChange={setOperators}  ph="e.g. Dele, Sello"       disabled={locked}/>
              <F label="Supervisor"                 value={supervisor} onChange={setSupervisor} ph="e.g. Sbu"               disabled={locked}/>
              <F label="Lot number"                 value={lotNumber}  onChange={v=>setLotNumber(v.toUpperCase())} ph="e.g. RSFG/RA-02726" disabled={locked}/>
              <F label="Scale — Std weight (kg)"    value={stdWt}      onChange={setStdWt}      type="number" ph="160"      disabled={locked}/>
              <F label="Scale — Actual weight (kg)" value={actualWt}   onChange={setActualWt}   type="number" ph="160"      disabled={locked}/>
            </div>
          </Card>

          <Card title="Bagging" total={totalOutput} variant="output">
            {bagRows.map((r,i)=>(
              <div key={r.id} className="bg-stone-50 border border-stone-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-stone-500">Line {i+1}</span>
                  {bagRows.length>1&&!locked&&<button onClick={()=>setBagRows(rs=>rs.filter((_,j)=>j!==i))} className="text-err/50 hover:text-err"><Trash2 size={13}/></button>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Time"  value={r.time} onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,time:v}:x))} type="time" autoTimeOnFocus={true} disabled={locked}/>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Item</label>
                    <ProductionOrderSelect value={r.item} onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,item:v}:x))} opts={GRAN_ITEMS} disabled={locked} groups={GRAN_ORDER_GROUPS} groupFn={granOrderGroup}/>
                  </div>
                  <F label="Lot number"       value={r.lot_number}     onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,lot_number:v.toUpperCase()}:x))} ph="e.g. RSFG/RA-02726" disabled={locked}/>
                  <F label="Serial no."       value={r.serial_numbers} onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,serial_numbers:v.toUpperCase()}:x))} ph="e.g. 04-05-03" disabled={locked}/>
                  <F label="Bag weight (kg)"  value={r.bag_weights}    onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,bag_weights:v}:x))}   type="number" ph="500" disabled={locked}/>
                  <F label="Total weight (kg)"value={r.total_weight}   onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,total_weight:v}:x))}  type="number" ph="500" disabled={locked}/>
                </div>
              </div>
            ))}
            {!locked&&<AddRow label="Add bagging line" onClick={addBagRow}/>}
          </Card>

          {/* Live totals by granule type */}
          {bagRows.some((r:any)=>parseFloat(r.total_weight)>0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Running totals by type</p>
              {Object.entries(bagRows.reduce((acc:any, r:any) => {
                const t = r.item || 'Unknown'; const kg = parseFloat(r.total_weight)||0
                if (kg===0) return acc
                acc[t] = (acc[t]||0)+kg; return acc
              }, {})).map(([type,kg]:any) => (
                <div key={type} className="flex justify-between text-[11px]">
                  <span className="text-amber-700 font-mono truncate">{type}</span>
                  <span className="font-mono font-bold text-amber-800">{(kg as number).toFixed(1)} kg</span>
                </div>
              ))}
            </div>
          )}

          {/* Auto-computed summary — derived from bagging rows above */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between px-5 py-3 bg-emerald-50 border-b border-emerald-200 rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-5 rounded-full bg-emerald-500"/>
                <span className="font-semibold text-[13px] text-emerald-800">Bagging summary — feeds Acumatica production order</span>
              </div>
              <span className="font-mono font-bold text-[14px] text-emerald-700">{totalOutput.toFixed(1)} kg</span>
            </div>
            <div className="p-4 space-y-2">
              {computedSummary.length === 0 ? (
                <p className="text-[11px] text-stone-400 text-center py-3 italic">
                  Enter items and total weights in the bagging rows above to see the summary.
                </p>
              ) : computedSummary.map(row => {
                const sep = row.item.indexOf(' — ')
                const code = sep !== -1 ? row.item.slice(0, sep) : row.item
                const desc = sep !== -1 ? row.item.slice(sep + 3) : ''
                return (
                  <div key={row.item} className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-[12px] text-emerald-800">{code}</p>
                      {desc && <p className="text-[10px] text-stone-400 truncate">{desc}</p>}
                      {row.lots && <p className="font-mono text-[10px] text-stone-500 mt-0.5">Lot: {row.lots}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono font-bold text-[15px] text-emerald-700">{row.totalKg.toFixed(1)} kg</p>
                      <p className="text-[10px] text-stone-400">{row.bags} bag{row.bags!==1?'s':''}</p>
                    </div>
                  </div>
                )
              })}
              <div className="flex justify-between px-4 py-2.5 bg-emerald-100 border border-emerald-300 rounded-xl">
                <span className="text-[12px] font-semibold text-emerald-700">Total output (C*)</span>
                <span className="font-mono font-bold text-[15px] text-emerald-700">{totalOutput.toFixed(1)} kg</span>
              </div>
            </div>
          </div>

          <Card title="Dust from granule line" variant="info">
            {dustRows.map((r,i)=>(
              <div key={r.id} className="grid grid-cols-3 gap-3 bg-stone-50 border border-stone-200 rounded-xl p-3">
                <F label="Dust type" value={r.dust_type} onChange={v=>setDustRows(rs=>rs.map((x,j)=>j===i?{...x,dust_type:v}:x))} opts={['SG Dust (Brown Dust)','SF Dust (Brown Dust)','Brown Dust','White Dust','Powder Dust','Indent Dust','']} disabled={locked}/>
                <F label="Bags"      value={r.bags}      onChange={v=>setDustRows(rs=>rs.map((x,j)=>j===i?{...x,bags:v}:x))}      type="number" ph="5" disabled={locked}/>
                <F label="Qty (kg)"  value={r.qty_kg}    onChange={v=>setDustRows(rs=>rs.map((x,j)=>j===i?{...x,qty_kg:v}:x))}    type="number" ph="170" disabled={locked}/>
              </div>
            ))}
            {!locked&&<AddRow label="Add dust row" onClick={()=>setDustRows(rs=>[...rs,{id:uid(),dust_type:'',bags:'',qty_kg:''}])}/>}
          </Card>

          <Card title="Waste" variant="info">
            {wasteRows.map((r,i)=>(
              <div key={r.id} className="grid grid-cols-2 gap-3 bg-stone-50 border border-stone-200 rounded-xl p-3">
                <F label="Description" value={r.description} onChange={v=>setWasteRows(rs=>rs.map((x,j)=>j===i?{...x,description:v}:x))} ph="e.g. Floor waste" disabled={locked}/>
                <F label="Waste (kg)"  value={r.kg}          onChange={v=>setWasteRows(rs=>rs.map((x,j)=>j===i?{...x,kg:v}:x))}          type="number" disabled={locked}/>
              </div>
            ))}
            {!locked&&<AddRow label="Add waste row" onClick={()=>setWasteRows(rs=>[...rs,{id:uid(),description:'',kg:''}])}/>}
          </Card>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Comments</label>
            <textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3} disabled={locked}
              className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none"/>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB 2 — PLANT SHIFT MASS BALANCE REPORT (PR-FM-026/7)
      ══════════════════════════════════════════════════════════════ */}
      {activeTab==='massbalance'&&(
        <>
          <Card title="Pellet Mill Feed — Rooibos Granules Plant Shift Mass Balance Report">
            <div className="grid grid-cols-2 gap-3">
              <F label="Run start hours (Y)" value={runStart} onChange={setRunStart} ph="Meter reading" disabled={locked}/>
              <F label="Run stop hours (Z)"  value={runStop}  onChange={setRunStop}  ph="Meter reading" disabled={locked}/>
            </div>
          </Card>

          {/* Blend rows — up to 5 */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between px-5 py-3 bg-amber-50 border-b border-amber-200 rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-5 rounded-full bg-amber-500"/>
                <span className="font-semibold text-[13px] text-amber-800">Pellet Mill Feed — inputs per blend</span>
              </div>
              <span className="font-mono font-bold text-[13px] text-amber-700">{totalMixed.toFixed(1)} kg total</span>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                One row per blend run (up to 5). Each column: weight kg + serial number + variant. Dust Extraction = Powder Dust from Pasteuriser.
              </p>

              {blendRows.map((row, i)=>{
                const blendTotal = GRAN_COLS.reduce((s,c)=>s+num((row as any)[c.key+'_kg']),0) + num(row.water_kg)
                return (
                  <div key={row.id} className="border border-stone-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-stone-50 border-b border-stone-200">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-bold text-stone-600">Blend {i+1} — Mass Balance input row</span>
                        {blendRows.length>1&&!locked&&(
                          <button onClick={()=>setBlendRows(rs=>rs.filter((_,j)=>j!==i))} className="text-err/40 hover:text-err ml-2">
                            <Trash2 size={12}/>
                          </button>
                        )}
                      </div>
                      <span className="font-mono font-bold text-[13px] text-amber-700">{blendTotal.toFixed(1)} kg</span>
                    </div>

                    <div className="p-3 space-y-3">
                      {GRAN_COLS.map(col=>{
                        const kgKey     = `${col.key}_kg`      as keyof GranBlendRow
                        const serialKey = `${col.key}_serial`  as keyof GranBlendRow
                        const lotKey    = `${col.key}_lot`     as keyof GranBlendRow
                        const varKey    = `${col.key}_variant` as keyof GranBlendRow
                        const kg  = num((row as any)[kgKey])
                        const lot = (row as any)[lotKey] as string
                        return (
                          <div key={col.key} className={`rounded-lg border p-3 ${kg>0?'border-amber-200 bg-amber-50':'border-stone-100 bg-stone-50'}`}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[11px] font-semibold text-stone-700">{col.label}</span>
                              {col.acumatica&&<span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase">Acumatica</span>}
                              {'note' in col && col.note&&<span className="text-[10px] text-stone-400">{col.note}</span>}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <input type="text" inputMode="decimal" value={(row as any)[kgKey]}
                                onChange={e=>upBlend(i, kgKey, e.target.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1'))}
                                placeholder="kg" disabled={locked}
                                className={INP}/>
                              <GranuleDustSerialInput
                                serial={(row as any)[serialKey]}
                                kg={(row as any)[kgKey]}
                                onSerialChange={v=>upBlend(i, serialKey, v)}
                                onKgChange={v=>upBlend(i, kgKey, v)}
                                onLotChange={v=>upBlend(i, lotKey, v)}
                                disabled={locked}
                                colVariant={(row as any)[varKey]}
                              />
                              <SearchableSelect value={(row as any)[varKey]} onChange={v=>upBlend(i, varKey, v)} opts={VARIANT_OPTS} disabled={locked}/>
                            </div>
                            {kg>0&&<div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-stone-400 justify-end flex-wrap">
                              <span>{(row as any)[serialKey]||'no serial'}</span>
                              {lot && <span className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">{lot}</span>}
                              <span className="text-brand">{(row as any)[varKey]}</span>
                            </div>}
                          </div>
                        )
                      })}

                      {/* Water column */}
                      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                        <span className="text-[11px] font-semibold text-blue-700 block mb-2">Water</span>
                        <div className="max-w-[120px]">
                          <input type="text" inputMode="decimal" value={row.water_kg}
                            onChange={e=>upBlend(i,'water_kg',e.target.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1'))}
                            placeholder="kg" disabled={locked}
                            className={INP}/>
                        </div>
                      </div>

                      <div className="flex justify-between px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                        <span className="text-[11px] font-semibold text-amber-700">Total Mixed (A) — Blend {i+1}</span>
                        <span className="font-mono font-bold text-[13px] text-amber-700">{blendTotal.toFixed(1)} kg</span>
                      </div>
                    </div>
                  </div>
                )
              })}

              {blendRows.length < 5 && !locked && (
                <button onClick={()=>setBlendRows(rs=>[...rs,blankGranBlendRow(rs.length+1)])}
                  className="w-full py-2.5 border border-dashed border-amber-300 rounded-xl text-[12px] font-medium text-amber-600 hover:bg-amber-50 flex items-center justify-center gap-1.5">
                  <Plus size={13}/> Add blend {blendRows.length+1}
                </button>
              )}

              {/* Column totals — total brown dust, white dust, indent dust etc. across ALL blends */}
              {totalMixed > 0 && (
                <div className="pt-3 border-t border-stone-200 space-y-2">
                  <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Dust type totals (all blends combined)</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {GRAN_COLS.map(col=>{
                      const total = colTotal(col.key as GranColKey)
                      if(total===0) return null
                      return (
                        <div key={col.key} className="flex justify-between px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-[11px]">
                          <span className="text-stone-600">{col.label}</span>
                          <span className="font-mono font-bold text-stone-700">{total.toFixed(1)} kg</span>
                        </div>
                      )
                    })}
                    {/* Water total */}
                    {blendRows.reduce((s,r)=>s+num(r.water_kg),0) > 0 && (
                      <div className="flex justify-between px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-[11px]">
                        <span className="text-blue-600">Water</span>
                        <span className="font-mono font-bold text-blue-700">{blendRows.reduce((s,r)=>s+num(r.water_kg),0).toFixed(1)} kg</span>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                    <span className="text-[12px] font-semibold text-amber-700">Total Mixed (A) — all blends</span>
                    <span className="font-mono font-bold text-[15px] text-amber-700">{totalMixed.toFixed(1)} kg</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Carry-overs and waste */}
          <Card title="Carry-overs and waste" variant="info">
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              D and E are carry-overs that add to the produced total. F is waste.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <F label="Dust from sieve/drier not re-fed (D)" value={carryoverD} onChange={setCarryoverD} type="number" ph="0" disabled={locked}/>
              <F label="Coarse granules not fed to maize master (E)" value={carryoverE} onChange={setCarryoverE} type="number" ph="0" disabled={locked}/>
              <F label="Waste (F)" value={wasteF} onChange={setWasteF} type="number" ph="0" disabled={locked}/>
            </div>
          </Card>

          {/* Mass balance */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
            <div className="flex items-center gap-2.5 px-5 py-3 bg-emerald-50 border-b border-emerald-200 rounded-t-2xl">
              <div className="w-1 h-5 rounded-full bg-emerald-500"/>
              <span className="font-semibold text-[13px] text-emerald-800">Mass balance</span>
            </div>
            <div className="p-4 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {[
                  {label:'Total produced (G) = C*+D+E+F', value:totalProducedG, color:'text-emerald-700', bg:'bg-emerald-50 border-emerald-200'},
                  {label:'Total raw material (H = A)',      value:totalRawH,      color:'text-amber-700',   bg:'bg-amber-50 border-amber-200'},
                  {label:'Balance (H − G)',                 value:balanceFG,      color:Math.abs(balanceFG)<=30?'text-ok':'text-warn', bg:Math.abs(balanceFG)<=30?'bg-ok/5 border-ok/30':'bg-warn/5 border-warn/30'},
                  {label:'Yield % (G / H)',                 value:yieldPct+'%',   color:'text-emerald-700', bg:'bg-emerald-50 border-emerald-200', isString:true},
                ].map(col=>(
                  <div key={col.label} className={`flex flex-col px-3 py-3 rounded-xl border text-center ${col.bg}`}>
                    <span className={`font-mono font-bold text-[20px] ${col.color}`}>
                      {(col as any).isString ? col.value : typeof col.value === 'number' ? `${col.value.toFixed(1)} kg` : col.value}
                    </span>
                    <span className="text-[10px] text-stone-400 mt-1">{col.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <Card title="Report completed by" variant="info">
            <div className="grid grid-cols-2 gap-3">
              <F label="Operator name (print)" value={mbOperator}   onChange={setMbOperator}   ph="Full name" disabled={locked}/>
              <F label="Supervisor name (print)" value={mbSupervisor} onChange={setMbSupervisor} ph="Full name" disabled={locked}/>
            </div>
          </Card>
        </>
      )}

    </div>
  )
}

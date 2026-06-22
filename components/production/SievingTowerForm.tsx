'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import * as React from 'react'
import { format } from 'date-fns'
import { Plus, Trash2, ChevronDown, Loader2, Scale, AlertTriangle, PenLine, Lock, Search, X } from 'lucide-react'
import { uid, num, INP, F, Card, AddRow, SearchableSelect, CONV_OPTS, LOC_EXP_OPTS, ProductionOrderSelect } from '@/components/production/shared/ui'
import { useSerialLookup, markBagConsumed, advanceToNextSerial, variantFamily } from '@/lib/production/scan-utils'
import BagScanner from '@/components/production/BagScanner'
import type { ScanResult } from '@/components/production/BagScanner'
import { printBagLabel, printBagLabels } from '@/lib/qr/print'
import { nextSerial } from '@/lib/qr/serial'
import { normaliseVariant, variantSuffix } from '@/lib/constants/manufacturing'
import { getDb } from '@/lib/supabase/db'

// ══════════════════════════════════════════════════════════════════════════════
// SIEVING TOWER
// ══════════════════════════════════════════════════════════════════════════════
export type LeafBag        = { id:string; time:string; kg:string; batch:string; serial:string; qc:string; qc_signed:boolean; qc_name:string; qc_at:string }
export type UntrackedEntry = { id:string; time:string; kg:string; serial:string; lot:string; variant:string; product_type:string; qc:string; qc_signed:boolean; qc_name:string; qc_at:string }

export interface LeafStreamProps {
  label:string; color:string; borderColor:string; bgColor:string
  bags:LeafBag[]; locked:boolean
  onAddBag:()=>void
  onUpdate:(i:number, k:keyof LeafBag, v:string)=>void
  onRemove:(i:number)=>void
  onPrint:(serial:string, type:string, batch:string, kg:string, qc:string)=>void
  onPrintAll?:(bags:LeafBag[], type:string)=>void
  qcName?:string
  qcRegistered?:boolean
  onQcSign?:(bagIdx:number)=>void
}

// ── QCSignatureBar — one registration per bagging session ────────────────────
// QC person types their name and draws ONE signature here.
// Then they tap "QC ✓" on each individual bag as it's sealed.
// The drawn signature proves identity; the per-bag tap is the actual sign-off.
export function QCSignatureBar({
  qcName, qcSigned, onNameChange, onSign, onClear, locked
}: {
  qcName: string; qcSigned: boolean
  onNameChange: (v:string) => void
  onSign: (data:string) => void
  onClear: () => void
  locked: boolean
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const drawing   = React.useRef(false)
  const [hasSig, setHasSig] = React.useState(false)
  const [open, setOpen]     = React.useState(false)

  function getPos(e: MouseEvent|TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const src = 'touches' in e ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }
  function startDraw(e: any) {
    if (locked || qcSigned) return
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const pos = getPos(e.nativeEvent ?? e, canvasRef.current!)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault?.()
  }
  function draw(e: any) {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1C1917'
    const pos = getPos(e.nativeEvent ?? e, canvasRef.current!)
    ctx.lineTo(pos.x, pos.y); ctx.stroke(); setHasSig(true); e.preventDefault?.()
  }
  function stopDraw() { drawing.current = false }
  function clear() {
    canvasRef.current!.getContext('2d')!.clearRect(0, 0, 600, 100)
    setHasSig(false)
  }
  function confirm() {
    onSign(canvasRef.current!.toDataURL())
    setOpen(false)
  }

  if (locked) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"/>
        <span className="font-semibold text-[12px] text-amber-800">QC Sign-off Station</span>
        {qcSigned ? (
          <span className="font-mono text-[11px] text-ok font-bold ml-1">
            ✓ {qcName} registered — tap QC ✓ on each bag
          </span>
        ) : (
          <span className="font-mono text-[10px] text-amber-600 ml-1">
            Register QC person before signing bags
          </span>
        )}
        {qcSigned && !locked && (
          <button onClick={()=>{onClear();setHasSig(false)}}
            className="ml-auto text-[10px] text-amber-600 hover:text-err border border-amber-200 px-2 py-1 rounded-lg">
            Change QC
          </button>
        )}
        {!qcSigned && (
          <button onClick={()=>setOpen(o=>!o)}
            className="ml-auto text-[11px] font-semibold text-amber-700 border border-amber-300 bg-white px-3 py-1.5 rounded-lg hover:bg-amber-100">
            {open ? 'Cancel' : 'Register QC person'}
          </button>
        )}
      </div>

      {open && !qcSigned && (
        <div className="border-t border-amber-200 px-4 pb-3 pt-3 space-y-3 bg-white">
          <input
            type="text"
            value={qcName}
            onChange={e => onNameChange(e.target.value)}
            placeholder="QC person full name"
            className="w-full px-3 py-2 rounded-lg border border-amber-200 text-[13px] font-semibold outline-none focus:border-amber-400"
          />
          <p className="text-[10px] text-stone-400">Sign below to confirm your identity for this bagging run. You only need to sign once — then tap QC ✓ on each bag.</p>
          <div className="rounded-xl border-2 border-amber-200 overflow-hidden">
            <canvas
              ref={canvasRef} width={600} height={100}
              className="w-full touch-none cursor-crosshair block"
              style={{height:100}}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
            />
            <div className="flex justify-between items-center px-3 py-2 border-t border-amber-200 bg-amber-50">
              <span className="text-[10px] text-amber-600">Sign above to register</span>
              <div className="flex gap-2">
                {hasSig && <button onClick={clear} className="text-[11px] text-stone-500 border border-stone-200 px-2.5 py-1 rounded-lg hover:bg-stone-50">Clear</button>}
                {hasSig && qcName.trim() && (
                  <button onClick={confirm} className="text-[11px] font-bold text-white bg-amber-500 px-3 py-1 rounded-lg hover:bg-amber-600">
                    Confirm — Register
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function LeafStream({ label, color, borderColor, bgColor, bags, locked, onAddBag, onUpdate, onRemove, onPrint, onPrintAll, qcName, qcRegistered, onQcSign }: LeafStreamProps) {
  const total = bags.reduce((s,b) => s+num(b.kg), 0)
  return (
    <div className={`rounded-2xl border overflow-hidden ${borderColor} ${bgColor}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${color.replace('text-','bg-')}`}/>
          <span className={`font-semibold text-[13px] ${color}`}>{label}</span>
          <span className={`font-mono text-[11px] ${color} opacity-60`}>{bags.length} bag{bags.length!==1?'s':''}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono font-bold text-[15px] ${color}`}>{total.toFixed(1)} kg</span>
          {bags.length > 0 && bags.some(b=>b.serial&&b.kg) && (
            <button
              onClick={()=>onPrintAll?.(bags, label)}
              title="Print all labels for this stream"
              className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border ${borderColor} ${color} hover:opacity-70 flex items-center gap-1`}>
              🖨 All
            </button>
          )}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {bags.length > 0 && (
          <div className="space-y-1.5">
            {bags.map((b,i) => (
              <div key={b.id} className="space-y-1.5 bg-white rounded-xl px-2 py-2 border border-stone-100">
                {/* Row 1: number badge + time + kg + batch — wraps on mobile */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-stone-400 w-5 text-center flex-shrink-0">{i+1}</span>
                  <input type="time" value={b.time} onChange={e=>onUpdate(i,'time',e.target.value)} disabled={locked} className={`${INP} w-24 flex-shrink-0`}/>
                  <input type="text" inputMode="decimal" value={b.kg} onChange={e=>onUpdate(i,'kg',e.target.value)} placeholder="kg" disabled={locked} className={`${INP} w-20 flex-shrink-0`}/>
                  <input type="text" value={b.batch} onChange={e=>onUpdate(i,'batch',e.target.value.toUpperCase())} placeholder="Batch / Lot" disabled={locked} className={`${INP} flex-1 min-w-[120px]`}/>
                </div>
                {/* Row 2: serial (generated) + QC initials + print button + remove */}
                <div className="flex items-center gap-2 pl-7">
                  <span className={`font-mono text-[11px] font-bold px-2 py-1 rounded-lg border whitespace-nowrap ${b.serial ? color+' border-current bg-white' : 'text-stone-400 border-stone-200 bg-stone-50'}`}>
                    {b.serial || 'no serial'}
                  </span>
                  {/* QC sign-off — tap to sign, shows registered QC name */}
                  {qcRegistered && onQcSign ? (
                    <button
                      onClick={()=>!b.qc_signed&&onQcSign(i)}
                      disabled={locked}
                      title={b.qc_signed ? `QC signed by ${b.qc_name} at ${b.qc_at}` : `Tap to sign as ${qcName}`}
                      className={`px-3 py-1 rounded-lg border-2 font-mono text-[10px] font-bold transition-all ${b.qc_signed ? 'border-ok/60 bg-ok/10 text-ok cursor-default' : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 cursor-pointer'}`}>
                      {b.qc_signed ? `✓ ${b.qc_name}` : `QC ✓`}
                    </button>
                  ) : (
                    <input
                      type="text"
                      value={b.qc||''}
                      onChange={e=>onUpdate(i,'qc',e.target.value.toUpperCase())}
                      placeholder="QC initials"
                      disabled={locked}
                      title="QC initials — or register QC person above for digital sign-off"
                      className="w-24 px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-mono text-amber-800 outline-none focus:border-amber-400 disabled:opacity-40 text-center"
                    />
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    {b.serial && b.kg && !locked && (
                      <button
                        onClick={()=>onPrint(b.serial, label, b.batch, b.kg, b.qc_name || b.qc || '')}
                        title={b.qc ? 'Print label' : 'Print label (no QC initials yet)'}
                        className={`text-[11px] font-bold px-3 py-1.5 rounded-xl border-2 flex items-center gap-1.5 transition-all ${b.qc ? `${borderColor} ${color} hover:opacity-80` : 'border-stone-200 text-stone-400 hover:border-amber-300 hover:text-amber-600'}`}>
                        🖨 Print
                      </button>
                    )}
                    {bags.length > 1 && !locked && (
                      <button onClick={()=>onRemove(i)} className="text-err/30 hover:text-err p-1"><Trash2 size={12}/></button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!locked && (
          <button onClick={onAddBag}
            className={`w-full py-3 rounded-xl border-2 border-dashed ${borderColor} ${color} font-semibold text-[13px] hover:opacity-70 transition-opacity flex items-center justify-center gap-2`}>
            <Plus size={15}/> Add {label} bag
          </button>
        )}
        {bags.length === 0 && locked && <p className="text-[11px] text-stone-400 text-center py-2">No bags recorded</p>}
      </div>
    </div>
  )
}

interface UntrackedStreamProps {
  label:string; entries:UntrackedEntry[]; total:number; locked:boolean
  onUpdate:(i:number, k:keyof UntrackedEntry | string, v:string)=>void
  onAdd:()=>void
  onRemove:(i:number)=>void
  onPrint?:(serial:string, type:string, batch:string, kg:string, qc:string)=>void
  qcName?:string
  qcRegistered?:boolean
  onQcSign?:(idx:number)=>void
}

// ── UntrackedSerialInput — serial field with bag_tags auto-lookup ─────────────
// When a serial matching DD-MM-NN is scanned/typed, queries bag_tags and
// auto-fills weight, lot, variant, and product_type from the tag record.
// This makes ALL Sieving secondary outputs (dust, sticks, blocks) fully
// scannable as inputs at Refining, Blender, and Granule Line.
const UntrackedSerialInput = React.memo(function UntrackedSerialInput({
  serial, kg, onSerialChange, onKgChange, onLotChange, onVariantChange, onProductTypeChange, disabled, sectionOrigin,
}: {
  serial: string; kg: string
  onSerialChange:      (v: string) => void
  onKgChange:          (v: string) => void
  onLotChange?:        (v: string) => void
  onVariantChange?:    (v: string) => void
  onProductTypeChange?:(v: string) => void
  disabled: boolean
  sectionOrigin?: string
}) {
  const [lookupDone, setLookupDone] = React.useState(false)

  const inputRef = React.useRef<HTMLInputElement | null>(null)
  useSerialLookup(serial, React.useCallback((result) => {
    if (result.weight_kg && !kg)  onKgChange(result.weight_kg)
    if (result.lot_number)        onLotChange?.(result.lot_number)
    if (result.variant)           onVariantChange?.(result.variant)
    if (result.product_type)      onProductTypeChange?.(result.product_type)
    setLookupDone(true)
    markBagConsumed(serial, sectionOrigin || 'sieving', null, parseFloat(result.weight_kg) || undefined)
    advanceToNextSerial(inputRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial, kg, onKgChange, onLotChange, onVariantChange, onProductTypeChange, sectionOrigin]))

  return (
    <div className="relative w-36">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none text-[13px] leading-none select-none">▐▌</span>
      <input
        ref={inputRef}
        type="text"
        data-serial="true"
        value={serial}
        onChange={e => { onSerialChange(e.target.value.toUpperCase()); setLookupDone(false) }}
        placeholder="Scan or type serial"
        disabled={disabled}
        className={"w-full pl-7 pr-2 py-1.5 rounded-lg border-2 bg-white text-[11px] font-mono text-text outline-none focus:border-brand disabled:opacity-40 transition-all " + (lookupDone ? 'border-ok/60 bg-ok/5' : 'border-blue-300 bg-blue-50/30')}
      />
      {lookupDone && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ok text-[13px] font-bold">✓</span>
      )}
    </div>
  )
})


function UntrackedStream({ label, entries, total, locked, onUpdate, onAdd, onRemove, onPrint, qcName, qcRegistered, onQcSign, showSerial = false }: UntrackedStreamProps & { showSerial?: boolean }) {
  return (
    <div className="px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[12px] font-semibold text-stone-600">{label}</p>
        <span className="font-mono text-[11px] font-bold text-stone-500 ml-auto">{total.toFixed(1)} kg</span>
      </div>
      <div className="space-y-1.5">
        {entries.map((e,i) => (
          <div key={e.id} className="bg-white rounded-xl p-2 border border-stone-200 space-y-1.5">
            {/* Row 1: time + serial + kg — wraps naturally on mobile */}
            <div className="flex flex-wrap items-center gap-1.5">
              <input type="time" value={e.time||''}
                onChange={ev=>onUpdate(i,'time',ev.target.value)}
                onFocus={ev=>{if(!e.time)onUpdate(i,'time',format(new Date(),'HH:mm'))}}
                disabled={locked}
                className="w-24 min-h-[44px] px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-[11px] font-mono text-text outline-none focus:border-brand disabled:opacity-40"/>
              {showSerial && (
                <UntrackedSerialInput
                  serial={e.serial}
                  kg={e.kg}
                  onSerialChange={v  => onUpdate(i, 'serial',       v)}
                  onKgChange={v      => onUpdate(i, 'kg',           v)}
                  onLotChange={v     => onUpdate(i, 'lot',          v)}
                  onVariantChange={v => onUpdate(i, 'variant',      v)}
                  onProductTypeChange={v => onUpdate(i, 'product_type', v)}
                  disabled={locked}
                  sectionOrigin="sieving"
                />
              )}
              <input type="text" inputMode="decimal" value={e.kg}
                onChange={ev=>onUpdate(i,'kg',ev.target.value.replace(/[^0-9.]/g,'').replace(/(\.*\.).*/g,'$1'))}
                placeholder="kg" disabled={locked}
                className="flex-1 min-w-[80px] min-h-[44px] px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] text-text outline-none focus:border-brand disabled:opacity-40"/>
            </div>
            {/* Row 1b: lot / variant badges — filled by scanner */}
            {showSerial && (e.lot || e.variant) && (
              <div className="flex flex-wrap items-center gap-1.5 pl-1 pt-0.5">
                {e.lot && (
                  <span className="font-mono text-[10px] bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded border border-stone-200">
                    {e.lot}
                  </span>
                )}
                {e.variant && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${e.variant.includes('ORG') || e.variant.includes('Org') ? 'bg-ok/10 text-ok border border-ok/20' : 'bg-brand/10 text-brand border border-brand/20'}`}>
                    {e.variant}
                  </span>
                )}
                {e.product_type && e.product_type !== label && (
                  <span className="text-[10px] text-stone-400 italic">{e.product_type}</span>
                )}
              </div>
            )}
            {/* Row 2: QC initials + print + remove — only for serial-tracked bags */}
            {showSerial && (
              <div className="flex items-center gap-2 pl-1">
                {qcRegistered && onQcSign ? (
                  <button
                    onClick={()=>!e.qc_signed && onQcSign(i)}
                    disabled={locked}
                    title={e.qc_signed ? `QC signed by ${e.qc_name} at ${e.qc_at}` : `Tap to QC sign as ${qcName}`}
                    className={`px-3 py-1 rounded-lg border-2 font-mono text-[10px] font-bold transition-all ${e.qc_signed ? 'border-ok/60 bg-ok/10 text-ok cursor-default' : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 cursor-pointer'}`}>
                    {e.qc_signed ? `✓ ${e.qc_name}` : `QC ✓`}
                  </button>
                ) : (
                  <input
                    type="text"
                    value={e.qc||''}
                    onChange={ev=>onUpdate(i,'qc',ev.target.value.toUpperCase())}
                    placeholder="QC initials"
                    disabled={locked}
                    className="w-24 px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-mono text-amber-800 outline-none focus:border-amber-400 disabled:opacity-40 text-center"
                  />
                )}
                <div className="ml-auto flex items-center gap-1">
                  {e.serial && e.kg && !locked && onPrint && (
                    <button
                      onClick={()=>onPrint(e.serial, e.product_type||label, e.lot||'', e.kg, e.qc_name||e.qc||'')}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border-2 flex items-center gap-1 transition-all ${e.qc ? 'border-stone-700 text-stone-700 hover:opacity-80' : 'border-stone-200 text-stone-400 hover:border-amber-300 hover:text-amber-600'}`}>
                      🖨 Print
                    </button>
                  )}
                  {entries.length > 1 && !locked && (
                    <button onClick={()=>onRemove(i)} className="text-err/30 hover:text-err p-1"><Trash2 size={11}/></button>
                  )}
                </div>
              </div>
            )}
            {!showSerial && entries.length > 1 && !locked && (
              <div className="flex justify-end">
                <button onClick={()=>onRemove(i)} className="text-err/30 hover:text-err p-1"><Trash2 size={11}/></button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!locked && (
        <button onClick={onAdd}
          className="mt-1.5 w-8 h-8 rounded-lg border border-dashed border-stone-300 text-stone-400 hover:border-brand hover:text-brand flex items-center justify-center transition-colors">
          <Plus size={13}/>
        </button>
      )}
    </div>
  )
}

type DebagRow = { id:string; delivery_date:string; bag_number:string; lot_serial:string; local_export:string; org_conv:string; mass_gross:string; mass_nett:string }
type BucketIn = { lot_serial:string; local_export:string; org_conv:string; mass_nett:string }

// Stable wrapper for BagScanner to prevent infinite re-render
// BagScanner's internal useEffect([], []) triggers parent re-renders which
// cause remounts — wrapping in memo breaks the cycle
const StableBagScanner = React.memo(function StableBagScanner(props: React.ComponentProps<typeof BagScanner>) {
  return <BagScanner {...props}/>
})

export function SievingForm({ locked, onData, shift, sessionId, savedData, dateParam }: {
  locked:boolean; onData:(d:any)=>void; shift:string; sessionId:string|null; savedData?:any; dateParam:string
}) {
  const todayStr    = format(new Date(),'yyyy-MM-dd')

  const [shiftOps,       setShiftOps]       = useState(()=>savedData?.shiftOps??'')
  const [sieve12,        setSieve12]        = useState(()=>savedData?.sieve12??true)
  const [sieve18,        setSieve18]        = useState(()=>savedData?.sieve18??true)
  const [sieve40,        setSieve40]        = useState(()=>savedData?.sieve40??true)
  const [stdWt,          setStdWt]          = useState(()=>savedData?.stdWt??'160')
  const [actualWt,       setActualWt]       = useState(()=>savedData?.actualWt??'160')
  const [bucketIn,       setBucketIn]       = useState<BucketIn>(()=>savedData?.bucketIn??{lot_serial:'',local_export:'Export',org_conv:'CON',mass_nett:''})
  const [spillageKg,     setSpillageKg]     = useState(()=>savedData?.spillageKg??'')
  const [spillageBatch,  setSpillageBatch]  = useState(()=>savedData?.spillageBatch??'')
  const [debag,          setDebag]          = useState<DebagRow[]>(()=>savedData?.debag??[{id:uid(),delivery_date:todayStr,bag_number:'',lot_serial:'',local_export:'Export',org_conv:'CON',mass_gross:'',mass_nett:''}])
  const [flBags,         setFlBags]         = useState<LeafBag[]>(()=>savedData?.flBags??[])
  const [clBags,         setClBags]         = useState<LeafBag[]>(()=>savedData?.clBags??[])
  const [rbEntries,      setRbEntries]      = useState<UntrackedEntry[]>(()=>savedData?.rbEntries??[{id:uid(),time:'',kg:'',serial:'',lot:'',variant:'',product_type:'RB Blocks',qc:'',qc_signed:false,qc_name:'',qc_at:''}])
  const [dustEntries,    setDustEntries]    = useState<UntrackedEntry[]>(()=>savedData?.dustEntries??[{id:uid(),time:'',kg:'',serial:'',lot:'',variant:'',product_type:'Brown Dust',qc:'',qc_signed:false,qc_name:'',qc_at:''}])
  const [rolsievEntries, setRolsievEntries] = useState<UntrackedEntry[]>(()=>savedData?.rolsievEntries??[{id:uid(),time:'',kg:'',serial:'',lot:'',variant:'',product_type:'Rolsiev Sticks',qc:'',qc_signed:false,qc_name:'',qc_at:''}])
  const [indentEntries,  setIndentEntries]  = useState<UntrackedEntry[]>(()=>savedData?.indentEntries??[{id:uid(),time:'',kg:'',serial:'',lot:'',variant:'',product_type:'Indent Sticks',qc:'',qc_signed:false,qc_name:'',qc_at:''}])
  const [bucketOutKg,    setBucketOutKg]    = useState(()=>savedData?.bucketOutKg??'')
  const [bucketOutTime,  setBucketOutTime]  = useState(()=>savedData?.bucketOutTime??'')
  const [indentSpeed,    setIndentSpeed]    = useState(()=>savedData?.indentSpeed??'95')
  const [indentAngle,    setIndentAngle]    = useState(()=>savedData?.indentAngle??'-4')
  const [dustExtraction, setDustExtraction] = useState(()=>savedData?.dustExtraction??'')
  const [floorWaste,     setFloorWaste]     = useState(()=>savedData?.floorWaste??'')
  const [cleaningWaste,  setCleaningWaste]  = useState(()=>savedData?.cleaningWaste??'')
  const [checkedBy,      setCheckedBy]      = useState(()=>savedData?.checkedBy??'')
  const [prodOrderId,    setProdOrderId]    = useState(()=>savedData?.prodOrderId??'')
  const [comments,       setComments]       = useState(()=>savedData?.comments??'')
  // ── QC sign-off state — shared across all output streams ────────────────
  const [qcName,        setQcName]        = useState(()=>savedData?.qcName??'')
  const [qcSigData,     setQcSigData]     = useState(()=>savedData?.qcSigData??'')
  const qcRegistered = !!qcSigData
  const SIEV_PROD_ORDERS = [
    '','S10LGBL-C — Sieved Leaf: Export Blend - Conventional',
    'S10LGBL-O — Sieved Leaf: Export Blend - Organic',
    'S10LGBL-RC — Sieved Leaf: Export Blend - RA Conventional',
    'S10LGBL-RO — Sieved Leaf: Export Blend - RA Organic',
    'S10LGD-C — Sieved Leaf Domestic - Conventional',
    'S10LGD-O — Sieved Leaf Domestic - Organic',
    'S10LGD-RC — Sieved Leaf Domestic - RA Conventional',
    'S10LGD-RO — Sieved Leaf Domestic - RA Organic',
    'S10LGE-C — Sieved Leaf: Export - Conventional',
    'S10LGE-O — Sieved Leaf: Export - Organic',
    'S10LGE-RC — Sieved Leaf: Export - RA Conventional',
    'S10LGE-RO — Sieved Leaf: Export - RA Organic',
  ]

  const bucketInNett   = num(bucketIn.mass_nett)
  const spillNett      = num(spillageKg)
  const debagTotal     = debag.reduce((s,r)=>s+num(r.mass_nett),0)
  const totalA         = debagTotal - bucketInNett - spillNett
  const totalFL        = flBags.reduce((s,b)=>s+num(b.kg),0)
  const totalCL        = clBags.reduce((s,b)=>s+num(b.kg),0)
  const totalRB        = rbEntries.reduce((s,e)=>s+num(e.kg),0)
  const totalDust      = dustEntries.reduce((s,e)=>s+num(e.kg),0)
  const totalRolsiev   = rolsievEntries.reduce((s,e)=>s+num(e.kg),0)
  const totalIndent    = indentEntries.reduce((s,e)=>s+num(e.kg),0)
  const totalBucketOut = num(bucketOutKg)
  const totalOut       = totalFL+totalCL+totalRB+totalDust+totalRolsiev+totalIndent+totalBucketOut
  const variance       = totalA - totalOut
  const withinTol      = Math.abs(variance) <= 15

  function addDebagRow() {
    const prev = debag[debag.length-1]
    setDebag(rs=>[...rs,{id:uid(),delivery_date:prev?.delivery_date??todayStr,bag_number:'',lot_serial:prev?.lot_serial??'',local_export:prev?.local_export??'Export',org_conv:prev?.org_conv??'CON',mass_gross:prev?.mass_gross??'',mass_nett:prev?.mass_nett??''}])
  }
  function upD(i:number,k:keyof DebagRow,v:string){setDebag(rs=>rs.map((r,j)=>j===i?{...r,[k]:k==='lot_serial'?v.toUpperCase():v}:r))}
  const updateDebagRow = React.useCallback((id:string, patch:any) => {
    setDebag(rs=>rs.map(r=>r.id===id?{...r,...patch}:r))
  }, [])
  const removeDebagRow = React.useCallback((id:string) => {
    setDebag(rs=>rs.filter(r=>r.id!==id))
  }, [])

  function addLeafBag(bags:LeafBag[],setBags:React.Dispatch<React.SetStateAction<LeafBag[]>>){
    const prev=bags[bags.length-1]
    const existingSerials=bags.map(b=>b.serial)
    const serial=nextSerial(new Date(),existingSerials)
    setBags(bs=>[...bs,{id:uid(),time:format(new Date(),'HH:mm'),kg:'',batch:prev?.batch??'',serial,qc:'',qc_signed:false,qc_name:'',qc_at:''}])
  }

  function printLabel(serial:string, type:string, batch:string, kg:string, qcInitials='') {
    // Use the actual variant + local/export from the first debagging input row,
    // not a hardcoded default — this is what drives the badge on the tag.
    const variant     = debag[0]?.org_conv     || 'CON'
    const localExport = debag[0]?.local_export || 'Export'
    const tagDate     = dateParam || format(new Date(), 'yyyy-MM-dd')

    printBagLabel({
      serial,
      productType:  type,
      sectionName:  'Sieving Tower',
      lotNumber:    batch || 'NOT TRACKED',
      weightKg:     kg,
      variant,
      localExport,
      date:         tagDate,
      qcInitials,
    })

    // Immediately upsert to bag_tags so the bag is scannable by other sections
    // (blender, pasteuriser) even before this sieving session is saved as a draft.
    if (serial && serial !== 'NOT TRACKED') {
      getDb().schema('production').from('bag_tags').upsert({
        serial_number:   serial,
        product_type:    type,
        lot_number:      batch || 'NOT TRACKED',
        weight_kg:       parseFloat(kg) || null,
        variant,
        local_export:    localExport,
        section_id:      'sieving',
        section_name:    'Sieving Tower',
        tag_date:        tagDate,
        prod_session_id: sessionId || null,
        captured_at:     new Date().toISOString(),
      } as any, { onConflict: 'serial_number' }).catch(() => {})
    }
  }

  // Print all Fine Leaf or Coarse Leaf bags for the session at once
  function printAllBags(bags: typeof flBags, productType: string) {
    const variant     = debag[0]?.org_conv     || 'CON'
    const localExport = debag[0]?.local_export || 'Export'
    const tagDate     = dateParam || format(new Date(), 'yyyy-MM-dd')

    const labels = bags
      .filter((b:any) => b.serial && parseFloat(b.kg) > 0)
      .map((b:any) => ({
        serial:      b.serial,
        productType,
        sectionName: 'Sieving Tower',
        lotNumber:   b.batch || 'NOT TRACKED',
        weightKg:    b.kg,
        variant,
        localExport,
        date:        tagDate,
        qcInitials:  b.qc_name || '',
      }))
    printBagLabels(labels)

    // Immediately upsert all printed bags to bag_tags
    const upsertRows = labels.map((l:any) => ({
      serial_number:   l.serial,
      product_type:    l.productType,
      lot_number:      l.lotNumber || 'NOT TRACKED',
      weight_kg:       parseFloat(l.weightKg) || null,
      variant,
      local_export:    localExport,
      section_id:      'sieving',
      section_name:    'Sieving Tower',
      tag_date:        tagDate,
      prod_session_id: sessionId || null,
      captured_at:     new Date().toISOString(),
    }))
    if (upsertRows.length > 0) {
      getDb().schema('production').from('bag_tags')
        .upsert(upsertRows as any, { onConflict: 'serial_number' })
        .catch(() => {})
    }
  }

  useEffect(()=>{
    onData({shiftOps,sieve12,sieve18,sieve40,stdWt,actualWt,bucketIn,spillageKg,spillageBatch,debag,flBags,clBags,rbEntries,dustEntries,rolsievEntries,indentEntries,bucketOutKg,bucketOutTime,totalA,totalOut,totalFL,totalCL,totalRB,totalDust,totalRolsiev,totalIndent,totalBucketOut,variance,indentSpeed,indentAngle,dustExtraction,floorWaste,cleaningWaste,checkedBy,prodOrderId,qcName,qcSigData,comments})
  },[debag,bucketIn,spillageKg,spillageBatch,flBags,clBags,rbEntries,dustEntries,rolsievEntries,indentEntries,bucketOutKg,bucketOutTime,shiftOps,checkedBy,stdWt,actualWt,indentSpeed,indentAngle,dustExtraction,floorWaste,cleaningWaste,prodOrderId,qcName,qcSigData,comments,sieve12,sieve18,sieve40])

  return (
    <div className="space-y-5">
      <Card title="Session header">
        <div className="grid grid-cols-1 gap-3">
          <F label={shift === 'morning' ? 'Morning shift operators' : 'Afternoon / Night shift operators'} value={shiftOps} onChange={setShiftOps} ph={shift === 'morning' ? 'e.g. Grant, Ayena' : 'e.g. Musa, Lubabalo'} disabled={locked}/>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Production order (Inventory ID)</label>
            <ProductionOrderSelect value={prodOrderId} onChange={setProdOrderId} opts={SIEV_PROD_ORDERS} disabled={locked}/>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">Sieve configuration (Maxi Sifter)</label>
            <span className="text-[10px] text-stone-400">Pre-checked — uncheck if different</span>
          </div>
          <div className="flex gap-5">
            {([['12H',sieve12,setSieve12],['18H',sieve18,setSieve18],['40H',sieve40,setSieve40]] as any[]).map(([lbl,val,set])=>(
              <label key={lbl} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={val} onChange={(e:any)=>set(e.target.checked)} disabled={locked} className="w-4 h-4 accent-brand"/>
                <span className="font-mono text-[13px] text-text">{lbl}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <F label="Scale — Std weight (kg)"    value={stdWt}    onChange={setStdWt}    type="number" ph="160" disabled={locked}/>
          <F label="Scale — Actual weight (kg)" value={actualWt} onChange={setActualWt} type="number" ph="160" disabled={locked}/>
        </div>
      </Card>

      <div className="bg-red-50 border border-red-200 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-red-200 rounded-t-2xl">
          <div className="w-1 h-5 rounded-full bg-red-400"/>
          <span className="font-semibold text-[13px] text-red-700">Bucket Elevator</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <F label="Lot / Batch / Serial" value={bucketIn.lot_serial} onChange={v=>setBucketIn(b=>({...b,lot_serial:v.toUpperCase()}))} ph="e.g. GS-0267" disabled={locked}/>
          <F label="Local or Export"      value={bucketIn.local_export} onChange={v=>setBucketIn(b=>({...b,local_export:v}))} opts={LOC_EXP_OPTS} disabled={locked}/>
          <F label="ORG or CON"           value={bucketIn.org_conv} onChange={v=>setBucketIn(b=>({...b,org_conv:v}))} opts={['CON','ORG','RA-CON','RA-ORG']} disabled={locked}/>
          <F label="Nett weight (kg)"     value={bucketIn.mass_nett} onChange={v=>setBucketIn(b=>({...b,mass_nett:v}))} type="number" ph="38" disabled={locked}/>
        </div>
        {bucketInNett>0&&<div className="px-5 pb-3"><span className="font-mono text-[12px] font-bold text-red-600">− {bucketInNett.toFixed(1)} kg subtracted from Total A</span></div>}
      </div>

      {/* BUG FIX 2: Machine Spillage now has a Batch / Lot field */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-amber-200 rounded-t-2xl">
          <div className="w-1 h-5 rounded-full bg-amber-400"/>
          <span className="font-semibold text-[13px] text-amber-700">Machine Spillages — subtracted from Total A</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3 max-w-xs">
          <F label="Batch / Lot" value={spillageBatch} onChange={setSpillageBatch} ph="Machine Spillage" disabled={locked}/>
          <F label="Spillage (kg)" value={spillageKg} onChange={setSpillageKg} type="number" ph="0" disabled={locked}/>
        </div>
      </div>

      <Card title="Debagging" variant="input">
        <p className="text-[11px] text-sky-600 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
          Delivery date, lot, local/export, ORG/CON, gross and nett weights carry over on add — all fields remain editable.
        </p>
        <div className="space-y-2">
          {debag.map((row,i)=>{
            const sessionVariantForSieving = debag[0]?.org_conv || null
            return (
            <SievingDebagBagRow
              key={row.id}
              row={row}
              idx={i}
              locked={locked}
              sessionId={sessionId}
              sessionVariant={sessionVariantForSieving}
              onUpdate={updateDebagRow}
              onRemove={removeDebagRow}
              canRemove={debag.length>1}
            />
            )
          })}
        </div>
        {!locked&&<button onClick={addDebagRow} className="w-full py-2.5 border border-dashed border-stone-300 rounded-xl text-[12px] font-medium text-stone-400 hover:border-brand hover:text-brand hover:bg-brand/5 transition-all flex items-center justify-center gap-1.5"><Plus size={13}/> Add bag</button>}
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-[12px]"><span className="text-stone-500">Raw bags total</span><span className="font-mono font-bold text-stone-700">{debagTotal.toFixed(1)} kg</span></div>
          {bucketInNett>0&&<div className="flex justify-between px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-[12px]"><span className="text-red-600">− Bucket Elevator carry-over</span><span className="font-mono font-bold text-red-600">{bucketInNett.toFixed(1)} kg</span></div>}
          {spillNett>0&&<div className="flex justify-between px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[12px]"><span className="text-amber-600">− Machine Spillages</span><span className="font-mono font-bold text-amber-600">{spillNett.toFixed(1)} kg</span></div>}
          <div className="flex justify-between px-4 py-3 bg-sky-50 border border-sky-200 rounded-xl"><span className="text-[12px] font-semibold text-sky-600">Total A</span><span className="font-mono font-bold text-[15px] text-sky-700">{totalA.toFixed(1)} kg</span></div>
        </div>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-1 h-5 rounded-full bg-emerald-500"/>
          <span className="font-semibold text-[13px] text-stone-800">Bagging — outputs</span>
          <span className="text-[11px] text-stone-400">Each bag has its own editable batch number — carries from previous bag</span>
        </div>

        {/* QC Sign-off Station — register QC person once, then tap per bag */}
        <QCSignatureBar
          qcName={qcName}
          qcSigned={qcRegistered}
          onNameChange={setQcName}
          onSign={setQcSigData}
          onClear={()=>{setQcSigData('');setQcName('')}}
          locked={locked}
        />

        <LeafStream label="Fine Leaf" color="text-emerald-700" borderColor="border-emerald-200" bgColor="bg-emerald-50" bags={flBags} locked={locked}
          onAddBag={()=>addLeafBag(flBags,setFlBags)}
          onUpdate={(i,k,v)=>setFlBags(bs=>bs.map((b,j)=>j===i?{...b,[k]:v}:b))}
          onRemove={i=>setFlBags(bs=>bs.filter((_,j)=>j!==i))}
          onPrint={printLabel}
          onPrintAll={printAllBags}
          qcName={qcName}
          qcRegistered={qcRegistered}
          onQcSign={i=>setFlBags(bs=>bs.map((b,j)=>j===i?{...b,qc_signed:true,qc_name:qcName,qc_at:format(new Date(),'HH:mm dd-MM-yy'),qc:qcName}:b))}/>
        <LeafStream label="Coarse Leaf" color="text-teal-700" borderColor="border-teal-200" bgColor="bg-teal-50" bags={clBags} locked={locked}
          onAddBag={()=>addLeafBag(clBags,setClBags)}
          onUpdate={(i,k,v)=>setClBags(bs=>bs.map((b,j)=>j===i?{...b,[k]:v}:b))}
          onRemove={i=>setClBags(bs=>bs.filter((_,j)=>j!==i))}
          onPrint={printLabel}
          onPrintAll={printAllBags}
          qcName={qcName}
          qcRegistered={qcRegistered}
          onQcSign={i=>setClBags(bs=>bs.map((b,j)=>j===i?{...b,qc_signed:true,qc_name:qcName,qc_at:format(new Date(),'HH:mm dd-MM-yy'),qc:qcName}:b))}/>

        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-stone-100 bg-stone-50 rounded-t-2xl">
            <div className="w-1 h-5 rounded-full bg-stone-300"/>
            <span className="font-semibold text-[13px] text-stone-600">Other outputs</span>
            <span className="font-mono text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase ml-1">Serial tracked</span>
          </div>
          <div className="p-3 space-y-2">
            <UntrackedStream label="RB Blocks" showSerial={true} entries={rbEntries}      total={totalRB}      locked={locked} onUpdate={(i,k,v)=>setRbEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))}      onAdd={()=>setRbEntries(es=>[...es,{id:uid(),time:'',kg:'',serial:'',lot:debag[0]?.lot_serial??'',variant:debag[0]?.org_conv??'',product_type:'RB Blocks',qc:'',qc_signed:false,qc_name:'',qc_at:''}])}      onRemove={i=>setRbEntries(es=>es.filter((_,j)=>j!==i))} onPrint={printLabel} qcName={qcName} qcRegistered={qcRegistered} onQcSign={i=>setRbEntries(es=>es.map((x,j)=>j===i?{...x,qc_signed:true,qc_name:qcName,qc_at:format(new Date(),"HH:mm dd-MM-yy"),qc:qcName}:x))}/>
            <UntrackedStream label="Brown Dust" showSerial={true} entries={dustEntries}    total={totalDust}    locked={locked} onUpdate={(i,k,v)=>setDustEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))}    onAdd={()=>setDustEntries(es=>[...es,{id:uid(),time:'',kg:'',serial:'',lot:debag[0]?.lot_serial??'',variant:debag[0]?.org_conv??'',product_type:'Brown Dust',qc:'',qc_signed:false,qc_name:'',qc_at:''}])}    onRemove={i=>setDustEntries(es=>es.filter((_,j)=>j!==i))} onPrint={printLabel} qcName={qcName} qcRegistered={qcRegistered} onQcSign={i=>setDustEntries(es=>es.map((x,j)=>j===i?{...x,qc_signed:true,qc_name:qcName,qc_at:format(new Date(),"HH:mm dd-MM-yy"),qc:qcName}:x))}/>
            <UntrackedStream label="Rolsiev Sticks" showSerial={true} entries={rolsievEntries} total={totalRolsiev} locked={locked} onUpdate={(i,k,v)=>setRolsievEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))} onAdd={()=>setRolsievEntries(es=>[...es,{id:uid(),time:'',kg:'',serial:'',lot:debag[0]?.lot_serial??'',variant:debag[0]?.org_conv??'',product_type:'Rolsiev Sticks',qc:'',qc_signed:false,qc_name:'',qc_at:''}])} onRemove={i=>setRolsievEntries(es=>es.filter((_,j)=>j!==i))} onPrint={printLabel} qcName={qcName} qcRegistered={qcRegistered} onQcSign={i=>setRolsievEntries(es=>es.map((x,j)=>j===i?{...x,qc_signed:true,qc_name:qcName,qc_at:format(new Date(),"HH:mm dd-MM-yy"),qc:qcName}:x))}/>
            <UntrackedStream label="Indent Sticks" showSerial={true} entries={indentEntries}  total={totalIndent}  locked={locked} onUpdate={(i,k,v)=>setIndentEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))}  onAdd={()=>setIndentEntries(es=>[...es,{id:uid(),time:'',kg:'',serial:'',lot:debag[0]?.lot_serial??'',variant:debag[0]?.org_conv??'',product_type:'Indent Sticks',qc:'',qc_signed:false,qc_name:'',qc_at:''}])}  onRemove={i=>setIndentEntries(es=>es.filter((_,j)=>j!==i))} onPrint={printLabel} qcName={qcName} qcRegistered={qcRegistered} onQcSign={i=>setIndentEntries(es=>es.map((x,j)=>j===i?{...x,qc_signed:true,qc_name:qcName,qc_at:format(new Date(),"HH:mm dd-MM-yy"),qc:qcName}:x))}/>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-2xl shadow-sm">
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-orange-200 rounded-t-2xl">
            <div className="w-1 h-5 rounded-full bg-orange-400"/>
            <span className="font-semibold text-[13px] text-orange-700">Bucket Elevator</span>
          </div>
          <div className="p-4 flex gap-3 max-w-xs">
            <F label="Time" value={bucketOutTime} onChange={setBucketOutTime} type="time" autoTimeOnFocus={true} disabled={locked}/>
            <F label="Weight (kg)" value={bucketOutKg} onChange={setBucketOutKg} type="number" ph="0" disabled={locked}/>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-stone-100 bg-stone-50 rounded-t-2xl">
          <div className="w-1 h-5 rounded-full bg-emerald-500"/>
          <span className="font-semibold text-[13px] text-stone-800">Output totals</span>
        </div>
        <div className="p-4 space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            {[['Fine Leaf',totalFL,'text-emerald-700','bg-emerald-50 border-emerald-100'],['Coarse Leaf',totalCL,'text-teal-700','bg-teal-50 border-teal-100'],['RB Blocks',totalRB,'text-stone-600','bg-stone-50 border-stone-100'],['Brown Dust',totalDust,'text-stone-500','bg-stone-50 border-stone-100'],['Rolsiev Sticks',totalRolsiev,'text-stone-500','bg-stone-50 border-stone-100'],['Indent Sticks',totalIndent,'text-stone-500','bg-stone-50 border-stone-100'],['Bucket Elev. out',totalBucketOut,'text-orange-600','bg-orange-50 border-orange-100']].map(([l,v,tc,bg]:any)=>(
              <div key={l} className={`flex justify-between px-3 py-2 rounded-lg border text-[11px] ${bg}`}><span className={tc}>{l}</span><span className={`font-mono font-bold ${tc}`}>{(v as number).toFixed(1)} kg</span></div>
            ))}
          </div>
          <div className="flex justify-between px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <span className="text-[12px] font-semibold text-emerald-600">Total output</span>
            <span className="font-mono font-bold text-[15px] text-emerald-700">{totalOut.toFixed(1)} kg</span>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl p-5 border-2 ${withinTol?'border-ok/30 bg-ok/5':'border-warn/40 bg-warn/5'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Scale size={16} className={withinTol?'text-ok':'text-warn'}/>
          <span className="font-semibold text-[14px] text-text">Mass balance</span>
          {!withinTol&&<AlertTriangle size={14} className="text-warn ml-auto"/>}
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[{label:'Total A (input)',value:`${totalA.toFixed(1)} kg`,color:'text-text'},{label:'Total output',value:`${totalOut.toFixed(1)} kg`,color:'text-text'},{label:'Variance',value:`${Math.abs(variance).toFixed(1)} kg`,color:withinTol?'text-ok':'text-warn'}].map(col=>(
            <div key={col.label}><div className={`font-mono font-bold text-[22px] ${col.color}`}>{col.value}</div><div className="text-[10px] text-text-muted mt-1">{col.label}</div></div>
          ))}
        </div>
        {!withinTol&&<p className="text-[11px] text-warn mt-3 text-center">Variance exceeds 15 kg tolerance — review before submitting</p>}
      </div>

      <Card title="Footer & settings" variant="info">
        <div className="grid grid-cols-2 gap-3">
          <F label="Top Indent screen speed"          value={indentSpeed}    onChange={setIndentSpeed}    type="number" ph="95"  disabled={locked}/>
          <F label="Top Indent screen angle"          value={indentAngle}    onChange={setIndentAngle}    type="number" ph="-4"  disabled={locked}/>
          <F label="Powder Dust — Extraction (kg)"             value={dustExtraction} onChange={setDustExtraction} type="number" ph="0"   disabled={locked}/>
          <F label="Floor waste (kg)"                 value={floorWaste}     onChange={setFloorWaste}     type="number" ph="0"   disabled={locked}/>
          <F label="Cleaning / Purge waste (org, kg)" value={cleaningWaste}  onChange={setCleaningWaste}  type="number" ph="0"   disabled={locked}/>
          <F label="Report checked by"                value={checkedBy}      onChange={setCheckedBy}      ph="Name"              disabled={locked}/>
        </div>
      </Card>
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-stone-300"/>
          <label className="text-[12px] font-semibold text-stone-700">Shift comments</label>
          <span className="text-[10px] text-stone-400">— sent to production admins on save</span>
        </div>
        <textarea value={comments} onChange={e=>setComments(e.target.value)} rows={3} disabled={locked}
          placeholder="Any issues, observations, or notes for this shift…"
          className="w-full px-4 py-3 rounded-xl border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand resize-none disabled:opacity-40"/>
      </div>
    </div>
  )
}

// ── DebagBagRow — isolates BagScanner from the parent map() re-render ─────────
// BagScanner has useEffect([], []) that calls setCameraSupp on mount.
// If BagScanner remounts on every parent render (because onConfirm is a new
// arrow function from .map()), it loops forever. This component stabilises
// onConfirm via useCallback so BagScanner never remounts unnecessarily.
// SievingDebagRow matches the existing DebagRow type exactly
type SievingDebagRow = DebagRow
export const SievingDebagBagRow = React.memo(function SievingDebagBagRow({
  row, idx, locked, sessionId, sessionVariant, onUpdate, onRemove, canRemove,
}: {
  row: SievingDebagRow; idx: number; locked: boolean; sessionId: string|null
  sessionVariant?: string | null
  onUpdate: (id:string, patch:Partial<SievingDebagRow>) => void
  onRemove: (id:string) => void; canRemove: boolean
}) {
  const onConfirm = React.useCallback((result: ScanResult) => {
    onUpdate(row.id, {
      lot_serial:    result.lot_number    || row.lot_serial,
      bag_number:    result.serial_number || row.bag_number,
      org_conv:      result.variant       || row.org_conv,
      mass_nett:     result.weight_kg     || row.mass_nett,
      delivery_date: result.tag_date      || row.delivery_date,
    })
    if (result.serial_number)
      markBagConsumed(result.serial_number, 'sieving', sessionId, parseFloat(result.weight_kg||'0')||undefined)
  // row.id is stable per row; other deps are functions/refs that don't change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, sessionId, onUpdate])

  return (
    <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[11px] font-semibold text-stone-400">Bag {idx+1}</span>
        <div className="flex items-center gap-2">
          {!locked && <BagScanner rowLabel={`Debagging bag ${idx+1}`} sessionId={sessionId} sessionVariant={sessionVariant} blockFinishedProducts={true} onConfirm={onConfirm}/>}
          {canRemove && !locked && (
            <button onClick={()=>onRemove(row.id)} className="text-err/40 hover:text-err"><Trash2 size={13}/></button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <F label="Delivery date"        value={row.delivery_date} onChange={v=>onUpdate(row.id,{delivery_date:v})} type="date" disabled={locked}/>
        <F label="Bag number"           value={row.bag_number}    onChange={v=>onUpdate(row.id,{bag_number:v})}    ph="G-383"   disabled={locked}/>
        <F label="Lot / Batch / Serial" value={row.lot_serial}    onChange={v=>onUpdate(row.id,{lot_serial:v})}    ph="GS-0267" disabled={locked}/>
        <F label="Local or Export"      value={row.local_export}  onChange={v=>onUpdate(row.id,{local_export:v})}  opts={LOC_EXP_OPTS} disabled={locked}/>
        <F label="ORG or CON"           value={row.org_conv}      onChange={v=>onUpdate(row.id,{org_conv:v})}      opts={['CON','ORG','RA-CON','RA-ORG','']} disabled={locked}/>
        <F label="Mass gross (kg)"      value={row.mass_gross}    onChange={v=>onUpdate(row.id,{mass_gross:v})}    type="number" disabled={locked}/>
        <F label="Nett weight (kg)"     value={row.mass_nett}     onChange={v=>onUpdate(row.id,{mass_nett:v})}     type="number" disabled={locked}/>
      </div>
    </div>
  )
})

// ── BagLookupModal — browse available in-stock bags by type + variant ─────────
// Opens from any debagging row. Operator taps a row → serial fills the input.
export function BagLookupModal({
  sectionId, sessionVariant, onSelect, onClose,
}: {
  sectionId: string
  sessionVariant?: string
  onSelect: (serial: string, kg: string) => void
  onClose: () => void
}) {
  const [bags,    setBags]    = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search,  setSearch]  = React.useState('')

  React.useEffect(() => {
    setLoading(true)
    let q = getDb().schema('production').from('bag_tags')
      .select('serial_number,product_type,lot_number,weight_kg,variant,section_id,section_name,tag_date')
      .is('consumed_at_section', null)
      .order('captured_at', { ascending: false })
      .limit(200)

    // Filter by variant family if session variant is set
    const fam = sessionVariant ? variantFamily(sessionVariant) : null
    if (fam === 'conventional') {
      q = q.in('variant', ['Conventional', 'RA-Conventional'])
    } else if (fam === 'organic') {
      q = q.in('variant', ['Organic', 'RA-Organic', 'FT-ORG'])
    }

    q.then(({ data }: any) => {
      setBags((data as any[]) || [])
      setLoading(false)
    })
  }, [sessionVariant])

  const filtered = React.useMemo(() => {
    if (!search.trim()) return bags
    const s = search.toLowerCase()
    return bags.filter(b =>
      b.serial_number?.toLowerCase().includes(s) ||
      b.product_type?.toLowerCase().includes(s) ||
      b.lot_number?.toLowerCase().includes(s)
    )
  }, [bags, search])

  const PILL: Record<string, string> = {
    sieving:'bg-blue-100 text-blue-700', refining1:'bg-emerald-100 text-emerald-700',
    refining2:'bg-emerald-100 text-emerald-700', granule:'bg-amber-100 text-amber-700',
    blender:'bg-purple-100 text-purple-700', pasteuriser:'bg-red-100 text-red-700',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-stone-200 flex-shrink-0">
          <div className="flex-1">
            <h3 className="font-semibold text-[15px] text-stone-900">Browse available bags</h3>
            <p className="text-[11px] text-stone-400 mt-0.5">
              {sessionVariant ? `Showing ${variantFamily(sessionVariant) === 'organic' ? 'organic' : 'conventional'} bags only` : 'All in-stock bags'}
              {' · '}{loading ? '…' : `${filtered.length} bags`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
            <X size={16}/>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-stone-100 flex-shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter by serial, product type, or lot…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-200 text-[12px] outline-none focus:border-brand"/>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="font-mono text-[12px] text-stone-400 animate-pulse">Loading bags…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <p className="font-mono text-[13px] text-stone-400">No bags found</p>
              <p className="text-[11px] text-stone-300 mt-1">
                {sessionVariant ? `No in-stock ${variantFamily(sessionVariant)} bags available` : 'No in-stock bags found'}
              </p>
            </div>
          ) : filtered.map(b => (
            <button key={b.serial_number}
              onClick={() => { onSelect(b.serial_number, b.weight_kg ? String(b.weight_kg) : ''); onClose() }}
              className="w-full flex items-center gap-3 px-4 py-3 bg-stone-50 hover:bg-brand/5 hover:border-brand/30 border border-stone-200 rounded-xl transition-all text-left">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-mono font-bold text-[13px] text-stone-900 tracking-wider">{b.serial_number}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${PILL[b.section_id]??'bg-stone-100 text-stone-500'}`}>
                    {b.section_name || b.section_id}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-stone-500 flex-wrap">
                  <span className="font-semibold text-stone-700">{b.product_type}</span>
                  {b.lot_number && b.lot_number !== 'NOT TRACKED' && <><span>·</span><span className="font-mono">{b.lot_number}</span></>}
                  {b.weight_kg && <><span>·</span><span className="font-mono font-bold text-stone-700">{b.weight_kg} kg</span></>}
                  {b.variant && <><span>·</span><span className="font-mono text-brand">{b.variant}</span></>}
                </div>
              </div>
              <ChevronDown size={14} className="text-stone-300 rotate-[-90deg] flex-shrink-0"/>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Stable module-level wrapper for SievingForm ───────────────────────────────
// MUST be at module level (not inline) to preserve referential stability
// across renders. Inline arrow functions cause BagScanner's useEffect infinite loop.
export function SievingFormWrapper({ locked, onData, savedData, shift, sessionId, dateParam }: {
  locked:boolean; onData:(d:any)=>void; savedData?:any
  shift?:string; sessionId?:string|null; dateParam?:string
}) {
  return (
    <SievingForm
      locked={locked}
      onData={onData}
      savedData={savedData}
      shift={shift || 'Morning'}
      sessionId={sessionId || null}
      dateParam={dateParam || format(new Date(), 'yyyy-MM-dd')}
    />
  )
}

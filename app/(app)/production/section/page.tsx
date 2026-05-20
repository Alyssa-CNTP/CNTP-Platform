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

// AcumaticaSummary is defined inline below
import { useState, useEffect, useRef, Suspense } from 'react'
import * as React from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO } from 'date-fns'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Plus, Trash2, CheckCircle2, AlertTriangle, Scale,
  ChevronLeft, ChevronDown, Loader2, Clock, Coffee, UtensilsCrossed,
  ArrowLeftRight, LogIn, LogOut, ClipboardList, Sparkles,
  PenLine, Lock, RotateCcw,
} from 'lucide-react'

import TagCapture from '@/components/production/TagCapture'
import type { TagCaptureResult } from '@/components/production/TagCapture'
import BagScanner from '@/components/production/BagScanner'
import type { ScanResult } from '@/components/production/BagScanner'
import { printBagLabel } from '@/lib/qr/print'
import { nextSerial, nextBlendSerial } from '@/lib/qr/serial'

function uid() { return crypto.randomUUID() }
function num(v: string) { return parseFloat(v) || 0 }
function nowTime() { return format(new Date(), 'HH:mm') }

// Auto-detect shift: morning 07:00–15:59, afternoon 16:00–00:59
function detectShift(): 'Morning' | 'Afternoon' {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'Morning' : 'Afternoon'
}

const CONV_OPTS    = ['CON', 'ORG', 'RA-CON', 'RA-ORG']
const LOC_EXP_OPTS = ['Export', 'Export Blend', 'Domestic/Local', '']

// Numeric keyboard component for tablet use
function NumKeyboard({ onKey, onClose }: { onKey:(k:string)=>void; onClose:()=>void }) {
  const keys = ['7','8','9','4','5','6','1','2','3','0','.','⌫']
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20" onClick={onClose}>
      <div className="bg-white border border-stone-200 rounded-t-2xl shadow-xl p-3 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Numeric Keyboard</span>
          <button onClick={onClose} className="text-[12px] text-brand font-bold px-3 py-1 rounded-lg bg-brand/10">Done</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {keys.map(k=>(
            <button key={k} onClick={()=>onKey(k)}
              className={`py-4 rounded-xl font-mono font-bold text-[20px] transition-colors ${k==='⌫'?'bg-err/10 text-err hover:bg-err/20':k==='.'?'bg-stone-100 text-stone-600 hover:bg-stone-200':'bg-stone-50 text-stone-800 hover:bg-brand/10 hover:text-brand border border-stone-200'}`}>
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Hook: numeric input that opens keyboard on tablet
function useNumericField(initial: string) {
  const [value, setValue] = React.useState(initial)
  const [open, setOpen] = React.useState(false)
  function handleKey(k: string) {
    setValue(prev => {
      if (k === '⌫') return prev.slice(0,-1)
      if (k === '.' && prev.includes('.')) return prev
      return prev + k
    })
  }
  return { value, setValue, open, setOpen, handleKey }
}

const INP = `w-full px-3 py-2.5 rounded-lg border bg-white text-[13px] text-text outline-none transition-all
  border-stone-200 focus:border-brand focus:ring-2 focus:ring-brand/10
  disabled:opacity-40 disabled:bg-stone-50 disabled:cursor-not-allowed`


// ── Searchable select (combobox) — replaces native <select> for long lists ───
function SearchableSelect({ value, onChange, opts, disabled, ph = 'Search or select…' }: {
  value: string; onChange: (v:string) => void; opts: string[]
  disabled?: boolean; ph?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? opts.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : opts

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const displayVal = value || ''

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { if (!disabled) setOpen(o => !o) }}
        className={INP + ' flex items-center justify-between cursor-pointer pr-8 ' + (disabled ? 'opacity-40 cursor-not-allowed' : '')}>
        <span className={displayVal ? 'text-text' : 'text-stone-400'}>
          {displayVal || ph}
        </span>
        <ChevronDown size={13} className="absolute right-2.5 text-stone-400 pointer-events-none"/>
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-stone-100">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] outline-none focus:border-brand"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-3 text-[12px] text-stone-400 italic">No match</div>
            )}
            {filtered.map((o, i) => (
              <div key={i} onClick={() => { onChange(o); setOpen(false); setQuery('') }}
                className={`px-4 py-2.5 text-[12px] cursor-pointer hover:bg-brand/5 hover:text-brand transition-colors ${o === value ? 'bg-brand/8 text-brand font-semibold' : 'text-stone-700'} ${o === '' ? 'text-stone-300 italic' : ''}`}>
                {o === '' ? '— clear —' : o}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


function F({
  label, value, onChange, type = 'text', opts, ph = '', disabled = false, wide = false, autoTimeOnFocus = false,
}: {
  label: string; value: string; onChange?: (v: string) => void
  type?: string; opts?: string[]; ph?: string; disabled?: boolean; wide?: boolean; autoTimeOnFocus?: boolean
}) {
  const isNum = type === 'number'
  const resolvedType      = isNum ? 'text' : type
  const resolvedInputMode = isNum ? ('decimal' as const) : undefined
  function handleChange(raw: string) {
    if (!onChange) return
    if (isNum) {
      const cleaned = raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
      onChange(cleaned)
    } else {
      onChange(raw)
    }
  }
  function handleFocus() {
    if (autoTimeOnFocus && onChange && !value) {
      onChange(format(new Date(), 'HH:mm'))
    }
  }
  return (
    <div className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">{label}</label>
      {opts
        ? <SearchableSelect value={value} onChange={v => onChange?.(v)} opts={opts} disabled={disabled}/>
        : <input type={resolvedType} inputMode={resolvedInputMode} value={value}
            onChange={e => handleChange(e.target.value)}
            onFocus={handleFocus}
            placeholder={ph} disabled={disabled} className={INP}/>
      }
    </div>
  )
}

function Card({ title, total, children, variant = 'default' }: {
  title: string; total?: number; children: React.ReactNode
  variant?: 'default' | 'input' | 'output' | 'info'
}) {
  const hc = { default:'bg-stone-50 border-stone-200', input:'bg-sky-50 border-sky-200', output:'bg-emerald-50 border-emerald-200', info:'bg-amber-50 border-amber-200' }[variant]
  const ab = { default:'bg-stone-300', input:'bg-sky-400', output:'bg-emerald-500', info:'bg-amber-400' }[variant]
  const tc = { default:'text-stone-700', input:'text-sky-700', output:'text-emerald-700', info:'text-amber-700' }[variant]
  return (
    <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
      <div className={`flex items-center justify-between px-5 py-3 border-b ${hc}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-1 h-5 rounded-full ${ab}`}/>
          <span className="font-semibold text-[13px] text-stone-800 tracking-tight">{title}</span>
        </div>
        {total !== undefined && <span className={`font-mono font-bold text-[14px] ${tc}`}>{total.toFixed(1)} kg</span>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full py-2.5 border border-dashed border-stone-300 rounded-xl text-[12px] font-medium text-stone-400 hover:border-brand hover:text-brand hover:bg-brand/5 transition-all flex items-center justify-center gap-1.5">
      <Plus size={13}/> {label}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TIMESHEET TAB — persists to localStorage, auto-starts, survives tab switching
// ══════════════════════════════════════════════════════════════════════════════
type TsEventType = 'clock_in'|'tea_start'|'tea_end'|'lunch_start'|'lunch_end'|'changeover'|'clock_out'|'note'
type TsEvent = { id:string; type:TsEventType; time:string; iso:string; note?:string }

function TimesheetTab({ locked, sectionId, dateParam, shift }: {
  locked:boolean; sectionId:string; dateParam:string; shift:string
}) {
  const storageKey = `cntp_ts_${sectionId}_${dateParam}_${shift}`

  const [events, setEvents] = useState<TsEvent[]>(() => {
    try { const s = localStorage.getItem(storageKey); if (s) return JSON.parse(s) } catch {}
    return []
  })
  const [note, setNote] = useState('')

  // Auto clock-in on first mount if no clock-in exists
  useEffect(() => {
    if (locked) return
    setEvents(prev => {
      if (prev.some(e => e.type === 'clock_in')) return prev
      const autoIn: TsEvent = {
        id: uid(), type: 'clock_in', time: nowTime(),
        iso: new Date().toISOString(), note: 'Auto-logged on form open',
      }
      return [autoIn]
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist on every change
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(events)) } catch {}
  }, [events, storageKey])

  const hasIn   = events.some(e => e.type === 'clock_in')
  const hasOut  = events.some(e => e.type === 'clock_out')
  const inTea   = events.filter(e => e.type === 'tea_start').length > events.filter(e => e.type === 'tea_end').length
  const inLunch = events.some(e => e.type === 'lunch_start') && !events.some(e => e.type === 'lunch_end')

  function log(type: TsEventType) {
    const ev: TsEvent = { id: uid(), type, time: nowTime(), iso: new Date().toISOString(), note: note.trim() || undefined }
    setEvents(prev => [...prev, ev])
    setNote('')
  }

  const productive = (() => {
    const ci = events.find(e => e.type === 'clock_in'); if (!ci) return null
    const co = events.find(e => e.type === 'clock_out')
    let mins = (new Date(co?.iso ?? new Date()).getTime() - new Date(ci.iso).getTime()) / 60000
    events.filter(e => e.type === 'tea_start').forEach((s, i) => {
      const end = events.filter(e => e.type === 'tea_end')[i]
      if (end) mins -= (new Date(end.iso).getTime() - new Date(s.iso).getTime()) / 60000
    })
    const ls = events.find(e => e.type === 'lunch_start'), le = events.find(e => e.type === 'lunch_end')
    if (ls && le) mins -= (new Date(le.iso).getTime() - new Date(ls.iso).getTime()) / 60000
    return Math.max(0, Math.round(mins))
  })()

  const EV_CFG: Record<TsEventType, { label:string; pill:string; icon:React.ReactNode }> = {
    clock_in:    { label:'Clock in',           pill:'bg-ok/10 text-ok border-ok/30',           icon:<LogIn size={13}/>           },
    clock_out:   { label:'Clock out',          pill:'bg-err/10 text-err border-err/30',         icon:<LogOut size={13}/>          },
    tea_start:   { label:'Tea break start',    pill:'bg-info/10 text-info border-info/30',      icon:<Coffee size={13}/>          },
    tea_end:     { label:'Tea break end',      pill:'bg-info/10 text-info border-info/30',      icon:<Coffee size={13}/>          },
    lunch_start: { label:'Lunch start',        pill:'bg-warn/10 text-warn border-warn/30',      icon:<UtensilsCrossed size={13}/> },
    lunch_end:   { label:'Lunch end',          pill:'bg-warn/10 text-warn border-warn/30',      icon:<UtensilsCrossed size={13}/> },
    changeover:  { label:'Section changeover', pill:'bg-surface text-text border-surface-rule', icon:<ArrowLeftRight size={13}/>  },
    note:        { label:'Note',               pill:'bg-stone-100 text-stone-600 border-stone-200', icon:<span className="text-[10px]">📝</span> },
  }

  return (
    <div className="space-y-4">
      {hasIn && (
        <div className="rounded-2xl bg-brand/5 border border-brand/20 px-5 py-4 flex items-center justify-between">
          <div>
            <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide block">Productive time</span>
            <span className="font-display font-bold text-[26px] text-brand">
              {productive !== null ? `${Math.floor(productive/60)}h ${productive%60}m` : '—'}
            </span>
          </div>
          <div className="text-right text-[11px] font-mono text-text-muted space-y-0.5">
            <div>{events.find(e=>e.type==='clock_in')?.time} → {hasOut ? events.find(e=>e.type==='clock_out')?.time : 'ongoing'}</div>
            {inTea   && <div className="text-info font-semibold">☕ On tea break</div>}
            {inLunch && <div className="text-warn font-semibold">🍽 At lunch</div>}
          </div>
        </div>
      )}
      {hasIn && events[0]?.note?.includes('Auto-logged') && (
        <div className="flex items-center gap-2 px-3 py-2 bg-ok/5 border border-ok/20 rounded-xl">
          <CheckCircle2 size={12} className="text-ok"/>
          <p className="text-[11px] text-ok">Shift auto-started at {events[0].time} when you opened this form.</p>
        </div>
      )}
      {!locked && (
        <div className="space-y-1">
          <label className="font-mono text-[10px] text-text-muted uppercase tracking-wide">Note (optional — attaches to next event)</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Feed belt jammed briefly"
            className="w-full px-3 py-2.5 rounded-xl border border-surface-rule bg-surface font-body text-[13px] text-text outline-none focus:border-brand"/>
        </div>
      )}
      {!locked && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => log(inTea ? 'tea_end' : 'tea_start')}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl border font-bold text-[14px] transition-colors ${
              inTea ? 'border-info/60 bg-info text-white' : 'border-info/40 bg-info/10 text-info'
            }`}>
            <Coffee size={15}/>{inTea ? 'End tea break' : 'Tea break'}
          </button>
          <button onClick={() => log(inLunch ? 'lunch_end' : 'lunch_start')}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl border font-bold text-[14px] transition-colors ${
              inLunch ? 'border-warn/60 bg-warn text-white' : 'border-warn/40 bg-warn/10 text-warn'
            }`}>
            <UtensilsCrossed size={15}/>{inLunch ? 'End lunch' : 'Lunch'}
          </button>
          <button onClick={() => log('changeover')}
            className="flex items-center justify-center gap-2 py-3 rounded-xl border border-surface-rule bg-surface font-medium text-[13px] text-text hover:bg-stone-50 transition-colors">
            <ArrowLeftRight size={14}/> Changeover
          </button>
          {note.trim() && (
            <button onClick={() => log('note')}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-stone-50 font-medium text-[13px] text-stone-600 hover:bg-stone-100 transition-colors">
              📝 Log note
            </button>
          )}
          {hasIn && !hasOut && (
            <button onClick={() => log('clock_out')}
              className="col-span-2 flex items-center justify-center gap-2 py-4 rounded-2xl border border-err/40 bg-err/10 text-err font-bold text-[15px] hover:bg-err/20 transition-colors">
              <LogOut size={16}/> Clock out — end shift
            </button>
          )}
        </div>
      )}
      {events.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide">Event log — {events.length} events</p>
            {!locked && (
              <button
                onClick={() => { if (confirm('Clear all timesheet events for this shift?')) { setEvents([]); localStorage.removeItem(storageKey) } }}
                className="font-mono text-[10px] text-stone-400 hover:text-err transition-colors">
                Clear all
              </button>
            )}
          </div>
          {events.map(ev => {
            const cfg = EV_CFG[ev.type]
            return (
              <div key={ev.id}>
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cfg.pill}`}>
                  {cfg.icon}
                  <span className="font-display font-bold text-[13px] flex-1">{cfg.label}</span>
                  <span className="font-mono text-[12px]">{ev.time}</span>
                  {!locked && <button onClick={() => setEvents(es => es.filter(x => x.id !== ev.id))} className="opacity-40 hover:opacity-100"><Trash2 size={12}/></button>}
                </div>
                {ev.note && <p className="font-mono text-[10px] text-text-faint ml-12 mt-0.5">{ev.note}</p>}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-12">
          <Clock size={36} className="mx-auto mb-3 text-text-faint opacity-30"/>
          <p className="font-mono text-[12px] text-text-faint">Timesheet auto-starts when you open this form</p>
        </div>
      )}
      {hasIn && hasOut && (
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 space-y-2">
          <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wide">Shift summary</p>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="flex justify-between"><span className="text-stone-500">Clock in</span><span className="font-mono">{events.find(e=>e.type==='clock_in')?.time}</span></div>
            <div className="flex justify-between"><span className="text-stone-500">Clock out</span><span className="font-mono">{events.find(e=>e.type==='clock_out')?.time}</span></div>
            <div className="flex justify-between col-span-2">
              <span className="text-stone-500">Productive time</span>
              <span className="font-mono font-bold text-brand">{productive !== null ? `${Math.floor(productive/60)}h ${productive%60}m` : '—'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SIEVING TOWER
// ══════════════════════════════════════════════════════════════════════════════
type LeafBag        = { id:string; time:string; kg:string; batch:string; serial:string }
type UntrackedEntry = { id:string; kg:string; serial:string }

interface LeafStreamProps {
  label:string; color:string; borderColor:string; bgColor:string
  bags:LeafBag[]; locked:boolean
  onAddBag:()=>void
  onUpdate:(i:number, k:keyof LeafBag, v:string)=>void
  onRemove:(i:number)=>void
  onPrint:(serial:string, type:string, batch:string, kg:string)=>void
}
function LeafStream({ label, color, borderColor, bgColor, bags, locked, onAddBag, onUpdate, onRemove, onPrint }: LeafStreamProps) {
  const total = bags.reduce((s,b) => s+num(b.kg), 0)
  return (
    <div className={`rounded-2xl border overflow-hidden ${borderColor} ${bgColor}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${color.replace('text-','bg-')}`}/>
          <span className={`font-semibold text-[13px] ${color}`}>{label}</span>
          <span className={`font-mono text-[11px] ${color} opacity-60`}>{bags.length} bags</span>
        </div>
        <span className={`font-mono font-bold text-[15px] ${color}`}>{total.toFixed(1)} kg</span>
      </div>
      <div className="p-3 space-y-2">
        {bags.length > 0 && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[28px_1fr_1fr_1fr_auto_auto] gap-1.5 px-1">
              {['#','Time','Weight (kg)','Batch no.','Serial',''].map(h=>(
                <span key={h} className="text-[9px] font-bold text-stone-400 uppercase">{h}</span>
              ))}
            </div>
            {bags.map((b,i) => (
              <div key={b.id} className="grid grid-cols-[28px_1fr_1fr_1fr_auto_auto] gap-1.5 items-center bg-white rounded-xl px-2 py-1.5 border border-stone-100">
                <span className="font-mono text-[11px] text-stone-400 text-center">{i+1}</span>
                <input type="time" value={b.time} onChange={e=>onUpdate(i,'time',e.target.value)} disabled={locked} className={INP}/>
                <input type="text" inputMode="decimal" value={b.kg} onChange={e=>onUpdate(i,'kg',e.target.value)} placeholder="300" disabled={locked} className={INP}/>
                <input type="text" value={b.batch} onChange={e=>onUpdate(i,'batch',e.target.value.toUpperCase())} placeholder="GS-0266" disabled={locked} className={INP}/>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[9px] text-stone-400 bg-stone-100 border border-stone-200 px-1.5 py-1 rounded whitespace-nowrap">{b.serial}</span>
                  {b.kg && b.batch && !locked && (
                    <button onClick={()=>onPrint(b.serial,label,b.batch,b.kg)}
                      title="Print label"
                      className={`text-[9px] font-medium px-1.5 py-1 rounded border ${borderColor} ${color} hover:opacity-70`}>🖨</button>
                  )}
                </div>
                {bags.length > 1 && !locked && (
                  <button onClick={()=>onRemove(i)} className="text-err/30 hover:text-err"><Trash2 size={12}/></button>
                )}
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
  onUpdate:(i:number, k:keyof UntrackedEntry, v:string)=>void
  onAdd:()=>void
  onRemove:(i:number)=>void
}
function UntrackedStream({ label, entries, total, locked, onUpdate, onAdd, onRemove, showSerial = false }: UntrackedStreamProps & { showSerial?: boolean }) {
  return (
    <div className="px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[12px] font-semibold text-stone-600">{label}</p>
        {showSerial
          ? <span className="font-mono text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-wider">Serial tracked · NOT TRACKED lot</span>
          : <span className="font-mono text-[9px] font-bold text-stone-400 bg-stone-200 px-1.5 py-0.5 rounded uppercase tracking-wider">Bulk weight only</span>}
        <span className="font-mono text-[11px] font-bold text-stone-500 ml-auto">{total.toFixed(1)} kg</span>
      </div>
      {showSerial && (
        <p className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 mb-2">
          Enter serial per bag (DD-MM-NN from physical tag). This serial gets saved to the database so Refining can scan it in and auto-fill.
        </p>
      )}
      <div className="space-y-1.5">
        {entries.map((e,i) => (
          <div key={e.id} className="flex items-center gap-1.5">
            {showSerial && (
              <input type="text" value={e.serial}
                onChange={ev=>onUpdate(i,'serial',ev.target.value.toUpperCase())}
                placeholder="e.g. 08-05-01" disabled={locked}
                className="w-28 px-2 py-1.5 rounded-lg border border-blue-200 bg-white text-[11px] font-mono text-text outline-none focus:border-brand disabled:opacity-40"/>
            )}
            <input type="text" inputMode="decimal" value={e.kg}
              onChange={ev=>onUpdate(i,'kg',ev.target.value.replace(/[^0-9.]/g,'').replace(/(\.*\.).*/g,'$1'))}
              placeholder="kg" disabled={locked}
              className="flex-1 px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] text-text outline-none focus:border-brand disabled:opacity-40"/>
            {entries.length > 1 && !locked && (
              <button onClick={()=>onRemove(i)} className="text-err/30 hover:text-err"><Trash2 size={11}/></button>
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

type OutRow = { id:string; name:string; serial:string; qty:string }
interface OutGroupProps {
  label:string; rows:OutRow[]; total:number; locked:boolean
  onUpdate:(i:number, k:keyof OutRow, v:string)=>void
  onAdd:()=>void
  onRemove:(i:number)=>void
}
function OutGroup({ label, rows, total, locked, onUpdate, onAdd, onRemove }: OutGroupProps) {
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

type DebagRow = { id:string; delivery_date:string; bag_number:string; lot_serial:string; local_export:string; org_conv:string; mass_gross:string; mass_nett:string }
type BucketIn = { lot_serial:string; local_export:string; org_conv:string; mass_nett:string }


// Stable wrapper for BagScanner to prevent infinite re-render
// BagScanner's internal useEffect([], []) triggers parent re-renders which
// cause remounts — wrapping in memo breaks the cycle
const StableBagScanner = React.memo(function StableBagScanner(props: React.ComponentProps<typeof BagScanner>) {
  return <BagScanner {...props}/>
})

function SievingForm({ locked, onData, shift, sessionId, savedData }: {
  locked:boolean; onData:(d:any)=>void; shift:string; sessionId:string|null; savedData?:any
}) {
  const todayStr    = format(new Date(),'yyyy-MM-dd')

  const [shiftOps,       setShiftOps]       = useState(()=>savedData?.shiftOps??'')
  const [sieve12,        setSieve12]        = useState(()=>savedData?.sieve12??true)
  const [sieve18,        setSieve18]        = useState(()=>savedData?.sieve18??true)
  const [sieve40,        setSieve40]        = useState(()=>savedData?.sieve40??true)
  const [stdWt,          setStdWt]          = useState(()=>savedData?.stdWt??'160')
  const [actualWt,       setActualWt]       = useState(()=>savedData?.actualWt??'160')
  const [bucketIn,       setBucketIn]       = useState<BucketIn>(()=>savedData?.bucketIn??{lot_serial:'',local_export:'EXP',org_conv:'CON',mass_nett:''})
  const [spillageKg,     setSpillageKg]     = useState(()=>savedData?.spillageKg??'')
  const [debag,          setDebag]          = useState<DebagRow[]>(()=>savedData?.debag??[{id:uid(),delivery_date:todayStr,bag_number:'',lot_serial:'',local_export:'EXP',org_conv:'CON',mass_gross:'',mass_nett:''}])
  const [flBags,         setFlBags]         = useState<LeafBag[]>(()=>savedData?.flBags??[])
  const [clBags,         setClBags]         = useState<LeafBag[]>(()=>savedData?.clBags??[])
  const [rbEntries,      setRbEntries]      = useState<UntrackedEntry[]>(()=>savedData?.rbEntries??[{id:uid(),kg:'',serial:''}])
  const [dustEntries,    setDustEntries]    = useState<UntrackedEntry[]>(()=>savedData?.dustEntries??[{id:uid(),kg:'',serial:''}])
  const [rolsievEntries, setRolsievEntries] = useState<UntrackedEntry[]>(()=>savedData?.rolsievEntries??[{id:uid(),kg:'',serial:''}])
  const [indentEntries,  setIndentEntries]  = useState<UntrackedEntry[]>(()=>savedData?.indentEntries??[{id:uid(),kg:'',serial:''}])
  const [bucketOutKg,    setBucketOutKg]    = useState(()=>savedData?.bucketOutKg??'')
  const [indentSpeed,    setIndentSpeed]    = useState(()=>savedData?.indentSpeed??'95')
  const [indentAngle,    setIndentAngle]    = useState(()=>savedData?.indentAngle??'-4')
  const [dustExtraction, setDustExtraction] = useState(()=>savedData?.dustExtraction??'')
  const [floorWaste,     setFloorWaste]     = useState(()=>savedData?.floorWaste??'')
  const [cleaningWaste,  setCleaningWaste]  = useState(()=>savedData?.cleaningWaste??'')
  const [checkedBy,      setCheckedBy]      = useState(()=>savedData?.checkedBy??'')
  const [prodOrderId,    setProdOrderId]    = useState(()=>savedData?.prodOrderId??'')
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
    setDebag(rs=>[...rs,{id:uid(),delivery_date:prev?.delivery_date??todayStr,bag_number:'',lot_serial:prev?.lot_serial??'',local_export:prev?.local_export??'EXP',org_conv:prev?.org_conv??'CON',mass_gross:prev?.mass_gross??'',mass_nett:prev?.mass_nett??''}])
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
    setBags(bs=>[...bs,{id:uid(),time:format(new Date(),'HH:mm'),kg:'',batch:prev?.batch??'',serial}])
  }

  async function printLabel(serial:string,type:string,batch:string,kg:string){
    await printBagLabel({
      serial,
      productType:  type,
      sectionName:  'Sieving Tower',
      lotNumber:    batch,
      weightKg:     kg,
      variant:      'CON',
      localExport:  'Export',
      date:         new Date().toISOString(),
    })
  }

  useEffect(()=>{
    onData({shiftOps,sieve12,sieve18,sieve40,stdWt,actualWt,bucketIn,spillageKg,debag,flBags,clBags,rbEntries,dustEntries,rolsievEntries,indentEntries,bucketOutKg,totalA,totalOut,totalFL,totalCL,totalRB,totalDust,totalRolsiev,totalIndent,totalBucketOut,variance,indentSpeed,indentAngle,dustExtraction,floorWaste,cleaningWaste,checkedBy,prodOrderId})
  },[debag,bucketIn,spillageKg,flBags,clBags,rbEntries,dustEntries,rolsievEntries,indentEntries,bucketOutKg,shiftOps,checkedBy,stdWt,actualWt,indentSpeed,indentAngle,dustExtraction,floorWaste,cleaningWaste,prodOrderId])

  return (
    <div className="space-y-5">
      <Card title="Session header">
        <div className="grid grid-cols-1 gap-3">
          <F label={shift === 'morning' ? 'Morning shift operators' : 'Afternoon / Night shift operators'} value={shiftOps} onChange={setShiftOps} ph={shift === 'morning' ? 'e.g. Grant, Ayena' : 'e.g. Musa, Lubabalo'} disabled={locked}/>
          <F label="Production order (Inventory ID)" value={prodOrderId} onChange={setProdOrderId} opts={SIEV_PROD_ORDERS} disabled={locked}/>
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

      <div className="bg-red-50 border border-red-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-red-200">
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

      <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-amber-200">
          <div className="w-1 h-5 rounded-full bg-amber-400"/>
          <span className="font-semibold text-[13px] text-amber-700">Machine Spillages — subtracted from Total A</span>
        </div>
        <div className="p-4 max-w-[160px]">
          <F label="Spillage (kg)" value={spillageKg} onChange={setSpillageKg} type="number" ph="0" disabled={locked}/>
        </div>
      </div>

      <Card title="Debagging" variant="input">
        <p className="text-[11px] text-sky-600 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
          Delivery date, lot, local/export, ORG/CON, gross and nett weights carry over on add — all fields remain editable.
        </p>
        <div className="space-y-2">
          {debag.map((row,i)=>(
            <SievingDebagBagRow
              key={row.id}
              row={row}
              idx={i}
              locked={locked}
              sessionId={sessionId}
              onUpdate={updateDebagRow}
              onRemove={removeDebagRow}
              canRemove={debag.length>1}
            />
          ))}
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
        <LeafStream label="Fine Leaf" color="text-emerald-700" borderColor="border-emerald-200" bgColor="bg-emerald-50" bags={flBags} locked={locked}
          onAddBag={()=>addLeafBag(flBags,setFlBags)}
          onUpdate={(i,k,v)=>setFlBags(bs=>bs.map((b,j)=>j===i?{...b,[k]:v}:b))}
          onRemove={i=>setFlBags(bs=>bs.filter((_,j)=>j!==i))}
          onPrint={printLabel}/>
        <LeafStream label="Coarse Leaf" color="text-teal-700" borderColor="border-teal-200" bgColor="bg-teal-50" bags={clBags} locked={locked}
          onAddBag={()=>addLeafBag(clBags,setClBags)}
          onUpdate={(i,k,v)=>setClBags(bs=>bs.map((b,j)=>j===i?{...b,[k]:v}:b))}
          onRemove={i=>setClBags(bs=>bs.filter((_,j)=>j!==i))}
          onPrint={printLabel}/>

        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-stone-100 bg-stone-50">
            <div className="w-1 h-5 rounded-full bg-stone-300"/>
            <span className="font-semibold text-[13px] text-stone-600">Other outputs</span>
            <span className="font-mono text-[10px] font-bold text-stone-400 bg-stone-200 px-1.5 py-0.5 rounded uppercase ml-1">Lot / serial not tracked</span>
          </div>
          <div className="p-3 space-y-2">
            <UntrackedStream label="RB Blocks"       entries={rbEntries}      total={totalRB}      locked={locked} onUpdate={(i,k,v)=>setRbEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))}      onAdd={()=>setRbEntries(es=>[...es,{id:uid(),kg:'',serial:''}])}      onRemove={i=>setRbEntries(es=>es.filter((_,j)=>j!==i))}/>
            <UntrackedStream label="Dust"             entries={dustEntries}    total={totalDust}    locked={locked} onUpdate={(i,k,v)=>setDustEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))}    onAdd={()=>setDustEntries(es=>[...es,{id:uid(),kg:'',serial:''}])}    onRemove={i=>setDustEntries(es=>es.filter((_,j)=>j!==i))}/>
            <UntrackedStream label="Rolsiev Sticks" showSerial={true} entries={rolsievEntries} total={totalRolsiev} locked={locked} onUpdate={(i,k,v)=>setRolsievEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))} onAdd={()=>setRolsievEntries(es=>[...es,{id:uid(),kg:'',serial:''}])} onRemove={i=>setRolsievEntries(es=>es.filter((_,j)=>j!==i))}/>
            <UntrackedStream label="Indent Sticks" showSerial={true} entries={indentEntries}  total={totalIndent}  locked={locked} onUpdate={(i,k,v)=>setIndentEntries(es=>es.map((x,j)=>j===i?{...x,[k]:v}:x))}  onAdd={()=>setIndentEntries(es=>[...es,{id:uid(),kg:'',serial:''}])}  onRemove={i=>setIndentEntries(es=>es.filter((_,j)=>j!==i))}/>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-orange-200">
            <div className="w-1 h-5 rounded-full bg-orange-400"/>
            <span className="font-semibold text-[13px] text-orange-700">Bucket Elevator</span>
          </div>
          <div className="p-4 max-w-[160px]">
            <F label="Weight (kg)" value={bucketOutKg} onChange={setBucketOutKg} type="number" ph="0" disabled={locked}/>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-stone-100 bg-stone-50">
          <div className="w-1 h-5 rounded-full bg-emerald-500"/>
          <span className="font-semibold text-[13px] text-stone-800">Output totals</span>
        </div>
        <div className="p-4 space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            {[['Fine Leaf',totalFL,'text-emerald-700','bg-emerald-50 border-emerald-100'],['Coarse Leaf',totalCL,'text-teal-700','bg-teal-50 border-teal-100'],['RB Blocks',totalRB,'text-stone-600','bg-stone-50 border-stone-100'],['Dust',totalDust,'text-stone-500','bg-stone-50 border-stone-100'],['Rolsiev Sticks',totalRolsiev,'text-stone-500','bg-stone-50 border-stone-100'],['Indent Sticks',totalIndent,'text-stone-500','bg-stone-50 border-stone-100'],['Bucket Elev. out',totalBucketOut,'text-orange-600','bg-orange-50 border-orange-100']].map(([l,v,tc,bg]:any)=>(
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
          <F label="Dust extraction (kg)"             value={dustExtraction} onChange={setDustExtraction} type="number" ph="0"   disabled={locked}/>
          <F label="Floor waste (kg)"                 value={floorWaste}     onChange={setFloorWaste}     type="number" ph="0"   disabled={locked}/>
          <F label="Cleaning / Purge waste (org, kg)" value={cleaningWaste}  onChange={setCleaningWaste}  type="number" ph="0"   disabled={locked}/>
          <F label="Report checked by"                value={checkedBy}      onChange={setCheckedBy}      ph="Name"              disabled={locked}/>
        </div>
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// REFINING 1 — generic outputs (unchanged, works for R1)
// REFINING 2 — named, colour-coded outputs: Cut Heavy Stick Fine/Coarse, White/Powder Dust
// Shared inputs: RS Sticks, IS Sticks, Block, 1st Cut (+ generic via tag)
// ══════════════════════════════════════════════════════════════════════════════

type RefRow = { id:string; date:string; serial:string; con_org:string; grade:string; qty:string }

// ── R2 named output bags ─────────────────────────────────────────────────────
type R2OutRow = { id:string; serial:string; qty:string }

const R2_OUTPUTS = [
  { key:'chsf', label:'Cut Heavy Stick Fine',   letter:'A', acuId:'20BGCHS-F-C', tracked:true,  bg:'bg-emerald-50', border:'border-emerald-200', head:'bg-emerald-100', txt:'text-emerald-800', dot:'bg-emerald-500' },
  { key:'chsc', label:'Cut Heavy Stick Coarse', letter:'B', acuId:'20BGCHS-C-C', tracked:false, bg:'bg-teal-50',    border:'border-teal-200',    head:'bg-teal-100',    txt:'text-teal-800',    dot:'bg-teal-500'    },
  { key:'wdst', label:'White Dust',             letter:'C', acuId:'15IGDW-C',    tracked:false, bg:'bg-blue-50',    border:'border-blue-200',    head:'bg-blue-100',    txt:'text-blue-800',    dot:'bg-blue-500'    },
  { key:'pdst', label:'Powder Dust',            letter:'D', acuId:'15IGDPOWDR-C',tracked:false, bg:'bg-violet-50',  border:'border-violet-200',  head:'bg-violet-100',  txt:'text-violet-800',  dot:'bg-violet-500'  },
] as const

const R2_INPUT_GRADES = [
  '15IGST-C — Sticks - Conventional',
  '15IGST-RC — Sticks - RA Conventional',
  '15IGST-O — Sticks - Organic',
  '15IGST-RO — Sticks - RA Organic',
  '20BGCHS-C-C — Cut Heavy Stick Coarse - Conventional',
  '',
]

function R2OutputCard({ cfg, rows, total, locked, onUpdate, onAdd, onRemove }: {
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

// ── Refining 2 form ──────────────────────────────────────────────────────────
function Refining2Form({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
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
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2.5 px-5 py-3 bg-emerald-50 border-b border-emerald-200">
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
        <div className="grid grid-cols-4 gap-3 text-center">
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
function RefiningForm({ sectionId, locked, onData, savedData }: { sectionId:string; locked:boolean; onData:(d:any)=>void; savedData?:any }) {
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
        <div className="grid grid-cols-4 gap-3 text-center">
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

// ══════════════════════════════════════════════════════════════════════════════
// GRANULE LINE
// ══════════════════════════════════════════════════════════════════════════════
type GranBagRow     = { id:string; time:string; item:string; lot_number:string; serial_numbers:string; bag_weights:string; total_weight:string }
type GranSummaryRow = { id:string; product_type:string; lot_number:string; total_bags:string; total_output_kg:string }
type DustRow        = { id:string; dust_type:string; bags:string; qty_kg:string }
type WasteRow       = { id:string; description:string; kg:string }

type GranBlendRow = {
  id:string
  blend_no:string
  // Each column: weight + serial + variant
  brown_dust_kg:string; brown_dust_serial:string; brown_dust_variant:string
  white_dust_kg:string; white_dust_serial:string; white_dust_variant:string
  indent_dust_kg:string; indent_dust_serial:string; indent_dust_variant:string
  leaf_dust_kg:string; leaf_dust_serial:string; leaf_dust_variant:string
  alt_dust_kg:string; alt_dust_serial:string; alt_dust_variant:string
  sg_dust_kg:string; sg_dust_serial:string; sg_dust_variant:string
  dust_extraction_kg:string; dust_extraction_serial:string; dust_extraction_variant:string
  water_kg:string
}

function blankGranBlendRow(n:number): GranBlendRow {
  return {
    id:uid(), blend_no:String(n),
    brown_dust_kg:'', brown_dust_serial:'', brown_dust_variant:'CON',
    white_dust_kg:'', white_dust_serial:'', white_dust_variant:'CON',
    indent_dust_kg:'', indent_dust_serial:'', indent_dust_variant:'CON',
    leaf_dust_kg:'', leaf_dust_serial:'', leaf_dust_variant:'CON',
    alt_dust_kg:'', alt_dust_serial:'', alt_dust_variant:'CON',
    sg_dust_kg:'', sg_dust_serial:'', sg_dust_variant:'CON',
    dust_extraction_kg:'', dust_extraction_serial:'', dust_extraction_variant:'CON',
    water_kg:'',
  }
}

const GRAN_COLS = [
  { key:'brown_dust',     label:'Brown Dust / CP Dust', acumatica:true  },
  { key:'white_dust',     label:'White Dust',           acumatica:true  },
  { key:'indent_dust',    label:'Indent Dust',          acumatica:true  },
  { key:'leaf_dust',      label:'Leaf Dust',            acumatica:false },
  { key:'alt_dust',       label:'ALT Dust',             acumatica:false },
  { key:'sg_dust',        label:'SG Dust',              acumatica:false },
  { key:'dust_extraction',label:'Dust Extraction',      acumatica:false, note:'= Powder Dust from Pasteuriser' },
] as const

type GranColKey = typeof GRAN_COLS[number]['key']

function GranuleForm({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
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
  const [summary,   setSummary]   = useState<GranSummaryRow[]>(()=>savedData?.summary??[{id:uid(),product_type:'',lot_number:'',total_bags:'',total_output_kg:''}])
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

  // ── Derived totals — bagging ────────────────────────────────────────────
  const totalOutput = summary.reduce((s,r)=>s+num(r.total_output_kg),0)

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
    onData({shift,operators,supervisor,lotNumber,bagRows,summary,dustRows,wasteRows,totalOutput,
      blendRows,carryoverD,carryoverE,wasteF,totalMixed,totalProducedG,totalRawH,balanceFG,yieldPct,
      mbOperator,mbSupervisor,runStart,runStop})
  },[bagRows,summary,dustRows,wasteRows,shift,operators,supervisor,lotNumber,
     blendRows,carryoverD,carryoverE,wasteF,mbOperator,mbSupervisor,runStart,runStop])

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
                  <F label="Time"             value={r.time}           onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,time:v}:x))}           type="time" autoTimeOnFocus={true}  disabled={locked}/>
                  <F label="Item"             value={r.item}           onChange={v=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,item:v}:x))}           opts={[
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
                ]} disabled={locked}/>
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

          <Card title="Bagging summary — feeds Acumatica production order">
            <div className="note-info text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
              One row per product type. Total output kg feeds the Acumatica production order.
            </div>
            {summary.map((r,i)=>(
              <div key={r.id} className="bg-stone-50 border border-stone-200 rounded-xl p-3 grid grid-cols-2 gap-3">
                <F label="Product type"       value={r.product_type}    onChange={v=>setSummary(rs=>rs.map((x,j)=>j===i?{...x,product_type:v}:x))}   opts={[
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
                ]} disabled={locked}/>
                <F label="Lot number"         value={r.lot_number}      onChange={v=>setSummary(rs=>rs.map((x,j)=>j===i?{...x,lot_number:v.toUpperCase()}:x))} ph="e.g. RSFG/RA-02726" disabled={locked}/>
                <F label="Total bags"         value={r.total_bags}      onChange={v=>setSummary(rs=>rs.map((x,j)=>j===i?{...x,total_bags:v}:x))}      ph="e.g. 3×500+1×300" disabled={locked}/>
                <F label="Total output (kg)"  value={r.total_output_kg} onChange={v=>setSummary(rs=>rs.map((x,j)=>j===i?{...x,total_output_kg:v}:x))} type="number" ph="1800" disabled={locked}/>
              </div>
            ))}
            {!locked&&<AddRow label="Add summary row" onClick={()=>setSummary(rs=>[...rs,{id:uid(),product_type:'SG Granules',lot_number:lotNumber,total_bags:'',total_output_kg:''}])}/>}
            <div className="flex justify-between px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
              <span className="text-[12px] font-semibold text-emerald-700">Total output (C*)</span>
              <span className="font-mono font-bold text-[15px] text-emerald-700">{totalOutput.toFixed(1)} kg</span>
            </div>
          </Card>

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
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-3 bg-amber-50 border-b border-amber-200">
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
                        const kgKey     = `${col.key}_kg`     as keyof GranBlendRow
                        const serialKey = `${col.key}_serial` as keyof GranBlendRow
                        const varKey    = `${col.key}_variant` as keyof GranBlendRow
                        const kg = num((row as any)[kgKey])
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
                              <input type="text" value={(row as any)[serialKey]}
                                onChange={e=>upBlend(i, serialKey, e.target.value.toUpperCase())}
                                placeholder="e.g. 04-05-01" disabled={locked}
                                className={INP}/>
                              <SearchableSelect value={(row as any)[varKey]} onChange={v=>upBlend(i, varKey, v)} opts={VARIANT_OPTS} disabled={locked}/>
                            </div>
                            {kg>0&&<div className="text-[10px] font-mono text-stone-400 mt-1 text-right">
                              {(row as any)[serialKey]||'no serial'} · {(row as any)[varKey]}
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
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center gap-2.5 px-5 py-3 bg-emerald-50 border-b border-emerald-200">
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


// ══════════════════════════════════════════════════════════════════════════════
// BIG BLENDER — rebuilt to match paper form structure


// ══════════════════════════════════════════════════════════════════════════════
// MULTI-PRODUCTION WRAPPER — generic, used by Sieving, Granule, Pasteuriser
// Allows multiple production orders per shift (e.g. Conventional + Organic)
// ══════════════════════════════════════════════════════════════════════════════

// Stable per-slot wrapper — gives each production a stable onData ref
// Prevents BagScanner useEffect infinite loop caused by new fn reference every render
const ProductionSlot = React.memo(function ProductionSlot({
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

function MultiProductionWrapper({
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

// MultiBlenderForm — uses the generic wrapper
function MultiBlenderForm({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
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

// Debagging: one colour-coded section per ingredient type (A–F)
// Each section has its own rows of input bags
// Bagging: simple time-ordered output list + blend ratio summary
// ══════════════════════════════════════════════════════════════════════════════

type BlendIngredientRow = { id:string; local_export:string; kg:string; lot:string; serial:string }
type BlendBagRow = { id:string; time:string; blend_type:string; serial_no:string; kg:string }

const ING_THEME = {
  A: { label:'Sieved Fine Leaf',   letter:'A', bg:'bg-emerald-50', border:'border-emerald-200', head:'bg-emerald-100', txt:'text-emerald-800', dot:'bg-emerald-500' },
  B: { label:'Sieved Coarse Leaf', letter:'B', bg:'bg-teal-50',    border:'border-teal-200',    head:'bg-teal-100',    txt:'text-teal-800',    dot:'bg-teal-500'    },
  C: { label:'Blocks: Clean',      letter:'C', bg:'bg-blue-50',    border:'border-blue-200',    head:'bg-blue-100',    txt:'text-blue-800',    dot:'bg-blue-500'    },
  D: { label:'Blocks: Cut',        letter:'D', bg:'bg-violet-50',  border:'border-violet-200',  head:'bg-violet-100',  txt:'text-violet-800',  dot:'bg-violet-500'  },
  E: { label:'Other 1',            letter:'E', bg:'bg-amber-50',   border:'border-amber-200',   head:'bg-amber-100',   txt:'text-amber-800',   dot:'bg-amber-400'   },
  F: { label:'Other 2',            letter:'F', bg:'bg-rose-50',    border:'border-rose-200',    head:'bg-rose-100',    txt:'text-rose-800',    dot:'bg-rose-400'    },
} as const
type IngKey = keyof typeof ING_THEME

const BL_EXP_OPTS = ['Export', 'Export Blend', 'Domestic/Local', '']

function blankIngRow(): BlendIngredientRow {
  return { id: uid(), local_export: 'Export', kg: '', lot: '', serial: '' }
}

interface IngredientSectionProps {
  ingKey: IngKey
  rows: BlendIngredientRow[]
  total: number
  locked: boolean
  hasLot: boolean
  onUpdate: (i: number, k: keyof BlendIngredientRow, v: string) => void
  onAdd: () => void
  onRemove: (i: number) => void
  otherLabel?: string
}

function IngredientSection({ ingKey, rows, total, locked, hasLot, onUpdate, onAdd, onRemove, otherLabel }: IngredientSectionProps) {
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
              <div key={r.id} className={`grid gap-1.5 items-center bg-white rounded-xl px-2 py-1.5 border border-stone-100 ${hasLot ? 'grid-cols-[70px_1fr_1fr_1fr_auto]' : 'grid-cols-[70px_1fr_1fr_auto]'}`}>
                <select value={r.local_export} onChange={e => onUpdate(i, 'local_export', e.target.value)} disabled={locked}
                  className="w-full px-1.5 py-1.5 rounded-lg border border-stone-200 bg-white text-[11px] text-text outline-none focus:border-brand disabled:opacity-40 disabled:bg-stone-50">
                  {BL_EXP_OPTS.map(o => <option key={o}>{o}</option>)}
                </select>
                <input type="text" inputMode="decimal" value={r.kg}
                  onChange={e => onUpdate(i, 'kg', e.target.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1'))}
                  placeholder="kg" disabled={locked} className={INP}/>
                {hasLot && (
                  <input type="text" value={r.lot}
                    onChange={e => onUpdate(i, 'lot', e.target.value.toUpperCase())}
                    placeholder="e.g. GS-0271" disabled={locked} className={INP}/>
                )}
                <input type="text" value={r.serial}
                  onChange={e => onUpdate(i, 'serial', e.target.value.toUpperCase())}
                  placeholder="e.g. 04-05-01" disabled={locked} className={INP}/>
                {rows.length > 1 && !locked && (
                  <button onClick={() => onRemove(i)} className="text-err/30 hover:text-err flex-shrink-0"><Trash2 size={12}/></button>
                )}
              </div>
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

function BlenderForm({ locked, onData, savedData }: { locked:boolean; onData:(d:any)=>void; savedData?:any }) {
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

  function upIng(setter:React.Dispatch<React.SetStateAction<BlendIngredientRow[]>>, i:number, k:keyof BlendIngredientRow, v:string) {
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
      scaleBegin,scaleFull,scaleEnd,extrDust,waste,checkedBy})
  },[rowsA,rowsB,rowsC,rowsD,rowsE,rowsF,bagRows,
     op1,op2,op3,shift,supervisor,lotNo,variantCode,blendCode,other1Label,other2Label,
     scaleBegin,scaleFull,scaleEnd,extrDust,waste,checkedBy])

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
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-3 bg-sky-50 border-b border-sky-200">
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

          <IngredientSection ingKey="A" rows={rowsA} total={totalA} locked={locked} hasLot={true}
            onUpdate={(i,k,v)=>upIng(setRowsA,i,k,v)}
            onAdd={()=>addIng(setRowsA,rowsA)}
            onRemove={i=>remIng(setRowsA,i)}/>

          <IngredientSection ingKey="B" rows={rowsB} total={totalB} locked={locked} hasLot={true}
            onUpdate={(i,k,v)=>upIng(setRowsB,i,k,v)}
            onAdd={()=>addIng(setRowsB,rowsB)}
            onRemove={i=>remIng(setRowsB,i)}/>

          <IngredientSection ingKey="C" rows={rowsC} total={totalC} locked={locked} hasLot={false}
            onUpdate={(i,k,v)=>upIng(setRowsC,i,k,v)}
            onAdd={()=>addIng(setRowsC,rowsC)}
            onRemove={i=>remIng(setRowsC,i)}/>

          <IngredientSection ingKey="D" rows={rowsD} total={totalD} locked={locked} hasLot={false}
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
                <IngredientSection ingKey="E" rows={rowsE} total={totalE} locked={locked} hasLot={false}
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
                <IngredientSection ingKey="F" rows={rowsF} total={totalF} locked={locked} hasLot={false}
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
          <div className="grid grid-cols-[56px_80px_1fr_1fr_70px_auto] gap-1.5 px-1">
            {['Time','','Blend type','Serial no.','KG',''].map((h,i)=>(
              <span key={i} className="text-[9px] font-bold text-stone-400 uppercase">{h}</span>
            ))}
          </div>
          {bagRows.map((r,i)=>(
            <div key={r.id} className="grid grid-cols-[56px_80px_1fr_1fr_70px_auto] gap-1.5 items-center bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5">
              <span className="font-mono text-[11px] text-stone-400 text-center">Bag {i+1}</span>
              <input type="time" value={r.time}
                onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,time:e.target.value}:x))}
                onFocus={e=>{if(!r.time)setBagRows(rs=>rs.map((x,j)=>j===i?{...x,time:format(new Date(),'HH:mm')}:x))}}
                disabled={locked} className={INP}/>
              <input type="text" value={r.blend_type||blendCode}
                onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,blend_type:e.target.value.toUpperCase()}:x))}
                placeholder="e.g. SG-NAT26-C" disabled={locked} className={INP}/>
              <input type="text" value={r.serial_no}
                onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,serial_no:e.target.value.toUpperCase()}:x))}
                placeholder="e.g. BL-240426-001" disabled={locked} className={INP}/>
              <input type="text" inputMode="decimal" value={r.kg}
                onChange={e=>setBagRows(rs=>rs.map((x,j)=>j===i?{...x,kg:e.target.value.replace(/[^0-9.]/g,'').replace(/(\..*)\./g,'$1')}:x))}
                placeholder="350" disabled={locked} className={INP}/>
              {bagRows.length>1&&!locked&&(
                <button onClick={()=>setBagRows(rs=>rs.filter((_,j)=>j!==i))} className="text-err/30 hover:text-err flex-shrink-0"><Trash2 size={12}/></button>
              )}
            </div>
          ))}
          {!locked&&(
            <button onClick={()=>{
              const prev=bagRows[bagRows.length-1]
              const seq=String(bagRows.length+1).padStart(3,'0')
              // Serial format: lot number + sequence, e.g. 29-04-26/1-01
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
    </div>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// PASTEURISER — 7 sub-forms (unchanged, savedData passed through shell only)
// ══════════════════════════════════════════════════════════════════════════════
type PastTempRow    = { id:string; time:string; tea_temp:string; dryer_air_temp:string; boiler_flush:boolean; boiler_bar:string; boiler_kpa:string; steam_temp:string; water_cond:string; complies:'yes'|'no'|''; corrective_action:string; ncr_ref:string }
type PastWaterJet   = { id:string; jet:string; reading:string }
type PastRatePoint  = { id:string; time:string; kg:string }
type PastDebagRow   = { id:string; bag_seq:string; batch:string; time:string; product_type:string; serial:string; lot:string; kg:string }
type PastBagRow     = { id:string; line:string; start_time:string; item:string; lot:string; num_bags:string; start_bag:string; end_bag:string; bag_weight:string; total_weight:string }
type PastByProduct  = { id:string; product_type:string; serial:string; weight:string }
type PastTimesheetRow = { id:string; material:string; speed:string; invertor:string; start_time:string; stop_time:string; time_not_producing:string; failure_areas:string[]; other_specify:string; comments:string }
type PastVacuumRow  = { id:string; operation:string; batch:string; start_box:string; end_box:string; comments:string }
type PastQualityPoint = { id:string; time:string; value:string }

const FAILURE_AREAS = ['End of day','No feed material','Product change','Feed tank','Conveyor','Main sieve','Screw conveyor','Aspirator','Bag filter','Pasteuriser','Boiler','Drier heater','Drier shaker','Post sieve','Bin shaker','Bagging unit','Bin stamper']
const WATER_JETS    = ['1,11','2,12','3,13','4,14','5,15','6,16 (middle)','8,18','9,19','10,20']

function SimpleLineChart({ points, yLabel, color='#10b981', yMin=0, yMax=100 }: { points:{time:string;value:number}[]; yLabel:string; color?:string; yMin?:number; yMax?:number }) {
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

function PastDailyReport({ locked, storageKey='past_daily' }:{ locked:boolean; storageKey?:string }) {
  const todayStr=format(new Date(),'yyyy-MM-dd')
  const [{operatorName,batchNumber,verifiedBy,verifyDate},setH]=usePastLS(storageKey+':hdr',()=>({operatorName:'',batchNumber:'',verifiedBy:'',verifyDate:todayStr}))
  const setOperatorName=(v:string)=>setH(s=>({...s,operatorName:v}))
  const setBatchNumber=(v:string)=>setH(s=>({...s,batchNumber:v}))
  const setVerifiedBy=(v:string)=>setH(s=>({...s,verifiedBy:v}))
  const setVerifyDate=(v:string)=>setH(s=>({...s,verifyDate:v}))
  const timeSlots=(()=>{const slots=[];let h=7,m=45;while(h<24){slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);m+=15;if(m>=60){m=0;h++}};return slots})()
  const [rows,setRows]=useState<PastTempRow[]>(timeSlots.map(t=>({id:uid(),time:t,tea_temp:'',dryer_air_temp:'',boiler_flush:false,boiler_bar:'',boiler_kpa:'',steam_temp:'',water_cond:'',complies:'' as const,corrective_action:'',ncr_ref:''})))
  const [waterJets,setWaterJets]=useState<PastWaterJet[]>(WATER_JETS.map(j=>({id:uid(),jet:j,reading:''})))
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

function PastRateOfProduction({ locked, storageKey='past_rate' }:{ locked:boolean; storageKey?:string }) {
  const [batchNo,setBatchNo]=usePastLS<string>(storageKey+':bn',()=>'')
  const [points,setPoints]=usePastLS<PastRatePoint[]>(storageKey+':pts',()=>[{id:uid(),time:format(new Date(),'HH:mm'),kg:''}])
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

function PastDebagging({ locked, storageKey='past_debag' }:{ locked:boolean; storageKey?:string }) {
  const todayStr=format(new Date(),'yyyy-MM-dd')
  const [operators,setOperators]=useState(''),[shift,setShift]=useState('Morning'),[variantCode,setVariantCode]=useState('CON')
  const [debagRows,setDebagRows]=useState<PastDebagRow[]>([{id:uid(),bag_seq:'1',batch:'',time:'',product_type:'',serial:'',lot:'',kg:''}])
  const [postSieveRows,setPostSieveRows]=useState<PastDebagRow[]>([{id:uid(),bag_seq:'1',batch:'',time:'',product_type:'',serial:'',lot:'',kg:''}])
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
            <F label="Serial / bag no."   value={r.serial}       onChange={v=>upRow(i,'serial',v,setRows)}       ph="e.g. BL-240426-001" disabled={locked}/>
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

function PastBagging({ locked, storageKey='past_bag' }:{ locked:boolean; storageKey?:string }) {
  const todayStr=format(new Date(),'yyyy-MM-dd')
  const [operators,setOperators]=useState(''),[shift,setShift]=useState('Morning'),[supervisor,setSupervisor]=useState(''),[lotNumber,setLotNumber]=useState(''),[prodType,setProdType]=useState('Bagging'),[stdWt,setStdWt]=useState('160'),[actualWt,setActualWt]=useState('160'),[floorWaste,setFloorWaste]=useState(''),[comments,setComments]=useState('')
  const [bagRows,setBagRows]=useState<PastBagRow[]>([{id:uid(),line:'1',start_time:'',item:'',lot:'',num_bags:'',start_bag:'',end_bag:'',bag_weight:'',total_weight:''}])
  const [byProducts,setByProducts]=useState<PastByProduct[]>([{id:uid(),product_type:'',serial:'',weight:''}])
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

function PastProcessTimesheet({ locked, storageKey='past_ts' }:{ locked:boolean; storageKey?:string }) {
  const [rows,setRows]=useState<PastTimesheetRow[]>([{id:uid(),material:'',speed:'',invertor:'',start_time:'',stop_time:'',time_not_producing:'',failure_areas:[],other_specify:'',comments:''}])
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

function PastVacuumRegister({ locked, storageKey='past_vac' }:{ locked:boolean; storageKey?:string }) {
  const [operatorName,setOperatorName]=useState(''),[shift,setShift]=useState('Morning')
  const [rows,setRows]=useState<PastVacuumRow[]>([{id:uid(),operation:'Bagging',batch:'',start_box:'',end_box:'',comments:''}])
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

function PastQualityGraphs({ locked, storageKey='past_qual' }:{ locked:boolean; storageKey?:string }) {
  const [batchNo,setBatchNo]=useState('')
  const [bdPoints,setBdPoints]=useState<PastQualityPoint[]>([{id:uid(),time:'',value:''}])
  const [mstPoints,setMstPoints]=useState<PastQualityPoint[]>([{id:uid(),time:'',value:''}])
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

type PastTab = 'daily'|'rate'|'debagging'|'bagging'|'timesheet'|'vacuum'|'quality'
const PAST_TABS: {id:PastTab;label:string}[] = [
  {id:'daily',label:'1. Daily report'},{id:'rate',label:'2. Rate of prod.'},{id:'debagging',label:'3. Debagging'},
  {id:'bagging',label:'4. Bagging'},{id:'timesheet',label:'5. Timesheet'},{id:'vacuum',label:'6. Vacuum reg.'},{id:'quality',label:'7. Quality'},
]

// Utility: persist/restore a pasteuriser sub-form state to localStorage
function usePastLS<T>(storageKey: string, initialFn: ()=>T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(()=>{
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return JSON.parse(saved)
    } catch {}
    return initialFn()
  })
  useEffect(()=>{
    try { localStorage.setItem(storageKey, JSON.stringify(state)) } catch {}
  }, [state, storageKey])
  return [state, setState]
}

function PasteuriseurForm({ locked, onData, savedData, sessionId, dateParam, shift }: {
  locked:boolean; onData:(d:any)=>void; savedData?:any
  sessionId?:string|null; dateParam?:string; shift?:string
}) {
  const [activeTab, setActiveTab] = useState<PastTab>('debagging')
  const sk = (tab:string) => `cntp_past_${sessionId??'new'}_${dateParam??'today'}_${shift??'m'}_${tab}`
  useEffect(()=>{ onData({section:'pasteuriser'}) },[])
  return (
    <div className="space-y-4">
      <div className="flex overflow-x-auto gap-1 pb-1 -mx-1 px-1">
        {PAST_TABS.map(tab=>(<button key={tab.id} onClick={()=>setActiveTab(tab.id)} className={`flex-shrink-0 px-3 py-2 rounded-xl font-medium text-[12px] transition-colors whitespace-nowrap ${activeTab===tab.id?'bg-red-500 text-white':'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}>{tab.label}</button>))}
      </div>
      <div style={{display: activeTab==='daily'     ? 'block' : 'none'}}><PastDailyReport      locked={locked} storageKey={sk('daily')}    /></div>
      <div style={{display: activeTab==='rate'      ? 'block' : 'none'}}><PastRateOfProduction locked={locked} storageKey={sk('rate')}     /></div>
      <div style={{display: activeTab==='debagging' ? 'block' : 'none'}}><PastDebagging        locked={locked} storageKey={sk('debag')}    /></div>
      <div style={{display: activeTab==='bagging'   ? 'block' : 'none'}}><PastBagging          locked={locked} storageKey={sk('bagging')}  /></div>
      <div style={{display: activeTab==='timesheet' ? 'block' : 'none'}}><PastProcessTimesheet locked={locked} storageKey={sk('ts')}       /></div>
      <div style={{display: activeTab==='vacuum'    ? 'block' : 'none'}}><PastVacuumRegister   locked={locked} storageKey={sk('vacuum')}   /></div>
      <div style={{display: activeTab==='quality'   ? 'block' : 'none'}}><PastQualityGraphs    locked={locked} storageKey={sk('quality')}  /></div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CLEANING CHECKLIST
// ══════════════════════════════════════════════════════════════════════════════
type CleanTask = { id:string; area:string; task:string; responsible:string; done:boolean; time:string; name:string }
const CLEANING_TASKS: Record<string,CleanTask[]> = {
  sieving:[
    {id:uid(),area:'Sieving',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Brush sieves (every 2 hrs)',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Brush off aspirator',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Clean magnet',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Brush off dust on bell conveyors',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Brush off dust on screw conveyor',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Brush off excess tea on rolsif + wipe magnet',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Brush down screen with telescopic handle and vacuum up dust',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Sieving',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'De-bagging',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'De-bagging',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'De-bagging',task:'Sweep spillages',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Dust Collection Room',task:'Brush crevices and hard to reach areas',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Dust Collection Room',task:'Vacuum walls and floors',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Dust Collection Room',task:'Bag filters removed and changed (Rooibos↔Honeybush)',responsible:'General cleaner',done:false,time:'',name:''},
  ],
  refining1:[
    {id:uid(),area:'De-bagging',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'De-bagging',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'De-bagging',task:'Sweep spillages',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Post-sieve',task:'Clean sieves by brushing off excess tea leaves, dust and material',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Post-sieve',task:'Remove foreign material from magnet and record on form',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Post-sieve',task:'Brush down screw conveyors and chute',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Post-sieve',task:'Vacuum walls and floors',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Wipe surfaces on conveyor chute with disposable cloth',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Brush down small conveyor',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Lift scale and vacuum or sweep tea underneath daily',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
  refining2:[],
  granule:[
    {id:uid(),area:'Granule Line',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Granule Line',task:'Brush off all dust on equipment surfaces',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Granule Line',task:'Check and clean rotary valve',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Wipe surfaces on conveyor chute',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Check and clean scale',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
  blender:[
    {id:uid(),area:'Blender',task:'Vacuum walls and floor',responsible:'Operator / General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Blender',task:'After mini-blender: brush, vacuum and disinfect',responsible:'Operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Wipe surfaces on conveyor chute with disposable cloth',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Check and clean scale',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
  pasteuriser:[
    {id:uid(),area:'Pasteuriser',task:'Clean per PPM 13.4',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:uid(),area:'Pasteuriser',task:'Vacuum dust and leaves from walls and floors',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:uid(),area:'Drying',task:'Remove funnel at dryer feed and wipe with disposable cloth',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:uid(),area:'Drying',task:'Remove all hatches, brush and vacuum inside dryer',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:uid(),area:'Drying',task:'Brush down screw conveyor and chute',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:uid(),area:'Drying',task:'Vacuum walls and floors',responsible:'Operator / General worker',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Wipe surfaces on conveyor chute with disposable cloth',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Brush down bagging machine',responsible:'Bagging machine operator',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Vacuum internal walls and floor',responsible:'General cleaner',done:false,time:'',name:''},
    {id:uid(),area:'Bagging',task:'Check and clean scale',responsible:'Bagging machine operator',done:false,time:'',name:''},
  ],
}
CLEANING_TASKS['refining2'] = CLEANING_TASKS['refining1'].map(t=>({...t,id:uid()}))

function CleaningTab({ sectionId, locked, onProgress, onTaskUpdate }: { sectionId:string; locked:boolean; onProgress?:(done:number,total:number)=>void; onTaskUpdate?:(tasks:any[])=>void }) {
  const [tasks,setTasks]=useState<CleanTask[]>(()=>(CLEANING_TASKS[sectionId]??[]).map(t=>({...t,id:uid()})))
  function toggle(i:number){setTasks(ts=>{const upd=ts.map((t,j)=>j===i?{...t,done:!t.done,time:!t.done?nowTime():t.time}:t);onTaskUpdate?.(upd);return upd})}
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


// ══════════════════════════════════════════════════════════════════════════════
// ACUMATICA SUMMARY — shows debagging (inputs) and bagging (outputs)
// with grouped Acumatica codes, bag counts and serial numbers
// Serials for tracked items: DD-MM-NN | For untracked: NOT TRACKED
// ══════════════════════════════════════════════════════════════════════════════
function AcumaticaSummary({ sectionId, sessionData: d, date, shift }: {
  sectionId: string; sessionData: any; date: string; shift: string
}) {
  if (!d) return null

  // Section display names
  const sectionName: Record<string,string> = {
    sieving:'Sieving Tower', refining1:'Refining 1', refining2:'Refining 2',
    granule:'Granule Line', blender:'Blender', pasteuriser:'Pasteuriser',
  }

  // Helper: group rows by product type, sum kg, collect serials
  function groupRows(rows: any[], kgKey='kg', typeKey='product_type', serialKey='bag_serial_no') {
    const map: Record<string, {kg:number; serials:string[]; bags:number}> = {}
    ;(rows||[]).forEach((r:any) => {
      const type = r[typeKey] || 'Unknown'
      const kg   = parseFloat(r[kgKey]) || 0
      if (kg === 0) return
      if (!map[type]) map[type] = {kg:0, serials:[], bags:0}
      map[type].kg += kg
      map[type].bags += 1
      const serial = r[serialKey]
      if (serial && serial !== 'NOT TRACKED') map[type].serials.push(serial)
    })
    return map
  }

  // Build input rows per section
  function buildInputs() {
    if (sectionId === 'sieving') {
      return (d.debag||[]).filter((r:any)=>parseFloat(r.mass_nett)>0).map((r:any) => ({
        product_type: r.lot_serial ? `Raw Material (${r.lot_serial})` : 'Raw Material',
        kg: parseFloat(r.mass_nett)||0,
        bag_serial_no: r.bag_number||'NOT TRACKED',
        lot: r.lot_serial||'',
        variant: r.org_conv||'',
      }))
    }
    if (sectionId === 'refining1') {
      return (d.debag||[]).filter((r:any)=>parseFloat(r.qty)>0).map((r:any) => ({
        product_type: r.grade || 'Input',
        kg: parseFloat(r.qty)||0,
        bag_serial_no: r.serial||'NOT TRACKED',
        variant: r.con_org||'',
      }))
    }
    if (sectionId === 'refining2') {
      return (d.debag||[]).filter((r:any)=>parseFloat(r.qty)>0).map((r:any) => ({
        product_type: r.grade || 'Input',
        kg: parseFloat(r.qty)||0,
        bag_serial_no: r.serial||'NOT TRACKED',
        variant: r.con_org||'',
      }))
    }
    if (sectionId === 'granule') {
      // Mass balance inputs (blend rows)
      const rows: any[] = []
      ;(d.blendRows||[]).forEach((blend:any, bi:number) => {
        const cols = ['brown_dust','white_dust','indent_dust','leaf_dust','alt_dust','sg_dust','dust_extraction']
        const labels: Record<string,string> = {
          brown_dust:'Brown Dust',white_dust:'White Dust',indent_dust:'Indent Dust',
          leaf_dust:'Leaf Dust',alt_dust:'ALT Dust',sg_dust:'SG Dust',dust_extraction:'Dust Extraction'
        }
        cols.forEach(c => {
          const kg = parseFloat(blend[c+'_kg'])||0
          if (kg === 0) return
          rows.push({
            product_type: labels[c] + (d.blendRows.length>1 ? ` (Blend ${bi+1})` : ''),
            kg, bag_serial_no: blend[c+'_serial']||'NOT TRACKED', variant: blend[c+'_variant']||''
          })
        })
        if (parseFloat(blend.water_kg)>0) rows.push({
          product_type: 'Water', kg: parseFloat(blend.water_kg)||0, bag_serial_no: 'NOT TRACKED', variant: ''
        })
      })
      return rows
    }
    if (sectionId === 'blender') {
      const rows: any[] = []
      const ingMap = [
        {key:'rowsA', label:'Sieved Fine Leaf'},
        {key:'rowsB', label:'Sieved Coarse Leaf'},
        {key:'rowsC', label:'Blocks: Clean'},
        {key:'rowsD', label:'Blocks: Cut'},
        {key:'rowsE', label:d.other1Label||'Other 1 (E)'},
        {key:'rowsF', label:d.other2Label||'Other 2 (F)'},
      ]
      ingMap.forEach(({key, label}) => {
        ;(d[key]||[]).forEach((r:any) => {
          const kg = parseFloat(r.kg)||0
          if (kg===0) return
          rows.push({product_type:label, kg, bag_serial_no:r.serial||'NOT TRACKED', lot:r.lot||''})
        })
      })
      return rows
    }
    return []
  }

  // Build output rows per section
  function buildOutputs() {
    if (sectionId === 'sieving') {
      const rows: any[] = []
      ;(d.flBags||[]).forEach((b:any) => rows.push({product_type:'Sieved Fine Leaf', kg:parseFloat(b.kg)||0, bag_serial_no:b.serial||'NOT TRACKED', lot:b.batch||''}))
      ;(d.clBags||[]).forEach((b:any) => rows.push({product_type:'Sieved Coarse Leaf', kg:parseFloat(b.kg)||0, bag_serial_no:b.serial||'NOT TRACKED', lot:b.batch||''}))
      if (parseFloat(d.totalRB)>0) rows.push({product_type:'Blocks (Sieving)', kg:parseFloat(d.totalRB)||0, bag_serial_no:'NOT TRACKED', lot:''})
      if (parseFloat(d.totalDust)>0) rows.push({product_type:'Dust (Sieving)', kg:parseFloat(d.totalDust)||0, bag_serial_no:'NOT TRACKED', lot:''})
      if (parseFloat(d.totalRolsiev)>0) rows.push({product_type:'Rolsiev Sticks', kg:parseFloat(d.totalRolsiev)||0, bag_serial_no:'NOT TRACKED', lot:''})
      if (parseFloat(d.totalIndent)>0) rows.push({product_type:'Indent Sticks', kg:parseFloat(d.totalIndent)||0, bag_serial_no:'NOT TRACKED', lot:''})
      return rows
    }
    if (sectionId === 'refining1') {
      const rows: any[] = []
      ;['out1','out2','out3'].forEach(k=>{
        ;(d[k]||[]).forEach((r:any)=>{
          const kg=parseFloat(r.qty)||0
          if(kg===0)return
          rows.push({product_type:r.name||'Output', kg, bag_serial_no:r.serial||'NOT TRACKED', lot:''})
        })
      })
      return rows
    }
    if (sectionId === 'refining2') {
      const rows: any[] = []
      const outMap = [
        {key:'rowsA', label:'Cut Heavy Stick Fine (20BGCHS-F-C)', tracked:true},
        {key:'rowsB', label:'Cut Heavy Stick Coarse (20BGCHS-C-C)', tracked:false},
        {key:'rowsC', label:'White Dust (15IGDW-C)', tracked:false},
        {key:'rowsD', label:'Powder Dust (15IGDPOWDR-C)', tracked:false},
      ]
      outMap.forEach(({key,label,tracked})=>{
        ;(d[key]||[]).forEach((r:any)=>{
          const kg=parseFloat(r.qty)||0
          if(kg===0)return
          rows.push({product_type:label, kg, bag_serial_no:tracked?(r.serial||'NOT TRACKED'):'NOT TRACKED', lot:r.lot||''})
        })
      })
      return rows
    }
    if (sectionId === 'granule') {
      const rows: any[] = []
      ;(d.bagRows||[]).forEach((r:any)=>{
        const kg=parseFloat(r.total_weight)||0
        if(kg===0)return
        rows.push({product_type:r.item||'Granules', kg, bag_serial_no:'NOT TRACKED', lot:r.lot_number||''})
      })
      ;(d.dustRows||[]).forEach((r:any)=>{
        const kg=parseFloat(r.qty_kg)||0
        if(kg===0)return
        rows.push({product_type:r.dust_type||'Dust', kg, bag_serial_no:'NOT TRACKED', lot:''})
      })
      return rows
    }
    if (sectionId === 'blender') {
      return (d.bagRows||[]).filter((r:any)=>parseFloat(r.kg)>0).map((r:any)=>({
        product_type: r.blend_type||d.blendCode||'Blended Material',
        kg: parseFloat(r.kg)||0,
        bag_serial_no: r.serial_no||'NOT TRACKED',
        lot: d.lotNo||'',
      }))
    }
    return []
  }

  const inputs = buildInputs()
  const outputs = buildOutputs()
  const inputGroups = groupRows(inputs, 'kg', 'product_type', 'bag_serial_no')
  const outputGroups = groupRows(outputs, 'kg', 'product_type', 'bag_serial_no')
  const totalIn = inputs.reduce((s:number,r:any)=>s+r.kg, 0)
  const totalOut = outputs.reduce((s:number,r:any)=>s+r.kg, 0)

  function SummaryTable({ title, groups, total, color }: {title:string; groups:Record<string,{kg:number;serials:string[];bags:number}>; total:number; color:string}) {
    const entries = Object.entries(groups)
    if (entries.length === 0) return null
    const headCls = `px-4 py-2 text-left text-[9px] font-bold uppercase tracking-wide ${color.replace('bg-','text-').replace('50','700').replace('100','700')}`
    return (
      <div className={`rounded-xl border overflow-hidden ${color.replace('bg-','border-').replace('50','200').replace('100','200')}`}>
        <div className={`flex items-center justify-between px-4 py-2.5 ${color} border-b ${color.replace('50','200').replace('100','200')}`}>
          <span className={`font-semibold text-[12px] ${color.replace('bg-','text-').replace('50','800').replace('100','800')}`}>{title}</span>
          <span className={`font-mono font-bold text-[13px] ${color.replace('bg-','text-').replace('50','700').replace('100','700')}`}>{total.toFixed(1)} kg total</span>
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-stone-100">
              <th className={headCls}>Item / Code</th>
              <th className={headCls + ' text-right'}>Bags</th>
              <th className={headCls + ' text-right'}>KG</th>
              <th className={headCls}>Serials</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([type, g]) => (
              <tr key={type} className="border-b border-stone-50 last:border-0">
                <td className="px-4 py-2 font-medium text-stone-700">
                  {type.includes(' — ') ? (
                    <span>
                      <span className="font-mono text-[10px] text-stone-400 block">{type.split(' — ')[0]}</span>
                      <span className="text-stone-700">{type.split(' — ').slice(1).join(' — ')}</span>
                    </span>
                  ) : type}
                </td>
                <td className="px-3 py-2 text-right font-mono text-stone-500">{g.bags}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-stone-800">{g.kg.toFixed(1)}</td>
                <td className="px-4 py-2 font-mono text-[10px] text-stone-400 max-w-[160px]">
                  {g.serials.length > 0
                    ? g.serials.join(', ')
                    : <span className="text-stone-300 italic">NOT TRACKED</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-4 bg-purple-50 border border-purple-200 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-purple-500"/>
        <span className="font-semibold text-[13px] text-purple-900">Acumatica Production Order Summary</span>
        <span className="font-mono text-[10px] text-purple-400 ml-auto">{sectionName[sectionId]||sectionId} · {shift} · {date}</span>
      </div>
      <p className="text-[11px] text-purple-600 bg-white border border-purple-100 rounded-lg px-3 py-2">
        This summary feeds the Acumatica production order. Serials marked <strong>NOT TRACKED</strong> appear as such in the system. Copy into your production order after sign-off.
      </p>
      <SummaryTable title="Debagging — Inputs" groups={inputGroups} total={totalIn} color="bg-sky-50"/>
      <SummaryTable title="Bagging — Outputs" groups={outputGroups} total={totalOut} color="bg-emerald-50"/>
      {totalIn > 0 && totalOut > 0 && (
        <div className={`flex justify-between px-4 py-3 rounded-xl border-2 ${Math.abs(totalIn-totalOut)<=15?'bg-ok/5 border-ok/30':'bg-warn/5 border-warn/40'}`}>
          <span className={`font-semibold text-[12px] ${Math.abs(totalIn-totalOut)<=15?'text-ok':'text-warn'}`}>Mass balance variance</span>
          <span className={`font-mono font-bold text-[14px] ${Math.abs(totalIn-totalOut)<=15?'text-ok':'text-warn'}`}>{(totalIn-totalOut).toFixed(1)} kg</span>
        </div>
      )}
    </div>
  )
}

function SignOffTab({ locked, sessionStatus, onSubmit, onApprove, onRequestCorrection, submitting, role, sectionId, formData, dateParam, shift, onSignatureData }: {
  locked:boolean; sessionStatus:string; onSubmit:()=>void; onApprove:()=>void
  onRequestCorrection:(reason:string)=>Promise<void>; submitting:boolean; role:string|null
  sectionId:string; formData:any; dateParam:string; shift:string; onSignatureData?:(d:any)=>void
}) {
  const [opSig,setOpSig]=useState(''),[supSig,setSupSig]=useState('')
  const [opName,setOpName]=useState(()=>{try{const s=localStorage.getItem('cntp_sig_op_'+sectionId);return s||''}catch{return ''}})
  const [supName,setSupName]=useState(()=>{try{const s=localStorage.getItem('cntp_sig_sup_'+sectionId);return s||''}catch{return ''}})
  // Persist operator/supervisor names for convenience
  useEffect(()=>{
    try{localStorage.setItem('cntp_sig_op_'+sectionId, opName)}catch{}
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
// SECTION META + TABS + MAIN PAGE
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


// ── Standalone markBagConsumed — callable from any form component ─────────────
// Takes explicit sectionId and sessionId so it works outside SectionCaptureInner.
async function markBagConsumed(
  serialNumber: string,
  sectionId: string,
  sessionId: string | null,
  weightKg?: number
): Promise<void> {
  if (!serialNumber || serialNumber === 'NOT TRACKED' || !sessionId) return
  try {
    await getDb().schema('production').from('bag_tags').update({
      consumed_at_session: sessionId,
      consumed_at_section: sectionId,
      consumed_weight_kg:  weightKg ?? null,
    } as any).eq('serial_number', serialNumber)
  } catch (e) {
    console.warn('markBagConsumed failed for', serialNumber, e)
  }
}



// ── DebagBagRow — isolates BagScanner from the parent map() re-render ─────────
// BagScanner has useEffect([], []) that calls setCameraSupp on mount.
// If BagScanner remounts on every parent render (because onConfirm is a new
// arrow function from .map()), it loops forever. This component stabilises
// onConfirm via useCallback so BagScanner never remounts unnecessarily.
// SievingDebagRow matches the existing DebagRow type exactly
type SievingDebagRow = DebagRow
const SievingDebagBagRow = React.memo(function SievingDebagBagRow({
  row, idx, locked, sessionId, onUpdate, onRemove, canRemove,
}: {
  row: SievingDebagRow; idx: number; locked: boolean; sessionId: string|null
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
          {!locked && <BagScanner rowLabel={`Debagging bag ${idx+1}`} sessionId={sessionId} onConfirm={onConfirm}/>}
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

// Same pattern for Refining debagging rows
interface RefiningDebagRow {
  id: string; serial:string; date:string; con_org:string; grade:string; qty:string
}
const RefiningDebagBagRow = React.memo(function RefiningDebagBagRow({
  row, idx, locked, sectionId, onUpdate, onRemove, canRemove,
}: {
  row: RefiningDebagRow; idx: number; locked: boolean; sectionId: string
  onUpdate: (id:string, patch:Partial<RefiningDebagRow>) => void
  onRemove: (id:string) => void; canRemove: boolean
}) {
  const onConfirm = React.useCallback((result: ScanResult) => {
    onUpdate(row.id, {
      serial:  result.serial_number || row.serial,
      date:    result.tag_date      || row.date,
      con_org: result.variant       || row.con_org,
      qty:     result.weight_kg     || row.qty,
      grade:   result.product_type ? (row.grade || result.product_type) : row.grade,
    })
    if (result.serial_number)
      markBagConsumed(result.serial_number, sectionId, null, parseFloat(result.weight_kg||'0')||undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, sectionId, onUpdate])

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 items-end">
      <F label="Date"   value={row.date}    onChange={v=>onUpdate(row.id,{date:v})}    type="date" disabled={locked}/>
      <F label="Bag tag serial (from upstream)" value={row.serial}  onChange={v=>onUpdate(row.id,{serial:v.toUpperCase()})} ph="e.g. 04-05-01" disabled={locked}/>
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
        {!locked && <BagScanner rowLabel={`Bag ${idx+1}`} sessionId={null} onConfirm={onConfirm}/>}
        {canRemove && !locked && (
          <button onClick={()=>onRemove(row.id)} className="text-err/40 hover:text-err"><Trash2 size={13}/></button>
        )}
      </div>
    </div>
  )
})

// ── Stable module-level wrappers for forms that need extra props ──────────────
// These MUST be at module level (not inline) to preserve referential stability
// across renders. Inline arrow functions cause BagScanner's useEffect infinite loop.
function SievingFormWrapper({ locked, onData, savedData, shift, sessionId }: {
  locked:boolean; onData:(d:any)=>void; savedData?:any; shift?:string; sessionId?:string|null
}) {
  return <SievingForm locked={locked} onData={onData} savedData={savedData} shift={shift||'Morning'} sessionId={sessionId||null}/>
}

function PasteuriseurFormWrapper({ locked, onData, savedData, sessionId, dateParam, shift }: {
  locked:boolean; onData:(d:any)=>void; savedData?:any; sessionId?:string|null; dateParam?:string; shift?:string
}) {
  return <PasteuriseurForm locked={locked} onData={onData} savedData={savedData} sessionId={sessionId||null} dateParam={dateParam||''} shift={shift||'Morning'}/>
}

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

  // ── Save on page hide/unload to prevent data loss ────────────────────────
  useEffect(()=>{
    function onHide() {
      // Fire-and-forget save when page is hidden (tab switch, screen timeout, etc.)
      if (sessionId && Object.keys(formData).length > 0) {
        getDb().schema('production').from('prod_sessions').update({
          notes: JSON.stringify(formData), updated_at: new Date().toISOString()
        } as any).eq('id', sessionId).then(()=>{}).catch(()=>{})
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [sessionId, formData])

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
    return rows
  }

  // ── Build bag_tag rows — FULL genealogy chain ────────────────────────────────
  // Every bag that leaves a section with a serial gets a bag_tags row.
  // When that bag arrives at the next section, scanning auto-fills lot + product type.
  // NOT TRACKED bags: serial still recorded so weight is subtracted from stock.
  // ─────────────────────────────────────────────────────────────────────────────
  function buildBagTagRows(sid: string): any[] {
    const fd = formData
    const now = new Date().toISOString()
    const dateStr = dateParam
    const tags: any[] = []

    // Helper: push one tag row, skipping if no serial and no weight
    function pushTag(t: {
      section_id: string; section_name: string; product_type: string
      serial_number: string | null; lot_number: string | null; weight_kg: number | null
      variant?: string | null; acumatica_id?: string | null; destination?: string | null
    }) {
      // Need at least a weight to be meaningful
      if (!t.weight_kg || t.weight_kg <= 0) return
      // Serial defaults to NOT TRACKED for bulk/untracked bags
      const serial = (t.serial_number || '').trim() || 'NOT TRACKED'
      tags.push({
        ...t,
        serial_number:   serial,
        lot_number:      t.lot_number || (serial === 'NOT TRACKED' ? 'NOT TRACKED' : null),
        variant:         t.variant ?? 'C',
        acumatica_id:    t.acumatica_id ?? undefined,
        destination:     t.destination ?? undefined,
        tag_date:        dateStr,
        prod_session_id: sid,
        qr_payload:      serial !== 'NOT TRACKED' ? serial : null,
        captured_at:     now,
      })
    }

    // ── SIEVING TOWER ──────────────────────────────────────────────────────────
    if (sectionId === 'sieving') {
      // Fine Leaf → Blender col A (individual bags, tracked)
      ;(fd.flBags??[]).forEach((b:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Fine Leaf', serial_number:b.serial||null,
        lot_number:b.batch||null, weight_kg:parseFloat(b.kg)||null,
        acumatica_id:'S10LGE-C', destination:undefined,
      }))
      // Coarse Leaf → Blender col B (individual bags, tracked)
      ;(fd.clBags??[]).forEach((b:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Coarse Leaf', serial_number:b.serial||null,
        lot_number:b.batch||null, weight_kg:parseFloat(b.kg)||null,
        acumatica_id:'S10LGE-C', destination:undefined,
      }))
      // Indent Sticks → Refining 1 or Blender col E/F (per serial, NOT TRACKED lot)
      ;(fd.indentEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Indent Sticks', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        acumatica_id:'15IGIS-C', destination:undefined,
      }))
      // Rolsiev Sticks → Refining 1/2 or Blender (per serial, NOT TRACKED lot)
      ;(fd.rolsievEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Rolsiev Sticks', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        acumatica_id:'15IGST-C', destination:undefined,
      }))
      // Dust → Granule Line Brown/CP Dust column (bulk weight, NOT TRACKED per bag)
      ;(fd.dustEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'Sieving Dust', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        acumatica_id:undefined, destination:undefined,
      }))
      // RB Blocks → Blender col C/D or Refining
      ;(fd.rbEntries??[]).forEach((e:any) => pushTag({
        section_id:'sieving', section_name:'Sieving Tower',
        product_type:'RB Blocks', serial_number:e.serial||null,
        lot_number:'NOT TRACKED', weight_kg:parseFloat(e.kg)||null,
        acumatica_id:undefined, destination:undefined,
      }))
    }

    // ── REFINING 1 ─────────────────────────────────────────────────────────────
    // Outputs: Indent Dust (out1), White Dust (out2), other (out3)
    // All tracked with DD-MM-NN serial → goes to Granule Line
    if (sectionId === 'refining1') {
      ;['out1','out2','out3'].forEach((key, gi) => {
        ;(fd[key]??[]).forEach((r:any) => {
          if (!r.qty || parseFloat(r.qty) <= 0) return
          // Determine Acumatica ID from the output name/type
          const name = (r.name||'').toLowerCase()
          const acuId = name.includes('indent') ? '15IGDIS-C'
                      : name.includes('white')  ? '15IGDW-C'
                      : null
          // Destination: indent dust and white dust both go to Granule Line
          const dest = name.includes('indent') ? 'granule_indent_dust'
                     : name.includes('white')  ? 'granule_dust'
                     : 'granule_dust'
          pushTag({
            section_id:'refining1', section_name:'Refining 1',
            product_type: r.name || `Output ${gi+1}`,
            serial_number: r.serial||null,
            lot_number: r.serial || 'NOT TRACKED',
            weight_kg: parseFloat(r.qty)||null,
            acumatica_id: acuId,
            destination: dest,
          })
        })
      })
    }

    // ── REFINING 2 ─────────────────────────────────────────────────────────────
    // CHS Fine (rowsA) — tracked serial, → Blender col C/D/E/F
    // CHS Coarse (rowsB) — NOT TRACKED, → Blender
    // White Dust (rowsC) — NOT TRACKED, → Granule Line
    // Powder Dust (rowsD) — NOT TRACKED, → Granule Line
    if (sectionId === 'refining2') {
      const r2groups = [
        { key:'rowsA', type:'Cut Heavy Stick Fine',   acuId:'20BGCHS-F-C',     dest:undefined, tracked:true  },
        { key:'rowsB', type:'Cut Heavy Stick Coarse', acuId:'20BGCHS-C-C',     dest:undefined,       tracked:false },
        { key:'rowsC', type:'White Dust',             acuId:'15IGDW-C',        dest:undefined,  tracked:false },
        { key:'rowsD', type:'Powder Dust',            acuId:'15IGDPOWDR-C',    dest:undefined,  tracked:false },
      ]
      r2groups.forEach(({key, type, acuId, dest}) => {
        ;(fd[key]??[]).forEach((r:any) => pushTag({
          section_id:'refining2', section_name:'Refining 2',
          product_type: type,
          serial_number: r.serial||null,
          lot_number: r.serial||'NOT TRACKED',
          weight_kg: parseFloat(r.qty)||null,
          acumatica_id: acuId,
          destination: dest,
        }))
      })
    }

    // ── BLENDER ────────────────────────────────────────────────────────────────
    // Output: Blended Material → Pasteuriser
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
            serial_number: r.serial_no,
            lot_number: bfd.lotNo || fd.lotNo || null,
            weight_kg: parseFloat(r.kg)||null,
            variant: bfd.variantCode?.slice(0,1) || fd.variantCode?.slice(0,1) || 'C',
            acumatica_id:undefined,
            destination: 'pasteuriser',
          })
        })
      })
    }

    // ── GRANULE LINE ───────────────────────────────────────────────────────────
    // Output: SG Granule bags → dispatch / depot
    if (sectionId === 'granule') {
      ;(fd.bagRows??[]).forEach((r:any) => {
        if (!r.total_weight || parseFloat(r.total_weight) <= 0) return
        // bagRows may have multiple serial numbers space-separated in serial_numbers field
        const serials = (r.serial_numbers||'').split(/[\s,]+/).filter(Boolean)
        if (serials.length > 0) {
          serials.forEach((serial:string) => pushTag({
            section_id:'granule', section_name:'Granule Line',
            product_type: r.item || 'SG Granules',
            serial_number: serial,
            lot_number: r.lot_number || null,
            weight_kg: parseFloat(r.bag_weights) || parseFloat(r.total_weight)/Math.max(serials.length,1) || null,
            acumatica_id: (r.item||'').split(' — ')[0] || undefined,
            destination: 'depot',
          }))
        } else {
          // No serial yet — still record the weight as NOT TRACKED
          pushTag({
            section_id:'granule', section_name:'Granule Line',
            product_type: r.item || 'SG Granules',
            serial_number: null,
            lot_number: r.lot_number || 'NOT TRACKED',
            weight_kg: parseFloat(r.total_weight)||null,
            acumatica_id: (r.item||'').split(' — ')[0] || undefined,
            destination: 'depot',
          })
        }
      })
    }

    return tags
  }

  // markBagConsumed is a module-level function — called with explicit sectionId/sessionId
  async function saveDraft(){
    setSaving(true);setError(null)
    try{
      const sid=await ensureSession()
      // Handle multi-production wrapper — use merged totals across all productions
      const fd = formData
      const productions: any[] = fd.productions ?? [fd]
      const totalIn  = productions.reduce((s:number,p:any)=>s+(p?.data?.totalA??p?.data?.totalIn??p?.totalA??p?.totalIn??0),0)
      const totalOut = productions.reduce((s:number,p:any)=>s+(p?.data?.totalOut??p?.data?.totalOutput??p?.totalOut??p?.totalOutput??0),0)
      const variance = totalIn - totalOut

      // 1. Save notes JSON + structured metadata (always)
      const sessionMeta = {
        operator_names:    fd.shiftOps || fd.operators || fd.op1 || null,
        supervisor_name:   fd.supervisor || fd.mbSupervisor || null,
        op_signed:         fd.opSigned || false,
        sup_signed:        fd.supSigned || false,
        op_name_signoff:   fd.opName || null,
        sup_name_signoff:  fd.supName || null,
        comments:          fd.comments || null,
        lot_number:        fd.lotNo || fd.lotNumber || null,
        production_orders: productions.map((p:any)=>p?.data?.prodOrderId||p?.data?.blendCode||p?.prodOrderId||p?.blendCode||null).filter(Boolean),
      }
      await getDb().schema('production').from('prod_sessions').update({
        status:'draft', updated_at:new Date().toISOString(),
        notes:JSON.stringify(formData),
        ...(sessionMeta as any),
      } as any).eq('id',sid)

      // 2. Upsert mass balance
      await getDb().schema('production').from('prod_mass_balance').upsert({
        session_id:sid, total_input_kg:totalIn, total_output_b_kg:totalOut,
        balance_kg:variance, within_tolerance:Math.abs(variance)<=15,
        calculated_at:new Date().toISOString()
      } as any,{onConflict:'session_id'})

      // 3. Write structured debagging rows (delete + insert to stay idempotent)
      const debagRows = buildDebagRows(sid)
      if (debagRows.length > 0) {
        await getDb().schema('production').from('prod_debagging').delete().eq('session_id', sid)
        await getDb().schema('production').from('prod_debagging').insert(debagRows as any)
      }
      // 3b. Mark all input serials as consumed (covers manual entry + scan)
      //     This closes the genealogy chain: every bag_tags row has consumed_at_section filled
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
        ;(fd.debag??[]).forEach((r:any)=>{ if(r.serial) inputSerials.push({serial:r.serial, kg:parseFloat(r.qty)||undefined}) })
      }
      // Fire-and-forget — don't block save if these fail
      Promise.all(inputSerials.map(({serial, kg})=>markBagConsumed(serial, sectionId, sid, kg))).catch(()=>{})

      // 4. Write structured bagging rows (delete + insert)
      const bagRows = buildBagRows(sid)
      if (bagRows.length > 0) {
        await getDb().schema('production').from('prod_bagging').delete().eq('session_id', sid)
        await getDb().schema('production').from('prod_bagging').insert(bagRows as any)
      }

      // 5. Upsert bag_tags — one row per OUTPUT bag that has a serial number
      //    This is what the QR code scanner looks up at downstream sections.
      const bagTagRows = buildBagTagRows(sid)
      if (bagTagRows.length > 0) {
        for (const tag of bagTagRows) {
          if (!tag.serial_number) continue
          await getDb().schema('production').from('bag_tags').upsert(tag as any, { onConflict: 'serial_number' })
        }
      }

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
                  extraProps={{ shift, sessionId }}
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

              {/* Mass balance is inside each form component — no duplicate here */}

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
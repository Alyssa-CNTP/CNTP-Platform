'use client'
import { useState, useEffect, useRef } from 'react'
import * as React from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { format } from 'date-fns'
import { useLanguage } from '@/lib/i18n/context'

export function uid() { return crypto.randomUUID() }
export function num(v: string) { return parseFloat(v) || 0 }
export function nowTime() { return format(new Date(), 'HH:mm') }

// Auto-detect shift: morning 07:00–15:59, afternoon 16:00–00:59
export function detectShift(): 'Morning' | 'Afternoon' {
  const h = new Date().getHours()
  return h >= 7 && h < 16 ? 'Morning' : 'Afternoon'
}

export const CONV_OPTS    = ['CON', 'ORG', 'RA-CON', 'RA-ORG']
export const LOC_EXP_OPTS = ['Export', 'Export Blend', 'Domestic/Local', '']

export const INP = `w-full px-3 py-2.5 min-h-[44px] rounded-lg border bg-white text-[13px] text-text outline-none transition-all
  border-stone-200 focus:border-brand focus:ring-2 focus:ring-brand/10
  disabled:opacity-40 disabled:bg-stone-50 disabled:cursor-not-allowed`

// Numeric keyboard component for tablet use
export function NumKeyboard({ onKey, onClose }: { onKey:(k:string)=>void; onClose:()=>void }) {
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
export function useNumericField(initial: string) {
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

// ── Searchable select (combobox) — replaces native <select> for long lists ───
export function SearchableSelect({ value, onChange, opts, disabled, ph = 'Search or select…' }: {
  value: string; onChange: (v:string) => void; opts: string[]
  disabled?: boolean; ph?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  // Multi-word search: every space-separated word must appear somewhere in the option
  // "export conventional" matches "S10LGE-C — Sieved Leaf: Export - Conventional"
  const filtered = query.trim()
    ? (() => {
        const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
        return opts.filter(o => {
          const ol = o.toLowerCase()
          return words.every(w => ol.includes(w))
        })
      })()
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
          {displayVal || t(ph)}
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
              placeholder={t('Type to search…')}
              className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] outline-none focus:border-brand"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-3 text-[12px] text-stone-400 italic">{t('No match')}</div>
            )}
            {filtered.map((o, i) => (
              <div key={i} onClick={() => { onChange(o); setOpen(false); setQuery('') }}
                className={`px-4 py-3 text-[12px] cursor-pointer hover:bg-brand/5 hover:text-brand transition-colors ${o === value ? 'bg-brand/8 text-brand font-semibold' : 'text-stone-700'} ${o === '' ? 'text-stone-300 italic' : ''}`}>
                {o === '' ? t('— clear —') : o}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


export function F({
  label, value, onChange, type = 'text', opts, ph = '', disabled = false, wide = false, autoTimeOnFocus = false,
}: {
  label: string; value: string; onChange?: (v: string) => void
  type?: string; opts?: string[]; ph?: string; disabled?: boolean; wide?: boolean; autoTimeOnFocus?: boolean
}) {
  const { t } = useLanguage()
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
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">{t(label)}</label>
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

export function Card({ title, total, children, variant = 'default' }: {
  title: string; total?: number; children: React.ReactNode
  variant?: 'default' | 'input' | 'output' | 'info'
}) {
  const { t } = useLanguage()
  const hc = { default:'bg-stone-50 border-stone-200', input:'bg-sky-50 border-sky-200', output:'bg-emerald-50 border-emerald-200', info:'bg-amber-50 border-amber-200' }[variant]
  const ab = { default:'bg-stone-300', input:'bg-sky-400', output:'bg-emerald-500', info:'bg-amber-400' }[variant]
  const tc = { default:'text-stone-700', input:'text-sky-700', output:'text-emerald-700', info:'text-amber-700' }[variant]
  return (
    <div className="bg-white border border-stone-200 rounded-2xl shadow-sm">
      <div className={`flex items-center justify-between px-5 py-3 border-b ${hc} rounded-t-2xl`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-1 h-5 rounded-full ${ab}`}/>
          <span className="font-semibold text-[13px] text-stone-800 tracking-tight">{t(title)}</span>
        </div>
        {total !== undefined && <span className={`font-mono font-bold text-[14px] ${tc}`}>{total.toFixed(1)} kg</span>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

export function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button onClick={onClick}
      className="w-full py-2.5 border border-dashed border-stone-300 rounded-xl text-[12px] font-medium text-stone-400 hover:border-brand hover:text-brand hover:bg-brand/5 transition-all flex items-center justify-center gap-1.5">
      <Plus size={13}/> {t(label)}
    </button>
  )
}

// ── ProductionOrderSelect — grouped picker with code + description display ─────
// Each option format: "S10LGBL-C — Sieved Leaf: Export Blend - Conventional"
// Shows code prominently, description as secondary text, options grouped by type.
// Optional `groups` / `groupFn` override for non-sieving production orders.
export function parseOrder(opt: string) {
  const sep = opt.indexOf(' — ')
  if (sep === -1) return { code: opt, desc: '' }
  return { code: opt.slice(0, sep), desc: opt.slice(sep + 3) }
}
export function orderGroup(opt: string): string {
  const desc = parseOrder(opt).desc.toLowerCase()
  if (desc.includes('export blend')) return 'Export Blend'
  if (desc.includes('domestic'))     return 'Domestic / Local'
  if (desc.includes('export'))       return 'Export'
  return 'Other'
}
export const ORDER_GROUPS = ['Export Blend', 'Export', 'Domestic / Local', 'Other']

export function ProductionOrderSelect({ value, onChange, opts, disabled, groups, groupFn }: {
  value: string; onChange: (v: string) => void; opts: string[]; disabled?: boolean
  groups?:  string[]
  groupFn?: (opt: string) => string
}) {
  const resolvedGroups  = groups  ?? ORDER_GROUPS
  const resolvedGroupFn = groupFn ?? orderGroup

  const [open,  setOpen]  = React.useState(false)
  const [query, setQuery] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const words    = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = words.length
    ? opts.filter(o => { const ol = o.toLowerCase(); return words.every(w => ol.includes(w)) })
    : opts

  const parsed = value ? parseOrder(value) : null

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { if (!disabled) setOpen(o => !o) }}
        className={`${INP} flex items-center justify-between cursor-pointer gap-2 ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        style={{ minHeight: 44 }}>
        {parsed?.code ? (
          <div className="flex items-baseline gap-2 overflow-hidden min-w-0">
            <span className="font-mono font-bold text-[13px] text-brand flex-shrink-0">{parsed.code}</span>
            <span className="text-[11px] text-stone-400 truncate">{parsed.desc}</span>
          </div>
        ) : (
          <span className="text-stone-400 text-[12px]">Select production order…</span>
        )}
        <ChevronDown size={13} className="flex-shrink-0 text-stone-400"/>
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-stone-100">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search code or product…"
              className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] outline-none focus:border-brand"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!query && (
              <div onClick={() => { onChange(''); setOpen(false) }}
                className="px-4 py-2.5 text-[11px] text-stone-300 italic cursor-pointer hover:bg-stone-50">
                — clear selection —
              </div>
            )}
            {resolvedGroups.map(group => {
              const groupOpts = filtered.filter(o => o && resolvedGroupFn(o) === group)
              if (groupOpts.length === 0) return null
              return (
                <div key={group}>
                  <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-stone-400 bg-stone-50 border-y border-stone-100">{group}</div>
                  {groupOpts.map((o, i) => {
                    const { code, desc } = parseOrder(o)
                    const selected = o === value
                    return (
                      <div key={i} onClick={() => { onChange(o); setOpen(false); setQuery('') }}
                        className={`px-4 py-2.5 cursor-pointer hover:bg-brand/5 transition-colors flex items-center gap-3 ${selected ? 'bg-brand/5' : ''}`}>
                        <span className={`font-mono font-bold text-[12px] flex-shrink-0 ${selected ? 'text-brand' : 'text-stone-800'}`}>{code}</span>
                        <span className={`text-[11px] ${selected ? 'text-brand' : 'text-stone-400'}`}>{desc}</span>
                        {selected && <span className="ml-auto text-brand text-[11px] font-bold">✓</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {filtered.filter(o => o).length === 0 && (
              <div className="px-4 py-3 text-[12px] text-stone-400 italic">No match</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

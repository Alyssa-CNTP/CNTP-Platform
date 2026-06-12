'use client'

/**
 * /tags — Bag Tags
 * Reads directly from production.bag_tags and production.scan_events.
 * Comprehensive operations view: stats bar, quick scan lookup, tab views,
 * rich detail modal with genealogy chain and scan timeline.
 * Admin sees all sections. Operators see their own section only.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import {
  Search, X, Package, Printer, ArrowRight, Clock, ChevronRight,
  Filter, Activity, BarChart3, Layers, AlertTriangle, CheckCircle2,
  Loader2, Eye, Scan, TrendingUp, MapPin, History, Database,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface BagTag {
  id:                   string
  serial_number:        string
  section_id:           string
  section_name:         string
  product_type:         string
  lot_number:           string
  weight_kg:            number | null
  variant:              string | null
  tag_date:             string
  prod_session_id:      string
  acumatica_id:         string | null
  destination:          string | null
  consumed_at_section:  string | null
  consumed_at_session:  string | null
  consumed_weight_kg:   number | null
  captured_at:          string
  qr_payload:           string | null
}

interface ScanEvent {
  id:            string
  serial_number: string
  section_id:    string
  session_id:    string | null
  action:        string | null
  weight_kg:     number | null
  scanned_at:    string
}

// ── Barcode — Code 128 via JsBarcode injected once ────────────────────────────
let jsBarcodeLoaded = false
function ensureJsBarcode(): Promise<void> {
  if (jsBarcodeLoaded) return Promise.resolve()
  return new Promise((resolve) => {
    if ((window as any).JsBarcode) { jsBarcodeLoaded = true; resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js'
    s.onload = () => { jsBarcodeLoaded = true; resolve() }
    document.head.appendChild(s)
  })
}

function BarcodeDisplay({ value, width = 160 }: { value: string; width?: number }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => { ensureJsBarcode().then(() => setReady(true)) }, [])

  useEffect(() => {
    if (!ready || !svgRef.current) return
    try {
      ;(window as any).JsBarcode(svgRef.current, value, {
        format:       'CODE128',
        width:        1.6,
        height:       48,
        displayValue: false,
        margin:       4,
        lineColor:    '#111827',
        background:   'transparent',
      })
    } catch (e) {
      console.warn('Barcode render failed:', value, e)
    }
  }, [ready, value])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg ref={svgRef} style={{ width, height: 56 }} />
      <span className="font-mono text-[11px] font-bold text-stone-700 tracking-[0.1em]">{value}</span>
    </div>
  )
}

// ── Section colour pills ───────────────────────────────────────────────────────
const SECTION_PILL: Record<string, string> = {
  sieving:     'bg-blue-100 text-blue-700 border-blue-200',
  refining1:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  refining2:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  granule:     'bg-amber-100 text-amber-700 border-amber-200',
  blender:     'bg-purple-100 text-purple-700 border-purple-200',
  pasteuriser: 'bg-red-100 text-red-700 border-red-200',
}

const SECTION_DOT: Record<string, string> = {
  sieving:     'bg-blue-500',
  refining1:   'bg-emerald-600',
  refining2:   'bg-emerald-500',
  granule:     'bg-amber-500',
  blender:     'bg-purple-500',
  pasteuriser: 'bg-red-500',
}

const SECTIONS_LIST = [
  'sieving', 'refining1', 'refining2', 'granule', 'blender', 'pasteuriser',
]

const SECTION_DISPLAY: Record<string, string> = {
  sieving:     'Sieving Tower',
  refining1:   'Refining 1',
  refining2:   'Refining 2',
  granule:     'Granule Line',
  blender:     'Blender',
  pasteuriser: 'Pasteuriser',
}

// ── Variant pills ─────────────────────────────────────────────────────────────
const VARIANT_PILL: Record<string, { label: string; cls: string }> = {
  'Conventional':    { label: 'CON',    cls: 'bg-stone-100 text-stone-600 border-stone-200' },
  'Organic':         { label: 'ORG',    cls: 'bg-green-100 text-green-700 border-green-200' },
  'RA-Conventional': { label: 'RA-CON', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  'RA-Organic':      { label: 'RA-ORG', cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  'FT-ORG':          { label: 'FT',     cls: 'bg-amber-100 text-amber-700 border-amber-200' },
}

function VariantPill({ variant }: { variant: string | null }) {
  if (!variant) return null
  const v = VARIANT_PILL[variant] ?? { label: variant, cls: 'bg-stone-100 text-stone-500 border-stone-200' }
  return (
    <span className={`inline-flex items-center font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border ${v.cls}`}>
      {v.label}
    </span>
  )
}

function SectionPill({ sectionId, label }: { sectionId: string; label?: string }) {
  return (
    <span className={`inline-flex items-center font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border ${SECTION_PILL[sectionId] ?? 'bg-stone-100 text-stone-500 border-stone-200'}`}>
      {label ?? (SECTION_DISPLAY[sectionId] ?? sectionId)}
    </span>
  )
}

// ── Print single label ────────────────────────────────────────────────────────
function printTagLabel(tag: BagTag) {
  const win = window.open('', '_blank')
  if (!win) { alert('Allow pop-ups to print labels.'); return }
  const dateStr = tag.tag_date
    ? format(parseISO(tag.tag_date + 'T00:00:00'), 'dd-MM-yy')
    : '—'

  win.document.write(`<!DOCTYPE html><html><head>
  <meta charset="UTF-8"><title>CNTP Label ${tag.serial_number}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
  <style>
    @page { size: 100mm 60mm; margin: 3mm; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Helvetica Neue',Arial,sans-serif; font-size:10px; background:white; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .label { border:1.5px solid #374151; border-radius:4px; padding:4px 6px; height:54mm; display:flex; flex-direction:column; }
    .header { display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:0.5px solid #9ca3af; margin-bottom:3px; }
    .title { font-weight:700; font-size:11px; }
    .badge { font-size:8px; font-weight:700; border:1.5px solid #374151; padding:1px 5px; border-radius:2px; }
    .barcode { width:100%; height:40px; display:block; }
    .serial { font-family:'Courier New',monospace; font-size:13px; font-weight:700; text-align:center; letter-spacing:.1em; padding:2px 0 4px; border-bottom:0.5px solid #e5e7eb; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:0; }
    .cell { padding:3px 4px; border-right:0.5px solid #e5e7eb; }
    .cell:nth-child(even) { border-right:none; }
    .cell:nth-child(n+3) { border-top:0.5px solid #e5e7eb; }
    .lbl { font-size:7px; text-transform:uppercase; letter-spacing:.05em; color:#6b7280; }
    .val { font-family:'Courier New',monospace; font-size:10px; font-weight:700; color:#111; }
    .footer { display:flex; justify-content:space-between; margin-top:auto; padding-top:3px; border-top:0.5px solid #e5e7eb; font-size:8px; color:#6b7280; }
    .boxes { display:flex; gap:4px; align-items:center; }
    .box { display:inline-block; width:10px; height:10px; border:1.5px solid #374151; text-align:center; line-height:8px; font-size:8px; font-weight:700; }
  </style>
</head><body>
  <div class="label">
    <div class="header">
      <span class="title">${tag.section_name}: ${tag.product_type}</span>
      <span class="badge">${tag.variant || 'CON'}</span>
    </div>
    <svg id="bc" class="barcode"></svg>
    <div class="serial">${tag.serial_number}</div>
    <div class="grid">
      <div class="cell"><div class="lbl">Lot / Batch</div><div class="val">${tag.lot_number}</div></div>
      <div class="cell"><div class="lbl">Weight</div><div class="val">${tag.weight_kg ?? '—'} kg</div></div>
      <div class="cell"><div class="lbl">Date</div><div class="val">${dateStr}</div></div>
      <div class="cell"><div class="lbl">Acumatica</div><div class="val">${tag.acumatica_id || '—'}</div></div>
    </div>
    <div class="footer">
      <span>${tag.section_name}</span>
      <span class="boxes">
        CON <span class="box">${tag.variant === 'Conventional' ? '✕' : ' '}</span>
        ORG <span class="box">${tag.variant === 'Organic' ? '✕' : ' '}</span>
        RA  <span class="box">${(tag.variant || '').startsWith('RA') ? '✕' : ' '}</span>
      </span>
    </div>
  </div>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      JsBarcode('#bc', '${tag.serial_number}', { format:'CODE128', width:1.8, height:36, displayValue:false, margin:2, lineColor:'#111827', background:'transparent' });
      setTimeout(function(){ window.print(); }, 350);
    });
  </script>
</body></html>`)
  win.document.close()
}

// ── Tag detail modal ───────────────────────────────────────────────────────────
interface TagDetailProps {
  tag: BagTag
  allTags: BagTag[]
  onClose: () => void
}

function TagDetail({ tag, allTags, onClose }: TagDetailProps) {
  const [events,       setEvents]       = useState<ScanEvent[]>([])
  const [inputBags,    setInputBags]    = useState<BagTag[]>([])
  const [loadingEvts,  setLoadingEvts]  = useState(true)
  const [loadingGene,  setLoadingGene]  = useState(true)

  // Load scan events for this serial
  useEffect(() => {
    setLoadingEvts(true)
    getDb().schema('production').from('scan_events')
      .select('*')
      .eq('serial_number', tag.serial_number)
      .order('scanned_at', { ascending: true })
      .then(({ data }: { data: ScanEvent[] | null }) => {
        setEvents((data as ScanEvent[]) || [])
        setLoadingEvts(false)
      })
  }, [tag.serial_number])

  // Load genealogy: what bags were consumed to produce this bag
  useEffect(() => {
    if (!tag.prod_session_id) { setLoadingGene(false); return }
    setLoadingGene(true)

    getDb().schema('production').from('scan_events')
      .select('*')
      .eq('session_id', tag.prod_session_id)
      .eq('action', 'debagging_in')
      .then(({ data: evts }: { data: ScanEvent[] | null }) => {
        const serials = (evts || []).map(e => e.serial_number).filter(Boolean)
        if (serials.length === 0) { setLoadingGene(false); return }

        getDb().schema('production').from('bag_tags')
          .select('*')
          .in('serial_number', serials)
          .then(({ data: bags }: { data: BagTag[] | null }) => {
            setInputBags((bags as BagTag[]) || [])
            setLoadingGene(false)
          })
      })
  }, [tag.prod_session_id])

  const isConsumed = Boolean(tag.consumed_at_section)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Modal header ── */}
        <div className="sticky top-0 bg-white z-10 flex items-start justify-between px-5 pt-5 pb-4 border-b border-stone-100">
          <div className="flex items-start gap-3">
            <div className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${isConsumed ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            <div>
              <h2 className="font-mono font-bold text-[18px] text-stone-900 tracking-wider leading-none mb-1.5">
                {tag.serial_number}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <SectionPill sectionId={tag.section_id} label={tag.section_name} />
                <VariantPill variant={tag.variant} />
                <span className={`inline-flex font-mono text-[9px] font-bold px-2 py-0.5 rounded-full border ${isConsumed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  {isConsumed ? 'Consumed' : 'On floor'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              onClick={() => printTagLabel(tag)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-[12px] font-semibold hover:opacity-90 transition-opacity"
            >
              <Printer size={13} /> Print
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">

          {/* ── Barcode ── */}
          <div className="flex justify-center py-4 bg-stone-50 rounded-xl border border-stone-200">
            <BarcodeDisplay value={tag.serial_number} width={260} />
          </div>

          {/* ── Details grid ── */}
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-2.5">Details</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {([
                ['Product type',    tag.product_type],
                ['Lot / Batch',     tag.lot_number],
                ['Weight',          tag.weight_kg ? `${tag.weight_kg} kg` : '—'],
                ['Variant',         tag.variant || '—'],
                ['Tag date',        tag.tag_date ? format(parseISO(tag.tag_date + 'T00:00:00'), 'dd MMM yyyy') : '—'],
                ['Acumatica ID',    tag.acumatica_id || '—'],
                ['Session',         tag.prod_session_id || '—'],
                ['Destination',     tag.destination || '—'],
                ['Captured',        format(parseISO(tag.captured_at), 'dd MMM yyyy HH:mm')],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                  <div className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide mb-1">{l}</div>
                  <div className="font-mono text-[11px] font-bold text-stone-800 break-all">{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Genealogy chain ── */}
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
              <History size={11} /> Genealogy chain
            </p>

            {/* Inputs consumed to make this bag */}
            {loadingGene ? (
              <div className="flex items-center gap-2 text-[11px] text-stone-400 py-2">
                <Loader2 size={12} className="animate-spin" /> Loading inputs…
              </div>
            ) : inputBags.length > 0 ? (
              <div className="space-y-2 mb-3">
                <p className="text-[10px] text-stone-400 italic">Bags consumed to produce this bag:</p>
                {inputBags.map(ib => (
                  <div key={ib.id} className="flex items-center gap-2 bg-stone-50 rounded-lg px-3 py-2 border border-stone-100">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${SECTION_DOT[ib.section_id] ?? 'bg-stone-400'}`} />
                    <span className="font-mono text-[11px] font-bold text-stone-800 tracking-wider">{ib.serial_number}</span>
                    <SectionPill sectionId={ib.section_id} label={ib.section_name} />
                    <VariantPill variant={ib.variant} />
                    {ib.weight_kg && <span className="font-mono text-[10px] text-stone-500 ml-auto">{ib.weight_kg} kg</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-stone-400 italic mb-3">No input bags found for this session</p>
            )}

            {/* Movement chain: created at → consumed at */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${SECTION_DOT[tag.section_id] ?? 'bg-stone-400'}`} />
                <SectionPill sectionId={tag.section_id} label={tag.section_name} />
              </div>
              <ArrowRight size={12} className="text-stone-300 shrink-0" />
              {tag.consumed_at_section ? (
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${SECTION_DOT[tag.consumed_at_section] ?? 'bg-stone-400'}`} />
                  <SectionPill sectionId={tag.consumed_at_section} />
                  {tag.consumed_weight_kg && (
                    <span className="font-mono text-[10px] text-stone-500">{tag.consumed_weight_kg} kg</span>
                  )}
                </div>
              ) : (
                <span className="inline-flex font-mono text-[9px] font-bold px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                  On floor — not yet consumed
                </span>
              )}
            </div>
          </div>

          {/* ── Scan events timeline ── */}
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
              <Activity size={11} /> Scan events {loadingEvts ? '' : `(${events.length})`}
            </p>
            {loadingEvts ? (
              <div className="flex items-center gap-2 text-[11px] text-stone-400 py-2">
                <Loader2 size={12} className="animate-spin" /> Loading events…
              </div>
            ) : events.length === 0 ? (
              <p className="text-[11px] text-stone-400 italic">
                No scan events yet — will appear when scanned at downstream sections
              </p>
            ) : (
              <div className="relative">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-stone-100" />
                <div className="space-y-0">
                  {events.map((ev, i) => (
                    <div key={ev.id} className="flex items-start gap-3 pl-4 relative py-2 border-b border-stone-50 last:border-0">
                      <div className={`absolute left-0 top-3 w-3.5 h-3.5 rounded-full border-2 border-white shrink-0 ${SECTION_DOT[ev.section_id] ?? 'bg-stone-300'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] font-bold text-stone-800 capitalize">
                            {ev.action?.replace(/_/g, ' ') || 'scan'}
                          </span>
                          <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border ${SECTION_PILL[ev.section_id] ?? 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                            {ev.section_id}
                          </span>
                          {ev.weight_kg && (
                            <span className="font-mono text-[10px] text-stone-500">{ev.weight_kg} kg</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[10px] text-stone-400">
                            {format(parseISO(ev.scanned_at), 'dd MMM yyyy HH:mm:ss')}
                          </span>
                          <span className="text-[9px] text-stone-300">
                            · {formatDistanceToNow(parseISO(ev.scanned_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Serial lookup overlay ──────────────────────────────────────────────────────
const SERIAL_RE = /^[A-Z0-9]{2}-[A-Z0-9]{2}-\d{2,4}$/i

function SerialLookup({ allTags, onSelect }: { allTags: BagTag[]; onSelect: (tag: BagTag) => void }) {
  const [value,   setValue]   = useState('')
  const [result,  setResult]  = useState<BagTag | null | 'not_found'>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lookup = useCallback(async (serial: string) => {
    const s = serial.trim().toUpperCase()
    if (!s) { setResult(null); return }

    // Check local cache first
    const local = allTags.find(t => t.serial_number.toUpperCase() === s)
    if (local) { setResult(local); return }

    setLoading(true)
    const { data } = await getDb().schema('production').from('bag_tags')
      .select('*')
      .eq('serial_number', s)
      .limit(1)
      .maybeSingle()
    const mapped = data ? ({
      ...(data as any),
      id: (data as any).serial_number,
      section_name: SECTION_DISPLAY[(data as any).section_id] ?? (data as any).section_id,
      tag_date: ((data as any).created_at ?? '').slice(0, 10),
      captured_at: (data as any).created_at,
      prod_session_id: (data as any).session_id ?? '',
      qr_payload: (data as any).serial_number,
    } as BagTag) : null
    setResult(mapped ?? 'not_found')
    setLoading(false)
  }, [allTags])

  const handleChange = (v: string) => {
    setValue(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!v.trim()) { setResult(null); return }
    timerRef.current = setTimeout(() => lookup(v), 150)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (timerRef.current) clearTimeout(timerRef.current)
      lookup(value)
    }
  }

  const handleOpen = () => {
    if (result && result !== 'not_found') {
      onSelect(result)
      setValue('')
      setResult(null)
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Scan size={14} className="text-stone-400" />
        <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Quick scan / lookup</span>
        <span className="text-[10px] text-stone-300 ml-1">Type or scan a serial number (DD-MM-NN)</span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={value}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. SI-01-240510 or scan barcode…"
            autoComplete="off"
            spellCheck={false}
            className="w-full pl-4 pr-9 py-3 rounded-xl border border-stone-200 font-mono text-[14px] font-bold tracking-wider text-stone-900 placeholder:text-stone-300 placeholder:font-normal outline-none focus:border-stone-500 transition-colors"
          />
          {value && (
            <button
              onClick={() => { setValue(''); setResult(null) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {result && result !== 'not_found' && (
          <button
            onClick={handleOpen}
            className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-brand text-white text-[13px] font-semibold hover:opacity-90 transition-opacity shrink-0"
          >
            <Eye size={14} /> View
          </button>
        )}
      </div>

      {/* Inline result preview */}
      {loading && (
        <div className="flex items-center gap-2 mt-2.5 text-[12px] text-stone-400">
          <Loader2 size={12} className="animate-spin" /> Looking up…
        </div>
      )}
      {!loading && result === 'not_found' && (
        <div className="flex items-center gap-2 mt-2.5 text-[12px] text-stone-500">
          <AlertTriangle size={12} className="text-amber-400" />
          Serial <span className="font-mono font-bold">{value.trim().toUpperCase()}</span> not found in database
        </div>
      )}
      {!loading && result && result !== 'not_found' && (
        <div
          className="mt-2.5 flex items-center gap-3 bg-stone-50 rounded-xl border border-stone-200 px-3 py-2.5 cursor-pointer hover:border-stone-400 transition-colors"
          onClick={handleOpen}
        >
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${result.consumed_at_section ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          <span className="font-mono font-bold text-[13px] text-stone-900 tracking-wider">{result.serial_number}</span>
          <SectionPill sectionId={result.section_id} label={result.section_name} />
          <VariantPill variant={result.variant} />
          <span className="text-[11px] text-stone-600 font-semibold">{result.product_type}</span>
          {result.weight_kg && <span className="font-mono text-[11px] text-stone-500">{result.weight_kg} kg</span>}
          <span className={`ml-auto inline-flex font-mono text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${result.consumed_at_section ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            {result.consumed_at_section ? 'Consumed' : 'On floor'}
          </span>
          <ChevronRight size={13} className="text-stone-300 shrink-0" />
        </div>
      )}
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ tags }: { tags: BagTag[] }) {
  const total    = tags.length
  const onFloor  = tags.filter(t => !t.consumed_at_section).length
  const consumed = tags.filter(t =>  t.consumed_at_section).length

  const byCert: Record<string, number> = {}
  tags.forEach(t => {
    const v = VARIANT_PILL[t.variant ?? '']?.label ?? 'CON'
    byCert[v] = (byCert[v] || 0) + 1
  })
  const certOrder = ['CON', 'ORG', 'RA-CON', 'RA-ORG', 'FT']

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Total */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Database size={13} className="text-stone-400" />
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Total bags</span>
        </div>
        <div className="font-mono font-bold text-[26px] text-stone-900 leading-none">{total}</div>
        <div className="text-[10px] text-stone-400 mt-1">in current view</div>
      </div>

      {/* On floor */}
      <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <MapPin size={13} className="text-amber-500" />
          <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">On floor</span>
        </div>
        <div className="font-mono font-bold text-[26px] text-stone-900 leading-none">{onFloor}</div>
        <div className="text-[10px] text-stone-400 mt-1">not yet consumed</div>
      </div>

      {/* Consumed */}
      <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 size={13} className="text-emerald-500" />
          <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Consumed</span>
        </div>
        <div className="font-mono font-bold text-[26px] text-stone-900 leading-none">{consumed}</div>
        <div className="text-[10px] text-stone-400 mt-1">moved downstream</div>
      </div>

      {/* By variant */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Layers size={13} className="text-stone-400" />
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">By variant</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {certOrder.map(label => {
            const count = byCert[label]
            if (!count) return null
            const entry = Object.entries(VARIANT_PILL).find(([, v]) => v.label === label)
            const cls = entry ? entry[1].cls : 'bg-stone-100 text-stone-500 border-stone-200'
            return (
              <span key={label} className={`inline-flex items-center gap-1 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>
                {label} <span className="opacity-70">{count}</span>
              </span>
            )
          })}
          {Object.keys(byCert).length === 0 && <span className="text-[11px] text-stone-300">—</span>}
        </div>
      </div>
    </div>
  )
}

// ── Bag row ───────────────────────────────────────────────────────────────────
function BagRow({ tag, onClick }: { tag: BagTag; onClick: () => void }) {
  const isConsumed = Boolean(tag.consumed_at_section)
  return (
    <button
      onClick={onClick}
      className="w-full bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-stone-400 hover:shadow-sm transition-all text-left"
    >
      {/* Status dot */}
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isConsumed ? 'bg-emerald-400' : 'bg-amber-400'}`} />

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-mono font-bold text-[13px] text-stone-900 tracking-wider">
            {tag.serial_number}
          </span>
          <SectionPill sectionId={tag.section_id} label={tag.section_name} />
          <VariantPill variant={tag.variant} />
          {tag.acumatica_id && (
            <span className="font-mono text-[9px] text-stone-400 bg-stone-50 px-1.5 py-0.5 rounded border border-stone-200">
              {tag.acumatica_id}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-stone-500 flex-wrap">
          <span className="font-semibold text-stone-700">{tag.product_type}</span>
          <span className="text-stone-200">·</span>
          <span>Lot <span className="font-mono text-stone-700 font-semibold">{tag.lot_number}</span></span>
          {tag.weight_kg && (
            <><span className="text-stone-200">·</span><span className="font-mono">{tag.weight_kg} kg</span></>
          )}
        </div>
      </div>

      {/* Status + arrow */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`font-mono text-[9px] px-2 py-0.5 rounded-full font-bold border ${isConsumed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
          {isConsumed ? `→ ${tag.consumed_at_section}` : 'On floor'}
        </span>
        <ChevronRight size={12} className="text-stone-300" />
      </div>
    </button>
  )
}

// ── View: All Bags (grouped by date) ─────────────────────────────────────────
function AllBagsView({ tags, onSelect }: { tags: BagTag[]; onSelect: (t: BagTag) => void }) {
  const grouped = useMemo(() => {
    const g: Record<string, BagTag[]> = {}
    tags.forEach(t => {
      const d = t.tag_date || 'unknown'
      if (!g[d]) g[d] = []
      g[d].push(t)
    })
    return g
  }, [tags])

  const sortedDates = Object.keys(grouped).sort().reverse()

  if (tags.length === 0) return <EmptyState />

  return (
    <div className="space-y-5">
      {sortedDates.map(date => (
        <div key={date}>
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[10px] font-bold text-stone-400 uppercase tracking-wide">
              {date !== 'unknown'
                ? format(parseISO(date + 'T00:00:00'), 'EEEE d MMMM yyyy')
                : 'Unknown date'}
            </span>
            <div className="flex-1 h-px bg-stone-100" />
            <span className="font-mono text-[10px] text-stone-300">
              {grouped[date].length} bag{grouped[date].length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1.5">
            {grouped[date].map(tag => (
              <BagRow key={tag.id} tag={tag} onClick={() => onSelect(tag)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── View: On Floor (grouped by section) ──────────────────────────────────────
function OnFloorView({ tags, onSelect }: { tags: BagTag[]; onSelect: (t: BagTag) => void }) {
  const bySection = useMemo(() => {
    const g: Record<string, BagTag[]> = {}
    tags.filter(t => !t.consumed_at_section).forEach(t => {
      if (!g[t.section_id]) g[t.section_id] = []
      g[t.section_id].push(t)
    })
    return g
  }, [tags])

  const sections = SECTIONS_LIST.filter(s => bySection[s]?.length)

  if (sections.length === 0) return (
    <EmptyState
      icon={<MapPin size={36} className="text-stone-200" />}
      title="No bags on floor"
      subtitle="All bags in this view have been consumed downstream."
    />
  )

  return (
    <div className="space-y-6">
      {sections.map(sec => (
        <div key={sec}>
          <div className="flex items-center gap-3 mb-2.5">
            <div className={`w-2.5 h-2.5 rounded-full ${SECTION_DOT[sec] ?? 'bg-stone-400'}`} />
            <span className="font-semibold text-[13px] text-stone-800">
              {SECTION_DISPLAY[sec] ?? sec}
            </span>
            <div className="flex-1 h-px bg-stone-100" />
            <span className="font-mono text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
              {bySection[sec].length} on floor
            </span>
          </div>
          <div className="space-y-1.5">
            {bySection[sec].map(tag => (
              <BagRow key={tag.id} tag={tag} onClick={() => onSelect(tag)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── View: Consumed ────────────────────────────────────────────────────────────
function ConsumedView({ tags, onSelect }: { tags: BagTag[]; onSelect: (t: BagTag) => void }) {
  const consumed = useMemo(() => tags.filter(t => t.consumed_at_section), [tags])

  if (consumed.length === 0) return (
    <EmptyState
      icon={<CheckCircle2 size={36} className="text-stone-200" />}
      title="No consumed bags"
      subtitle="Bags will appear here after being scanned into a downstream session."
    />
  )

  return (
    <div className="space-y-1.5">
      {consumed.map(tag => (
        <BagRow key={tag.id} tag={tag} onClick={() => onSelect(tag)} />
      ))}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({
  icon    = <Package size={36} className="text-stone-200" />,
  title   = 'No bag tags found',
  subtitle = 'Tags are created when a session is saved with serial numbers entered.',
}: {
  icon?:     React.ReactNode
  title?:    string
  subtitle?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      {icon}
      <p className="font-mono text-[13px] text-stone-400">{title}</p>
      <p className="text-[11px] text-stone-300 text-center max-w-xs">{subtitle}</p>
    </div>
  )
}

// ── Filters strip ─────────────────────────────────────────────────────────────
interface Filters {
  search:   string
  section:  string
  date:     string
  status:   'all' | 'on_floor' | 'consumed'
  variant:  string
}

const VARIANTS = ['Conventional', 'Organic', 'RA-Conventional', 'RA-Organic', 'FT-ORG']

function FiltersStrip({
  filters,
  isOperator,
  onChange,
  onClear,
}: {
  filters:    Filters
  isOperator: boolean
  onChange:   (f: Partial<Filters>) => void
  onClear:    () => void
}) {
  const hasFilters =
    filters.search || filters.section !== 'all' || filters.date ||
    filters.status !== 'all' || filters.variant !== 'all'

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm space-y-3">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          value={filters.search}
          onChange={e => onChange({ search: e.target.value })}
          placeholder="Search serial number, lot, or product type…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-stone-200 text-[13px] outline-none focus:border-stone-500 transition-colors"
        />
        {filters.search && (
          <button
            onClick={() => onChange({ search: '' })}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Chips row */}
      <div className="flex items-end gap-2 flex-wrap">
        {!isOperator && (
          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide">Section</label>
            <select
              value={filters.section}
              onChange={e => onChange({ section: e.target.value })}
              className="px-3 py-2 rounded-xl border border-stone-200 text-[12px] outline-none bg-white focus:border-stone-400"
            >
              <option value="all">All sections</option>
              {SECTIONS_LIST.map(s => (
                <option key={s} value={s}>{SECTION_DISPLAY[s] ?? s}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide">From date</label>
          <input
            type="date"
            value={filters.date}
            onChange={e => onChange({ date: e.target.value })}
            className="px-3 py-2 rounded-xl border border-stone-200 text-[12px] outline-none bg-white focus:border-stone-400"
          />
        </div>

        <div className="flex flex-col gap-1 min-w-[110px]">
          <label className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide">Status</label>
          <select
            value={filters.status}
            onChange={e => onChange({ status: e.target.value as Filters['status'] })}
            className="px-3 py-2 rounded-xl border border-stone-200 text-[12px] outline-none bg-white focus:border-stone-400"
          >
            <option value="all">All status</option>
            <option value="on_floor">On floor</option>
            <option value="consumed">Consumed</option>
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide">Variant</label>
          <select
            value={filters.variant}
            onChange={e => onChange({ variant: e.target.value })}
            className="px-3 py-2 rounded-xl border border-stone-200 text-[12px] outline-none bg-white focus:border-stone-400"
          >
            <option value="all">All variants</option>
            {VARIANTS.map(v => (
              <option key={v} value={v}>{VARIANT_PILL[v]?.label ?? v} — {v}</option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <div className="flex items-end pb-0.5">
            <button
              onClick={onClear}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-stone-200 text-[12px] text-stone-500 hover:bg-stone-50 transition-colors"
            >
              <X size={11} /> Clear
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
type Tab = 'all' | 'on_floor' | 'consumed'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'all',      label: 'All bags',  icon: <Database  size={13} /> },
  { id: 'on_floor', label: 'On floor',  icon: <MapPin    size={13} /> },
  { id: 'consumed', label: 'Consumed',  icon: <CheckCircle2 size={13} /> },
]

// ── Main page ──────────────────────────────────────────────────────────────────
export default function TagsPage() {
  const { role, sectionId } = useAuth()
  const isOperator = role === 'section_operator'

  const [tags,     setTags]     = useState<BagTag[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<BagTag | null>(null)
  const [tab,      setTab]      = useState<Tab>('all')

  const [filters, setFilters] = useState<Filters>({
    search:  '',
    section: 'all',
    date:    '',
    status:  'all',
    variant: 'all',
  })

  const patchFilters = useCallback((patch: Partial<Filters>) => {
    setFilters(prev => ({ ...prev, ...patch }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({ search: '', section: 'all', date: '', status: 'all', variant: 'all' })
  }, [])

  // ── Load tags ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)

    let q = getDb()
      .schema('production')
      .from('bag_tags')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    // Operators see their section only
    if (isOperator && sectionId) q = q.eq('section_id', sectionId)
    if (!isOperator && filters.section !== 'all') q = q.eq('section_id', filters.section)
    if (filters.date) q = q.gte('created_at', filters.date)
    if (filters.status === 'on_floor')  q = q.is('consumed_at_section', null)
    if (filters.status === 'consumed')  q = q.not('consumed_at_section', 'is', null)

    const { data, error } = await q
    if (error) { console.error('bag_tags load error:', error); setLoading(false); return }

    // Map the current bag_tags schema onto the fields the UI expects.
    let rows: BagTag[] = ((data as any[]) || []).map(r => ({
      ...r,
      id:              r.serial_number,
      section_name:    SECTION_DISPLAY[r.section_id] ?? r.section_id,
      tag_date:        (r.created_at ?? '').slice(0, 10),
      captured_at:     r.created_at,
      prod_session_id: r.session_id ?? '',
      qr_payload:      r.serial_number,
    }))

    // Client-side search
    if (filters.search) {
      const s = filters.search.toLowerCase()
      rows = rows.filter(t =>
        t.serial_number.toLowerCase().includes(s) ||
        t.lot_number?.toLowerCase().includes(s) ||
        t.product_type?.toLowerCase().includes(s)
      )
    }

    // Client-side variant filter
    if (filters.variant !== 'all') {
      rows = rows.filter(t => t.variant === filters.variant)
    }

    setTags(rows)
    setLoading(false)
  }, [isOperator, sectionId, filters])

  useEffect(() => { load() }, [load])

  // Sync tab → status filter for convenience
  useEffect(() => {
    if (tab === 'on_floor')  patchFilters({ status: 'on_floor' })
    else if (tab === 'consumed') patchFilters({ status: 'consumed' })
    else patchFilters({ status: 'all' })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Counts for tab badges
  const onFloorCount  = useMemo(() => tags.filter(t => !t.consumed_at_section).length, [tags])
  const consumedCount = useMemo(() => tags.filter(t =>  t.consumed_at_section).length, [tags])

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shrink-0">
            <Package size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-[20px] text-stone-900 leading-none">Bag tags</h1>
            <p className="text-[11px] text-stone-400 mt-0.5">
              {loading ? 'Loading…' : `${tags.length} tag${tags.length !== 1 ? 's' : ''}`}
              {isOperator && sectionId && ` · ${SECTION_DISPLAY[sectionId] ?? sectionId} only`}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 text-[12px] text-stone-500 hover:bg-stone-50 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
          Refresh
        </button>
      </div>

      {/* ── Stats bar ── */}
      {!loading && <StatsBar tags={tags} />}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm animate-pulse">
              <div className="h-3 w-16 bg-stone-100 rounded mb-3" />
              <div className="h-7 w-10 bg-stone-100 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* ── Quick scan lookup ── */}
      <SerialLookup allTags={tags} onSelect={setSelected} />

      {/* ── Filters strip ── */}
      <FiltersStrip
        filters={filters}
        isOperator={isOperator}
        onChange={patchFilters}
        onClear={clearFilters}
      />

      {/* ── Tab bar ── */}
      <div className="flex gap-1 bg-stone-100 rounded-xl p-1">
        {TABS.map(t => {
          const count = t.id === 'on_floor' ? onFloorCount : t.id === 'consumed' ? consumedCount : tags.length
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all ${
                tab === t.id
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {t.icon}
              {t.label}
              {!loading && (
                <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full leading-none ${
                  tab === t.id ? 'bg-stone-100 text-stone-600' : 'bg-stone-200/60 text-stone-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Main content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-stone-400">
          <Loader2 size={20} className="animate-spin" />
          <span className="font-mono text-[13px]">Loading tags…</span>
        </div>
      ) : (
        <>
          {tab === 'all'      && <AllBagsView  tags={tags} onSelect={setSelected} />}
          {tab === 'on_floor' && <OnFloorView  tags={tags} onSelect={setSelected} />}
          {tab === 'consumed' && <ConsumedView tags={tags} onSelect={setSelected} />}
        </>
      )}

      {/* ── Tag detail modal ── */}
      {selected && (
        <TagDetail
          tag={selected}
          allTags={tags}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

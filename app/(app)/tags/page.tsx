'use client'

/**
 * /tags — Bag Tags
 * All generated serials with QR codes, filters, and print.
 * Admin sees all sections. Section operators see their own only.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO } from 'date-fns'
import { Search, Filter, Printer, X, ChevronRight, QrCode, Package } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface BagTag {
  id:          string
  serial:      string
  lot:         string
  section_id:  string
  section_name:string
  output_type: string   // FL, CL, RB, etc.
  kg:          number
  date:        string
  session_id:  string
  status:      'draft' | 'submitted' | 'approved'
}

// ── QR renderer (text-based, no external lib needed yet) ──────────────────────
function QRDisplay({ value, size = 120 }: { value: string; size?: number }) {
  // Render as a styled mono block for now — replace with qrcode.react later
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="bg-white border-2 border-stone-200 rounded-xl flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <div className="text-center px-2">
          <QrCode size={size * 0.45} className="text-stone-800 mx-auto mb-1" />
          <span className="font-mono text-[8px] text-stone-500 break-all leading-tight block">
            {value}
          </span>
        </div>
      </div>
      <span className="font-mono text-[10px] text-stone-500 text-center">{value}</span>
    </div>
  )
}

// ── Section colour ─────────────────────────────────────────────────────────────
const SECTION_COLOR: Record<string, string> = {
  sieving:     'bg-blue-100 text-blue-700 border-blue-200',
  refining1:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  refining2:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  granule:     'bg-amber-100 text-amber-700 border-amber-200',
  blender:     'bg-purple-100 text-purple-700 border-purple-200',
  pasteuriser: 'bg-red-100 text-red-700 border-red-200',
}

const OUTPUT_COLOR: Record<string, string> = {
  FL: 'bg-green-100 text-green-700',
  CL: 'bg-teal-100 text-teal-700',
  RB: 'bg-purple-100 text-purple-700',
  DU: 'bg-stone-100 text-stone-500',
}

// ── Detail modal ───────────────────────────────────────────────────────────────
function TagDetail({ tag, onClose }: { tag: BagTag; onClose: () => void }) {
  function printLabel() {
    const w = window.open('', '_blank', 'width=420,height=260')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><style>
      body{font-family:monospace;padding:20px;margin:0;background:#fff;}
      .serial{font-size:24px;font-weight:bold;letter-spacing:2px;margin-bottom:8px;}
      .row{font-size:13px;margin:4px 0;color:#444;}
      .divider{border-top:1px dashed #ccc;margin:10px 0;}
      .qr{font-size:11px;color:#888;margin-top:8px;}
    </style></head><body>
      <div class="serial">${tag.serial}</div>
      <div class="divider"></div>
      <div class="row"><b>Section:</b> ${tag.section_name}</div>
      <div class="row"><b>Product:</b> ${tag.output_type}</div>
      <div class="row"><b>Lot:</b> ${tag.lot}</div>
      <div class="row"><b>Weight:</b> ${tag.kg} kg</div>
      <div class="row"><b>Date:</b> ${format(parseISO(tag.date), 'dd MMM yyyy')}</div>
      <div class="row"><b>Status:</b> ${tag.status}</div>
      <div class="divider"></div>
      <div class="qr">ID: ${tag.id}</div>
      <script>window.onload=function(){window.print();setTimeout(()=>window.close(),500)}</script>
    </body></html>`)
    w.document.close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-[18px] text-stone-800 font-mono tracking-wider">
              {tag.serial}
            </h2>
            <span className={`inline-flex items-center font-mono text-[10px] font-bold px-2 py-0.5 rounded border mt-1 ${SECTION_COLOR[tag.section_id] ?? 'bg-stone-100 text-stone-600 border-stone-200'}`}>
              {tag.section_name}
            </span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400">
            <X size={18} />
          </button>
        </div>

        {/* QR code */}
        <div className="flex justify-center py-2">
          <QRDisplay value={tag.serial} size={140} />
        </div>

        {/* Details */}
        <div className="space-y-2">
          {[
            ['Product type', tag.output_type],
            ['Lot number',   tag.lot],
            ['Weight',       `${tag.kg} kg`],
            ['Date',         format(parseISO(tag.date), 'dd MMM yyyy')],
            ['Status',       tag.status],
            ['Session',      tag.session_id.slice(0, 8) + '…'],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between py-2 border-b border-stone-100 last:border-0">
              <span className="text-[12px] text-stone-500">{l}</span>
              <span className="text-[12px] font-medium text-stone-800 font-mono">{v}</span>
            </div>
          ))}
        </div>

        {/* Print button */}
        <button onClick={printLabel}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white font-medium text-[14px] hover:opacity-90 transition-opacity">
          <Printer size={16} /> Print label
        </button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function TagsPage() {
  const { role, sectionId } = useAuth()
  const db = getDb()

  const [tags,       setTags]       = useState<BagTag[]>([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState<BagTag | null>(null)
  const [search,     setSearch]     = useState('')
  const [filterSec,  setFilterSec]  = useState('all')
  const [filterDate, setFilterDate] = useState('')
  const [filterType, setFilterType] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    // Query prod_sessions joined to get bag data stored in notes JSON
    // Until prod_bagging table has individual rows, we read from session notes
    let q = db.schema('production').from('prod_sessions')
      .select('id, section_id, section_name, date, status, notes, updated_at')
      .order('date', { ascending: false })
      .limit(200)

    if (role === 'section_operator' && sectionId) {
      q = q.eq('section_id', sectionId)
    }
    if (filterSec !== 'all') q = q.eq('section_id', filterSec)
    if (filterDate) q = q.gte('date', filterDate)

    const { data } = await q
    const rows: BagTag[] = []

    ;(data ?? []).forEach((s: any) => {
      let notes: any = {}
      try { notes = JSON.parse(s.notes ?? '{}') } catch {}

      // Extract tracked bags from Sieving form data
      const trackedGroups: Array<[string, any[]]> = [
        ['RB Blocks', notes.rbBags ?? []],
        ['Fine Leaf',  notes.flBags ?? []],
        ['Coarse Leaf',notes.clBags ?? []],
      ]
      trackedGroups.forEach(([type, bags]) => {
        ;(bags as any[]).forEach(b => {
          if (!b.serial) return
          const prefix = type === 'RB Blocks' ? 'RB' : type === 'Fine Leaf' ? 'FL' : 'CL'
          rows.push({
            id:           b.id ?? s.id + b.serial,
            serial:       b.serial,
            lot:          b.lot ?? '',
            section_id:   s.section_id,
            section_name: s.section_name,
            output_type:  type,
            kg:           parseFloat(b.kg) || 0,
            date:         s.date,
            session_id:   s.id,
            status:       s.status,
          })
        })
      })
    })

    // Apply client-side filters
    let filtered = rows
    if (search)           filtered = filtered.filter(t => t.serial.toLowerCase().includes(search.toLowerCase()) || t.lot.toLowerCase().includes(search.toLowerCase()))
    if (filterType !== 'all') filtered = filtered.filter(t => t.output_type === filterType)

    setTags(filtered)
    setLoading(false)
  }, [role, sectionId, filterSec, filterDate, filterType, search])

  useEffect(() => { load() }, [load])

  const sections = ['all', 'sieving', 'refining1', 'refining2', 'granule', 'blender', 'pasteuriser']
  const types    = ['all', 'RB Blocks', 'Fine Leaf', 'Coarse Leaf']

  return (
    <div className="p-4 lg:p-6 max-w-4xl space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shrink-0">
          <QrCode size={18} className="text-white" />
        </div>
        <div>
          <h1 className="font-semibold text-[20px] text-stone-800">Bag tags</h1>
          <p className="text-[12px] text-stone-500">All generated serials · {tags.length} shown</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3 shadow-sm">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search serial or lot number…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-stone-200 text-[13px] text-stone-800 outline-none focus:border-brand"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"><X size={13} /></button>}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {/* Section filter — admin only */}
          {role !== 'section_operator' && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Section</label>
              <select value={filterSec} onChange={e => setFilterSec(e.target.value)}
                className="px-3 py-2 rounded-xl border border-stone-200 text-[12px] text-stone-800 outline-none focus:border-brand bg-white">
                {sections.map(s => <option key={s} value={s}>{s === 'all' ? 'All sections' : s}</option>)}
              </select>
            </div>
          )}

          {/* Date filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">From date</label>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 text-[12px] text-stone-800 outline-none focus:border-brand bg-white" />
          </div>

          {/* Type filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Type</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="px-3 py-2 rounded-xl border border-stone-200 text-[12px] text-stone-800 outline-none focus:border-brand bg-white">
              {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tag list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="font-mono text-[12px] text-stone-400 animate-pulse">Loading tags…</div>
        </div>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Package size={36} className="text-stone-200" />
          <p className="font-mono text-[13px] text-stone-400">No bag tags found</p>
          <p className="text-[11px] text-stone-300 text-center max-w-xs">
            Tags are generated when tracked bags are added in the production capture form.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map(tag => (
            <button key={tag.id} onClick={() => setSelected(tag)}
              className="w-full bg-white border border-stone-200 rounded-2xl p-4 flex items-center gap-4 hover:border-brand hover:shadow-sm transition-all text-left shadow-sm">

              {/* Mini QR placeholder */}
              <div className="w-12 h-12 bg-stone-50 border border-stone-200 rounded-xl flex items-center justify-center shrink-0">
                <QrCode size={22} className="text-stone-400" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-bold text-[14px] text-stone-800 tracking-wider">{tag.serial}</span>
                  <span className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded ${OUTPUT_COLOR[tag.serial.split('-')[0]] ?? 'bg-stone-100 text-stone-500'}`}>
                    {tag.output_type}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-stone-500">
                  <span>Lot: <span className="font-mono text-stone-700">{tag.lot || '—'}</span></span>
                  <span>·</span>
                  <span className="font-mono">{tag.kg} kg</span>
                  <span>·</span>
                  <span>{format(parseISO(tag.date), 'd MMM yyyy')}</span>
                </div>
                {role !== 'section_operator' && (
                  <span className={`inline-flex items-center font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border mt-1 ${SECTION_COLOR[tag.section_id] ?? 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                    {tag.section_name}
                  </span>
                )}
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`font-mono text-[9px] px-2 py-0.5 rounded-full font-bold ${
                  tag.status === 'approved'  ? 'bg-ok/10 text-ok' :
                  tag.status === 'submitted' ? 'bg-info/10 text-info' :
                  'bg-warn/10 text-warn'
                }`}>{tag.status}</span>
                <ChevronRight size={14} className="text-stone-300" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && <TagDetail tag={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
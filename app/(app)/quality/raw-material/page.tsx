'use client'

// app/(app)/quality/raw-material/page.tsx
//
// Raw Material workcenter — exact feature parity with CNTPquality Express app.
// Reads from qms.quality_records WHERE workcenter = 'rawMaterial'
// PDF upload → Express API /api/upload (Gemini extraction)
// All CRUD → Supabase qms schema directly
//
// Tabs: Overview · PA/TA Alkaloids · Residue / Pesticides · Glyphosate · Outstanding

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { isoDate, isoDateTime } from '@/lib/utils/formatDate'
import { RefreshCw, ChevronDown, ChevronUp, X, ExternalLink } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface QRecord {
  id:           number
  workcenter:   string
  workflow:     string
  batch_number: string | null
  data_json:    Record<string, any>
  file_name:    string | null
  file_path:    string | null
  comment:      string | null
  uploaded_by:  string | null
  created_at:   string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PA_SPEC_LEVELS = [
  { level:'P0', maxMgKg:0,    color:'#166534', bg:'#dcfce7', border:'#4ade80', label:'None detected',        desc:'0 µg/kg'                         },
  { level:'P1', maxMgKg:0.05, color:'#92400e', bg:'#fef3c7', border:'#fcd34d', label:'Trace',                desc:'1 – 50 µg/kg  (≤ 0.05 mg/kg)'   },
  { level:'P2', maxMgKg:0.2,  color:'#9a3412', bg:'#ffedd5', border:'#fb923c', label:'Low',                  desc:'51 – 200 µg/kg  (≤ 0.2 mg/kg)'  },
  { level:'P3', maxMgKg:0.4,  color:'#991b1b', bg:'#fee2e2', border:'#f87171', label:'Elevated — review',    desc:'201 – 400 µg/kg  (≤ 0.4 mg/kg)' },
  { level:'P4', maxMgKg:null, color:'#7f1d1d', bg:'#fef2f2', border:'#dc2626', label:'FAIL — exceeds limit', desc:'> 400 µg/kg  (> 0.4 mg/kg)'      },
]

const EU_GLYPHOSATE_MRL = 0.1

const R_COLORS: Record<string, [string, string, string]> = {
  R0: ['#f0fdf4','#166534','#4ade80'],
  R1: ['#fef9c3','#92400e','#fcd34d'],
  R2: ['#fef3c7','#b45309','#fbbf24'],
  R3: ['#fef2f2','#991b1b','#f87171'],
}

const PA_COLOR: Record<string, string> = { P0:'#166534', P1:'#92400e', P2:'#9a3412', P3:'#991b1b', P4:'#7f1d1d' }
const PA_BG:    Record<string, string> = { P0:'#dcfce7', P1:'#fef3c7', P2:'#ffedd5', P3:'#fee2e2', P4:'#fef2f2' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'px-3 py-1.5 border border-surface-rule rounded-lg font-mono text-[12px] text-text bg-surface-card outline-none focus:border-accent'
const lbl = 'block font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1'

function normBatch(b: string | null) {
  return (b ?? '').trim().replace(/_/g, '-').replace(/\s*-\s*/g, '-')
}

function calcPaLevel(ugKg: string | number): { level: string; status: string } {
  const v = parseFloat(String(ugKg))
  if (!v || isNaN(v) || v === 0) return { level:'P0', status:'PASS' }
  if (v <= 50)  return { level:'P1', status:'PASS' }
  if (v <= 200) return { level:'P2', status:'PASS' }
  if (v <= 400) return { level:'P3', status:'PASS' }
  return { level:'P4', status:'FAIL' }
}

function normLevel(level: string | null | undefined) {
  if (!level) return '—'
  if (level === 'FAIL') return 'P4'
  return level
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="font-mono text-[10px] text-text-faint">—</span>
  const s   = String(status).toUpperCase()
  const cls = s === 'PASS' || s === 'COMPLIES' ? 'badge-ok'
            : s === 'FAIL'   ? 'badge-err'
            : s === 'REVIEW' ? 'badge-warn'
            : 'badge-gray'
  return <span className={`badge ${cls}`}>{status}</span>
}

function PALevelBadge({ level }: { level: string | null | undefined }) {
  const l = normLevel(level)
  if (l === '—') return <span className="text-text-faint text-[11px]">—</span>
  const cls = l === 'P0' || l === 'P1' || l === 'P2' ? 'badge-ok'
            : l === 'P3' ? 'badge-warn'
            : 'badge-err'
  return <span className={`badge ${cls}`}>{l}</span>
}

function RGradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span className="text-text-faint text-[11px]">—</span>
  const g = grade.replace('R-', 'R')
  const [bg, fg, border] = R_COLORS[g] ?? ['#f3f4f6','#374151','#d1d5db']
  return (
    <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:12, fontWeight:700, fontSize:11, background:bg, color:fg, border:`1px solid ${border}` }}>
      {grade}
    </span>
  )
}

function KpiCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
      <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mb-1">{label}</div>
      <div className={`font-display font-bold text-[28px] ${color ?? 'text-text'}`}>{value}</div>
    </div>
  )
}

// ─── useSortFilter ────────────────────────────────────────────────────────────

function useSortFilter() {
  const [sortCol,      setSortCol]   = useState<string | null>(null)
  const [sortDir,      setSortDir]   = useState<'asc'|'desc'>('asc')
  const [colSearch,    setColSearch] = useState<Record<string,string>>({})
  const [activeSearch, setActiveSearch] = useState<string | null>(null)

  const toggleSort  = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const setSearch   = (col: string, val: string) => setColSearch(p => ({ ...p, [col]: val }))
  const clearSearch = (col: string) => setColSearch(p => { const n = { ...p }; delete n[col]; return n })
  const clearAll    = () => setColSearch({})

  const applyFilters = <T extends { _cells?: Record<string,any> }>(data: T[]): T[] => {
    let out = [...data]
    Object.entries(colSearch).forEach(([col, term]) => {
      if (!term) return
      const t = term.toLowerCase()
      out = out.filter(row => String((row as any)._cells?.[col] ?? '').toLowerCase().includes(t))
    })
    if (sortCol) {
      out.sort((a, b) => {
        const av = (a as any)._cells?.[sortCol] ?? ''
        const bv = (b as any)._cells?.[sortCol] ?? ''
        const an = parseFloat(av), bn = parseFloat(bv)
        const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }

  return { sortCol, sortDir, toggleSort, colSearch, setSearch, clearSearch, clearAll, activeSearch, setActiveSearch, applyFilters }
}

type SortHook = ReturnType<typeof useSortFilter>

// ─── SortableHeader ───────────────────────────────────────────────────────────

function SH({ col, label, hook, noUpper }: { col: string; label: string; hook: SortHook; noUpper?: boolean }) {
  const { sortCol, sortDir, toggleSort, colSearch, setSearch, clearSearch, activeSearch, setActiveSearch } = hook
  const isActive   = sortCol === col
  const hasSearch  = !!colSearch[col]
  const searchOpen = activeSearch === col
  const inputRef   = useRef<HTMLInputElement>(null)

  useEffect(() => { if (searchOpen && inputRef.current) inputRef.current.focus() }, [searchOpen])

  return (
    <th
      onClick={() => toggleSort(col)}
      className={`px-4 py-2.5 font-mono text-[10px] tracking-wide text-left whitespace-nowrap cursor-pointer select-none relative ${noUpper ? '' : 'uppercase'} ${isActive ? 'bg-brand/10' : hasSearch ? 'bg-info/8' : 'bg-surface'} text-text-muted border-b border-surface-rule`}
    >
      <div className="flex items-center gap-2 justify-between">
        <span>{label}</span>
        <div className="flex items-center gap-1">
          {hasSearch && <span className="text-[8px] bg-warn text-white rounded px-1 font-bold">F</span>}
          <span className={`text-[9px] ${isActive ? 'text-text' : 'text-text-faint'}`}>
            {isActive ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
          <button
            onClick={e => { e.stopPropagation(); setActiveSearch(searchOpen ? null : col) }}
            className="text-[9px] text-text-faint hover:text-text px-0.5"
            title="Search column"
          >🔍</button>
        </div>
      </div>
      {searchOpen && (
        <div
          className="absolute top-full left-0 z-50 bg-surface-card border border-surface-rule rounded-xl p-2 shadow-menu min-w-[160px]"
          onClick={e => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={colSearch[col] ?? ''}
            onChange={e => setSearch(col, e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { clearSearch(col); setActiveSearch(null) } }}
            placeholder={`Search ${label}…`}
            className="w-full px-2 py-1.5 border border-surface-rule rounded-lg text-[11px] text-text bg-surface-card outline-none font-mono"
          />
          {colSearch[col] && (
            <button
              onClick={() => { clearSearch(col); setActiveSearch(null) }}
              className="mt-1 w-full text-[10px] px-2 py-1 rounded border border-err/30 bg-err/8 text-err cursor-pointer"
            >
              Clear filter
            </button>
          )}
        </div>
      )}
    </th>
  )
}

// ─── ActiveFilters ────────────────────────────────────────────────────────────

function ActiveFilters({ hook }: { hook: SortHook }) {
  if (Object.keys(hook.colSearch).length === 0) return null
  return (
    <div className="flex gap-2 flex-wrap items-center mb-3">
      <span className="text-[10px] text-text-muted">Active filters:</span>
      {Object.entries(hook.colSearch).map(([col, val]) => (
        <span key={col} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-warn/8 text-warn border border-warn/20">
          {col}: "{val}"
          <button onClick={() => hook.clearSearch(col)} className="text-err font-bold leading-none ml-0.5">×</button>
        </span>
      ))}
      <button
        onClick={() => hook.clearAll()}
        className="text-[10px] px-2 py-0.5 rounded-full bg-err/8 text-err border border-err/20"
      >
        Clear all
      </button>
    </div>
  )
}

// ─── CommentCell ──────────────────────────────────────────────────────────────

function CommentCell({ record, onSave }: { record: QRecord; onSave: (id: number, c: string) => void }) {
  const db = getDb()
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(record.comment ?? '')

  async function save() {
    await db.schema('qms').from('quality_records').update({ comment: draft }).eq('id', record.id)
    onSave(record.id, draft)
    setEditing(false)
  }

  if (editing) return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        className="px-2 py-1 border border-surface-rule rounded font-mono text-[11px] w-36 outline-none focus:border-accent bg-surface-card text-text"
      />
      <button onClick={save} className="text-ok text-[11px] font-bold">✓</button>
      <button onClick={() => setEditing(false)} className="text-text-muted text-[11px]">✕</button>
    </div>
  )

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-[11px] text-text-muted hover:text-text max-w-[140px] truncate text-left"
    >
      {record.comment ?? <span className="text-text-faint italic">add note</span>}
    </button>
  )
}

// ─── PDF DropZone ─────────────────────────────────────────────────────────────

type QueueStatus = 'pending' | 'processing' | 'done' | 'error' | 'duplicate'

interface QueueItem {
  id:      string
  file:    File
  status:  QueueStatus
  message: string
  dupData: any | null
}

function DropZone({ workcenter, workflow, onSuccess }: { workcenter: string; workflow: string; onSuccess: () => void }) {
  const { session } = useAuth()
  const [drag,  setDrag]  = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const processing = useRef(false)

  // Upload goes to Next.js API route — no external service needed

  const WF_LABELS: Record<string, string> = {
    pa_ta_analysis: 'PA/TA Alkaloids',
    residue:        'Residue / Pesticides',
    glyphosate:     'Glyphosate',
  }

  async function uploadFile(file: File, forceSave = false, isRetest = false) {
    const fd = new FormData()
    fd.append('pdf',        file)
    fd.append('workcenter', workcenter)
    fd.append('workflow',   workflow)
    if (forceSave) fd.append('force_save', 'true')
    if (isRetest)  fd.append('is_retest',  'true')
    const res  = await fetch('/api/upload', {
      method: 'POST',
      body:   fd,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload failed')
    return data
  }

  async function processQueue(items: QueueItem[]) {
    if (processing.current) return
    processing.current = true
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'processing' } : x))
      try {
        const data = await uploadFile(item.file)
        if (data.duplicate_warning) {
          const dups = data.duplicate_batches ?? []
          let reason = data.message ?? 'A record with this batch number already exists.'
          if (dups.length > 0) {
            reason += '\n' + dups.map((d: any) => `• ${d.batch_number} (uploaded ${String(d.existing_date ?? '?').slice(0,10)} from ${d.existing_file ?? 'unknown'})`).join('\n')
          }
          setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'duplicate', message: reason, dupData: data } : x))
        } else {
          const saved = data.records_saved ?? 0
          const batches = (data.batch_numbers ?? []).join(', ')
          setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'done', message: `✅ Saved ${saved} record(s): ${batches}` } : x))
          onSuccess()
        }
      } catch (err: any) {
        setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'error', message: `❌ ${err.message}` } : x))
      }
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 2500))
    }
    processing.current = false
  }

  function addFiles(fl: FileList | null) {
    if (!fl) return
    const pdfs = Array.from(fl).filter(f => f.type === 'application/pdf')
    if (!pdfs.length) { alert('Please select PDF files only.'); return }
    const newItems: QueueItem[] = pdfs.map(f => ({ id: Math.random().toString(36).slice(2), file: f, status: 'pending', message: '', dupData: null }))
    setQueue(prev => { const next = [...prev, ...newItems]; setTimeout(() => processQueue(newItems), 0); return next })
  }

  async function forceSave(item: QueueItem) {
    setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'processing', dupData: null } : x))
    try {
      const data = await uploadFile(item.file, true)
      setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'done', message: `✅ Overwritten — ${data.records_saved} record(s): ${(data.batch_numbers ?? []).join(', ')}` } : x))
      onSuccess()
    } catch (err: any) {
      setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'error', message: `❌ ${err.message}` } : x))
    }
  }

  async function saveAsRetest(item: QueueItem) {
    setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'processing', dupData: null } : x))
    try {
      const data = await uploadFile(item.file, false, true)
      setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'done', message: `🔁 Saved as retest — ${data.records_saved} record(s): ${(data.batch_numbers ?? []).join(', ')}` } : x))
      onSuccess()
    } catch (err: any) {
      setQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'error', message: `❌ ${err.message}` } : x))
    }
  }

  const busy = queue.some(x => x.status === 'processing')

  const itemBg = (status: QueueStatus) =>
    status === 'done'      ? 'bg-ok/5 border-ok/20'   :
    status === 'error'     ? 'bg-err/5 border-err/20'  :
    status === 'duplicate' ? 'bg-warn/8 border-warn/30' :
    'bg-surface border-surface-rule'

  const itemIcon = (status: QueueStatus) =>
    status === 'processing' ? '⏳' : status === 'done' ? '✅' : status === 'error' ? '❌' : status === 'duplicate' ? '⚠️' : '🕐'

  return (
    <div className="mb-4">
      {/* Drop target */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files) }}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${drag ? 'border-accent bg-accent-bg' : busy ? 'border-surface-rule bg-surface animate-pulse' : 'border-surface-rule hover:border-accent/40 hover:bg-surface'}`}
      >
        {busy ? (
          <>
            <div className="w-6 h-6 border-2 border-surface-rule border-t-accent rounded-full animate-spin mx-auto mb-2" />
            <p className="font-semibold text-[13px] text-text-muted">Extracting with Gemini…</p>
            <p className="text-[11px] text-text-faint mt-1">Please wait — 10–20 seconds per file</p>
          </>
        ) : (
          <>
            <div className="text-2xl mb-1">📄</div>
            <p className="font-semibold text-[13px] text-text-muted">
              Drop {WF_LABELS[workflow] ?? workflow} PDF(s) here
            </p>
            <p className="text-[11px] text-text-faint mb-3">Drop multiple PDFs at once · or click to browse</p>
            <span className="inline-block px-4 py-1.5 rounded-lg bg-brand text-white text-[12px] font-semibold">Browse PDFs</span>
            <input
              type="file" accept="application/pdf" multiple
              onChange={e => { addFiles(e.target.files); e.currentTarget.value = '' }}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </>
        )}
      </div>

      {/* Queue status */}
      {queue.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          {queue.map(item => (
            <div key={item.id} className={`rounded-xl border px-4 py-3 text-[12px] ${itemBg(item.status)}`}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0">{itemIcon(item.status)}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text mb-0.5">{item.file.name}</div>
                  {item.message && (
                    <div className="text-text-muted whitespace-pre-line text-[11px]">{item.message}</div>
                  )}
                  {item.status === 'duplicate' && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <button onClick={() => forceSave(item)} className="px-3 py-1 rounded-lg bg-err text-white text-[11px] font-semibold">Overwrite</button>
                      <button onClick={() => saveAsRetest(item)} className="px-3 py-1 rounded-lg bg-info text-white text-[11px] font-semibold">Save as retest</button>
                      <button onClick={() => setQueue(q => q.filter(x => x.id !== item.id))} className="px-3 py-1 rounded-lg border border-surface-rule text-text-muted text-[11px]">Skip</button>
                    </div>
                  )}
                </div>
                {item.status !== 'processing' && item.status !== 'duplicate' && (
                  <button onClick={() => setQueue(q => q.filter(x => x.id !== item.id))} className="text-text-faint hover:text-text flex-shrink-0">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── PA Spec Panel ────────────────────────────────────────────────────────────

function PASpecPanel() {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[13px] text-text">PA Level Specifications</span>
          <span className="text-[11px] text-text-muted">EU Regulation — click to expand</span>
        </div>
        {open ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
      </button>
      {open && (
        <div className="px-5 pb-5">
          <div className="overflow-x-auto rounded-xl border border-surface-rule">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="bg-brand">
                  {['PA Level','Range (µg/kg)','Max (mg/kg)','Classification','Action Required'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-white font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-rule">
                {PA_SPEC_LEVELS.map((row, i) => (
                  <tr key={row.level} className={i % 2 === 0 ? 'bg-surface-card' : 'bg-surface'}>
                    <td className="px-4 py-2.5">
                      <span style={{ display:'inline-flex', alignItems:'center', padding:'2px 10px', borderRadius:12, fontWeight:700, fontSize:11, background:row.bg, color:row.color, border:`1px solid ${row.border}` }}>
                        {row.level}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-text">{row.desc}</td>
                    <td className="px-4 py-2.5 font-mono text-text-muted">{row.maxMgKg != null ? `≤ ${row.maxMgKg}` : '> 0.4'}</td>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: row.color }}>{row.label}</td>
                    <td className="px-4 py-2.5 text-text-muted text-[11px]">
                      {row.level === 'P0' ? 'No action required'
                      : row.level === 'P1' ? 'No action required — within EU limits'
                      : row.level === 'P2' ? 'Monitor — still within EU MRL'
                      : row.level === 'P3' ? 'Review required — close to limit'
                      : 'Reject batch — exceeds EU MRL of 0.4 mg/kg'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 px-4 py-2.5 bg-info/8 border border-info/20 rounded-lg text-[11px] text-info">
            EU MRL for Pyrrolizidine Alkaloids (PAs) in herbal teas: <strong>0.4 mg/kg (400 µg/kg)</strong> — Commission Regulation (EU) 2020/2040
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PA/TA Table ──────────────────────────────────────────────────────────────

function PATable({ records, isAdmin, onRefresh, onComment }: {
  records:   QRecord[]
  isAdmin:   boolean
  onRefresh: () => void
  onComment: (id: number, c: string) => void
}) {
  const db         = getDb()
  const hook       = useSortFilter()
  const [search,   setSearch]    = useState('')
  const [alkSearch, setAlkSearch] = useState('')

  async function deleteRecord(id: number, batchNo: string | null) {
    if (!confirm(`Delete record for batch ${batchNo ?? 'unknown'}? Cannot be undone.`)) return
    await db.schema('qms').from('quality_records').delete().eq('id', id)
    onRefresh()
  }

  const filtered = records.filter(r => {
    const s = alkSearch.toLowerCase().trim() || search.toLowerCase().trim()
    if (!s) return true
    if ((r.batch_number ?? '').toLowerCase().includes(s)) return true
    const alkaloids = r.data_json?.individual_alkaloids ?? {}
    const hasAlkaloid = Object.entries(alkaloids).some(([name, val]) =>
      name.toLowerCase().includes(s) && (val as number) > 0
    )
    // Also check alkaloid_list / alkaloids array format
    const alkaloidArr: any[] = r.data_json?.alkaloid_list || r.data_json?.alkaloids || []
    const hasInArr = Array.isArray(alkaloidArr) && alkaloidArr.some((a: any) =>
      (a.name || a.alkaloid || '').toLowerCase().includes(s) && ((a.value ?? a.result) ?? 0) > 0
    )
    return hasAlkaloid || hasInArr
  })

  const baseRows = filtered.map(r => {
    const d     = r.data_json
    const ugKg  = d.total_pa_ug_kg
    const mg    = d.total_pa_mg_kg ?? (ugKg != null ? parseFloat((ugKg / 1000).toFixed(4)) : null)
    const level = normLevel(d.pa_level || (d.pa_status === 'FAIL' ? 'P4' : null))
    return {
      ...r, _mg: mg, _level: level,
      _cells: {
        batch:       r.batch_number ?? '',
        report:      d.report_name  ?? '',
        sample_list: d.sample_list  ?? '',
        po:          d.purchase_order ?? '',
        pa_ug:       ugKg ?? '',
        pa_mg:       mg ?? '',
        pa_level:    level,
        pa_status:   d.pa_status ?? '',
        ta_ug:       d.total_ta_ug_kg ?? '',
        ta_status:   d.ta_status ?? '',
        date:        r.created_at?.slice(0,10) ?? '',
      },
    }
  })

  const rows = hook.applyFilters(baseRows)

  return (
    <>
      <PASpecPanel />
      <ActiveFilters hook={hook} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Total Samples" value={records.length} />
        <KpiCard label="Pass"          value={records.filter(r => r.data_json?.pa_status === 'PASS').length} color="text-ok"   />
        <KpiCard label="Fail"          value={records.filter(r => r.data_json?.pa_status === 'FAIL').length} color="text-err"  />
        <KpiCard label="P3 or above"   value={records.filter(r => ['P3','P4','FAIL'].includes(r.data_json?.pa_level ?? '')).length} color="text-warn" />
      </div>

      {/* Cross-batch alkaloid search */}
      <div className={`mb-3 p-3 rounded-xl border-2 transition-colors ${alkSearch ? 'border-warn/50 bg-warn/5' : 'border-surface-rule bg-surface'}`}>
        <div className="flex gap-2 items-center flex-wrap">
          <span className="font-bold text-[12px] text-text whitespace-nowrap">🔬 Search Alkaloid / PA Name across all batches</span>
          <input
            value={alkSearch}
            onChange={e => { setAlkSearch(e.target.value); setSearch('') }}
            placeholder="e.g. Senecionine, Jacobine, Echimidine, Lasiocarpine…"
            className="flex-1 min-w-[260px] px-3 py-1.5 border-2 border-warn/40 rounded-lg text-[12px] font-mono outline-none bg-surface-card text-text focus:border-warn"
          />
          {alkSearch && (
            <button onClick={() => setAlkSearch('')} className="px-3 py-1.5 rounded-lg border border-err/30 bg-err/8 text-err text-[11px] font-bold">✕ Clear</button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setAlkSearch('') }}
          placeholder="Search batch number…"
          className={`${inp} flex-1 min-w-[180px]`}
        />
        <button
          onClick={() => {
            const hdrs = ['Batch No.','Report','Sample List','PO','Total PA (µg/kg)','Total PA (mg/kg)','PA Level','PA Status','Total TA (µg/kg)','TA Status','Date']
            const rowData = rows.map((r: any) => {
              const d = r.data_json
              return [
                r.batch_number??'', d.report_name??'', d.sample_list??'', d.purchase_order??'',
                d.total_pa_ug_kg??'', r._mg??'', r._level??'', d.pa_status??'',
                d.total_ta_ug_kg??'', d.ta_status??'', r.created_at?.slice(0,10)??'',
              ]
            })
            const csv = [hdrs,...rowData].map(row=>row.map((v:any)=>{const s=String(v??'');return s.includes(',')||s.includes('"')?`"${s.replace(/"/g,'""')}"`:`${s}`}).join(',')).join('\n')
            const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,%EF%BB%BF'+encodeURIComponent(csv);a.download=`pa_ta_results_${new Date().toISOString().slice(0,10)}.csv`;a.click()
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-text text-[12px]">
          ⬇ Export CSV
        </button>
      </div>

      <ActiveFilters hook={hook} />

      {/* Table */}
      <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
          <span className="font-semibold text-[14px] text-text">PA/TA Analysis Results</span>
          <span className="text-[11px] text-text-muted">{rows.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {isAdmin && <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule w-16">Actions</th>}
                <SH col="batch"       label="Batch No."        hook={hook} />
                <SH col="report"      label="Report"           hook={hook} />
                <SH col="sample_list" label="Sample List"      hook={hook} />
                <SH col="po"          label="PO"               hook={hook} />
                <SH col="pa_ug"       label="Total PA (µg/kg)" hook={hook} noUpper />
                <SH col="pa_mg"       label="Total PA (mg/kg)" hook={hook} noUpper />
                <SH col="pa_level"    label="PA Level"         hook={hook} />
                <SH col="pa_status"   label="Export PA Status" hook={hook} />
                <SH col="ta_ug"       label="Total TA"         hook={hook} />
                <SH col="ta_status"   label="TA Status"        hook={hook} />
                <SH col="date"        label="Date"             hook={hook} />
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Source File</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 14 : 13} className="text-center py-10 text-text-muted text-[12px]">
                    No records found
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const d = r.data_json
                return (
                  <tr key={r.id} className={`hover:bg-surface transition-colors ${i % 2 === 1 ? 'bg-surface/30' : ''}`}>
                    {isAdmin && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button
                          onClick={() => deleteRecord(r.id, r.batch_number)}
                          className="px-2 py-0.5 rounded border border-err/30 bg-err/8 text-err text-[10px] cursor-pointer"
                        >🗑</button>
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <span className="font-mono font-semibold text-[12px] text-text">{r.batch_number}</span>
                      {d.is_retest && (
                        <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/20 font-bold">
                          🔁 RETEST
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted">{d.report_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted">{d.sample_list ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted">{d.purchase_order ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text">
                      <span
                        title={(d.total_pa_table1 != null || d.total_pa_table2 != null)
                          ? `Table 1: ${d.total_pa_table1 ?? 0} µg/kg  Table 2: ${d.total_pa_table2 ?? 0} µg/kg  Combined: ${d.total_pa_ug_kg ?? 0} µg/kg`
                          : undefined}>
                        {d.total_pa_ug_kg ?? <span className="text-text-faint">ND</span>}
                        {(d.total_pa_table1 != null || d.total_pa_table2 != null) && <span className="text-[8px] text-text-faint ml-0.5">ⓘ</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text">
                      {r._mg ?? <span className="text-text-faint">ND</span>}
                    </td>
                    <td className="px-4 py-2.5"><PALevelBadge level={r._level} /></td>
                    <td className="px-4 py-2.5"><StatusBadge status={d.pa_status} /></td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text-muted">
                      {d.total_ta_ug_kg ?? <span className="text-text-faint">ND</span>}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={d.ta_status} /></td>
                    <td className="px-4 py-2.5 text-[11px] text-text-faint font-mono">{r.created_at?.slice(0,10)}</td>
                    <td className="px-4 py-2.5">
                      {r.file_name && <span className="text-[11px] text-info font-mono">{r.file_name}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <CommentCell record={r} onSave={onComment} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── Residue Table ────────────────────────────────────────────────────────────

function ResidueTable({ records, isAdmin, onRefresh, onComment }: {
  records:   QRecord[]
  isAdmin:   boolean
  onRefresh: () => void
  onComment: (id: number, c: string) => void
}) {
  const db   = getDb()
  const hook = useSortFilter()
  const [search,      setSearch]      = useState('')
  const [sf,          setSf]          = useState('ALL')
  const [syncing,     setSyncing]     = useState(false)
  const [syncResult,  setSyncResult]  = useState('')
  const [enriching,   setEnriching]   = useState(false)
  const [enrichResult,setEnrichResult]= useState('')
  const [mrlUploading,setMrlUploading]= useState(false)
  const mrlFileRef = useRef<HTMLInputElement>(null)
  // Upload goes to Next.js API route — no external service needed

  async function uploadEuMrlFile(file: File) {
    setMrlUploading(true); setSyncResult('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/eu-mrl-sync/upload', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSyncResult(`✓ ${d.message ?? 'EU MRLs imported'}`)
    } catch (e: any) { setSyncResult('✗ ' + e.message) }
    finally { setMrlUploading(false); if (mrlFileRef.current) mrlFileRef.current.value = '' }
  }

  async function deleteRecord(id: number) {
    if (!confirm('Delete this record?')) return
    await db.schema('qms').from('quality_records').delete().eq('id', id)
    onRefresh()
  }

  const compLo    = (hook.colSearch['compound'] ?? '').toLowerCase().trim()
  const searchLo  = search.toLowerCase().trim()

  let preFilter = records.filter(r => {
    if (compLo) {
      const cpds = r.data_json?.compounds_detected ?? []
      return cpds.some((c: any) => (c.compound_name ?? '').toLowerCase().includes(compLo))
    }
    if (!searchLo) return true
    if ((r.batch_number ?? '').toLowerCase().includes(searchLo)) return true
    const cpds = r.data_json?.compounds_detected ?? []
    return cpds.some((c: any) => (c.compound_name ?? '').toLowerCase().includes(searchLo))
  })
  if (sf !== 'ALL') preFilter = preFilter.filter(r => r.data_json?.overall_status === sf)

  // Expand to one row per compound
  const expandedRows: any[] = []
  preFilter.forEach(r => {
    const d         = r.data_json
    const cpds      = d.compounds_detected ?? []
    const detCount  = d.total_detections  ?? cpds.length
    const excCount  = d.total_exceedances ?? cpds.filter((c: any) => c.eu_mrl_exceeded).length
    const base      = { ...r, _detCount: detCount, _excCount: excCount }

    if (cpds.length === 0) {
      expandedRows.push({
        ...base, _compound: null, _isFirst: true, _spanCount: 1,
        _cells: { batch: r.batch_number ?? '', report_ref: d.report_reference ?? '', sample_date: d.sample_date ?? '', method: (Array.isArray(d.methods_used)?d.methods_used:d.methods_used?[d.methods_used]:[]).join(' + ')||'', screened: d.total_compounds_screened ?? '', detections: detCount, exceedances: excCount, banned: (d.banned_compounds_count??0), eu_status: d.overall_status ?? '', r_grade: d.overall_r_grade ?? '', compound: 'None Detected', date: r.created_at?.slice(0,10) ?? '' },
      })
    } else {
      cpds.forEach((c: any, ci: number) => {
        const rg = c.r_grade ? c.r_grade.replace('R-', 'R') : null
        expandedRows.push({
          ...base, _compound: c, _compoundRg: rg, _isFirst: ci === 0, _spanCount: cpds.length, _ci: ci,
          _cells: { batch: r.batch_number ?? '', report_ref: d.report_reference ?? '', sample_date: d.sample_date ?? '', method: (Array.isArray(d.methods_used) ? d.methods_used : d.methods_used ? [d.methods_used] : []).join(' + ') || '', screened: d.total_compounds_screened ?? '', detections: detCount, exceedances: excCount, banned: (d.banned_compounds_count ?? 0), eu_status: d.overall_status ?? '', r_grade: d.overall_r_grade ?? '', compound_name: c.compound_name ?? '', detected_val: `${c.detected_value_prefix ?? ''}${c.detected_value_mg_kg ?? ''}`, r_grade_cpd: rg ?? '', date: r.created_at?.slice(0,10) ?? '' },
        })
      })
    }
  })

  const hasFilter = Object.keys(hook.colSearch).some(k => hook.colSearch[k]) || !!hook.sortCol
  const rows      = hook.applyFilters(expandedRows)

  const totalDet    = records.reduce((a, r) => a + (r.data_json?.total_detections ?? (r.data_json?.compounds_detected?.length ?? 0)), 0)
  const totalBanned = records.reduce((a, r) => a + (r.data_json?.banned_compounds_count ?? 0), 0)

  return (
    <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Total Samples"       value={records.length} />
        <KpiCard label="Pass"                value={records.filter(r => r.data_json?.overall_status === 'PASS').length}   color="text-ok"   />
        <KpiCard label="Fail (MRL Exceeded)" value={records.filter(r => r.data_json?.overall_status === 'FAIL').length}   color="text-err"  />
        <KpiCard label="Review"              value={records.filter(r => r.data_json?.overall_status === 'REVIEW').length} color="text-warn" />
        <KpiCard label="Total Detections"    value={totalDet} />
        {totalBanned > 0 && <KpiCard label="⚠ Banned Substances" value={totalBanned} color="text-err" />}
      </div>

      {/* Cross-batch compound search */}
      <div className={`mb-3 p-3 rounded-xl border-2 transition-colors ${compLo ? 'border-warn/50 bg-warn/5' : 'border-surface-rule bg-surface'}`}>
        <div className="flex gap-2 items-center flex-wrap">
          <span className="font-bold text-[12px] text-text whitespace-nowrap">🔬 Search by Chemical Name</span>
          <input
            value={hook.colSearch['compound'] ?? ''}
            onChange={e => {
              if (e.target.value) { hook.setSearch('compound', e.target.value); setSearch('') }
              else               { hook.clearSearch('compound') }
            }}
            placeholder="Type any compound — e.g. Glyphosate, Chlorpyrifos, Cypermethrin…"
            className="flex-1 min-w-[260px] px-3 py-1.5 border-2 border-warn/40 rounded-lg text-[12px] font-mono outline-none bg-surface-card text-text focus:border-warn"
          />
          {hook.colSearch['compound'] && (
            <button
              onClick={() => hook.clearSearch('compound')}
              className="px-3 py-1.5 rounded-lg border border-err/30 bg-err/8 text-err text-[11px] font-bold whitespace-nowrap"
            >✕ Clear</button>
          )}
        </div>
        {compLo && (() => {
          const matched = [...new Set(preFilter.map(r => r.batch_number))]
          return (
            <div className="mt-2 flex gap-2 items-center flex-wrap">
              <span className="text-[11px] font-bold text-warn">"{compLo}" found in {matched.length} batch{matched.length !== 1 ? 'es' : ''}:</span>
              {matched.map(b => (
                <span key={b} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-warn/10 text-warn border border-warn/30">{b}</span>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); hook.clearSearch('compound') }}
          placeholder="Search batch or report ref…"
          className={`${inp} flex-1 min-w-[180px]`}
        />
        <select value={sf} onChange={e => setSf(e.target.value)} className={inp}>
          <option value="ALL">All Statuses</option>
          <option value="PASS">Pass</option>
          <option value="FAIL">Fail</option>
          <option value="REVIEW">Review</option>
        </select>
        {isAdmin && (
          <button
            onClick={async () => {
              if (!confirm(`Recalculate R-grades on all ${records.length} residue records?\n\nR0=none detected · R1=<½MRL · R2=½–MRL · R3=≥MRL or banned\n\nSafe to run multiple times.`)) return
              try {
                const res = await fetch('/api/admin/backfill-residue-grades', { method:'POST' })
                const d = await res.json()
                if (!res.ok) throw new Error(d.error)
                alert(`✓ ${d.updated ?? 0} records updated`)
                onRefresh()
              } catch(e: any) { alert('Failed: ' + e.message) }
            }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-info/30 bg-info/8 text-info hover:bg-info/15 transition-colors whitespace-nowrap">
            🔢 Recalculate R-Grades
          </button>
        )}
        {isAdmin && (
          <button
            disabled={enriching}
            onClick={async () => {
              if (!confirm('Re-enrich MRL data on all residue records? This fetches updated EU MRL values from the database.')) return
              setEnriching(true); setEnrichResult('')
              try {
                const res = await fetch('/api/admin/re-enrich-residues', { method:'POST' })
                const d = await res.json()
                if (!res.ok) throw new Error(d.error)
                setEnrichResult(`✓ ${d.updated ?? 0} records enriched`)
                onRefresh()
              } catch(e: any) { setEnrichResult('✗ ' + e.message) }
              finally { setEnriching(false) }
            }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-warn/30 bg-warn/8 text-warn hover:bg-warn/15 transition-colors whitespace-nowrap">
            {enriching ? '⏳ Enriching…' : '🔄 Re-enrich MRLs'}
          </button>
        )}
        {isAdmin && (
          <button
            disabled={syncing}
            onClick={async () => {
              if (!confirm('Sync EU MRL data from the official EU Pesticides Database? This may take a moment.')) return
              setSyncing(true); setSyncResult('')
              try {
                const res = await fetch('/api/eu-mrl-sync/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({commodities:['rooibos']}) })
                const d = await res.json()
                if (!res.ok) throw new Error(d.error)
                setSyncResult(`✓ EU MRL sync started — ${d.message ?? 'check status'}`)
                onRefresh()
              } catch(e: any) { setSyncResult('✗ ' + e.message) }
              finally { setSyncing(false) }
            }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-info/30 bg-info/8 text-info hover:bg-info/15 transition-colors whitespace-nowrap">
            {syncing ? '⏳ Syncing…' : '🌍 EU MRL Sync'}
          </button>
        )}
        {isAdmin && (
          <>
            <input
              ref={mrlFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadEuMrlFile(f) }}
            />
            <button
              disabled={mrlUploading}
              onClick={() => mrlFileRef.current?.click()}
              title="Upload the EU 'Current MRL' export (Export_Pesticide_residue_CurrentMRL.xlsx) for Rooibos"
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-ok/30 bg-ok/8 text-ok hover:bg-ok/15 transition-colors whitespace-nowrap">
              {mrlUploading ? '⏳ Importing…' : '⬆️ Upload EU MRL file'}
            </button>
          </>
        )}
        <a
          href="https://ec.europa.eu/food/plant/pesticides/eu-pesticides-database/start/screen/mrls"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-rule text-ok text-[12px] font-semibold hover:bg-surface transition-colors"
        >
          <ExternalLink size={12} /> EU Pesticide DB
        </a>
      </div>
      {(syncResult || enrichResult) && (
        <div className={`mb-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold ${syncResult.startsWith('✓')||enrichResult.startsWith('✓') ? 'bg-ok/8 text-ok border border-ok/20' : 'bg-err/8 text-err border border-err/20'}`}>
          {syncResult || enrichResult}
        </div>
      )}

      {/* R-grade legend */}
      <div className="flex gap-3 items-center mb-3 px-3 py-2 bg-surface rounded-lg border border-surface-rule text-[10px] flex-wrap">
        <span className="font-bold text-text">R-Grades:</span>
        {[['R0','= 0 detected','#f0fdf4','#166534'],['R1','< ½ MRL','#fef9c3','#92400e'],['R2','½ – MRL','#fef3c7','#b45309'],['R3','≥ MRL / Banned','#fef2f2','#991b1b']].map(([g,desc,bg,fg]) => (
          <span key={g} className="flex items-center gap-1">
            <span style={{ background:bg, color:fg, padding:'2px 8px', borderRadius:10, fontWeight:700, fontSize:10, border:`1px solid ${fg}30` }}>{g}</span>
            <span className="text-text-muted">{desc}</span>
          </span>
        ))}
        <span className="ml-auto text-text-faint">EU Reg. (EC) No 396/2005 · SA Act 36/1947</span>
      </div>

      <ActiveFilters hook={hook} />

      {/* Table */}
      <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-rule">
          <span className="font-semibold text-[14px] text-text">Residue / Pesticide Results</span>
          <span className="text-[11px] text-text-muted">{records.length} samples · {totalDet} detections</span>
          <span className="text-[10px] text-text-faint ml-2">One row per detected compound</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {isAdmin && <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule w-16">Actions</th>}
                <SH col="batch"        label="Batch No."     hook={hook} />
                <SH col="report_ref"   label="Report Ref."   hook={hook} />
                <SH col="sample_date"  label="Sample Date"   hook={hook} />
                <SH col="screened"     label="Screened"      hook={hook} />
                <SH col="detections"   label="Detections"    hook={hook} />
                <SH col="exceedances"  label="Exceed."       hook={hook} />
                <SH col="eu_status"    label="Sample Status" hook={hook} />
                <SH col="r_grade"      label="Overall R"     hook={hook} />
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule border-l-2 border-l-brand/30">Compound Name</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Detected (mg/kg)</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">EU MRL</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Compound R-Grade</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">MRL Status</th>
                <SH col="date"         label="Date"          hook={hook} />
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Source File</th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={20} className="text-center py-10 text-text-muted text-[12px]">No records found</td>
                </tr>
              )}
              {rows.map((row, i) => {
                const d        = row.data_json
                const c        = row._compound
                const rg       = row._compoundRg
                const isFirst  = hasFilter ? true : row._isFirst
                const span     = hasFilter ? 1   : row._spanCount
                const isBanned   = c?.is_banned
                const isExceeds  = c?.eu_mrl_exceeded
                const rowBg      = isBanned ? 'bg-err/3' : isExceeds ? 'bg-warn/3' : i % 2 === 1 ? 'bg-surface/30' : ''
                const [cbg, cfg, cborder] = rg ? (R_COLORS[rg] ?? ['#f3f4f6','#374151','#d1d5db']) : ['#f3f4f6','#374151','#d1d5db']

                return (
                  <tr
                    key={`${row.id}-${row._ci ?? 0}`}
                    className={`hover:bg-surface transition-colors ${rowBg} border-l-2 ${isFirst ? 'border-l-brand/40' : 'border-l-surface-rule/40'}`}
                  >
                    {/* Admin actions — first row only */}
                    {isAdmin && isFirst && (
                      <td rowSpan={span} className="px-3 py-2.5 align-top">
                        <button
                          onClick={() => deleteRecord(row.id)}
                          className="px-2 py-0.5 rounded border border-err/30 bg-err/8 text-err text-[10px]"
                        >🗑</button>
                      </td>
                    )}
                    {isAdmin && !isFirst && null}

                    {/* Sample-level cells — rowspan on first compound row */}
                    {isFirst && (
                      <>
                        <td rowSpan={span} className="px-4 py-2.5 align-top">
                          <span className="font-mono font-bold text-[12px] text-text">{row.batch_number}</span>
                          {d.is_retest && (
                            <span className="block mt-1 text-[9px] px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/20 font-bold w-fit">
                              🔁 RETEST
                            </span>
                          )}
                        </td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-[10px] text-text-muted">{d.report_reference ?? '—'}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-[11px] text-text-muted">{d.sample_date ?? '—'}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-center font-mono text-[12px] text-text">{d.total_compounds_screened ?? '—'}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-center font-mono font-bold text-[12px]" style={{ color: row._detCount > 0 ? '#b45309' : '#166534' }}>{row._detCount}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-center font-mono font-bold text-[12px]" style={{ color: row._excCount > 0 ? '#991b1b' : '#166534' }}>{row._excCount}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-center"><StatusBadge status={d.overall_status} /></td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-center"><RGradeBadge grade={d.overall_r_grade} /></td>
                      </>
                    )}

                    {/* Compound-level cells */}
                    {c === null ? (
                      <td colSpan={5} className="px-4 py-2.5 border-l-2 border-brand/20">
                        <span className="badge badge-gray text-[10px]">None Detected</span>
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 border-l-2 border-brand/20">
                          <div className="flex items-center gap-1.5">
                            {isBanned && <span className="text-[10px]">🚫</span>}
                            <span className={`text-[11px] ${isBanned ? 'text-err font-bold' : isExceeds ? 'text-warn font-bold' : 'text-text'}`}>
                              {c.compound_name}
                            </span>
                            {c.eu_db_url && (
                              <a href={c.eu_db_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-info">🔗</a>
                            )}
                          </div>
                          {isBanned && c.sa_ban_label && (
                            <div className="text-[8px] text-err font-bold mt-0.5">{c.sa_ban_label}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono text-[12px]" style={{ color: isExceeds ? '#dc2626' : '#374151', fontWeight: isExceeds ? 700 : 400 }}>
                          {c.detected_value_prefix ?? ''}{c.detected_value_mg_kg ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono text-[11px] text-text-muted">
                          {c.mrl_eu_mg_kg != null ? c.mrl_eu_mg_kg : <span className="text-[9px] text-text-faint">0.01 (default)</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {rg ? (
                            <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:12, fontWeight:700, fontSize:11, background:cbg, color:cfg, border:`1px solid ${cborder}` }}>
                              {rg}
                            </span>
                          ) : <span className="text-text-faint">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {isExceeds  ? <span className="badge badge-err text-[10px]">⚠ Exceeds MRL</span>
                          : isBanned  ? <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-gray-900 text-red-300 border border-red-800">🚫 Banned</span>
                          :             <span className="badge badge-ok text-[10px]">Within MRL</span>}
                        </td>
                      </>
                    )}

                    {/* Date / file / comment — first row only */}
                    {isFirst && (
                      <>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-[11px] text-text-faint font-mono">{row.created_at?.slice(0,10)}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top text-[11px] text-info font-mono">{row.file_name}</td>
                        <td rowSpan={span} className="px-4 py-2.5 align-top">
                          <CommentCell record={row} onSave={onComment} />
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── Glyphosate Table ─────────────────────────────────────────────────────────

function GlyphosateTable({ records, isAdmin, onRefresh, onComment }: {
  records:   QRecord[]
  isAdmin:   boolean
  onRefresh: () => void
  onComment: (id: number, c: string) => void
}) {
  const db   = getDb()
  const hook = useSortFilter()
  const [search, setSearch] = useState('')

  async function deleteRecord(id: number) {
    if (!confirm('Delete this glyphosate record?')) return
    await db.schema('qms').from('quality_records').delete().eq('id', id)
    onRefresh()
  }

  const getStatus = (r: QRecord) => (r.data_json?.overall_status ?? '').toUpperCase()
  const pass      = records.filter(r => getStatus(r) === 'PASS').length
  const detected  = records.filter(r => getStatus(r) === 'DETECTED').length
  const fail      = records.filter(r => getStatus(r) === 'FAIL').length

  const filtered = search
    ? records.filter(r => {
        const s = search.toLowerCase()
        if ((r.batch_number ?? '').toLowerCase().includes(s)) return true
        const cpds = r.data_json?.compounds_detected ?? []
        return cpds.some((c: any) => (c.compound_name ?? '').toLowerCase().includes(s))
      })
    : records

  const baseRows = filtered.map(r => {
    const d    = r.data_json
    const cpds = d.compounds_detected ?? []
    const glyCpd  = cpds.find((c: any) => (c.compound_name ?? '').toLowerCase().includes('glyphosate'))
    const ampaCpd = cpds.find((c: any) => (c.compound_name ?? '').toLowerCase().includes('ampa') || (c.compound_name ?? '').toLowerCase().includes('aminomethyl'))
    const gluCpd  = cpds.find((c: any) => (c.compound_name ?? '').toLowerCase().includes('glufosinate'))
    const fmtV    = (c: any) => c ? `${c.detected_value_prefix ?? ''}${c.detected_value_mg_kg ?? ''}` : ''
    const glyVal  = fmtV(glyCpd)  || (d.glyphosate_value_mg_kg  != null ? String(d.glyphosate_value_mg_kg)  : '')
    const ampaVal = fmtV(ampaCpd) || (d.ampa_detected            ? String(d.ampa_value_mg_kg ?? '')         : '')
    const gluVal  = fmtV(gluCpd)  || (d.glufosinate_detected     ? String(d.glufosinate_value_mg_kg ?? '')  : '')
    const status  = (() => {
      if (cpds.length > 0) {
        if (cpds.some((c: any) => c.eu_mrl_exceeded)) return 'FAIL'
        if (cpds.some((c: any) => c.detected_value_mg_kg != null && c.detected_value_mg_kg > 0)) return 'DETECTED'
        return d.overall_status ?? 'PASS'
      }
      return d.overall_status ?? 'PASS'
    })()
    return {
      ...r, _status: status, _glyVal: glyVal,
      _cells: { batch: r.batch_number ?? '', grade: d.grade ?? '', sample_date: d.sample_date ?? '', issue_date: d.issue_date ?? d.date_issued ?? '', report_ref: d.report_reference ?? '', glyphosate: glyVal, ampa: ampaVal, glufosinate: gluVal, status, uploaded: r.created_at?.slice(0,10) ?? '' },
    }
  })

  const rows = hook.applyFilters(baseRows)

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard label="PASS"                 value={pass}           color="text-ok"   />
        <KpiCard label="Detected / Below MRL" value={detected}       color="text-warn" />
        <KpiCard label="FAIL / Exceeds MRL"   value={fail}           color="text-err"  />
        <KpiCard label="Total Records"        value={records.length}                   />
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search batch number or compound…"
          className={`${inp} flex-1 min-w-[200px]`}
        />
        <span className="text-[11px] text-text-muted font-mono bg-surface px-3 py-1.5 rounded-lg border border-surface-rule">EU MRL: {EU_GLYPHOSATE_MRL} mg/kg</span>
      </div>

      <ActiveFilters hook={hook} />

      <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <SH col="batch"       label="Batch No."          hook={hook} />
                <SH col="grade"       label="Grade"              hook={hook} />
                <SH col="sample_date" label="Sample Date"        hook={hook} />
                <SH col="issue_date"  label="Issue Date"         hook={hook} />
                <SH col="report_ref"  label="Report Ref"         hook={hook} />
                <SH col="glyphosate"  label="Glyphosate (mg/kg)" hook={hook} />
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">EU MRL</th>
                <SH col="ampa"        label="AMPA"               hook={hook} />
                <SH col="glufosinate" label="Glufosinate"        hook={hook} />
                <SH col="status"      label="Status"             hook={hook} />
                <SH col="uploaded"    label="Uploaded"           hook={hook} />
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Comment</th>
                {isAdmin && <th className="px-4 py-2.5 font-mono text-[10px] uppercase text-text-muted bg-surface border-b border-surface-rule">Del</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={20} className="text-center py-10 text-text-muted text-[12px]">
                    No glyphosate records yet. Upload HKAL glyphosate reports using the drop zone above.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const d       = r.data_json
                const val     = d.glyphosate_value_mg_kg
                const exceeds = d.glyphosate_exceeds_mrl || (val != null && val > EU_GLYPHOSATE_MRL)
                return (
                  <tr key={r.id} className={`hover:bg-surface transition-colors ${exceeds ? 'bg-err/3' : i % 2 === 1 ? 'bg-surface/30' : ''}`}>
                    <td className="px-4 py-2.5 font-mono font-bold text-[12px] text-text">{r.batch_number}</td>
                    <td className="px-4 py-2.5">
                      {d.grade && (
                        <span className={`badge ${(d.grade ?? '').toLowerCase().includes('organic') ? 'badge-ok' : 'badge-gray'}`}>
                          {d.grade}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted">{d.sample_date ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted">{d.issue_date ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[10px] text-text-faint font-mono">{d.report_reference ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center font-mono font-bold text-[12px]" style={{ color: exceeds ? '#dc2626' : val != null ? '#166534' : '#9ca3af' }}>
                      {val != null ? val : <span className="text-text-faint">ND</span>}
                      {exceeds && <div className="text-[9px] text-err">⚠ EXCEEDS</div>}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono text-[11px] text-text-muted">{EU_GLYPHOSATE_MRL}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-[12px]">
                      {d.ampa_detected ? <span className="text-warn font-bold">{d.ampa_value_mg_kg}</span> : <span className="text-text-faint">ND</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono text-[12px]">
                      {d.glufosinate_detected ? <span className="text-warn font-bold">{d.glufosinate_value_mg_kg}</span> : <span className="text-text-faint">ND</span>}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={d.overall_status} /></td>
                    <td className="px-4 py-2.5 text-[11px] text-text-faint font-mono">{isoDate(r.created_at)}</td>
                    <td className="px-4 py-2.5"><CommentCell record={r} onSave={onComment} /></td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <button onClick={() => deleteRecord(r.id)} className="px-2 py-0.5 rounded border border-err/30 bg-err/8 text-err text-[10px]">✕</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── Overview table ───────────────────────────────────────────────────────────

function OverviewTable({ records }: { records: QRecord[] }) {
  const paRecs  = records.filter(r => r.workflow === 'pa_ta_analysis')
  const resRecs = records.filter(r => r.workflow === 'residue')

  const paByBatch:  Record<string, QRecord> = {}
  const resByBatch: Record<string, QRecord> = {}
  paRecs .forEach(r => { paByBatch [normBatch(r.batch_number)] = r })
  resRecs.forEach(r => { resByBatch[normBatch(r.batch_number)] = r })

  const allBatches = [...new Set([
    ...paRecs .map(r => normBatch(r.batch_number)),
    ...resRecs.map(r => normBatch(r.batch_number)),
  ])].sort()

  const [batchSearch,   setBatchSearch]   = useState('')
  const [paLevelFilter, setPaLevelFilter] = useState('all')
  const [rGradeFilter,  setRGradeFilter]  = useState('all')
  const [sortDir,       setSortDir]       = useState<'asc'|'desc'>('asc')

  const PA_LEVELS = [...new Set(allBatches.map(b => { const d = paByBatch[b]?.data_json ?? {}; return d.pa_level || (d.pa_status === 'FAIL' ? 'FAIL' : null) }).filter(Boolean))] as string[]
  const R_GRADES  = [...new Set(allBatches.map(b => resByBatch[b]?.data_json?.overall_r_grade).filter(Boolean))] as string[]

  const visible = allBatches
    .filter(b => {
      if (batchSearch && !b.toLowerCase().includes(batchSearch.toLowerCase())) return false
      if (paLevelFilter !== 'all') {
        const d = paByBatch[b]?.data_json ?? {}
        if ((d.pa_level || (d.pa_status === 'FAIL' ? 'FAIL' : null)) !== paLevelFilter) return false
      }
      if (rGradeFilter !== 'all' && (resByBatch[b]?.data_json?.overall_r_grade ?? null) !== rGradeFilter) return false
      return true
    })
    .sort((a, b) => sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a))

  if (allBatches.length === 0) return (
    <div className="text-center py-12 text-text-muted text-[13px]">
      No records yet — upload PA/TA or Residue reports to see the overview.
    </div>
  )

  const paPass  = paRecs .filter(r => r.data_json?.pa_status      === 'PASS').length
  const paFail  = paRecs .filter(r => r.data_json?.pa_status      === 'FAIL').length
  const resPass = resRecs.filter(r => r.data_json?.overall_status === 'PASS').length
  const resFail = resRecs.filter(r => r.data_json?.overall_status === 'FAIL').length

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <KpiCard label="Batches Tracked" value={allBatches.length} />
        <KpiCard label="PA Pass"         value={paPass}  color="text-ok"  />
        <KpiCard label="PA Fail"         value={paFail}  color="text-err" />
        <KpiCard label="Residue Pass"    value={resPass} color="text-ok"  />
        <KpiCard label="Residue Fail"    value={resFail} color="text-err" />
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input
          value={batchSearch}
          onChange={e => setBatchSearch(e.target.value)}
          placeholder="Search batch number…"
          className={`${inp} max-w-[220px]`}
        />
        <select value={paLevelFilter} onChange={e => setPaLevelFilter(e.target.value)} className={inp}>
          <option value="all">All PA Levels</option>
          {PA_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={rGradeFilter} onChange={e => setRGradeFilter(e.target.value)} className={inp}>
          <option value="all">All R-Grades</option>
          {R_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="px-3 py-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-text text-[12px]"
        >
          Batch {sortDir === 'asc' ? 'A→Z ↑' : 'Z→A ↓'}
        </button>
        {(batchSearch || paLevelFilter !== 'all' || rGradeFilter !== 'all') && (
          <button
            onClick={() => { setBatchSearch(''); setPaLevelFilter('all'); setRGradeFilter('all') }}
            className="px-3 py-1.5 rounded-lg border border-err/30 bg-err/8 text-err text-[12px]"
          >✕ Clear</button>
        )}
      </div>

      <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
          <span className="font-semibold text-[14px] text-text">Batch Overview — PA & Residue</span>
          <span className="text-[11px] text-text-muted">{visible.length} of {allBatches.length} batches</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-surface-rule">
                <th rowSpan={2} className="px-4 py-2 font-mono text-[10px] uppercase text-text-muted bg-surface align-middle min-w-[110px] border-b border-surface-rule">Batch No.</th>
                <th colSpan={4} className="px-4 py-2 font-mono text-[10px] uppercase text-white bg-brand text-center">PA / TA Alkaloids</th>
                <th colSpan={5} className="px-4 py-2 font-mono text-[10px] uppercase text-white bg-ok text-center">Residue / Pesticides</th>
              </tr>
              <tr className="border-b border-surface-rule">
                {['PA Level','Total PA (µg/kg)','Total PA (mg/kg)','PA Status'].map(h => (
                  <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase text-white bg-brand whitespace-nowrap">{h}</th>
                ))}
                {['R-Grade','Residue Status','Detections','Exceedances','Residue Values (mg/kg)'].map(h => (
                  <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase text-white bg-ok whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-text-muted">No batches match the current filters.</td>
                </tr>
              )}
              {visible.map((batch, i) => {
                const pa   = paByBatch[batch]
                const res  = resByBatch[batch]
                const pad  = pa?.data_json  ?? {}
                const resd = res?.data_json ?? {}
                const level = normLevel(pad.pa_level || (pad.pa_status === 'FAIL' ? 'FAIL' : null))
                const mg    = pad.total_pa_mg_kg != null ? pad.total_pa_mg_kg : (pad.total_pa_ug_kg != null ? (pad.total_pa_ug_kg / 1000).toFixed(4) : null)
                const cpds  = resd.compounds_detected ?? []
                return (
                  <tr key={batch} className={`hover:bg-surface ${i % 2 === 1 ? 'bg-surface/30' : ''}`}>
                    <td className="px-4 py-2.5 font-mono font-bold text-[12px] text-text whitespace-nowrap">{batch}</td>
                    {pa ? (
                      <>
                        <td className="px-4 py-2.5 border-l-2 border-brand/30"><PALevelBadge level={level} /></td>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-text">{pad.total_pa_ug_kg ?? <span className="text-text-faint">ND</span>}</td>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-text">{mg ?? <span className="text-text-faint">ND</span>}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={pad.pa_status} /></td>
                      </>
                    ) : (
                      <td colSpan={4} className="px-4 py-2.5 text-center text-text-faint border-l-2 border-brand/30">—</td>
                    )}
                    {res ? (
                      <>
                        <td className="px-4 py-2.5 border-l-2 border-ok/30 text-center"><RGradeBadge grade={resd.overall_r_grade} /></td>
                        <td className="px-4 py-2.5 text-center"><StatusBadge status={resd.overall_status} /></td>
                        <td className="px-4 py-2.5 text-center font-mono font-bold text-[12px]" style={{ color: (resd.total_detections ?? 0) > 0 ? '#b45309' : '#166534' }}>
                          {resd.total_detections ?? 0}
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono font-bold text-[12px]" style={{ color: (resd.total_exceedances ?? 0) > 0 ? '#991b1b' : '#166534' }}>
                          {resd.total_exceedances ?? 0}
                        </td>
                        <td className="px-4 py-2.5 max-w-[320px]">
                          {cpds.length === 0
                            ? <span className="badge badge-ok text-[10px]">None Detected</span>
                            : (
                              <div className="flex flex-wrap gap-1">
                                {cpds.map((c: any, ci: number) => (
                                  <span key={ci} className={`text-[9px] px-2 py-0.5 rounded-lg font-semibold ${c.eu_mrl_exceeded ? 'bg-err/10 text-err border border-err/20' : 'bg-ok/10 text-ok border border-ok/20'}`}>
                                    {c.eu_mrl_exceeded && '⚠ '}{c.compound_name}
                                    {c.detected_value_mg_kg != null && (
                                      <span className="opacity-75 ml-1">
                                        {c.detected_value_mg_kg} mg/kg
                                        {c.mrl_eu_mg_kg != null && <span className="opacity-60"> / MRL {c.mrl_eu_mg_kg}</span>}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )
                          }
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-4 py-2.5 text-center text-text-faint border-l-2 border-ok/30">—</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── Outstanding Tracker ─────────────────────────────────────────────────────

function OutstandingTracker() {
  const [data,    setData]    = useState<any[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('incomplete')

  const WF_LABELS: Record<string, string> = {
    pa_ta_analysis: 'PA/TA',
    residue:        'Residue',
    glyphosate:     'Glyphosate',
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Next.js API route — no auth header needed (uses server-side Supabase session)
      const res = await fetch('/api/outstanding')
      const d = await res.json()
      setData(Array.isArray(d) ? d : null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="text-center py-12 text-text-muted text-[12px] animate-pulse">Loading outstanding results…</div>
  )

  if (!data) return (
    <div className="text-center py-12">
      <p className="text-err text-[13px] mb-3">Could not load tracker — is the API running?</p>
      <button onClick={load} className="px-4 py-2 rounded-lg bg-brand text-white text-[12px] font-semibold">Retry</button>
    </div>
  )

  const filtered   = filter === 'all' ? data : data.filter(r => !r.complete)
  const incomplete = data.filter(r => !r.complete).length
  const complete   = data.filter(r =>  r.complete).length

  return (
    <>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <KpiCard label="Incomplete"    value={incomplete} color="text-err"  />
        <KpiCard label="Complete"      value={complete}   color="text-ok"   />
        <KpiCard label="Total Batches" value={data.length}                  />
      </div>

      <div className="flex gap-2 mb-4 items-center">
        <select value={filter} onChange={e => setFilter(e.target.value)} className={inp}>
          <option value="incomplete">Incomplete only</option>
          <option value="all">All batches</option>
        </select>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-text text-[12px]"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-ok/5 border border-ok/20 rounded-2xl p-10 text-center">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-ok font-semibold text-[14px]">All batches are complete!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((row: any) => (
            <div
              key={row.batch_number}
              className={`bg-surface-card border rounded-xl px-4 py-3 ${row.complete ? 'border-ok/30' : 'border-warn/30'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono font-bold text-[13px] text-text">{row.batch_number}</span>
                {row.is_organic && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-ok/10 text-ok border border-ok/20 font-bold">ORG</span>
                )}
                {!row.complete && (
                  <span className="ml-auto text-[10px] text-warn font-mono">{row.missing?.length ?? 0} missing</span>
                )}
                {row.complete && (
                  <span className="ml-auto text-[10px] text-ok font-mono">✓ Complete</span>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(WF_LABELS).map(([wf, label]) => {
                  if (wf === 'glyphosate' && !row.is_organic) return null
                  if (!(wf in (row.status ?? {}))) return null
                  const done = row.status[wf]
                  return (
                    <span
                      key={wf}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${done ? 'bg-ok/10 text-ok border border-ok/20' : 'bg-err/10 text-err border border-err/20'}`}
                    >
                      {done ? '✓' : '✗'} {label}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─── Manual Entry Modal ───────────────────────────────────────────────────────

function ManualEntryModal({ workflow, onSaved, onClose }: {
  workflow: string
  onSaved:  () => void
  onClose:  () => void
}) {
  const db = getDb()
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  const [pa, setPa] = useState({
    batch_no:'', report_name:'', sample_date:'', lab:'Stellenbosch University CAF',
    purchase_order:'', sample_list:'', total_pa_ug_kg:'', total_ta_ug_kg:'',
  })
  const [res, setRes] = useState({
    batch_no:'', report_reference:'', sample_date:'', lab:'', total_compounds_screened:'',
  })
  const [compounds, setCompounds] = useState([{
    compound_name:'', detected_value_prefix:'', detected_value_mg_kg:'', mrl_eu_mg_kg:'', eu_mrl_exceeded:false,
  }])
  const [gly, setGly] = useState({
    batch_no:'', report_reference:'', sample_date:'', grade:'',
    glyphosate_detected:false,  glyphosate_value_mg_kg:'',
    ampa_detected:false,        ampa_value_mg_kg:'',
    glufosinate_detected:false, glufosinate_value_mg_kg:'',
  })

  const paPreview = pa.total_pa_ug_kg ? calcPaLevel(pa.total_pa_ug_kg) : null
  const setP = (k: string, v: any) => setPa(p => ({ ...p, [k]: v }))
  const setR = (k: string, v: any) => setRes(p => ({ ...p, [k]: v }))
  const setG = (k: string, v: any) => setGly(p => ({ ...p, [k]: v }))
  const setC = (i: number, k: string, v: any) => setCompounds(cs => cs.map((c, ci) => ci === i ? { ...c, [k]: v } : c))

  async function save() {
    setErr(''); setSaving(true)
    try {
      let batch_number: string
      let data_json: Record<string, any>

      if (workflow === 'pa_ta_analysis') {
        if (!pa.batch_no.trim()) throw new Error('Batch number is required')
        if (!pa.total_pa_ug_kg)  throw new Error('Total PA (µg/kg) is required')
        const { level, status } = calcPaLevel(pa.total_pa_ug_kg)
        const ugKg   = parseFloat(pa.total_pa_ug_kg) || 0
        batch_number = pa.batch_no.trim()
        data_json    = {
          report_name: pa.report_name, sample_date: pa.sample_date,
          lab: pa.lab, purchase_order: pa.purchase_order, sample_list: pa.sample_list,
          total_pa_ug_kg: ugKg,
          total_pa_mg_kg: ugKg ? parseFloat((ugKg / 1000).toFixed(4)) : null,
          total_ta_ug_kg: parseFloat(pa.total_ta_ug_kg) || null,
          pa_level: level, pa_status: status,
          ta_status: pa.total_ta_ug_kg ? 'PASS' : null,
          _manual_entry: true,
        }

      } else if (workflow === 'residue') {
        if (!res.batch_no.trim()) throw new Error('Batch number is required')
        batch_number = res.batch_no.trim()
        const cpds = compounds
          .filter(c => c.compound_name.trim())
          .map(c => {
            const prefix  = (c.detected_value_prefix || '').trim()
            const isLOD   = prefix === '<' || prefix === '≤'
            const isTND   = prefix === 'ND' || (!c.detected_value_mg_kg && !prefix)
            const val     = isTND ? 0 : parseFloat(c.detected_value_mg_kg) || 0
            const mrl     = parseFloat(c.mrl_eu_mg_kg) || 0
            let grade
            if (isTND || val === 0)      grade = 'R-0'
            else if (mrl > 0) {
              if (val >= mrl)       grade = 'R-3'
              else if (val >= mrl/2) grade = 'R-2'
              else                   grade = 'R-1'
            } else grade = 'R-3'
            if (isLOD && grade === 'R-0') grade = 'R-1'
            return { compound_name: c.compound_name.trim(), detected_value_prefix: prefix, detected_value_mg_kg: parseFloat(c.detected_value_mg_kg) || null, mrl_eu_mg_kg: mrl || null, eu_mrl_exceeded: grade === 'R-3', r_grade: grade, is_banned: false }
          })
        const worstRank = cpds.reduce((m, c) => Math.max(m, ({'R-0':0,'R-1':1,'R-2':2,'R-3':3} as any)[c.r_grade] ?? 0), 0)
        data_json = {
          report_reference: res.report_reference, sample_date: res.sample_date, lab: res.lab,
          total_compounds_screened: parseInt(res.total_compounds_screened) || null,
          compounds_detected: cpds,
          total_detections:  cpds.filter(c => c.r_grade !== 'R-0').length,
          total_exceedances: cpds.filter(c => c.r_grade === 'R-3').length,
          banned_compounds_count: 0,
          overall_r_grade: `R-${worstRank}`,
          overall_status:  worstRank >= 3 ? 'FAIL' : 'PASS',
          _manual_entry: true,
        }

      } else {
        // glyphosate
        if (!gly.batch_no.trim()) throw new Error('Batch number is required')
        batch_number = gly.batch_no.trim()
        const gVal = parseFloat(gly.glyphosate_value_mg_kg) || null
        data_json = {
          report_reference: gly.report_reference, sample_date: gly.sample_date, grade: gly.grade,
          glyphosate_detected:      gly.glyphosate_detected,
          glyphosate_value_mg_kg:   gVal,
          glyphosate_mrl_eu_mg_kg:  EU_GLYPHOSATE_MRL,
          glyphosate_exceeds_mrl:   gVal != null && gVal > EU_GLYPHOSATE_MRL,
          ampa_detected:            gly.ampa_detected,
          ampa_value_mg_kg:         gly.ampa_detected ? (parseFloat(gly.ampa_value_mg_kg) || null) : null,
          glufosinate_detected:     gly.glufosinate_detected,
          glufosinate_value_mg_kg:  gly.glufosinate_detected ? (parseFloat(gly.glufosinate_value_mg_kg) || null) : null,
          overall_status: (gVal != null && gVal > EU_GLYPHOSATE_MRL) ? 'FAIL' : gly.glyphosate_detected ? 'DETECTED' : 'PASS',
          _manual_entry: true,
        }
      }

      const { error } = await db.schema('qms').from('quality_records').insert({
        workcenter: 'rawMaterial', workflow, batch_number, data_json, file_name: 'manual_entry',
      })
      if (error) throw new Error(error.message)
      onSaved()
      onClose()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const WF_TITLES: Record<string, string> = {
    pa_ta_analysis: 'PA/TA Alkaloids',
    residue:        'Residue / Pesticides',
    glyphosate:     'Glyphosate',
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto p-5">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-2xl shadow-menu my-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-brand rounded-t-2xl">
          <div>
            <div className="text-white font-bold text-[15px]">✏️ Manual Entry — {WF_TITLES[workflow] ?? workflow}</div>
            <div className="text-blue-200 text-[11px] mt-0.5">Raw Material · results will be graded automatically</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/15 text-white text-lg">×</button>
        </div>

        <div className="p-6 space-y-5">

          {/* ── PA/TA FORM ── */}
          {workflow === 'pa_ta_analysis' && (
            <>
              <div className="px-4 py-3 bg-info/8 border border-info/20 rounded-xl text-[11px] text-info">
                PA level and status are calculated automatically using the EU MRL (400 µg/kg)
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={lbl}>Batch Number <span className="text-err">*</span></label>
                  <input value={pa.batch_no} onChange={e => setP('batch_no', e.target.value)} placeholder="e.g. GS-0350" className={`${inp} w-full`} />
                </div>
                {([['Report Name','report_name','text','e.g. Cape Natural Tea Products_260331B'],['Sample Date','sample_date','date',''],['Sample List','sample_list','text','e.g. Rooibos_260326'],['Purchase Order','purchase_order','text','e.g. BH-PO0000894']] as [string,string,string,string][]).map(([label, key, type, placeholder]) => (
                  <div key={key}>
                    <label className={lbl}>{label}</label>
                    <input type={type} value={(pa as any)[key]} onChange={e => setP(key, e.target.value)} placeholder={placeholder} className={`${inp} w-full`} />
                  </div>
                ))}
                <div>
                  <label className={lbl}>Total PA (µg/kg) <span className="text-err">*</span></label>
                  <input type="number" step="0.1" value={pa.total_pa_ug_kg} onChange={e => setP('total_pa_ug_kg', e.target.value)} placeholder="e.g. 271" className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={lbl}>Total TA (µg/kg)</label>
                  <input type="number" step="0.1" value={pa.total_ta_ug_kg} onChange={e => setP('total_ta_ug_kg', e.target.value)} placeholder="ND = leave blank" className={`${inp} w-full`} />
                </div>
              </div>
              {paPreview && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: PA_BG[paPreview.level] ?? '#f9fafb', border:`1px solid ${PA_COLOR[paPreview.level]}30` }}>
                  <span className="px-3 py-1 rounded-full font-bold text-[13px] bg-surface-card" style={{ color: PA_COLOR[paPreview.level], border:`2px solid ${PA_COLOR[paPreview.level]}` }}>{paPreview.level}</span>
                  <span className="font-bold text-[12px]" style={{ color: PA_COLOR[paPreview.level] }}>
                    {paPreview.status === 'PASS' ? '✓ PASS — within EU limit (≤ 400 µg/kg)' : '✗ FAIL — exceeds EU MRL (> 400 µg/kg)'}
                  </span>
                  <span className="ml-auto text-[11px] text-text-muted">
                    {pa.total_pa_ug_kg} µg/kg = {(parseFloat(pa.total_pa_ug_kg) / 1000).toFixed(4)} mg/kg
                  </span>
                </div>
              )}
            </>
          )}

          {/* ── RESIDUE FORM ── */}
          {workflow === 'residue' && (
            <>
              <div className="px-4 py-3 bg-ok/8 border border-ok/20 rounded-xl text-[11px] text-ok">
                R-grades are calculated automatically. For "&lt;0.01" use prefix "&lt;" and value "0.01".
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={lbl}>Batch Number <span className="text-err">*</span></label>
                  <input value={res.batch_no} onChange={e => setR('batch_no', e.target.value)} placeholder="e.g. MAT-0350" className={`${inp} w-full`} />
                </div>
                {([['Report Reference','report_reference','text'],['Sample Date','sample_date','date'],['Laboratory','lab','text'],['Compounds Screened','total_compounds_screened','number']] as [string,string,string][]).map(([label, key, type]) => (
                  <div key={key}>
                    <label className={lbl}>{label}</label>
                    <input type={type} value={(res as any)[key]} onChange={e => setR(key, e.target.value)} className={`${inp} w-full`} />
                  </div>
                ))}
              </div>

              {/* Compound rows */}
              <div>
                <div className="font-bold text-[12px] text-text mb-2">Detected Compounds</div>
                <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-brand">
                        {['Compound Name','Prefix','Detected (mg/kg)','EU MRL (mg/kg)',''].map(h => (
                          <th key={h} className="px-3 py-2 text-white font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-rule">
                      {compounds.map((c, i) => (
                        <tr key={i} className={i % 2 === 1 ? 'bg-surface/50' : ''}>
                          <td className="px-2 py-1.5">
                            <input value={c.compound_name} onChange={e => setC(i, 'compound_name', e.target.value)} placeholder="e.g. Cyfluthrin" className={`${inp} w-full`} />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={c.detected_value_prefix} onChange={e => setC(i, 'detected_value_prefix', e.target.value)} className={`${inp} w-full`}>
                              <option value="">—</option>
                              <option value="<">&lt;</option>
                              <option value="≤">≤</option>
                              <option value="ND">ND</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="0.001" value={c.detected_value_mg_kg} onChange={e => setC(i, 'detected_value_mg_kg', e.target.value)} placeholder="0.000" className={`${inp} w-full text-center`} />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="0.001" value={c.mrl_eu_mg_kg} onChange={e => setC(i, 'mrl_eu_mg_kg', e.target.value)} placeholder="0.000" className={`${inp} w-full text-center`} />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {compounds.length > 1 && (
                              <button onClick={() => setCompounds(cs => cs.filter((_, ci) => ci !== i))} className="text-err text-[14px] font-bold leading-none">×</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() => setCompounds(cs => [...cs, { compound_name:'', detected_value_prefix:'', detected_value_mg_kg:'', mrl_eu_mg_kg:'', eu_mrl_exceeded:false }])}
                  className="mt-2 w-full py-2 rounded-xl border-2 border-dashed border-surface-rule text-text-muted text-[12px] hover:border-accent/40 hover:text-text transition-colors"
                >
                  + Add Compound
                </button>
                <div className="mt-2 px-3 py-2 bg-ok/5 border border-ok/20 rounded-lg text-[11px] text-ok">
                  💡 If none detected — leave all rows blank and save. Record will be saved as R-0 / PASS.
                </div>
              </div>
            </>
          )}

          {/* ── GLYPHOSATE FORM ── */}
          {workflow === 'glyphosate' && (
            <>
              <div className="px-4 py-3 bg-purple-50 border border-purple-100 rounded-xl text-[11px] text-purple-700">
                EU MRL for Glyphosate on herbal infusions is <strong>0.1 mg/kg</strong>. Status is calculated automatically.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={lbl}>Batch Number <span className="text-err">*</span></label>
                  <input value={gly.batch_no} onChange={e => setG('batch_no', e.target.value)} placeholder="e.g. GS-0350" className={`${inp} w-full`} />
                </div>
                {([['Report Reference','report_reference','text'],['Sample Date','sample_date','date'],['Grade / Variant','grade','text']] as [string,string,string][]).map(([label, key, type]) => (
                  <div key={key}>
                    <label className={lbl}>{label}</label>
                    <input type={type} value={(gly as any)[key]} onChange={e => setG(key, e.target.value)} className={`${inp} w-full`} />
                  </div>
                ))}
              </div>
              {(['glyphosate','ampa','glufosinate'] as const).map(key => {
                const labels: Record<string, string> = { glyphosate:'Glyphosate', ampa:'AMPA', glufosinate:'Glufosinate' }
                const detected = (gly as any)[`${key}_detected`] as boolean
                const valKey   = `${key}_value_mg_kg`
                return (
                  <div key={key} className="bg-surface border border-surface-rule rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer text-[13px] font-semibold text-text">
                        <input
                          type="checkbox"
                          checked={detected}
                          onChange={e => setG(`${key}_detected`, e.target.checked)}
                          className="w-4 h-4 accent-brand"
                        />
                        {labels[key]} detected
                      </label>
                      {!detected && <span className="text-[11px] text-text-faint italic">— not detected (ND)</span>}
                    </div>
                    {detected && (
                      <div className="flex items-center gap-3">
                        <label className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Detected value (mg/kg)</label>
                        <input
                          type="number" step="0.001"
                          value={(gly as any)[valKey]}
                          onChange={e => setG(valKey, e.target.value)}
                          placeholder="0.000"
                          className={`${inp} w-32 text-center`}
                        />
                        {key === 'glyphosate' && (gly as any).glyphosate_value_mg_kg && (
                          <span className={`font-bold text-[12px] ${parseFloat((gly as any).glyphosate_value_mg_kg) > EU_GLYPHOSATE_MRL ? 'text-err' : 'text-ok'}`}>
                            {parseFloat((gly as any).glyphosate_value_mg_kg) > EU_GLYPHOSATE_MRL ? '⚠ Exceeds EU MRL (0.1)' : '✓ Within EU MRL'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {err && (
            <div className="px-4 py-3 bg-err/8 border border-err/20 rounded-xl text-[12px] text-err">⚠ {err}</div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-surface-rule">
            <button onClick={onClose} className="px-5 py-2 rounded-xl border border-surface-rule text-text-muted hover:text-text text-[12px]">
              Cancel
            </button>
            <button onClick={save} disabled={saving} className="px-6 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : '💾 Save Record'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Leaf Shade tab ─────────────────────────────────────────────────────────
// Canon CR3 upload → ML classifier (leaf_shade_mlp_28feat_balanced_2026v1,
// scikit-learn 1.7.2, served by the Python micro-service on 127.0.0.1:5001).
// The lab also records the shade they physically see (1–11) + a free-text note.
// Saved to qms.quality_records (workflow='leaf_shade').

const SHADE_OPTIONS = ['1','2','3','4','5','6','7','8','9','10','11']

// Leaf shade is captured per facility — each is its own sub-tab.
const LEAF_SHADE_LOCATIONS = ['Graafwater', 'Vanrhynsdorp', 'Blackheath']

function LeafShadeTab({ records, canWrite, onRefresh }: {
  records: QRecord[]; canWrite: boolean; onRefresh: () => void
}) {
  const db = getDb()
  const [loc,     setLoc]     = useState(LEAF_SHADE_LOCATIONS[0])
  const [file,    setFile]    = useState<File | null>(null)
  const [batch,   setBatch]   = useState('')
  const [observed,setObserved]= useState('')
  const [note,    setNote]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState('')
  const [result,  setResult]  = useState<any>(null)
  const [drag,    setDrag]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File | null) {
    setErr('')
    if (!f) { setFile(null); return }
    if (!f.name.toLowerCase().endsWith('.cr3')) { setErr('Only Canon CR3 files are accepted.'); return }
    setFile(f); setResult(null)
  }

  async function analyse() {
    if (!file) { setErr('Choose a CR3 file first.'); return }
    setErr(''); setBusy(true); setResult(null)
    try {
      const fd = new FormData()
      fd.append('cr3', file)
      const res  = await fetch('/api/leaf-shade/predict', { method: 'POST', body: fd })
      // The server may return an HTML error page (e.g. Nginx 413 for an
      // oversized upload) instead of JSON — handle that gracefully.
      const raw = await res.text()
      let data: any = null
      try { data = raw ? JSON.parse(raw) : null } catch { /* not JSON */ }
      if (!res.ok || !data) {
        if (res.status === 413) throw new Error(`File too large — the server rejected the upload (${(file.size/1024/1024).toFixed(1)} MB). Ask IT to raise Nginx client_max_body_size.`)
        throw new Error(data?.error ?? `Prediction failed (HTTP ${res.status})`)
      }
      setResult(data)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!result) return
    if (!batch.trim()) { setErr('Batch number is required to save.'); return }
    setErr(''); setSaving(true)
    try {
      const { error } = await db.schema('qms').from('quality_records').insert({
        workcenter: 'rawMaterial', workflow: 'leaf_shade', batch_number: batch.trim(),
        file_name: result.filename || file?.name || 'leaf_shade',
        data_json: {
          predicted_shade: result.predicted_shade,
          confidence_pct:  result.confidence_pct,
          top5:            result.top5,
          model_version:   result.model_version,
          analysed_at:     new Date().toISOString(),
          location:        loc,
          physical_shade:  observed || null,
          observation:     note.trim() || null,
          features:        result.features,
          camera:          result.camera,
          _source_file:    result.filename || file?.name,
        },
      })
      if (error) throw new Error(error.message)
      setFile(null); setResult(null); setBatch(''); setObserved(''); setNote('')
      if (fileRef.current) fileRef.current.value = ''
      onRefresh()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const cam = result?.camera
  const locRecords = records.filter(r => (r.data_json?.location || '') === loc)

  return (
    <div className="space-y-4">
      {/* Environment / facility sub-tabs (leaf shade only) */}
      <div className="flex gap-2 flex-wrap">
        {LEAF_SHADE_LOCATIONS.map(l => {
          const n = records.filter(r => (r.data_json?.location || '') === l).length
          return (
            <button key={l} onClick={() => { setLoc(l); setErr('') }}
              className={`px-4 py-2 rounded-xl text-[12px] font-semibold border transition-colors ${
                loc === l ? 'bg-brand text-white border-brand' : 'bg-surface-card text-text-muted border-surface-rule hover:text-text'
              }`}>
              📍 {l}
              <span className={`ml-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded-full ${loc === l ? 'bg-white/20' : 'bg-surface'}`}>{n}</span>
            </button>
          )
        })}
      </div>

      {canWrite && (
        <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
          <div className="font-semibold text-[14px] text-text mb-1">🍃 Leaf Shade Classifier — {loc}</div>
          <div className="text-[11px] text-text-muted mb-4">Upload a Canon <strong>CR3</strong> RAW photo of the leaf sample taken at <strong>{loc}</strong>. The model predicts the shade; the lab confirms what they physically see.</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: upload + analyse */}
            <div className="space-y-3">
              <div>
                <label className={lbl}>CR3 file</label>
                {/* Drag-and-drop zone (also click to browse) */}
                <div
                  onDragOver={e => { e.preventDefault(); setDrag(true) }}
                  onDragLeave={e => { e.preventDefault(); setDrag(false) }}
                  onDrop={e => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files?.[0] ?? null) }}
                  onClick={() => fileRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                    drag ? 'border-brand bg-info/10' : 'border-surface-rule hover:border-brand/40 hover:bg-surface'
                  }`}>
                  <div className="text-xl mb-1">📄</div>
                  <div className="text-[12px] font-semibold text-text-muted">Drag &amp; drop a CR3 file here</div>
                  <div className="text-[11px] text-text-faint mb-2">or click to browse</div>
                  <span className="inline-block px-3 py-1 rounded-lg bg-brand text-white text-[11px] font-semibold">Browse CR3</span>
                  <input ref={fileRef} type="file" accept=".cr3,image/x-canon-cr3"
                    onChange={e => { pickFile(e.target.files?.[0] ?? null); e.currentTarget.value = '' }}
                    className="hidden" />
                </div>
                {file && <div className="mt-1 text-[11px] text-text-muted">📄 {file.name} ({(file.size/1024/1024).toFixed(1)} MB)</div>}
              </div>
              <button onClick={analyse} disabled={!file || busy}
                className="px-5 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold disabled:opacity-50">
                {busy ? 'Analysing…' : '🔬 Analyse'}
              </button>
            </div>

            {/* Right: prediction result */}
            <div className="bg-surface border border-surface-rule rounded-xl p-4">
              {!result ? (
                <div className="text-[12px] text-text-faint h-full flex items-center justify-center">Prediction will appear here</div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display font-bold text-[26px] text-text">{result.predicted_shade}</span>
                    <span className="text-[12px] text-text-muted">{result.confidence_pct}% confidence</span>
                  </div>
                  {Array.isArray(result.top5) && (
                    <div className="space-y-1">
                      {result.top5.map((t: any) => (
                        <div key={t.rank} className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-text-muted w-16 shrink-0">{t.shade}</span>
                          <div className="flex-1 h-2 bg-surface-rule rounded-full overflow-hidden">
                            <div className="h-full bg-brand/70" style={{ width: `${t.confidence}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-text-muted w-12 text-right">{t.confidence}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {cam && (
                    <div className={`text-[11px] mt-2 px-2 py-1 rounded-lg ${cam.compliant ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
                      {cam.compliant ? '✅ Camera settings compliant' : `⚠️ Camera: ${(cam.issues || []).join(', ')}`}
                    </div>
                  )}
                  <div className="text-[10px] text-text-faint">model: {result.model_version}</div>
                </div>
              )}
            </div>
          </div>

          {/* Lab observation + save */}
          {result && (
            <div className="mt-4 pt-4 border-t border-surface-rule grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={lbl}>Batch No. * <span className="text-text-faint normal-case">· {loc}</span></label>
                <input className={inp + ' w-full'} value={batch} onChange={e => setBatch(e.target.value)} placeholder="e.g. GS-0098" />
              </div>
              <div>
                <label className={lbl}>Observed shade (1–11)</label>
                <select className={inp + ' w-full'} value={observed} onChange={e => setObserved(e.target.value)}>
                  <option value="">—</option>
                  {SHADE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold disabled:opacity-50 w-full">
                  {saving ? 'Saving…' : '💾 Save Record'}
                </button>
              </div>
              <div className="md:col-span-3">
                <label className={lbl}>What the lab physically sees (notes)</label>
                <textarea className={inp + ' w-full'} rows={2} value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Colour, condition, any visible differences from the predicted shade…" />
              </div>
            </div>
          )}

          {err && <div className="mt-3 text-[12px] text-err">⚠ {err}</div>}
        </div>
      )}

      {/* History */}
      <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
          <span className="font-semibold text-[14px] text-text">🍃 Leaf Shade Records — {loc}</span>
          <span className="text-[11px] text-text-muted">{locRecords.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface border-b border-surface-rule">
                {['Batch','Date','Predicted','Conf.','Observed','Location','Camera','Notes'].map(h => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                ))}
                {canWrite && <th className="px-4 py-2.5 font-mono text-[10px] text-text-muted">Del</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {locRecords.length === 0 && (
                <tr><td colSpan={canWrite ? 9 : 8} className="px-4 py-8 text-center text-[12px] text-text-muted">No leaf shade records for {loc} yet.</td></tr>
              )}
              {locRecords.map((r, i) => {
                const d = r.data_json || {}
                const camOk = d.camera?.compliant
                return (
                  <tr key={r.id} className={`hover:bg-surface ${i%2===1?'bg-surface/50':''}`}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[12px] text-text">{r.batch_number || '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted font-mono">{isoDateTime(r.created_at)}</td>
                    <td className="px-4 py-2.5 text-[12px] font-semibold text-text">{d.predicted_shade || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-text-muted">{d.confidence_pct != null ? `${d.confidence_pct}%` : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text">{d.physical_shade || '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted">{d.location || '—'}</td>
                    <td className="px-4 py-2.5 text-[11px]">{d.camera ? (camOk ? <span className="text-ok">✓</span> : <span className="text-warn">⚠</span>) : '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted max-w-[200px] truncate" title={d.observation || ''}>{d.observation || '—'}</td>
                    {canWrite && (
                      <td className="px-4 py-2.5">
                        <button onClick={async () => { if (!confirm('Delete this record?')) return; await db.schema('qms').from('quality_records').delete().eq('id', r.id); onRefresh() }}
                          className="px-2 py-0.5 rounded border border-err/30 bg-err/8 text-err text-[10px]">✕</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── pH / TDS tab ───────────────────────────────────────────────────────────
// Manual lab entry of pH and TDS per batch. Saved to qms.quality_records
// (workflow='ph_tds'). Separate from the Leaf Shade tab by request.

function PhTdsTab({ records, canWrite, onRefresh }: {
  records: QRecord[]; canWrite: boolean; onRefresh: () => void
}) {
  const db = getDb()
  const [batch, setBatch] = useState('')
  const [ph,    setPh]    = useState('')
  const [tds,   setTds]   = useState('')
  const [note,  setNote]  = useState('')
  const [saving,setSaving]= useState(false)
  const [err,   setErr]   = useState('')

  async function save() {
    if (!batch.trim()) { setErr('Batch number is required.'); return }
    if (!ph && !tds)   { setErr('Enter at least a pH or a TDS value.'); return }
    setErr(''); setSaving(true)
    try {
      const { error } = await db.schema('qms').from('quality_records').insert({
        workcenter: 'rawMaterial', workflow: 'ph_tds', batch_number: batch.trim(), file_name: 'manual_entry',
        data_json: {
          ph:  ph  !== '' ? parseFloat(ph)  : null,
          tds: tds !== '' ? parseFloat(tds) : null,
          observation: note.trim() || null,
          analysed_at: new Date().toISOString(),
          _manual_entry: true,
        },
      })
      if (error) throw new Error(error.message)
      setBatch(''); setPh(''); setTds(''); setNote('')
      onRefresh()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
          <div className="font-semibold text-[14px] text-text mb-1">💧 pH / TDS Entry</div>
          <div className="text-[11px] text-text-muted mb-4">Record the measured pH and TDS for a batch.</div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className={lbl}>Batch No. *</label>
              <input className={inp + ' w-full'} value={batch} onChange={e => setBatch(e.target.value)} placeholder="e.g. GS-0098" />
            </div>
            <div>
              <label className={lbl}>pH</label>
              <input className={inp + ' w-full'} type="number" step="0.01" value={ph} onChange={e => setPh(e.target.value)} placeholder="e.g. 5.20" />
            </div>
            <div>
              <label className={lbl}>TDS (ppm)</label>
              <input className={inp + ' w-full'} type="number" step="1" value={tds} onChange={e => setTds(e.target.value)} placeholder="e.g. 340" />
            </div>
            <div className="md:col-span-2">
              <label className={lbl}>Notes</label>
              <input className={inp + ' w-full'} value={note} onChange={e => setNote(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="px-5 py-2 rounded-xl bg-ok text-white text-[12px] font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : '💾 Save Record'}
            </button>
            {err && <span className="text-[12px] text-err">⚠ {err}</span>}
          </div>
        </div>
      )}

      {/* History */}
      <div className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-rule">
          <span className="font-semibold text-[14px] text-text">💧 pH / TDS Records</span>
          <span className="text-[11px] text-text-muted">{records.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface border-b border-surface-rule">
                {['Batch','Date','pH','TDS (ppm)','Notes'].map(h => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wide text-text-muted whitespace-nowrap">{h}</th>
                ))}
                {canWrite && <th className="px-4 py-2.5 font-mono text-[10px] text-text-muted">Del</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {records.length === 0 && (
                <tr><td colSpan={canWrite ? 6 : 5} className="px-4 py-8 text-center text-[12px] text-text-muted">No pH / TDS records yet.</td></tr>
              )}
              {records.map((r, i) => {
                const d = r.data_json || {}
                return (
                  <tr key={r.id} className={`hover:bg-surface ${i%2===1?'bg-surface/50':''}`}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[12px] text-text">{r.batch_number || '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted font-mono">{isoDateTime(r.created_at)}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text">{d.ph != null ? d.ph : '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text">{d.tds != null ? d.tds : '—'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-text-muted max-w-[240px] truncate" title={d.observation || ''}>{d.observation || '—'}</td>
                    {canWrite && (
                      <td className="px-4 py-2.5">
                        <button onClick={async () => { if (!confirm('Delete this record?')) return; await db.schema('qms').from('quality_records').delete().eq('id', r.id); onRefresh() }}
                          className="px-2 py-0.5 rounded border border-err/30 bg-err/8 text-err text-[10px]">✕</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { key:'overview',       label:'📊 Overview'              },
  { key:'pa_ta_analysis', label:'🧪 PA/TA Alkaloids'       },
  { key:'residue',        label:'🌿 Residue / Pesticides'  },
  { key:'glyphosate',     label:'🧫 Glyphosate'            },
  { key:'leaf_shade',     label:'🍃 Leaf Shade'            },
  { key:'ph_tds',         label:'💧 pH / TDS'              },
  { key:'outstanding',    label:'⚠️ Outstanding'           },
]

// Tabs that do NOT use the PDF (Gemini) drop zone or the count badge
const NON_PDF_TABS = ['overview', 'outstanding', 'leaf_shade', 'ph_tds']

export default function RawMaterialPage() {
  const { p } = useAuth()
  const db       = getDb()
  const canWrite = p('can_save_records')
  const isAdmin  = p('can_delete_records')

  const [tab,         setTab]         = useState('overview')
  const [records,     setRecords]     = useState<QRecord[]>([])
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showManual,  setShowManual]  = useState(false)
  const [spinning,    setSpinning]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // qms is the single source (legacy public consolidated 2026-06-24; data_json now jsonb)
    const { data: qmsData, error } = await db.schema('qms').from('quality_records').select('*')
      .eq('workcenter', 'rawMaterial').order('created_at', { ascending: false })
    if (!error) {
      const merged = (qmsData ?? []).map((r: any) => ({
        ...r,
        // defensive: data_json is jsonb (object) now, but tolerate any legacy string rows
        data_json: typeof r.data_json === 'string' ? (() => { try { return JSON.parse(r.data_json) } catch { return {} } })() : (r.data_json ?? {}),
      })).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setRecords(merged as QRecord[])
      setLastUpdated(new Date())
    }
    setLoading(false)
    setSpinning(false)
  }, [db])

  useEffect(() => { load() }, [load])

  function updateComment(id: number, comment: string) {
    setRecords(p => p.map(r => r.id === id ? { ...r, comment } : r))
  }

  const byWf    = (wf: string) => records.filter(r => r.workflow === wf)
  const tabCount = (wf: string) => byWf(wf).length

  const showDropZone = canWrite && !NON_PDF_TABS.includes(tab)

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Tab bar */}
      <div className="bg-surface-card border-b border-surface-rule px-5 flex gap-0 overflow-x-auto flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-text-muted hover:text-text hover:border-surface-rule'
            }`}
          >
            {t.label}
            {t.key !== 'overview' && t.key !== 'outstanding' && (
              <span className="ml-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-surface text-text-muted">
                {tabCount(t.key)}
              </span>
            )}
          </button>
        ))}

        {/* Refresh control */}
        <div className="ml-auto flex items-center gap-2 px-3 py-2 flex-shrink-0">
          {lastUpdated && (
            <span className="text-[10px] text-text-faint">
              Updated {lastUpdated.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
            </span>
          )}
          <button
            onClick={() => { setSpinning(true); load() }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-rule text-text-muted hover:text-text text-[12px] transition-colors"
          >
            <RefreshCw size={12} className={spinning ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto p-5 max-w-[1400px] w-full mx-auto">

        {/* Drop zone + manual entry button */}
        {showDropZone && (
          <>
            <DropZone workcenter="rawMaterial" workflow={tab} onSuccess={() => { setSpinning(true); load() }} />
            <div className="text-center mb-4">
              <button
                onClick={() => setShowManual(true)}
                className="px-5 py-2 rounded-xl border-2 border-dashed border-brand/30 bg-info/5 text-brand text-[12px] font-bold hover:bg-info/10 transition-colors"
              >
                ✏️ Manual Entry — enter results without a PDF
              </button>
            </div>
          </>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <div className="w-8 h-8 border-2 border-surface-rule border-t-brand rounded-full animate-spin" />
            <div className="text-[13px] font-semibold text-text">Loading records…</div>
          </div>
        ) : (
          <>
            {tab === 'overview'       && <OverviewTable    records={records}                />}
            {tab === 'pa_ta_analysis' && <PATable          records={byWf('pa_ta_analysis')} isAdmin={canWrite} onRefresh={() => { setSpinning(true); load() }} onComment={updateComment} />}
            {tab === 'residue'        && <ResidueTable     records={byWf('residue')}         isAdmin={canWrite} onRefresh={() => { setSpinning(true); load() }} onComment={updateComment} />}
            {tab === 'glyphosate'     && <GlyphosateTable  records={byWf('glyphosate')}      isAdmin={canWrite} onRefresh={() => { setSpinning(true); load() }} onComment={updateComment} />}
            {tab === 'leaf_shade'     && <LeafShadeTab     records={byWf('leaf_shade')}      canWrite={canWrite} onRefresh={() => { setSpinning(true); load() }} />}
            {tab === 'ph_tds'         && <PhTdsTab         records={byWf('ph_tds')}          canWrite={canWrite} onRefresh={() => { setSpinning(true); load() }} />}
            {tab === 'outstanding'    && <OutstandingTracker />}
          </>
        )}

        {/* Manual entry modal */}
        {showManual && (
          <ManualEntryModal
            workflow={tab}
            onSaved={() => { setShowManual(false); setSpinning(true); load() }}
            onClose={() => setShowManual(false)}
          />
        )}
      </div>
    </div>
  )
}
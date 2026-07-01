'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Search, Loader2, Plus, X, Check, ChevronDown, BookOpen, Edit2,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { StaffTabs } from '@/components/production/StaffTabs'
import { SOP_AREAS, sopAreaMeta } from '@/lib/production/competency-config'

const db = () => getDb().schema('production')

interface Sop {
  id: string; doc_no: string; title: string; area: string; doc_type: string
  revision: string | null; status: string; section_id: string | null
  planned_date: string | null; actual_date: string | null
  sort_order: number; active: boolean; notes: string | null
}

const SOP_STATUSES = ['draft', 'active', 'under_review', 'obsolete']
const DOC_TYPES = ['wi', 'sop', 'training', 'policy']
const STATUS_COLORS: Record<string, string> = {
  active:       'bg-ok/15 text-ok',
  draft:        'bg-stone-100 text-stone-500',
  under_review: 'bg-warn/15 text-warn',
  obsolete:     'bg-err/10 text-err',
}
const fmtDate = (d: string | null) => d ? format(parseISO(d + 'T12:00:00'), 'd MMM yyyy') : '—'

export default function SopCataloguePage() {
  const { p } = useAuth()
  const canEdit = p('can_manage_sop_catalog')

  const [sops, setSops] = useState<Sop[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [areaFilter, setAreaFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [editing, setEditing] = useState<Sop | 'new' | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await db().from('sops').select('*').order('sort_order')
      setSops((data ?? []) as Sop[])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sops
      .filter(s => statusFilter === 'all' || s.status === statusFilter)
      .filter(s => areaFilter === 'all' || s.area === areaFilter)
      .filter(s => q === '' || s.title.toLowerCase().includes(q) || s.doc_no.toLowerCase().includes(q))
  }, [sops, query, areaFilter, statusFilter])

  const byArea = useMemo(() => {
    const m = new Map<string, Sop[]>()
    filtered.forEach(s => {
      const arr = m.get(s.area) ?? []
      arr.push(s)
      m.set(s.area, arr)
    })
    return m
  }, [filtered])

  async function saveSop(data: Partial<Sop>, id: string | null) {
    const payload = {
      doc_no: data.doc_no?.trim(), title: data.title?.trim(),
      area: data.area, doc_type: data.doc_type, revision: data.revision?.trim() || null,
      status: data.status, section_id: data.section_id || null,
      planned_date: data.planned_date || null, actual_date: data.actual_date || null,
      sort_order: data.sort_order ?? 0, active: data.active ?? true,
      notes: data.notes?.trim() || null,
    }
    if (id) {
      const { data: updated } = await db().from('sops').update(payload as any).eq('id', id).select('*').single()
      if (updated) setSops(ss => ss.map(s => s.id === id ? updated as Sop : s))
    } else {
      const { data: created } = await db().from('sops').insert(payload as any).select('*').single()
      if (created) setSops(ss => [...ss, created as Sop].sort((a, b) => a.sort_order - b.sort_order))
    }
    setEditing(null)
  }

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="font-display font-bold text-[22px] text-text">SOP Catalogue</h1>
            <p className="text-[12px] text-stone-400 mt-0.5">
              {sops.filter(s => s.active).length} active work-instructions and SOPs across all areas.
            </p>
          </div>
          {canEdit && (
            <button onClick={() => setEditing('new')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-mid transition-colors">
              <Plus size={14} /> Add SOP
            </button>
          )}
        </div>
        <StaffTabs />
      </div>

      {/* Filters */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[180px] px-3 rounded-xl border border-stone-200 bg-white focus-within:border-brand">
            <Search size={14} className="text-stone-400" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search SOPs…" className="flex-1 py-2 text-[13px] outline-none bg-transparent" />
          </div>
          <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand">
            <option value="all">All areas</option>
            {SOP_AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-[13px] outline-none focus:border-brand">
            <option value="all">All statuses</option>
            {SOP_STATUSES.map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-stone-300" />
        </div>
      ) : (
        <div className="space-y-3">
          {SOP_AREAS.filter(a => byArea.has(a.key)).map(area => {
            const areaSops = byArea.get(area.key) ?? []
            return (
              <div key={area.key} className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-surface-rule flex items-center gap-2"
                  style={{ borderLeft: `3px solid ${area.colorHex}` }}>
                  <span className="font-medium text-[13px] text-text">{area.label}</span>
                  <span className="text-[11px] text-text-muted">{areaSops.length}</span>
                </div>
                {areaSops.map(sop => (
                  <div key={sop.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-rule last:border-0 hover:bg-surface transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] font-semibold text-stone-400">{sop.doc_no}</span>
                        <span className="text-[12px] font-medium text-text">{sop.title}</span>
                        {sop.revision && <span className="text-[10px] text-stone-400">rev {sop.revision}</span>}
                        {sop.section_id && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand/8 text-brand capitalize">{sop.section_id}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-text-muted">
                        <span className="capitalize">{sop.doc_type.replace('_', ' ')}</span>
                        {sop.planned_date && <span>Planned: {fmtDate(sop.planned_date)}</span>}
                        {sop.actual_date && <span>Completed: {fmtDate(sop.actual_date)}</span>}
                      </div>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize shrink-0 ${STATUS_COLORS[sop.status] ?? 'bg-stone-100 text-stone-500'}`}>
                      {sop.status.replace('_', ' ')}
                    </span>
                    {canEdit && (
                      <button onClick={() => setEditing(sop)}
                        className="text-stone-300 hover:text-brand transition-colors shrink-0">
                        <Edit2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-[13px] text-text-muted text-center py-12">No SOPs match this filter.</p>
          )}
        </div>
      )}

      {editing && (
        <SopEditModal
          sop={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveSop}
        />
      )}
    </div>
  )
}

function SopEditModal({ sop, onClose, onSave }: {
  sop: Sop | null
  onClose: () => void
  onSave: (data: Partial<Sop>, id: string | null) => void
}) {
  const [docNo, setDocNo] = useState(sop?.doc_no ?? '')
  const [title, setTitle] = useState(sop?.title ?? '')
  const [area, setArea] = useState(sop?.area ?? 'production')
  const [docType, setDocType] = useState(sop?.doc_type ?? 'wi')
  const [revision, setRevision] = useState(sop?.revision ?? '')
  const [status, setStatus] = useState(sop?.status ?? 'active')
  const [sectionId, setSectionId] = useState(sop?.section_id ?? '')
  const [plannedDate, setPlannedDate] = useState(sop?.planned_date ?? '')
  const [actualDate, setActualDate] = useState(sop?.actual_date ?? '')
  const [sortOrder, setSortOrder] = useState(sop?.sort_order?.toString() ?? '0')
  const [notes, setNotes] = useState(sop?.notes ?? '')
  const [active, setActive] = useState(sop?.active ?? true)
  const valid = docNo.trim().length > 0 && title.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[500px] my-8 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[16px] text-text">{sop ? 'Edit SOP' : 'Add SOP'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={15} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Document No." className="col-span-1">
            <input value={docNo} onChange={e => setDocNo(e.target.value)} className={INP} placeholder="e.g. PROD-WI-001" />
          </Field>
          <Field label="Revision">
            <input value={revision} onChange={e => setRevision(e.target.value)} className={INP} placeholder="e.g. 7" />
          </Field>
          <Field label="Title" className="col-span-2">
            <input value={title} onChange={e => setTitle(e.target.value)} className={INP} placeholder="SOP title" />
          </Field>
          <Field label="Area">
            <div className="relative">
              <select value={area} onChange={e => setArea(e.target.value)} className={`${INP} appearance-none pr-8`}>
                {SOP_AREAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            </div>
          </Field>
          <Field label="Type">
            <div className="relative">
              <select value={docType} onChange={e => setDocType(e.target.value)} className={`${INP} appearance-none pr-8`}>
                {DOC_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.toUpperCase()}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            </div>
          </Field>
          <Field label="Status">
            <div className="relative">
              <select value={status} onChange={e => setStatus(e.target.value)} className={`${INP} appearance-none pr-8`}>
                {SOP_STATUSES.map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            </div>
          </Field>
          <Field label="Floor section (if applicable)">
            <input value={sectionId} onChange={e => setSectionId(e.target.value)} className={INP} placeholder="sieving, granule, …" />
          </Field>
          <Field label="Planned date">
            <input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} className={INP} />
          </Field>
          <Field label="Actual date">
            <input type="date" value={actualDate} onChange={e => setActualDate(e.target.value)} className={INP} />
          </Field>
          <Field label="Sort order">
            <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className={INP} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${INP} resize-none`} placeholder="Optional notes…" />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand" />
          Active (uncheck to retire this SOP)
        </label>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
          <button disabled={!valid}
            onClick={() => valid && onSave(
              { doc_no: docNo, title, area, doc_type: docType, revision, status, section_id: sectionId || null,
                planned_date: plannedDate || null, actual_date: actualDate || null,
                sort_order: parseInt(sortOrder) || 0, notes, active },
              sop?.id ?? null
            )}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            <Check size={14} /> {sop ? 'Save changes' : 'Add SOP'}
          </button>
        </div>
      </div>
    </div>
  )
}

const INP = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand'
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  )
}

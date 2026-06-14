'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, startOfWeek } from 'date-fns'
import {
  Factory, Filter, Download, Loader2, ChevronRight, ChevronDown, MessageSquare, ArrowUpDown,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { sectionMeta, SECTION_ORDER, VARIANT_OPTIONS } from '@/lib/production/capture-config'
import { SHIFT_LABEL } from '@/lib/production/shifts'
import { downloadCsv } from '@/lib/utils/csv-export'
import { HubTabs } from '@/components/supervisor/HubTabs'

interface Row {
  id:              string
  section_id:      string
  date:            string
  shift:           string
  status:          string
  operator_names:  string[] | null
  variant:         string | null
  lot_number:      string | null
  comments:        string | null
  kgIn:            number
  kgOut:           number
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',      cls: 'bg-warn/10 text-warn' },
  submitted: { label: 'Submitted',  cls: 'bg-info/10 text-info' },
  approved:  { label: 'Signed off', cls: 'bg-ok/10 text-ok' },
}
const todayStr = () => format(new Date(), 'yyyy-MM-dd')

export default function SupervisorProductions() {
  const { p } = useAuth()
  const canExport = p('can_export_csv')

  const [start, setStart] = useState(() => format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  const [end, setEnd]     = useState(todayStr)
  const [section, setSection]   = useState('all')
  const [operator, setOperator] = useState('all')
  const [variant, setVariant]   = useState('all')
  const [status, setStatus]     = useState('all')

  const [rows, setRows]     = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const db = getDb()
      const { data: sessions } = await db.schema('production').from('prod_sessions')
        .select('id,section_id,date,shift,status,operator_names,variant,lot_number,comments')
        .gte('date', start).lte('date', end).order('date', { ascending: false })
      const sess = (sessions as any[]) ?? []
      const ids = sess.map(s => s.id)
      let mb: any[] = []
      if (ids.length) {
        const { data } = await db.schema('production').from('prod_mass_balance')
          .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg')
          .in('session_id', ids)
        mb = (data as any[]) ?? []
      }
      const byId = new Map(mb.map(m => [m.session_id, m]))
      if (!alive) return
      setRows(sess.map(s => {
        const m = byId.get(s.id)
        return {
          ...s,
          kgIn: m ? Number(m.total_input_kg) || 0 : 0,
          kgOut: m ? (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0) : 0,
        } as Row
      }))
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [start, end])

  const operatorOptions = useMemo(
    () => Array.from(new Set(rows.flatMap(r => r.operator_names ?? []))).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const filtered = useMemo(() => rows.filter(r =>
    (section === 'all' || r.section_id === section) &&
    (operator === 'all' || (r.operator_names ?? []).includes(operator)) &&
    (variant === 'all' || r.variant === variant) &&
    (status === 'all' || r.status === status),
  ), [rows, section, operator, variant, status])

  function toggle(id: string) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function exportCsv() {
    downloadCsv(filtered, [
      { header: 'Date',      value: r => r.date },
      { header: 'Shift',     value: r => SHIFT_LABEL[r.shift as keyof typeof SHIFT_LABEL] ?? r.shift },
      { header: 'Section',   value: r => sectionMeta(r.section_id).name },
      { header: 'Operators', value: r => (r.operator_names ?? []).join(' / ') },
      { header: 'Variant',   value: r => r.variant ?? '' },
      { header: 'Lot',       value: r => r.lot_number ?? '' },
      { header: 'kg in',     value: r => r.kgIn.toFixed(1) },
      { header: 'kg out',    value: r => r.kgOut.toFixed(1) },
      { header: 'Status',    value: r => STATUS[r.status]?.label ?? r.status },
      { header: 'Handover note', value: r => r.comments ?? '' },
    ], `productions_${start}_to_${end}`)
  }

  const SEL = 'px-3 py-2 rounded-lg border border-stone-200 bg-white text-[12px] outline-none focus:border-brand cursor-pointer'

  return (
    <div className="px-4 py-6 max-w-[1000px] mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-[22px] text-text">Supervisor Hub</h1>
        <p className="text-[12px] text-stone-400 mt-0.5">What was produced — sessions, operators, and handover notes</p>
      </div>
      <HubTabs />

      {/* Range */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setStart(todayStr()); setEnd(todayStr()) }}
          className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${start === todayStr() && end === todayStr() ? 'bg-brand text-white border-brand' : 'bg-white border-stone-200 text-stone-500 hover:border-brand'}`}>Today</button>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
        <span className="text-[12px] text-stone-400">→</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
        <div className="flex-1" />
        {canExport && (
          <button onClick={exportCsv} disabled={!filtered.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-[12px] text-stone-600 hover:border-brand hover:text-brand disabled:opacity-40 transition-colors">
            <Download size={13} /> Export CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={13} className="text-stone-400" />
        <select value={section} onChange={e => setSection(e.target.value)} className={SEL}>
          <option value="all">All sections</option>
          {SECTION_ORDER.map(s => <option key={s} value={s}>{sectionMeta(s).name}</option>)}
        </select>
        <select value={operator} onChange={e => setOperator(e.target.value)} className={SEL}>
          <option value="all">All operators</option>
          {operatorOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={variant} onChange={e => setVariant(e.target.value)} className={SEL}>
          <option value="all">All variants</option>
          {VARIANT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className={SEL}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : !filtered.length ? (
        <div className="text-center py-16">
          <Factory size={28} className="mx-auto mb-3 text-stone-200" />
          <p className="font-mono text-[12px] text-stone-400">No productions in this range</p>
        </div>
      ) : (
        <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-rule bg-surface font-mono text-[10px] text-text-muted uppercase tracking-wide">
            <ArrowUpDown size={11} /> {filtered.length} session{filtered.length !== 1 ? 's' : ''} · newest first
          </div>
          <div className="divide-y divide-surface-rule">
            {filtered.map(r => {
              const m = sectionMeta(r.section_id)
              const st = STATUS[r.status] ?? { label: r.status, cls: 'bg-stone-100 text-stone-500' }
              const href = `/production/capture/${r.section_id}?date=${r.date}&shift=${r.shift}`
              const hasNote = !!(r.comments && r.comments.trim())
              const open = expanded.has(r.id)
              return (
                <div key={r.id}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                    <button onClick={() => hasNote && toggle(r.id)} className={`shrink-0 ${hasNote ? 'text-stone-300 hover:text-stone-600' : 'text-transparent cursor-default'}`}>
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                      <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-body font-medium text-[13px] text-text">{m.name}</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 capitalize">{r.shift}</span>
                        {r.variant && <span className="font-mono text-[10px] text-text-muted">{r.variant}</span>}
                        {r.lot_number && <span className="font-mono text-[10px] text-text-muted">· {r.lot_number}</span>}
                        {hasNote && <MessageSquare size={12} className="text-info" />}
                      </div>
                      <div className="font-mono text-[11px] text-text-muted mt-0.5">
                        {format(parseISO(r.date + 'T12:00:00'), 'EEE d MMM')}
                        {(r.operator_names ?? []).length ? ` · ${(r.operator_names ?? []).join(', ')}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <div className="font-mono text-[12px] text-text">{r.kgOut ? r.kgOut.toFixed(1) : '—'} kg</div>
                      <div className="font-mono text-[10px] text-text-muted">{r.kgIn ? `${r.kgIn.toFixed(1)} in` : ''}</div>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-1 rounded-lg shrink-0 ${st.cls}`}>{st.label}</span>
                    <Link href={href} className="text-text-muted hover:text-brand shrink-0"><ChevronRight size={15} /></Link>
                  </div>
                  {open && hasNote && (
                    <div className="px-12 pb-3">
                      <div className="flex items-start gap-2 px-3 py-2.5 bg-info/5 border border-info/20 rounded-xl text-[12px] text-text">
                        <MessageSquare size={13} className="shrink-0 mt-0.5 text-info" />
                        <span><span className="font-semibold text-info">Handover note:</span> {r.comments}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CalendarRange, Loader2, Plus, X, Check, Trash2, Pencil,
  ChevronDown, AlertTriangle, Sun, Moon, Search,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import {
  ROSTER_SHIFTS, ROSTER_CATEGORIES, ROSTER_ROLE_SEED, SKILL_TAGS,
  categoryMeta, tagLabel,
  type RosterRole, type RosterShift,
} from '@/lib/production/roster-config'
import type { Operator } from '@/lib/supabase/database.types'

interface Period {
  id: string; name: string; start_date: string; end_date: string
  day_label: string; night_label: string; notes: string | null
}
interface Entry {
  id: string; period_id: string; role_key: string; shift: RosterShift
  operator_id: string | null; person_name: string; tags: string[]; sort_order: number
}

const db = () => getDb().schema('production')
const fmtRange = (p: Period) =>
  `${format(parseISO(p.start_date + 'T12:00:00'), 'd MMM')} – ${format(parseISO(p.end_date + 'T12:00:00'), 'd MMM yyyy')}`

export default function RosterPage() {
  const { user } = useAuth()
  const [roles, setRoles]     = useState<RosterRole[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [periodId, setPeriodId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [dbReady, setDbReady] = useState(true)
  const [showNew,  setShowNew] = useState(false)
  // which cell editor is open: `add:${roleKey}:${shift}` for an add, entry id for edit
  const [editing, setEditing] = useState<string | null>(null)

  const period = periods.find(p => p.id === periodId) ?? null

  // ── Load roles + operators + periods once ───────────────────────────────────
  useEffect(() => {
    (async () => {
      // Operators (the employee list) — drives the person picker.
      db().from('operators').select('*').eq('active', true).order('name')
        .then(({ data }: any) => setOperators((data as Operator[]) ?? []))

      // Roles — fall back to the static seed if the table isn't there yet.
      try {
        const { data, error } = await db().from('roster_roles')
          .select('key,name,category,sort_order').eq('active', true).order('sort_order')
        if (error) throw error
        const rows = (data as any[]) ?? []
        setRoles(rows.length
          ? rows.map(r => ({ key: r.key, name: r.name, category: r.category, sort: r.sort_order }))
          : ROSTER_ROLE_SEED)
      } catch {
        setRoles(ROSTER_ROLE_SEED)
        setDbReady(false)
      }
      // Periods
      try {
        const { data, error } = await db().from('roster_periods')
          .select('id,name,start_date,end_date,day_label,night_label,notes')
          .order('start_date', { ascending: false })
        if (error) throw error
        const rows = (data as Period[]) ?? []
        setPeriods(rows)
        if (rows.length) setPeriodId(rows[0].id)
      } catch {
        setDbReady(false)
      }
      setLoading(false)
    })()
  }, [])

  // ── Load entries when the selected period changes ───────────────────────────
  useEffect(() => {
    if (!periodId) { setEntries([]); return }
    db().from('roster_entries')
      .select('id,period_id,role_key,shift,operator_id,person_name,tags,sort_order')
      .eq('period_id', periodId).order('sort_order')
      .then(({ data }: any) => setEntries((data as Entry[]) ?? []))
  }, [periodId])

  const rolesByCategory = useMemo(() => {
    const map = new Map<string, RosterRole[]>()
    roles.forEach(r => { (map.get(r.category) ?? map.set(r.category, []).get(r.category)!).push(r) })
    return ROSTER_CATEGORIES
      .map(c => ({ cat: c, items: (map.get(c.key) ?? []).sort((a, b) => a.sort - b.sort) }))
      .filter(g => g.items.length)
  }, [roles])

  function cellEntries(roleKey: string, shift: RosterShift) {
    return entries
      .filter(e => e.role_key === roleKey && e.shift === shift)
      .sort((a, b) => a.sort_order - b.sort_order)
  }

  // ── Entry CRUD ──────────────────────────────────────────────────────────────
  async function addEntry(roleKey: string, shift: RosterShift, operatorId: string | null, name: string, tags: string[]) {
    if (!periodId || !name.trim()) return
    const sort = cellEntries(roleKey, shift).length
    const { data } = await db().from('roster_entries').insert({
      period_id: periodId, role_key: roleKey, shift,
      operator_id: operatorId, person_name: name.trim(), tags, sort_order: sort,
    } as any).select('id,period_id,role_key,shift,operator_id,person_name,tags,sort_order').single()
    if (data) setEntries(es => [...es, data as Entry])
    setEditing(null)
  }
  async function updateEntry(id: string, operatorId: string | null, name: string, tags: string[]) {
    if (!name.trim()) return
    await db().from('roster_entries').update({ operator_id: operatorId, person_name: name.trim(), tags } as any).eq('id', id)
    setEntries(es => es.map(e => e.id === id ? { ...e, operator_id: operatorId, person_name: name.trim(), tags } : e))
    setEditing(null)
  }
  async function deleteEntry(id: string) {
    await db().from('roster_entries').delete().eq('id', id)
    setEntries(es => es.filter(e => e.id !== id))
    setEditing(null)
  }

  // ── New period ──────────────────────────────────────────────────────────────
  async function createPeriod(p: { name: string; start: string; end: string }) {
    const { data } = await db().from('roster_periods').insert({
      name: p.name, start_date: p.start, end_date: p.end, created_by: user?.id ?? null,
    } as any).select('id,name,start_date,end_date,day_label,night_label,notes').single()
    if (data) {
      setPeriods(ps => [data as Period, ...ps])
      setPeriodId((data as Period).id)
    }
    setShowNew(false)
  }
  async function deletePeriod(id: string) {
    await db().from('roster_periods').delete().eq('id', id)
    const rest = periods.filter(p => p.id !== id)
    setPeriods(rest)
    setPeriodId(rest[0]?.id ?? null)
  }

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-[22px] text-text">Shift Roster</h1>
        <p className="text-[12px] text-stone-400 mt-0.5">The whole-site monthly shift layout — every role and shift, with the people rostered onto each.</p>
      </div>

      {!dbReady && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-warn-bg border border-warn/30 rounded-xl text-[12px] text-warn">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>Roster tables aren&apos;t set up yet. Run <code className="font-mono">supabase/migrations/20260622_001_roster.sql</code> on the database, then reload. The role list below is the seed preview.</span>
        </div>
      )}

      {/* Period bar */}
      <div className="flex flex-wrap items-center gap-3 bg-surface-card border border-surface-rule rounded-2xl p-4">
        <CalendarRange size={16} className="text-text-muted" />
        {periods.length > 0 ? (
          <div className="relative">
            <select
              value={periodId ?? ''} onChange={e => setPeriodId(e.target.value)}
              className="appearance-none pl-3 pr-9 py-2 rounded-lg border border-stone-200 bg-white text-[13px] font-medium text-text outline-none focus:border-brand cursor-pointer"
            >
              {periods.map(p => <option key={p.id} value={p.id}>{p.name} · {fmtRange(p)}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          </div>
        ) : (
          <span className="text-[13px] text-text-muted">No roster periods yet.</span>
        )}
        <button
          onClick={() => setShowNew(true)} disabled={!dbReady}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-mid disabled:opacity-40 transition-colors"
        >
          <Plus size={14} /> New period
        </button>
        {period && (
          <button
            onClick={() => { if (confirm(`Delete roster period "${period.name}"? This removes all its entries.`)) deletePeriod(period.id) }}
            className="ml-auto flex items-center gap-1.5 text-[12px] text-stone-400 hover:text-err transition-colors"
          >
            <Trash2 size={13} /> Delete period
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : !period ? (
        <EmptyState canCreate={dbReady} onCreate={() => setShowNew(true)} />
      ) : (
        <RosterGrid
          period={period}
          rolesByCategory={rolesByCategory}
          operators={operators}
          cellEntries={cellEntries}
          editing={editing} setEditing={setEditing}
          onAdd={addEntry} onUpdate={updateEntry} onDelete={deleteEntry}
        />
      )}

      {/* Legend */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-4">
        <p className="font-mono text-[10px] text-text-muted uppercase tracking-wide mb-2.5">Skill / certification tags</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {SKILL_TAGS.map(t => (
            <span key={t.code} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="font-mono font-semibold text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">{t.code}</span>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {showNew && <NewPeriodModal onClose={() => setShowNew(false)} onCreate={createPeriod} />}
    </div>
  )
}

// ── The grid: categories → role rows × Day/Night columns ──────────────────────
function RosterGrid({
  period, rolesByCategory, operators, cellEntries, editing, setEditing, onAdd, onUpdate, onDelete,
}: {
  period: Period
  rolesByCategory: { cat: typeof ROSTER_CATEGORIES[number]; items: RosterRole[] }[]
  operators: Operator[]
  cellEntries: (roleKey: string, shift: RosterShift) => Entry[]
  editing: string | null
  setEditing: (v: string | null) => void
  onAdd: (roleKey: string, shift: RosterShift, operatorId: string | null, name: string, tags: string[]) => void
  onUpdate: (id: string, operatorId: string | null, name: string, tags: string[]) => void
  onDelete: (id: string) => void
}) {
  const shiftLabel = (s: RosterShift) => s === 'day' ? period.day_label : period.night_label
  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-x-auto">
      <table className="w-full border-collapse min-w-[760px]">
        <thead>
          <tr className="border-b border-surface-rule bg-surface">
            <th className="px-4 py-3 text-left font-mono text-[10px] text-text-muted uppercase tracking-wide w-[200px] sticky left-0 bg-surface z-10">Role</th>
            {ROSTER_SHIFTS.map(s => (
              <th key={s.key} className="px-4 py-3 text-left">
                <div className="flex items-center gap-1.5">
                  {s.key === 'day' ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} className="text-indigo-400" />}
                  <span className="font-display font-bold text-[13px] text-text">{s.label}</span>
                </div>
                <div className="font-mono text-[10px] text-text-muted mt-0.5">{shiftLabel(s.key)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rolesByCategory.map(({ cat, items }) => (
            <CategoryGroup key={cat.key} cat={cat} items={items} operators={operators}
              cellEntries={cellEntries} editing={editing} setEditing={setEditing}
              onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CategoryGroup({ cat, items, operators, cellEntries, editing, setEditing, onAdd, onUpdate, onDelete }: any) {
  return (
    <>
      <tr>
        <td colSpan={3} className="px-4 py-1.5 bg-surface-dim border-y border-surface-rule sticky left-0 z-10">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide" style={{ color: cat.colorHex }}>
            <span className="w-2 h-2 rounded-full" style={{ background: cat.colorHex }} /> {cat.label}
          </span>
        </td>
      </tr>
      {items.map((role: RosterRole) => (
        <tr key={role.key} className="border-b border-surface-rule last:border-0 align-top">
          <td className="px-4 py-2.5 sticky left-0 bg-surface-card z-10 border-r border-surface-rule">
            <span className="font-body font-medium text-[13px] text-text leading-tight">{role.name}</span>
          </td>
          {ROSTER_SHIFTS.map((s: { key: RosterShift }) => (
            <RosterCell key={s.key} roleKey={role.key} shift={s.key} operators={operators}
              entries={cellEntries(role.key, s.key)}
              editing={editing} setEditing={setEditing}
              onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </tr>
      ))}
    </>
  )
}

function RosterCell({ roleKey, shift, operators, entries, editing, setEditing, onAdd, onUpdate, onDelete }: {
  roleKey: string; shift: RosterShift; operators: Operator[]; entries: Entry[]
  editing: string | null; setEditing: (v: string | null) => void
  onAdd: (roleKey: string, shift: RosterShift, operatorId: string | null, name: string, tags: string[]) => void
  onUpdate: (id: string, operatorId: string | null, name: string, tags: string[]) => void
  onDelete: (id: string) => void
}) {
  const addKey = `add:${roleKey}:${shift}`
  // Names already rostered into THIS cell — hide them from the picker.
  const takenIds = entries.map(e => e.operator_id).filter(Boolean) as string[]
  return (
    <td className="px-3 py-2 align-top">
      <div className="flex flex-col gap-1.5">
        {entries.map(e => editing === e.id ? (
          <PersonEditor key={e.id} operators={operators} excludeIds={takenIds.filter(id => id !== e.operator_id)}
            initialOperatorId={e.operator_id} initialName={e.person_name} initialTags={e.tags}
            onSave={(opId, n, t) => onUpdate(e.id, opId, n, t)} onCancel={() => setEditing(null)}
            onDelete={() => onDelete(e.id)} />
        ) : (
          <PersonChip key={e.id} entry={e} onEdit={() => setEditing(e.id)} />
        ))}

        {editing === addKey ? (
          <PersonEditor operators={operators} excludeIds={takenIds}
            onSave={(opId, n, t) => onAdd(roleKey, shift, opId, n, t)} onCancel={() => setEditing(null)} />
        ) : (
          <button onClick={() => setEditing(addKey)}
            className="self-start inline-flex items-center gap-1 text-[11px] text-stone-300 hover:text-brand transition-colors py-0.5">
            <Plus size={12} /> Add
          </button>
        )}
      </div>
    </td>
  )
}

function PersonChip({ entry, onEdit }: { entry: Entry; onEdit: () => void }) {
  return (
    <button onClick={onEdit}
      className="group inline-flex items-center gap-1.5 self-start max-w-full px-2.5 py-1.5 rounded-lg bg-stone-50 border border-stone-200 hover:border-brand/40 hover:bg-white transition-colors text-left">
      <span className="text-[12px] font-medium text-text truncate">{entry.person_name}</span>
      {entry.tags.map(code => (
        <span key={code} title={tagLabel(code)}
          className="font-mono font-semibold text-[8px] px-1 py-0.5 rounded bg-brand/8 text-brand shrink-0">{code}</span>
      ))}
      <Pencil size={10} className="text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-0.5" />
    </button>
  )
}

function PersonEditor({ operators, excludeIds = [], initialOperatorId = null, initialName = '', initialTags = [], onSave, onCancel, onDelete }: {
  operators: Operator[]; excludeIds?: string[]
  initialOperatorId?: string | null; initialName?: string; initialTags?: string[]
  onSave: (operatorId: string | null, name: string, tags: string[]) => void; onCancel: () => void; onDelete?: () => void
}) {
  const [operatorId, setOperatorId] = useState<string | null>(initialOperatorId)
  const [name, setName] = useState(initialName)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(!initialName)   // start open when adding a new person
  const toggle = (c: string) => setTags(t => t.includes(c) ? t.filter(x => x !== c) : [...t, c])
  const opLabel = (op: Operator) => op.display_name || op.name

  const q = query.trim().toLowerCase()
  const matches = operators
    .filter(op => !excludeIds.includes(op.id))
    .filter(op => q === '' || opLabel(op).toLowerCase().includes(q))
    .slice(0, 8)

  function pick(op: Operator) {
    setOperatorId(op.id); setName(opLabel(op)); setQuery(''); setOpen(false)
  }

  return (
    <div className="rounded-xl border border-brand/40 bg-white p-2.5 shadow-sm space-y-2 w-[240px] max-w-full">
      {/* Selected person — or the searchable employee picker */}
      {name && !open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-left">
          <span className="text-[12px] font-medium text-text truncate">{name}</span>
          <Pencil size={11} className="text-stone-300 shrink-0" />
        </button>
      ) : (
        <div className="relative">
          <div className="flex items-center gap-1.5 px-2.5 rounded-lg border border-stone-200 bg-white focus-within:border-brand">
            <Search size={13} className="text-stone-400" />
            <input
              autoFocus value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
              placeholder="Search employee…"
              className="flex-1 py-1.5 text-[12px] text-text outline-none bg-transparent"
            />
          </div>
          {matches.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-52 overflow-y-auto divide-y divide-stone-100">
              {matches.map(op => (
                <button key={op.id} type="button" onMouseDown={e => { e.preventDefault(); pick(op) }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[12px] text-text hover:bg-brand/5">
                  <Plus size={12} className="text-stone-400 shrink-0" />
                  <span className="flex-1 truncate">{opLabel(op)}</span>
                  {op.role === 'production_supervisor' && <span className="text-[10px] text-text-muted">Sup</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {SKILL_TAGS.map(t => {
          const on = tags.includes(t.code)
          return (
            <button key={t.code} type="button" onClick={() => toggle(t.code)} title={t.label}
              className={`font-mono font-semibold text-[9px] px-1.5 py-1 rounded border transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-stone-500 border-stone-200 hover:border-brand/40'}`}>
              {t.code}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => name.trim() && onSave(operatorId, name, tags)} disabled={!name.trim()}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-brand text-white text-[11px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
          <Check size={12} /> Save
        </button>
        <button onClick={onCancel} className="p-1.5 rounded-lg border border-stone-200 text-stone-400 hover:text-text"><X size={13} /></button>
        {onDelete && (
          <button onClick={onDelete} className="p-1.5 rounded-lg border border-stone-200 text-stone-400 hover:text-err hover:border-err/40"><Trash2 size={13} /></button>
        )}
      </div>
    </div>
  )
}

function EmptyState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center bg-surface-card border border-dashed border-surface-rule rounded-2xl">
      <CalendarRange size={28} className="text-stone-300 mb-3" />
      <p className="font-display font-semibold text-[15px] text-text">No roster period yet</p>
      <p className="text-[12px] text-text-muted mt-1 max-w-[320px]">Create a date-range period (e.g. a month), then roster people onto each role and shift.</p>
      {canCreate && (
        <button onClick={onCreate} className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-[12px] font-medium hover:bg-brand-mid transition-colors">
          <Plus size={14} /> Create first period
        </button>
      )}
    </div>
  )
}

function NewPeriodModal({ onClose, onCreate }: {
  onClose: () => void; onCreate: (p: { name: string; start: string; end: string }) => void
}) {
  const [name, setName]   = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd]     = useState('')
  const valid = name.trim() && start && end && start <= end

  // Auto-suggest a name from the dates if the user hasn't typed one.
  const suggested = useMemo(() => {
    if (!start || !end) return ''
    try {
      const s = parseISO(start + 'T12:00:00'), e = parseISO(end + 'T12:00:00')
      return `${format(s, 'd')}–${format(e, 'd MMM')}`
    } catch { return '' }
  }, [start, end])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[380px] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-[16px] text-text">New roster period</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-text"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Start date</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] text-text outline-none focus:border-brand" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">End date</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] text-text outline-none focus:border-brand" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Label</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={suggested || 'e.g. June 2026'}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-[13px] text-text outline-none focus:border-brand" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
          <button onClick={() => valid && onCreate({ name: name.trim() || suggested, start, end })} disabled={!valid}
            className="flex-1 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 hover:bg-brand-mid transition-colors">
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

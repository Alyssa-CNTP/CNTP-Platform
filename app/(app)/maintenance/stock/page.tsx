'use client'

// app/(app)/maintenance/stock/page.tsx
// Stock & Spares — an interactive register. Inline-edit any field, adjust
// quantities with steppers, add/search/filter parts, and manage offsite
// equipment. Usage log (from job cards) stays read-only.

import { useMemo, useState } from 'react'
import { Plus, Search, Trash2, Minus, Check, X, PackageOpen } from 'lucide-react'
import { useMaintenanceContext } from '../layout'
import { fmtD } from '@/lib/maintenance/helpers'
import type { SparePart } from '@/lib/maintenance/types'

const CLASSES = ['Mechanical', 'Electrical', 'Pneumatic', 'Hydraulic', 'Consumable', 'Fastener', 'Bearing', 'Belt', 'Seal', 'Other']

export default function StockPage() {
  const { loading, data, actions } = useMaintenanceContext()
  const { stock, sparesUsed, offsite, jcs } = data
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [addingOffsite, setAddingOffsite] = useState(false)

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    const rows = t ? stock.filter(s => `${s.part_no} ${s.class} ${s.description}`.toLowerCase().includes(t)) : stock
    return [...rows]
  }, [stock, q])

  const totals = useMemo(() => ({
    parts: stock.length,
    low: stock.filter(s => { const t = s.qty_new + s.qty_used; return t > 0 && t <= 2 }).length,
    out: stock.filter(s => s.qty_new + s.qty_used === 0).length,
    offsite: offsite.length,
  }), [stock, offsite])

  if (loading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading…</div></div>

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Stock & Spares</h1>
        <p className="text-sm text-text-muted mt-1">Spare-parts register, usage from job cards, and offsite equipment — edit inline.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Parts on register" value={totals.parts} />
        <Stat label="Low stock" value={totals.low} tone={totals.low ? 'warn' : undefined} />
        <Stat label="Out of stock" value={totals.out} tone={totals.out ? 'err' : undefined} />
        <Stat label="Items offsite" value={totals.offsite} tone={totals.offsite ? 'info' : undefined} />
      </div>

      {/* ── Spare parts register ── */}
      <div className="card p-4 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-sm font-semibold text-text">Spare Parts Register</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search parts…"
                className="h-9 w-48 rounded-lg border border-surface-rule bg-surface-card pl-8 pr-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <button onClick={() => setAdding(a => !a)}
              className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-3 h-9 text-[13px] font-semibold">
              <Plus className="w-4 h-4" /> Add part
            </button>
          </div>
        </div>

        {adding && <AddPartRow onAdd={async p => { await actions.addPart(p); setAdding(false) }} onCancel={() => setAdding(false)} />}

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-surface-rule">
                <th className="text-left font-semibold py-2 px-2">Part #</th>
                <th className="text-left font-semibold py-2 px-2">Type</th>
                <th className="text-left font-semibold py-2 px-2">Description</th>
                <th className="text-center font-semibold py-2 px-2 w-[130px]">New</th>
                <th className="text-center font-semibold py-2 px-2 w-[130px]">Used</th>
                <th className="text-center font-semibold py-2 px-2">Total</th>
                <th className="text-center font-semibold py-2 px-2">Status</th>
                <th className="py-2 px-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => <PartRow key={r.id} r={r} actions={actions} />)}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-[12px] text-text-faint py-6 text-center">{q ? 'No parts match your search.' : 'No parts yet — add your first one.'}</div>}
        </div>
      </div>

      {/* ── Usage log ── */}
      <div className="card p-4 mb-5">
        <h2 className="text-sm font-semibold text-text">Usage Log <span className="font-normal text-text-muted">— logged on job cards, auto-decrements stock</span></h2>
        <div className="overflow-x-auto mt-3">
          <table className="data-table">
            <thead><tr>{['Date', 'Job Card', 'Item', 'Qty', 'Stock', 'Critical', 'Logged By'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{sparesUsed.slice(0, 30).map(s => {
              const c = jcs.find(j => j.id === s.card_id)
              return (
                <tr key={s.id}>
                  <td>{fmtD(s.created_at)}</td>
                  <td><strong className="text-accent">{c?.card_no ?? '—'}</strong></td>
                  <td>{s.description}</td>
                  <td className="font-semibold tabular-nums">{s.qty}</td>
                  <td><span className={`badge ${s.from_stock === 'new' ? 'badge-ok' : 'badge-warn'}`}>{s.from_stock.toUpperCase()}</span></td>
                  <td>{s.is_critical ? <span className="badge badge-err">CRITICAL</span> : '—'}</td>
                  <td>{s.logged_by || '—'}</td>
                </tr>
              )
            })}</tbody>
          </table>
          {sparesUsed.length === 0 && <div className="text-[12px] text-text-faint py-4 text-center">No spares logged on job cards yet.</div>}
        </div>
      </div>

      {/* ── Offsite ── */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-text">Offsite Equipment</h2>
          <button onClick={() => setAddingOffsite(a => !a)}
            className="inline-flex items-center gap-1.5 bg-surface-dim text-text rounded-lg px-3 h-9 text-[13px] font-semibold hover:bg-surface-rule">
            <Plus className="w-4 h-4" /> Send item offsite
          </button>
        </div>
        {addingOffsite && <AddOffsiteRow onAdd={async o => { await actions.addOffsite(o); setAddingOffsite(false) }} onCancel={() => setAddingOffsite(false)} />}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>{['Item', 'Sent To', 'Date', 'Days Out', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{offsite.map(o => {
              const days = o.date_sent ? Math.floor((Date.now() - new Date(o.date_sent).getTime()) / 86400000) : 0
              const cls = days > 14 ? 'badge-err' : days > 7 ? 'badge-warn' : 'badge-ok'
              return (
                <tr key={o.id}>
                  <td className="font-medium">{o.item}</td>
                  <td>{o.sent_to}</td>
                  <td>{fmtD(o.date_sent)}</td>
                  <td className="font-semibold tabular-nums">{days}d</td>
                  <td><span className={`badge ${cls}`}>{o.status}</span></td>
                  <td><button onClick={() => actions.returnOffsite(o.id)} className="text-[11px] font-semibold text-ok hover:underline">Mark returned</button></td>
                </tr>
              )
            })}</tbody>
          </table>
          {offsite.length === 0 && <div className="text-[12px] text-text-faint py-4 text-center">Nothing offsite right now.</div>}
        </div>
      </div>
    </div>
  )
}

// ── Editable part row ──
function PartRow({ r, actions }: { r: SparePart; actions: any }) {
  const total = r.qty_new + r.qty_used
  const status = total === 0 ? { c: 'badge-err', t: 'OUT' } : total <= 2 ? { c: 'badge-warn', t: 'LOW' } : { c: 'badge-ok', t: 'OK' }
  return (
    <tr className={`border-b border-surface-rule/60 hover:bg-surface-dim/40 ${total === 0 ? 'bg-err/5' : total <= 2 ? 'bg-warn/5' : ''}`}>
      <td className="py-1.5 px-2"><Cell value={r.part_no} mono onSave={v => actions.updatePart(r.id, { part_no: v })} placeholder="Part #" /></td>
      <td className="py-1.5 px-2">
        <select value={r.class || ''} onChange={e => actions.updatePart(r.id, { class: e.target.value })}
          className="bg-transparent border border-transparent hover:border-surface-rule focus:border-brand rounded px-1.5 py-1 text-[12px] text-text-muted focus:outline-none">
          {!CLASSES.includes(r.class) && r.class && <option value={r.class}>{r.class}</option>}
          {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="py-1.5 px-2"><Cell value={r.description} onSave={v => actions.updatePart(r.id, { description: v })} placeholder="Description" /></td>
      <td className="py-1.5 px-2"><Stepper value={r.qty_new} tone="ok" onStep={d => actions.adjustPartQty(r.id, 'qty_new', d)} /></td>
      <td className="py-1.5 px-2"><Stepper value={r.qty_used} tone="warn" onStep={d => actions.adjustPartQty(r.id, 'qty_used', d)} /></td>
      <td className="py-1.5 px-2 text-center font-semibold tabular-nums">{total}</td>
      <td className="py-1.5 px-2 text-center"><span className={`badge ${status.c}`}>{status.t}</span></td>
      <td className="py-1.5 px-2 text-center">
        <button onClick={() => { if (confirm(`Delete part ${r.part_no || r.description}?`)) actions.deletePart(r.id) }}
          className="text-text-faint hover:text-err"><Trash2 className="w-3.5 h-3.5" /></button>
      </td>
    </tr>
  )
}

// Inline-editable text cell (saves on blur if changed)
function Cell({ value, onSave, mono, placeholder }: { value: string; onSave: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <input defaultValue={value} placeholder={placeholder}
      onBlur={e => { if (e.target.value !== value) onSave(e.target.value) }}
      className={`w-full min-w-[80px] bg-transparent border border-transparent hover:border-surface-rule focus:border-brand rounded px-2 py-1 text-[13px] text-text focus:outline-none ${mono ? 'font-mono text-[11px]' : ''}`} />
  )
}

// Quantity stepper
function Stepper({ value, tone, onStep }: { value: number; tone: 'ok' | 'warn'; onStep: (d: number) => void }) {
  const color = tone === 'ok' ? 'text-ok' : 'text-warn'
  return (
    <div className="flex items-center justify-center gap-1.5">
      <button onClick={() => onStep(-1)} className="w-6 h-6 rounded-md border border-surface-rule flex items-center justify-center text-text-muted hover:bg-surface-dim active:scale-95"><Minus className="w-3 h-3" /></button>
      <span className={`w-7 text-center font-semibold tabular-nums ${color}`}>{value}</span>
      <button onClick={() => onStep(1)} className="w-6 h-6 rounded-md border border-surface-rule flex items-center justify-center text-text-muted hover:bg-surface-dim active:scale-95"><Plus className="w-3 h-3" /></button>
    </div>
  )
}

// Add-part inline form
function AddPartRow({ onAdd, onCancel }: { onAdd: (p: any) => void; onCancel: () => void }) {
  const [f, setF] = useState({ part_no: '', class: 'Mechanical', description: '', qty_new: '0', qty_used: '0' })
  const submit = () => {
    if (!f.description.trim()) return
    onAdd({ part_no: f.part_no.trim(), class: f.class, description: f.description.trim(), qty_new: parseInt(f.qty_new) || 0, qty_used: parseInt(f.qty_used) || 0 })
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-[120px_140px_1fr_80px_80px_auto] gap-2 items-center p-3 mb-3 rounded-lg border border-brand/20 bg-accent-bg/40">
      <input autoFocus value={f.part_no} onChange={e => setF({ ...f, part_no: e.target.value })} placeholder="Part #" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px] font-mono" />
      <select value={f.class} onChange={e => setF({ ...f, class: e.target.value })} className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]">{CLASSES.map(c => <option key={c}>{c}</option>)}</select>
      <input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Description *" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <input value={f.qty_new} onChange={e => setF({ ...f, qty_new: e.target.value })} type="number" placeholder="New" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <input value={f.qty_used} onChange={e => setF({ ...f, qty_used: e.target.value })} type="number" placeholder="Used" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <div className="flex gap-1.5">
        <button onClick={submit} className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white"><Check className="w-4 h-4" /></button>
        <button onClick={onCancel} className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-surface-dim text-text-muted"><X className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

// Add-offsite inline form
function AddOffsiteRow({ onAdd, onCancel }: { onAdd: (o: any) => void; onCancel: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ item: '', sent_to: '', date_sent: today, status: 'At supplier' })
  const submit = () => { if (!f.item.trim() || !f.sent_to.trim()) return; onAdd({ ...f, item: f.item.trim(), sent_to: f.sent_to.trim() }) }
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_150px_150px_auto] gap-2 items-center p-3 mb-3 rounded-lg border border-info/20 bg-info/5">
      <input autoFocus value={f.item} onChange={e => setF({ ...f, item: e.target.value })} placeholder="Item / equipment *" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <input value={f.sent_to} onChange={e => setF({ ...f, sent_to: e.target.value })} placeholder="Sent to *" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <input value={f.date_sent} onChange={e => setF({ ...f, date_sent: e.target.value })} type="date" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <input value={f.status} onChange={e => setF({ ...f, status: e.target.value })} placeholder="Status" className="h-9 rounded-lg border border-surface-rule px-2 text-[13px]" />
      <div className="flex gap-1.5">
        <button onClick={submit} className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white"><Check className="w-4 h-4" /></button>
        <button onClick={onCancel} className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-surface-dim text-text-muted"><X className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'err' | 'info' }) {
  const v = tone === 'err' ? 'text-err' : tone === 'warn' ? 'text-warn' : tone === 'info' ? 'text-info' : 'text-text'
  return (
    <div className="rounded-lg border border-surface-rule bg-surface-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${v}`}>{value}</div>
    </div>
  )
}

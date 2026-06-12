'use client'

// app/(app)/maintenance/stock/page.tsx
// Stock & Spares — spare parts register, usage log (from job cards) and offsite
// equipment tracking. Lifted from the original Tab 2 and restyled with tokens.

import { useMaintenanceContext } from '../layout'
import { fmtD } from '@/lib/maintenance/helpers'

export default function StockPage() {
  const { loading, data } = useMaintenanceContext()
  const { stock, sparesUsed, offsite, jcs } = data

  if (loading) {
    return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><div className="card p-6 text-text-muted text-sm">Loading…</div></div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-semibold text-text mb-4">Stock & Spares</h1>

      <div className="card p-4 mb-4">
        <div className="text-sm font-semibold text-text mb-3">Spare Parts Register</div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>{['Part #', 'Type', 'Description', 'New', 'Used', 'Total', 'Status'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{stock.map(r => {
              const total = r.qty_new + r.qty_used
              return (
                <tr key={r.id}>
                  <td className="font-mono text-[11px]">{r.part_no}</td>
                  <td><span className="badge badge-info">{r.class}</span></td>
                  <td className="font-medium">{r.description}</td>
                  <td className="text-ok font-semibold">{r.qty_new}</td>
                  <td className="text-warn font-semibold">{r.qty_used}</td>
                  <td className="font-semibold">{total}</td>
                  <td><span className={`badge ${total === 0 ? 'badge-err' : total <= 2 ? 'badge-warn' : 'badge-ok'}`}>{total === 0 ? 'OUT' : total <= 2 ? 'LOW' : 'OK'}</span></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <div className="text-sm font-semibold text-text mb-1">Spares Usage Log (from Job Cards)</div>
        <div className="text-[12px] text-text-muted mb-2">Every spare or critical part logged by technicians on job cards — stock above is decremented automatically.</div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>{['Date', 'Job Card', 'Item', 'Qty', 'Stock', 'Critical', 'Logged By'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{sparesUsed.slice(0, 30).map(s => {
              const c = jcs.find(j => j.id === s.card_id)
              return (
                <tr key={s.id}>
                  <td>{fmtD(s.created_at)}</td>
                  <td><strong className="text-accent">{c?.card_no ?? '—'}</strong></td>
                  <td>{s.description}</td>
                  <td className="font-semibold">{s.qty}</td>
                  <td><span className={`badge ${s.from_stock === 'new' ? 'badge-ok' : 'badge-warn'}`}>{s.from_stock.toUpperCase()}</span></td>
                  <td>{s.is_critical ? <span className="badge badge-err">CRITICAL</span> : '—'}</td>
                  <td>{s.logged_by || '—'}</td>
                </tr>
              )
            })}</tbody>
          </table>
          {sparesUsed.length === 0 && <div className="text-[12px] text-text-faint p-2">No spares logged on job cards yet.</div>}
        </div>
      </div>

      <div className="card p-4">
        <div className="text-sm font-semibold text-text mb-3">Offsite Equipment Tracking</div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>{['Item', 'Sent To', 'Date', 'Days Out', 'Status'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{offsite.map(o => {
              const days = o.date_sent ? Math.floor((Date.now() - new Date(o.date_sent).getTime()) / 86400000) : 0
              const cls = days > 14 ? 'badge-warn' : days > 7 ? 'badge-info' : 'badge-ok'
              return (
                <tr key={o.id}>
                  <td>{o.item}</td>
                  <td>{o.sent_to}</td>
                  <td>{fmtD(o.date_sent)}</td>
                  <td className="font-semibold">{days}</td>
                  <td><span className={`badge ${cls}`}>{o.status}</span></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

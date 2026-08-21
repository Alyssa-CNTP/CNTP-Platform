'use client'

// components/notebooks/NotesTable.tsx
// The results table shared by the all-sites book shelf (app/(app)/notebooks)
// and a single site's GRN/DN tab (app/(app)/notebooks/site/[code]). Kept as
// one component so a column added to one view doesn't quietly drift from the
// other.

import { useRouter } from 'next/navigation'
import { Leaf, ArrowRight } from 'lucide-react'
import StatusBadge from './StatusBadge'
import { type NotebookDoc, CERT_KEYS } from '@/lib/notebooks/types'

export type NoteRow = NotebookDoc & { line_count: number; total_qty: number; total_weight_kg: number }

interface Props {
  rows: NoteRow[]
  /** Hide the Book column when the caller already scopes to one doc type (a site's GRN or DN tab). */
  showBookColumn?: boolean
}

export default function NotesTable({ rows, showBookColumn = true }: Props) {
  const router = useRouter()

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface text-[11px] uppercase tracking-wider text-text-muted">
          <tr>
            <th className="text-left px-4 py-2.5">Note no.</th>
            <th className="text-left px-4 py-2.5">Date</th>
            {showBookColumn && <th className="text-left px-4 py-2.5">Book</th>}
            <th className="text-left px-4 py-2.5">Supplier / recipient</th>
            <th className="text-left px-4 py-2.5">PO</th>
            <th className="text-left px-4 py-2.5">Weighbridge</th>
            <th className="text-right px-4 py-2.5">Qty</th>
            <th className="text-right px-4 py-2.5">Kg</th>
            <th className="text-left px-4 py-2.5">Cert</th>
            <th className="text-left px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              className="border-t border-surface-rule hover:bg-surface/50 cursor-pointer"
              onClick={() => router.push(`/notebooks/${r.id}`)}
            >
              <td className="px-4 py-3 font-mono font-medium text-text whitespace-nowrap">{r.doc_no}</td>
              <td className="px-4 py-3 text-text-muted whitespace-nowrap">{r.doc_date}</td>
              {showBookColumn && (
                <td className="px-4 py-3 text-text-muted whitespace-nowrap">{r.doc_type === 'GRN' ? 'Goods Received' : 'Delivery'}</td>
              )}
              <td className="px-4 py-3 text-text-muted">{r.party_name || '—'}</td>
              <td className="px-4 py-3 text-text-muted font-mono text-[12px]">{r.purchase_order_no || '—'}</td>
              <td className="px-4 py-3 text-text-muted font-mono text-[12px]">{r.weighbridge_no || '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.total_qty || '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.total_weight_kg ? r.total_weight_kg.toLocaleString('en-ZA') : '—'}</td>
              <td className="px-4 py-3">
                {CERT_KEYS.some(k => r[k])
                  ? <span title="Certification stamped on this note"><Leaf className="w-3.5 h-3.5 text-ok" /></span>
                  : <span className="text-text-faint">—</span>}
              </td>
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
              <td className="px-4 py-3 text-right"><ArrowRight className="w-4 h-4 text-text-muted inline" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

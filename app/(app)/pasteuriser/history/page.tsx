'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'

/**
 * Every label printed, and the approval behind it.
 *
 * This is the traceability answer: given a serial off a bag in a container,
 * which template version was it printed from, who approved that wording, and
 * against which PO. Reads the ledger (`label_prints`), never re-derives from
 * current state — a job card's batch number can be corrected after the fact and
 * the bag in the warehouse still says what it said (ARCHITECTURE.md §6).
 */

type PrintRow = {
  id: string
  serial_no: string
  binding: Record<string, string>
  printed_at: string
  print_path: string
  reprint_of: string | null
  void_of: string | null
  void_reason: string | null
  template: { code: string; name: string; version: number; approved_at: string | null; cu_approval_ref: string | null } | null
  assignment: { customer: string; po_number: string } | null
}

export default function PasteuriserHistoryPage() {
  const [rows, setRows] = useState<PrintRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const { data, error } = await (getSupabaseClient() as any)
          .schema('public')
          .from('label_prints')
          .select('id, serial_no, binding, printed_at, print_path, reprint_of, void_of, void_reason, template:label_templates(code, name, version, approved_at, cu_approval_ref), assignment:label_po_assignments(customer, po_number)')
          .order('printed_at', { ascending: false })
          .limit(500)
        if (error) throw new Error(error.message)
        setRows((data ?? []) as PrintRow[])
      } catch (e: any) { setError(e.message) }
      finally { setLoading(false) }
    })()
  }, [])

  // A print that has since been voided is shown struck through rather than
  // hidden: the label may still be on a bag, and "why is there no record of
  // this serial" is a worse question than "this one was voided".
  const voided = useMemo(
    () => new Set(rows.filter(r => r.void_of).map(r => r.void_of as string)),
    [rows],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows.filter(r => !r.void_of)
    return rows.filter(r =>
      !r.void_of &&
      `${r.serial_no} ${r.template?.code ?? ''} ${r.assignment?.customer ?? ''} ${r.assignment?.po_number ?? ''} ${r.binding?.batch_no ?? ''}`
        .toLowerCase().includes(needle),
    )
  }, [rows, q])

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-text">Label History</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Every finished-product label printed, and the approved wording it came from
        </p>
      </div>

      {error && <div className="card p-3 border-l-4 border-l-red-500 text-sm text-text-muted">{error}</div>}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Serial, batch, customer, PO or label code"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm text-text" />
      </div>

      {loading ? (
        <p className="text-sm text-text-muted py-8 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-muted py-8 text-center">
          {q ? 'Nothing matches that.' : 'No labels printed yet.'}
        </p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border">
                {['Serial', 'Batch', 'Customer / PO', 'Label', 'Approved', 'Printed'].map(h => (
                  <th key={h} className="px-3 py-2 text-[10px] uppercase tracking-wide font-semibold text-text-faint whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(r => {
                const isVoid = voided.has(r.id)
                return (
                  <tr key={r.id} className={isVoid ? 'opacity-50 line-through' : ''}>
                    <td className="px-3 py-2 font-mono text-xs text-text whitespace-nowrap">
                      {r.serial_no}
                      {r.reprint_of && <span className="ml-1 text-[9px] text-text-faint no-underline">reprint</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted whitespace-nowrap">
                      {r.binding?.batch_no ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                      {r.assignment ? `${r.assignment.customer} · ${r.assignment.po_number}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                      {r.template ? `${r.template.code} v${r.template.version}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-text-faint whitespace-nowrap">
                      {r.template?.approved_at
                        ? new Date(r.template.approved_at).toLocaleDateString('en-ZA')
                        : '—'}
                      {r.template?.cu_approval_ref && ` · ${r.template.cu_approval_ref}`}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-text-faint whitespace-nowrap">
                      {new Date(r.printed_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

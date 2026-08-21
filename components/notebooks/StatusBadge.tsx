'use client'

// components/notebooks/StatusBadge.tsx
// Draft / Issued / Void, rendered the same way wherever a note is listed.

import { type DocStatus, STATUS_LABELS } from '@/lib/notebooks/types'

const STYLES: Record<DocStatus, string> = {
  draft:  'bg-amber-100 text-amber-700 border-amber-200',
  issued: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  void:   'bg-stone-100 text-stone-500 border-stone-200 line-through',
}

export default function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md border whitespace-nowrap ${STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

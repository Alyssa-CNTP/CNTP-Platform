// components/maintenance/StatusBadge.tsx
// Token-based status pill using STATUS_STYLE (.badge variant) + STATUS_LABEL.

import { STATUS_STYLE, STATUS_LABEL } from '@/lib/maintenance/constants'
import type { Status } from '@/lib/maintenance/types'

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CircleAlert, Package } from 'lucide-react'
import { LabelPreview, fetchAssignments, toTemplate,
  type LabelPoAssignmentRow, type LabelTemplateRow,
  errMessage,
} from '@/features/pasteuriser-labels'
import { useAuth } from '@/lib/auth/context'

type Row = LabelPoAssignmentRow & { template: LabelTemplateRow }

/**
 * The production manager's picker: approved labels with a PO on them, ready to
 * be put on a job card.
 *
 * The point of this screen is what it does NOT require. An order shows up here
 * the moment sales assigns a PO to an approved label. The supply chain
 * analyst's planned batch number and date are shown when they exist and are
 * marked as not yet planned when they do not — either way the manager can
 * assign the card today. Blocking on the analyst is the bottleneck this
 * workflow was built to remove, so it is not reintroduced as a required field.
 */
export default function PasteuriserJobCardsPage() {
  const router = useRouter()
  const { p: perm, isFullAdmin } = useAuth()
  const canGenerate = isFullAdmin || perm('can_generate_job_cards')

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try { setRows(await fetchAssignments(['open', 'in_production'])) }
      catch (e) { setError(errMessage(e)) }
      finally { setLoading(false) }
    })()
  }, [])

  const { ready, running } = useMemo(() => ({
    ready: rows.filter(r => r.status === 'open'),
    running: rows.filter(r => r.status === 'in_production'),
  }), [rows])

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-text">Pasteuriser Job Cards</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Approved labels with a customer PO, waiting to be scheduled
        </p>
      </div>

      {error && <div className="card p-3 border-l-4 border-l-red-500 text-sm text-text-muted">{error}</div>}

      {loading ? (
        <p className="text-sm text-text-muted py-8 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-center space-y-1">
          <p className="text-sm text-text">Nothing waiting.</p>
          <p className="text-xs text-text-muted">
            Orders appear here once sales assigns a customer PO to an approved label.
          </p>
        </div>
      ) : (
        <>
          <Section title="Ready to schedule" rows={ready} canGenerate={canGenerate} router={router} />
          <Section title="In production" rows={running} canGenerate={false} router={router} />
        </>
      )}
    </div>
  )
}

function Section({ title, rows, canGenerate, router }: {
  title: string
  rows: Row[]
  canGenerate: boolean
  router: ReturnType<typeof useRouter>
}) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-text-faint">
        {title} · {rows.length}
      </p>
      {rows.map(r => (
        <div key={r.id} className="card p-4 flex items-start gap-4">
          <div className="rounded-lg bg-white p-1.5 border border-border hidden sm:block flex-shrink-0">
            <LabelPreview template={toTemplate(r.template)} scale={0.3} />
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-display font-bold text-[15px] text-text">{r.customer}</p>
            <p className="font-mono text-[11px] text-text-muted">
              PO {r.po_number} · {r.template.code} v{r.template.version}
              {r.item_number && ` · ${r.item_number}`}
            </p>
            <p className="text-xs text-text-muted">
              {r.product ?? r.template.name}
              {r.ordered_bags ? ` · ${r.ordered_bags} bags` : ''}
              {r.net_mass ? ` · ${r.net_mass}` : ''}
            </p>

            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
              <Hint
                icon={<Package size={12} />}
                label="Batch"
                value={r.planned_batch_no}
                empty="not planned yet" />
              <Hint
                icon={<CalendarClock size={12} />}
                label="Planned"
                value={r.planned_date ? new Date(r.planned_date).toLocaleDateString('en-ZA') : null}
                empty="no date yet" />
            </div>
          </div>

          {canGenerate && (
            <button
              onClick={() => router.push(`/job-cards/pasteuriser?assignment=${r.id}`)}
              className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium flex-shrink-0">
              Raise job card
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * A supply-chain hint. Absent is a first-class state, shown plainly rather than
 * as a blank — "not planned yet" tells the manager they may proceed, an empty
 * cell reads like something failed to load.
 */
function Hint({ icon, label, value, empty }: {
  icon: React.ReactNode; label: string; value: string | null; empty: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${value ? 'text-text-muted' : 'text-text-faint'}`}>
      {value ? icon : <CircleAlert size={12} />}
      <span className="font-semibold uppercase tracking-wide">{label}</span>
      <span>{value ?? empty}</span>
    </span>
  )
}

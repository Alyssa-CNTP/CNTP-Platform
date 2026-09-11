'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Printer, TriangleAlert } from 'lucide-react'
import {
  LabelPreview, SignOffChain, fetchPrints, liveSerials, openAndPrintLabel, pplbFidelity, toTemplate,
  type LabelPrintRow, type LabelPoAssignmentRow, type LabelTemplateRow,
  publicDb, errMessage,
} from '@/features/pasteuriser-labels'
import {
  printGate, resolveLabel,
  type LabelBinding, type SignOffRole, type TemplateStatus,
} from '@/lib/core/labels'
import {
  SIGN_OFF_PERMISSION, readSignOffs, splitSignOffs, type SignOffRow,
} from '@/lib/production/label-sign-offs'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth/context'
import FeatureBoundary from '@/components/shared/FeatureBoundary'

/**
 * The supervisor's screen: the approved job cards running today, and the print
 * button for their labels.
 *
 * Capture (debagging and bagging) stays where it already is — the Pasteuriser
 * section of the capture screen. This page is the LABEL half, deliberately not
 * a second capture screen, because two places to record the same bagging is how
 * two figures end up disagreeing (ARCHITECTURE.md §5, on productionTotals).
 * The link across to capture is right there on the card.
 */

type Card = {
  id: string
  job_card_no: string | null
  customer: string | null
  batch_number: string | null
  product_name: string | null
  status: string
  expected_commencement: string | null
  date_of_card: string | null
  assignment: (LabelPoAssignmentRow & { template: LabelTemplateRow }) | null
}

export default function PasteuriserRunPage() {
  const router = useRouter()
  const { p: perm, isFullAdmin } = useAuth()
  const canPrint = isFullAdmin || perm('can_print_labels')
  // Display only — every signature is authorised again by the route that
  // records it, and the print gate is re-decided server-side on print.
  const canSign = (role: SignOffRole) => isFullAdmin || perm(SIGN_OFF_PERMISSION[role])

  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await publicDb()
        .from('job_cards_pasteuriser')
        .select('id, job_card_no, customer, batch_number, product_name, status, expected_commencement, date_of_card, assignment:label_po_assignments(*, template:label_templates(*))')
        .eq('status', 'approved')
        .not('label_assignment_id', 'is', null)
        .order('expected_commencement', { ascending: false })
        .limit(25)
      if (error) throw new Error(error.message)
      setCards((data ?? []) as Card[])
      setError(null)
    } catch (e) { setError(errMessage(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-text">Pasteuriser Run</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Approved job cards with a label assigned — print finished-product labels here
        </p>
      </div>

      {error && <div className="card p-3 border-l-4 border-l-red-500 text-sm text-text-muted">{error}</div>}

      {loading ? (
        <p className="text-sm text-text-muted py-8 text-center">Loading…</p>
      ) : cards.length === 0 ? (
        <div className="card p-6 text-center space-y-1">
          <p className="text-sm text-text">No job cards ready.</p>
          <p className="text-xs text-text-muted">
            A card appears here once the production manager has raised it with a label and PO, and
            it has been approved.
          </p>
        </div>
      ) : (
        // One boundary per card: a bad template on one job card must not stop
        // the supervisor printing the other three.
        cards.map(c => (
          <FeatureBoundary key={c.id} name={`Job card ${c.job_card_no ?? ''}`}>
            <JobCardPanel card={c} canPrint={canPrint} canSign={canSign} router={router} />
          </FeatureBoundary>
        ))
      )}
    </div>
  )
}

function JobCardPanel({ card, canPrint, canSign, router }: {
  card: Card
  canPrint: boolean
  canSign: (role: SignOffRole) => boolean
  router: ReturnType<typeof useRouter>
}) {
  const [prints, setPrints] = useState<LabelPrintRow[]>([])
  const [signOffs, setSignOffs] = useState<SignOffRow[]>([])
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const templateId = card.assignment?.template?.id ?? null
  const load = useCallback(async () => {
    try { setPrints(await fetchPrints(card.id)) } catch { /* the panel still works without history */ }
    // Reads as the signed-in user, so it shows what THEY may see. The gate
    // below is advisory for the same reason every client-side gate is: the
    // print route re-decides it from the admin client on every press.
    if (templateId) setSignOffs(await readSignOffs(publicDb(), templateId))
  }, [card.id, templateId])
  useEffect(() => { void load() }, [load])

  const template = card.assignment?.template ? toTemplate(card.assignment.template) : null
  const done = useMemo(() => liveSerials(prints).length, [prints])
  const ordered = card.assignment?.ordered_bags ?? null

  /**
   * Why this card can or cannot print — the same core function the route runs,
   * so the screen and the server cannot disagree about the reason.
   *
   * It is shown, not merely used to disable a button. A supervisor standing at
   * the machine needs to know it is waiting on the quality supervisor's
   * signature, not just that Print is greyed out.
   */
  const gate = useMemo(() => {
    const row = card.assignment?.template
    if (!row) return null
    const scoped = splitSignOffs(signOffs, card.id)
    return printGate({
      status: row.status as TemplateStatus,
      templateVersion: Number(row.version),
      signOffs: scoped.template,
      poAssigned: !!card.assignment,
      printSignOffs: scoped.print,
    })
  }, [card.assignment, card.id, signOffs])

  // Marks cannot be drawn by a PPLB stream, so a certified label prints through
  // the browser. Decided here, once, and shown to the operator — a silently
  // downgraded print is how a bag loses its JAS mark.
  const fidelity = template ? pplbFidelity(resolveLabel(template, {})) : null

  async function print() {
    if (!template) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/pasteuriser/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobCardId: card.id, count }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.blockers?.length
          ? `${json.error}\n\n${json.blockers.map((b: string) => `• ${b}`).join('\n')}`
          : json.error ?? 'Could not print')
      }

      // The server allocated the serials, recorded them, and — where the label
      // is pure text — already sent them to the Argox. Anything it could not
      // send faithfully comes back here to be rendered in a print window, which
      // draws the certification marks properly.
      if (json.browserPrint) {
        for (const p of json.printed as { serial: string }[]) {
          const binding: LabelBinding = { ...json.binding, serial_no: p.serial }
          openAndPrintLabel(resolveLabel(json.template, binding))
        }
      }
      if (json.printerMissing) {
        setErr('No printer is assigned to the Pasteuriser, so these opened in a print window instead. Assign one on the Printers admin page.')
      } else if (json.sendErrors?.length) {
        setErr(`The printer refused some labels — reprint these:\n${json.sendErrors.join('\n')}`)
      }
      await load()
    } catch (e) { setErr(errMessage(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-4">
        {template && (
          <div className="rounded-lg bg-white p-1.5 border border-surface-rule hidden sm:block flex-shrink-0">
            <LabelPreview template={template} scale={0.32} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-[15px] text-text">
            {card.customer ?? card.assignment?.customer ?? 'Job card'}
          </p>
          <p className="font-mono text-[11px] text-text-muted mt-0.5">
            {card.job_card_no ?? '—'}
            {card.batch_number && ` · batch ${card.batch_number}`}
            {card.assignment && ` · PO ${card.assignment.po_number}`}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {card.product_name ?? card.assignment?.product ?? ''}
            {' · '}
            <b className="text-text">{done}</b> label{done === 1 ? '' : 's'} printed
            {ordered ? ` of ${ordered}` : ''}
          </p>
        </div>
        <button onClick={() => router.push('/production/capture/pasteuriser')}
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text flex-shrink-0">
          Capture <ExternalLink size={12} />
        </button>
      </div>

      {fidelity && !fidelity.ok && (
        <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 rounded-lg p-2.5">
          <TriangleAlert size={13} className="mt-0.5 flex-shrink-0" />
          <p className="leading-relaxed">
            This label carries certification artwork, so it prints through the browser rather than
            straight to the Argox — a thermal stream cannot draw the marks, and a label missing its
            mark is a compliance problem, not a cosmetic one.
          </p>
        </div>
      )}

      {/* The pre-print check on THIS run. Two names, and core refuses the same
          person twice — the route reports that back rather than this hiding it. */}
      {card.assignment?.template && (
        <div className="border-t border-surface-rule pt-3">
          <SignOffChain
            scope="print"
            templateId={card.assignment.template.id}
            templateVersion={Number(card.assignment.template.version)}
            jobCardId={card.id}
            canSign={canSign}
            rows={signOffs}
            onSigned={load}
          />
        </div>
      )}

      {gate && !gate.open && (
        <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 rounded-lg p-2.5">
          <TriangleAlert size={13} className="mt-0.5 flex-shrink-0" />
          <div className="leading-relaxed">
            <p className="font-medium">Not ready to print.</p>
            <ul className="mt-1 space-y-0.5">
              {gate.blockedBy.map(b => <li key={b.key}>· {b.reason}</li>)}
            </ul>
          </div>
        </div>
      )}

      {err && <p className="text-xs text-red-700 whitespace-pre-line">{err}</p>}

      {canPrint && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">Labels</label>
          <input type="number" min={1} max={50} value={count}
            onChange={e => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className="w-20 px-2 py-1.5 rounded-lg border border-surface-rule bg-surface text-sm text-text" />
          <button onClick={print} disabled={busy || !template || !gate?.open}
            title={gate && !gate.open ? 'The approval chain is not complete' : undefined}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-mid transition-colors text-sm font-medium disabled:opacity-50">
            <Printer size={15} /> {busy ? 'Printing…' : 'Print'}
          </button>
        </div>
      )}

      {prints.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {liveSerials(prints).slice(0, 24).map(s => (
            <span key={s} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-dim text-text-muted">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

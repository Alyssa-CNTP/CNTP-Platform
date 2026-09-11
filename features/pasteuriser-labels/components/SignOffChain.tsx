'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, CircleDashed, PenLine, TriangleAlert } from 'lucide-react'
import {
  PRINT_SIGN_OFFS, SIGN_OFF_LABEL, TEMPLATE_SIGN_OFFS,
  type SignOffRole,
} from '@/lib/core/labels'
import {
  EXTERNAL_SIGN_OFF_ROLES, latestByRole, readSignOffs, type SignOffRow,
} from '@/lib/production/label-sign-offs'
import { publicDb, errMessage } from '../db'
import { ActionDialog, type DialogField } from './ActionDialog'

/**
 * The signature chain, for either gate.
 *
 * ── Why one component for both ─────────────────────────────────────────────
 *
 * The template chain (Sales, Quality, Customer, Control Union) and the
 * pre-print check (sales lead + quality supervisor) are different questions
 * asked at different times — that separation is the whole point of
 * `lib/core/labels/approval.ts` and is not being undone here. What they SHARE
 * is the shape: a fixed list of roles, the last signature per role wins, one
 * button per outstanding role, and a line saying who signed and when. Two
 * components would be that shape written twice, and the second copy is where
 * "the last signature wins" quietly becomes "the first" (ARCHITECTURE.md §1A).
 *
 * The scope is a real discriminant, not a field duck-typed on: it picks the
 * role list, the endpoint and the wording, and everything else is identical.
 *
 * ── What this component does NOT do ────────────────────────────────────────
 *
 * It does not decide anything. Every signature POSTs to a route that re-reads
 * the row and decides server-side — including the two-different-people rule,
 * which is refused by `printGate()` in core and reported back here as an
 * error. A button that looks available and then fails is the correct shape;
 * a button disabled by a client-side guess is not an enforcement mechanism
 * (ARCHITECTURE.md §6).
 *
 * It also does not gate ITSELF on the chain being complete. Somebody has to be
 * able to go first.
 */

/**
 * Field definitions at module scope — ActionDialog resets its inputs whenever
 * `fields` changes identity, so a fresh literal per render would clear what is
 * being typed on every keystroke. (Same reason the page's own dialogs do it.)
 */
const EXTERNAL_FIELDS: Readonly<Record<string, DialogField[]>> = {
  customer: [
    { key: 'actorName', label: 'Who approved it, at the customer?', required: true,
      placeholder: 'Their name',
      hint: 'Recorded as the signature. Your name is recorded alongside it as the person who took the approval.' },
    { key: 'externalRef', label: 'Their reference',
      placeholder: 'Email, PO or approval number',
      hint: 'Optional, and what an auditor asks for first.' },
  ],
  certifier: [
    { key: 'actorName', label: 'Who signed at Control Union?', required: true,
      placeholder: 'Their name',
      hint: 'Recorded as the signature. Your name is recorded alongside it as the person who took the approval.' },
    { key: 'externalRef', label: 'Certificate or letter reference',
      placeholder: 'Their sign-off reference',
      hint: 'Optional, and what an auditor asks for first.' },
  ],
}

const INTERNAL_FIELDS: DialogField[] = [
  { key: 'note', label: 'Anything to record?', placeholder: 'Optional',
    hint: 'Your name and the version are captured automatically.' },
]

export interface SignOffChainProps {
  scope: 'template' | 'print'
  templateId: string
  templateVersion: number
  /** Required for the print scope; ignored for the template scope. */
  jobCardId?: string | null
  /** Which roles this viewer may sign as. Display only — the route decides. */
  canSign: (role: SignOffRole) => boolean
  /** Called after a signature lands, so the parent can re-read status/gate. */
  onSigned?: () => void
  /**
   * Rows the parent already read. Omit and the component reads them itself —
   * the label page has no other reason to load them, the run page does.
   */
  rows?: readonly SignOffRow[]
}

export function SignOffChain({
  scope, templateId, templateVersion, jobCardId, canSign, onSigned, rows: given,
}: SignOffChainProps) {
  const [rows, setRows] = useState<readonly SignOffRow[]>(given ?? [])
  const [pending, setPending] = useState<SignOffRole | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selfLoad = given === undefined
  const load = useCallback(async () => {
    if (!selfLoad) return
    setRows(await readSignOffs(publicDb(), templateId))
  }, [selfLoad, templateId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (given !== undefined) setRows(given) }, [given])

  const roles: readonly SignOffRole[] =
    scope === 'template' ? TEMPLATE_SIGN_OFFS : PRINT_SIGN_OFFS

  // For the template scope the version matters: a v1 signature says nothing
  // about v2 and must not be shown as satisfying it. For the print scope the
  // job card is the boundary instead.
  const signed = latestByRole(rows, scope, scope === 'template'
    ? { templateVersion }
    : { jobCardId: jobCardId ?? null })

  async function sign(role: SignOffRole, extra: Record<string, unknown>) {
    setBusy(true); setError(null)
    try {
      const url = scope === 'template'
        ? `/api/pasteuriser/labels/${templateId}/sign-off`
        : `/api/pasteuriser/job-cards/${jobCardId}/sign-off`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, ...extra }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not record that signature')
      await load()
      onSigned?.()
    } catch (e) { setError(errMessage(e)) }
    finally { setBusy(false); setPending(null) }
  }

  const outstanding = roles.filter(r => !signed.has(r))

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          {scope === 'template'
            ? `Approval chain · version ${templateVersion}`
            : 'Pre-print check'}
        </p>
        <p className="text-[11px] text-text-faint">
          {outstanding.length === 0
            ? 'Complete'
            : `${roles.length - outstanding.length} of ${roles.length}`}
        </p>
      </div>

      <ul className="space-y-1">
        {roles.map(role => {
          const row = signed.get(role)
          return (
            <li key={role}
              className="flex items-center gap-2.5 rounded-lg bg-surface-dim px-2.5 py-2">
              {row
                ? <Check size={14} className="text-emerald-600 flex-shrink-0" />
                : <CircleDashed size={14} className="text-text-faint flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-text font-medium leading-tight">
                  {SIGN_OFF_LABEL[role]}
                </p>
                {row ? (
                  <p className="text-[11px] text-text-muted leading-tight mt-0.5 truncate">
                    {row.actor_name}
                    {' · '}
                    {new Date(row.signed_at).toLocaleDateString('en-ZA')}
                    {row.external_ref ? ` · ${row.external_ref}` : ''}
                    {/* Who here stood behind an outside party's approval. An
                        external signature without this is a claim with nobody
                        attached to it. */}
                    {row.recorded_by_name ? ` · recorded by ${row.recorded_by_name}` : ''}
                  </p>
                ) : (
                  <p className="text-[11px] text-text-faint leading-tight mt-0.5">
                    Not signed
                  </p>
                )}
              </div>
              {!row && canSign(role) && (
                <button
                  onClick={() => setPending(role)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-surface-rule text-[11px] text-text hover:bg-surface transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  <PenLine size={11} /> Sign
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-red-700">
          <TriangleAlert size={12} className="mt-0.5 flex-shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </p>
      )}

      {pending && (
        <ActionDialog
          key={pending} open
          title={`Sign as ${SIGN_OFF_LABEL[pending]}`}
          message={EXTERNAL_SIGN_OFF_ROLES.has(pending)
            ? 'Recording somebody else’s approval. Their name is the signature; yours is recorded next to it as the person who took it.'
            : 'Your name and this version are captured automatically, so the record says who signed what.'}
          confirmLabel="Record signature"
          busy={busy}
          fields={EXTERNAL_SIGN_OFF_ROLES.has(pending) ? EXTERNAL_FIELDS[pending] : INTERNAL_FIELDS}
          onCancel={() => setPending(null)}
          onConfirm={v => void sign(pending, {
            actorName: v.actorName || undefined,
            externalRef: v.externalRef || undefined,
            note: v.note || undefined,
          })}
        />
      )}
    </div>
  )
}

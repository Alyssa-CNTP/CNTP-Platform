import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'
import { labelDb, readBody, str, strOrNull, errMessage } from '../_db'
import { writeAudit } from '@/lib/audit/write'
import { pasteuriserLabelSerial } from '@/lib/core/serials'
import { resolveLabel, printBlockers, type LabelBinding } from '@/lib/core/labels'
import { buildLabelPplb, pplbFidelity, toTemplate, type LabelTemplateRow } from '@/features/pasteuriser-labels'
import { getPrinterForSection } from '@/lib/production/printer-registry'
import { sendToPrinter } from '@/lib/production/print-socket'
import { isRelayMode, enqueuePrintJob } from '@/lib/production/print-queue'

/**
 * Allocate a serial and record a printed label.
 *
 * Everything that must not be decided by the client is decided here:
 *
 *   - THE SERIAL. Allocated by public.next_pasteuriser_label_seq(job_card_id),
 *     which is an atomic INSERT .. ON CONFLICT DO UPDATE .. RETURNING on a
 *     counter row. Two supervisors printing in the same second get 7 and 8, not
 *     7 and 7. App-side `max + 1` is the documented cause of 44% of Fine/Coarse
 *     Leaf bags being lost (ARCHITECTURE.md §1B, §5) and is not repeated here.
 *
 *   - THE DATE STEM. Taken from the job card's production date, never from the
 *     server or device clock. A Pasteuriser run goes 07h00 -> 01h00; the live
 *     clock would roll the stem over mid-run and restart the sequence inside one
 *     continuous run (§5, §9).
 *
 *   - WHETHER IT MAY PRINT AT ALL. The template must be approved and every
 *     placeholder filled. Re-checked from a fresh read, because a template can
 *     be superseded between the operator opening the screen and pressing print,
 *     and a disabled button is not an enforcement mechanism (§6).
 *
 * SENDING is done here too, reusing the section→printer registry and the relay
 * queue that already carry bag tags to the factory LAN. The client never sends
 * raw printer bytes — /api/print/label deliberately builds its own payload from
 * a record rather than accepting one, and opening a raw path here would undo
 * that for every printer on the network.
 *
 * A label carrying certification artwork cannot be drawn by a PPLB stream at
 * all (see features/pasteuriser-labels/render-pplb.ts). Those are reported back
 * as `browserPrint: true` and rendered by the client, which draws the marks
 * properly — never silently printed without them.
 */

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_print_labels')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const jobCardId = str(body.jobCardId)
  if (!jobCardId) return NextResponse.json({ error: 'jobCardId is required' }, { status: 400 })

  const count = Math.min(50, Math.max(1, Math.round(Number(body.count ?? 1)) || 1))

  const admin = labelDb()

  // ── The job card, its assignment and its template, in one fresh read ───────
  const { data: card, error: cardErr } = await admin
    .from('job_cards_pasteuriser')
    .select('*, assignment:label_po_assignments(*, template:label_templates(*))')
    .eq('id', jobCardId).maybeSingle()
  if (cardErr) return NextResponse.json({ error: cardErr.message }, { status: 500 })
  if (!card) return NextResponse.json({ error: 'Job card not found' }, { status: 404 })

  const assignment = card.assignment
  if (!assignment) {
    return NextResponse.json({
      error: 'This job card has no label assigned. The production manager assigns an approved label and PO when raising the card.',
    }, { status: 409 })
  }
  const templateRow = assignment.template as LabelTemplateRow | null
  if (!templateRow) return NextResponse.json({ error: 'The assigned label template is missing' }, { status: 500 })

  // A job card must be approved before its product is labelled — the label
  // asserts a batch number and a production date that the card is the record of.
  if (card.status !== 'approved') {
    return NextResponse.json({
      error: `Job card ${card.job_card_no ?? ''} is ${card.status}. Labels can only be printed against an approved job card.`.trim(),
    }, { status: 409 })
  }

  // ── The binding ───────────────────────────────────────────────────────────
  // Order-time values come from the assignment, production values from the job
  // card. Neither is taken from the client: the client knows what it was shown
  // when the page loaded, and the card may have been corrected since.
  const productionDate: string | null = card.expected_commencement ?? card.date_of_card ?? null
  if (!productionDate) {
    return NextResponse.json({
      error: 'The job card has no production date, so a serial cannot be dated. Set the commencement date on the card first.',
    }, { status: 409 })
  }

  const baseBinding: LabelBinding = {
    product:          assignment.product ?? card.product_name ?? undefined,
    customer:         assignment.customer ?? card.customer ?? undefined,
    po_number:        assignment.po_number ?? card.customer_po ?? undefined,
    item_number:      assignment.item_number ?? card.item_no ?? undefined,
    importer:         assignment.importer ?? undefined,
    net_mass:         assignment.net_mass ?? card.weight_per_bulk_bag ?? undefined,
    gross_mass:       assignment.gross_mass ?? undefined,
    batch_no:         card.batch_number ?? assignment.planned_batch_no ?? undefined,
    grade:            card.blend_description ?? undefined,
    lot_number:       card.batch_number ?? undefined,
    job_card_no:      card.job_card_no ?? undefined,
    production_date:  formatSast(productionDate),
    best_before_date: strOrNull(body.bestBeforeDate) ?? undefined,
  }

  // Values the operator legitimately supplies at the machine (a per-pallet
  // gross mass, a best-before the customer specified for this shipment).
  const overrides: LabelBinding = {}
  const supplied = (body.binding ?? {}) as Record<string, unknown>
  for (const k of ['gross_mass', 'best_before_date', 'pallet_no'] as const) {
    const v = strOrNull(supplied[k])
    if (v) overrides[k] = v
  }

  const template = toTemplate(templateRow)

  // Dry run with a placeholder serial, to fail BEFORE burning sequence numbers.
  // Allocating first and validating after would leave a gap on every rejected
  // attempt, and gaps are permanent by design (§5).
  const probe = resolveLabel(template, { ...baseBinding, ...overrides, serial_no: 'PROBE' })
  const blockers = printBlockers(probe)
  if (blockers.length > 0) {
    return NextResponse.json({ error: 'This label cannot be printed yet.', blockers }, { status: 422 })
  }

  // Marks cannot be drawn by a PPLB stream. Rather than degrade — which would
  // put an organic bag on a boat without its certifier's mark — those labels
  // are handed back for the client to render and print through the browser.
  const browserPrint = !pplbFidelity(probe).ok
  const printPath: 'pplb' | 'browser' = browserPrint ? 'browser' : 'pplb'

  const printer = browserPrint ? null : await getPrinterForSection('pasteuriser')

  // ── Allocate + record + send ──────────────────────────────────────────────
  const printed: { serial: string; id: string }[] = []
  const sendErrors: string[] = []

  for (let i = 0; i < count; i++) {
    const { data: seq, error: seqErr } = await admin.rpc('next_pasteuriser_label_seq', { p_job_card_id: jobCardId })
    if (seqErr) return NextResponse.json({ error: `Could not allocate a serial: ${seqErr.message}` }, { status: 500 })

    const serial = pasteuriserLabelSerial(productionDate, Number(seq))
    const binding = { ...baseBinding, ...overrides, serial_no: serial }

    const { data: printRow, error: insErr } = await admin.from('label_prints').insert({
      job_card_id:   jobCardId,
      assignment_id: assignment.id,
      template_id:   templateRow.id,
      serial_no:     serial,
      binding,
      print_path:    printPath,
      printed_by:    caller.userId,
    }).select('id').single()
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

    printed.push({ serial, id: printRow.id })

    // The ledger row is written BEFORE the send, and a send failure does not
    // remove it. That is the right way round: the serial is allocated and may
    // already be on paper, and an append-only ledger is reversed by appending
    // a void, never by deleting (ARCHITECTURE.md §6). The client is told which
    // sends failed so the operator can reprint those.
    if (printer) {
      const payload = buildLabelPplb(resolveLabel(template, binding))
      try {
        if (isRelayMode()) {
          await enqueuePrintJob({
            sectionId: 'pasteuriser', printerIp: printer.ip, printerPort: printer.port ?? 9100,
            lang: printer.lang, payload,
          })
        } else {
          await sendToPrinter(payload, printer.ip, printer.port ?? 9100)
        }
      } catch (err) {
        sendErrors.push(`${serial}: ${errMessage(err)}`)
      }
    }
  }

  // First print of a card puts the order into production — the signal sales and
  // the supply chain analyst watch for.
  if (assignment.status === 'open') {
    await admin.from('label_po_assignments')
      .update({ status: 'in_production', updated_at: new Date().toISOString() })
      .eq('id', assignment.id).eq('status', 'open')
  }

  await writeAudit({
    actorId: caller.userId, action: 'print', schema: 'public', table: 'label_prints',
    recordId: jobCardId,
    after: { count, serials: printed.map(p => p.serial), template: `${templateRow.code} v${templateRow.version}` },
  })

  return NextResponse.json({
    template,
    binding: { ...baseBinding, ...overrides },
    printed,
    // True when the client must render these itself — either the label carries
    // certification artwork, or no printer is assigned to the Pasteuriser.
    browserPrint: browserPrint || !printer,
    printerMissing: !browserPrint && !printer,
    sendErrors,
  })
}

/**
 * A stored date → the `DD-MM-YYYY` the labels are printed with.
 *
 * Dates are stored as plain `date` on the job card, so there is no timezone to
 * convert — a bare date has no instant. Reformatting only. (Timestamps
 * elsewhere are UTC in storage and SAST on display, ARCHITECTURE.md §9.)
 */
function formatSast(dateStr: string): string {
  const [y, m, d] = String(dateStr).split('T')[0].split('-')
  return y && m && d ? `${d}-${m}-${y}` : String(dateStr)
}

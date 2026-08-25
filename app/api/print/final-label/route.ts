import { NextRequest, NextResponse } from 'next/server'
import { buildFinalLabelPplbBatch } from '@/lib/production/label-final-pplb'
import type { FinalProductLabel } from '@/lib/production/label-final'
import { getPrinterForSection } from '@/lib/production/printer-registry'
import { sendToPrinter } from '@/lib/production/print-socket'
import { isRelayMode, enqueuePrintJob } from '@/lib/production/print-queue'

/**
 * Print Pasteuriser FINAL-PRODUCT tags — box/bag tags and pallet tags.
 *
 * Separate from /api/print/label (the in-process bag tag) because the payload
 * is a different shape and the template is a different, deliberately
 * independent design — see lib/production/label-final.ts.
 *
 * Takes an ARRAY. A bagging line is a bag range ("bags 281–315"), so the normal
 * request is "print these 35 tags", not one tag 35 times. Concatenating the
 * PPLB blocks into a single job is both far faster over the socket and the only
 * way the operator gets one predictable print run rather than 35 racing
 * requests, any of which could fail on its own.
 */

// One physical batch is at most a few hundred boxes (the largest real job card
// seen is 1000 bags). The cap exists so a corrupted client payload can't queue
// an unbounded print job that jams the printer for the rest of the shift — it
// is not a business limit, and it errors loudly rather than truncating, so the
// operator is never told "printed" for tags that never came out.
const MAX_LABELS_PER_JOB = 1200

export async function POST(req: NextRequest) {
  let body: { labels?: FinalProductLabel[]; section?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const labels = Array.isArray(body?.labels) ? body.labels : []
  const sectionId = body?.section ?? 'pasteuriser'

  if (labels.length === 0) {
    return NextResponse.json({ error: 'labels must be a non-empty array' }, { status: 400 })
  }
  if (labels.length > MAX_LABELS_PER_JOB) {
    return NextResponse.json(
      { error: `Too many tags in one job (${labels.length}). Maximum is ${MAX_LABELS_PER_JOB}.` },
      { status: 400 },
    )
  }
  const bad = labels.findIndex(l => !l?.serial || (l.kind !== 'box' && l.kind !== 'pallet'))
  if (bad !== -1) {
    return NextResponse.json(
      { error: `Tag ${bad + 1} is missing a serial or has an invalid kind` },
      { status: 400 },
    )
  }

  // The section→printer binding lives on the server (production.printers, edited
  // on the Printers admin page) — the client never picks a printer.
  const printer = await getPrinterForSection(sectionId)
  if (!printer) {
    return NextResponse.json({ error: `No printer assigned to section "${sectionId}"` }, { status: 400 })
  }

  // Every printer on the floor today is an Argox (PPLB). A Zebra would need a
  // ZPL final-product template, which doesn't exist yet — fail explicitly so the
  // client falls back to browser print (which produces a correct tag) instead of
  // sending PPLB commands a Zebra would render as garbage.
  if (printer.lang !== 'pplb') {
    return NextResponse.json(
      { error: `Final-product tags are only supported on PPLB printers; section "${sectionId}" is set to ${printer.lang}. Use browser print.` },
      { status: 400 },
    )
  }

  const port = printer.port ?? 9100
  const payload = buildFinalLabelPplbBatch(labels)

  // Relay mode (prod): enqueue for the factory-LAN agent to print.
  if (isRelayMode()) {
    try {
      await enqueuePrintJob({ sectionId, printerIp: printer.ip, printerPort: port, lang: printer.lang, payload })
      return NextResponse.json({ queued: true, count: labels.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[print/final-label] enqueue', message)
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  // Direct mode (local on the factory network): open the socket ourselves.
  try {
    await sendToPrinter(payload, printer.ip, port)
    return NextResponse.json({ success: true, count: labels.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[print/final-label] direct', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

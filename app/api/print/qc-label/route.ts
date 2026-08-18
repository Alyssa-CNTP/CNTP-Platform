import { NextRequest, NextResponse } from 'next/server'
import { buildQcLabelZpl } from '@/lib/quality/qc-label-zpl'
import type { QcLabelData } from '@/lib/quality/qc-label-print'
import { getPrinterForSection } from '@/lib/production/printer-registry'
import { sendToPrinter } from '@/lib/production/print-socket'
import { isRelayMode, enqueuePrintJob } from '@/lib/production/print-queue'

// Direct-to-printer path for the Sieving Final QC bag label — same
// relay/direct split as app/api/print/label/route.ts (production's bag tags),
// reusing that infrastructure rather than duplicating it. 'quality_lab' is a
// distinct printer entry from 'sieving' (the tower's own bag-tag printer) —
// this is the lab's separate Intermec, not the floor's Argox.
const SECTION_ID = 'quality_lab'

export async function POST(req: NextRequest) {
  let body: { data?: QcLabelData }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const data = body.data
  if (!data) {
    return NextResponse.json({ error: 'data is required' }, { status: 400 })
  }

  const printer = await getPrinterForSection(SECTION_ID)
  if (!printer) {
    return NextResponse.json({ error: 'No printer assigned to the QC lab' }, { status: 400 })
  }

  const port    = printer.port ?? 9100
  const payload = buildQcLabelZpl(data)

  if (isRelayMode()) {
    try {
      await enqueuePrintJob({ sectionId: SECTION_ID, printerIp: printer.ip, printerPort: port, lang: printer.lang, payload })
      return NextResponse.json({ queued: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[print/qc-label] enqueue', message)
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  try {
    await sendToPrinter(payload, printer.ip, port)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[print/qc-label]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

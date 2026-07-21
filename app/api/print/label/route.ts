import { NextRequest, NextResponse } from 'next/server'
import { buildLabelPplb } from '@/lib/production/label-pplb'
import { buildLabelZpl } from '@/lib/production/label-zpl'
import type { OutputBag } from '@/lib/production/live-types'
import { getPrinterForSection } from '@/lib/production/printer-registry'
import { sendToPrinter } from '@/lib/production/print-socket'
import { isRelayMode, enqueuePrintJob } from '@/lib/production/print-queue'

interface PrintRequest {
  bag: OutputBag
  section?: string   // optional override; defaults to bag.section_id
}

export async function POST(req: NextRequest) {
  let body: PrintRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { bag, section } = body
  const sectionId = section ?? bag?.section_id

  if (!bag || !sectionId) {
    return NextResponse.json({ error: 'bag with a section_id is required' }, { status: 400 })
  }

  // The section→printer binding is the single source of truth and lives on the
  // server (production.printers table, edited via the Printers admin page). The
  // client never chooses a printer, so a section's tags can only ever go to the
  // printer assigned to that section.
  const printer = await getPrinterForSection(sectionId)
  if (!printer) {
    return NextResponse.json(
      { error: `No printer assigned to section "${sectionId}"` },
      { status: 400 },
    )
  }

  const port = printer.port ?? 9100
  const payload = printer.lang === 'pplb' ? buildLabelPplb(bag) : buildLabelZpl(bag)

  // Relay mode (prod): enqueue for the factory-LAN agent to print.
  if (isRelayMode()) {
    try {
      await enqueuePrintJob({ sectionId, printerIp: printer.ip, printerPort: port, lang: printer.lang, payload })
      return NextResponse.json({ queued: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[print/label] enqueue', message)
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  // Direct mode (local on the factory network): open the socket ourselves.
  try {
    await sendToPrinter(payload, printer.ip, port)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[print/label]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

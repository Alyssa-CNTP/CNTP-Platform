import { NextRequest, NextResponse } from 'next/server'
import { buildLabelPplb } from '@/lib/production/label-pplb'
import { buildLabelZpl } from '@/lib/production/label-zpl'
import { sendToPrinter } from '@/lib/production/print-socket'
import { isRelayMode, enqueuePrintJob } from '@/lib/production/print-queue'
import type { OutputBag } from '@/lib/production/live-types'
import type { PrinterLang } from '@/lib/production/capture-config'

interface TestRequest {
  ip: string
  lang?: PrinterLang
  port?: number
  sectionName?: string
}

// Prints a sample label to an explicit printer address — used by the Printers
// admin page to verify a printer works with the values on screen, before saving.
export async function POST(req: NextRequest) {
  let body: TestRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { ip, lang = 'zpl', port = 9100, sectionName = 'Printer Test' } = body
  if (!ip) {
    return NextResponse.json({ error: 'ip is required' }, { status: 400 })
  }

  const sampleBag: OutputBag = {
    id: 'test',
    serial_number: 'TEST-000-001',
    product_type: 'Printer Test',
    variant: 'Conventional' as any,
    grade: 'A' as any,
    weight_kg: 0,
    lot_number: 'TEST',
    section_id: 'test',
    section_name: sectionName,
    created_at: new Date().toISOString(),
    printed: false,
  }

  const payload = lang === 'pplb' ? buildLabelPplb(sampleBag) : buildLabelZpl(sampleBag)

  // Relay mode (prod): enqueue the test label for the factory-LAN agent.
  if (isRelayMode()) {
    try {
      await enqueuePrintJob({ sectionId: 'test', printerIp: ip, printerPort: port, lang, payload })
      return NextResponse.json({ queued: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[print/test] enqueue', message)
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  try {
    await sendToPrinter(payload, ip, port)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[print/test]', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

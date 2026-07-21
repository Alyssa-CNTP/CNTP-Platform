import supabaseAdmin from '@/lib/supabase/admin'
import type { PrinterLang } from './capture-config'

// Relay mode: when PRINT_RELAY is set (on the prod VPS, which can't reach the
// factory LAN), the print API enqueues jobs instead of opening a socket. The
// print-relay agent on a factory-LAN machine drains the queue. When unset (local
// dev on the factory network), the API prints directly over TCP.
export function isRelayMode(): boolean {
  return !!process.env.PRINT_RELAY && process.env.PRINT_RELAY !== '0' && process.env.PRINT_RELAY !== 'false'
}

export interface EnqueueArgs {
  sectionId: string
  printerIp: string
  printerPort: number
  lang: PrinterLang
  payload: string
}

export async function enqueuePrintJob(a: EnqueueArgs): Promise<void> {
  const { error } = await supabaseAdmin.schema('production').from('print_jobs').insert({
    section_id: a.sectionId,
    printer_ip: a.printerIp,
    printer_port: a.printerPort,
    lang: a.lang,
    payload: a.payload,
    status: 'pending',
  } as any)
  if (error) throw new Error(error.message)
}

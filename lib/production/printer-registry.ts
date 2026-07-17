import supabaseAdmin from '@/lib/supabase/admin'
import { SECTION_PRINTER, type PrinterConfig, type PrinterLang } from './capture-config'

// Server-side resolver for "which printer does this section print to".
//
// Source of truth is the production.printers table, editable from the Printers
// admin page. Results are cached briefly so the print path stays fast; edits in
// the UI take effect within CACHE_TTL_MS. If the table has no (enabled) row for a
// section — e.g. before the migration is run — we fall back to the hardcoded
// SECTION_PRINTER defaults so printing never breaks during rollout.

const CACHE_TTL_MS = 30_000

interface PrinterRow {
  section_id: string
  printer_name: string | null
  ip: string | null
  port: number | null
  lang: string | null
  enabled: boolean | null
}

let cache: { at: number; map: Record<string, PrinterConfig> } | null = null

async function loadPrinters(): Promise<Record<string, PrinterConfig>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map

  const map: Record<string, PrinterConfig> = {}
  try {
    const { data } = await supabaseAdmin
      .schema('production')
      .from('printers')
      .select('section_id, printer_name, ip, port, lang, enabled')
    for (const r of (data ?? []) as PrinterRow[]) {
      if (r.enabled === false || !r.ip) continue
      map[r.section_id] = {
        ip: r.ip,
        lang: (r.lang === 'pplb' ? 'pplb' : 'zpl') as PrinterLang,
        port: r.port ?? 9100,
      }
    }
  } catch {
    // Table missing or unreachable — fall through to code defaults below.
  }

  cache = { at: Date.now(), map }
  return map
}

export async function getPrinterForSection(section: string): Promise<PrinterConfig | null> {
  const map = await loadPrinters()
  return map[section] ?? SECTION_PRINTER[section] ?? null
}

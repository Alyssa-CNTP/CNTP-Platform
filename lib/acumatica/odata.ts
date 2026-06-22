// ══════════════════════════════════════════════════════════════════════════════
// lib/acumatica/odata.ts
//
// Read-only OData client for Acumatica Generic Inquiries.
//
// WHAT THIS IS
// ────────────
// Acumatica can expose any Generic Inquiry (GI) as an OData feed. OData is just
// HTTP GET + a small query language (the "$" options below), returning JSON. A
// GI exposed this way is READ-ONLY — there is no way to write back through it,
// which is exactly why it's the safest place to start a sync.
//
// AUTH
// ────
// OData feeds use HTTP Basic auth: we send `Authorization: Basic base64(user:pass)`.
// This MUST happen server-side only — credentials never reach the browser. That's
// why this helper is imported by a Route Handler (server), not a React component.
//
// We use the per-tenant endpoint (/t/{tenant}/api/odata/gi/), which puts the
// tenant in the URL — so the username is the PLAIN Acumatica Login (e.g.
// "AlyssaKrishna"), NOT the email address and NOT a "user@tenant" suffix.
// ══════════════════════════════════════════════════════════════════════════════

export interface AcumaticaConfig {
  baseUrl: string   // e.g. https://rooibostea.acumatica.com
  company: string   // tenant / company id, e.g. "CNTP TEST"
  user: string      // OData/API username
  password: string  // OData/API password
}

// Pull config from env. Returns null (not throws) when unconfigured so the route
// can answer with a clean 503 + setup hint, mirroring the app's other routes.
export function getAcumaticaConfig(): AcumaticaConfig | null {
  const baseUrl  = process.env.ACUMATICA_BASE_URL  ?? ''
  const company  = process.env.ACUMATICA_COMPANY   ?? ''
  const user     = process.env.ACUMATICA_ODATA_USER     ?? ''
  const password = process.env.ACUMATICA_ODATA_PASSWORD ?? ''

  if (!baseUrl || !company || !user || !password) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), company, user, password }
}

// OData "system query options" we allow callers to pass through. These shape the
// response on Acumatica's side (so we transfer less data), and they are all
// read-only operations:
//   $top    — return at most N rows            (e.g. $top=10)
//   $filter — server-side WHERE clause         (e.g. ItemClass eq 'TEA')
//   $select — return only these columns         (e.g. InventoryID,Descr)
//   $orderby— sort                              (e.g. LastModified desc)
const ALLOWED_QUERY_OPTIONS = ['$top', '$filter', '$select', '$orderby', '$skip'] as const

export interface OdataResult {
  ok: boolean
  status: number
  url: string                 // the exact URL we hit (creds stripped) — useful for learning
  count: number | null        // number of rows returned
  rows: Record<string, unknown>[]
  message: string
}

export async function fetchInquiry(
  cfg: AcumaticaConfig,
  inquiryName: string,
  options: URLSearchParams,
): Promise<OdataResult> {
  // Build the OData URL using Acumatica's per-tenant GI endpoint:
  //   {base}/t/{tenant}/api/odata/gi/{InquiryName}
  // The tenant lives in the URL path here, so the username stays plain (no
  // "user@tenant" suffix). This endpoint returns JSON by default — the Accept
  // header below confirms it, so no $format param is needed.
  // The tenant can contain a space ("CNTP TEST") so each path segment is encoded.
  const path = `/t/${encodeURIComponent(cfg.company)}/api/odata/gi/${encodeURIComponent(inquiryName)}`
  const url  = new URL(cfg.baseUrl + path)

  // Forward only the whitelisted, read-only query options the caller supplied.
  for (const key of ALLOWED_QUERY_OPTIONS) {
    const val = options.get(key)
    if (val) url.searchParams.set(key, val)
  }

  // Basic auth header, built server-side.
  const token = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')

  // Abort if Acumatica is slow — same defensive pattern as the app's other fetches.
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(url.toString(), {
      method:  'GET',
      headers: { Authorization: `Basic ${token}`, Accept: 'application/json' },
      signal:  controller.signal,
      cache:   'no-store',
    })
    clearTimeout(timeout)

    if (!res.ok) {
      // Don't leak the body of an auth error verbatim, but surface the status.
      return {
        ok: false, status: res.status, url: url.toString(),
        count: null, rows: [],
        message: res.status === 401
          ? 'Unauthorized — check ACUMATICA_ODATA_USER / PASSWORD and that the user can access this tenant.'
          : `Acumatica returned HTTP ${res.status}.`,
      }
    }

    // Acumatica OData v3 wraps rows in { value: [...] }; v4/some configs return a
    // bare array. Handle both.
    const data = await res.json()
    const rows: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.value) ? data.value : []

    return {
      ok: true, status: res.status, url: url.toString(),
      count: rows.length, rows,
      message: rows.length ? 'OK' : 'Connected, but the inquiry returned 0 rows.',
    }
  } catch (e: unknown) {
    clearTimeout(timeout)
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false, status: 0, url: url.toString(),
      count: null, rows: [],
      message: aborted ? 'Request timed out after 30s.' : 'Could not reach Acumatica.',
    }
  }
}

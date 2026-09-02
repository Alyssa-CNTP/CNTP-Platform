// ══════════════════════════════════════════════════════════════════════════════
// lib/acumatica/rest.ts
//
// OAuth2 (client-credentials) client for Acumatica's CONTRACT-BASED REST API.
//
// Unlike odata.ts (read-only Basic auth over Generic Inquiries), this authenticates
// with a short-lived bearer token and can call entity endpoints:
//   • read entities (e.g. LotDetail — stock on hand by lot), and
//   • later, WRITE entities (e.g. push Production Orders back to Acumatica).
//
// Token lifecycle is handled here so callers never think about it: we fetch a
// token, cache it in memory, and auto-refresh on expiry or a 401. The ~1-hour
// token lifetime is therefore invisible in operation — the client credentials
// themselves don't expire, so we can always mint a fresh token.
//
// Server-side only — credentials must never reach the browser.
// ══════════════════════════════════════════════════════════════════════════════

export interface AcumaticaRestConfig {
  baseUrl: string       // e.g. https://rooibostea.acumatica.com
  clientId: string
  clientSecret: string
  endpoint: string      // contract endpoint name/version, e.g. "CNTP/25.201.0213"
}

// Pull config from env; null (not throw) when unconfigured so routes can answer a
// clean 503, mirroring odata.ts.
export function getAcumaticaRestConfig(): AcumaticaRestConfig | null {
  const baseUrl      = process.env.ACUMATICA_BASE_URL      ?? ''
  const clientId     = process.env.ACUMATICA_CLIENT_ID     ?? ''
  const clientSecret = process.env.ACUMATICA_CLIENT_SECRET ?? ''
  const endpoint     = process.env.ACUMATICA_REST_ENDPOINT ?? 'CNTP/25.201.0213'
  if (!baseUrl || !clientId || !clientSecret) return null
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    clientId, clientSecret,
    endpoint: endpoint.replace(/^\/+|\/+$/g, ''),
  }
}

// Fetch with an abort timeout (Acumatica can be slow on large pulls).
async function timedFetch(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

// ── Token cache (module-level, survives across requests on the long-running VPS) ─
let _token: { value: string; expiresAt: number } | null = null

async function getToken(cfg: AcumaticaRestConfig, force = false): Promise<string> {
  const now = Date.now()
  // Reuse a cached token until 60s before it expires.
  if (!force && _token && _token.expiresAt > now + 60_000) return _token.value

  const res = await timedFetch(`${cfg.baseUrl}/identity/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
      scope:         'api',
    }),
  }, 15_000)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Acumatica token request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const j = await res.json()
  _token = { value: j.access_token, expiresAt: now + Number(j.expires_in ?? 3600) * 1000 }
  return _token.value
}

// Call a contract-REST entity.
//   method — GET | PUT | POST | DELETE
//   path   — entity + query, e.g. "LotDetail?$expand=LotDetailDetails"
//   body   — JSON body (for the PUT-with-filter retrieval pattern, or writes)
// Retries once on 401 with a freshly-minted token. Returns parsed JSON (or null on 204).
export async function acumaticaRest(
  cfg: AcumaticaRestConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${cfg.baseUrl}/entity/${cfg.endpoint}/${path}`
  const call = async (token: string) => timedFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, 60_000)

  let res = await call(await getToken(cfg))
  if (res.status === 401) res = await call(await getToken(cfg, true))  // token expired mid-flight → refresh + retry

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Acumatica REST ${method} ${path} failed (${res.status})${errBody ? `: ${errBody.slice(0, 300)}` : ''}`)
  }
  return res.status === 204 ? null : res.json()
}

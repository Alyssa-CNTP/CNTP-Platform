import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  let supabase:  { ok: boolean; latencyMs: number | null; message: string }
  let vps:       { ok: boolean; latencyMs: number | null; message: string }
  let acumatica: { ok: boolean; lastSync: string | null; itemCount: number | null; message: string }

  // ── Supabase ──────────────────────────────────────────────────────────────
  const t0 = Date.now()
  try {
    const sb = await createServerSupabaseClient()
    const { error } = await sb
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
    if (error) throw error
    supabase = { ok: true, latencyMs: Date.now() - t0, message: 'Connected' }

    // Acumatica — derive last sync from most-recent inventory import
    const { data: items, count } = await sb
      .from('inventory_items')
      .select('import_timestamp')
      .order('import_timestamp', { ascending: false })
      .limit(1)
    acumatica = {
      ok:        true,
      lastSync:  (items as any)?.[0]?.import_timestamp ?? null,
      itemCount: count ?? 0,
      message:   (items as any)?.[0] ? 'Synced' : 'Never synced',
    }
  } catch (e: any) {
    supabase  = { ok: false, latencyMs: null, message: e?.message ?? 'Connection failed' }
    acumatica = { ok: false, lastSync: null, itemCount: null, message: 'DB unavailable' }
  }

  // ── VPS / Research Engine ─────────────────────────────────────────────────
  const researchUrl = process.env.RESEARCH_ENGINE_URL ?? 'http://localhost:8001'
  const t1 = Date.now()
  try {
    const ctrl    = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 4000)
    const r       = await fetch(`${researchUrl}/health`, {
      signal: ctrl.signal,
      cache:  'no-store',
    })
    clearTimeout(timeout)
    vps = { ok: r.ok, latencyMs: Date.now() - t1, message: r.ok ? 'Online' : `HTTP ${r.status}` }
  } catch {
    vps = { ok: false, latencyMs: null, message: 'Unreachable' }
  }

  return NextResponse.json({ supabase, vps, acumatica })
}

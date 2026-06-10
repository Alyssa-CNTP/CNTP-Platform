// app/api/search/batch/route.ts
// Global batch/lot search — queries qms, production, sales in parallel.
// Returns permission-gated sections based on caller's resolved permissions.

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ quality: [], production: [], bags: [], sales: [] })

  const admin = getAdminClient() as any
  const like  = `%${q}%`
  const isFull = caller.role === 'senior_developer'

  const [qualityRes, sessionsRes, bagsRes, salesRes] = await Promise.allSettled([
    // Quality — always available (caller is authenticated)
    admin.schema('qms')
      .from('quality_records')
      .select('id, lot_number, product_type, grade, created_at, section_id')
      .ilike('lot_number', like)
      .order('created_at', { ascending: false })
      .limit(8),

    // Production sessions — gated by can_view_ops_dashboard
    isFull || caller.can('can_view_ops_dashboard')
      ? admin.schema('production')
          .from('prod_sessions')
          .select('id, lot_number, date, shift, section_name, status, supervisor_name')
          .ilike('lot_number', like)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: null }),

    // Bag tags — gated by can_view_ops_dashboard
    isFull || caller.can('can_view_ops_dashboard')
      ? admin.schema('production')
          .from('bag_tags')
          .select('serial_number, lot_number, product_type, weight_kg, status, destination, created_at')
          .or(`lot_number.ilike.${like},serial_number.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: null }),

    // Sales signals — gated by can_access_sales
    isFull || caller.can('can_access_sales')
      ? admin.schema('sales')
          .from('signals')
          .select('id, title, summary_en, classification, relevance_score, source_type, created_at')
          .or(`title.ilike.${like},keyword_group.ilike.${like},summary_en.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null }),
  ])

  return NextResponse.json({
    quality:    qualityRes.status  === 'fulfilled' ? (qualityRes.value.data   ?? []) : [],
    production: sessionsRes.status === 'fulfilled' ? (sessionsRes.value.data  ?? []) : [],
    bags:       bagsRes.status     === 'fulfilled' ? (bagsRes.value.data      ?? []) : [],
    sales:      salesRes.status    === 'fulfilled' ? (salesRes.value.data     ?? []) : [],
  })
}

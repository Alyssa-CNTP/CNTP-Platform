// app/api/axis/projects/route.ts
// GET  — list active projects (project selectors / link dropdowns)
// POST — create a new project directly (IT only)

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'

export async function GET() {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const { data, error } = await (getAdminClient() as any)
    .schema('axis')
    .from('projects')
    .select('id,name')
    .eq('status', 'active')
    .order('approved_at', { ascending: false })

  if (error) {
    console.error('[api/axis/projects GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId || caller.department !== 'IT')
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const {
    name, description, priority, term, effort_size,
    target_start, target_end, hard_deadline,
  } = await req.json()

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const validPriorities  = ['high', 'mid', 'low']
  const validTerms       = ['short', 'medium', 'long', 'ongoing']
  const validEffortSizes = ['XS', 'S', 'M', 'L', 'XL']

  if (priority    && !validPriorities.includes(priority))   return NextResponse.json({ error: 'Invalid priority' },    { status: 400 })
  if (term        && !validTerms.includes(term))             return NextResponse.json({ error: 'Invalid term' },         { status: 400 })
  if (effort_size && !validEffortSizes.includes(effort_size)) return NextResponse.json({ error: 'Invalid effort_size' }, { status: 400 })

  const { data, error } = await (getAdminClient() as any)
    .schema('axis')
    .from('projects')
    .insert({
      name:          name.trim(),
      description:   description?.trim() ?? '',
      priority:      priority      ?? 'mid',
      term:          term          ?? 'medium',
      effort_size:   effort_size   ?? 'M',
      status:        'active',
      target_start:  target_start  ?? null,
      target_end:    target_end    ?? null,
      hard_deadline: hard_deadline ?? false,
      approved_at:   new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[api/axis/projects POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: data.id })
}

import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { SEED_TEMPLATES } from '@/features/pasteuriser-labels'
import { writeAudit } from '@/lib/audit/write'

// Create a label template — either blank, or seeded from one of the existing
// BarTender designs (features/pasteuriser-labels/seed-templates.ts).
//
// A new template ALWAYS lands at 'draft', whatever it was seeded from. Seeding
// copies wording, not approval: what Control Union signed off was a BarTender
// file on a workstation, and the entire point of this workflow is that the
// approval attaches to the artefact that actually prints.

export async function POST(req: NextRequest) {
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_design_labels')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const code = String(body?.code ?? '').trim().toUpperCase()
  const name = String(body?.name ?? '').trim()
  const seedCode = body?.seedFrom ? String(body.seedFrom).trim().toUpperCase() : null
  if (!code) return NextResponse.json({ error: 'A label code is required' }, { status: 400 })

  const seed = seedCode ? SEED_TEMPLATES.find(t => t.code === seedCode) : null
  if (seedCode && !seed) {
    return NextResponse.json({ error: `No seed template '${seedCode}'` }, { status: 400 })
  }

  const admin = getAdminClient() as any

  // Version is per code. Reading the current max here is safe in a way the bag
  // serials are not: two people creating the same NEW label code in the same
  // second is not a real scenario, and the (code, version) unique index turns a
  // collision into an error rather than a silently lost row — which is exactly
  // what was missing from the app-side bag-serial allocation (ARCHITECTURE §1B).
  const { data: existing } = await admin.from('label_templates')
    .select('version').eq('code', code)
    .order('version', { ascending: false }).limit(1)
  const version = ((existing?.[0]?.version as number) ?? 0) + 1

  const row = {
    code,
    name: name || seed?.name || code,
    version,
    status: 'draft',
    market: body?.market ?? seed?.market ?? 'export',
    organic: typeof body?.organic === 'boolean' ? body.organic : (seed?.organic ?? false),
    size: body?.size ?? seed?.size ?? '100x100',
    lines: seed?.lines ?? [],
    certifications: seed?.certifications ?? [],
    mark_position: seed?.markPosition ?? 'right',
    proof_note: seed?.proofNote ?? null,
    created_by: caller.userId,
  }

  const { data, error } = await admin.from('label_templates').insert(row).select('*').single()
  if (error) {
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: `Label ${code} v${version} already exists` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await admin.from('label_template_events').insert({
    template_id: data.id,
    event: 'created',
    actor_id: caller.userId,
    note: seed ? `Seeded from the existing ${seed.name} design` : null,
  })

  await writeAudit({
    actorId: caller.userId,
    action: 'create',
    schema: 'public',
    table: 'label_templates',
    recordId: data.id,
    after: { code, version, seededFrom: seed?.code ?? null },
  })

  return NextResponse.json({ template: data })
}

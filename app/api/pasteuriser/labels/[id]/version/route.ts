import { NextRequest, NextResponse } from 'next/server'
import { getCallerPermissions, getAdminClient } from '@/lib/auth/server-helpers'
import { writeAudit } from '@/lib/audit/write'

/**
 * Mint a new DRAFT version of a template, copied from this one.
 *
 * This is how an approved label is "edited". The approved version stays
 * approved and stays printable until the new one is approved in its own right,
 * so a correction to next season's wording does not stop today's line.
 *
 * Editing in place is not offered anywhere, because the row would go on saying
 * "approved" about wording nobody approved — the failure would be invisible
 * until a certifier compared a bag against the file they signed.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerPermissions()
  if (!caller.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!caller.can('can_design_labels')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const admin = getAdminClient() as any

  const { data: src, error: readErr } = await admin
    .from('label_templates').select('*').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!src) return NextResponse.json({ error: 'Label template not found' }, { status: 404 })

  // A family may only have one draft in flight. Two drafts of the same label
  // being edited by two people is how the wrong one gets sent for approval.
  const { data: openDraft } = await admin
    .from('label_templates').select('id, version')
    .eq('code', src.code).in('status', ['draft', 'pending_approval'])
    .limit(1)
  if (openDraft?.length) {
    return NextResponse.json({
      error: `${src.code} v${openDraft[0].version} is already in progress. ` +
             `Finish or reject that one before starting another version.`,
    }, { status: 409 })
  }

  const { data: latest } = await admin
    .from('label_templates').select('version').eq('code', src.code)
    .order('version', { ascending: false }).limit(1)
  const version = ((latest?.[0]?.version as number) ?? src.version) + 1

  const { data, error } = await admin.from('label_templates').insert({
    code: src.code,
    name: src.name,
    version,
    status: 'draft',
    market: src.market,
    organic: src.organic,
    size: src.size,
    lines: src.lines,
    certifications: src.certifications,
    mark_position: src.mark_position,
    proof_note: src.proof_note,
    supersedes_id: src.id,
    created_by: caller.userId,
  }).select('*').single()

  if (error) {
    if ((error as any).code === '23505') {
      return NextResponse.json({ error: `${src.code} v${version} already exists` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await admin.from('label_template_events').insert({
    template_id: data.id,
    event: 'created',
    actor_id: caller.userId,
    note: `New version from ${src.code} v${src.version} (${src.status})`,
  })

  await writeAudit({
    actorId: caller.userId,
    action: 'create',
    schema: 'public',
    table: 'label_templates',
    recordId: data.id,
    after: { code: src.code, version, supersedes: src.id },
  })

  return NextResponse.json({ template: data })
}

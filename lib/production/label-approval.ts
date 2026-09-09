/**
 * The write side of label approval that is neither a pure rule nor a route.
 *
 * `lib/core/labels/approval.ts` decides WHETHER a gate is open — pure, tested,
 * no I/O. This does the database work that follows from it. It lives here
 * rather than inside a route because approval can be reached from more than one
 * place and the retirement of the previous version must happen identically
 * however it is reached; that is the mistake this file was created to avoid,
 * when the supersede step moved off the transition route.
 */

/**
 * Retire every other approved version of the same label code.
 *
 * A partial unique index allows exactly one approved version per code, so this
 * is not tidying — without it the approval UPDATE fails with a unique
 * violation and the caller sees a constraint error instead of an approval.
 *
 * Superseded rows are kept forever. Bags printed from them are in the
 * warehouse, and a traceability query has to be able to reconstruct exactly
 * what was on them.
 *
 * Returns the ids it retired, so the caller can report and audit them.
 */
export async function supersedeOtherApprovedVersions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  args: {
    templateId: string
    code: string
    version: number | string
    actorId: string | null
    actorName: string | null
    at: string
  },
): Promise<string[]> {
  const { data: retired } = await admin
    .from('label_templates')
    .update({ status: 'superseded', updated_at: args.at })
    .eq('code', args.code)
    .eq('status', 'approved')
    .neq('id', args.templateId)
    .select('id')

  const ids = ((retired ?? []) as { id: string }[]).map(r => r.id)
  for (const id of ids) {
    await admin.from('label_template_events').insert({
      template_id: id,
      event: 'superseded',
      actor_id: args.actorId,
      actor_name: args.actorName,
      note: `Superseded by ${args.code} v${args.version}`,
    })
  }
  return ids
}

// lib/esign/capture.ts
// Where a signature actually gets written. Two entry points:
//   submitSignatureByToken — external signer, draws fresh on components/ui/SignaturePad
//   submitStaffSignature   — internal signer, no drawing: stamps the signature
//                            already on file (production.employee_signatures),
//                            matching the "Verify & Sign" pattern already
//                            shipped on job cards (see QualitySignOff in
//                            app/(app)/job-cards/pasteuriser/page.tsx).
// Both claim the request atomically (status='pending' -> 'signed' in one
// UPDATE) so a token or request id can never be used to sign twice.

import crypto from 'crypto'
import { getAdminClient, resolveEmployeeId } from '@/lib/auth/server-helpers'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function contentHash(image: string, subjectType: string, subjectId: string, signerName: string, signedAt: string): string {
  return crypto.createHash('sha256').update(`${image}|${subjectType}|${subjectId}|${signerName}|${signedAt}`).digest('hex')
}

export type SubmitResult =
  | { ok: true; signatureId: string }
  | { ok: false; code: 'not_found' | 'expired' | 'already_signed' | 'error'; message: string }

// Best-effort convenience write-back so the existing dispatch Checklist tab
// (and anything else reading dispatch_documents.signed_at directly) keeps
// working. esign's own tables are the real source of truth regardless of
// whether this succeeds — logistics.dispatch_documents was never captured in
// a migration, so its exact column types are unverified; never let a type
// mismatch here break the actual signature capture.
async function backfillSubject(subjectType: string, subjectId: string, signerUserId: string | null, signedAt: string) {
  if (subjectType !== 'dispatch_document') return
  try {
    const admin = getAdminClient() as any
    const patch: Record<string, unknown> = { status: 'signed', signed_at: signedAt }
    if (signerUserId) patch.signed_by = signerUserId
    await admin.schema('logistics').from('dispatch_documents').update(patch).eq('id', subjectId)
  } catch {
    // best-effort only — esign.signatures already has the real record
  }
}

export async function submitSignatureByToken(token: string, opts: {
  signatureImage: string
  signerName: string
  ipAddress: string | null
  userAgent: string | null
}): Promise<SubmitResult> {
  const admin = getAdminClient() as any
  const tokenHash = hashToken(token)

  const { data: reqRow } = await admin.schema('esign').from('signature_requests')
    .select('*').eq('token_hash', tokenHash).maybeSingle()
  if (!reqRow) return { ok: false, code: 'not_found', message: 'This signing link is not valid.' }
  if (reqRow.status === 'signed') return { ok: false, code: 'already_signed', message: 'This has already been signed.' }
  if (reqRow.status !== 'pending') return { ok: false, code: 'not_found', message: 'This signing link is not valid.' }
  if (reqRow.token_expires_at && new Date(reqRow.token_expires_at).getTime() < Date.now()) {
    return { ok: false, code: 'expired', message: 'This signing link has expired.' }
  }

  const signedAt = new Date().toISOString()
  const { data: claimed } = await admin.schema('esign').from('signature_requests')
    .update({ status: 'signed' })
    .eq('id', reqRow.id).eq('status', 'pending')
    .select('id').maybeSingle()
  if (!claimed) return { ok: false, code: 'already_signed', message: 'This has already been signed.' }

  const hash = contentHash(opts.signatureImage, reqRow.subject_type, reqRow.subject_id, opts.signerName, signedAt)
  const { data: sig, error: sigErr } = await admin.schema('esign').from('signatures').insert({
    request_id:      reqRow.id,
    subject_type:    reqRow.subject_type,
    subject_id:      reqRow.subject_id,
    signer_kind:     'external',
    signer_user_id:  null,
    signer_name:     opts.signerName,
    signature_image: opts.signatureImage,
    signature_hash:  hash,
    signed_at:       signedAt,
    ip_address:      opts.ipAddress,
    user_agent:      opts.userAgent,
  }).select('id').single()
  if (sigErr) return { ok: false, code: 'error', message: sigErr.message }

  await admin.schema('esign').from('signature_requests').update({ signature_id: sig.id }).eq('id', reqRow.id)
  await backfillSubject(reqRow.subject_type, reqRow.subject_id, null, signedAt)

  return { ok: true, signatureId: sig.id }
}

export async function submitStaffSignature(requestId: string, callerUserId: string): Promise<SubmitResult> {
  const admin = getAdminClient() as any

  const employeeId = await resolveEmployeeId(callerUserId)
  if (!employeeId) {
    return { ok: false, code: 'error', message: 'Your login is not linked to a Staff Directory record.' }
  }

  const { data: empSig } = await admin.schema('production').from('employee_signatures')
    .select('signature').eq('employee_id', employeeId).maybeSingle()
  if (!empSig?.signature) {
    return { ok: false, code: 'error', message: 'No signature on file — set one up on your Staff Directory profile first.' }
  }

  const { data: emp } = await admin.schema('production').from('employees')
    .select('name, display_name').eq('id', employeeId).maybeSingle()
  const signerName = emp?.display_name || emp?.name || 'Staff'

  const { data: reqRow } = await admin.schema('esign').from('signature_requests')
    .select('*').eq('id', requestId).maybeSingle()
  if (!reqRow) return { ok: false, code: 'not_found', message: 'Signature request not found.' }
  if (reqRow.status !== 'pending') return { ok: false, code: 'already_signed', message: 'This has already been signed.' }

  const signedAt = new Date().toISOString()
  const { data: claimed } = await admin.schema('esign').from('signature_requests')
    .update({ status: 'signed' })
    .eq('id', requestId).eq('status', 'pending')
    .select('id').maybeSingle()
  if (!claimed) return { ok: false, code: 'already_signed', message: 'This has already been signed.' }

  const hash = contentHash(empSig.signature, reqRow.subject_type, reqRow.subject_id, signerName, signedAt)
  const { data: sig, error: sigErr } = await admin.schema('esign').from('signatures').insert({
    request_id:      reqRow.id,
    subject_type:    reqRow.subject_type,
    subject_id:      reqRow.subject_id,
    signer_kind:     'internal',
    signer_user_id:  callerUserId,
    signer_name:     signerName,
    signature_image: empSig.signature,
    signature_hash:  hash,
    signed_at:       signedAt,
  }).select('id').single()
  if (sigErr) return { ok: false, code: 'error', message: sigErr.message }

  await admin.schema('esign').from('signature_requests').update({ signature_id: sig.id }).eq('id', reqRow.id)
  await backfillSubject(reqRow.subject_type, reqRow.subject_id, callerUserId, signedAt)

  return { ok: true, signatureId: sig.id }
}

// lib/esign/request.ts
// Lifecycle of an esign.signature_requests row: create (mints an external
// token if needed), look up by token (for the public /sign/[token] page),
// list history for a subject (audit view), and void.
// All access is via the service-role client — see 20260729_008_esign_schema.sql
// for why (no per-row/token RLS pattern exists in this codebase).

import crypto from 'crypto'
import { getAdminClient } from '@/lib/auth/server-helpers'

export type SignerKind = 'internal' | 'external'

export interface CreateRequestInput {
  subjectType: string
  subjectId: string
  title: string
  signerKind: SignerKind
  createdBy: string
  signerUserId?: string | null
  signerName?: string | null
  signerContact?: string | null
  expiresInHours?: number // external only, default 72
}

export interface CreatedRequest {
  id: string
  token?: string   // raw token — returned ONLY here, never persisted in plain form
  signUrl?: string
}

const DEFAULT_EXPIRY_HOURS = 72

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function createSignatureRequest(input: CreateRequestInput): Promise<CreatedRequest> {
  const admin = getAdminClient() as any
  const nowIso = new Date().toISOString()

  // "Last request wins" — auto-void any still-pending request for this subject.
  await admin.schema('esign').from('signature_requests')
    .update({ status: 'voided', voided_at: nowIso, voided_by: input.createdBy, void_reason: 'superseded by a new request' })
    .eq('subject_type', input.subjectType).eq('subject_id', input.subjectId).eq('status', 'pending')

  let token: string | null = null
  let tokenHash: string | null = null
  let tokenExpiresAt: string | null = null
  if (input.signerKind === 'external') {
    token = crypto.randomBytes(32).toString('base64url')
    tokenHash = hashToken(token)
    tokenExpiresAt = new Date(Date.now() + (input.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 3_600_000).toISOString()
  }

  const { data, error } = await admin.schema('esign').from('signature_requests').insert({
    subject_type:     input.subjectType,
    subject_id:       input.subjectId,
    title:            input.title,
    signer_kind:      input.signerKind,
    signer_user_id:   input.signerUserId ?? null,
    signer_name:      input.signerName ?? null,
    signer_contact:   input.signerContact ?? null,
    token_hash:       tokenHash,
    token_expires_at: tokenExpiresAt,
    created_by:       input.createdBy,
  }).select('id').single()

  if (error) throw new Error(error.message)

  const result: CreatedRequest = { id: data.id }
  if (token) {
    result.token = token
    result.signUrl = `/sign/${token}`
  }
  return result
}

export type RequestLookup =
  | { state: 'not_found' }
  | { state: 'expired' }
  | { state: 'signed'; title: string; signerName: string | null; signedAt: string }
  | { state: 'pending'; requestId: string; title: string }

// Public-facing lookup for app/sign/[token] — deliberately returns nothing
// beyond title/status, never the underlying subject_id or internal details.
export async function getRequestByToken(token: string): Promise<RequestLookup> {
  const admin = getAdminClient() as any
  const tokenHash = hashToken(token)
  const { data } = await admin.schema('esign').from('signature_requests')
    .select('id, title, status, token_expires_at, signature_id')
    .eq('token_hash', tokenHash).maybeSingle()

  if (!data) return { state: 'not_found' }

  if (data.status === 'signed') {
    const { data: sig } = data.signature_id
      ? await admin.schema('esign').from('signatures').select('signer_name, signed_at').eq('id', data.signature_id).maybeSingle()
      : { data: null }
    return { state: 'signed', title: data.title, signerName: sig?.signer_name ?? null, signedAt: sig?.signed_at ?? '' }
  }

  if (data.status !== 'pending') return { state: 'not_found' }
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) return { state: 'expired' }

  return { state: 'pending', requestId: data.id, title: data.title }
}

export interface SubjectHistoryRow {
  id: string
  status: string
  signer_kind: SignerKind
  signer_name: string | null
  signer_contact: string | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
  signature: {
    id: string
    signer_name: string
    signature_image: string
    signed_at: string
    ip_address: string | null
    user_agent: string | null
    status: string
  } | null
}

export async function listRequestsFor(subjectType: string, subjectId: string): Promise<SubjectHistoryRow[]> {
  const admin = getAdminClient() as any
  const { data: requests } = await admin.schema('esign').from('signature_requests')
    .select('*').eq('subject_type', subjectType).eq('subject_id', subjectId)
    .order('created_at', { ascending: false })

  const rows = (requests ?? []) as any[]
  const sigIds = rows.map(r => r.signature_id).filter(Boolean)
  const { data: signatures } = sigIds.length
    ? await admin.schema('esign').from('signatures').select('*').in('id', sigIds)
    : { data: [] as any[] }
  const sigById = new Map(((signatures ?? []) as any[]).map(s => [s.id, s]))

  return rows.map(r => ({ ...r, signature: r.signature_id ? sigById.get(r.signature_id) ?? null : null }))
}

export async function voidRequest(id: string, voidedBy: string, reason?: string): Promise<void> {
  const admin = getAdminClient() as any
  const nowIso = new Date().toISOString()

  const { data: reqRow } = await admin.schema('esign').from('signature_requests')
    .select('signature_id').eq('id', id).maybeSingle()

  await admin.schema('esign').from('signature_requests')
    .update({ status: 'voided', voided_at: nowIso, voided_by: voidedBy, void_reason: reason ?? null })
    .eq('id', id)

  if (reqRow?.signature_id) {
    await admin.schema('esign').from('signatures')
      .update({ status: 'voided', voided_at: nowIso, voided_by: voidedBy, void_reason: reason ?? null })
      .eq('id', reqRow.signature_id)
  }
}

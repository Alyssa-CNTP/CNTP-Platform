// lib/esign/subjects.ts
// Registry of things the esign platform knows how to sign. Adding a future
// consumer (job card, quality doc, HR form, ...) is just a new entry here —
// esign's tables are polymorphic on subject_type/subject_id, so no schema
// change is needed. The human-readable label for a specific request is
// supplied by the caller at creation time (signature_requests.title), not
// derived here — this registry only gates who's allowed to request/void.

import type { PermissionKey } from '@/lib/auth/permissions'

export interface SubjectDef {
  internalPermission: PermissionKey  // create + sign an in-app ("Verify & Sign") request
  externalPermission: PermissionKey  // send an external signing link to a non-staff signer
  voidPermission: PermissionKey      // cancel/resend a pending request
}

export const SUBJECTS: Record<string, SubjectDef> = {
  dispatch_document: {
    internalPermission: 'can_sign_dispatch_doc',
    externalPermission: 'can_request_external_signature',
    voidPermission: 'can_request_external_signature',
  },
  // A page in a GRN / Delivery Note book. Both acknowledgement blocks on the
  // page ("Received by" and "Transporter") are separate subjects — the
  // subject_id is `<document id>:received` / `<document id>:transporter`, so
  // esign's one-pending-request-per-subject rule holds for each block on its
  // own. See lib/notebooks/types.ts (esignSubjectId).
  notebook_document: {
    internalPermission: 'can_sign_notebook_doc',
    externalPermission: 'can_request_external_signature',
    voidPermission: 'can_request_external_signature',
  },
}

export function getSubject(subjectType: string): SubjectDef | null {
  return SUBJECTS[subjectType] ?? null
}

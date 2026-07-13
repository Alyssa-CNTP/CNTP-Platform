import { getAdminClient } from '@/lib/auth/server-helpers'

// Central audit-log writer. Appends to axis.audit_log (actor / action / target /
// before+after snapshots). Best-effort: an audit failure must never block or fail
// the action it records. Call from API route handlers after the change succeeds.
export interface AuditEntry {
  actorId: string | null
  action: string           // 'update' | 'delete' | 'restore' | 'reopen' | …
  schema: string           // e.g. 'production'
  table: string            // e.g. 'prod_sessions'
  recordId: string | null
  before?: any
  after?: any
  ip?: string | null
  userAgent?: string | null
}

export async function writeAudit(e: AuditEntry): Promise<void> {
  try {
    await (getAdminClient() as any).schema('axis').from('audit_log').insert({
      actor_id:     e.actorId,
      action:       e.action,
      schema_name:  e.schema,
      table_name:   e.table,
      record_id:    e.recordId,
      before_state: e.before ?? null,
      after_state:  e.after ?? null,
      ip_address:   e.ip ?? null,
      user_agent:   e.userAgent ?? null,
    })
  } catch { /* audit is best-effort — never block the action it records */ }
}

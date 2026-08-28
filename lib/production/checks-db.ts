/**
 * Persistence helpers for the checks engine. Shared by ChecksPanel and the
 * capture page's change-over hook so the append-only event trail is written the
 * same way everywhere. Uses the browser Supabase client (like CleaningPanel).
 */
import { getDb } from '@/lib/supabase/db'

export interface CheckEventInput {
  phase:        'startup' | 'running' | 'shutdown'
  check_key:    string
  check_label?: string
  kind:         'confirm' | 'number' | 'text' | 'scale' | 'massbalance'
  value_num?:   number | null
  value_text?:  string | null
  unit?:        string | null
  status?:      'ok' | 'flagged' | 'na' | 'fail'
  reason?:      string | null
  spec_min?:    number | null
  spec_max?:    number | null
  production_idx?: number | null
  photo_path?:  string | null
  source?:      'keypad' | 'photo' | 'auto' | 'sign'
  maintenance_card_id?: number | null
  actor_id?:    string | null
  actor_name?:  string | null
  recorded_at?: string
}

/**
 * Get-or-create the checks record for a section/shift/date; returns its id.
 * Throws on failure — callers must not treat a swallowed DB error as success
 * (that silent-failure shape is what let checks look "filled in" on screen
 * while nothing actually reached the audit trail).
 */
export async function ensureCheckRecord(
  sectionId: string, date: string, shift: string, sessionId: string | null,
): Promise<string> {
  const db = getDb()
  const { data: existing, error: selErr } = await db.schema('production').from('check_records')
    .select('id').eq('section_id', sectionId).eq('date', date).eq('shift', shift).maybeSingle()
  if (selErr) throw new Error(`Could not load the checks record: ${selErr.message}`)
  if ((existing as any)?.id) return (existing as any).id
  const { data, error } = await db.schema('production').from('check_records')
    .insert({ section_id: sectionId, date, shift, session_id: sessionId ?? null } as any)
    .select('id').single()
  if (error) {
    // check_records has UNIQUE(section_id,date,shift) — two near-simultaneous
    // first writes (the HourlyVsdPrompt popup and ChecksPanel's own VSD widget
    // both call this) can both pass the SELECT-found-nothing check above before
    // either INSERT lands, so the loser hits a 23505 conflict here. That's not
    // a real failure — the record exists now, just created by the other
    // caller — so fetch and return it instead of throwing away the operator's
    // first reading of the shift.
    if (error.code === '23505') {
      const { data: retry, error: retryErr } = await db.schema('production').from('check_records')
        .select('id').eq('section_id', sectionId).eq('date', date).eq('shift', shift).single()
      if (retryErr) throw new Error(`Could not load the checks record: ${retryErr.message}`)
      return (retry as any).id
    }
    throw new Error(`Could not create the checks record: ${error.message}`)
  }
  return (data as any).id
}

export async function appendCheckEvent(recordId: string, e: CheckEventInput): Promise<void> {
  const { error } = await getDb().schema('production').from('check_events').insert({ record_id: recordId, ...e } as any)
  if (error) throw new Error(`Could not save "${e.check_label ?? e.check_key}": ${error.message}`)
}

/** Load the record header + its events (to restore the timeline and signed state). */
export async function loadCheckRecord(sectionId: string, date: string, shift: string): Promise<{
  record: any | null; events: any[]
}> {
  const db = getDb()
  const { data: record } = await db.schema('production').from('check_records')
    .select('*').eq('section_id', sectionId).eq('date', date).eq('shift', shift).maybeSingle()
  if (!record) return { record: null, events: [] }
  const { data: events } = await db.schema('production').from('check_events')
    .select('*').eq('record_id', (record as any).id).order('recorded_at', { ascending: true })
  return { record, events: (events as any[]) ?? [] }
}

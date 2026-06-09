// lib/logistics/db.ts
// Shorthand for querying the `logistics` schema from anywhere in the app.
// The default browser client is locked to the `production` schema (see
// lib/supabase/client.ts), so every logistics query must call .schema('logistics' as any).

import { getDb } from '@/lib/supabase/db'

export function logisticsDb() {
  return getDb().schema('logistics' as any)
}

// lib/production/user-signature.ts
// A signatory (manager, supervisor, quality officer) should only ever hand-draw
// their own signature ONCE — after that it's remembered per-user and reused on
// every future sign-off, rather than re-drawing it on every job card.

import { getDb } from '@/lib/supabase/db'

export async function loadMySignature(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await getDb().from('user_signatures').select('signature').eq('user_id', userId).maybeSingle()
  return (data as any)?.signature ?? null
}

export async function saveMySignature(userId: string | null, signature: string): Promise<void> {
  if (!userId || !signature) return
  await getDb().from('user_signatures').upsert({ user_id: userId, signature } as any, { onConflict: 'user_id' })
}

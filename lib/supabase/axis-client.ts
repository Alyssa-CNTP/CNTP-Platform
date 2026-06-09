// lib/supabase/axis-client.ts
import { getSupabaseClient } from './client'

export function getAxisClient() {
  return getSupabaseClient().schema('axis' as any)
}
// lib/auth/server-helpers.ts
// Server-side permission resolution for Next.js API routes.

import { createServerClient } from '@supabase/ssr'
import { createClient }       from '@supabase/supabase-js'
import { cookies }            from 'next/headers'
import {
  type Department,
  type Permissions,
  type PermissionKey,
  resolveAllPermissions,
  ALL_DEPARTMENTS,
} from './permissions'

// Returns a server-side Supabase client that carries the caller's session cookie.
// Queries run as the `authenticated` role — RLS applies, service_role is NOT used.
// Use this whenever you need to query schemas that are exposed but not granted to service_role.
export async function getSessionClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cs) => { try { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
      },
    }
  )
}

// Decode JWT payload without a library (server-safe)
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const b64    = token.split('.')[1]
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((b64.length + 2) % 4 || 2)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch { return null }
}

export async function getCallerPermissions() {
  const db = await getSessionClient()

  const { data: { user }, error } = await db.auth.getUser()
  if (error || !user) return { userId: null, role: null, department: null, can: () => false }

  // ── Priority 1: read from JWT claims (set by custom_access_token_hook) ──
  // This is the fast, consistent path once the Supabase hook is configured.
  const { data: { session } } = await db.auth.getSession()
  const payload = session?.access_token ? decodeJwtPayload(session.access_token) : null

  if (payload && 'user_role' in payload) {
    const role       = (payload.user_role  as string)     || null
    const department = (payload.user_dept  as Department) || null
    const overrides  = (payload.user_perms as Permissions) || {}
    const resolved   = resolveAllPermissions(role, overrides)

    return {
      userId: user.id,
      role,
      department,
      can: (key: PermissionKey) => {
        // Full admin bypasses everything
        if (role === 'senior_developer') return true
        return resolved[key] === true
      },
    }
  }

  // ── Fallback: DB query (before hook is configured) ──
  const { data } = await db
    .schema('shared' as any)
    .from('app_roles')
    .select('role, department, permissions')
    .eq('user_id', user.id)
    .maybeSingle()

  const role       = (data as any)?.role       as string | null
  const department = (data as any)?.department as Department | null
  const overrides  = ((data as any)?.permissions ?? {}) as Permissions
  const resolved   = resolveAllPermissions(role, overrides)

  return {
    userId:     user.id,
    role,
    department,
    can: (key: PermissionKey) => {
      if (role === 'senior_developer') return true
      return resolved[key] === true
    },
  }
}

export function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export function isValidDepartment(d: string): d is Department {
  return ALL_DEPARTMENTS.includes(d as Department)
}
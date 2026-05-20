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

export async function getCallerPermissions() {
  const cookieStore = await cookies()
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'production' },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cs) => { try { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
      },
    }
  )

  const { data: { user } } = await db.auth.getUser()
  if (!user) return { userId: null, role: null, department: null, can: () => false }

  const { data } = await db
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
    can: (key: PermissionKey) => resolved[key] === true,
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
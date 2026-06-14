'use client'

// lib/auth/context.tsx
// Department → Role → Permissions.
// p('can_upload_pdfs') is the only function pages need to call.

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { getDb } from '@/lib/supabase/db'
import {
  type Department,
  type PermissionKey,
  type Permissions,
  resolveAllPermissions,
} from './permissions'

export type { Department, PermissionKey }

// ─── Context shape ────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:        User | null
  session:     Session | null
  role:        string | null
  department:  Department | null
  sectionId:   string | null
  fullName:    string | null
  permissions: Permissions
  displayName: string
  initials:    string
  loading:          boolean
  permissionsReady: boolean  // true once resolved is populated

  // THE function — use this everywhere in pages
  // p('can_upload_pdfs') → true/false
  p: (key: PermissionKey) => boolean

  // Auth actions
  signIn:         (email: string, password: string) => Promise<{ error: string | null }>
  signOut:        () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>

  // Convenience checks
  isIT:          boolean   // IT department — grants AXIS access only
  isFullAdmin:   boolean   // senior_developer role — bypasses ALL permission checks
  isQuality:     boolean   // Quality department
  isProduction:  boolean   // Production department
  isMaintenance: boolean   // Maintenance department
  isSales:       boolean   // Sales department
  isMarketing:   boolean   // Marketing department
  isManagement:  boolean   // Management department
  isSupervisor:  boolean   // role === 'supervisor'
  isFloor:       boolean   // role in ['operator','section_operator']

  // Cross-department checks (used by sidebar + route guards)
  canAccessQuality:    boolean
  canAccessProduction: boolean
  canAccessSales:      boolean
  canAccessMarketing:  boolean
  canAccessManagement: boolean
  canAccessMaintenance:boolean
  canAccessAdmin:      boolean

  userId: string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,        setUser]        = useState<User | null>(null)
  const [session,     setSession]     = useState<Session | null>(null)
  const [role,        setRole]        = useState<string | null>(null)
  const [department,  setDepartment]  = useState<Department | null>(null)
  const [sectionId,   setSectionId]   = useState<string | null>(null)
  const [fullName,    setFullName]    = useState<string | null>(null)
  const [permissions, setPermissions] = useState<Permissions>({})
  const [resolved,    setResolved]    = useState<Record<PermissionKey, boolean> | null>(null)
  const [loading,     setLoading]     = useState(true)

  // Decode a JWT (base64url) without a library
  function decodeJwt(token: string): Record<string, any> | null {
    try {
      const b64 = token.split('.')[1]
      if (!b64) return null
      const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((b64.length + 2) % 4 || 2)
      return JSON.parse(atob(padded))
    } catch { return null }
  }

  const fetchRole = useCallback(async (userId: string) => {
    try {
      // ── Priority 1: JWT custom claims (set by Supabase hook on login) ──
      // These are cryptographically signed — cannot be tampered with.
      // Available once the custom_access_token_hook is registered in Supabase.
      const { data: { session } } = await getDb().auth.getSession()
      const payload = session?.access_token ? decodeJwt(session.access_token) : null

      if (payload && 'user_role' in payload) {
        // Hook is active — trust the JWT
        const r   = (payload.user_role   as string) || null
        const d   = (payload.user_dept   as Department) || null
        const sid = (payload.user_section as string) || null
        const fn  = (payload.user_name   as string) || null
        const ov  = (payload.user_perms  as Permissions) || {}

        setRole(r)
        setDepartment(d)
        setSectionId(sid)
        setFullName(fn)
        setPermissions(ov)
        setResolved(resolveAllPermissions(r, ov))
        return
      }

      // ── Fallback: DB query (before hook is configured, or for service accounts) ──
      const { data } = await getDb()
        .schema('shared')
        .from('app_roles')
        .select('role, department, section_id, permissions, full_name')
        .eq('user_id', userId)
        .maybeSingle()

      const r   = (data as any)?.role       as string | null
      const d   = (data as any)?.department as Department | null
      const sid = (data as any)?.section_id as string | null
      const fn  = (data as any)?.full_name  as string | null
      const ov  = ((data as any)?.permissions ?? {}) as Permissions

      setRole(r)
      setDepartment(d)
      setSectionId(sid)
      setFullName(fn)
      setPermissions(ov)
      setResolved(resolveAllPermissions(r, ov))
    } catch {
      setRole(null)
      setDepartment(null)
      setSectionId(null)
      setFullName(null)
      setPermissions({})
      setResolved(resolveAllPermissions(null, {}))
    }
  }, [])

  useEffect(() => {
    const db = getDb()

    // Track which user we've already loaded permissions for
    // to prevent double-fetching when onAuthStateChange fires after getSession
    let loadedForUserId: string | null = null

    db.auth.getSession().then(({ data: { session: sess } }: any) => {
      setSession(sess)
      setUser(sess?.user ?? null)
      if (sess?.user) {
        loadedForUserId = sess.user.id
        fetchRole(sess.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = db.auth.onAuthStateChange((_: any, sess: any) => {
      setSession(sess)
      setUser(sess?.user ?? null)
      if (sess?.user) {
        // Only re-fetch if this is a genuinely different user (new sign-in)
        // Skip if we already loaded permissions for this user from getSession above
        if (sess.user.id !== loadedForUserId) {
          loadedForUserId = sess.user.id
          fetchRole(sess.user.id)
        }
      } else {
        // User signed out — clear everything
        loadedForUserId = null
        setRole(null); setDepartment(null); setSectionId(null)
        setResolved(null); setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchRole])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error, data } = await getDb().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('invalid') || msg.includes('credentials'))
        return { error: 'Invalid email or password' }
      return { error: error.message }
    }
    // Fire-and-forget: log sign-in to audit trail
    fetch('/api/admin/audit/auth-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign_in', email: data?.user?.email }),
    }).catch(() => {})
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    // Write sign-out event before the session is invalidated
    await fetch('/api/admin/audit/auth-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign_out' }),
    }).catch(() => {})
    await getDb().auth.signOut()
    setRole(null); setDepartment(null); setSectionId(null); setResolved(null)
  }, [])

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!next || next.length < 8) return { error: 'Password must be at least 8 characters' }
    const email = user?.email
    if (!email) return { error: 'Not signed in' }
    const { error: reAuthErr } = await getDb().auth.signInWithPassword({ email, password: current })
    if (reAuthErr) return { error: 'Current password is incorrect' }
    const { error } = await getDb().auth.updateUser({ password: next })
    if (error) return { error: error.message }
    return { error: null }
  }, [user])

  // p() — the one function pages call for permission checks
  const p = useCallback((key: PermissionKey): boolean => {
    if (!resolved) return false
    return resolved[key] === true
  }, [resolved])

  const displayName =
    fullName ||
    (user?.user_metadata?.full_name  as string) ||
    (user?.user_metadata?.display_name as string) ||
    user?.email?.split('@')[0] || '—'

  const initials = displayName
    .split(/[\s_-]/)
    .map((n: string) => n[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  // Department flags
  const isIT         = department === 'IT'
  const isFullAdmin  = role === 'senior_developer'
  const isQuality    = department === 'Quality'
  const isProduction = department === 'Production'
  const isMaintenance= department === 'Maintenance'
  const isSales      = department === 'Sales'
  const isMarketing  = department === 'Marketing'
  const isManagement = department === 'Management'

  // Role flags. isSupervisor = production/factory supervisor (count + capture
  // sign-off powers). Warehouse supervisors are NOT production supervisors.
  // 'supervisor' is the legacy value for 'production_supervisor'.
  const isSupervisor = role === 'production_supervisor' || role === 'supervisor'
  const isFloor      = role === 'operator' || role === 'section_operator'

  // Access flags — IT can access everything, others only their dept + what's toggled
  const canAccessQuality    = isFullAdmin || isIT || isQuality    || p('can_upload_pdfs') || p('can_view_history')
  const canAccessProduction = isFullAdmin || isIT || isProduction || p('can_submit_count') || p('can_view_ops_dashboard')
  const canAccessSales      = isFullAdmin || isIT || isSales      || p('can_access_sales')
  const canAccessMarketing  = isFullAdmin || isIT || isMarketing  || p('can_access_marketing')
  const canAccessManagement = isFullAdmin || isIT || isManagement || p('can_view_management')
  // Maintenance is open to its own dept + Management view + Production (they raise breakdowns)
  const canAccessMaintenance= isFullAdmin || isIT || isMaintenance || isManagement || isProduction
  const canAccessAdmin      = p('can_manage_users') || p('can_reset_passwords') || p('can_view_audit_log')

  const value: AuthContextValue = {
    user, session, role, department, sectionId, fullName, permissions,
    displayName, initials, loading,
    p, signIn, signOut, changePassword,
    permissionsReady: resolved !== null,
    isIT, isFullAdmin, isQuality, isProduction, isMaintenance, isSales, isMarketing, isManagement,
    isSupervisor, isFloor,
    canAccessQuality, canAccessProduction, canAccessSales,
    canAccessMarketing, canAccessManagement, canAccessMaintenance, canAccessAdmin,
    userId: user?.id ?? null,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
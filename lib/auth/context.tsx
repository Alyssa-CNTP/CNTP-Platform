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
  isIT:        boolean   // IT department
  isQuality:   boolean   // Quality department
  isProduction:boolean   // Production department
  isSales:     boolean   // Sales department
  isMarketing: boolean   // Marketing department
  isManagement:boolean   // Management department

  // Cross-department checks (used by sidebar + route guards)
  canAccessQuality:    boolean   // can see quality section
  canAccessProduction: boolean   // can see production section
  canAccessSales:      boolean   // can see sales section
  canAccessMarketing:  boolean   // can see marketing section
  canAccessManagement: boolean   // can see management section
  canAccessAdmin:      boolean   // can see /users page

  userId: string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,       setUser]       = useState<User | null>(null)
  const [session,    setSession]    = useState<Session | null>(null)
  const [role,       setRole]       = useState<string | null>(null)
  const [department, setDepartment] = useState<Department | null>(null)
  const [sectionId,  setSectionId]  = useState<string | null>(null)
  const [resolved,   setResolved]   = useState<Record<PermissionKey, boolean> | null>(null)
  const [loading,    setLoading]    = useState(true)

  const fetchRole = useCallback(async (userId: string) => {
    try {
      const { data } = await getDb()
        .schema('production')
        .from('app_roles')
        .select('role, department, section_id, permissions')
        .eq('user_id', userId)
        .maybeSingle()

      const r   = (data as any)?.role       as string | null
      const d   = (data as any)?.department as Department | null
      const sid = (data as any)?.section_id as string | null
      const ov  = ((data as any)?.permissions ?? {}) as Permissions

      setRole(r)
      setDepartment(d)
      setSectionId(sid)
      setResolved(resolveAllPermissions(r, ov))
    } catch {
      setRole(null)
      setDepartment(null)
      setSectionId(null)
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
    const { error } = await getDb().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('invalid') || msg.includes('credentials'))
        return { error: 'Invalid email or password' }
      return { error: error.message }
    }
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
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
  const isQuality    = department === 'Quality'
  const isProduction = department === 'Production'
  const isSales      = department === 'Sales'
  const isMarketing  = department === 'Marketing'
  const isManagement = department === 'Management'

  // Access flags — IT can access everything, others only their dept + what's toggled
  const canAccessQuality    = isIT || isQuality    || p('can_upload_pdfs') || p('can_view_history')
  const canAccessProduction = isIT || isProduction || p('can_submit_count') || p('can_view_ops_dashboard')
  const canAccessSales      = isIT || isSales      || p('can_access_sales')
  const canAccessMarketing  = isIT || isMarketing  || p('can_access_marketing')
  const canAccessManagement = isIT || isManagement || p('can_view_management')
  const canAccessAdmin      = p('can_manage_users') || p('can_reset_passwords') || p('can_view_audit_log')

  const value: AuthContextValue = {
    user, session, role, department, sectionId,
    displayName, initials, loading,
    p, signIn, signOut, changePassword,
    permissionsReady: resolved !== null,
    isIT, isQuality, isProduction, isSales, isMarketing, isManagement,
    canAccessQuality, canAccessProduction, canAccessSales,
    canAccessMarketing, canAccessManagement, canAccessAdmin,
    userId: user?.id ?? null,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
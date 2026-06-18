'use client'

// lib/dashboard/useDashboardLayout.ts
// Load / save / reset a user's layout for a single dashboard.
//
// Persistence lives in shared.dashboard_layouts (RLS own-row), accessed the same
// way as shared.user_preferences elsewhere in the app. With no saved row we fall
// back to the code-defined default for that dashboard, so a fresh user always
// sees a sensible page. resetToDefault() deletes the row and restores the default.

import { useCallback, useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import type { WidgetInstance } from './types'
import { getDefaultLayout } from './registry'

interface UseDashboardLayout {
  widgets:     WidgetInstance[]
  setWidgets:  (w: WidgetInstance[]) => void
  loading:     boolean
  saving:      boolean
  isCustom:    boolean          // true once the user has a saved row
  save:        (w: WidgetInstance[]) => Promise<void>
  resetToDefault: () => Promise<void>
}

export function useDashboardLayout(dashboardKey: string): UseDashboardLayout {
  const fallback = getDefaultLayout(dashboardKey)

  const [widgets,  setWidgets]  = useState<WidgetInstance[]>(fallback)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [isCustom, setIsCustom] = useState(false)

  // ── Load saved layout ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const db = getDb()
        const { data: { user } } = await db.auth.getUser()
        if (!user) { if (!cancelled) setLoading(false); return }

        const { data } = await db
          .schema('shared' as any)
          .from('dashboard_layouts')
          .select('widgets')
          .eq('user_id', user.id)
          .eq('dashboard_key', dashboardKey)
          .maybeSingle()

        const saved = (data as any)?.widgets as WidgetInstance[] | undefined
        if (!cancelled && Array.isArray(saved) && saved.length) {
          setWidgets(saved)
          setIsCustom(true)
        }
      } catch { /* fall back to default layout */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [dashboardKey])

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = useCallback(async (w: WidgetInstance[]) => {
    setWidgets(w)
    setSaving(true)
    try {
      const db = getDb()
      const { data: { user } } = await db.auth.getUser()
      if (!user) return
      await db
        .schema('shared' as any)
        .from('dashboard_layouts')
        .upsert(
          { user_id: user.id, dashboard_key: dashboardKey, widgets: w, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,dashboard_key' },
        )
      setIsCustom(true)
    } catch { /* keep local state even if the write fails */ }
    finally { setSaving(false) }
  }, [dashboardKey])

  // ── Reset to the code default ───────────────────────────────────────────────
  const resetToDefault = useCallback(async () => {
    const def = getDefaultLayout(dashboardKey)
    setWidgets(def)
    setSaving(true)
    try {
      const db = getDb()
      const { data: { user } } = await db.auth.getUser()
      if (!user) return
      await db
        .schema('shared' as any)
        .from('dashboard_layouts')
        .delete()
        .eq('user_id', user.id)
        .eq('dashboard_key', dashboardKey)
      setIsCustom(false)
    } catch { /* local state already reset */ }
    finally { setSaving(false) }
  }, [dashboardKey])

  return { widgets, setWidgets, loading, saving, isCustom, save, resetToDefault }
}

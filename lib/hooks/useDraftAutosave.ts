// lib/hooks/useDraftAutosave.ts
//
// Local-storage safety net for in-progress captures, modeled on the pattern
// already used by app/(app)/production/capture/[section]/page.tsx: if the
// network or server goes down mid-capture, the last 15s of typed data is
// still sitting in the browser and can be recovered on reload/retry, instead
// of being lost. Every quality capture page snapshots its live form state
// under its own key; once that data has actually landed in the database,
// the page calls clearDraft() so the recovered-draft banner doesn't resurface
// stale data next time the page opens.

import { useEffect, useRef } from 'react'

export type Draft<T> = { data: T; savedAt: string }

// Snapshots `data` to localStorage under `key` every intervalMs (default
// 15s), plus immediately on tab-hide/page-close — a tablet screen-lock or
// closed tab doesn't get to wait for the next interval tick. Pass
// `enabled: false` to pause writes (e.g. while a save is already in
// flight, or once the form has been reset back to blank).
export function useDraftAutosave<T>(key: string, data: T, opts?: { intervalMs?: number; enabled?: boolean }) {
  const dataRef = useRef(data)
  dataRef.current = data
  const enabled = opts?.enabled ?? true
  const intervalMs = opts?.intervalMs ?? 15000

  useEffect(() => {
    if (!enabled || !key) return
    const save = () => {
      try {
        localStorage.setItem(key, JSON.stringify({ data: dataRef.current, savedAt: new Date().toISOString() } as Draft<T>))
      } catch { /* storage full or unavailable — best-effort, never blocks capture */ }
    }
    const timer = setInterval(save, intervalMs)
    const onVisibility = () => { if (document.visibilityState === 'hidden') save() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', save)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', save)
    }
  }, [key, enabled, intervalMs])
}

// Reads back a saved draft (e.g. on page load, to offer/apply recovery).
// Returns null if there's nothing saved, storage is unavailable, or the
// entry is corrupt.
export function readDraft<T>(key: string): Draft<T> | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Draft<T>) : null
  } catch {
    return null
  }
}

// Call once `data` has been confirmed written to the database — the draft is
// now redundant, so drop it rather than leaving stale data to resurface.
export function clearDraft(key: string) {
  try { localStorage.removeItem(key) } catch { /* best-effort */ }
}
